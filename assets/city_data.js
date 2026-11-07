/* The night city: reading the compact city file and turning it into geometry (proposal, 28 October 2026).
   dwarka.bin.gz is OpenStreetMap data (c) OpenStreetMap contributors, ODbL, quantised by osm/build_city.py (0.5 m): building footprints with a height and a kind, roads, the elevated metro, rail, parks and
   water, in local metres (x east, n north of the city's origin, 28.58 N 77.045 E for Dwarka). Nothing here is particular to one city. Everything here is pure data work: no WebGL.
   29 October (the seamless entry): this module has no static import, so the same file also runs as a module WORKER (city.js starts it with new Worker(this module's own address)): `prepare()` turns the
   gzipped file into every typed array the scene needs (decode, building tiles, roads, lamps, areas, the metro, the height field, the ground's density map) off the page's main thread, and hands them back
   without copying (transferred). Before this the same work ran on the main thread in 100 to 300 ms pieces (four times that on a slow CPU) and stalled the globe's dive while the city was being made.
   The one thing it needs from three.js is the polygon triangulator (ShapeUtils, earcut): city.js passes it in on the main thread (useShapeUtils); the worker imports three's core by the address the page's
   import map gives it (a worker has no import map). */
let ShapeUtils = null;
export function useShapeUtils(su) { ShapeUtils = su; }

/* `pre`: the response the page asked for early (app.js starts the download before this module has even loaded); used once, and the file is fetched here when it is missing or failed */
export async function fetchCity(url, signal, pre) {
  return decode(new Uint8Array(await fetchRaw(url, signal, pre)));
}
/* the file, unpacked (gzip), as an ArrayBuffer */
export async function fetchRaw(url, signal, pre) {
  let res = null;
  if (pre) { try { res = await pre; if (!res || !res.ok || res.bodyUsed) res = null; } catch (e) { res = null; } }
  if (!res) res = await fetch(url, { signal });
  if (!res.ok) throw new Error("city file " + res.status);
  if (typeof DecompressionStream === "function" && res.body) return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  throw new Error("no DecompressionStream");
}
/* the gzipped bytes as they came over the network (what the page hands the worker: a transfer, no copy) */
export async function fetchGz(url, signal, pre) {
  let res = null;
  if (pre) { try { res = await pre; if (!res || !res.ok || res.bodyUsed) res = null; } catch (e) { res = null; } }
  if (!res) res = await fetch(url, { signal });
  if (!res.ok) throw new Error("city file " + res.status);
  return res.arrayBuffer();
}
const gunzip = (gz) => new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();

/* ---------- decoding (LEB128 zigzag deltas) ---------- */
export function decode(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "DWK1") throw new Error("not a city file");
  let p = 4;
  const ml = dv.getUint32(p, true); p += 4;
  const meta = JSON.parse(new TextDecoder().decode(u8.subarray(p, p + ml))); p += ml;
  const sec = () => { const n = dv.getUint32(p, true); p += 4; const s = u8.subarray(p, p + n); p += n; return s; };
  const secB = sec(), secR = sec(), secM = sec(), secA = sec();
  const rd = (s) => {
    let q = 0;
    return {
      end: () => q >= s.length,
      v() { let r = 0, sh = 0, b; do { b = s[q++]; r += (b & 127) * Math.pow(2, sh); sh += 7; } while (b & 128); return r; },
      z() { const n = this.v(); return n % 2 ? -(n + 1) / 2 : n / 2; },
      u8: () => s[q++],
    };
  };
  const bq = meta.bq, rq = meta.rq;
  // buildings
  const total = meta.counts.b;
  const start = new Uint32Array(total + 1), h = new Uint8Array(total), kind = new Uint8Array(total);
  // the footprints are coded in a frame turned to the city's sector grid (meta.rot: most walls then run along one axis and their deltas are zero): back to local metres as they are read
  const rot = meta.rot || 0, gc = Math.cos(rot), gs = Math.sin(rot);
  let ring = new Float32Array(total * 8), rp = 0;
  {
    const r = rd(secB); let x = 0, y = 0, i = 0;
    while (!r.end() && i < total) {
      const n = r.v();
      if (rp + n * 2 > ring.length) { const g = new Float32Array(ring.length * 2); g.set(ring); ring = g; }
      x += r.z(); y += r.z(); ring[rp++] = x * gc - y * gs; ring[rp++] = x * gs + y * gc;
      let px = x, py = y;
      for (let k = 1; k < n; k++) { px += r.z(); py += r.z(); ring[rp++] = px * gc - py * gs; ring[rp++] = px * gs + py * gc; }
      h[i] = r.u8(); kind[i] = r.u8(); i++; start[i] = rp / 2;
    }
  }
  const lines = (s, withKind) => {
    const r = rd(s), out = []; let x = 0, y = 0;
    while (!r.end()) {
      const k = r.u8(), n = r.v(), pts = new Float32Array(n * 2);
      x += r.z(); y += r.z(); pts[0] = x / rq; pts[1] = y / rq;
      let px = x, py = y;
      for (let i = 1; i < n; i++) { px += r.z(); py += r.z(); pts[i * 2] = px / rq; pts[i * 2 + 1] = py / rq; }
      out.push({ k, pts });
    }
    return out;
  };
  const roads = lines(secR), metro = lines(secM), areas = lines(secA);
  return { meta, bld: { n: total, start, ring, h, kind, bq }, roads, metro, areas };
}

