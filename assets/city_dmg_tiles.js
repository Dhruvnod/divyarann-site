/* The story's damage on the city (made in the story lab on 31 October 2026, built into the map on 5 November): which of the city's buildings are hurt, and the geometry of a hurt building. Part of the damage layer (city_damage.js).
   A tile is rebuilt from the same footprints city_data.js reads (tileSteps), with the same vertex layout, so the city's own program draws it; the lab adds a fourth attribute (aD: soot, tone, a
   generator's light, and the kind of surface) which a patched copy of the program reads.
   mode 1: broken top (a corner or a side of the building has come down; ragged walls, a heap on the broken floor, a slab hanging off)
   mode 2: collapsed (stubs of wall, a heap that spills across the pavement, chunks and slabs)
   mode 3: gutted (stands, soot above every window, no light; "most of the glass had already gone") */

export const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* the damage field: strongest round the tear, leaning towards `lean` (the book's smoke covers the east), thinning with distance */
export function fieldOf(tear, lean, scale = 1) {
  const L = Math.hypot(lean[0], lean[1]) || 1, lx = lean[0] / L, ln = lean[1] / L;
  return (x, n) => {
    const dx = x - tear.x, dn = n - tear.n;
    const along = dx * lx + dn * ln, across = -dx * ln + dn * lx;
    const core = Math.exp(-(dx * dx + dn * dn) / (2 * 520 * 520 * scale * scale));
    const a = (along - 1000 * scale) / (1250 * scale), b = across / (760 * scale);
    const lobe = Math.exp(-(a * a + b * b) / 2);
    return Math.max(core * 0.85, lobe);
  };
}

/* centroid, area and bounding size of every building (local metres) */
export function footprints(city) {
  const { bld } = city, q = bld.bq, n = bld.n;
  const cx = new Float32Array(n), cn = new Float32Array(n), area = new Float32Array(n), size = new Float32Array(n), star = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s0 = bld.start[i], m = bld.start[i + 1] - s0;
    if (m < 3) continue;
    let a = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < m; k++) {
      const x = bld.ring[(s0 + k) * 2] / q, y = bld.ring[(s0 + k) * 2 + 1] / q, k2 = (k + 1) % m, X = bld.ring[(s0 + k2) * 2] / q, Y = bld.ring[(s0 + k2) * 2 + 1] / q;
      const c = x * Y - X * y; a += c; sx += (x + X) * c; sy += (y + Y) * c;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    area[i] = Math.abs(a) / 2; size[i] = Math.max(x1 - x0, y1 - y0);
    if (Math.abs(a) > 1e-6) { cx[i] = sx / (3 * a); cn[i] = sy / (3 * a); } else { cx[i] = (x0 + x1) / 2; cn[i] = (y0 + y1) / 2; }
    // star-shaped about its centroid (so a heap can be fanned from the middle)
    let st = 1, sg = 0;
    for (let k = 0; k < m && st; k++) { const x = bld.ring[(s0 + k) * 2] / q - cx[i], y = bld.ring[(s0 + k) * 2 + 1] / q - cn[i], k2 = (k + 1) % m, X = bld.ring[(s0 + k2) * 2] / q - cx[i], Y = bld.ring[(s0 + k2) * 2 + 1] / q - cn[i], c = x * Y - X * y; if (Math.abs(c) < 1e-6) continue; if (!sg) sg = Math.sign(c); else if (Math.sign(c) !== sg) st = 0; }
    star[i] = st;
  }
  return { cx, cn, area, size, star };
}

/* the plan: which building is hurt how. Damage comes in sites (where something fell or was struck): a block is flattened round the site's middle and the damage thins with distance, then the ranking
   is the same at every level (a building that fell at level 1 is still down at level 2); more of the ranking is taken, and the sites grow, as the story goes on. */
