/* The story's damage on the city (made in the story lab on 31 October 2026, built into the map on 5 November): the lid (Chapter 16): "The smoke ... had come down in the night and lay over Dwarka like a lid, flat and brown, so that the sun came up behind it like a dull brass plate."
   One horizontal plane carries a short ray march through a flat slab of smoke (flat underneath, billowy above), seen from above, from below or from inside; the city's light and haze are tinted brown while it lies
   there (the sun as a dull brass plate comes from the tinted light and a soft disc drawn in the lid's own shader). Part of the damage layer (city_damage.js). */

const VERT = /* glsl */`varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
uniform vec4 uLid;          // bottom, top (m), extinction per metre at full density, coverage gain
uniform vec4 uLidC;         // the field's middle (x, z) and its half-widths
uniform vec3 uLidCol;       // the smoke's colour
uniform float uSteps;
uniform vec4 uFire[24];
\${COMMON}
float fbm2(vec2 p) { return vn(p) * 0.52 + vn(p * 2.07 + 3.1) * 0.30 + vn(p * 4.3 + 7.7) * 0.18; }
float coverAt(vec2 xz) {
  vec2 d = (xz - uLidC.xy) / uLidC.zw;
  float g = exp(-dot(d, d) * 1.15);
  float n = fbm2(xz * 0.00042);
  return clamp(g * (0.30 + 1.65 * n) * uLid.w, 0.0, 1.0);
}
float densAt(vec3 p) {
  float c = coverAt(p.xz);
  if (c <= 0.002) return 0.0;
  float y0 = uLid.x + (vn(p.xz * 0.0011 + 9.0) - 0.5) * 120.0 + (vn(p.xz * 0.0063) - 0.5) * 30.0;
  float t = (p.y - y0) / (uLid.y - y0);
  float top = t + (vn(p.xz * 0.0019 + 2.0) - 0.5) * 0.75 + (vn(p.xz * 0.011) - 0.5) * 0.25;
  float prof = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.50, 1.0, top));
  return c * prof * (0.40 + 0.75 * vn(p.xz * 0.0052 + p.y * 0.0031) + 0.35 * vn(p.xz * 0.019 + 4.0));
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vPos - ro);
  if (abs(rd.y) < 2e-4) discard;
  float ta = (uLid.x - ro.y) / rd.y, tb = (uLid.y - ro.y) / rd.y;
  float tn = max(min(ta, tb), 0.0), tf = max(ta, tb);
  if (tf <= tn) discard;
  tf = min(tf, tn + 14000.0);
  float N = uSteps, dt = (tf - tn) / N, T = 1.0; vec3 acc = vec3(0.0);
  float jit = h21(gl_FragCoord.xy + fract(uTime * 0.0)) ;
  vec3 sunL0 = uSunCol * uSunI; vec3 sunL = mix(vec3(dot(sunL0, vec3(0.333))), sunL0, 0.40); float sunUp = max(uSunDir.y, 0.0);
  float phase = pow(max(dot(rd, uSunDir), 0.0), 7.0);
  for (int i = 0; i < 12; i++) {
    if (float(i) >= N) break;
    float t = tn + dt * (float(i) + jit); vec3 p = ro + rd * t;
    float d = densAt(p);
    if (d <= 0.001) continue;
    float tt = clamp((p.y - uLid.x) / (uLid.y - uLid.x), 0.0, 1.0);
    // from above the top is lit and its depths fall into shade; from below the smoke is lit by what comes through it
    float shade = mix(0.20, 1.0, smoothstep(0.0, 1.0, tt));
    vec3 L = sunL * (0.22 + 0.78 * sunUp) * shade + uSkyCol * (0.55 + 0.5 * tt) + sunL * phase * 0.9 * vec3(1.0, 0.72, 0.42) * (0.3 + 0.7 * shade);
    float a = 1.0 - exp(-d * dt * uLid.z);
    acc += T * a * uLidCol * L;
    T *= 1.0 - a;
    if (T < 0.02) break;
  }
  // at night the underside glows where the fires are
  float mid = 0.5 * (tn + tf); vec3 pm = ro + rd * mid; vec3 glow = vec3(0.0);
  for (int k = 0; k < 24; k++) { vec4 f = uFire[k]; if (f.w <= 0.0) break; vec3 dd = f.xyz - pm; dd.y *= 0.5; glow += vec3(1.0, 0.40, 0.10) * f.w * exp(-dot(dd, dd) / (480.0 * 480.0)); }
  acc += (1.0 - T) * uLidCol * min(glow, vec3(1.6)) * (1.0 - uDay) * 0.55;
  float alpha = 1.0 - T;
  if (alpha < 0.004) discard;
  vec3 col = acc / alpha;
  // the sun behind it: a dull brass plate, wider than the sun and soft, whatever the smoke in front of it
  float ang = acos(clamp(dot(rd, uSunDir), -1.0, 1.0));
  float plate = (1.0 - smoothstep(0.018, 0.030, ang)) * smoothstep(-0.02, 0.05, uSunDir.y) * smoothstep(0.35, 0.8, alpha);
  vec3 brass = vec3(0.95, 0.56, 0.22) * (0.75 + 0.5 * smoothstep(0.0, 0.1, uSunDir.y));
  col = mix(col, brass, plate * 0.92);
  alpha = max(alpha, plate);
  float tc = length(vPos - cameraPosition);
  gl_FragColor = vec4(applyFog(col, vPos), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createLid(THREE, cx) {
  const { api, dbg, U, scene, S, tear, lean, level, phone, opts = {} } = cx;
  const out = { disposers: [], stats: {} };
  const bottom = opts.bottom || 300, top = opts.top || 520;
  const gain = opts.gain == null ? 1.0 : opts.gain;
  const mat = dbg.mk(VERT, FRAG.replace("\${COMMON}", S.COMMON).replace("${COMMON}", S.COMMON), {
    uLid: { value: new THREE.Vector4(bottom, top, 0.0105, gain) },
    uLidC: { value: new THREE.Vector4(tear.x + 1500, -(tear.n + 600), 3300, 2800) },
    uLidCol: { value: new THREE.Vector3(0.27, 0.22, 0.18) },
    uSteps: { value: phone ? 5 : 8 },
    uFire: cx.FIRE,
  }, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const g = new THREE.PlaneGeometry(36000, 36000); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(tear.x + 600, (bottom + top) / 2, -(tear.n + 400)); m.frustumCulled = false; m.renderOrder = 22; scene.add(m);
  out.mesh = m; out.mat = mat;
  out.disposers.push(() => { scene.remove(m); g.dispose(); const k = dbg.disposables.indexOf(mat); if (k >= 0) dbg.disposables.splice(k, 1); mat.dispose(); });

  // the light under it: the sun a dull brass, the sky and the haze brown. (Kept for each frame, because the city works its light out again from the clock.)
  const tintSun = new THREE.Vector3(0.70, 0.55, 0.38), tintSky = new THREE.Vector3(0.78, 0.70, 0.62), tintHaze = new THREE.Vector3(0.95, 0.88, 0.78), tintZen = new THREE.Vector3(0.86, 0.76, 0.66);
  const base = {}, last = {};
  const keys = ["uHaze", "uGlowCol", "uZen", "uSkyMid", "uUpDay"];
  let on = true;
  const apply = () => {
    if (!on) return;
    for (const k of keys) { const v = U[k] && U[k].value; if (!v) continue; if (!last[k] || !last[k].equals(v)) base[k] = v.clone(); }
    const set = (k, f) => { if (!base[k]) return; U[k].value.copy(base[k]).multiply(f); last[k] = U[k].value.clone(); };
    const tintUp = new THREE.Vector3(0.78, 0.68, 0.56);
    set("uHaze", tintHaze); set("uZen", tintZen); set("uSkyMid", tintZen); set("uGlowCol", tintHaze); set("uUpDay", tintUp);
    // the sun and the sky's light on the walls, through setLight (which remembers an override)
  };
  // sun and sky light as overrides of the clock's
  const L = api.light ? api.light() : null;
  if (L) {
    const sc = new THREE.Vector3(...L.sunCol).multiply(tintSun), kc = new THREE.Vector3(...L.skyCol).multiply(tintSky);
    api.setLight({ sunCol: sc.toArray(), skyCol: kc.toArray() });
  }
  const off = api.onFrame(apply);
  apply();
  out.disposers.push(() => { on = false; off(); api.setLight(null); for (const k of keys) if (base[k]) U[k].value.copy(base[k]); });
  out.dispose = () => { for (const f of out.disposers.splice(0).reverse()) { try { f(); } catch (e) { console.warn(e); } } };
  return out;
}