/* ---------- small maths ---------- */
export function hash1(i) { let t = (i + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const cross2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function convex(xs, ys, n) {
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross2(xs[i], ys[i], xs[(i + 1) % n], ys[(i + 1) % n], xs[(i + 2) % n], ys[(i + 2) % n]);
    if (Math.abs(c) < 1e-6) continue;
    if (!sign) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function eqPt(o) { return o.x === this.x && o.y === this.y; }
/* triangles of a simple polygon (x, n arrays), counter-clockwise: a fan when it is convex, ear clipping (three's earcut) otherwise. Returns indices, or null. */
export function triangulate(xs, ys, n) {
  if (n < 3) return null;
  if (n === 3) return [0, 1, 2];
  if (convex(xs, ys, n)) { const o = []; for (let i = 1; i < n - 1; i++) o.push(0, i, i + 1); return o; }
  if (!ShapeUtils) return null;
  const contour = []; for (let i = 0; i < n; i++) contour.push({ x: xs[i], y: ys[i], equals: eqPt });   // what triangulateShape uses of a Vector2: x, y and equals (it drops a closing point equal to the first)
  let faces; try { faces = ShapeUtils.triangulateShape(contour, []); } catch (e) { return null; }
  if (!faces || !faces.length) return null;
  const o = [];
  for (const f of faces) { // make every triangle counter-clockwise
    if (cross2(xs[f[0]], ys[f[0]], xs[f[1]], ys[f[1]], xs[f[2]], ys[f[2]]) >= 0) o.push(f[0], f[1], f[2]); else o.push(f[0], f[2], f[1]);
  }
  return o;
}

/* ---------- buildings: one mesh per tile: walls, a roof, and a lip round the roof's edge (a mitred ring 0.55 m out, 0.12 m up; the accent rim). 30 October: 16 bytes a vertex, 6 a footprint edge.
   `pu` (Int16 x 4, interleaved): position in 1/q m from the tile's origin `o`, and u, metres along this wall x 25. `mt` (Uint16 x 4): seed, height x 2 + 256 x kind code (+8 generated) + 4096 x role
   (0 wall, 1 roof, 2 lip edge), wall length x 25, the wall's normal (x, z a byte each). A wall's vertices all carry the same face data, so the shader reads it exactly. The lips' triangles come last
   (`ipMain`), so a far tile can be drawn without them. ---------- */
export const POS_Q = 40, U_Q = 25;
export function buildingTiles(city) { return [...tileSteps(city)]; }
/* the same, a tile at a time (the main thread's fallback builds between frames) */
export function* tileSteps(city) {
  const { bld, meta } = city, q = bld.bq;
  let b = 0;
  const xs = new Float64Array(64), ys = new Float64Array(64), qx = new Float64Array(64), qz = new Float64Array(64), ex = new Float64Array(64), ey = new Float64Array(64), el = new Float64Array(64);
  for (const [tx, ty, count] of meta.tiles) {
    let nv = 0, ni = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = b; i < b + count; i++) {
      const s0 = bld.start[i], n = bld.start[i + 1] - s0; if (n > 64 || n < 3) continue;
      nv += 6 * n; ni += 12 * n + 3 * (n - 2);
      for (let k = 0; k < n; k++) { const x = bld.ring[(s0 + k) * 2] / q, y = bld.ring[(s0 + k) * 2 + 1] / q; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (!nv) { b += count; continue; }
    // the tile's origin and the scale that keeps every vertex inside an Int16 (1/40 m reaches 819 m each way)
    const ox = Math.round((x0 + x1) / 2), oy = Math.round((y0 + y1) / 2), half = Math.max(x1 - x0, y1 - y0) / 2 + 2;
    const PQ = half * POS_Q < 32000 ? POS_Q : half * 20 < 32000 ? 20 : 10;
    const pu = new Int16Array(nv * 4), mt = new Uint16Array(nv * 4), idx = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni), lip = new Uint32Array(nv);      // the lips: 6 indices for each footprint edge, as many as the vertices
    let vp = 0, ip = 0, lp = 0, bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity, by1 = 0;
    // one vertex (x, y, z in the tile's units; truncated to an Int16)
    const put = (x, y, z, u, a, c, l, d) => { const o = vp * 4; pu[o] = x; pu[o + 1] = y; pu[o + 2] = z; pu[o + 3] = u; mt[o] = a; mt[o + 1] = c; mt[o + 2] = l; mt[o + 3] = d; vp++; };
    for (let i = b; i < b + count; i++) {
      const s0 = bld.start[i], n = bld.start[i + 1] - s0;
      if (n > 64 || n < 3) continue;
      for (let k = 0; k < n; k++) { xs[k] = bld.ring[(s0 + k) * 2] / q; ys[k] = bld.ring[(s0 + k) * 2 + 1] / q; qx[k] = (xs[k] - ox) * PQ; qz[k] = (oy - ys[k]) * PQ; }
      const H2 = Math.min(255, bld.h[i]), qH = H2 / 2 * PQ, kd = bld.kind[i] & 15, seed = Math.floor(hash1(i * 7 + 3) * 65536) & 65535;
      const code = H2 + 256 * kd;
      // each wall's outward normal (the ring is counter-clockwise) and length
      for (let k = 0; k < n; k++) { const k2 = k + 1 === n ? 0 : k + 1, dx = xs[k2] - xs[k], dy = ys[k2] - ys[k], L = Math.hypot(dx, dy) || 1e-6; ex[k] = dy / L; ey[k] = -dx / L; el[k] = L; }
      for (let k = 0; k < n; k++) {
        const k2 = k + 1 === n ? 0 : k + 1, nx = ex[k], nn = ey[k], L = el[k];
        const ang = Math.round((nx + 1) * 127.5) * 256 + Math.round((1 - nn) * 127.5);    // the world normal (x, z = -n), a byte each
        const Lq = Math.min(65535, Math.round(L * U_Q)), uq = Math.min(32767, Lq), v0 = vp;
        // the wall: bottom start, bottom end, top end, top start
        put(qx[k], 0, qz[k], 0, seed, code, Lq, ang); put(qx[k2], 0, qz[k2], uq, seed, code, Lq, ang); put(qx[k2], qH, qz[k2], uq, seed, code, Lq, ang); put(qx[k], qH, qz[k], 0, seed, code, Lq, ang);
        idx[ip++] = v0; idx[ip++] = v0 + 1; idx[ip++] = v0 + 2; idx[ip++] = v0; idx[ip++] = v0 + 2; idx[ip++] = v0 + 3;
      }
      // the roof's vertices, then the lip's outer ring (mitred, at most 2.2 times its width)
      const r0 = vp, o0 = vp + n, rc = code + 4096, lc = code + 8192, lH = qH + 0.12 * PQ;
      for (let k = 0; k < n; k++) put(qx[k], qH, qz[k], 0, seed, rc, 0, 0);
      for (let k = 0; k < n; k++) {
        const kp = k === 0 ? n - 1 : k - 1, ax = ex[kp], ay = ey[kp];
        let mx = ax + ex[k], my = ay + ey[k]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;    // the mean of the two outward normals
        const d = 0.55 / Math.max(0.45, mx * ax + my * ay) * PQ, X = qx[k] + mx * d, Z = qz[k] - my * d;
        put(X, lH, Z, 0, seed, lc, 0, 0);
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Z < bz0) bz0 = Z; if (Z > bz1) bz1 = Z;
      }
      if (lH > by1) by1 = lH;
      for (let k = 0; k < n; k++) { const k2 = k + 1 === n ? 0 : k + 1; lip[lp++] = r0 + k; lip[lp++] = r0 + k2; lip[lp++] = o0 + k2; lip[lp++] = r0 + k; lip[lp++] = o0 + k2; lip[lp++] = o0 + k; }
      const tri = triangulate(xs, ys, n);
      if (tri) for (const t of tri) idx[ip++] = r0 + t;
    }
    b += count;
    // the lips last; buffers of exact size (handed over whole); the bounding sphere round the lips' box, in the tile's units
    const ipMain = ip; idx.set(lip.subarray(0, lp), ip); ip += lp;
    const I = ip === idx.length ? idx : idx.slice(0, ip);
    const cx = (bx0 + bx1) / 2, cy = by1 / 2, cz = (bz0 + bz1) / 2, r = Math.hypot(bx1 - bx0, by1, bz1 - bz0) / 2 + 2;
    yield { tx, ty, pu, mt, idx: I, vp, ip, ipMain, o: [ox, -oy], q: PQ, bs: [cx, cy, cz, r] };
  }
}

/* ---------- ribbons: roads (soft glowing strips), the metro's deck ---------- */
export const ROAD_WIDTH = [20, 18, 15, 12, 9, 6.6, 5, 3.4, 46, 24];   // by class; 8 = runway, 9 = taxiway

/* a strip along a polyline: positions (x, y, -n), aR = (across -1..1, distance along, class, line hash). Returns the arrays. */
export function ribbons(lines, widthOf, y, classOf) {
  let nv = 0, ni = 0;
  for (const l of lines) { const n = l.pts.length / 2; if (n > 1) { nv += n * 2; ni += (n - 1) * 6; } }
  const pos = new Float32Array(nv * 3), aR = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  let vp = 0, ip = 0, li = 0;
  for (const l of lines) {
    const n = l.pts.length / 2; li++;
    if (n < 2) continue;
    const cls = classOf(l), w = widthOf(l) / 2, hs = hash1(li * 31 + 5);
    let along = 0, base = vp;
    for (let i = 0; i < n; i++) {
      const x = l.pts[i * 2], z = l.pts[i * 2 + 1];
      let ax = 0, az = 0, bx = 0, bz = 0;
      if (i > 0) { ax = x - l.pts[i * 2 - 2]; az = z - l.pts[i * 2 - 1]; const L = Math.hypot(ax, az) || 1; ax /= L; az /= L; }
      if (i < n - 1) { bx = l.pts[i * 2 + 2] - x; bz = l.pts[i * 2 + 3] - z; const L = Math.hypot(bx, bz) || 1; bx /= L; bz /= L; }
      if (i === 0) { ax = bx; az = bz; } if (i === n - 1) { bx = ax; bz = az; }
      let nx = -(az + bz), nz = ax + bx;              // the average of the two segments' left normals
      const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      const miter = Math.min(2.2, 1 / Math.max(0.35, nx * -az + nz * ax));
      if (i > 0) along += Math.hypot(x - l.pts[i * 2 - 2], z - l.pts[i * 2 - 1]);
      for (const s of [-1, 1]) {
        pos[vp * 3] = x + nx * w * s * miter; pos[vp * 3 + 1] = y; pos[vp * 3 + 2] = -(z + nz * w * s * miter);
        aR[vp * 4] = s; aR[vp * 4 + 1] = along; aR[vp * 4 + 2] = cls; aR[vp * 4 + 3] = hs; vp++;
      }
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ip); ip += 6; }
    // the polyline's winding from above: the strip is wound so that its top face is up
  }
  return { pos, aR, idx, vp, ip };
}

/* lamp points along the main roads */
export function lamps(roads) {
  const out = [], space = [34, 34, 36, 38, 42, 60, 0, 0];
  let seed = 11;
  for (const l of roads) {
    const sp = space[l.k] || 0; if (!sp) continue;
    const n = l.pts.length / 2, half = ROAD_WIDTH[l.k] / 2 + 1.2;
    let carry = sp * 0.5, side = 1;
    for (let i = 0; i < n - 1; i++) {
      const x0 = l.pts[i * 2], z0 = l.pts[i * 2 + 1], dx = l.pts[i * 2 + 2] - x0, dz = l.pts[i * 2 + 3] - z0, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      while (carry < L) {
        const t = carry / L, nx = -dz / L, nz = dx / L;
        const jitter = hash1(seed++);
        if (jitter > 0.08) out.push(x0 + dx * t + nx * half * side, 7.2, -(z0 + dz * t + nz * half * side), jitter);
        side = -side; carry += sp;
      }
      carry -= L;
    }
  }
  return new Float32Array(out);
}

/* flat polygons (parks, water, airfield aprons, pitches, fields): positions and a kind per vertex */
export function areaMesh(areas) {
  const P = [], K = [], I = [];
  let vb = 0;
  const xs = [], ys = [];
  for (const a of areas) {
    const n = a.pts.length / 2;
    if (n < 3) continue;
    xs.length = 0; ys.length = 0;
    for (let i = 0; i < n; i++) { xs.push(a.pts[i * 2]); ys.push(a.pts[i * 2 + 1]); }
    let area = 0; for (let i = 0; i < n; i++) area += xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i];
    if (area < 0) { xs.reverse(); ys.reverse(); }
    const tri = triangulate(xs, ys, n);
    if (!tri) continue;
    for (let i = 0; i < n; i++) { P.push(xs[i], 0, -ys[i]); K.push(a.k); }
    for (const t of tri) I.push(vb + t);
    vb += n;
  }
  return { pos: new Float32Array(P), kind: new Float32Array(K), idx: new Uint32Array(I) };
}

