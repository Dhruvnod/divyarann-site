/* The story's damage on Dwarka (5 November 2026; made in the story lab on 31 October, the author's picks of 4 November): a layer of city.js, mounted when the data names it
   (content.city.layers, with city_events.js). It follows the book's stages, chapter by chapter (content.city.events.damage, from website/reader/atlas_events.json `damage`):
     7  smoke from a dozen places, dead cars at a junction, a few buildings hurt         8  the market's crater, the renovation block's glass gone, the market and the petrol pump burning
     11 smoke over the east                                                                12-13 only a few fires
     14 collapsed blocks and rubble                                                        16 the lid: the smoke come down over the city, flat and brown
   Of the real places only the market and the petrol pump burn; every other fire is on an unnamed building. The damage leans east of the tear and thins with distance.
   The stage is the chapter being replayed, or else the reader's own chapter. A building that came down in one stage stays down in the next (one ranking, more of it taken). On a change of
   stage the hurt tiles are rebuilt and swapped in the same frame (no flash of the whole city), the fires and their light, the smoke, the rubble and the dead cars are made again.
   The parts: city_dmg_tiles.js (which buildings, and the geometry of a hurt one), city_dmg_shaders.js (the patched building program, the fires' light), city_dmg_decor.js (craters, scorch,
   dead cars), city_dmg_fx.js (flames, smoke, the light on the ground), city_dmg_lid.js (the lid). The smoke moves with the city's own clock, so the map still rests when still. */
import * as D from "./city_data.js?v=ea5b0eae2a";
import * as SH from "./city_dmg_shaders.js?v=ea5b0eae2a";
import * as TL from "./city_dmg_tiles.js?v=ea5b0eae2a";
import * as FX from "./city_dmg_fx.js?v=ea5b0eae2a";
import * as DC from "./city_dmg_decor.js?v=ea5b0eae2a";
import * as LD from "./city_dmg_lid.js?v=ea5b0eae2a";

