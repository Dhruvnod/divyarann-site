/* Events on the night city: a layer of city.js (proposal, 29 October 2026). city.js mounts it when the data names it (content.city.layers) and hands it the scene, the replay and the city's mood.
   It draws what content.city.events describes for the chapter being replayed, in the manner of a thermal camera seen from above: units moving along a route (bright, hard shapes, with the heat they
   leave on the road), muzzle flashes and tracers, a bloom, abstract contacts (rings and points, never figures), people on foot, fires, a ring on a reported place, the marks an event leaves (shown
   from their chapter on), captions and camera moves; and, only while the reader has the site's sound on, a few sounds synthesised here. The data names everything; this code names nothing of the story.
   Everything is a function of the replay's time, so scrubbing shows the same picture as playing. Costs nothing while no event chapter is replayed and no mark is in view: its meshes are hidden. */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DEG = Math.PI / 180;

export function mount(ctx) {
  const { THREE, S, scene, camera, renderer, U, mk, data, mood, wake, reduced } = ctx;
  const E = data.events || { list: [], marks: [], shapes: {} };
  // the events belong to one city (Dwarka's story): in any other city's scene the layer does nothing at all
  if (E.city && ctx.cfg && ctx.cfg.id && E.city !== ctx.cfg.id) return { info: () => ({ city: ctx.cfg.id, off: true }) };
  const unitM = data.pathUnit || 0.5;
  const low = () => ctx.tier() === "low";
  const disposables = [], objects = [];
  const own = (o) => { o.frustumCulled = false; o.visible = false; o.userData.layer = "events"; ctx.add(o); objects.push(o); if (o.geometry) disposables.push(o.geometry); return o; };   // tagged, so a measurement can tell the layer's draws from the city's
  const info = { chapter: 0, sec: 0, units: 0, sprites: 0, streaks: 0, rings: 0, bloom: 0, marks: 0, steps: 0, shots: 0, sounds: 0, caption: "", stepMs: 0 };

  /* ---------- routes and actors, decoded once ---------- */
  function decode(q) {
    const n = q.length / 2, xs = new Float64Array(n), ns = new Float64Array(n), cum = new Float64Array(n);
    let x = q[0], y = q[1];
    for (let i = 0; i < n; i++) { if (i) { x += q[i * 2]; y += q[i * 2 + 1]; } xs[i] = x * unitM; ns[i] = y * unitM; if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ns[i] - ns[i - 1]); }
    return { xs, ns, cum, len: cum[n - 1] || 0 };
  }
  function along(r, s, side = 0) {     // [x, n, heading in radians (compass, of the route's forward direction)] at s metres along route r, `side` metres to its left
    const n = r.cum.length; s = clamp(s, 0, r.len);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
    const t = (s - r.cum[lo]) / Math.max(1e-6, r.cum[hi] - r.cum[lo]);
    const dx = r.xs[hi] - r.xs[lo], dn = r.ns[hi] - r.ns[lo], L = Math.hypot(dx, dn) || 1;
    return [lerp(r.xs[lo], r.xs[hi], t) - dn / L * side, lerp(r.ns[lo], r.ns[hi], t) + dx / L * side, Math.atan2(dx, dn)];
  }
  // a monotone cubic through the keyframes [[t, s], ...]: a smooth position, with no overshoot at a stop
  function curve(keys) {
    const k = keys.slice().sort((a, b) => a[0] - b[0]), n = k.length;
    if (n < 2) return () => (n ? k[0][1] : 0);
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / Math.max(1e-6, k[i + 1][0] - k[i][0]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    return (t) => {
      if (t <= k[0][0]) return k[0][1]; if (t >= k[n - 1][0]) return k[n - 1][1];
      let i = 0; while (t > k[i + 1][0]) i++;
      const h = k[i + 1][0] - k[i][0], u = (t - k[i][0]) / h, u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * k[i][1] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * k[i + 1][1] + (u3 - u2) * h * m[i + 1];
    };
  }
  const events = E.list.map((e) => {
    const routes = {}; for (const [id, r] of Object.entries(e.routes || {})) routes[id] = decode(r.pts);
    const actors = (e.actors || []).map((a) => {
      const units = []; for (const u of a.units || []) for (let i = 0; i < (u.n || 1); i++) units.push(u.shape);
      return { ...a, r: routes[a.route], units, head: curve(a.path || [[0, 0]]), stay: new Map((a.stay || []).map((s) => [s.unit, s])) };
    });
    const shots = (e.shots || []).slice().sort((a, b) => a[0] - b[0]);
    return { ...e, routes, actors, shots, byId: new Map(actors.map((a) => [a.id, a])) };
  });

  /* ---------- a unit's state at a time: position, heading, heat, and whether it is a wreck ---------- */
  function unitAt(ev, a, i, sec) {
    const st = a.stay.get(i), gap = a.gap || 30, lanes = a.lanes || 1;
    if (a.path && a.path.length && sec < a.path[0][0] - 1e-6) return null;      // not on the map before its first moment
    const row = Math.floor(i / lanes), lane = lanes > 1 ? ((i % lanes) - (lanes - 1) / 2) * 3.6 : 0;
    let s = a.head(sec) - row * gap;
    if (st && sec >= (st.from || 0)) s = st.s != null ? st.s : a.head(st.from || 0) - row * gap;
    if (s < 0 || s > a.r.len + 1) return null;
    const p = along(a.r, s, lane);
    // moving units are white-hot; the units that stay are a burning wreck or a cooling dark hull; the column cools and leaves at its fade
    let heat = (a.heat == null ? 1 : a.heat), dark = 0, burning = false;
    if (st && sec >= (st.from || 0)) {
      if (st.burning) { burning = true; dark = 0.55; heat = 0.85; }
      else { const k = smooth(st.from || 0, (st.from || 0) + 2.2, sec); heat = lerp(heat, 0.18, k); dark = k; }
    } else if (a.fade) { const k = smooth(a.fade[0], a.fade[1], sec); if (k >= 1) return null; heat *= 1 - k; }
    return { x: p[0], n: p[1], hd: p[2], s, heat, dark, burning, shape: a.units[i] };
  }

  /* ---------- the shapes: a hull, an optional turret and gun, merged into one box geometry per shape ---------- */
  const shapes = E.shapes || {};
  function boxParts(parts) {
    const P = [], N = [], A = [], I = [];
    for (const [w, h, l, cx, cy, cz, part] of parts) {
      const g = new THREE.BoxGeometry(w, h, l); g.translate(cx, cy + h / 2, cz);
      const base = P.length / 3, pa = g.attributes.position, na = g.attributes.normal;
      for (let i = 0; i < pa.count; i++) { P.push(pa.getX(i), pa.getY(i), pa.getZ(i)); N.push(na.getX(i), na.getY(i), na.getZ(i)); A.push(part, pa.getZ(i), pa.getY(i), 0); }
      const ix = g.index.array; for (let i = 0; i < ix.length; i++) I.push(base + ix[i]);
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); g.setAttribute("aPart", new THREE.Float32BufferAttribute(A, 4)); g.setIndex(I);
    return g;
  }
  function shapeGeometry(sh) {   // the shape's length runs along +z (its front), so a unit's rotation is its compass heading
    const parts = [[sh.w, sh.h, sh.l, 0, 0, 0, 0]];
    if (sh.turret) parts.push([sh.turret[1], sh.turret[2], sh.turret[0], 0, sh.h, -sh.l * 0.06, 1]);
    if (sh.barrel) { const front = sh.turret ? -sh.l * 0.06 + sh.turret[0] / 2 : sh.l / 2; parts.push([0.32, 0.32, sh.barrel, 0, sh.h + (sh.turret ? sh.turret[2] * 0.45 : 0), front + sh.barrel / 2, 2]); }
    return boxParts(parts);
  }
  const UNIT_VERT = /* glsl */`
attribute vec4 aPart;
attribute vec4 aInst;          // heat, dark, the largest it may be drawn (a multiple of its size), unused
uniform float uPxK;            // metres a pixel spans at one metre's distance
uniform float uMinPx;          // a unit is drawn at least this many pixels long (a thermal blip stays visible from high up)
uniform float uLen;
varying vec3 vPos; varying vec3 vN; varying vec4 vPart; varying vec4 vInst;
void main() {
  vec4 o = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sc = clamp(uMinPx * length(o.xyz - cameraPosition) * uPxK / uLen, 1.0, aInst.z);
  vec4 w = modelMatrix * instanceMatrix * vec4(position * sc, 1.0);
  vPos = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vPart = aPart; vInst = aInst;
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;
  const UNIT_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos; varying vec3 vN; varying vec4 vPart; varying vec4 vInst;
uniform float uLen;
${S.COMMON}
void main() {
  float heat = vInst.x, dark = vInst.y;
  vec3 n = normalize(vN);
  float top = clamp(n.y, 0.0, 1.0), rear = smoothstep(0.1 * uLen, -0.5 * uLen, vPart.y);
  // white-hot: the engine deck at the rear and the top run hottest, the sides a little cooler; a gun barrel is cool
  float t = heat * (0.70 + 0.30 * rear + 0.10 * top) * (vPart.x > 1.5 ? 0.45 : 1.0);
  vec3 hot = mix(vec3(1.0, 0.40, 0.10), vec3(1.0, 0.97, 0.90), smoothstep(0.30, 0.92, t)) * (0.10 + 2.7 * t) * (0.78 + 0.22 * top);
  // a dark hull (a wreck, a mark left behind): cold steel, an edge of the accent so it reads on the night map, and what warmth is left in it
  vec3 V = normalize(cameraPosition - vPos);
  float rim = pow(1.0 - abs(dot(n, V)), 2.0);
  vec3 cold = vec3(0.030, 0.031, 0.040) * (0.55 + 0.7 * top) + uAccent * (0.18 + rim * 0.75) * 0.6 + vec3(1.0, 0.36, 0.08) * heat * (0.35 + 0.65 * rear) * 1.1;
  gl_FragColor = vec4(applyFog(mix(hot, cold, dark), vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  const PX = { uPxK: { value: 0.001 }, uRes: { value: new THREE.Vector2(1, 1) } };
  const unitMesh = {};
  function capacity(shape) {
    let c = 0;
    for (const ev of events) { let k = 0; for (const a of ev.actors) if (a.kind === "convoy") k += a.units.filter((u) => u === shape).length; c = Math.max(c, k); }
    c += (E.marks || []).filter((m) => m.shape === shape).length;
    for (const ev of events) for (const f of ev.effects || []) if (f.kind === "walkers" && shape === "person") c = Math.max(c, f.n || 4);
    return c;
  }
  for (const [name, sh] of Object.entries(shapes)) {
    const cap = capacity(name); if (!cap) continue;
    const g = shapeGeometry(sh), inst = new Float32Array(cap * 4);
    g.setAttribute("aInst", new THREE.InstancedBufferAttribute(inst, 4));
    const mat = mk(UNIT_VERT, UNIT_FRAG, { uPxK: PX.uPxK, uMinPx: { value: name === "person" ? 3.5 : 7 }, uLen: { value: sh.l } });
    const m = own(new THREE.InstancedMesh(g, mat, cap)); m.count = 0; m.renderOrder = 6;
    unitMesh[name] = { m, inst, cap, n: 0, maxScale: name === "person" ? 4.5 : name === "bus" ? 2.4 : 3.2 };
  }
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let unitsAsModels = 0;      // the units drawn this frame as their models rather than their boxes (info.units counts both)
  function putUnit(shape, x, n, hd, heat, dark, y = 0) {
    const u = unitMesh[shape]; if (!u) return;
    const inst = [heat, dark, u.maxScale * (ctx.size.w && ctx.size.w < 700 ? 1.8 : 1), 0];      // on a phone's small map a unit may be drawn larger (the column becomes one bright line)
    const key = modelFor(shape, dark);
    if (key && putModel(key, x, y, n, hd, inst)) { unitsAsModels++; return; }                     // its model, once loaded; the box until then (or if it never loads)
    if (u.n >= u.cap) return;
    q4.setFromAxisAngle(up, Math.PI - hd);        // three's yaw: a compass heading of 0 (north) is -z, 90 (east) is +x; the shape's front is +z
    m4.compose(v3.set(x, y, -n), q4, s3); u.m.setMatrixAt(u.n, m4);
    u.inst.set(inst, u.n * 4); u.n++;
  }

  /* ---------- the models (5 November 2026): the author's Tripo models, made light and real-sized (artwork/models/map_models.json: metres, +Y up, front along +Z, origin on the
     ground), drawn in place of a shape's box once loaded, and as the figures and the aircraft the data names. Loaded only when a chapter on the map needs them; the box stays if a
     file cannot be had (or the reader asks the browser to save data). Lit by the city's own light (sun or moon, sky, ground bounce, the accent at an edge, fog), the texture as
     the colour; far off a live unit keeps its thermal blip by night. Parts named "turret" and "rotor_main" turn about their own pivots (aRot). ---------- */
  const MD = E.models && E.models.url ? E.models : null;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const MODELS = {};          // key -> { state: 0 wanted never, 1 loading, 2 ready, 3 failed, parts, a, aI, n, cap, len, kind }
  let modelsVer = 0, loader = null, gone = false;
  const FIG = (E.figures || []).filter((f) => MD && MD.url[f.model]), AIR = (E.air || []).filter((a) => MD && MD.url[a.model]);
  if (MD) {
    const cap = {};
    const addCap = (k, c) => { if (k && MD.url[k]) cap[k] = (cap[k] || 0) + c; };
    for (const [shape, keys] of Object.entries(MD.shapes || {})) for (const k of keys || []) addCap(k, unitMesh[shape] ? unitMesh[shape].cap : 0);
    let nc = 0; for (const ev of events) for (const f of ev.effects || []) if (f.kind === "contacts") nc = Math.max(nc, f.n || 12);
    for (const k of MD.contacts || []) addCap(k, nc);
    for (const f of FIG) addCap(f.model, 1);
    for (const a of AIR) addCap(a.model, 1);
    for (const [k, c] of Object.entries(cap)) if (c > 0) MODELS[k] = { state: 0, cap: c, n: 0, parts: [] };
  }
  info.models = 0; info.modelsDrawn = 0; info.modelErr = "";
  function want(key) {
    const m = MODELS[key]; if (!m || m.state) return m && m.state === 2;
    if (saveData) { m.state = 3; return false; }
    m.state = 1;
    if (!loader) loader = import("three/addons/loaders/GLTFLoader.js").then((x) => new x.GLTFLoader());
    loader.then((L) => L.loadAsync(MD.url[key])).then((gltf) => { if (gone) return; buildModel(key, gltf); m.state = 2; modelsVer++; info.models++; wake(400); })
      .catch((e) => { m.state = 3; info.modelErr = String((e && e.message) || e).slice(0, 160); });
    return false;
  }
  function modelFor(shape, dark) {
    if (!MD || !MD.shapes || !MD.shapes[shape]) return null;
    const [live, dk] = MD.shapes[shape], key = dark > 0.5 && dk ? dk : live;
    return key && want(key) ? key : null;
  }
  const MODEL_VERT = /* glsl */`
attribute vec4 aInst; attribute float aRot; attribute float aSoot;
uniform float uPxK; uniform float uMinPx; uniform float uLen; uniform vec3 uPivot;
varying vec3 vPos; varying vec3 vN; varying vec3 vObj; varying vec4 vI; varying vec2 vUv; varying float vSoot;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec4 o = M * vec4(0.0, 0.0, 0.0, 1.0);
  float sc = clamp(uMinPx * length(o.xyz - cameraPosition) * uPxK / uLen, 1.0, max(aInst.z, 1.0));
  float c = cos(aRot), s = sin(aRot);
  vec3 p = position - uPivot; p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + uPivot;
  vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  vec4 w = M * vec4(p * sc, 1.0);
  vPos = w.xyz; vN = normalize(mat3(M) * n); vObj = p; vI = aInst; vUv = uv; vSoot = aSoot;
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;
  const MODEL_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos; varying vec3 vN; varying vec3 vObj; varying vec4 vI; varying vec2 vUv; varying float vSoot;
uniform sampler2D uMap; uniform float uKind; uniform float uLen; uniform float uT; uniform vec3 uBounce; uniform float uDayK;
${S.COMMON}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  float dayK = uDayK, heat = vI.x, dark = vI.y;
  vec3 N = normalize(vN), V = normalize(cameraPosition - vPos);
  vec3 tx = texture2D(uMap, vUv).rgb, alb = srgb(tx) * vSoot;
  float dist = length(vPos - cameraPosition);
  float ao = (0.78 + 0.22 * smoothstep(-0.3, 0.6, N.y)) * mix(0.55, 1.0, smoothstep(0.0, 0.8, vObj.y));
  bool asura = uKind > 0.5 && uKind < 1.5;
  float ndl = dot(N, uSunDir);
  vec3 key = uSunCol * uSunI * max(ndl * 0.82 + 0.18, 0.0), sky = uSkyCol * (0.46 + 0.54 * N.y), gnd = uBounce * (0.30 * max(-N.y, 0.0) + 0.10);
  vec3 wash = uAccent * 0.38 * (1.0 - dayK) * (0.30 + 0.70 * max(N.y, 0.0));          // by night a little of the city's accent, so a unit reads on the dark map
  vec3 col = alb * (key + sky + gnd + wash) * ao * mix(1.9, 1.0, dayK);
  float spec = asura ? 0.10 : 0.07, gloss = asura ? 14.0 : 18.0;
  vec3 H = normalize(uSunDir + V); float nv = max(dot(N, V), 0.0);
  col += uSunCol * uSunI * pow(max(dot(N, H), 0.0), gloss) * spec * max(ndl, 0.0) * ao;
  col += fogColor(reflect(-V, N)) * (0.02 + 0.5 * pow(1.0 - nv, 4.0)) * spec * ao;
  col += uAccent * pow(1.0 - nv, 3.0) * 0.30 * (1.0 - 0.75 * dayK) * ao;              // the accent along an edge, as the city's roofs have it
  if (asura) {
    // the ember cracks painted into the texture (orange, not the duller bronze) give a little light of their own by night; far off a little of it stays, so a night shows where one stands
    float em = smoothstep(0.42, 0.66, tx.r - tx.b) * smoothstep(0.5, 0.8, tx.r);
    col += srgb(tx) * em * (0.35 + 2.4 * (1.0 - dayK)) * (0.88 + 0.12 * sin(uT * 0.7 + vObj.y * 2.0));
    col += vec3(1.0, 0.30, 0.07) * 0.22 * smoothstep(150.0, 1500.0, dist) * (1.0 - dayK);
  } else {
    float rearTop = smoothstep(-0.1 * uLen, -0.4 * uLen, vObj.z) * smoothstep(0.6, 1.4, vObj.y);
    col += vec3(1.0, 0.42, 0.14) * heat * (1.0 - dark) * 0.22 * rearTop * (1.0 - 0.8 * dayK);                       // a running engine's deck, warm
    float burn = smoothstep(0.3, 0.5, dark) * (1.0 - smoothstep(0.8, 0.95, dark)) * step(0.5, heat);
    col += vec3(1.0, 0.42, 0.10) * burn * rearTop * 2.2 * (0.78 + 0.22 * sin(uT * 13.0 + vPos.x * 0.7) * sin(uT * 7.3 + vPos.z));   // a burning wreck
    // from far off a live unit goes over to the layer's thermal blip, so the night still shows where the column is
    float farT = smoothstep(120.0, 650.0, dist);
    col += mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.85), farT) * heat * (1.0 - dark) * farT * 3.2 * (1.0 - dayK)
         + uAccent * smoothstep(200.0, 1400.0, dist) * 0.25 * (1.0 - dayK) * ((1.0 - dark) * 0.5 + 0.5) * (uKind > 1.5 ? 0.0 : 1.0);
  }
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  // the day's shadows of the models: the city's own way (SHADOW_FRAG: drawn flattened along the sun, each pixel darkened once through the stencil), only while the city draws its own
  const SH_VERT = /* glsl */`
attribute vec4 aInst; attribute float aRot; uniform float uPxK; uniform float uMinPx; uniform float uLen; uniform vec3 uPivot;
uniform vec2 uShK; uniform vec3 uShTint; uniform vec4 uShFade; varying vec3 vS;
void main() {
  mat4 M = modelMatrix * instanceMatrix; vec4 o = M * vec4(0.0, 0.0, 0.0, 1.0);
  float sc = clamp(uMinPx * length(o.xyz - cameraPosition) * uPxK / uLen, 1.0, max(aInst.z, 1.0));
  float c = cos(aRot), s = sin(aRot); vec3 q = position - uPivot; q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) + uPivot;
  vec4 w = M * vec4(q * sc, 1.0);
  vec3 p = vec3(w.x - uShK.x * w.y, 0.4, w.z - uShK.y * w.y);
  float d = length(p - cameraPosition);
  vS = mix(vec3(1.0), uShTint, uShFade.w * (1.0 - smoothstep(uShFade.x, uShFade.y, d)) * exp(-uShFade.z * d));
  gl_Position = projectionMatrix * (viewMatrix * vec4(p, 1.0));
}`;
  const shU = { uShK: { value: new THREE.Vector2() }, uShTint: { value: new THREE.Vector3(1, 1, 1) }, uShFade: { value: new THREE.Vector4(3400, 5200, 0, 0) } };
  let shadowOn = false;
  const uT = { value: 0 };
  function buildModel(key, gltf) {
    const m = MODELS[key];
    gltf.scene.updateMatrixWorld(true);
    const nodes = []; gltf.scene.traverse((o) => { if (o.isMesh) nodes.push(o); });
    const box = new THREE.Box3(); for (const o of nodes) box.expandByObject(o);
    const size = box.getSize(new THREE.Vector3());
    m.len = Math.max(size.x, size.z, 1); m.kind = /^asura|^mythic/.test(key) ? 1 : /helicopter/.test(key) ? 2 : 0;
    m.a = new Float32Array(m.cap * 4); m.aI = new THREE.InstancedBufferAttribute(m.a, 4);
    for (const o of nodes) {
      const g = o.geometry.clone(), pivot = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), part = o.name === "turret" || o.name === "rotor_main";
      g.applyMatrix4(o.matrixWorld);
      const nv = g.attributes.position.count, soot = new Float32Array(nv).fill(1);
      if (g.attributes.color) { const c = g.attributes.color; for (let i = 0; i < nv; i++) soot[i] = c.getX(i); g.deleteAttribute("color"); }       // the disabled tank's soot multiplies its texture
      g.setAttribute("aSoot", new THREE.BufferAttribute(soot, 1)); g.setAttribute("aInst", m.aI);
      const rot = new Float32Array(m.cap); g.setAttribute("aRot", new THREE.InstancedBufferAttribute(rot, 1));
      const map = o.material.map; map.colorSpace = THREE.NoColorSpace; map.anisotropy = 4; map.needsUpdate = true; disposables.push(map);
      const uni = { uPxK: PX.uPxK, uMinPx: { value: m.kind === 1 ? 5 : m.kind === 2 ? 4 : 7 }, uLen: { value: m.len }, uPivot: { value: part ? pivot : new THREE.Vector3() }, uMap: { value: map }, uKind: { value: m.kind }, uT, uBounce: U.uBounce, uDayK: U.uMix };
      const mesh = own(new THREE.InstancedMesh(g, mk(MODEL_VERT, MODEL_FRAG, uni), m.cap)); mesh.count = 0; mesh.renderOrder = 6; mesh.userData.model = key;
      const sm = mk(SH_VERT, S.SHADOW_FRAG, { ...shU, uPxK: PX.uPxK, uMinPx: uni.uMinPx, uLen: uni.uLen, uPivot: uni.uPivot },
        { transparent: true, depthWrite: false, stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, stencilZPass: THREE.IncrementStencilOp, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
          blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, toneMapped: false });
      const shadow = own(new THREE.InstancedMesh(g, sm, m.cap)); shadow.instanceMatrix = mesh.instanceMatrix; shadow.count = 0; shadow.renderOrder = -29; shadow.userData.model = key; shadow.userData.shadow = true;
      m.parts.push({ mesh, shadow, rot, name: o.name });
    }
  }
  function putModel(key, x, y, n, hd, inst, matrix = null, rotor = 0) {
    const m = MODELS[key]; if (!m || m.state !== 2 || m.n >= m.cap) return false;
    if (!matrix) { q4.setFromAxisAngle(up, Math.PI - hd); m4.compose(v3.set(x, y, -n), q4, s3); }
    for (const p of m.parts) { p.mesh.setMatrixAt(m.n, matrix || m4); p.rot[m.n] = p.name === "rotor_main" ? rotor : 0; }
    m.a.set(inst, m.n * 4); m.n++; return true;
  }
  function flushModels() {
    const sd = U.uSunDir.value, el = Math.asin(clamp(sd.y, -1, 1)) / DEG, k = clamp((el - 3) / 6, 0, 1), st = k * k * (3 - 2 * k);
    shadowOn = !!ctx.state.shadows && st > 0;
    if (shadowOn) {
      const sky = U.uSkyCol.value, upd = U.uUpDay.value;
      shU.uShK.value.set(sd.x / Math.max(sd.y, 0.05), sd.z / Math.max(sd.y, 0.05));
      shU.uShTint.value.set(sky.x / Math.max(upd.x, 1e-3), sky.y / Math.max(upd.y, 1e-3), sky.z / Math.max(upd.z, 1e-3)).lerp(new THREE.Vector3(1, 1, 1), 0.22);
      shU.uShFade.value.set(3400, 5200, U.uFogBase.value * 2, st);
    }
    let drawn = 0;
    for (const m of Object.values(MODELS)) {
      if (m.state !== 2) continue; drawn += m.n;
      for (const p of m.parts) {
        p.mesh.count = m.n; p.mesh.visible = m.n > 0; p.shadow.count = m.n; p.shadow.visible = m.n > 0 && shadowOn && m.kind !== 2;      // an aircraft casts none: from hundreds of metres up it would fall far off, faint, and cost a millisecond
        if (m.n) { p.mesh.instanceMatrix.needsUpdate = true; p.mesh.geometry.attributes.aRot.needsUpdate = true; m.aI.needsUpdate = true; }
      }
    }
    info.modelsDrawn = drawn;
  }
  // the figures the data places for a chapter's replay (an asura where the book has one; only while that chapter is replayed), and the aircraft from their chapter on.
  // `from: "tear"`: in its first chapter's replay a figure stands only once the tear has opened (the four-storey one is the first thing through it, Chapter Six, 5 November)
  const tearOpen = () => { const k = ctx.state.crack; return !k || k.shown !== false; };
  const figuresAt = (ch) => (ch ? FIG.filter((f) => ch >= f.ch && ch <= (f.until || f.ch) && !(f.from === "tear" && ch === f.ch && !tearOpen())) : []);
  const airAt = (ch) => AIR.filter((a) => !(ch && ch < a.ch));
  let airT = 0;
  const AIR_AWAKE = 9000;     // ms after the reader last moved the map: the aircraft fly while the map is being looked at, and hold still while it rests (the map draws nothing then)
  function airCentre(a) {
    if (a.around === "tear") { const t = ctx.state.tear; return t && t.placed !== false ? [t.x, t.n] : null; }
    return Array.isArray(a.around) ? a.around : null;
  }
  const e3 = new THREE.Euler(0, 0, 0, "YXZ"), lv = new THREE.Vector3();
  // an aircraft's lights: a flashing red beacon on top and one below, a white strobe at the tail, steady red (left) and green (right) side lights; the same few pixels near and far
  const LIGHTS = [[0, 3.95, -1.0, 1, 0.12, 0.08, 1], [0, 0.85, 2.6, 1, 0.12, 0.08, 1], [0, 3.6, -7.3, 1, 1, 1, 2], [2.35, 1.5, 0.6, 1, 0.1, 0.06, 0], [-2.35, 1.5, 0.6, 0.15, 1, 0.3, 0]];
  const NL = Math.max(1, AIR.length) * LIGHTS.length, lp = new Float32Array(NL * 3), lc = new Float32Array(NL * 3), lb = new Float32Array(NL);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(lp, 3)); lg.setAttribute("aCol", new THREE.BufferAttribute(lc, 3)); lg.setAttribute("aBlink", new THREE.BufferAttribute(lb, 1));
  const navLights = own(new THREE.Points(lg, mk(/* glsl */`
attribute vec3 aCol; attribute float aBlink; uniform float uT; uniform float uPx; uniform float uDayK; varying vec3 vC; varying float vA;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float on = 1.0;
  if (aBlink > 0.5 && aBlink < 1.5) on = step(0.72, fract(uT * 1.1));
  if (aBlink > 1.5) { float f = fract(uT * 0.85); on = step(0.90, f) * (1.0 - step(0.94, f)) + step(0.97, f); }
  vC = aCol; vA = on * (1.0 - 0.8 * uDayK); gl_PointSize = (aBlink > 1.5 ? 9.0 : 7.0) * uPx * clamp(260.0 / -mv.z, 0.85, 1.6); }`, /* glsl */`
precision highp float;
varying vec3 vC; varying float vA;
void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC * a * 1.8, a); }`,
  { uT, uPx: { value: renderer.getPixelRatio() }, uDayK: U.uMix }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
  navLights.renderOrder = 26;
  function putAir(ch, flying) {
    let nl = 0;
    for (const a of airAt(ch)) {
      const c = airCentre(a); if (!c || !want(a.model)) continue;
      const dir = a.dir || 1, w = (2 * Math.PI / (a.period || 150)) * dir, an = (a.phase || 0) * DEG + airT * w;
      const x = c[0] + Math.sin(an) * a.r, n = c[1] + Math.cos(an) * a.r;
      const along = Math.atan2(Math.cos(an) * dir, -Math.sin(an) * dir), towards = Math.atan2(c[0] - x, c[1] - n), inward = a.face === "in";
      e3.set(inward ? 0.03 : 0.10, Math.PI - (inward ? towards : along), (inward ? 0 : -0.12 * dir) + 0.02 * Math.sin(airT * 0.9 + an), "YXZ");
      m4.compose(v3.set(x, (a.alt || 200) + 1.5 * Math.sin(airT * 0.6 + (a.phase || 0)), -n), q4.setFromEuler(e3), s3);
      if (!putModel(a.model, 0, 0, 0, 0, [0, 0, a.maxScale || 4, 1], m4, flying || !reduced() ? airT * (a.rpm || 1.6) * 2 * Math.PI : 0)) continue;
      LIGHTS.forEach((L, j) => { lv.set(L[0], L[1], L[2]).applyMatrix4(m4); const i = nl * LIGHTS.length + j; lp.set([lv.x, lv.y, lv.z], i * 3); lc.set([L[3], L[4], L[5]], i * 3); lb[i] = L[6]; });
      nl++;
    }
    lg.setDrawRange(0, nl * LIGHTS.length); navLights.visible = nl > 0;
    if (nl) for (const k of ["position", "aCol", "aBlink"]) lg.attributes[k].needsUpdate = true;
    return nl;
  }
  function putFigures(ch) {
    for (const f of figuresAt(ch)) if (want(f.model)) putModel(f.model, f.x, 0, f.n, (f.heading || 0) * DEG, [0, 0, 1, f.seed || 1]);
  }

  /* ---------- glows (points), streaks (tracers), rings (contacts, reports, shock waves), the heat on the road, the bloom ---------- */
  const NSPR = low() ? 220 : 520, NSTR = low() ? 40 : 110, NRING = 72;
  const spr = { pos: new Float32Array(NSPR * 3), col: new Float32Array(NSPR * 4), size: new Float32Array(NSPR), n: 0 };
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(spr.pos, 3)); sg.setAttribute("aCol", new THREE.BufferAttribute(spr.col, 4)); sg.setAttribute("aSize", new THREE.BufferAttribute(spr.size, 1));
  const sprites = own(new THREE.Points(sg, mk(/* glsl */`
attribute vec4 aCol; attribute float aSize;
uniform float uPxK;
varying vec4 vCol; varying vec3 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz;
  vec4 mv = viewMatrix * w;
  gl_PointSize = clamp(aSize / max(-mv.z * uPxK, 1e-4), 2.0, 160.0);
  vCol = aCol; gl_Position = projectionMatrix * mv;
}`, /* glsl */`
precision highp float;
varying vec4 vCol; varying vec3 vPos;
${S.COMMON}
void main() {
  vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.0;
  float a = exp(-r * r * 3.6) * (1.0 - smoothstep(0.8, 1.0, r)) * vCol.a;
  vec3 c = mix(vCol.rgb, fogColor(normalize(vPos - cameraPosition)), clamp(length(vPos - cameraPosition) / 26000.0, 0.0, 0.6));
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`, { uPxK: PX.uPxK }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  sprites.renderOrder = 26;
  function glow(x, y, n, size, r, g, b, a) {
    if (spr.n >= NSPR || a <= 0.004) return; const i = spr.n++;
    spr.pos[i * 3] = x; spr.pos[i * 3 + 1] = y; spr.pos[i * 3 + 2] = -n; spr.size[i] = size; spr.col.set([r, g, b, a], i * 4);
  }
  // tracers: a ribbon between two points, a few pixels wide whatever the distance, brighter at its head
  const str = { a: new Float32Array(NSTR * 3), b: new Float32Array(NSTR * 3), col: new Float32Array(NSTR * 4), w: new Float32Array(NSTR), n: 0 };
  const tg = new THREE.InstancedBufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3)); tg.setIndex([0, 1, 2, 0, 2, 3]);
  tg.setAttribute("aA", new THREE.InstancedBufferAttribute(str.a, 3)); tg.setAttribute("aB", new THREE.InstancedBufferAttribute(str.b, 3));
  tg.setAttribute("aCol", new THREE.InstancedBufferAttribute(str.col, 4)); tg.setAttribute("aW", new THREE.InstancedBufferAttribute(str.w, 1)); tg.instanceCount = 0;
  const streaks = own(new THREE.Mesh(tg, mk(/* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec4 aCol; attribute float aW;
uniform vec2 uRes;
varying vec4 vCol; varying float vT; varying float vS;
void main() {
  vec4 a = projectionMatrix * (viewMatrix * vec4(aA, 1.0)), b = projectionMatrix * (viewMatrix * vec4(aB, 1.0));
  vec2 sa = a.xy / max(a.w, 1e-3), sb = b.xy / max(b.w, 1e-3);
  vec2 d = (sb - sa) * uRes; float L = length(d); d = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec4 c = mix(a, b, position.x);
  c.xy += vec2(-d.y, d.x) * position.y * aW / uRes * c.w;
  vCol = aCol; vT = position.x; vS = position.y; gl_Position = c;
}`, /* glsl */`
precision highp float;
varying vec4 vCol; varying float vT; varying float vS;
void main() {
  float a = (1.0 - vS * vS) * mix(0.08, 1.0, vT * vT) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`, { uRes: PX.uRes }, { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  streaks.renderOrder = 25;
  function streak(ax, ay, an, bx, by, bn, w, r, g, b, a) {
    if (str.n >= NSTR || a <= 0.004) return; const i = str.n++;
    str.a.set([ax, ay, -an], i * 3); str.b.set([bx, by, -bn], i * 3); str.w[i] = w; str.col.set([r, g, b, a], i * 4);
  }
  // rings on the ground: a thin ring, a dashed ring, or a soft disc
  const rng = { c: new Float32Array(NRING * 4), col: new Float32Array(NRING * 4), k: new Float32Array(NRING), n: 0 };
  const rg = new THREE.InstancedBufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); rg.setIndex([0, 2, 1, 0, 3, 2]);
  rg.setAttribute("aC", new THREE.InstancedBufferAttribute(rng.c, 4)); rg.setAttribute("aCol", new THREE.InstancedBufferAttribute(rng.col, 4)); rg.setAttribute("aKind", new THREE.InstancedBufferAttribute(rng.k, 1)); rg.instanceCount = 0;
  const rings = own(new THREE.Mesh(rg, mk(/* glsl */`
attribute vec4 aC; attribute vec4 aCol; attribute float aKind;
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vPos; varying float vR; varying float vTh;
void main() {
  vec3 w = vec3(aC.x + position.x * aC.z * 1.2, 0.8, aC.y + position.z * aC.z * 1.2);
  vUv = position.xz * 1.2; vCol = aCol; vKind = aKind; vPos = w; vR = aC.z; vTh = aC.w;
  gl_Position = projectionMatrix * (viewMatrix * vec4(w, 1.0));
}`, /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vPos; varying float vR; varying float vTh;
uniform float uPxK;
${S.COMMON}
void main() {
  float r = length(vUv), a;
  float th = max(vTh, 1.6 * length(vPos - cameraPosition) * uPxK / max(vR, 1.0));   // a ring stays at least a pixel and a half wide
  if (vKind > 1.5) a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.92, 1.18, r));
  else { a = 1.0 - smoothstep(0.0, th, abs(r - 1.0)); if (vKind > 0.5) a *= step(0.45, fract(atan(vUv.y, vUv.x) / 6.28318 * 28.0)); }
  a *= vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`, { uPxK: PX.uPxK }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  rings.renderOrder = 18;
  function ring(x, n, radius, th, kind, r, g, b, a) {
    if (rng.n >= NRING || a <= 0.004) return; const i = rng.n++;
    rng.c.set([x, -n, radius, th], i * 4); rng.col.set([r, g, b, a], i * 4); rng.k[i] = kind;
  }
  // the heat a convoy leaves on the road behind it (a ribbon along each event's route, lit only between its tail and a few hundred metres behind)
  const WAKE_VERT = /* glsl */`
attribute float aS; attribute vec3 aSide;      // the side's direction on the ground (x, z) and which side (-1, 1)
uniform float uPxK;
varying float vS; varying vec3 vPos; varying float vAcross;
void main() {
  float d = length(position - cameraPosition);
  float hw = max(4.0, 2.2 * d * uPxK);
  vec3 w = position + vec3(aSide.x, 0.0, aSide.y) * hw;
  vS = aS; vPos = w; vAcross = aSide.z;
  gl_Position = projectionMatrix * (viewMatrix * vec4(w, 1.0));
}`;
  const WAKE_FRAG = /* glsl */`
precision highp float;
varying float vS; varying vec3 vPos; varying float vAcross;
uniform vec4 uWake;     // tail, head, how far the heat lasts where the units have been (negative: they are reversing, so it lies beyond the head), strength
${S.COMMON}
void main() {
  float s = vS, tail = uWake.x, head = uWake.y;
  float under = step(tail, s) * step(s, head);
  float behind = uWake.z > 0.0 ? (s < tail ? exp(-(tail - s) / uWake.z) : 0.0) : (s > head ? exp(-(s - head) / max(-uWake.z, 1.0)) : 0.0);
  float a = (under * 0.55 + behind * 0.5) * uWake.w * (1.0 - vAcross * vAcross * 0.7);
  vec3 c = mix(vec3(1.0, 0.36, 0.10), vec3(1.0, 0.8, 0.55), under) * a;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  function wakeMesh(r) {
    const n = r.cum.length, P = new Float32Array(n * 2 * 3), SS = new Float32Array(n * 2), SD = new Float32Array(n * 2 * 3), I = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = r.xs[b] - r.xs[a], dn = r.ns[b] - r.ns[a]; const L = Math.hypot(dx, dn) || 1; dx /= L; dn /= L;
      for (let k = 0; k < 2; k++) { const sgn = k ? 1 : -1; P.set([r.xs[i], 0.5, -r.ns[i]], (i * 2 + k) * 3); SS[i * 2 + k] = r.cum[i]; SD.set([-dn * sgn, -dx * sgn, sgn], (i * 2 + k) * 3); }
      if (i < n - 1) { const v = i * 2; I.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("aS", new THREE.BufferAttribute(SS, 1)); g.setAttribute("aSide", new THREE.BufferAttribute(SD, 3)); g.setIndex(I);
    const mesh = own(new THREE.Mesh(g, mk(WAKE_VERT, WAKE_FRAG, { uPxK: PX.uPxK, uWake: { value: new THREE.Vector4(0, 0, 300, 0) } }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
    mesh.renderOrder = 17; return mesh;
  }
  for (const ev of events) for (const a of ev.actors) if (a.kind === "convoy" && a.r && (a.heat == null || a.heat > 0.6)) a.wake = wakeMesh(a.r);
  // the bloom: a flower of light that faces the camera, white at first and cooling as it opens
  const bloomMat = mk(/* glsl */`
uniform vec3 uCenter; uniform float uSize;
varying vec2 vUv;
void main() { vUv = position.xy; vec4 mv = viewMatrix * vec4(uCenter, 1.0); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`, /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uAge; uniform float uFlower; uniform float uSeed;
void main() {
  float r = length(vUv), ang = atan(vUv.y, vUv.x);
  float petals = mix(1.0, 0.70 + 0.30 * pow(abs(cos(ang * 3.5 + uSeed + 0.35 * sin(ang * 2.0 + uSeed))), 0.8), uFlower);
  float body = smoothstep(petals, petals * 0.72, r) * (0.55 + 0.45 * smoothstep(0.15, 0.7, r / petals)), core = exp(-r * r * 30.0), halo = exp(-r * r * 2.5) * 0.18;
  float cool = smoothstep(0.12, 0.85, uAge);
  vec3 c = mix(vec3(1.0, 0.985, 0.95), vec3(1.0, 0.52, 0.16), cool * smoothstep(0.1, 0.9, r)) * (body * 0.85 + core * 2.4 + halo) * (1.0 - smoothstep(0.35, 1.0, uAge));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`, { uCenter: { value: new THREE.Vector3() }, uSize: { value: 10 }, uAge: { value: 0 }, uFlower: { value: 1 }, uSeed: { value: 0.4 } }, { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const bloom = own(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bloomMat)); bloom.renderOrder = 27;
  // a shed strip beside a mark (what a wreck has lost: drawn from the mark's `shed`)
  const shedMat = mk(S.SOLID_VERT, /* glsl */`
precision highp float;
varying vec3 vPos; varying vec3 vN;
uniform float uDayK;
${S.COMMON}
void main() { vec3 c = mix(vec3(0.028, 0.029, 0.036) * (0.6 + 0.5 * clamp(vN.y, 0.0, 1.0)) + uAccent * 0.08, vec3(0.085, 0.080, 0.074) * (0.55 + 0.45 * clamp(vN.y, 0.0, 1.0)), uDayK);
  gl_FragColor = vec4(applyFog(c, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`, { uDayK: U.uMix });
  // a track lying on the road: a chain of pads (with a pin gone here and there), along a slight wave
  function shedGeometry(w, len) {
    const parts = [], stp = 0.21;
    for (let k = 0, z = -len / 2; z < len / 2; k++, z += stp) if (k % 23 !== 17) parts.push([w * 0.96, 0.07, stp * 0.82, 0.16 * Math.sin(z * 0.42) + 0.05 * Math.sin(k * 2.3), 0.005 + 0.025 * Math.abs(Math.sin(k * 0.7)), z, 0]);
    return boxParts(parts);
  }
  const sheds = (E.marks || []).filter((m) => m.shed).map((m) => {
    const sh = m.shed, g = shedGeometry(sh.w || 0.6, sh.len || 8);
    const mesh = own(new THREE.Mesh(g, shedMat)); const h = (m.heading || 0) * DEG;
    // behind the hull along its heading (`along` negative is behind), a little to one side
    mesh.position.set(m.x + Math.sin(h) * (sh.along || -10) + Math.cos(h) * (sh.side || 0), 0, -(m.n + Math.cos(h) * (sh.along || -10) - Math.sin(h) * (sh.side || 0)));
    mesh.rotation.y = Math.PI - h + 0.06; return { m, mesh };
  });

  /* ---------- effects at a time ---------- */
  const unitsOf = (ev, a, sec) => a.units.map((_, i) => unitAt(ev, a, i, sec));
  function contactsAt(ev, f, sec, units) {    // points that close in on the target (rings and dots; an asura figure stands on each when the models ship)
    const out = [], n = f.n || 12, [r0, r1] = f.r || [400, 1000], c = f.around || [0, 0];
    const live = units.filter((u) => u && !u.dark);
    const k = smooth(f.t[0], f.t[1], sec);
    for (let i = 0; i < n; i++) {
      const b = (f.bearings || [[0, 30]])[i % (f.bearings || [[0, 30]]).length], hs = hash(i * 7.3 + (f.seed || 1));
      const ang = (b[0] + (hs * 2 - 1) * b[1]) * DEG, rad = lerp(r0, r1, hash(i * 3.1 + (f.seed || 1) * 1.7));
      const x0 = c[0] + Math.sin(ang) * rad, n0 = c[1] + Math.cos(ang) * rad;
      // the nearest live unit is what it closes on
      let tx = c[0], tn = c[1], bd = 1e18;
      for (const u of live) { const d = (u.x - x0) ** 2 + (u.n - n0) ** 2; if (d < bd) { bd = d; tx = u.x; tn = u.n; } }
      let reach = 0.62 * k + 0.1 * hash(i * 9.7);
      let x = lerp(x0, tx, reach), y = lerp(n0, tn, reach), a = smooth(f.t[0], f.t[0] + 1.2, sec) * (1 - smooth(f.t[1] - 1.0, f.t[1], sec));
      if (f.follow && i % 2 === 0 && sec > f.follow[0] && live.length) {    // some follow the engines when they go
        const tail = live.reduce((m, u) => (u.s > m.s ? u : m), live[0]);
        const kf = smooth(f.follow[0], f.follow[0] + 2.5, sec), back = 70 + 40 * hash(i);
        const fx = tail.x + Math.sin(tail.hd) * back + (hash(i * 5.1) - 0.5) * 60, fn = tail.n + Math.cos(tail.hd) * back + (hash(i * 6.3) - 0.5) * 60;
        x = lerp(x, fx, kf); y = lerp(y, fn, kf); a *= 1 - smooth(f.follow[1] - 0.8, f.follow[1], sec);
      }
      out.push({ x, n: y, a, ph: hash(i * 4.4), hd: Math.atan2(tx - x, tn - y) });     // hd: the compass heading towards what it closes on (a figure faces it)
    }
    return out;
  }
  // a burst schedule: for each unit, bursts every `every` seconds with a little jitter, each burst a few evenly spaced shots
  function burstsNear(f, ui, sec, back) {
    const out = [], ev = f.every || 1, k0 = Math.max(0, Math.floor((sec - f.t[0] - back) / ev)), k1 = Math.floor((sec - f.t[0]) / ev);
    for (let k = k0; k <= k1; k++) { const t = f.t[0] + k * ev + hash(ui * 13.1 + k * 3.7) * ev * 0.7; if (t <= f.t[1] && t <= sec && t >= sec - back) out.push({ t, k }); }
    return out;
  }
  function aim(f, ui, k, u, contacts) {    // a bearing within the effect's sectors, or the nearest contact inside them
    const secs = f.bearings || [[hash(ui + k) * 360, 180]], b = secs[(ui + k) % secs.length];
    let ang = (b[0] + (hash(ui * 2.3 + k * 1.9) * 2 - 1) * b[1]) * DEG, dist = 260 + 260 * hash(ui + k * 5.5);
    if (contacts && contacts.length) {
      let best = null, bd = 1e18;
      for (const c of contacts) { if (c.a < 0.2) continue; const a = Math.atan2(c.x - u.x, c.n - u.n), da = Math.abs((((a / DEG - b[0]) % 360) + 540) % 360 - 180); const d = (c.x - u.x) ** 2 + (c.n - u.n) ** 2; if (da <= b[1] + 10 && d < bd) { bd = d; best = { a, d: Math.sqrt(d) }; } }
      if (best && hash(ui * 7 + k) > 0.3) { ang = best.a + (hash(k * 3.3 + ui) - 0.5) * 0.08; dist = best.d; }
    }
    return { ang, dist };
  }

  /* ---------- sound: through the site's switch only; a few synthesised cues, quiet and far ---------- */
  let snd = null, engine = null;
  function audio() {
    const bus = ctx.sound(); if (!bus) { if (engine) stopEngine(); return null; }
    if (!snd || snd.ac !== bus.ac) {
      const out = bus.ac.createGain(); out.gain.value = 0.32; out.connect(bus.out);
      const len = bus.ac.sampleRate * 2, b = bus.ac.createBuffer(1, len, bus.ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      snd = { ac: bus.ac, out, noise: b };
    }
    return snd;
  }
  const lastCue = { burst: 0, gun: 0, bloom: 0 };
  function shot(dist, kind) {   // a report: noise cracks through a low-pass that closes with distance (a burst is four evenly spaced ones), and for the heavy gun and the bloom a low thump
    const a = audio(); if (!a) return;
    const now = performance.now(); if (now - lastCue[kind] < (kind === "burst" ? 160 : kind === "gun" ? 320 : 0)) return;   // never a din: a few cues a second at most
    lastCue[kind] = now; info.sounds++;
    const t = a.ac.currentTime + 0.005, far = clamp(dist / 3000, 0, 1), vol = (kind === "gun" ? 0.42 : kind === "bloom" ? 0.7 : 0.11) * (1 - far * 0.75);
    const f = a.ac.createBiquadFilter(), g = a.ac.createGain(); f.type = "lowpass"; f.frequency.value = lerp(kind === "burst" ? 2400 : 900, 240, far);
    const dur = kind === "bloom" ? 2.4 : kind === "gun" ? 0.9 : 0.05, n = kind === "burst" ? 4 : 1;
    g.gain.setValueAtTime(0.0001, t);
    for (let j = 0; j < n; j++) { const tj = t + j * 0.085; g.gain.setValueAtTime(0.0001, tj); g.gain.exponentialRampToValueAtTime(vol, tj + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, tj + dur); }
    const s = a.ac.createBufferSource(); s.buffer = a.noise; s.playbackRate.value = kind === "burst" ? 1.3 : 0.7;
    s.connect(f); f.connect(g); g.connect(a.out); s.start(t, Math.random()); s.stop(t + (n - 1) * 0.085 + dur + 0.05);
    if (kind !== "burst") {
      const o = a.ac.createOscillator(), og = a.ac.createGain(); o.type = "sine"; o.frequency.setValueAtTime(kind === "bloom" ? 70 : 95, t); o.frequency.exponentialRampToValueAtTime(32, t + dur * 0.8);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(og); og.connect(a.out); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function engineLevel(v) {     // the column's engines: a low rumble, only while the replay plays and the units move
    const a = audio(); if (!a) return;
    if (!engine) {
      const s = a.ac.createBufferSource(), f = a.ac.createBiquadFilter(), g = a.ac.createGain(); s.buffer = a.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 140; g.gain.value = 0.0001;
      s.connect(f); f.connect(g); g.connect(a.out); s.start(); engine = { s, g };
    }
    const t = a.ac.currentTime; engine.g.gain.cancelScheduledValues(t); engine.g.gain.setTargetAtTime(Math.max(0.0001, v), t, 0.25);
  }
  function stopEngine() { if (!engine) return; try { engine.s.stop(); } catch (e) {} engine = null; }

  /* ---------- each frame ---------- */
  const dbv = new THREE.Vector2();
  let lastCh = -1, lastSec = -1, wasPlaying = false, playFrom = 0, shotAt = -1, moodTo = { windows: 1, traffic: 1, trains: 1 }, active = false, marksShown = -1;
  const marks = E.marks || [];
  function evsOf(ch) { return events.filter((e) => e.ch === ch); }
  function step(now, dt, camDist) {     // the layer's own time per frame is kept in info.stepMs (a running mean, for measuring)
    const t0 = performance.now(), r = stepIn(now, dt, camDist);
    info.stepMs += (performance.now() - t0 - info.stepMs) * 0.05;
    return r;
  }
  function stepIn(now, dt, camDist) {
    const R = ctx.replay(), ch = R.chapter, evs = evsOf(ch), sec = R.t * R.dur;
    info.steps++;
    // the city's mood: the event's (the blackout of the story's nights) while its chapter is replayed; otherwise the city's own (lit, or the story's blackout from its chapter on). city.js eases the lights towards it
    mood.want = evs.length && evs[0].mood ? evs[0].mood : null;
    let changed = false;
    // the marks: from their chapter on, and within it from the moment the event leaves them
    let mk2 = 0;
    for (const u of Object.values(unitMesh)) u.n = 0;
    for (const m of Object.values(MODELS)) m.n = 0;
    unitsAsModels = 0;
    uT.value = now / 1000;
    const markOn = (m) => { if (ch && ch < m.ch) return false; if (ch !== m.ch) return true; const t = evs.reduce((v, e) => (e.marks && e.marks[m.id] != null ? e.marks[m.id] : v), 0); return sec >= t; };
    for (const m of marks) {
      const shown = markOn(m);
      if (m._shown !== shown) { m._shown = shown; const el = ctx.labels.querySelector(`.tl-mark[data-id="${m.id}"]`); if (el) el.classList.toggle("ev-hide", !shown); }
      if (!shown) continue; mk2++;
      let heat = 0;
      if (ch === m.ch) { const t = evs.reduce((v, e) => (e.marks && e.marks[m.id] != null ? e.marks[m.id] : v), 0); heat = m.dark ? 0.2 * (1 - smooth(t + 3, t + 9, sec)) : 0; }
      putUnit(m.shape, m.x, m.n, (m.heading || 0) * DEG, heat, m.dark ? 1 : 0);
    }
    info.marks = mk2;
    // the figures of the chapter being replayed, and the aircraft (they fly while the reader is looking or a replay plays, and hold still while the map rests)
    putFigures(ch);
    const flying = AIR.length > 0 && !reduced() && (R.playing || now - ctx.userAt() < AIR_AWAKE);
    if (flying) { airT += Math.min(dt, 0.1); wake(300); }
    const nAir = putAir(ch, flying);
    info.air = nAir;
    const on = evs.length > 0;
    if (!on) {
      if (active) { for (const o of objects) o.visible = false; stopEngine(); active = false; changed = true; ctx.labels.classList.remove("ev-quiet"); mood.beams = 1; }
      const sig = ch * 100000 + mk2 * 1000 + modelsVer * 10 + figuresAt(ch).length + (nAir ? 5 : 0);     // the marks and figures are still: written once, not every frame (the aircraft while they fly)
      if (marksShown !== sig || (nAir && flying)) {
        marksShown = sig; changed = true;
        for (const u of Object.values(unitMesh)) { u.m.count = u.n; u.m.visible = u.n > 0; if (u.n) { u.m.instanceMatrix.needsUpdate = true; u.m.geometry.attributes.aInst.needsUpdate = true; } }
        flushModels();
        for (const s of sheds) s.mesh.visible = markOn(s.m);
      }
      info.chapter = ch; info.sec = 0; info.units = mk2; info.sprites = info.streaks = info.rings = 0; info.caption = ""; lastCh = ch;
      return changed;
    }
    active = true; marksShown = -1;
    const quiet = evs.some((e) => sec < (e.dur || 0) - 0.05);      // the places' labels step back while the event itself plays (not during the journeys that may follow it)
    if (ctx.labels.classList.contains("ev-quiet") !== quiet) ctx.labels.classList.toggle("ev-quiet", quiet);
    mood.beams = quiet ? 0 : 1;
    for (const s of sheds) s.mesh.visible = markOn(s.m);
    if (ch !== lastCh) { shotAt = -1; lastSec = -1; wasPlaying = false; playFrom = now; }
    // the camera follows the event's shots, while it plays and while the scrubber is moved, until the reader takes the camera (from then until the next Play or chapter, it is theirs)
    if (R.playing && !wasPlaying) { playFrom = now; shotAt = -1; }
    if (!reduced() && ctx.userAt() < playFrom && Math.abs(sec - lastSec) > 1e-3) {
      for (const e of evs) {
        let idx = -1; e.shots.forEach((s, i) => { if (s[0] <= sec + 0.05) idx = i; });
        if (idx >= 0 && idx !== shotAt && (R.playing || lastSec >= 0)) { shotAt = idx; const s = e.shots[idx]; ctx.flyTo(s[1], R.playing ? (s[2] || 2) * 1000 : 700); info.shots++; }
      }
    }
    wasPlaying = R.playing;
    // the drawing buffer's scale, for things that keep a size in pixels
    const db = renderer.getDrawingBufferSize(dbv);
    PX.uPxK.value = 2 * Math.tan(camera.fov * DEG / 2) / Math.max(1, db.y); PX.uRes.value.set(db.x, db.y);
    spr.n = 0; str.n = 0; rng.n = 0; bloom.visible = false;
    const pxm = camDist * PX.uPxK.value * (db.y / Math.max(1, ctx.size.h || db.y));   // metres a CSS pixel spans at the camera's target
    const t = now / 1000, still = reduced();
    const playing = R.playing && !still, back = still ? 0 : 0.5;
    let caption = "", engineV = 0;
    for (const ev of evs) {
      const units = {};
      for (const a of ev.actors) if (a.kind === "convoy") units[a.id] = unitsOf(ev, a, sec);
      // the convoys and the heat they leave on the road
      for (const a of ev.actors) {
        if (a.kind !== "convoy") continue;
        let tail = 1e9, head = -1e9;
        units[a.id].forEach((u, i) => {
          if (!u) return;
          const st = a.stay.get(i); if (st && st.becomes) { const mm = marks.find((m) => m.id === st.becomes); if (mm && markOn(mm)) return; }
          let heat = u.heat;
          if (u.burning) heat *= (0.85 + 0.15 * (still ? 1 : Math.sin(t * 17 + i) * 0.5 + 0.5)) * lerp(1, 0.4, smooth(ev.dur, ev.dur + 2.5, sec));
          putUnit(u.shape, u.x, u.n, u.hd, heat, u.dark);
          if (!u.dark && heat > 0.3) { tail = Math.min(tail, u.s); head = Math.max(head, u.s); glow(u.x, 2, u.n, Math.max(28, 7 * pxm), 1.0, 0.6, 0.26, 0.16 * heat); }
        });
        if (a.wake) {
          const moving = Math.abs(a.head(sec) - a.head(Math.max(0, sec - 0.5))) > 2;
          const w = a.wake.material.uniforms.uWake.value;
          const backwards = a.head(sec) < a.head(Math.max(0, sec - 0.5)) - 2;
          w.set(tail < 1e8 ? tail : a.head(sec), head > -1e8 ? head + 6 : a.head(sec), (moving ? 420 : 160) * (backwards ? -1 : 1), tail < 1e8 ? 1 : 0);
          a.wake.visible = tail < 1e8;
          if (moving && playing) engineV = Math.max(engineV, 0.05 * (1 - clamp(camDist / 6000, 0, 0.8)));
        }
      }
      for (const f of ev.effects || []) {
        const ft = Array.isArray(f.t) ? f.t : [f.t, f.t + 3];     // a moment, or a span
        const in_ = sec >= ft[0] - 0.01 && sec <= ft[1] + 3;
        if (!in_ && f.kind !== "fire") continue;
        const A = (f.actor || f.target) ? ev.byId.get(f.actor || f.target) : null, U0 = A ? units[A.id] : null;   // the actor an effect belongs to (contacts name the one they close on)
        if (f.kind === "report" && sec <= f.t[1] + 1) {
          const a = smooth(f.t[0], f.t[0] + 0.8, sec) * (1 - smooth(f.t[1] - 0.6, f.t[1] + 0.6, sec)), p = still ? 0.5 : (t * 0.45) % 1;
          ring(f.at[0], f.at[1], 140 + 120 * p, 0.03, 1, 0.75, 0.82, 1.0, 0.55 * a * (1 - p));
          ring(f.at[0], f.at[1], 150, 0.025, 1, 0.75, 0.82, 1.0, 0.45 * a); glow(f.at[0], 6, f.at[1], 40, 0.8, 0.86, 1.0, 0.5 * a);
        }
        if (f.kind === "contacts") {
          const cs = contactsAt(ev, f, sec, U0 || Object.values(units).flat()); f._last = cs;
          const figs = MD && MD.contacts && MD.contacts.length ? MD.contacts : null;
          cs.forEach((c, i) => {
            if (c.a <= 0.01) return; const p = still ? 0.4 : ((t * 0.55 + c.ph) % 1);
            const rr = Math.max(12, 5 * pxm);
            // an asura stands where a contact is (the small kind, every fifth a lorry-sized one), facing what it closes on, drawn up to three times its size from afar (as the vehicles are); close to, its rings dim a little and its point of light much more, so the figure shows
            let ra = 1, ga = 1;
            if (figs && c.a > 0.08) { const k = i % 5 === 0 && figs[1] ? figs[1] : figs[0]; if (want(k) && putModel(k, c.x, 0, c.n, c.hd + ((i % 3) - 1) * 0.25, [0.35, 0, 3, i])) { ra = clamp((pxm - 0.35) / 1.2, 0.6, 1); ga = clamp((pxm - 0.1) / 0.3, 0.12, 1); } }
            ring(c.x, c.n, rr + Math.max(30, 9 * pxm) * p, 0.12, 0, 0.74, 0.84, 1.0, 0.65 * c.a * (1 - p) * ra); ring(c.x, c.n, rr * 0.55, 0.3, 0, 0.74, 0.84, 1.0, 0.75 * c.a * ra); glow(c.x, 3, c.n, Math.max(10, 6 * pxm), 0.74, 0.84, 1.0, 0.8 * c.a * ga);
          });
        }
        if ((f.kind === "bursts" || f.kind === "gun") && U0 && !still && sec <= f.t[1] + 0.6) {
          const contacts = (ev.effects.find((g) => g.kind === "contacts") || {})._last;
          const gun = f.kind === "gun";
          for (const ui of f.units || []) {
            const u = U0[ui]; if (!u || u.dark) continue;
            for (const b of burstsNear(f, ui, sec, gun ? 0.9 : 0.6)) {
              const shots = gun ? 1 : 4, aimv = aim(f, ui, b.k, u, contacts);
              const mx = u.x + Math.sin(aimv.ang) * 6, mn = u.n + Math.cos(aimv.ang) * 6;
              for (let j = 0; j < shots; j++) {
                const ts = b.t + j * 0.085, age = sec - ts; if (age < 0) continue;
                if (age < (gun ? 0.12 : 0.06)) glow(mx, 3.2, mn, Math.max(gun ? 44 : 12, (gun ? 14 : 6) * pxm), 1.0, 0.92, 0.7, gun ? 1.0 : 0.9);
                if (f.tracer || gun) {
                  const life = gun ? 0.5 : 0.38, k2 = age / life; if (k2 > 1) continue;
                  const tl = Math.max(gun ? 90 : 38, (gun ? 30 : 16) * pxm), dist = Math.max(aimv.dist, tl * 2.5);
                  const d0 = dist * k2, d1 = Math.min(dist, d0 + tl), sa = Math.sin(aimv.ang), ca = Math.cos(aimv.ang);
                  streak(mx + sa * Math.max(0, d0 - tl * 0.7), 3.0, mn + ca * Math.max(0, d0 - tl * 0.7), mx + sa * d1, 3.0 + 4 * k2 * (1 - k2), mn + ca * d1, gun ? 4.0 : 3.0, 1.0, 0.76, 0.40, (gun ? 1.0 : 0.95) * (1 - k2 * 0.4));
                  if (k2 > 0.9) glow(mx + sa * dist, 2, mn + ca * dist, Math.max(gun ? 30 : 9, (gun ? 9 : 4) * pxm), 1.0, 0.75, 0.4, gun ? 0.8 : 0.5);
                }
                if (j === 0 && playing && ts > lastSec && ts <= sec && lastSec >= 0) shot(Math.hypot(u.x - camera.position.x, u.n + camera.position.z, camera.position.y), gun ? "gun" : "burst");
              }
            }
          }
        }
        if (f.kind === "bloom" && U0) {
          const age = sec - f.t, life = 2.6;
          if (age >= 0 && age <= life + 0.5) {
            const u = U0[f.unit || 0]; if (!u) continue;
            const k2 = clamp(age / life, 0, 1), sc = f.scale || 1, R2 = (12 + 54 * (1 - Math.exp(-age * 2.6))) * sc;
            if (age <= life) {
              bloom.visible = true; const bu = bloomMat.uniforms; bu.uCenter.value.set(u.x, 6 + 10 * k2, -u.n); bu.uSize.value = R2; bu.uAge.value = k2; bu.uFlower.value = f.flower ? 1 : 0.25;
              info.bloom++;
            }
            ring(u.x, u.n, 30 + 260 * (1 - Math.exp(-age * 1.8)) * sc, 0.04, 0, 1.0, 0.85, 0.65, 0.65 * (1 - smooth(0.2, 2.2, age)));
            if (!low()) for (let j = 0; j < 22; j++) { const an = j / 22 * 6.283 + hash(j) * 0.3, sp = (60 + 70 * hash(j * 3)) * sc, a2 = age * sp; glow(u.x + Math.sin(an) * a2, 3 + 30 * age - 14 * age * age, u.n + Math.cos(an) * a2, 7, 1.0, 0.8, 0.5, 0.9 * (1 - smooth(0.4, 1.3, age))); }
            if (playing && f.t > lastSec && f.t <= sec && lastSec >= 0) shot(Math.hypot(u.x - camera.position.x, u.n + camera.position.z, camera.position.y), "bloom");
          }
        }
        if (f.kind === "fire" && sec >= f.t[0] && sec <= f.t[1]) {
          let x, n;
          if (A) { const u = U0 && U0[f.unit || 0]; if (!u) continue; x = u.x; n = u.n; } else { x = f.at[0]; n = f.at[1]; }
          const morning = smooth(ev.dur, ev.dur + 2.5, sec), sz = (f.size || 1) * lerp(1, f.morning != null ? f.morning : 1, morning), fade = smooth(f.t[0], f.t[0] + 0.8, sec);
          ring(x, n, 30 * sz + 6, 0, 2, 1.0, 0.42, 0.12, 0.22 * fade * sz);
          for (let j = 0; j < (low() ? 3 : 6); j++) {
            const fl = still ? 0.6 : 0.5 + 0.5 * Math.sin(t * (7 + j * 2.3) + j * 1.7);
            glow(x + (hash(j * 3.3) - 0.5) * 7 * sz, 2 + j * 1.6 * sz, n + (hash(j * 5.7) - 0.5) * 7 * sz, (12 + 10 * fl) * sz, 1.0, 0.5 + 0.2 * fl, 0.16, (0.55 + 0.35 * fl) * fade);
          }
        }
        if (f.kind === "walkers" && U0) {
          const st = A.stay.get(f.unit), sBase = st && st.s != null ? st.s : A.head(f.t[0]) - f.unit * (A.gap || 30);
          for (let j = 0; j < (f.n || 4); j++) {
            const t0 = f.t[0] + j * 0.45, k2 = smooth(t0, f.t[1], sec); if (sec < t0) continue;
            const p = along(A.r, sBase + (f.dist || -250) * k2 - 4 * j, (j % 2 ? 1.4 : -1.4)), a = 1 - smooth(f.t[1] - 1.2, f.t[1], sec);
            if (a <= 0.01) continue;
            putUnit("person", p[0], p[1], p[2] + Math.PI, 0.75 * a, 0);
            glow(p[0], 1.2, p[1], 5, 1.0, 0.8, 0.55, 0.85 * a);
          }
        }
      }
      // the captions of this moment
      const cs = Math.min(sec, R.dur - 0.01);     // the very end of the replay keeps its last line
      for (const c of ev.captions || []) if (cs >= c.t[0] && cs < c.t[1]) caption = c.text;
    }
    for (const u of Object.values(unitMesh)) { u.m.count = u.n; u.m.visible = u.n > 0; if (u.n) { u.m.instanceMatrix.needsUpdate = true; u.m.geometry.attributes.aInst.needsUpdate = true; } }
    flushModels();
    sprites.geometry.setDrawRange(0, spr.n); sprites.visible = spr.n > 0; for (const k of ["position", "aCol", "aSize"]) sprites.geometry.attributes[k].needsUpdate = true;
    tg.instanceCount = str.n; streaks.visible = str.n > 0; for (const k of ["aA", "aB", "aCol", "aW"]) tg.attributes[k].needsUpdate = true;
    rg.instanceCount = rng.n; rings.visible = rng.n > 0; for (const k of ["aC", "aCol", "aKind"]) rg.attributes[k].needsUpdate = true;
    for (const ev of events) for (const a of ev.actors) if (a.wake && !evs.includes(ev)) a.wake.visible = false;
    if (playing) engineLevel(engineV); else stopEngine();
    info.chapter = ch; info.sec = Math.round(sec * 100) / 100; info.units = Object.values(unitMesh).reduce((s, u) => s + u.n, 0) + unitsAsModels; info.sprites = spr.n; info.streaks = str.n; info.rings = rng.n; info.caption = caption;
    lastCh = ch; lastSec = sec;
    return true;
  }

  return {
    lead: (ch) => evsOf(ch).reduce((m, e) => Math.max(m, e.dur || 0), 0),            // the seconds a chapter's events take at the start of its replay
    frame: (ch) => {   // the view for the moment the replay stands at (a chapter opens on its last moment), else the event's own view
      const e = evsOf(ch)[0]; if (!e) return null; const R = ctx.replay(), sec = R.t * R.dur;
      let v = e.view || null; for (const s of e.shots) if (s[0] <= sec + 0.05) v = s[1];
      return v ? { ...v } : null;
    },
    captions: (ch, sec) => { const out = [], cs = Math.min(sec, ctx.replay().dur - 0.01); for (const e of evsOf(ch)) for (const c of e.captions || []) if (cs >= c.t[0] && cs < c.t[1]) out.push(c.text); return out; },
    step,
    info: () => ({ ...info }),
    dispose() { gone = true; stopEngine(); try { if (snd) snd.out.disconnect(); } catch (e) {} for (const o of objects) scene.remove(o); for (const d of disposables) { try { d.dispose(); } catch (e) {} } },
  };
}