/* a coarse height field (6 m cells) of the buildings, for hiding labels that stand behind them */
export function heightField(city, cell = 6) { return heightAt(heightData(city, cell)); }
/* the height field's `at(x, n)` (a function cannot cross from the worker: the data does, and this puts the lookup back) */
export function heightAt(h) {
  const { hf, W, H, cell, x0, n0 } = h;
  h.at = (x, n) => { const ix = ((x - x0) / cell) | 0, iy = (H - 1 - (((n - n0) / cell) | 0)); return ix < 0 || iy < 0 || ix >= W || iy >= H ? 0 : hf[iy * W + ix] / 2; };
  return h;
}
const canvas2d = (w, h) => { if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h); const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function heightData(city, cell = 6) {
  const { meta, bld } = city, [x0, n0, x1, n1] = meta.keep, W = Math.ceil((x1 - x0) / cell) + 1, H = Math.ceil((n1 - n0) / cell) + 1;
  const cv = canvas2d(W, H);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "lighten";
  // draw the taller ones last is not needed with `lighten`
  for (let i = 0; i < bld.n; i++) {
    const s0 = bld.start[i], n = bld.start[i + 1] - s0; if (n < 3) continue;
    const v = Math.min(255, Math.round(bld.h[i] * 1.0));      // half-metres, up to 127 m
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    for (let k = 0; k < n; k++) { const x = (bld.ring[(s0 + k) * 2] / bld.bq - x0) / cell, y = H - (bld.ring[(s0 + k) * 2 + 1] / bld.bq - n0) / cell; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    g.closePath(); g.fill();
  }
  const d = g.getImageData(0, 0, W, H).data, hf = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) hf[i] = d[i * 4];
  return { hf, W, H, cell, x0, n0 };
}

