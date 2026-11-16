/* The story's damage on the city (made in the story lab on 31 October 2026, built into the map on 5 November): what lies on the ground. Part of the damage layer (city_damage.js).
   Decals: one instanced mesh of flat soft blots (scorch, dust, a ring of blast) laid just above the ground.
   Solids: one merged mesh, drawn with the same patched building program as the ruins (class 4 crater, 5 car, 6 car glass): craters, dead cars. */
import { rngOf } from "./city_dmg_tiles.js?v=ea5b0eae2a";

const DECAL_VERT = /* glsl */`
attribute vec4 iA;          // x, z, radius, rotation
attribute vec4 iB;          // kind (0 scorch, 1 dust, 2 blast ring, 3 soot patch), seed, alpha, stretch
varying vec2 vUv; varying vec4 vB; varying vec3 vPos;
void main() {
  float c = cos(iA.w), s = sin(iA.w);
  vec2 q = position.xy * 2.0; q.x *= iB.w;
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iA.z;
  vec3 wp = vec3(iA.x + r.x, 0.22, iA.y + r.y);
  vUv = position.xy * 2.0; vB = iB; vPos = wp;
  gl_Position = projectionMatrix * (viewMatrix * vec4(wp, 1.0));
}`;
const DECAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vB; varying vec3 vPos;
uniform float uMixD;
\${COMMON}
void main() {
  vec2 p = vUv; float r = length(p); if (r >= 1.0) discard;
  float seed = vB.y, kind = vB.x;
  vec2 q = p * 2.2 + seed * 31.0;
#ifdef DMG_LOW
  float n = vn(q * 1.4);      // phones and the low tier: one octave (6 November: the decals were about 2 ms of a phone-density frame)
#else
  float n = vn(q) * 0.55 + vn(q * 2.1 + 5.0) * 0.30 + vn(q * 4.7 + 9.0) * 0.15;
#endif
  float fw = length(fwidth(vPos.xz));
  float shape = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.85);
  vec3 col; float a;
  vec3 up = uUpDay;
  if (kind < 0.5) { col = vec3(0.022, 0.018, 0.016); a = shape * 0.86; }
  else if (kind < 1.5) {
#ifdef DMG_LOW
    float sp = vnAA(vPos.xz, 0.55, fw);
#else
    float sp = vnAA(vPos.xz, 0.55, fw) * 0.5 + vnAA(vPos.xz + 13.0, 0.17, fw) * 0.5;
#endif
    col = mix(vec3(0.40, 0.37, 0.33), vec3(0.20, 0.18, 0.16), smoothstep(0.40, 0.70, sp)) * up;
    a = shape * 0.55 * (0.45 + 0.8 * n);
  }
  else if (kind < 2.5) {
    float ang = atan(p.y, p.x), st = vn(vec2(ang * 5.0, seed * 9.0)) * 0.7 + vn(vec2(ang * 19.0, seed * 3.0)) * 0.3;
    float ring = (1.0 - smoothstep(0.0, 0.9, abs(r - 0.55) / 0.5)) * (0.3 + 0.7 * st) + smoothstep(0.6, 0.0, r) * 0.7;
    col = vec3(0.018, 0.015, 0.013); a = ring * shape * 0.9;
  } else { col = vec3(0.045, 0.040, 0.036) * (0.6 + 0.8 * n); a = shape * 0.55; }
  a *= vB.z;
  float dist = length(vPos - cameraPosition);
  gl_FragColor = vec4(applyFog(col, vPos), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createDecor(THREE, cx) {
  const { api, dbg, U, scene, S, dmat, plan, fp, city, level, field, preset, fires, seed, phone } = cx;
  const rnd = rngOf((seed || 11) * 31 + 7);
  const out = { disposers: [], stats: {} };
  const fill = (s) => s.replace("${COMMON}", S.COMMON).replace("precision highp float;", phone ? "precision highp float;\n#define DMG_LOW" : "precision highp float;");
  const bld = city.bld;

  // ---------- decals ----------
  const D = [];   // x, z, radius, rot, kind, seed, alpha, stretch
  const add = (x, z, r, kind, alpha, stretch = 1) => D.push([x, z, r, rnd() * 6.28, kind, rnd(), alpha, stretch]);
  for (const i of plan.order) {
    const m = plan.mode[i]; if (!m) continue;
    const cxx = fp.cx[i], czz = -fp.cn[i], R = Math.sqrt(fp.area[i]) * 0.5 + 6;
    if (m === 2) { add(cxx, czz, R * 1.55, 1, 0.9); add(cxx, czz, R * 1.1, 3, 0.55); }
    else if (m === 1) { add(cxx, czz, R * 1.3, 1, 0.6); if (rnd() < 0.5) add(cxx, czz, R * 1.0, 3, 0.5); }
    else if (m === 3) { if (rnd() < 0.5) add(cxx + (rnd() - 0.5) * 8, czz + (rnd() - 0.5) * 8, R * 1.2, 3, 0.4); }
    if (plan.fire[i]) add(cxx, czz, R * 1.6, 0, 0.8);
  }
  for (const f of fires) { if (f.noFlame) continue; add(f.x, f.z, f.w * 1.8 + 6, 0, f.kind === "ruin" ? 0.5 : 0.85); }
  const craters = (preset.craters || []).filter((c) => level >= c.min);
  for (const c of craters) { add(c.x, -c.n, c.R * 3.4, 2, 1.0); add(c.x, -c.n, c.R * 2.4, 1, 0.55); }
  // a wide pall of dust and ash on the ground round each site, the more the further the story has gone
  for (const s of plan.sites || []) { if (level < (s.min || 1)) continue; for (let j = 0; j < 4; j++) add(s.x + (rnd() - 0.5) * s.r, -(s.n + (rnd() - 0.5) * s.r), s.r * (0.7 + 0.5 * rnd()), 1, 0.30 + 0.15 * rnd(), 1.0 + 0.5 * rnd()); }
  if (D.length) {
    const mat = dbg.mk(fill(DECAL_VERT), fill(DECAL_FRAG), { uMixD: U.uMix }, { transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const quad = new THREE.PlaneGeometry(1, 1); const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute("position", quad.attributes.position);
    const A = new Float32Array(D.length * 4), B = new Float32Array(D.length * 4);
    D.forEach((d, i) => { A.set([d[0], d[1], d[2], d[3]], i * 4); B.set([d[4], d[5], d[6], d[7]], i * 4); });
    g.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 4)); g.instanceCount = D.length;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = -25; scene.add(m);
    out.disposers.push(() => { scene.remove(m); g.dispose(); const k = dbg.disposables.indexOf(mat); if (k >= 0) dbg.disposables.splice(k, 1); mat.dispose(); });
    out.decals = D.length;
  }

  // ---------- solids: craters and cars ----------
  const P = [], M = [], A2 = [], I = [];
  const V = (x, y, z, soot, tone, ember, cls) => { P.push(x, y, z); A2.push(Math.round(Math.min(1, soot) * 255), Math.round(tone * 255), Math.round(ember * 255), cls * 32); return P.length / 3 - 1; };
  const tri = (a, b, c) => I.push(a, b, c);
  const triUp = (a, b, c) => { const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], ux = P[b * 3] - ax, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vz = P[c * 3 + 2] - az; if (uz * vx - ux * vz >= 0) tri(a, b, c); else tri(a, c, b); };
  const triOut = (a, b, c, cx0, cy0, cz0) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, mx = (ax + P[b * 3] + P[c * 3]) / 3 - cx0, my = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - cy0, mz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - cz0;
    if (nx * mx + ny * my + nz * mz >= 0) tri(a, b, c); else tri(a, c, b);
  };
  // a crater: a pit floor, a raised rim of thrown earth and slab, a ragged edge
  const crater = (x, z, R, ember) => {
    const N = 28, rings = [[0.14, 0.10, 1], [0.40, 0.14, 1], [0.6, 0.35, 0.8], [0.74, 1.0, 0.5], [0.88, 0.55, 0.3], [1.0, 0.0, 0.1]], rh = 1.1 + R * 0.09, ids = [];
    const phase = rnd() * 6.28;
    for (let r = 0; r < rings.length; r++) {
      const row = [];
      for (let k = 0; k < N; k++) {
        const a = k / N * 6.2832, jr = 1 + 0.16 * Math.sin(a * 3 + phase) + 0.10 * Math.sin(a * 7 + phase * 2) + (r > 2 ? (rnd() - 0.5) * 0.18 : 0);
        const rr = rings[r][0] * R * jr, h = rings[r][1] * rh * (0.75 + 0.5 * rnd()) * (1 + 0.25 * Math.sin(a * 2 + phase));
        row.push(V(x + Math.cos(a) * rr, Math.max(0.05, h) + (r === 0 ? 0.0 : 0), z + Math.sin(a) * rr, rings[r][2], 0.5 + rnd() * 0.3, r < 3 ? ember : 0, 4));
      }
      ids.push(row);
    }
    // the centre of the pit
    const c0 = V(x, 0.06, z, 1, 0.5, ember, 4);
    for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; triUp(c0, ids[0][k], ids[0][k2]); for (let r = 0; r + 1 < rings.length; r++) { triUp(ids[r][k], ids[r][k2], ids[r + 1][k2]); triUp(ids[r][k], ids[r + 1][k2], ids[r + 1][k]); } }
  };
  for (const c of craters) crater(c.x, -c.n, c.R, 0.8);
  // chunks thrown out of a crater (boxes)
  const box = (cx0, cy0, cz0, sx, sy, sz, yaw, tilt, cls, soot, tone) => {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), vs = [];
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) for (let c = -1; c <= 1; c += 2) {
      let x = a * sx / 2, y = b * sy / 2, z = c * sz / 2; const y1 = y * ct - z * st, z1 = y * st + z * ct; y = y1; z = z1;
      vs.push(V(cx0 + x * cyw + z * syw, Math.max(0.02, cy0 + y), cz0 - x * syw + z * cyw, soot, tone, 0, cls));
    }
    for (const fq of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) { triOut(vs[fq[0]], vs[fq[1]], vs[fq[2]], cx0, cy0, cz0); triOut(vs[fq[0]], vs[fq[2]], vs[fq[3]], cx0, cy0, cz0); }
  };
  for (const c of craters) for (let j = 0; j < 8 + c.R; j++) { const a = rnd() * 6.28, d = c.R * (0.55 + 0.8 * rnd()), s = 0.5 + 1.6 * Math.pow(rnd(), 1.5); box(c.x + Math.cos(a) * d, s * 0.25, -c.n + Math.sin(a) * d, s * 1.2, s * 0.7, s, rnd() * 6.28, (rnd() - 0.5) * 0.9, 1, 0.5, rnd()); }
  // cars
  let nCars = 0;
  const lanes = [];
  for (const l of city.roads) { if (l.k > 4) continue; lanes.push(l); }
  const ROADW = [20, 18, 15, 12, 9, 6.6, 5, 3.4];
  const wantCars = [0, 26, 90, 90][level] || 0;
  const car = (x, z, yaw, soot, tone) => {
    const L = 4.3 + rnd() * 0.5, W = 1.8, cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const P2 = (lx, y, lz, cls) => V(x + lx * cyw + lz * syw, y, z - lx * syw + lz * cyw, soot, tone, 0, cls);
    const hx = L / 2, hz = W / 2;
    // body: low box with a sloped hood and boot; cabin: a smaller box with raked glass
    const b = [P2(-hx, 0.28, -hz, 5), P2(hx, 0.28, -hz, 5), P2(hx, 0.28, hz, 5), P2(-hx, 0.28, hz, 5), P2(-hx, 0.86, -hz, 5), P2(hx, 0.82, -hz, 5), P2(hx, 0.82, hz, 5), P2(-hx, 0.86, hz, 5)];
    const cz = hz * 0.88, c0 = -hx * 0.42, c1 = hx * 0.30, c2 = -hx * 0.22, c3 = hx * 0.10;
    const c = [P2(c0, 0.84, -cz, 5), P2(c1, 0.84, -cz, 5), P2(c1, 0.84, cz, 5), P2(c0, 0.84, cz, 5), P2(c2, 1.42, -cz * 0.92, 5), P2(c3, 1.42, -cz * 0.92, 5), P2(c3, 1.42, cz * 0.92, 5), P2(c2, 1.42, cz * 0.92, 5)];
    const q = (a, b2, c2_, d, cx0, cy0, cz0) => { triOut(a, b2, c2_, cx0, cy0, cz0); triOut(a, c2_, d, cx0, cy0, cz0); };
    q(b[0], b[1], b[5], b[4], x, 0.55, z); q(b[1], b[2], b[6], b[5], x, 0.55, z); q(b[2], b[3], b[7], b[6], x, 0.55, z); q(b[3], b[0], b[4], b[7], x, 0.55, z); q(b[4], b[5], b[6], b[7], x, 0.55, z);
    // cabin sides and roof as body, glass on the raked faces (own vertices: glass class)
    const g = (lx, y, lz) => P2(lx, y, lz, 6);
    const gl = [g(c0, 0.84, -cz), g(c1, 0.84, -cz), g(c3, 1.42, -cz * 0.92), g(c2, 1.42, -cz * 0.92)], gr = [g(c0, 0.84, cz), g(c1, 0.84, cz), g(c3, 1.42, cz * 0.92), g(c2, 1.42, cz * 0.92)];
    q(gl[0], gl[1], gl[2], gl[3], x, 1.1, z); q(gr[0], gr[1], gr[2], gr[3], x, 1.1, z);
    q(c[4], c[5], c[6], c[7], x, 1.1, z);
    const gf = [g(c1, 0.84, -cz), g(c1, 0.84, cz), g(c3, 1.42, cz * 0.92), g(c3, 1.42, -cz * 0.92)], gb = [g(c0, 0.84, -cz), g(c0, 0.84, cz), g(c2, 1.42, cz * 0.92), g(c2, 1.42, -cz * 0.92)];
    q(gf[0], gf[1], gf[2], gf[3], x, 1.1, z); q(gb[0], gb[1], gb[2], gb[3], x, 1.1, z);
    nCars++;
  };
    for (const l of lanes) {
    const pts = l.pts, w = (ROADW[l.k] || 8);
    let carry = rnd() * 14;
    for (let i = 0; i + 1 < pts.length / 2; i++) {
      const ax = pts[i * 2], an = pts[i * 2 + 1], bx = pts[i * 2 + 2], bn = pts[i * 2 + 3], L = Math.hypot(bx - ax, bn - an); if (L < 1) continue;
      const dx = (bx - ax) / L, dn = (bn - an) / L;
      for (let s = carry; s < L; s += 9 + rnd() * 16) {
        const x = ax + dx * s, n = an + dn * s, f = field(x, n);
        if (nCars >= wantCars) break;
        if (rnd() > f * f * 0.55 * (level === 1 ? 0.6 : 1)) continue;
        const side = rnd() < 0.5 ? -1 : 1, off = side * w * (0.12 + 0.25 * rnd());
        const px = x - dn * off, pn = n + dx * off, yaw = Math.atan2(-dn, dx) + (rnd() < 0.2 ? (rnd() - 0.5) * 2.4 : (rnd() - 0.5) * 0.25) + (rnd() < 0.5 ? 0 : Math.PI);
        car(px, -pn, yaw, rnd() < 0.18 ? 0.9 : rnd() < 0.3 ? 0.35 : 0, rnd());
      }
      carry = 0;
    }
  }
  // the dead cars at the junction (Chapter 7)
  for (const jn of preset.carClusters || []) { if (level < (jn.min || 1)) continue; for (let j = 0; j < jn.c; j++) { const a = rnd() * 6.28, d = 4 + rnd() * jn.r; car(jn.x + Math.cos(a) * d, -jn.n + Math.sin(a) * d, rnd() * 6.28, rnd() < 0.3 ? 0.95 : rnd() < 0.5 ? 0.3 : 0, rnd()); } }
  if (P.length) {
    const g = new THREE.BufferGeometry(), nv = P.length / 3;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("aU", new THREE.BufferAttribute(new Float32Array(nv), 1));
    g.setAttribute("aM", new THREE.BufferAttribute(new Uint16Array(nv * 4), 4));
    g.setAttribute("aD", new THREE.BufferAttribute(new Uint8Array(A2), 4, true));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
    const m = new THREE.Mesh(g, dmat); m.frustumCulled = false; m.renderOrder = -59; scene.add(m);
    out.disposers.push(() => { scene.remove(m); g.dispose(); });
    out.mesh = m;
  }
  // the generators' lights: a warm-white point or two at the foot of each lit building (the city's own lamp shader)
  const GP = [];
  for (let i = 0; i < bld.n; i++) { if (!plan.gen[i]) continue; const H = bld.h[i] / 2; GP.push(fp.cx[i], 3.0, -fp.cn[i]); if (H > 14) GP.push(fp.cx[i] + 3, Math.min(H, 40) * 0.6, -fp.cn[i] - 3); }
  if (GP.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(GP), 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(GP.length / 3).map((_, k) => 0.4 + 0.6 * ((k * 0.618) % 1)), 1));
    const m = new THREE.Points(g, dbg.mk(S.LAMP_VERT, S.LAMP_FRAG, { uScale: { value: 5200 }, uGain: { value: 1.6 } }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.frustumCulled = false; m.renderOrder = 22; scene.add(m);
    const mat = m.material;
    out.disposers.push(() => { scene.remove(m); g.dispose(); const k = dbg.disposables.indexOf(mat); if (k >= 0) dbg.disposables.splice(k, 1); mat.dispose(); });
    out.generators = GP.length / 3;
  }
  out.stats = { generators: GP.length / 3, decals: D.length, tris: I.length / 3, cars: nCars, craters: craters.length };
  out.dispose = () => { for (const f of out.disposers.splice(0).reverse()) { try { f(); } catch (e) { console.warn(e); } } };
  return out;
}