export function planDamage(city, fp, ctx) {
  const { bld } = city, n = bld.n, rnd = rngOf(ctx.seed || 11), rnd2 = rngOf((ctx.seed || 11) * 7 + 5);
  const field = ctx.field, level = ctx.level || 1;
  const score = new Float32Array(n), mode = new Uint8Array(n), gen = new Uint8Array(n), dirA = new Float32Array(n), soot = new Float32Array(n);
  const ok = (i) => fp.area[i] >= 45 && bld.h[i] >= 7;
  const near = (x, nn, r) => { let best = -1, bd = 1e12; for (let i = 0; i < n; i++) { if (!ok(i) || fp.area[i] < 60) continue; const d = (fp.cx[i] - x) ** 2 + (fp.cn[i] - nn) ** 2; if (d < bd) { bd = d; best = i; } } return bd < r * r ? best : -1; };
  // sites: the heroes first (the book's places), then drawn at random from the field, the same draw at every level (a prefix)
  const sites = [];
  for (const h of ctx.heroes || []) sites.push({ x: h.x, n: h.n, r: h.r || 60, w: h.w == null ? 1 : h.w, min: h.min || 1 });
  const cand = []; for (let i = 0; i < n; i++) if (ok(i)) cand.push(i);
  const nSites = ctx.sites == null ? [0, 5, 18, 18][level] : ctx.sites;
  let guard = 0;
  while (sites.length < (ctx.heroes || []).length + nSites && guard++ < 4000) {
    const i = cand[Math.floor(rnd2() * cand.length)], f = field(fp.cx[i], fp.cn[i]);
    if (rnd2() > f * f) continue;
    sites.push({ x: fp.cx[i], n: fp.cn[i], r: (28 + 62 * rnd2()) * (0.55 + 0.7 * f), w: 0.55 + 0.45 * f, min: 1 });
  }
  const grow = [0, 0.7, 1.15, 1.15][level];
  const idx = [];
  for (let i = 0; i < n; i++) {
    dirA[i] = rnd() * 6.2832;
    if (!ok(i)) continue;
    let sc = 0;
    for (const s of sites) { if (level < s.min) continue; const d = Math.hypot(fp.cx[i] - s.x, fp.cn[i] - s.n) / (s.r * grow); if (d < 2.2) sc = Math.max(sc, s.w * Math.exp(-d * d)); }
    sc = sc * (0.45 + 0.55 * rnd()) + 0.12 * field(fp.cx[i], fp.cn[i]) * rnd();
    // a place the author keeps whole (Samar Chemicals does not burn): never hurt, never on fire (scored last, so the rest of the ranking is unchanged)
    for (const s of ctx.spare || []) if (Math.hypot(fp.cx[i] - s.x, fp.cn[i] - s.n) < (s.r || 30)) sc = 0;
    // a long or ragged footprint is gutted, not flattened
    score[i] = sc * (0.7 + 0.3 * Math.min(1, fp.area[i] / 300));
    idx.push(i);
  }
  idx.sort((a, b) => score[b] - score[a]);
  const [np, nb, ns] = ctx.counts;
  let k = 0;
  const compact = (i) => fp.star[i] && fp.size[i] < 62 && fp.area[i] < 2600;
  const take = (cnt, f) => { let c = 0; for (; k < idx.length && c < cnt; k++) { const i = idx[k]; if (score[i] < 0.03) { k = idx.length; break; } f(i); c++; } };
  take(np, (i) => { if (compact(i)) { mode[i] = bld.h[i] / 2 > 38 ? 1 : 2; soot[i] = 0.75 + 0.25 * rnd(); } else { mode[i] = 3; soot[i] = 0.7 + 0.3 * rnd(); } });
  take(nb, (i) => { if (compact(i)) { mode[i] = 1; soot[i] = 0.55 + 0.4 * rnd(); } else { mode[i] = 3; soot[i] = 0.6 + 0.35 * rnd(); } });
  take(ns, (i) => { mode[i] = 3; soot[i] = 0.55 + 0.45 * rnd(); });
  for (const f of ctx.gutted || []) { const i = near(f.x, f.n, f.r || 80); if (i >= 0) { mode[i] = 3; soot[i] = 0.9; } }
  // the ruins that still burn: the best-ranked, so the fires lean east with the damage
  const fire = new Uint8Array(n), fireY = new Float32Array(n);
  { let c = 0; for (const i of idx) { if (c >= (ctx.burning || 0)) break; if (mode[i] === 1 || mode[i] === 2) { fire[i] = 1; c++; } } }
  // the lit buildings: a generator. Taller, apart from the ruin.
  for (const g of ctx.generators || []) { const i = near(g.x, g.n, 260); if (i >= 0 && mode[i] === 0) gen[i] = 1; }
  const far = idx.filter((i) => score[i] < 0.02 && bld.h[i] / 2 > 14 && fp.area[i] > 180);
  for (let j = 0; j < (ctx.randomGenerators || 0) && far.length; j++) { const i = far[Math.floor(rnd() * far.length)]; if (mode[i] === 0) gen[i] = 1; }
  return { mode, gen, dirA, soot, score, order: idx, fire, fireY, sites };
}