/* a soft density map of the buildings (for the ground's glow): a small canvas over the kept box */
export function densityCanvas(city, size = 512) {
  const { meta, bld } = city, [x0, n0, x1, n1] = meta.keep;
  const cv = canvas2d(size, size);
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  const sx = size / (x1 - x0), sy = size / (n1 - n0);
  g.fillStyle = "rgba(255,255,255,0.05)";
  const r = Math.max(2, 70 * sx);
  for (let i = 0; i < bld.n; i += 1) {
    const s0 = bld.start[i], n = bld.start[i + 1] - s0; if (n < 3) continue;
    const x = (bld.ring[s0 * 2] / bld.bq - x0) * sx, y = size - (bld.ring[s0 * 2 + 1] / bld.bq - n0) * sy;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  return cv;
}
/* the same map as one byte a texel (its red), bottom row first: what a canvas texture with flipY gives the ground shader, as plain data (a DataTexture on the page) */
export function densityData(city, size = 512) {
  const d = densityCanvas(city, size).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, size, size).data, out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) { const src = (size - 1 - y) * size; for (let x = 0; x < size; x++) out[y * size + x] = d[(src + x) * 4]; }
  return { data: out, size };
}

/* the elevated metro: the deck and its underside as ribbons, a pillar every 30 m (x, z, heading), the rail lines, and the viaduct lines themselves (the trains run on the two longest) */
export function metroData(metro) {
  const lines = metro.filter((l) => l.k === 0), rail = metro.filter((l) => l.k === 1), out = { deck: null, under: null, rail: null, spots: null, lines };
  if (lines.length) {
    out.deck = ribbons(lines, () => 5.6, 9.1, () => 0);
    out.under = ribbons(lines, () => 5.2, 7.9, () => 0);       // the underside: a darker, narrower band 1.2 m below so the deck has a body
    const spots = [];
    for (const l of lines) {
      let carry = 15; const n = l.pts.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const x0 = l.pts[i * 2], z0 = l.pts[i * 2 + 1], dx = l.pts[i * 2 + 2] - x0, dz = l.pts[i * 2 + 3] - z0, L = Math.hypot(dx, dz); if (L < 0.01) continue;
        while (carry < L) { spots.push(x0 + dx * carry / L, z0 + dz * carry / L, Math.atan2(dx, dz)); carry += 30; }
        carry -= L;
      }
    }
    out.spots = new Float32Array(spots);
  }
  if (rail.length) out.rail = ribbons(rail, () => 5, 0.12, () => 0);
  return out;
}

/* the road lines in three arrays (the street index for snapping is built from them on the page, when it is first asked for) */
export function packLines(lines) {
  let total = 0; for (const l of lines) total += l.pts.length;
  const k = new Uint8Array(lines.length), off = new Uint32Array(lines.length + 1), pts = new Float32Array(total);
  lines.forEach((l, i) => { k[i] = l.k; pts.set(l.pts, off[i]); off[i + 1] = off[i] + l.pts.length; });
  return { k, off, pts };
}
export function unpackLines(p) { const out = []; for (let i = 0; i < p.k.length; i++) out.push({ k: p.k[i], pts: p.pts.subarray(p.off[i], p.off[i + 1]) }); return out; }

/* ---------- everything the scene needs from the city file, as typed arrays (the worker's job; the page's own fallback runs the same steps between frames) ----------
   A generator: each `yield` is a point where the main thread may give a frame back (the worker runs it straight through). Returns the prepared city. */