const FIRE_KINDS = {
  pump: { w: 14, h: 28, str: 1.25, smoke: { H: 720, r0: 10, r1: 120, alpha: 0.6, puffs: 38, pale: 0 } },
  crater: { w: 11, h: 9, str: 0.95, smoke: { H: 480, r0: 8, r1: 90, alpha: 0.52, puffs: 30, pale: 0.1 } },
  bus: { w: 4.2, h: 4.5, str: 0.75, smoke: { H: 300, r0: 5, r1: 55, alpha: 0.5, puffs: 22, pale: 0 } },
  cars: { w: 3.2, h: 3.2, str: 0.6, smoke: { H: 220, r0: 4, r1: 40, alpha: 0.45, puffs: 18, pale: 0.1 } },
};
const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export function mount(ctx) {
  const { THREE, S, scene, camera, U, mk, state, api, wake } = ctx;
  const DM = ctx.data && ctx.data.events && ctx.data.events.damage;
  const info = { stage: 0, hurt: 0, tiles: 0, fires: 0, puffs: 0, lid: false, buildMs: 0, builds: 0, err: "" };
  if (!DM || !DM.stages || !DM.stages.length || (ctx.cfg && ctx.cfg.id && DM.city && DM.city !== ctx.cfg.id)) return { info: () => ({ ...info, off: true }) };
  const frameFns = new Set();
  // what the lab's parts expect of the city: its material maker, its disposables, the light, a frame hook
  const dbg = { mk, U, get disposables() { return state.dbg.disposables || []; } };
  const apiShim = { canvas: ctx.canvas, wake, light: () => api.light(), setLight: (o) => api.setLight(o), onFrame: (f) => { frameFns.add(f); return () => frameFns.delete(f); } };
  const phone = ctx.tier() === "low" || (ctx.size.w && ctx.size.w < 700);
  let city = null, fp = null, field = null, cur = null, built = -1, gone = false, loading = null;
  // the city's own data decoded once (the file the city already fetched, so the browser has it), for the footprints the damage is planned on
  function load() {
    if (loading) return;
    loading = D.fetchCity(ctx.data.file || "/assets/city.bin.gz").then((c) => { if (gone) return; city = c; fp = TL.footprints(c); wake(400); })
      .catch((e) => { info.err = "the city's data: " + String((e && e.message) || e).slice(0, 160); });
  }
  const stageFor = (ch) => { let s = null; for (const st of DM.stages) if (st.ch <= ch) s = st; return s; };
  const upTo = (list, ch) => (list || []).filter((o) => (o.ch || 0) <= ch && (o.until == null || ch <= o.until)).map((o) => ({ ...o, min: 0 }));

  function build(st) {
    const t0 = performance.now(), hold = { disposers: [], tiles: [] };
    const dispose = () => { for (const f of hold.disposers.splice(0).reverse()) { try { f(); } catch (e) { console.warn(e); } } };
    const level = st.level || 1, seed = DM.seed || 11, lean = DM.lean || [1, 0.42];
    const tear = state.tear || { x: 0, n: 0 };
    field = TL.fieldOf(tear, lean, DM.scale || 1);
    const heroes = upTo(DM.heroes, st.ch), gutted = upTo(DM.gutted, st.ch);
    const plan = TL.planDamage(city, fp, { field, level, sites: st.sites, counts: st.counts, seed, heroes, gutted, spare: DM.spare || [], generators: DM.generators || [], randomGenerators: DM.randomGenerators == null ? 7 : DM.randomGenerators, burning: st.burning || 0 });
    // the city's building program, patched: soot, ruins, rubble and the fires' light
    const bmat = state.dbg.bmat;
    const { vert, frag } = SH.patchBuilding(bmat.vertexShader, bmat.fragmentShader);
    const FIRE = { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, 0)) };
    const dmat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { ...bmat.uniforms, uFire: FIRE }, defines: { ...bmat.defines } });
    dbg.disposables.push(dmat); hold.disposers.push(() => { const k = dbg.disposables.indexOf(dmat); if (k >= 0) dbg.disposables.splice(k, 1); dmat.dispose(); });
    // the hurt tiles, swapped in for the city's own (and back on dispose)
    const bT = state.dbg.bTiles; let ti = 0, b0 = 0, hurt = 0, swapped = 0;
    const shadowPart = (g, main, bs, q) => { const sg = new THREE.BufferGeometry(); sg.setAttribute("position", g.attributes.position); sg.setIndex(g.index); sg.setDrawRange(0, main); sg.boundingSphere = new THREE.Sphere(bs.center, bs.radius + 450 * q); return sg; };
    for (const [, , count] of city.meta.tiles) {
      const t = TL.buildTile(D, city, b0, count, plan, fp, { seed });
      b0 += count;
      if (t.empty) continue;
      const bt = bT[ti++];
      if (!t.hit || !bt) continue;
      const g = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(t.pu, 4);
      g.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute("aU", new THREE.InterleavedBufferAttribute(ib, 1, 3));
      g.setAttribute("aM", new THREE.BufferAttribute(t.mt, 4)); g.setAttribute("aD", new THREE.BufferAttribute(t.ad, 4, true)); g.setIndex(new THREE.BufferAttribute(t.idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.bs[0], t.bs[1], t.bs[2]), t.bs[3]);
      const m = bt.mesh, was = { g: bt.g, main: bt.main, c: bt.c.clone(), r: bt.r, pos: m.position.clone(), sc: m.scale.x, mat: m.material, sg: bt.sm ? bt.sm.geometry : null };
      bt.g = g; bt.main = t.ipMain; bt.c.set(t.o[0] + t.bs[0] / t.q, t.bs[1] / t.q, t.o[1] + t.bs[2] / t.q); bt.r = t.bs[3] / t.q; bt.far = false;
      m.geometry = g; m.material = dmat; m.position.set(t.o[0], 0, t.o[1]); m.scale.setScalar(1 / t.q); m.updateMatrix(); m.updateMatrixWorld(true);
      if (bt.sm) bt.sm.geometry = shadowPart(g, t.ipMain, g.boundingSphere, 1 / t.q);
      hold.tiles.push({ bt, was, g });
      hurt += t.hurt; swapped++;
    }
    hold.disposers.push(() => {
      for (const { bt, was, g } of hold.tiles) {
        const m = bt.mesh; bt.g = was.g; bt.main = was.main; bt.c.copy(was.c); bt.r = was.r; bt.far = false;
        m.geometry = was.g; m.material = was.mat; m.position.copy(was.pos); m.scale.setScalar(was.sc); m.updateMatrix(); m.updateMatrixWorld(true);
        if (bt.sm && was.sg) bt.sm.geometry = was.sg;
        g.dispose();
      }
      hold.tiles.length = 0;
    });
    // the fires: the data's (the market, the petrol pump, cars), then some of the burning ruins
    const fires = [];
    for (const f of upTo(DM.fires, st.ch)) { const k = FIRE_KINDS[f.kind] || FIRE_KINDS.cars; fires.push({ x: f.x, z: -f.n, y: 0.4, w: k.w, h: k.h, str: k.str, smoke: { ...k.smoke }, kind: f.kind }); }
    plan.order.filter((i) => plan.fire[i]).forEach((i, j) => {
      const A = fp.area[i], big = Math.min(1, A / 700), r = ((j * 37) % 11) / 11;
      fires.push({ x: fp.cx[i], z: -fp.cn[i], y: Math.max(2.5, plan.fireY[i]) - 0.5, w: Math.min(24, 8 + Math.sqrt(A) * 0.45), h: 8 + 10 * big + 5 * r, str: 0.95 + 0.25 * big, kind: "ruin",
        smoke: { H: 360 + 260 * ((j * 13) % 7) / 7 + 200 * big, r0: 9, r1: 62 + 40 * r + 40 * big, alpha: 0.5, puffs: 30, pale: 0.05 + 0.15 * r } });
    });
    // smoke with no flame: the columns of the first hours (Chapter 7: "the smoke that was rising from a dozen places"), pale, from the sites
    for (const sIt of plan.sites.slice(0, st.plumes || 0)) fires.push({ x: sIt.x, z: -sIt.n, y: 3, w: 6, h: 4, str: 0, noFlame: true, kind: "dust", smoke: { H: 420, r0: 16, r1: 130, alpha: 0.5, puffs: 24, pale: 0.55, rate: 0.03, fire: 0 } });
    const cap = phone ? 8 : 40; if (fires.length > cap) fires.length = cap;
    // the smoke over the east (Chapter 11: "Smoke covered the east"): still banks of it, leaning the way the damage does
    const banks = [];
    if (st.banks) {
      const rr = rngOf(seed);
      for (let j = 0; j < st.banks; j++) { const a = rr() * 6.28, d = 300 + rr() * 1700; banks.push({ x: tear.x + lean[0] * 900 + Math.cos(a) * d * 0.9 + 400, y: 380 + rr() * 520, z: -(tear.n + lean[1] * 900 + Math.sin(a) * d * 0.6 + 200), r: 280 + rr() * 380, alpha: 0.13 + 0.06 * rr(), pale: 0.55 }); }
    }
    const lights = fires.filter((f) => !f.noFlame).sort((a, b) => b.str * b.w - a.str * a.w).slice(0, 24);
    lights.forEach((f, i) => FIRE.value[i].set(f.x, f.y + f.h * 0.45 + 3, f.z, Math.min(1.6, f.str * (f.kind === "ruin" ? 0.9 : 1))));
    const fx = FX.createFx(THREE, { api: apiShim, dbg, U, scene, camera, S, level, fires, banks, phone, wind: DM.wind || [0.92, -0.38], FIRE });
    hold.disposers.push(() => fx.dispose());
    hold.disposers.push(FX.patchScene(THREE, scene, SH, FIRE));
    const decor = DC.createDecor(THREE, { api: apiShim, dbg, U, scene, S, dmat, plan, fp, city, level, field, preset: { craters: upTo(DM.craters, st.ch), carClusters: upTo(DM.cars, st.ch) }, fires, seed, phone });
    hold.disposers.push(() => decor.dispose());
    let lid = null;
    if (st.lid) { lid = LD.createLid(THREE, { api: apiShim, dbg, U, scene, S, tear, lean, level, phone, FIRE, opts: DM.lid || {} }); hold.disposers.push(() => lid.dispose()); }
    info.firesAt = fires.filter((f) => !f.noFlame).map((f) => [Math.round(f.x), Math.round(-f.z)]);      // where the flames are (for the tests: nothing burns at a spared place)
    Object.assign(info, { stage: st.ch, hurt, tiles: swapped, fires: fires.length, puffs: fx.stats.puffs, lid: !!lid, buildMs: Math.round(performance.now() - t0), builds: info.builds + 1 });
    return { dispose };
  }

  function step() {
    for (const f of frameFns) f();
    const R = ctx.replay(), bc = R.chapter || (ctx.reached ? ctx.reached() : 0);
    const st = stageFor(bc), k = st ? st.ch : 0;
    if (k === built || gone) return false;
    if (st && !(state.dbg.bTiles && state.dbg.bTiles.length && state.dbg.bmat)) return false;      // the buildings are not there yet
    if (st && !fp) { load(); return false; }                                                        // nor the footprints
    try {
      if (cur) { cur.dispose(); cur = null; }
      if (st) cur = build(st); else Object.assign(info, { stage: 0, hurt: 0, tiles: 0, fires: 0, puffs: 0, lid: false, firesAt: [] });
    } catch (e) { info.err = String((e && e.message) || e).slice(0, 200); console.error("city_damage", e); }
    built = k; wake(1500);
    return true;
  }

  return { step, info: () => ({ ...info }), dispose() { gone = true; if (cur) { try { cur.dispose(); } catch (e) {} cur = null; } } };
}