/* ---------- one tile ---------- */
export function buildTile(D, city, b0, count, plan, fp, ctx) {
  const { bld } = city, q = bld.bq, { POS_Q, U_Q, hash1 } = D;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false, hit = false;
  for (let i = b0; i < b0 + count; i++) {
    const s0 = bld.start[i], n = bld.start[i + 1] - s0; if (n > 64 || n < 3) continue;
    any = true; if (plan.mode[i] || plan.gen[i]) hit = true;
    for (let k = 0; k < n; k++) { const x = bld.ring[(s0 + k) * 2] / q, y = bld.ring[(s0 + k) * 2 + 1] / q; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (!any) return { empty: true };
  if (!hit) return { empty: false, hit: false };
  const ox = Math.round((x0 + x1) / 2), oy = Math.round((y0 + y1) / 2), half = Math.max(x1 - x0, y1 - y0) / 2 + 16;
  const PQ = half * POS_Q < 32000 ? POS_Q : half * 20 < 32000 ? 20 : 10;
  const P = [], M = [], A = [], idx = [], lipIdx = [];
  let vp = 0, tris = 0;
  const put = (x, y, z, u, seed, code, l, ang, s, t, g, c) => {
    P.push(Math.round(x * PQ), Math.round(y * PQ), Math.round(z * PQ), u);
    M.push(seed, code, l, ang);
    A.push(Math.round(clamp(s, 0, 1) * 255), Math.round(clamp(t, 0, 1) * 255), Math.round(clamp(g, 0, 1) * 255), c * 32);
    return vp++;
  };
  const px = (v) => P[v * 4] / PQ, py = (v) => P[v * 4 + 1] / PQ, pz = (v) => P[v * 4 + 2] / PQ;
  const tri = (a, b, c) => { idx.push(a, b, c); tris++; };
  const triUp = (a, b, c) => {
    const ux = px(b) - px(a), uy = py(b) - py(a), uz = pz(b) - pz(a), vx = px(c) - px(a), vy = py(c) - py(a), vz = pz(c) - pz(a);
    const ny = uz * vx - ux * vz;
    if (ny >= 0) tri(a, b, c); else tri(a, c, b);
  };
  const triOut = (a, b, c, cx, cy, cz) => {
    const ax = px(a), ay = py(a), az = pz(a), ux = px(b) - ax, uy = py(b) - ay, uz = pz(b) - az, vx = px(c) - ax, vy = py(c) - ay, vz = pz(c) - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (ax + px(b) + px(c)) / 3 - cx, my = (ay + py(b) + py(c)) / 3 - cy, mz = (az + pz(b) + pz(c)) / 3 - cz;
    if (nx * mx + ny * my + nz * mz >= 0) tri(a, b, c); else tri(a, c, b);
  };
  const xs = new Float64Array(64), ys = new Float64Array(64), ex = new Float64Array(64), ey = new Float64Array(64), el = new Float64Array(64);
  const hidx = [];     // the buildings of this tile that were hurt (for the fires)
  const out = { fires: [], tris: 0, hurt: 0 };

  for (let i = b0; i < b0 + count; i++) {
    const s0 = bld.start[i], n = bld.start[i + 1] - s0;
    if (n > 64 || n < 3) continue;
    for (let k = 0; k < n; k++) { xs[k] = bld.ring[(s0 + k) * 2] / q; ys[k] = bld.ring[(s0 + k) * 2 + 1] / q; }
    const H2 = Math.min(255, bld.h[i]), H = H2 / 2, kd = bld.kind[i] & 15, seed = Math.floor(hash1(i * 7 + 3) * 65536) & 65535, code = H2 + 256 * kd;
    const mode = plan.mode[i], soot = plan.soot[i], gen = plan.gen[i];
    for (let k = 0; k < n; k++) { const k2 = k + 1 === n ? 0 : k + 1, dx = xs[k2] - xs[k], dy = ys[k2] - ys[k], L = Math.hypot(dx, dy) || 1e-6; ex[k] = dy / L; ey[k] = -dx / L; el[k] = L; }
    const angOf = (nx, nn) => Math.round((nx + 1) * 127.5) * 256 + Math.round((1 - nn) * 127.5);
    const rnd = rngOf(i * 977 + (ctx.seed || 11));
    const tone = rnd();

    if (mode === 0 || mode === 3) {
      // a building as it stands (a gutted one with soot, a generator's with a light): the city's own layout
      const sootV = mode === 3 ? soot : 0;
      const lx = (k) => xs[k] - ox, lz = (k) => oy - ys[k], qH = H;
      for (let k = 0; k < n; k++) {
        const k2 = k + 1 === n ? 0 : k + 1, ang = angOf(ex[k], ey[k]), Lq = Math.min(65535, Math.round(el[k] * U_Q)), uq = Math.min(32767, Lq);
        const v0 = put(lx(k), 0, lz(k), 0, seed, code, Lq, ang, sootV, tone, gen, 0), v1 = put(lx(k2), 0, lz(k2), uq, seed, code, Lq, ang, sootV, tone, gen, 0);
        const v2 = put(lx(k2), qH, lz(k2), uq, seed, code, Lq, ang, sootV, tone, gen, 0), v3 = put(lx(k), qH, lz(k), 0, seed, code, Lq, ang, sootV, tone, gen, 0);
        tri(v0, v1, v2); tri(v0, v2, v3);
      }
      const r0 = vp, rc = code + 4096, lc = code + 8192, lH = qH + 0.12;
      for (let k = 0; k < n; k++) put(lx(k), qH, lz(k), 0, seed, rc, 0, 0, sootV * 0.8, tone, gen, 0);
      const o0 = vp;
      for (let k = 0; k < n; k++) {
        const kp = k === 0 ? n - 1 : k - 1, ax = ex[kp], ay = ey[kp];
        let mx = ax + ex[k], my = ay + ey[k]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
        const d = 0.55 / Math.max(0.45, mx * ax + my * ay);
        put(lx(k) + mx * d, lH, lz(k) - my * d, 0, seed, lc, 0, 0, sootV, tone, gen, 0);
      }
      for (let k = 0; k < n; k++) { const k2 = k + 1 === n ? 0 : k + 1; lipIdx.push(r0 + k, r0 + k2, o0 + k2, r0 + k, o0 + k2, o0 + k); }
      const tr = D.triangulate(xs.subarray(0, n), ys.subarray(0, n), n);
      if (tr) for (const t of tr) idx.push(r0 + t);
      if (mode === 3) { out.hurt++; hidx.push(i); }
      continue;
    }

    // ---- a ruin ----
    out.hurt++; hidx.push(i);
    const area = fp.area[i], cxl = fp.cx[i] - ox, czl = oy - fp.cn[i];
    // the footprint in local metres (x, z), and which way round it is
    const lxs = [], lzs = [];
    for (let k = 0; k < n; k++) { lxs.push(xs[k] - ox); lzs.push(oy - ys[k]); }
    // the break
    const dA = plan.dirA[i], dxA = Math.cos(dA), dzA = Math.sin(dA);
    let Rext = 3; for (let k = 0; k < n; k++) Rext = Math.max(Rext, Math.abs((lxs[k] - cxl) * dxA + (lzs[k] - czl) * dzA));
    const f = mode === 1 ? clamp(0.38 + 0.45 * rnd(), 0.35, 0.85) : 1;
    const stub = clamp(0.7 + 2.0 * rnd(), 0.5, H * 0.3);
    const frags = [];
    if (mode === 2) { const nf = 1 + Math.floor(rnd() * 3); for (let j = 0; j < nf; j++) { const k = Math.floor(rnd() * n); frags.push({ x: lxs[k], z: lzs[k], r: 2.8 + 3.4 * rnd(), h: Math.min(H * (0.28 + 0.3 * rnd()), 15) }); } }
    const noise2 = (x, z) => { const a = Math.sin(x * 0.91 + i) * Math.sin(z * 1.07 + i * 0.7), b = Math.sin(x * 2.3 + z * 1.7 + i * 2.1); return 0.5 + 0.28 * a + 0.22 * b; };
    const hp = (x, z) => {
      if (mode === 1) {
        const s = ((x - cxl) * dxA + (z - czl) * dzA) / Rext;
        return Math.max(1.4, H * (1 - f * sstep(-0.55, 0.7, s)) * (0.9 + 0.1 * noise2(x * 1.6, z * 1.6)));
      }
      let h = stub * (0.55 + 0.9 * noise2(x * 1.3, z * 1.3));
      for (const fr of frags) { const d = Math.hypot(x - fr.x, z - fr.z); h = Math.max(h, fr.h * sstep(fr.r, fr.r * 0.35, d) * (0.85 + 0.3 * noise2(x * 2, z * 2))); }
      return h;
    };
    const L0 = mode === 1 ? Math.max(1.8, H * (1 - f) * (0.88 + 0.2 * rnd())) : clamp(stub * 1.15 + 0.6, 1.4, 4.2);
    const rise = mode === 1 ? clamp(H * 0.10, 1.2, 4.5) * (0.8 + 0.5 * rnd()) : clamp(1.6 + Math.sqrt(area) * 0.16 + H * 0.05, 2.0, 7.5) * (0.8 + 0.5 * rnd());
    const sootV = soot;
    const wallsInfo = [];

    for (let k = 0; k < n; k++) {
      const k2 = k + 1 === n ? 0 : k + 1, L = el[k], ang = angOf(ex[k], ey[k]), angIn = angOf(-ex[k], -ey[k]), Lq = Math.min(65535, Math.round(L * U_Q));
      const ax = lxs[k], az = lzs[k], bx = lxs[k2], bz = lzs[k2], ux = (bx - ax) / L, uz = (bz - az) / L, nxl = ex[k], nzl = -ey[k];
      const notch = rnd() < (mode === 2 ? 0.7 : 0.45) && L > 6 ? { a: (0.12 + 0.5 * rnd()) * L, w: (0.18 + 0.22 * rnd()) * L, depth: 0.45 + 0.5 * rnd() } : null;
      const topAt = (s) => {
        const t = s / L; let h = hp(ax + (bx - ax) * t, az + (bz - az) * t);
        if (notch && s > notch.a && s < notch.a + notch.w) h = Math.max(1.0, h * (1 - notch.depth));
        return h;
      };
      const m = Math.max(2, Math.round(L / 3.2)), ents = [];
      for (let j = 0; j <= m; j++) {
        let s = L * j / m; if (j > 0 && j < m) s += (rnd() - 0.5) * (L / m) * 0.7;
        const jag = 1 - 0.20 * rnd() * (mode === 1 ? 0.7 : 1);
        if (j > 0 && j < m && rnd() < 0.34) { ents.push({ s, h: Math.max(0.8, topAt(s - 0.02) * (1 - 0.3 * rnd())) }, { s, h: Math.max(0.8, topAt(s + 0.02) * jag) }); }
        else ents.push({ s, h: Math.max(0.8, topAt(s) * jag) });
      }
      if (notch) {   // vertical edges at the notch
        for (const sNotch of [notch.a, notch.a + notch.w]) {
          let pos = ents.findIndex((e) => e.s > sNotch); if (pos < 0) pos = ents.length - 1;
          const hIn = Math.max(1.0, topAt(sNotch + (sNotch === notch.a ? 0.05 : -0.05))), hOut = Math.max(0.8, topAt(sNotch + (sNotch === notch.a ? -0.05 : 0.05)));
          ents.splice(pos, 0, { s: sNotch, h: sNotch === notch.a ? hOut : hIn }, { s: sNotch, h: sNotch === notch.a ? hIn : hOut });
        }
        ents.sort((p, r) => p.s - r.s || 0);
      }
      // outer face, inner face (the walls of a ruin are seen from both sides), a cap for the thickness
      const bot = [], top = [], botI = [], topI = [], capO = [], capI = [];
      for (const e of ents) {
        const wx = ax + ux * e.s, wz = az + uz * e.s, uq = Math.min(32767, Math.round(e.s * U_Q));
        bot.push(put(wx, 0, wz, uq, seed, code, Lq, ang, sootV, tone, 0, 0));
        top.push(put(wx, e.h, wz, uq, seed, code, Lq, ang, sootV, tone, 0, 0));
        botI.push(put(wx, 0, wz, uq, seed, code, Lq, angIn, 1, tone, 0, 3));
        topI.push(put(wx, e.h, wz, uq, seed, code, Lq, angIn, 1, tone, 0, 3));
        const th = 0.34;
        capO.push(put(wx, e.h, wz, 0, seed, code + 4096, 0, 0, sootV, tone, 0, 2));
        capI.push(put(wx - nxl * th, e.h - 0.02, wz - nzl * th, 0, seed, code + 4096, 0, 0, sootV, tone, 0, 2));
      }
      for (let j = 0; j + 1 < ents.length; j++) {
        if (ents[j + 1].s - ents[j].s < 1e-4) continue;
        tri(bot[j], bot[j + 1], top[j + 1]); tri(bot[j], top[j + 1], top[j]);
        tri(botI[j], topI[j + 1], botI[j + 1]); tri(botI[j], topI[j], topI[j + 1]);
        triUp(capO[j], capO[j + 1], capI[j + 1]); triUp(capO[j], capI[j + 1], capI[j]);
      }
      wallsInfo.push({ k, ents, ax, az, ux, uz, nxl, nzl, L, topAt });
    }

    // ---- the heap on the broken floor ----
    const B = [];   // boundary points (a point every 4.5 m at most) with the wall's top there
    for (const w of wallsInfo) { const m = Math.max(1, Math.ceil(w.L / 4.5)); for (let j = 0; j < m; j++) { const s = w.L * j / m; B.push({ x: w.ax + w.ux * s, z: w.az + w.uz * s, h: w.topAt(s), w, s }); } }
    let cxm = 0, czm = 0; for (const b of B) { cxm += b.x; czm += b.z; } cxm /= B.length; czm /= B.length;
    let star = true, sign = 0;
    for (let k = 0; k < B.length; k++) { const a = B[k], b = B[(k + 1) % B.length], c = (a.x - cxm) * (b.z - czm) - (a.z - czm) * (b.x - cxm); if (Math.abs(c) < 1e-6) continue; if (!sign) sign = Math.sign(c); else if (Math.sign(c) !== sign) { star = false; break; } }
    const toneV = tone;
    const hv = (x, y, z, em = 0) => put(x, y, z, 0, seed, code + 4096, 0, 0, sootV, toneV + 0.0, em, 1);
    const embers = plan.fire && plan.fire[i] ? 0.9 : 0.25 * rnd();
    if (star) {
      // rings from the wall's top inwards to an apex: each a little higher and more broken than the last
      const T = [1.0, 0.80, 0.60, 0.40, 0.2], rings = [];
      for (let r = 0; r < T.length; r++) {
        const row = [];
        for (const b of B) {
          if (r === 0) { const rim = Math.min(b.h - 0.05, L0 * (0.85 + 0.3 * rnd())); row.push(hv(b.x, Math.max(0.1, rim), b.z, embers)); continue; }
          const t = T[r] + 0.07 * (rnd() - 0.5), up = Math.pow(1 - T[r], 0.85);
          row.push(hv(cxm + (b.x - cxm) * t + (rnd() - 0.5) * 1.5, L0 + rise * (0.18 + 0.85 * up) * (0.65 + 0.7 * rnd()), czm + (b.z - czm) * t + (rnd() - 0.5) * 1.5, embers));
        }
        rings.push(row);
      }
      const apex = hv(cxm + (rnd() - 0.5) * 1.5, L0 + rise * (1.05 + 0.5 * rnd()), czm + (rnd() - 0.5) * 1.5, embers);
      for (let k = 0; k < B.length; k++) {
        const k2 = (k + 1) % B.length;
        for (let r = 0; r + 1 < rings.length; r++) { triUp(rings[r][k], rings[r][k2], rings[r + 1][k2]); triUp(rings[r][k], rings[r + 1][k2], rings[r + 1][k]); }
        triUp(rings[rings.length - 1][k], rings[rings.length - 1][k2], apex);
      }
    } else {
      const tr = D.triangulate(xs.subarray(0, n), ys.subarray(0, n), n), vv = [];
      for (let k = 0; k < n; k++) vv.push(hv(lxs[k], L0 + rise * (0.3 + 0.5 * rnd()), lzs[k], embers));
      if (tr) for (let t = 0; t + 2 < tr.length; t += 3) triUp(vv[tr[t]], vv[tr[t + 1]], vv[tr[t + 2]]);
    }

    // ---- spill across the pavement: a sloping apron against the walls that fell outward ----
    const spillWalls = mode === 2 ? wallsInfo : wallsInfo.filter(() => rnd() < 0.55);
    const sizeF = mode === 2 ? clamp(0.6 + H / 14, 0.8, 2.2) : clamp(f * H / 14, 0.5, 1.6);
    for (const w of spillWalls) {
      const m = Math.max(1, Math.ceil(w.L / 3.0)); let prevTop = -1, prevToe = -1;
      for (let j = 0; j <= m; j++) {
        const s = w.L * j / m, wx = w.ax + w.ux * s, wz = w.az + w.uz * s;
        const edge = Math.min(1, Math.min(j, m - j) / 1.5 + 0.25);
        const d = (1.2 + 4.8 * rnd()) * sizeF * edge, along = (rnd() - 0.5) * 1.2;
        const topH = Math.max(0.5, Math.min(w.topAt(s), L0 * 0.85) * (0.65 + 0.3 * rnd()));
        const top = hv(wx, topH, wz, 0), toe = hv(wx + w.nxl * d + w.ux * along, 0.06 + 0.3 * rnd(), wz + w.nzl * d + w.uz * along, 0);
        if (prevTop >= 0) { triUp(prevTop, prevToe, toe); triUp(prevTop, toe, top); }
        prevTop = top; prevToe = toe;
      }
    }

    // ---- chunks and slabs (boxes, jittered) ----
    const box = (cx, cy, cz, sx, sy, sz, yaw, tiltX, tiltZ, cls, jit) => {
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tiltX), st = Math.sin(tiltX), cz2 = Math.cos(tiltZ), sz2 = Math.sin(tiltZ), vs = [];
      for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) for (let c = -1; c <= 1; c += 2) {
        let x = a * sx / 2 * (1 + (rnd() - 0.5) * jit), y = b * sy / 2 * (1 + (rnd() - 0.5) * jit), z = c * sz / 2 * (1 + (rnd() - 0.5) * jit);
        let y1 = y * ct - z * st, z1 = y * st + z * ct; y = y1; z = z1;
        let x2 = x * cz2 - y * sz2, y2 = x * sz2 + y * cz2; x = x2; y = y2;
        const x3 = x * cyw + z * syw, z3 = -x * syw + z * cyw;
        vs.push(put(cx + x3, Math.max(0.03, cy + y), cz + z3, 0, seed, code + 4096, 0, 0, sootV, toneV, 0, cls));
      }
      const f4 = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
      for (const fq of f4) { triOut(vs[fq[0]], vs[fq[1]], vs[fq[2]], cx, cy, cz); triOut(vs[fq[0]], vs[fq[2]], vs[fq[3]], cx, cy, cz); }
    };
    const nChunks = mode === 2 ? Math.min(42, Math.round(8 + area / 14)) : Math.min(22, Math.round(4 + area / 28));
    for (let j = 0; j < nChunks; j++) {
      const t = rnd(), b = B[Math.floor(rnd() * B.length)], r = Math.sqrt(rnd());
      const onHeap = rnd() < 0.62;
      let x, z, y;
      if (onHeap) { x = cxm + (b.x - cxm) * r * 0.95; z = czm + (b.z - czm) * r * 0.95; y = L0 + rise * (1 - r * 0.8) * (0.7 + 0.5 * rnd()); }
      else { const w = b.w, d = (0.8 + 5.5 * rnd() * sizeF) * (0.4 + rnd()); x = b.x + w.nxl * d; z = b.z + w.nzl * d; y = 0.1; }
      const s = (0.5 + 1.7 * Math.pow(rnd(), 1.6)) * (mode === 2 ? 1.1 : 0.9);
      box(x, y + s * 0.2, z, s * (0.8 + 0.8 * rnd()), s * (0.5 + 0.6 * rnd()), s * (0.8 + 0.8 * rnd()), rnd() * 6.28, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, 1, 0.45);
    }
    const nSlab = mode === 1 ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3);
    for (let j = 0; j < nSlab; j++) {
      const b = B[Math.floor(rnd() * B.length)], w = b.w, w0 = 3.5 + rnd() * 4.5, w1 = 3 + rnd() * 3.5;
      const ang = Math.atan2(w.nzl, w.nxl), tilt = 0.35 + 0.5 * rnd();
      const topY = mode === 1 ? Math.max(1.5, b.h * 0.85) : Math.max(1.0, L0 + rise * 0.4);
      box(b.x + w.nxl * w0 * 0.5 * Math.cos(tilt), topY - Math.sin(tilt) * w0 * 0.5, b.z + w.nzl * w0 * 0.5 * Math.cos(tilt), w0, 0.32, w1, -ang, 0, -tilt, 2, 0.12);
    }
    if (plan.fireY) plan.fireY[i] = Math.max(plan.fireY[i], L0 + rise * 0.6);
  }

  // the lips last (a far tile is drawn without them)
  const ipMain = idx.length; for (const v of lipIdx) idx.push(v);
  let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
  for (let v = 0; v < vp; v++) { const x = P[v * 4], y = P[v * 4 + 1], z = P[v * 4 + 2]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, cz = (bz0 + bz1) / 2, r = Math.hypot(bx1 - bx0, by1 - by0, bz1 - bz0) / 2 + 2;
  return {
    empty: false, hit: true, pu: Int16Array.from(P), mt: Uint16Array.from(M), ad: Uint8Array.from(A), idx: Uint32Array.from(idx), vp, ip: idx.length, ipMain, o: [ox, -oy], q: PQ, bs: [cx, cy, cz, r], hurt: out.hurt, hidx, tris,
  };
}