export function* prepareSteps(raw, opts = {}) {
  const now = () => performance.now(), T = {};
  let t = now(); const lap = (k) => { const x = now(); T[k] = (T[k] || 0) + Math.round(x - t); t = x; };
  const city = decode(new Uint8Array(raw)); lap("decode"); yield;
  const tiles = [];
  for (const tile of tileSteps(city)) { tiles.push(tile); lap("tiles"); yield; }
  const roads = ribbons(city.roads, (l) => ROAD_WIDTH[l.k], 0.06, (l) => l.k); lap("roads"); yield;
  const lp = lamps(city.roads), lampPos = new Float32Array(lp.length / 4 * 3), lampSeed = new Float32Array(lp.length / 4);
  for (let i = 0; i < lp.length / 4; i++) { lampPos[i * 3] = lp[i * 4]; lampPos[i * 3 + 1] = lp[i * 4 + 1]; lampPos[i * 3 + 2] = lp[i * 4 + 2]; lampSeed[i] = lp[i * 4 + 3]; }
  lap("lamps"); yield;
  const areas = areaMesh(city.areas); lap("areas"); yield;
  const metro = metroData(city.metro); lap("metro"); yield;
  const hf = heightData(city, opts.hfCell || 6); lap("heights"); yield;
  const dens = densityData(city, opts.densSize || 512); lap("density"); yield;
  const roadLines = packLines(city.roads); lap("pack");
  return { meta: city.meta, counts: { buildings: city.bld.n, roadLines: city.roads.length, tris: tiles.reduce((s, x) => s + x.ip / 3, 0) }, tiles, roads, lamps: { pos: lampPos, seed: lampSeed }, areas, metro, hf, dens, roadLines, times: T };
}
export function prepare(raw, opts) { const g = prepareSteps(raw, opts); let r; while (!(r = g.next()).done); return r.value; }
/* every buffer of a prepared city, once each: handed over, not copied */
export function transferables(P) {
  const set = new Set(), add = (a) => { if (a && a.buffer && !set.has(a.buffer)) set.add(a.buffer); };
  for (const t of P.tiles) { add(t.pu); add(t.mt); add(t.idx); }
  for (const r of [P.roads, P.areas, P.metro.deck, P.metro.under, P.metro.rail]) if (r) Object.values(r).forEach(add);
  add(P.lamps.pos); add(P.lamps.seed); add(P.metro.spots); add(P.hf.hf); add(P.dens.data); add(P.roadLines.k); add(P.roadLines.off); add(P.roadLines.pts);
  return [...set];
}

/* the day's noise (30 October): 128 x 128, four channels of periodic gradient noise at different scales (R 8 and 16 cells across the tile, G 16 and 32, B 32 and 64, A 8 and 32 from other seeds), each stretched to the full range.
   The ground shader reads it as a texture; the trees are placed by the same numbers, so they stand where the far painted canopy is. */
export function noiseData() {
  const N = 128, d = new Uint8Array(N * N * 4), OCT = [[[8, 0.65], [16, 0.35]], [[16, 0.65], [32, 0.35]], [[32, 0.65], [64, 0.35]], [[8, 0.5], [32, 0.5]]];
  const rnd = (i) => { i = Math.imul(i ^ (i >>> 15), 0x2c1b3c6d); i = Math.imul(i ^ (i >>> 12), 0x297a2d39); return ((i ^ (i >>> 15)) >>> 0) / 4294967296; };
  const acc = new Float32Array(N * N), fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  OCT.forEach((oct, c) => {
    acc.fill(0);
    oct.forEach(([P, wt], k) => {
      const GX = new Float32Array(P * P), GY = new Float32Array(P * P); for (let i = 0; i < P * P; i++) { const an = rnd(i * 37 + (c + 1) * 7919 + (k + 1) * 104729) * 6.2831853; GX[i] = Math.cos(an); GY[i] = Math.sin(an); }
      for (let y = 0; y < N; y++) {
        const fy = y / N * P, iy = fy | 0, ty = fy - iy, sy = fade(ty), y0 = iy * P, y1 = ((iy + 1) % P) * P;
        for (let x = 0; x < N; x++) {
          const fx = x / N * P, ix = fx | 0, tx = fx - ix, sx = fade(tx), x1 = (ix + 1) % P;
          const a = GX[y0 + ix] * tx + GY[y0 + ix] * ty, b = GX[y0 + x1] * (tx - 1) + GY[y0 + x1] * ty, e = GX[y1 + ix] * tx + GY[y1 + ix] * (ty - 1), g = GX[y1 + x1] * (tx - 1) + GY[y1 + x1] * (ty - 1);
          acc[y * N + x] += wt * (a + (b - a) * sx + (e - a + (a - b - e + g) * sx) * sy);
        }
      }
    });
    let lo = 1e9, hi = -1e9; for (let i = 0; i < N * N; i++) { if (acc[i] < lo) lo = acc[i]; if (acc[i] > hi) hi = acc[i]; }
    for (let i = 0; i < N * N; i++) d[i * 4 + c] = Math.round((acc[i] - lo) / (hi - lo) * 255);
  });
  return d;
}

/* ---------- the trees (30 October): where they stand, worked out once from the data the city already has, off the main thread; nothing is added to a city file. Seeded by the grid cell, so a load gives the same trees every time.
   Rasters over the kept box: the area kinds, and what a tree must keep clear of (the roads and a verge, the metro and the rail, the buildings and a margin, the shipped trails, the pinned places). A candidate on a jittered grid is taken by the
   same cover the ground's far painted canopy uses (groves on open ground and in parks), or the forest's, or the street's; each gets a species by the mix, a size, a turn and a tint. Output: per tile of TREE_TILE metres, per species, Int16 x, z
   (1/20 m from the tile's middle) and Uint8 yaw, size, rank, tint, sorted by rank, so that a shorter draw is a thinner stand. ---------- */
