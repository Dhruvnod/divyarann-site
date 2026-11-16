/* The story's damage on the city (made in the story lab on 31 October 2026, built into the map on 5 November): fires, their light, and the smoke. Part of the damage layer (city_damage.js).
   Fires: one instanced quad mesh (a soft glow that never gets smaller than a few pixels, and flame tongues), two draw calls in all counting the smoke.
   Light: a flickering pool for each fire, added by patched copies of the city's ground, road, area and building programs (lab_dmg_shaders.js).
   Smoke: instanced soft puffs, placed and sorted back to front on the CPU each frame (a few hundred), each shaded as a small lit sphere with an eroded edge, so a plume reads as a volume. */

const BILLBOARD_VERT = /* glsl */`
attribute vec4 iA;         // x y z, kind: 0 glow (a sphere billboard), 1 flame (turns about the vertical)
attribute vec4 iB;         // width, height, seed, strength
uniform float uPxW;        // metres per pixel at a distance of one metre
varying vec2 vUv; varying vec4 vB; varying vec3 vPos; varying float vKind;
void main() {
  vec3 base = iA.xyz; vec3 toCam = cameraPosition - base; float d = length(toCam); vec3 fwd = toCam / max(d, 1e-3);
  float kind = iA.w;
  vec3 fh = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 1e-4));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), kind > 0.5 ? fh : fwd));
  vec3 up = kind > 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(cross(fwd, right));
  float minW = (kind > 0.5 ? 3.0 : 26.0) * uPxW * d;
  float w = max(iB.x, minW), h = max(iB.y, minW * (kind > 0.5 ? 1.8 : 1.0));
  vec2 q = position.xy;
  vec3 wp = base + right * q.x * w + up * (kind > 0.5 ? (q.y + 0.5) * h : q.y * h);
  vUv = vec2(q.x * 2.0, kind > 0.5 ? q.y + 0.5 : q.y * 2.0); vB = iB; vPos = wp; vKind = kind;
  gl_Position = projectionMatrix * (viewMatrix * vec4(wp, 1.0));
}`;
const BILLBOARD_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vB; varying vec3 vPos; varying float vKind;
\${COMMON}
void main() {
  float seed = vB.z, str = vB.w, t = uTime;
  float flick = 0.80 + 0.20 * sin(t * 9.0 + seed * 40.0) * sin(t * 4.3 + seed * 23.0) + 0.07 * sin(t * 23.0 + seed * 7.0);
  vec3 col; float day = 1.0 - 0.0;
  if (vKind < 0.5) {
    float r = length(vUv); if (r >= 1.0) discard;
    float g = pow(1.0 - r, 1.7);
    float dd = length(vPos - cameraPosition);
    col = vec3(1.0, 0.34, 0.06) * g * str * flick * mix(0.30, 1.0, smoothstep(30.0, 260.0, dd)) * (1.15 + 1.6 * smoothstep(900.0, 3200.0, dd));
  } else {
    vec2 p = vUv; float y = p.y;
    float n = vn(vec2(p.x * 1.3 + seed * 13.0, y * 1.6 - t * 1.9)) * 0.6 + vn(vec2(p.x * 2.9 + seed * 5.0, y * 3.3 - t * 3.4 + 7.0)) * 0.4;
    float d = n * 1.7 - y * 1.05 - abs(p.x) * (0.75 + 0.9 * y) + 0.34;
    float inten = clamp(d / 0.6, 0.0, 1.0);
    inten *= smoothstep(1.0, 0.70, abs(p.x)) * smoothstep(1.0, 0.80, y) * smoothstep(0.0, 0.04, y);
    if (inten <= 0.003) discard;
    vec3 hot = mix(vec3(0.85, 0.11, 0.02), vec3(1.0, 0.52, 0.09), smoothstep(0.0, 0.7, inten));
    hot = mix(hot, vec3(1.0, 0.88, 0.55), inten * inten * (1.0 - y) * 0.9);
    col = hot * inten * (0.45 + 0.85 * inten * inten) * str * flick * (1.0 - 0.35 * (1.0 - uDay));
  }
  // a fire in daylight is a bright orange foot, not a lamp
  col *= 1.0 - 0.45 * uDay * 0.0;
  float dist = length(vPos - cameraPosition);
  if (vKind > 0.5) col *= mix(0.62, 1.0, smoothstep(40.0, 360.0, dist));
  col *= exp(-(uFogD * uFogCam + uFogBase) * dist);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SMOKE_VERT = /* glsl */`
attribute vec4 iA;         // x y z, radius
attribute vec4 iB;         // alpha, seed, fire glow, age 0..1
attribute vec4 iC;         // darkness (0 black soot .. 1 pale), unused x3
varying vec2 vUv; varying vec4 vB; varying vec4 vC; varying vec3 vPos; varying vec3 vRight; varying vec3 vUp; varying vec3 vFwd; varying vec3 vCen;
void main() {
  vec3 c = iA.xyz; vec3 fwd = normalize(cameraPosition - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)); vec3 up = cross(fwd, right);
  vec2 q = position.xy * 2.0;
  vec3 wp = c + (right * q.x + up * q.y) * iA.w;
  vUv = q; vB = iB; vC = iC; vPos = wp; vRight = right; vUp = up; vFwd = fwd; vCen = c;
  gl_Position = projectionMatrix * (viewMatrix * vec4(wp, 1.0));
}`;
const SMOKE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; varying vec4 vB; varying vec4 vC; varying vec3 vPos; varying vec3 vRight; varying vec3 vUp; varying vec3 vFwd; varying vec3 vCen;
uniform vec3 uLidTint;
uniform float uSmokeDay;
uniform float uAlb2;
\${COMMON}
#ifdef CITY_DAY
uniform vec3 uBounce;
#endif
void main() {
  vec2 p = vUv; float r2 = dot(p, p); if (r2 >= 1.0) discard;
  float sd = vB.y, age = vB.w;
  vec2 q = p * 1.5 + vec2(sd * 17.0, sd * 5.0);
#ifdef DMG_LOW
  float n = vn(q * 1.3);      // phones and the low tier: one octave and no bumped normal (6 November: the smoke was about 3 ms of a phone-density frame)
#else
  float n = vn(q) * 0.52 + vn(q * 2.3 + 3.7) * 0.30 + vn(q * 5.3 + 9.1) * 0.18;
#endif
  float rr = sqrt(r2);
  float edge = 1.0 - smoothstep(0.0, 1.0, rr + (n - 0.5) * 1.1);
  float dens = edge * vB.x * (0.5 + 0.9 * n);
  if (dens < 0.004) discard;
  float z = sqrt(max(0.0, 1.0 - r2));
#ifdef DMG_LOW
  vec2 g = vec2(n - 0.5, 0.5 - n) * 0.5;
#else
  vec2 g = vec2(vn(q + 11.0) - 0.5, vn(q + 23.0) - 0.5);
#endif
  vec3 Nv = normalize(vec3(p.x + g.x * 1.6, p.y + g.y * 1.6, z * 0.8 + 0.1));
  vec3 N = normalize(vRight * Nv.x + vUp * Nv.y + vFwd * Nv.z);
  // the smoke's own colour: black soot near the fire, greyer and browner as it spreads and thins
  vec3 alb = mix(vec3(0.050, 0.046, 0.043), vec3(0.17, 0.150, 0.125), clamp(vC.x * 0.7 + smoothstep(0.25, 1.0, age) * 0.55, 0.0, 1.0));
  float nl = max(dot(N, uSunDir) * 0.85 + 0.15, 0.0);
  vec3 lit = uSunCol * uSunI * nl * 1.35 + uSkyCol * (0.40 + 0.40 * N.y);
#ifdef CITY_DAY
  lit += uBounce * (1.0 - N.y) * 0.4 * uMix;
#endif
  vec3 col = alb * uAlb2 * lit;
  // a fire lights the smoke above it from below, strongest in the first hundred metres; the capital's glow tints the rest
  float fireK = vB.z;
  vec3 fl = vec3(1.0, 0.36, 0.08) * fireK * smoothstep(-0.35, 0.9, -N.y * 0.5 + 0.55 * z) * (0.30 + 1.45 * (1.0 - age) * (1.0 - age)) * (1.0 - uDay);
  col += fl * (0.45 + 0.4 * n);
  col += uGlowCol * 0.5 * max(dot(N.xz, uGlowDir.xz), 0.0) * (1.0 - uDay);
  col *= mix(vec3(1.0), uLidTint, uSmokeDay);
  // thin smoke passes the sun's light: a warm rim where it is backlit
  vec3 vd = normalize(vCen - cameraPosition);
  float back = pow(max(dot(vd, uSunDir), 0.0), 4.0) * (1.0 - dens) * uDay;
  col += uSunCol * uSunI * back * 0.5 * alb * 3.0;
  gl_FragColor = vec4(applyFog(col, vPos), dens);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createFx(THREE, cx) {
  const { api, dbg, U, scene, camera, S, level, fires, banks, phone, wind, FIRE } = cx;
  const out = { meshes: [], disposers: [], stats: {} };
  const common = S.COMMON;
  const fill = (s) => s.replace("\\${COMMON}", common).replace("${COMMON}", common);
  const quad = new THREE.PlaneGeometry(1, 1);
  const NF = fires.length;
  const pxW = { value: 0.0016 };
  const upd = () => { const h = api.canvas.clientHeight || 800; pxW.value = 2 * Math.tan(camera.fov * Math.PI / 360) / h; };

  // ---------- flames and glows ----------
  const fl = [];
  fires.forEach((f, i) => {
    if (f.noFlame) return;
    const str = f.str == null ? 1 : f.str;
    fl.push({ x: f.x, y: f.y, z: f.z, k: 0, w: f.glow || f.w * 1.9 + 6, h: f.glow || f.w * 1.9 + 6, s: (i * 0.137) % 1, str: str * (f.glowK || 0.42), cy: f.h * 0.45 });
    const nt = Math.max(1, Math.min(phone ? 3 : 8, Math.round(f.w / 3.4)));
    for (let j = 0; j < nt; j++) {
      const a = (j + 0.5) / nt - 0.5, ang = (i * 2.4 + j * 1.9);
      fl.push({ x: f.x + a * f.w * 0.9 + Math.sin(ang) * 1.5, y: f.y, z: f.z + Math.cos(ang) * f.w * 0.25, k: 1, w: f.w * (0.62 + 0.4 * ((j * 7 + i) % 5) / 5) * (nt > 2 ? 0.8 : 1.0), h: f.h * (0.62 + 0.55 * ((j * 3 + i * 5) % 7) / 7), s: (i * 0.31 + j * 0.173) % 1, str: str });
    }
  });
  const flameMat = dbg.mk(fill(BILLBOARD_VERT), fill(BILLBOARD_FRAG), { uPxW: pxW }, { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  {
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute("position", quad.attributes.position);
    const A = new Float32Array(fl.length * 4), B = new Float32Array(fl.length * 4);
    fl.forEach((o, i) => { A.set([o.x, o.k === 0 ? o.y + o.cy : o.y, o.z, o.k], i * 4); B.set([o.w, o.h, o.s, o.str], i * 4); });
    g.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 4)); g.instanceCount = fl.length;
    const m = new THREE.Mesh(g, flameMat); m.frustumCulled = false; m.renderOrder = 24; m.onBeforeRender = upd;
    scene.add(m); out.meshes.push(m); out.flames = m;
    out.disposers.push(() => { scene.remove(m); g.dispose(); });
  }
  out.disposers.push(() => { const k = dbg.disposables.indexOf(flameMat); if (k >= 0) dbg.disposables.splice(k, 1); flameMat.dispose(); });

  // ---------- smoke ----------
  const puffs = [];
  const rnd = (s) => { let x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  fires.forEach((f, i) => {
    if (!f.smoke) return;
    const sm = f.smoke, n = Math.round((phone ? 0.55 : 1) * (sm.puffs || 30));
    for (let j = 0; j < n; j++) puffs.push({ kind: 0, fi: i, ph: (j + rnd(i * 31 + j)) / n, seed: rnd(i * 17 + j * 3), s2: rnd(i * 91 + j * 7), sm, f, j });
  });
  (banks || []).forEach((b, i) => { puffs.push({ kind: 1, b, seed: rnd(i * 53 + 7), ph: rnd(i * 11) }); });
  const SM = Math.max(puffs.length, 1);
  const smokeFrag = phone ? fill(SMOKE_FRAG).replace("precision highp float;", "precision highp float;\n#define DMG_LOW") : fill(SMOKE_FRAG);
  const smokeMat = dbg.mk(fill(SMOKE_VERT), smokeFrag, { uLidTint: { value: new THREE.Vector3(1, 1, 1) }, uSmokeDay: { value: 0 }, uAlb2: { value: 1 }, uBounce: U.uBounce }, { transparent: true, depthWrite: false });
  const sA = new Float32Array(SM * 4), sB = new Float32Array(SM * 4), sC = new Float32Array(SM * 4);
  const aA = new THREE.InstancedBufferAttribute(sA, 4), aB = new THREE.InstancedBufferAttribute(sB, 4), aC = new THREE.InstancedBufferAttribute(sC, 4);
  aA.setUsage(THREE.DynamicDrawUsage); aB.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage);
  const sg = new THREE.InstancedBufferGeometry(); sg.index = quad.index; sg.setAttribute("position", quad.attributes.position); sg.setAttribute("iA", aA); sg.setAttribute("iB", aB); sg.setAttribute("iC", aC); sg.instanceCount = puffs.length;
  const smoke = new THREE.Mesh(sg, smokeMat); smoke.frustumCulled = false; smoke.renderOrder = 23;
  const cur = puffs.map(() => ({ x: 0, y: 0, z: 0, r: 1, a: 0, s: 0, g: 0, age: 0, dk: 0, d: 0 }));
  const order = puffs.map((_, i) => i), tmpV = new THREE.Vector3();
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lvlSmoke = { a: 1 };
  out.smokeUpdate = () => {
    const t = U.uTime.value, cp = camera.position;
    camera.getWorldDirection(tmpV);
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i], c = cur[i];
      if (p.kind === 0) {
        const sm = p.sm, rate = sm.rate || 0.018, a = (p.ph + t * rate) % 1, H = sm.H * 1.2, h = a * H;
        const drift = h * (sm.lean == null ? 0.9 : sm.lean) * Math.pow(a, 0.5);
        const sway = Math.sin(a * 6.0 + p.seed * 20.0) * H * 0.035 * a;
        const jr = 0.7 + 0.6 * p.seed;
        c.r = (sm.r0 || 8) * jr + ((sm.r1 || 90) * 1.35 - (sm.r0 || 8)) * Math.pow(a, 0.55) * (0.6 + 0.8 * p.s2);
        const off = (p.s2 - 0.5) * c.r * 0.8 * Math.min(1, a * 3);
        c.x = p.f.x + wind[0] * drift + sway * wind[1] - wind[1] * off; c.z = p.f.z + wind[1] * drift - sway * wind[0] + wind[0] * off; c.y = p.f.y + (p.f.h || 6) * 0.5 + h;
        c.a = (sm.alpha || 0.5) * smoothstep(0.0, 0.05, a) * (1 - smoothstep(0.5, 1.0, a)) * lvlSmoke.a * (0.7 + 0.5 * p.seed);
        c.g = (p.f.str == null ? 1 : p.f.str) * (sm.fire == null ? 1 : sm.fire) * (1 - smoothstep(0.0, 0.45, a)); c.age = a; c.dk = sm.pale || 0; c.s = p.seed;
      } else {
        const b = p.b, a = b.phase == null ? 0.5 : b.phase;
        const drift = (b.drift || 18) * t * 0.0; // banks hold still
        c.x = b.x + drift; c.y = b.y + Math.sin(t * 0.05 + p.seed * 9.0) * 6.0; c.z = b.z; c.r = b.r; c.a = b.alpha * lvlSmoke.a; c.g = b.glow == null ? 0.42 : b.glow; c.age = 0.85; c.dk = b.pale == null ? 0.6 : b.pale; c.s = p.seed;
      }
      c.d = (c.x - cp.x) * tmpV.x + (c.y - cp.y) * tmpV.y + (c.z - cp.z) * tmpV.z;
    }
    order.sort((i, j) => cur[j].d - cur[i].d);
    for (let k = 0; k < order.length; k++) {
      const c = cur[order[k]];
      sA[k * 4] = c.x; sA[k * 4 + 1] = c.y; sA[k * 4 + 2] = c.z; sA[k * 4 + 3] = c.r;
      sB[k * 4] = c.a; sB[k * 4 + 1] = c.s; sB[k * 4 + 2] = c.g; sB[k * 4 + 3] = c.age;
      sC[k * 4] = c.dk;
    }
    aA.needsUpdate = aB.needsUpdate = aC.needsUpdate = true;
  };
  smoke.onBeforeRender = () => { out.smokeUpdate(); };
  scene.add(smoke); out.meshes.push(smoke); out.smoke = smoke; out.smokeMat = smokeMat; out.lvlSmoke = lvlSmoke;
  out.disposers.push(() => { scene.remove(smoke); sg.dispose(); const k = dbg.disposables.indexOf(smokeMat); if (k >= 0) dbg.disposables.splice(k, 1); smokeMat.dispose(); });
  out.stats = { flames: fl.length, puffs: puffs.length, fires: NF };
  out.dispose = () => { for (const f of out.disposers.splice(0).reverse()) { try { f(); } catch (e) { console.warn(e); } } };
  return out;
}

/* the fires' light on the ground, the roads and the green areas: their programs are patched in place (the originals are put back on dispose) */
export function patchScene(THREE, scene, SH, FIRE) {
  const done = [];
  scene.traverse((o) => {
    const m = o.material; if (!o.isMesh || !m || !m.isShaderMaterial || !m.fragmentShader || m.__dmgPatched) return;
    const fs = m.fragmentShader; let id = "";
    if (fs.includes("uDens") && fs.includes("uGroundIce")) id = "ground";
    else if (fs.includes("uTraffic") && fs.includes("vR") && fs.includes("applyFog(c, vPos), edge")) id = "road";
    else if (fs.includes("areaDay(") || (fs.includes("vKind") && fs.includes("applyFog(col, vPos)"))) id = "area";
    if (!id) return;
    const p = SH.patchLit(fs, id); if (!p) return;
    done.push({ m, fs }); m.fragmentShader = p; m.uniforms.uFire = FIRE; m.__dmgPatched = true; m.needsUpdate = true;
  });
  return () => { for (const { m, fs } of done) { m.fragmentShader = fs; delete m.uniforms.uFire; m.__dmgPatched = false; m.needsUpdate = true; } };
}
