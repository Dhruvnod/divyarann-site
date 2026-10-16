/* DIVYARANN, the site before the battle (the Threshold rebuild with Rakta v4's performance work): the one WebGL canvas behind every page.
   Dust that gathers into the wheel's engraving, the medallion that draws itself and lights a point per chapter read,
   the tear, a dim nebula, and a dissolve between pages. It only listens: app.js renders the pages and calls
   DVGL.enter / DVGL.leave. If anything fails, the page is complete without it. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const root = document.documentElement;
const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarse = window.matchMedia("(pointer: coarse)").matches;
const reduced = () => reduceMQ.matches || root.classList.contains("dv-still");
const gs = window.gsap || null;

// ---------- palettes (sRGB hex; THREE converts to linear). Accents get pushed above 1 where they should bloom ----------
const PAL = {
  akash: { ink: "#040307", mist: "#0b0916", accent: "#b7a6ff", line: "#8d8aa6", hot: "#f3eeff", glow: "#6b4fd6", lit: "#c9b8ff", veil: "#040307", burn: "#a58cff" },
  grahan: { ink: "#070304", mist: "#200a0c", accent: "#ff8a5c", line: "#a88a5a", hot: "#fff1e6", glow: "#c0263a", lit: "#ffb27a", veil: "#070304", burn: "#ff6a3d" },
};
const palName = () => (root.getAttribute("data-palette") === "grahan" ? "grahan" : "akash");

// ---------- shaders ----------
const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p, int oct){ float v = 0.0, a = 0.5; mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++){ if (i >= oct) break; v += a * vnoise(p); p = r * p * 2.03; a *= 0.5; } return v; }
vec2 curl2(vec2 p){ const float e = 0.05;
  float a = vnoise(p + vec2(0.0, e)), b = vnoise(p - vec2(0.0, e)), c = vnoise(p + vec2(e, 0.0)), d = vnoise(p - vec2(e, 0.0));
  return vec2(a - b, -(c - d)) / (2.0 * e); }`;
const FS_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const QUAD_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

// ---------- the wheel's drawings (the site's own geometry, in its 760-unit frame) ----------
const PETAL = "M0,-342 C 26,-318 30,-292 0,-262 C -30,-292 -26,-318 0,-342 Z";
const LOTUS = "M 0,-52 C 15,-62 17,-77 0,-89 C -17,-77 -15,-62 0,-52 Z";
const EYE = "M 0,-64 C 34,-30 34,30 0,64 C -34,30 -34,-30 0,-64 Z";
const BOW = "M -46,-80 Q -32,-92 -16,-86 C 30,-70 52,-40 52,0 C 52,40 30,70 -16,86 Q -32,92 -46,80 Q -32,86 -18,80 C 22,64 40,38 40,0 C 40,-38 22,-64 -18,-80 Q -32,-86 -46,-80 Z";
function canvasFor(size, span) { const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); x.translate(size / 2, size / 2); x.scale(size / (2 * span), size / (2 * span)); x.strokeStyle = x.fillStyle = "#fff"; x.lineCap = "round"; x.lineJoin = "round"; return { c, x }; }
function ring(x, r, w, a, dash) { x.globalAlpha = a; x.lineWidth = w; x.setLineDash(dash || []); x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; }
const draw = {
  outer(x) { ring(x, 360, 1.3, 0.45); ring(x, 342, 1.8, 1); const p = new Path2D(PETAL); for (let i = 0; i < 18; i++) { x.save(); x.rotate(i * Math.PI / 9); x.lineWidth = 1.7; x.stroke(p); x.restore(); } },
  spokes(x) { ring(x, 252, 1.8, 1); for (let i = 0; i < 18; i++) { x.save(); x.rotate(i * Math.PI / 9); x.globalAlpha = 0.45; x.lineWidth = 1.1; x.beginPath(); x.moveTo(0, -252); x.lineTo(0, -112); x.stroke(); x.globalAlpha = 0.6; x.lineWidth = 1.3; x.beginPath(); x.arc(0, -230, 4.5, 0, Math.PI * 2); x.stroke(); x.restore(); } x.globalAlpha = 1; },
  inner(x) { ring(x, 200, 1.3, 0.55, [2, 6]); const tri = (rot) => { x.beginPath(); for (let k = 0; k < 3; k++) { const a = (rot + k * 120 - 90) * Math.PI / 180; x[k ? "lineTo" : "moveTo"](180 * Math.cos(a), 180 * Math.sin(a)); } x.closePath(); x.lineWidth = 1.7; x.stroke(); }; tri(0); tri(60); },
  hub(x) { ring(x, 116, 2.2, 1); ring(x, 108, 1.2, 0.5); ring(x, 94, 1.3, 0.5); ring(x, 50, 2, 1); const l = new Path2D(LOTUS); for (let i = 0; i < 10; i++) { x.save(); x.rotate(i * Math.PI / 5); x.lineWidth = 1.8; x.stroke(l); x.restore(); }
    x.beginPath(); x.moveTo(-34.6, -20); x.lineTo(34.6, -20); x.lineTo(0, 40); x.closePath(); x.lineWidth = 2.6; x.stroke(); x.beginPath(); x.arc(0, 0, 5, 0, Math.PI * 2); x.fill(); },
  truths(x, reached) {
    const p = new Path2D(PETAL);
    [0, 1].forEach((i) => { const open = i === 0 && reached >= 8; x.save(); x.rotate(i * Math.PI / 9);
      x.save(); x.translate(0, -302); x.scale(1.16, 1.16); x.translate(0, 302);
      if (open) { x.globalAlpha = 0.2; x.fill(p); x.globalAlpha = 1; x.lineWidth = 1.8; x.stroke(p); } else { x.globalAlpha = 0.85; x.setLineDash([3, 4]); x.lineWidth = 1.5; x.stroke(p); x.setLineDash([]); }
      x.restore();
      x.globalAlpha = open ? 1 : 0.8; x.setLineDash(open ? [] : [2, 3]); x.lineWidth = 1.4; x.beginPath(); x.arc(0, -302, 19.5, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
      x.save(); x.translate(0, -302);
      if (open) { x.scale(0.155, 0.155); x.globalAlpha = 1; x.fill(new Path2D(BOW)); x.lineWidth = 3.5; x.beginPath(); x.moveTo(-46, -80); x.lineTo(-46, 80); x.stroke(); }
      else { x.scale(0.13, 0.13); x.globalAlpha = 0.9; x.lineWidth = 9; x.stroke(new Path2D(EYE)); x.beginPath(); x.moveTo(0, -38); x.lineTo(0, 38); x.stroke(); }
      x.restore(); x.restore(); });
  },
};
function rng(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function jagged(a, b, depth, rough, R) { let pts = [a, b]; for (let k = 0; k < depth; k++) { const next = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [px, py] = pts[i], [qx, qy] = pts[i + 1]; const dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy) || 1, off = (R() - 0.5) * len * rough; next.push([(px + qx) / 2 - dy / len * off, (py + qy) / 2 + dx / len * off], pts[i + 1]); } pts = next; rough *= 0.92; } return pts; }

// points sampled from a drawing, in the unit frame (radius 1 = the wheel's faint outer ring)
function sample(drawFn, count, R, size = 640, span = 380) {
  const { c, x } = canvasFor(size, span); drawFn(x);
  const data = x.getImageData(0, 0, size, size).data, hits = [];
  for (let i = 3; i < data.length; i += 4) if (data[i] > 100) hits.push((i - 3) >> 2);
  const out = new Float32Array(count * 3), k = span / 360;
  for (let i = 0; i < count; i++) { const h = hits[(R() * hits.length) | 0] || 0;
    out[i * 3] = (((h % size) + R()) / size * 2 - 1) * k; out[i * 3 + 1] = (1 - (((h / size) | 0) + R()) / size * 2) * k; out[i * 3 + 2] = (R() - 0.5) * 0.03; }
  return out;
}

function boot() {
  const canvas = document.getElementById("gl");
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const glc = renderer.getContext(), dbgExt = glc.getExtension("WEBGL_debug_renderer_info"), gpuName = dbgExt ? String(glc.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL)) : "";
  const software = /swiftshader|llvmpipe|basic render|software/i.test(gpuName), strong = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro/i.test(gpuName);
  const tier = software || !renderer.capabilities.isWebGL2 ? 0 : coarse ? ((navigator.hardwareConcurrency || 4) >= 8 ? 2 : 1) : 3;
  const TIER = [{ px: 0.6e6, n: 6000, oct: 3, bloom: 0.25 }, { px: 0.8e6, n: 14000, oct: 3, bloom: 0.3 }, { px: 1.2e6, n: 22000, oct: 4, bloom: 0.35 }, { px: strong ? 3.4e6 : 1.8e6, n: 30000, oct: 4, bloom: 0.4 }][tier];
  // resolution: Q scales the screen's own pixel ratio (up to 2). A discrete GPU starts at full sharpness; anything else starts
  // from its tier's pixel budget and climbs towards full sharpness while frames stay on time
  const fullPx = () => window.innerWidth * window.innerHeight * Math.pow(Math.min(window.devicePixelRatio || 1, 2), 2);
  // and four levels of effects (glow resolution, how much dust, smoke detail, how often the smoke is redrawn), each with a
  // resolution ceiling. Late frames lower the level, so the effects lighten before the image softens; frames on time first
  // raise the resolution to the level's ceiling, then the level. A discrete GPU starts at the top and keeps full resolution
  // above the lowest level
  const LVS = [[0.16, 0.35, 2, 3], [0.22, 0.55, 3, 2], [0.3, 0.75, 3, 1], [TIER.bloom, 1, TIER.oct, 1]].map(([bloom, parts, oct, neb], i) =>
    ({ bloom: Math.min(bloom, TIER.bloom), parts, oct: Math.min(oct, TIER.oct), neb, q: strong ? (i ? 1 : 0.86) : [0.72, 0.86, 1, 1][i] }));
  let LV = software ? 0 : strong ? 3 : 2;
  let Q = strong ? 1 : Math.min(LVS[LV].q, Math.sqrt(TIER.px / fullPx()));
  const QMIN = strong ? 0.86 : software ? 0.4 : 0.6;
  const PERF = window.DVPerf = { fps: 60, q: Q, lv: LV, gpu: gpuName, software, strong, late: 0, calm: false, w: 0, h: 0 };
  const dpr = () => Q * Math.min(window.devicePixelRatio || 1, 2);
  const col = {}; for (const k in PAL.akash) col[k] = new THREE.Color(PAL[palName()][k]);
  const PALC = {}; for (const n in PAL) { PALC[n] = {}; for (const k in PAL[n]) PALC[n][k] = new THREE.Color(PAL[n][k]); }
  const easeCols = (r) => { const p = PALC[palName()]; for (const k in col) col[k].lerp(p[k], r); };
  renderer.setClearColor(col.ink, 1);

  // nebula into a small target
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const nebU = { uRes: { value: new THREE.Vector2(4, 4) }, uTime: { value: 0 }, uIntensity: { value: 0 }, uOct: { value: TIER.oct }, uInk: { value: col.ink }, uMist: { value: col.mist }, uAccent: { value: col.glow }, uGlow: { value: new THREE.Vector3(0.5, 0.5, 0) } };
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: FS_VERT, depthTest: false, depthWrite: false, uniforms: nebU,
    fragmentShader: NOISE + `uniform vec2 uRes; uniform float uTime, uIntensity; uniform int uOct; uniform vec3 uInk, uMist, uAccent, uGlow;
      void main(){ vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; float t = uTime * 0.02;
        vec2 q = vec2(fbm(uv * 1.6 + vec2(0.0, t), uOct), fbm(uv * 1.6 + vec2(5.2, 1.3 - t), uOct));
        float n = fbm(uv * 1.9 + 1.8 * q + vec2(t, 0.0), uOct);
        vec3 c = mix(uInk, uMist, smoothstep(0.32, 0.95, n) * uIntensity);
        vec2 g = (gl_FragCoord.xy / uRes - uGlow.xy) * vec2(uRes.x / uRes.y, 1.0);
        c += uAccent * 0.08 * exp(-length(g) * 2.6) * uGlow.z * uIntensity;
        c *= 1.0 - 0.6 * smoothstep(0.25, 1.15, length(uv));
        gl_FragColor = vec4(c, 1.0); }` })));

  const scene = new THREE.Scene(); scene.background = rt.texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60); camera.position.z = 10;
  const viewH = (z) => 2 * (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // ---------- particles: dust, wheel, tear, lotus ----------
  const R = rng(7), N = TIER.n;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const dust = new Float32Array(N * 3); for (let i = 0; i < N; i++) { dust[i * 3] = (R() - 0.5) * 7; dust[i * 3 + 1] = (R() - 0.5) * 4.4; dust[i * 3 + 2] = (R() - 0.5) * 3; }
  const wheelDraw = (x) => { draw.outer(x); draw.spokes(x); draw.inner(x); draw.hub(x); };
  const tearPts = jagged([0.02, 1.9], [-0.03, -1.9], 5, 0.3, rng(11));
  const tearDraw = (x) => { x.lineWidth = 7; x.beginPath(); tearPts.forEach((p, i) => x[i ? "lineTo" : "moveTo"](p[0] * 190, -p[1] * 190)); x.stroke(); };
  const lotusDraw = (x) => { x.save(); x.scale(3.2, 3.2); draw.hub(x); x.restore(); };
  geo.setAttribute("aS0", new THREE.BufferAttribute(dust, 3));
  geo.setAttribute("aS1", new THREE.BufferAttribute(sample(wheelDraw, N, R), 3));
  geo.setAttribute("aS2", new THREE.BufferAttribute(sample(tearDraw, N, R, 640, 760), 3));
  geo.setAttribute("aS3", new THREE.BufferAttribute(sample(lotusDraw, N, R), 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: N }, R), 1));
  const partU = { uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uTime: { value: 0 }, uSize: { value: 30 }, uPR: { value: 1 }, uDrift: { value: 0.03 }, uTurb: { value: 0.35 }, uColor: { value: col.accent }, uAlpha: { value: 0 }, uSpin: { value: 0 } };
  const parts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: partU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: NOISE + `attribute vec3 aS0; attribute vec3 aS1; attribute vec3 aS2; attribute vec3 aS3; attribute float aSeed;
      uniform vec4 uW; uniform float uTime, uSize, uPR, uDrift, uTurb, uSpin; varying float vA;
      void main(){ vec4 w = pow(uW, vec4(1.0 + aSeed * 2.0)); w /= max(dot(w, vec4(1.0)), 1e-5);
        vec3 s1 = aS1; float c = cos(uSpin), s = sin(uSpin); s1.xy = mat2(c, -s, s, c) * s1.xy;
        vec3 p = aS0 * w.x + s1 * w.y + aS2 * w.z + aS3 * w.w;
        float transit = 1.0 - max(max(w.x, w.y), max(w.z, w.w));
        p.xy += curl2(p.xy * 1.4 + aSeed * 7.0 + uTime * 0.04) * (uDrift * (0.4 + w.x * 2.0) + transit * uTurb);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPR * (0.5 + 0.8 * aSeed) / -mv.z;
        vA = 0.3 + 0.7 * fract(aSeed * 13.7 + uTime * 0.08); }`,
    fragmentShader: "uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a; gl_FragColor = vec4(uColor, a * vA * uAlpha); }" }));
  parts.frustumCulled = false;

  // ---------- the medallion: engraving layers that draw themselves, points that light, sealed truths ----------
  const wheel = new THREE.Group(); scene.add(wheel); wheel.add(parts);
  const layerMat = (tex, color, z) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: tex }, uColor: { value: color }, uP: { value: 0 }, uA: { value: 0 } }, vertexShader: QUAD_VERT,
    fragmentShader: NOISE + `uniform sampler2D uMap; uniform vec3 uColor; uniform float uP, uA; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0;
        vec4 t = texture2D(uMap, vUv); if (t.a < 0.004) discard;
        float shown = 1.0, tip = 0.0;
        if (uP < 0.999){ float r = length(p); float ang = (r > 1e-4 ? atan(p.x, p.y) : 0.0) / 6.28318 + 0.5; float pp = uP * 1.08;
          shown = 1.0 - smoothstep(pp - 0.02, pp, fract(ang + 0.5) + 0.02 * vnoise(p * 30.0)); tip = exp(-abs(fract(ang + 0.5) - pp) * 60.0); }
        gl_FragColor = vec4(uColor * t.a * (shown + tip * 2.0) * uA, 1.0); }` });
  function layer(drawFn, size, span, color, z) {
    const { c, x } = canvasFor(size, span); drawFn(x);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * span / 360, 2 * span / 360), layerMat(tex, color, z)); m.position.z = z; wheel.add(m);
    m.userData.redraw = (fn) => { x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, size, size); x.restore(); fn(x); tex.needsUpdate = true; };
    return m;
  }
  const big = coarse ? 1536 : 2048;
  const L = { outer: layer(draw.outer, big, 380, col.line, 0.0), spokes: layer(draw.spokes, big, 380, col.line, 0.05), inner: layer(draw.inner, big, 380, col.line, 0.1), hub: layer(draw.hub, 1024, 120, col.line, 0.15) };
  let reached = 0;
  L.truths = layer((x) => draw.truths(x, reached), big, 380, col.lit, 0.01);
  // the eighteen points: one per chapter read; lit ones go above 1 and bloom
  const litArr = new Float32Array(18), litTarget = new Float32Array(18);
  const pg = new THREE.BufferGeometry(); const pp = new Float32Array(18 * 3), pi = new Float32Array(18);
  for (let i = 0; i < 18; i++) { const a = i * Math.PI / 9; pp[i * 3] = Math.sin(a) * 230 / 360; pp[i * 3 + 1] = Math.cos(a) * 230 / 360; pp[i * 3 + 2] = 0.06; pi[i] = i; }
  pg.setAttribute("position", new THREE.BufferAttribute(pp, 3)); pg.setAttribute("aI", new THREE.BufferAttribute(pi, 1));
  const ptU = { uLit: { value: litArr }, uPR: { value: 1 }, uScale: { value: 1 }, uColor: { value: col.lit }, uDim: { value: col.line }, uA: { value: 0 }, uHover: { value: -1 } };
  const points = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: ptU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aI; uniform float uLit[18]; uniform float uPR, uScale, uHover; varying float vL; varying float vH;
      void main(){ float l = 0.0; for (int i = 0; i < 18; i++){ if (float(i) == aI) l = uLit[i]; } vL = l; vH = step(abs(aI - uHover), 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (6.0 + 22.0 * l + 10.0 * vH) * uPR * uScale; }`,
    fragmentShader: `uniform vec3 uColor, uDim; uniform float uA; varying float vL; varying float vH;
      void main(){ float d = length(gl_PointCoord - 0.5); float core = 1.0 - smoothstep(0.06, 0.16, d); float halo = exp(-d * 9.0) * (1.0 - smoothstep(0.3, 0.5, d));
        vec3 c = mix(uDim * 0.6 * (1.0 - smoothstep(0.12, 0.2, d)) * step(0.08, d), uColor * (core * 2.6 + halo * 0.9), vL) + uColor * vH * halo * 0.8;
        gl_FragColor = vec4(c * uA, 1.0); }` }));
  points.frustumCulled = false; wheel.add(points);

  // ---------- the tear ----------
  const TP = jagged([0.0, -1.0], [0.02, 1.0], 5, 0.32, rng(19)).map(([x, y]) => new THREE.Vector2(x * 0.18, y * 0.96));
  const tearU = { uPts: { value: TP }, uOpen: { value: 0 }, uTime: { value: 0 }, uHot: { value: col.hot }, uGlow: { value: col.glow }, uAspect: { value: new THREE.Vector2(0.4, 1) } };
  const tear = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: tearU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: QUAD_VERT,
    fragmentShader: NOISE + `
#define N 33
      uniform vec2 uPts[N]; uniform float uOpen, uTime; uniform vec3 uHot, uGlow; uniform vec2 uAspect; varying vec2 vUv;
      vec2 sg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return vec2(length(pa - ba * h), h); }
      void main(){ vec2 p = (vUv - 0.5) * uAspect * 2.0; float d = 1e3, s = 0.0;
        for (int i = 0; i < N - 1; i++){ vec2 r = sg(p, uPts[i], uPts[i + 1]); if (r.x < d){ d = r.x; s = (float(i) + r.y) / float(N - 1); } }
        float w = uOpen * (0.0015 + 0.008 * sin(3.14159 * s));
        float core = 1.0 - smoothstep(w * 0.5, w + 0.0025, d);
        float fl = 0.8 + 0.2 * vnoise(vec2(s * 40.0, uTime * 2.0));
        float halo = (exp(-d * 34.0) * 0.3 + exp(-d * 9.0) * 0.06) * fl * uOpen;
        vec2 q = min(vUv, 1.0 - vUv); float fade = smoothstep(0.0, 0.18, min(q.x, q.y));
        gl_FragColor = vec4((uHot * core * 1.8 * uOpen + uGlow * halo) * fade, 1.0); }` }));
  tear.position.z = -0.6; tear.renderOrder = -1; scene.add(tear);

  // ---------- the eclipse that changes the palette: a dark disc crosses the hub ----------
  const eclipse = new THREE.Mesh(new THREE.CircleGeometry(0.4, 96), new THREE.MeshBasicMaterial({ color: col.ink, transparent: true, opacity: 0, depthWrite: false }));
  eclipse.position.z = 0.2; eclipse.renderOrder = 10; wheel.add(eclipse);

  // ---------- post: bloom only above 1, then a film finish ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.8, 0.55, 1.0);
  const setB = bloom.setSize.bind(bloom); bloom.setSize = (a, b) => setB(a * LVS[LV].bloom, b * LVS[LV].bloom);
  composer.addPass(bloom);
  const finU = { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVignette: { value: 0.5 }, uCA: { value: 0.007 } };
  composer.addPass(new ShaderPass({ uniforms: finU, vertexShader: QUAD_VERT,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uCA; varying vec2 vUv;
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 rrt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c){ const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        return clamp(O * rrt(I * (c / 0.6)), 0.0, 1.0); }
      vec3 srgb(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
      void main(){ vec2 c = vUv - 0.5; float r2 = dot(c, c); vec2 off = c * r2 * uCA;
        vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
        col = srgb(aces(max(col, vec3(0.0))));
        col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col += (hash12(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * uGrain * (1.0 - 0.7 * lum);
        col += (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0); }` }));

  // ---------- where the wheel goes. x, y are shares of the viewport; r is the radius as a share of its height;
  //            px: a function of (w, h) giving pixels, for the reading dock ----------
  const SCENES = {
    intro: { x: 0.5, y: 0.47, r: 0.3, w: [0.0, 1, 0, 0], neb: 0.7, tear: 0.0, parts: 0.7, rings: 1, pts: 1 },
    home: { anchor: true, w: [0.35, 0.65, 0, 0], neb: 0.75, tear: 0.0, parts: 0.15, rings: 1, pts: 1 },
    "home:index": { x: 0.5, y: 0.5, r: 0.6, w: [0.55, 0.45, 0, 0], neb: 0.8, tear: 0.0, parts: 0.12, rings: 0.16, pts: 0.55 },
    "home:four": { x: 0.88, y: 0.2, r: 0.16, w: [0.85, 0.15, 0, 0], neb: 0.75, tear: 0.0, parts: 0.2, rings: 0.6, pts: 1 },
    contents: { x: 0.9, y: 0.5, r: 0.46, w: [0.5, 0.5, 0, 0], neb: 0.8, tear: 0.0, parts: 0.14, rings: 0.4, pts: 1 },
    reader: { px: (w, h) => [w - (w < 700 ? 40 : 64), h - (w < 700 ? 40 : 64), w < 700 ? 22 : 34], w: [1, 0, 0, 0], neb: 0.3, tear: 0.0, parts: 0.0, rings: 0.9, pts: 1 },
    codex: { x: 0.82, y: 0.3, r: 0.22, w: [0.6, 0, 0, 0.4], neb: 0.7, tear: 0.0, parts: 0.22, rings: 0.75, pts: 1 },
    story: { x: 0.9, y: 0.5, r: 0.4, w: [0.6, 0.4, 0, 0], neb: 0.8, tear: 0.0, parts: 0.14, rings: 0.35, pts: 1 },
    tears: { x: 0.74, y: 0.45, r: 0.46, w: [0.4, 0, 0.6, 0], neb: 0.6, tear: 1.0, parts: 0.16, rings: 0.0, pts: 0 },
    powers: { x: 0.68, y: 0.42, r: 0.36, w: [0.15, 0, 0, 0.85], neb: 0.8, tear: 0.0, parts: 0.45, rings: 0.0, pts: 0 },
    about: { x: 0.85, y: 0.5, r: 0.36, w: [1, 0, 0, 0], neb: 0.5, tear: 0.0, parts: 0.14, rings: 0.4, pts: 1 },
    menu: { x: 0.84, y: 0.5, r: 0.42, w: [0.4, 0.6, 0, 0], neb: 0.6, tear: 0.0, parts: 0.25, rings: 0.55, pts: 1 },
  };
  const S = { neb: 0, tear: 0, parts: 0, rings: 0, pts: 0, cx: window.innerWidth / 2, cy: window.innerHeight * 0.47, r: window.innerHeight * 0.3, draw: 0, boost: 0 };
  let page = "home", state = "home", anchor = null, follow = 1, T = 0, outerAngle = 0, innerAngle = 0, menuOpen = false, boostI = -1;
  const anchorRect = () => { if (!anchor || !anchor.isConnected) return null; const r = anchor.getBoundingClientRect(); return r.width > 0 ? r : null; };
  const tw = (target, props, dur, ease, delay) => { if (gs && !reduced()) return gs.to(target, Object.assign({ duration: dur, ease: ease || "power3.inOut", overwrite: "auto", delay: delay || 0 }, props)); Object.assign(target, props); return null; };

  function goState(name, quick) {
    state = name; const s = SCENES[name] || SCENES.about;
    anchor = s.anchor ? document.querySelector("[data-wheel]") : null;
    const d = quick ? 0.01 : 1.4;
    tw(partU.uW.value, { x: s.w[0], y: s.w[1], z: s.w[2], w: s.w[3] }, quick ? 0.01 : 1.6);
    tw(S, { neb: s.neb, tear: s.tear, parts: s.parts, rings: s.rings, pts: s.pts }, d);
    follow = quick ? 1 : 0; if (gs && !quick) gs.to({ f: 0 }, { f: 1, duration: 1.3, ease: "power2.inOut", onUpdate() { follow = this.targets()[0].f; } }); else follow = 1;
  }
  function pageState() { return menuOpen ? "menu" : page; }

  // ---------- reader progress ----------
  function syncProgress(animate) {
    const n = window.DVR ? window.DVR.reached() : 0;
    for (let i = 0; i < 18; i++) litTarget[i] = i < n ? 1 : 0;
    if (n !== reached) { reached = n; L.truths.userData.redraw((x) => draw.truths(x, reached)); }
    if (!animate) litArr.set(litTarget);
  }
  window.addEventListener("dvr:progress", () => syncProgress(true));

  // ---------- the wheel teaches itself: hovering a sector names its chapter; truths say why they stay shut ----------
  const hint = document.getElementById("hint"), CH = (window.DV_CONTENT && window.DV_CONTENT.chapters) || [];
  const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen"];
  let hoverCh = -1, hoverWheel = -1, flash = 0;
  function sectorAt(e) {
    if (S.rings < 0.5 || root.classList.contains("is-intro") || root.classList.contains("menu-open")) return null;
    const dx = e.clientX - S.cx, dy = e.clientY - S.cy, rr = Math.hypot(dx, dy) / S.r;
    if (rr < 0.42 || rr > 1.02 || S.r < 60) return null;
    let a = Math.atan2(dx, -dy); a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let ap = a - outerAngle; ap = ((ap % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return { ch: Math.round(a / (Math.PI / 9)) % 18, petal: Math.round(ap / (Math.PI / 9)) % 18, outer: rr > 0.76 };
  }
  function showHint(e, html) { if (!hint) return; hint.innerHTML = html; hint.style.left = e.clientX + "px"; hint.style.top = e.clientY + "px"; hint.classList.add("show"); clearTimeout(hint._t); hint._t = setTimeout(() => hint.classList.remove("show"), 2200); }
  window.addEventListener("pointermove", (e) => {
    if (e.target.closest && e.target.closest("a, button, input, .proto, .bar, .menu")) { if (hoverWheel >= 0) { hoverWheel = -1; document.body.style.cursor = ""; } return; }
    const s = sectorAt(e); const i = s ? (s.outer && s.petal <= 1 ? 100 + s.petal : s.ch) : -1;
    if (i === hoverWheel) return; hoverWheel = i; document.body.style.cursor = i >= 0 ? "pointer" : "";
    if (i < 0) { hint && hint.classList.remove("show"); return; }
    if (i >= 100) showHint(e, i === 100 && reached >= 8 ? "<b>The bow</b>Open" : "<b>Sealed</b>A truth");
    else { const c = CH.find((x) => x.n === i + 1); showHint(e, c ? `<b>${c.title}</b>Chapter ${WORDS[i + 1]}${i < reached ? " · lit" : ""}` : `<b>Sealed</b>Chapter ${WORDS[i + 1]}`); }
  }, { passive: true });
  window.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("a, button, input, label, summary, .proto, .bar, .menu, .intro")) return;
    const s = sectorAt(e); if (!s) return;
    if (s.outer && s.petal <= 1) { if (s.petal === 0 && reached >= 8) { window.DVNav ? window.DVNav("/powers/") : (location.href = "/powers/"); return; } flash = 1; showHint(e, "<b>Sealed</b>It opens when you reach its chapter"); return; }
    const c = CH.find((x) => x.n === s.ch + 1); if (c) { window.DVNav ? window.DVNav("/read/" + c.n + "/") : (location.href = "/read/" + c.n + "/"); } else showHint(e, `<b>Sealed</b>Chapter ${WORDS[s.ch + 1]} is not out yet`);
  });
  window.addEventListener("dvr:hoverch", (e) => { hoverCh = e.detail ? e.detail - 1 : -1; });

  // ---------- sizing ----------
  let nebDirty = true;
  function resize() {
    const w = window.innerWidth, h = Math.min(window.innerHeight, (window.screen && window.screen.height ? window.screen.height * 1.5 : 1e5));
    const d = dpr(); renderer.setPixelRatio(d); renderer.setSize(w, h, false); composer.setPixelRatio(d); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    rt.setSize(Math.max(2, Math.round(w * d / (coarse ? 3 : 2))), Math.max(2, Math.round(h * d / (coarse ? 3 : 2)))); nebU.uRes.value.set(rt.width, rt.height);
    partU.uPR.value = ptU.uPR.value = d; nebDirty = true; PERF.w = renderer.domElement.width; PERF.h = renderer.domElement.height;
  }
  resize(); window.addEventListener("resize", resize);

  // ---------- the loop ----------
  let lastInput = performance.now(), frameNo = 0, calm = false, tilt = { x: 0, y: 0 }, tiltT = { x: 0, y: 0 };
  ["scroll", "pointermove", "keydown", "touchstart", "wheel"].forEach((t) => window.addEventListener(t, (e) => { lastInput = performance.now(); if (t === "pointermove") { tiltT.x = e.clientX / window.innerWidth - 0.5; tiltT.y = e.clientY / window.innerHeight - 0.5; } }, { passive: true }));
  const SPIN = Math.PI * 2 / 236, SPIN_IN = Math.PI * 2 / 364;
  function frame(dt) {
    const idle = performance.now() - lastInput;
    if (page === "reader" && idle > 30000 && S.boost < 0.01) return;                   // reading: rest once nobody moves
    frameNo++; if (page === "reader" && idle > 4000 && frameNo % 3 && S.boost < 0.01) return;
    const still = reduced();
    if (!still) T += dt;
    easeCols(still ? 1 : Math.min(1, dt * 3)); renderer.setClearColor(col.ink, 1); eclipse.material.color.copy(col.ink);
    for (let i = 0; i < 18; i++) litArr[i] += (litTarget[i] - litArr[i]) * Math.min(1, dt * 2.2);
    const w = window.innerWidth, h = window.innerHeight, s = SCENES[state] || SCENES.about, ar = s.anchor ? anchorRect() : null;
    let tx, ty, tr;
    if (ar) { tx = ar.left + ar.width / 2; ty = ar.top + ar.height / 2; tr = ar.width / 2; }
    else if (s.px) { [tx, ty, tr] = s.px(w, h); }
    else { tx = s.x * w; ty = s.y * h; tr = s.r * h; if (w < 900 && (state === "contents" || state === "home:index" || state === "story" || state === "about")) { tx = w * 1.02; tr = Math.min(tr, w * 0.55); }
      if (w < 900 && state === "codex") { tx = w * 0.96; ty = h * 0.13; tr = Math.min(tr, w * 0.4); }
      if (w < 900 && state === "tears") tx = w * 0.93; }
    const k = follow >= 1 ? 1 : Math.min(1, dt * (2 + 6 * follow));
    S.cx += (tx - S.cx) * k; S.cy += (ty - S.cy) * k; S.r += (tr - S.r) * k;
    const u = viewH(0) / h;
    tilt.x += (tiltT.x - tilt.x) * Math.min(1, dt * 2); tilt.y += (tiltT.y - tilt.y) * Math.min(1, dt * 2);
    wheel.position.set((S.cx - w / 2) * u, -(S.cy - h / 2) * u, 0); wheel.scale.setScalar(Math.max(0.0001, S.r * u));
    wheel.rotation.x = still || page === "reader" ? 0 : -tilt.y * 0.16; wheel.rotation.y = still || page === "reader" ? 0 : tilt.x * 0.2;
    tear.position.set(wheel.position.x, wheel.position.y, -0.6); tear.scale.set(Math.max(1.2, wheel.scale.x * 1.2), viewH(-0.6) * 1.05, 1);
    if (!still) { outerAngle += SPIN * dt; innerAngle += SPIN_IN * dt; }
    L.outer.rotation.z = L.truths.rotation.z = -outerAngle; L.inner.rotation.z = innerAngle;
    const ringsA = S.rings, drawP = S.draw;
    for (const key of ["outer", "spokes", "inner", "hub"]) { const m = L[key].material.uniforms; m.uP.value = drawP; m.uA.value = ringsA; m.uColor.value = col.line; }
    flash *= 0.9; L.truths.material.uniforms.uP.value = drawP; L.truths.material.uniforms.uA.value = ringsA * (0.9 + 1.4 * flash); L.truths.material.uniforms.uColor.value = col.lit;
    S.boost *= Math.pow(0.35, dt);
    ptU.uA.value = S.pts * Math.min(1, Math.max(0, drawP * 1.4 - 0.4)); ptU.uScale.value = Math.max(0.42, S.r / 260); ptU.uHover.value = hoverCh >= 0 ? hoverCh : (S.boost > 0.02 ? boostI : -1);
    partU.uTime.value = T; partU.uAlpha.value = S.parts; partU.uSize.value = 24 * Math.max(0.6, Math.min(1.6, S.r / 300));
    tearU.uOpen.value = S.tear; tearU.uTime.value = T;
    nebU.uTime.value = T; nebU.uIntensity.value = S.neb; nebU.uGlow.value.set(S.cx / w, 1 - S.cy / h, ringsA);
    finU.uTime.value = still ? 0 : Math.floor(T * 24) / 24;
    if (nebDirty || calm || still || frameNo % LVS[LV].neb === 0) { renderer.setRenderTarget(rt); renderer.render(bgScene, bgCam); renderer.setRenderTarget(null); nebDirty = false; }   // the smoke changes slowly
    composer.render();
  }

  // ---------- what the pages ask for ----------
  const API = {
    intro(returning) {   // dust gathers into the wheel while its engraving draws itself
      const cur0 = window.DVRoute && window.DVRoute.current(); page = cur0 ? cur0.name : "home"; goState("intro", true); S.draw = 0; S.neb = 0; partU.uW.value.set(1, 0, 0, 0); S.parts = 0.7;
      tw(S, { neb: 0.7 }, returning ? 0.8 : 2.2, "power2.out");
      tw(partU.uW.value, { x: 0.0, y: 1 }, returning ? 1.0 : 2.8, "power2.inOut", returning ? 0 : 0.5);
      tw(S, { draw: 1 }, returning ? 1.0 : 2.6, "power2.inOut", returning ? 0.2 : 1.0);
    },
    open() { tw(S, { draw: 1 }, 0.4); goState(pageState()); },
    enter(name, opts) {
      syncProgress(!!(opts && !opts.first)); page = name;
      if (root.classList.contains("is-intro") && opts && opts.first) return;          // the threshold is showing; open() follows it
      goState(pageState(), opts && opts.first);
      if (S.draw < 1) tw(S, { draw: 1 }, 1.4, "power2.inOut", 0.3);
    },
    leave() {},
    sub(name) { if (page !== "home" || menuOpen) return; const key = name === "index" ? "home:index" : name === "four" ? "home:four" : "home"; if (key !== state) goState(key); },
    menu(open) { menuOpen = open; goState(pageState()); },
    eclipse() { if (!gs || reduced()) return; eclipse.position.x = -1.6; eclipse.material.opacity = 1; gs.to(eclipse.position, { x: 1.6, duration: 1.4, ease: "power2.inOut", overwrite: "auto", onComplete: () => { eclipse.material.opacity = 0; } }); },
    light(n) { boostI = n - 1; S.boost = 1; syncProgress(true); lastInput = performance.now(); },
    _dbg(n) { for (let i = 0; i < (n || 0); i++) frame(0.05); },   // profiling: run n frames by hand
    _objs() { return { bloom, composer, renderer, parts, rt, scene, bgScene, nebU, partU }; },
  };
  syncProgress(false);
  window.DVGL = API;
  let period = 1000 / 60, recent = [], late = 0, count = 0, secT = 0, bad = 0, good = 0, warmT = 0, rest = 0;
  const lost = [0, 0, 0, 0];   // how often each level was lost; climbing back to it waits longer each time
  const applyLevel = () => { const L0 = LVS[LV]; nebU.uOct.value = L0.oct; geo.setDrawRange(0, Math.floor(N * L0.parts)); PERF.lv = LV; };
  function setLevel(n) { if (n < LV) lost[LV]++; LV = n; Q = Math.min(Q, LVS[LV].q); applyLevel(); resize(); PERF.q = Q; bad = good = 0; warmT = 3000; }
  applyLevel();
  function pace(time, dms) {
    const ms = Math.min(dms, 100);
    // nothing moving (no scroll, pointer, key or transition for a few seconds): about 30 frames a second is plenty for a slow wheel
    calm = performance.now() - lastInput > 2500 && follow >= 1 && S.boost < 0.01 && !root.classList.contains("is-intro") && !(gs && (gs.isTweening(S) || gs.isTweening(partU.uW.value) || gs.isTweening(eclipse.position)));
    PERF.calm = calm;
    if (calm) { rest += ms; if (rest < 28) return; const step = rest; rest = 0; frame(Math.min(step, 50) / 1000); return; }
    rest = 0;
    if (!document.hidden && !reduced()) {
      warmT += ms; count++; secT += ms; recent.push(ms); if (recent.length > 180) recent.shift();
      if (ms > period * 1.6) late++;
      if (secT >= 1000) {
        const s = recent.slice().sort((a, b) => a - b); period = Math.max(4, s[Math.floor(s.length * 0.2)] || period);
        PERF.fps = Math.round(count * 1000 / secT); PERF.hz = Math.round(1000 / period);
        const lateShare = late / Math.max(1, count); PERF.late = Math.round(lateShare * 100);
        if (warmT > 5000) {
          if (lateShare > 0.25) { good = 0; if (++bad >= 3) { if (LV > 0) setLevel(LV - 1); else if (Q > QMIN) { Q = Math.max(QMIN, Q * 0.9); resize(); bad = 0; } } }
          else if (lateShare < 0.05) { bad = 0; good++;
            if (Q < LVS[LV].q - 0.001) { if (good >= 4) { Q = Math.min(LVS[LV].q, Q * 1.1); resize(); good = 0; } }
            else if (LV < 3 && good >= 6 * Math.pow(2, Math.min(4, lost[LV + 1]))) setLevel(LV + 1); }
          else { bad = 0; good = 0; }
        }
        late = 0; count = 0; secT = 0; PERF.q = Q;
      }
    } else { late = 0; count = 0; secT = 0; }
    frame(Math.min(ms, 50) / 1000);
  }
  if (gs) { gs.ticker.add(pace); }
  else { let last = 0; const loop = (t) => { requestAnimationFrame(loop); frame(last ? Math.min(0.05, (t - last) / 1000) : 0); last = t; }; requestAnimationFrame(loop); }
  document.addEventListener("visibilitychange", () => { if (gs) { if (document.hidden) gs.ticker.sleep(); else gs.ticker.wake(); } });
  const cur = window.DVRoute && window.DVRoute.current();
  if (root.classList.contains("is-intro")) API.intro(root.classList.contains("returning"));
  else if (cur) { page = cur.name; goState(page, true); S.draw = 1; }
  (function warm() {
    const shown = []; scene.traverse((o) => { if (!o.visible) { shown.push(o); o.visible = true; } });
    try { if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {}); else renderer.compile(scene, camera); } catch (e) {}
    shown.forEach((o) => { o.visible = false; });
    scene.traverse((o) => { const m = o.material; if (!m) return; const u = m.uniforms; if (u) for (const k in u) { const v = u[k].value; if (v && v.isTexture && v.image) try { renderer.initTexture(v); } catch (e) {} } });
  })();
  window.__sceneReady = true;
  root.classList.remove("no-webgl");
}

try { boot(); } catch (e) { root.classList.add("no-webgl"); if (window.console) console.error("scene failed:", e); }