export const TREE_TILE = 400;
function fillTri(r, W, H, ax, ay, bx, by, cx, cy, v, keep) {       // scanline, in raster cells (no antialiasing: the same on every machine); keep: cells of this raster that are not overwritten
  const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5; let l = 1e9, h = -1e9;
    const edge = (px, py, qx, qy) => { if ((py <= yc) !== (qy <= yc)) { const x = px + (yc - py) * (qx - px) / (qy - py); if (x < l) l = x; if (x > h) h = x; } };
    edge(ax, ay, bx, by); edge(bx, by, cx, cy); edge(cx, cy, ax, ay);
    if (l > h) continue;
    const x0 = Math.max(0, Math.ceil(l - 0.5)), x1 = Math.min(W - 1, Math.floor(h - 0.5));
    for (let x = x0; x <= x1; x++) { const i = y * W + x; if (!keep || !keep[r[i]]) r[i] = v; }
  }
}
export function* treeSteps(I) {
  const T0 = performance.now(), [x0, n0, x1, n1] = I.keep, cfg = I.trees, CELL = Math.max(3, Math.sqrt((x1 - x0) * (n1 - n0)) / 3200), W = Math.ceil((x1 - x0) / CELL) + 1, H = Math.ceil((n1 - n0) / CELL) + 1;
  const kinds = new Uint8Array(W * H), blk = new Uint8Array(W * H), cx = (x) => (x - x0) / CELL, cy = (n) => (n - n0) / CELL;
  // the area kinds (what must not be planted wins where two overlap)
  const HARD = new Uint8Array(16); for (const k of [2, 3, 4, 7, 8, 10]) HARD[k] = 1;
  { const a = I.areas, P = a.pos, K = a.kind, Q = a.idx;
    for (let i = 0; i < Q.length; i += 3) { const A = Q[i], B = Q[i + 1], C = Q[i + 2], k = K[A]; fillTri(kinds, W, H, cx(P[A * 3]), cy(-P[A * 3 + 2]), cx(P[B * 3]), cy(-P[B * 3 + 2]), cx(P[C * 3]), cy(-P[C * 3 + 2]), k, HARD[k] ? null : HARD); } }
  yield;
  // (water's edges are stroked below too: a thin channel can fall between the raster's cell centres, and a crown should not stand with its trunk at the very edge)
  const stroke = (ax, ay, bx, by, half) => {       // a thick segment, squared off half a width beyond its ends
    let dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy); if (L < 1e-3) return; dx /= L; dy /= L; half = Math.max(half, CELL * 0.75);      // at least a cell wide, or a narrow road could fall between the cell centres
    const nx = -dy * half, ny = dx * half, ex = dx * half, ey = dy * half, p = [cx(ax - ex + nx), cy(ay - ey + ny), cx(bx + ex + nx), cy(by + ey + ny), cx(bx + ex - nx), cy(by + ey - ny), cx(ax - ex - nx), cy(ay - ey - ny)];
    fillTri(blk, W, H, p[0], p[1], p[2], p[3], p[4], p[5], 1); fillTri(blk, W, H, p[0], p[1], p[4], p[5], p[6], p[7], 1);
  };
  const polyline = (pts, half) => { for (let i = 0; i + 3 < pts.length; i += 2) stroke(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], half); };
  { const a = I.areas, P = a.pos, K = a.kind, Q = a.idx, m = CELL * 0.75 + 1.5;
    for (let i = 0; i < Q.length; i += 3) { const A = Q[i], B = Q[i + 1], C = Q[i + 2]; if (K[A] !== 2) continue; const ax = P[A * 3], ay = -P[A * 3 + 2], bx = P[B * 3], by = -P[B * 3 + 2], cx0 = P[C * 3], cy0 = -P[C * 3 + 2]; stroke(ax, ay, bx, by, m); stroke(bx, by, cx0, cy0, m); stroke(cx0, cy0, ax, ay, m); } }
  // the roads, with a verge; an airfield plants nothing, and the data has its runways, taxiways and aprons but no boundary, so those two are drawn wide enough to take the grass between them
  const RL = I.roads;
  for (let l = 0; l < RL.k.length; l++) { const k = RL.k[l]; polyline(RL.pts.subarray(RL.off[l], RL.off[l + 1]), k === 8 ? 300 : k === 9 ? 220 : ROAD_WIDTH[k] / 2 + 2.6); }
  yield;
  // the metro's deck and the rail (ribbons: the middle of each quad)
  for (const [rb, half] of [[I.deck, 20], [I.rail, 6.5]]) { if (!rb) continue; const P = rb.pos, Q = rb.idx;
    for (let i = 0; i + 5 < Q.length; i += 6) { const a = Q[i], b = Q[i + 1], c = Q[i + 2], d = Q[i + 4]; stroke((P[a * 3] + P[b * 3]) / 2, -(P[a * 3 + 2] + P[b * 3 + 2]) / 2, (P[c * 3] + P[d * 3]) / 2, -(P[c * 3 + 2] + P[d * 3 + 2]) / 2, half); } }
  // the buildings, with a margin the size of a crown (the height field's cells, 6 m)
  { const h = I.hf, m = 3.5; for (let y = 0; y < h.H; y++) for (let x = 0; x < h.W; x++) { if (!h.hf[y * h.W + x]) continue;
      const ax = h.x0 + x * h.cell, an = h.n0 + (h.H - 1 - y) * h.cell, X0 = Math.max(0, Math.floor(cx(ax - m))), X1 = Math.min(W - 1, Math.ceil(cx(ax + h.cell + m))), Y0 = Math.max(0, Math.floor(cy(an - m))), Y1 = Math.min(H - 1, Math.ceil(cy(an + h.cell + m)));
      for (let v = Y0; v <= Y1; v++) blk.fill(1, v * W + X0, v * W + X1 + 1); } }
  yield;
  // what must stay in sight: the trails with a clear strip wide enough for the usual view over them, the places with a clearing
  for (const p of I.paths) polyline(p, 20);
  for (let i = 0; i + 1 < I.places.length; i += 2) { const px = cx(I.places[i]), py = cy(I.places[i + 1]), r = 28 / CELL; for (let v = Math.max(0, Math.floor(py - r)); v <= Math.min(H - 1, Math.ceil(py + r)); v++) for (let u = Math.max(0, Math.floor(px - r)); u <= Math.min(W - 1, Math.ceil(px + r)); u++) if (Math.hypot(u + 0.5 - px, v + 0.5 - py) <= r) blk[v * W + u] = 1; }
  yield;
  // the same noise and the same cover as the ground shader's
  const N = 128, Z = I.noise, samp = (ch, x, z, s) => { let u = x * s, v = z * s; u = (u - Math.floor(u)) * N - 0.5; v = (v - Math.floor(v)) * N - 0.5; const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv, a = (iu + N) % N, b = (iu + 1 + N) % N, c = (iv + N) % N, e = (iv + 1 + N) % N;
    const q = (y, xx) => Z[(y * N + xx) * 4 + ch]; return (q(c, a) * (1 - fu) * (1 - fv) + q(c, b) * fu * (1 - fv) + q(e, a) * (1 - fu) * fv + q(e, b) * fu * fv) / 255; };
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const D = I.dens, densAt = (x, n) => { const i = Math.min(D.size - 1, Math.max(0, ((x - x0) / (x1 - x0) * D.size) | 0)), j = Math.min(D.size - 1, Math.max(0, ((n - n0) / (n1 - n0) * D.size) | 0)); return D.data[j * D.size + i] / 255; };
  const clearAt = (x, n, r) => { for (let a = 0; a < 5; a++) { const ox = a ? (a < 3 ? (a === 1 ? r : -r) : 0) : 0, oy = a >= 3 ? (a === 3 ? r : -r) : 0, i = (cx(x + ox)) | 0, j = (cy(n + oy)) | 0; if (i < 0 || j < 0 || i >= W || j >= H || blk[j * W + i]) return false; } return true; };
  const SP = cfg.species, pick = (list, h) => { let tot = 0; for (const i of list) tot += SP[i].w; let t = h * tot; for (const i of list) { t -= SP[i].w; if (t <= 0) return i; } return list[list.length - 1]; };
  const all = SP.map((_, i) => i), forest = cfg.forestSpecies || all, street = cfg.streetSpecies || all, dens = I.density;
  // the crown's reach and its underside, in a unit tree (city.js TREE_SHAPES, with the vertices' jitter): a tree takes the largest size, of its own, half and none, at which no building that reaches its crown's height stands within that reach; else it is not planted
  const CROWN = { round: [0.65, 0.38], oval: [0.38, 0.24], gum: [0.46, 0.38], canopy: [0.62, 0.52], conifer: [0.34, 0.1], palm: [0.52, 0.6] }, hg = I.hf;
  const hfAt = (x, n) => { const ix = ((x - hg.x0) / hg.cell) | 0, iy = hg.H - 1 - (((n - hg.n0) / hg.cell) | 0); return ix < 0 || iy < 0 || ix >= hg.W || iy >= hg.H ? 0 : hg.hf[iy * hg.W + ix] / 2; };
  const crownFits = (x, n, q, s) => { const c = CROWN[q.shape] || CROWN.round, tall = q.h[0] + (q.h[1] - q.h[0]) * s, r = c[0] * tall * (q.wid || 0.9) * 1.16, lo = c[1] * tall;
    for (let a = 0; a < 12; a++) { const t = a * 0.5235988, cs = Math.cos(t), sn = Math.sin(t); if (hfAt(x + cs * r, n + sn * r) > lo || hfAt(x + cs * r * 0.55, n + sn * r * 0.55) > lo) return false; }
    return true; };
  const X = [], Y = [], S = [], Aa = [], Zz = [], put = (x, n, sp, id) => { const q = SP[sp]; let z = hash1(id * 13 + 23); if (!crownFits(x, n, q, z)) { z *= 0.5; if (!crownFits(x, n, q, z)) { z = 0; if (!crownFits(x, n, q, 0)) return; } } X.push(x); Y.push(n); S.push(sp); Aa.push(id); Zz.push(z); };
  const G = cfg.spacing || 9, GR = cfg.grove == null ? 1 : cfg.grove, PK = cfg.park == null ? 1 : cfg.park, FO = cfg.forest == null ? 1 : cfg.forest;
  const cols = Math.ceil((x1 - x0) / G), rows = Math.ceil((n1 - n0) / G);
  let t0 = performance.now();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = row * 65537 + col, h0 = hash1(id * 3 + 1), h1 = hash1(id * 3 + 2), x = x0 + (col + 0.5 + (h0 - 0.5) * 0.9) * G, n = n0 + (row + 0.5 + (h1 - 0.5) * 0.9) * G;
      const i = (cx(x)) | 0, j = (cy(n)) | 0; if (i < 0 || j < 0 || i >= W || j >= H || blk[j * W + i]) continue;
      const k = kinds[j * W + i]; let pr = 0, list = all, z = -n;
      if (k === 0) { const d = densAt(x, n); pr = (sst(0.50, 0.60, samp(2, x, z, 0.00077) * 0.6 + samp(3, x, z, 0.00007) * 0.15 + samp(0, x, z, 0.0077) * 0.25) * 0.92 + 0.04) * (1 - sst(0.1, 0.7, d)) * GR; }
      else if (k === 1) pr = (sst(0.46, 0.60, samp(1, x, z, 0.0016) * 0.6 + samp(2, x, z, 0.0016) * 0.4) * 0.95 + 0.03) * PK;
      else if (k === 6) { pr = 0.92 * FO; list = forest; }
      else if (k === 9) pr = 0.25;
      else if (k === 5) pr = 0.012;
      if (pr <= 0) continue;
      const h2 = hash1(id * 3 + 3); if (h2 >= pr * dens) continue;
      if (!clearAt(x, n, 2.5)) continue;
      put(x, n, pick(list, hash1(id * 7 + 5)), id);
    }
    if (row % 64 === 0 && performance.now() - t0 > 10) { yield; t0 = performance.now(); }
  }
  yield;
  // street trees: along the verges of the built-up streets, where the raster says the verge is free
  const STREET = cfg.street || 0, n0Street = X.length;
  if (STREET > 0 && SP.length) {
    for (let l = 0; l < RL.k.length; l++) {
      const k = RL.k[l]; if (k < 2 || k > 6) continue;
      const pts = RL.pts.subarray(RL.off[l], RL.off[l + 1]), off = ROAD_WIDTH[k] / 2 + 3.6, step = k <= 4 ? 13 : 18, sp0 = k <= 4 ? Math.min(1, STREET * 1.7) : STREET; let carry = hash1(l * 11 + 3) * step;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1]; let dx = pts[i + 2] - ax, dy = pts[i + 3] - ay; const L = Math.hypot(dx, dy); if (L < 1) continue; dx /= L; dy /= L;
        while (carry < L) {
          const px = ax + dx * carry, py = ay + dy * carry; carry += step;
          if (densAt(px, py) < 0.02) continue;
          for (const sd of [-1, 1]) {
            const id = (l * 4099 + i * 131 + Math.round(carry)) * 2 + (sd > 0 ? 1 : 0);
            if (hash1(id * 5 + 7) >= sp0 * dens) continue;
            const x = px - dy * off * sd, n = py + dx * off * sd;
            if (!clearAt(x, n, 1.2)) continue;
            { const q = (cy(n) | 0) * W + (cx(x) | 0); if (HARD[kinds[q]]) continue; }       // a road over water or an airfield has no verge to plant
            put(x, n, pick(street, hash1(id * 5 + 11)), -1 - id);
          }
        }
        carry -= L;
      }
      if (l % 512 === 0) yield;
    }
  }
  yield;
  // into tiles, by species, by rank
  const tiles = new Map(), cnt = X.length;
  for (let a = 0; a < cnt; a++) {
    const tx = Math.floor((X[a] - x0) / TREE_TILE), ty = Math.floor((Y[a] - n0) / TREE_TILE), key = ty * 4096 + tx; let t = tiles.get(key);
    if (!t) tiles.set(key, t = { x: x0 + (tx + 0.5) * TREE_TILE, n: n0 + (ty + 0.5) * TREE_TILE, sp: SP.map(() => []) });
    t.sp[S[a]].push(a);
  }
  const out = [], buffers = [];
  for (const t of tiles.values()) {
    const sp = t.sp.map((list, si) => {
      if (!list.length) return null;
      const rank = list.map((a) => hash1(Aa[a] * 13 + 17)), order = list.map((_, q) => q).sort((p, q) => rank[p] - rank[q]), n = list.length, P = new Int16Array(n * 2), B = new Uint8Array(n * 4);
      order.forEach((q, o) => { const a = list[q], id = Aa[a]; P[o * 2] = Math.round((X[a] - t.x) * 20); P[o * 2 + 1] = Math.round((-(Y[a] - t.n)) * 20); B[o * 4] = hash1(id * 13 + 19) * 255; B[o * 4 + 1] = Zz[a] * 255; B[o * 4 + 2] = Math.min(255, rank[q] * 256); B[o * 4 + 3] = hash1(id * 13 + 29) * 255; });
      buffers.push(P.buffer, B.buffer);
      return { n, P, B };
    });
    out.push({ x: t.x, z: -t.n, sp });
  }
  return { tiles: out, count: cnt, street: cnt - n0Street, ms: Math.round(performance.now() - T0), cell: CELL, buffers };
}

/* ---------- the worker: this same module, started by city.js with new Worker(<this file's address>, { type: "module" }) ---------- */
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = async (e) => {
    const { id, gz, core, opts, trees } = e.data || {};
    if (trees) {     // the trees' placement (30 October): the same module, a worker of its own, started only when the day needs it
      try { const g = treeSteps(trees); let r; while (!(r = g.next()).done); const { buffers, ...T } = r.value; self.postMessage({ id, ok: true, T }, buffers); }
      catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }
      return;
    }
    try {
      const t0 = performance.now();
      if (!ShapeUtils) { const T3 = await import(core); ShapeUtils = T3.ShapeUtils; }
      const t1 = performance.now();
      const raw = await gunzip(gz);
      const t2 = performance.now();
      const P = prepare(raw, opts || {});
      P.times.three = Math.round(t1 - t0); P.times.gunzip = Math.round(t2 - t1); P.times.total = Math.round(performance.now() - t0);
      self.postMessage({ id, ok: true, P }, transferables(P));
    } catch (err) {
      self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
  };
}

/* the trails a path file carries: [x0, n0, dx, dn, ...] in `unit` metres */
export function decodePath(pts, unit) {
  const out = new Float32Array(pts.length); let x = pts[0], y = pts[1];
  out[0] = x * unit; out[1] = y * unit;
  for (let i = 2; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; out[i] = x * unit; out[i + 1] = y * unit; }
  return out;
}

/* nearest street point, by a coarse grid over the drawn roads (classes up to 7): for the pinning tool and for placing things on a street */
export function streetIndex(roads) {
  const cell = 80, grid = new Map();
  roads.forEach((l, li) => {
    if (l.k > 7) return;
    const n = l.pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = l.pts[i * 2], ay = l.pts[i * 2 + 1], bx = l.pts[i * 2 + 2], by = l.pts[i * 2 + 3];
      for (let cx = Math.floor(Math.min(ax, bx) / cell); cx <= Math.floor(Math.max(ax, bx) / cell); cx++) for (let cy = Math.floor(Math.min(ay, by) / cell); cy <= Math.floor(Math.max(ay, by) / cell); cy++) {
        const key = cx * 100003 + cy; let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(li, i);
      }
    }
  });
  return (x, n, radius = 240) => {
    let best = null; const r = Math.ceil(radius / cell), cx0 = Math.floor(x / cell), cy0 = Math.floor(n / cell);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
      const a = grid.get(cx * 100003 + cy); if (!a) continue;
      for (let j = 0; j < a.length; j += 2) {
        const l = roads[a[j]], i = a[j + 1], ax = l.pts[i * 2], ay = l.pts[i * 2 + 1], dx = l.pts[i * 2 + 2] - ax, dy = l.pts[i * 2 + 3] - ay, L2 = dx * dx + dy * dy;
        if (l.k > 5 && best && best.k <= 5 && best.d < 40) continue;
        const t = L2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (n - ay) * dy) / L2)), px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, n - py);
        if (!best || d < best.d - (l.k < best.k ? 6 : 0)) best = { x: px, n: py, d, k: l.k };
      }
    }
    return best && best.d <= radius ? best : null;
  };
}
