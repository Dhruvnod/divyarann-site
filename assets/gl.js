/* DIVYARANN, the live site's wheel: the Reliquary. The one WebGL canvas behind every page, with the wheel built as a round shield
   of blackened steel in the bow's colours: a rolled, riveted rim; eighteen angled plates, one per chapter, with violet light rising
   through the seams and cracks of light in some; a cord-bound collar; a hammered field with the lotus in relief; a turned boss
   holding the violet orb; silver worn into every edge; the old wheel's drawing cut into the steel as light. Behind it the old 2D
   wheel glows as a vignette with ticks and beams: the truths' wheel turning with the rim, the chapters' ring of leaves turning the
   other way inside it. Dust gathers into it, it forms along a burning edge, it lights an orb per chapter read. It only listens:
   app.js renders the pages and calls DVGL.enter / DVGL.leave. If anything fails, the page is complete without it.
   Built by tools/site_v2/wheel/make_live_gl.py; edit the sources there, not this file. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const root = document.documentElement;
const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarse = window.matchMedia("(pointer: coarse)").matches;
const reduced = () => reduceMQ.matches || root.classList.contains("dv-still");
const gs = window.gsap || null;

// ---------- palettes (sRGB hex; THREE converts to linear). Accents get pushed above 1 where they should bloom ----------
const PAL = {
  akash: { ink: "#050407", mist: "#120c18", accent: "#a77dff", line: "#8d86a0", hot: "#f1e5ff", glow: "#8a42e6", lit: "#c9a6ff", veil: "#050407", burn: "#a274ff" },
  grahan: { ink: "#070304", mist: "#200a0c", accent: "#ff8a5c", line: "#a88a5a", hot: "#fff1e6", glow: "#d0452a", lit: "#ffb27a", veil: "#070304", burn: "#ff6a3d" },
};
const palName = () => (root.getAttribute("data-palette") === "grahan" ? "grahan" : "akash");
// the bow's steel: near-black with a plum-brown oxide, rubbed back to silver on every edge; its cord grip; dark iron fittings
const STEEL = { dark: "#1b1a1f", base: "#4a4650", warm: "#4a3a44", edge: "#d2ccd6", leather: "#2a2030", leather2: "#3d3044", iron: "#4f4b55", gold: "#d4aa55" };
// ---------- the design variants: ?design=a|b|c|d|e (none: the shield as first published) ----------
// Each answers one reader need. Everything below is a plain number read by the shaders and the layout; the defaults are the
// published shield, so a design only lists what it changes.
const DESIGN_DEFAULTS = {
  name: "Current", note: "",
  // the vignette: the old wheel's drawing as light behind the shield
  halo: "outer",          // the drawing: outer (petals and rings) | ornate (adds ticks, small leaves, a second ring)
  hs: 1,                  // the vignette's radius against the shield's
  fit: 1,                 // the whole wheel against the page's anchor (the hero's wheel box, the dock)
  vigIn: 0.74, vigOut: 1.07,   // the drawing is full strength out to vigIn (shield units) and gone by vigOut
  line: 1, sharp: 1, soft: 0, blur: 26,  // line gain; crisp lines; a blurred copy of them (gain, blur radius in canvas px) for a haze
  spill: 0.32, spillFall: 9, rays: 0.4, breathe: 0.18,   // light spilling from behind the rim: gain, how fast it dies, ray unevenness
  turns: true,            // the vignette turns with the rim (false: it stays put, its petals under their chapters)
  prog: 0, dim: 0.3, litK: 1.9, spillDim: 0.3, next: 0,   // progress in the vignette: unread wedge, read wedge, the next chapter's ember
  crown: 0,               // 1: the light gathers above the shield and fades towards the bottom
  beam: 0, beamTop: 0,    // narrow rays between the petals; beamTop: 1 fades the lower ones
  fat: 0, fatMin: 0,      // thick strokes that take over when the wheel is small (the dock); fatMin: how much of them there is at any size
  smoke: 1,               // the violet smoke round the wheel
  glow: "vignette",       // vignette | both | etched
  // the steel
  rough: 0, wear: 1, vein: 1, groove: 1, seam: 1, lineBase: 1, lineLit: 1, pulse: 1, ham: 1, flick: 1, ox: 1, etchK: 1,
  env: 1, envTop: 1, envBelow: 0.4, strip: 1, stripW: 0.16,   // reflections: strength, the overhead light, the violet from below, the tall softbox strip and its width
  cap: 9,                 // the steel's brightness is held to this (the glow starts at 1: below it, only the violet blooms)
  orb: 1, orbGain: 1, dots: 0, ptMin: 0.42,    // chapter orbs: size, glow; dots: show unread orbs as dim points when small
  steel: {},
  spin: 1,                // how fast the rim turns
  dock: [34, 22],         // the wheel's radius in the reading dock (desktop, phone), px
  dockFix: 0, dockCA: 0.15, dockVig: 0.3,      // 1: in the dock, the film pass fringes colour and darkens the corner far less
};
// what all five share, because the published shield gets each of these wrong: the tall softbox strip reads as a pale rectangle on the
// steel (made small and soft), the violet from below turns the silver crest into a white smear that blooms (lowered, and the steel
// held just under the glow threshold), and the corner where the wheel docks is fringed and darkened by the film pass (eased off there)
const COMMON = { cap: 0.95, strip: 0.15, stripW: 0.35, envBelow: 0.25, dockFix: 1 };
const DESIGNS = {
  base: {},
  // A, for reading: nothing moves your eye. A haze instead of line art, satin steel, no flicker, a slow rim
  a: { name: "Vigil", sharp: 0.16, soft: 0.8, blur: 60, line: 0.6, vigOut: 0.99, spill: 0.2, spillFall: 13, rays: 0.1, breathe: 0.04, smoke: 0.45,
    rough: 0.22, wear: 0.4, vein: 0.35, groove: 0.45, seam: 0.4, lineBase: 0.6, lineLit: 0.7, pulse: 0.15, ham: 0.7, flick: 0, ox: 1.6,
    env: 0.75, envBelow: 0.12, strip: 0, orbGain: 0.75, spin: 0.35, steel: { warm: "#5a3f48", edge: "#b8b1bd" } },
  // B, progress: the vignette is the record. Its petals stand under their chapters; unread ones are embers, read ones burn,
  // and the next one waits
  b: { name: "Kindling", turns: false, prog: 1, dim: 0.3, litK: 2.1, spillDim: 0.25, next: 1, line: 1.05, spill: 0.4, vigOut: 1.12, dock: [38, 24] },
  // C, the hero: light crowns the shield and falls away below it, so the title has a clean dark floor
  c: { name: "Crown", crown: 1, hs: 1.1, fit: 0.94, vigOut: 1.12, line: 1.3, spill: 0.6, spillFall: 5.5, rays: 0.55, strip: 0.1, envBelow: 0.15, rough: 0.06 },
  // D, small: a bold silver rim, thick lines that take over when the wheel shrinks, a clock of eighteen dots, a bigger dock
  d: { name: "Seal", fat: 1, fatMin: 0.25, line: 1.15, orb: 1.35, wear: 1.5, ham: 0.6, dots: 1, ptMin: 0.85, vein: 0.8, spill: 0.42, dock: [46, 28], steel: { edge: "#eeeaf2" } },
  // E, ornament: the drawing is cut into the steel as well, a second turning ring, a sunburst, a bigger and brighter halo
  e: { name: "Reliquary", halo: "ornate", hs: 1.15, fit: 0.9, vigOut: 1.14, line: 1.5, spill: 0.5, spillFall: 5, beam: 0.8, beamTop: 0.7, glow: "both", wear: 1.25, vein: 1.2, groove: 5, etchK: 1.1,
    spin: 1.35, dock: [38, 24], steel: { base: "#54505c", edge: "#e6e0ea" } },
  // F, the suggestion rendered (not a sixth idea): Kindling's halo that records progress, Crown's lift and fade for the title, Seal's dock
  f: { name: "Mix", turns: false, prog: 1, dim: 0.3, litK: 2.1, spillDim: 0.25, next: 1, crown: 0.6, hs: 1.1, fit: 0.94, vigOut: 1.12, line: 1.2, spill: 0.5, spillFall: 6.5, rays: 0.5,
    rough: 0.06, strip: 0.1, envBelow: 0.15, fat: 1, fatMin: 0.15, orb: 1.3, wear: 1.3, ham: 0.7, dots: 1, ptMin: 0.85, dock: [44, 28], steel: { edge: "#eeeaf2" } },
};
const DESIGN_KEY = "e";   // the live site: the Reliquary
const D = Object.assign({}, DESIGN_DEFAULTS, DESIGN_KEY in DESIGNS && DESIGN_KEY !== "base" ? COMMON : {}, DESIGNS[DESIGN_KEY] || DESIGNS.base);
// test switch: ?tune=envBelow:0.1,rough:0.2 overrides any number above, for trying a value without a rebuild
{ const t = (/[?&]tune=([^&]+)/.exec(location.search) || [])[1]; if (t) t.split(",").forEach((kv) => { const [k, v] = kv.split(":"); if (k in D && !isNaN(+v)) D[k] = +v; }); }
Object.assign(STEEL, D.steel);
const RING = { truthS: 1.16, chapS: 0.82 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };


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
const NOISE3 = `
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 0.0)), h13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(h13(i + vec3(0.0, 0.0, 1.0)), h13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 1.0)), h13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
float fb3(vec3 p, int oct){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ if (i >= oct) break; v += a * vn3(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }`;
const FS_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const QUAD_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

// ---------- the wheel's drawings (the site's own geometry, in its 760-unit frame); the dust and the sealed truths use them ----------
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
  etch(x) { ring(x, 252, 1.8, 1); for (let i = 0; i < 18; i++) { x.save(); x.rotate(i * Math.PI / 9); x.globalAlpha = 0.45; x.lineWidth = 1.1; x.beginPath(); x.moveTo(0, -252); x.lineTo(0, -112); x.stroke(); x.restore(); } x.globalAlpha = 1; draw.inner(x); draw.hub(x); },
  outerFat(x) { ring(x, 360, 5, 0.55); ring(x, 342, 9, 1); const p = new Path2D(PETAL); for (let i = 0; i < 18; i++) { x.save(); x.rotate(i * Math.PI / 9); x.lineWidth = 9; x.stroke(p); x.restore(); } },   // the same drawing in thick strokes, for a small wheel
  ornateA(x) { draw.outer(x); ring(x, 372, 1, 0.4);   // the drawing plus a ring of seventy-two ticks, every fourth longer
    for (let i = 0; i < 72; i++) { x.save(); x.rotate(i * Math.PI / 36); x.globalAlpha = i % 4 === 0 ? 0.95 : 0.5; x.lineWidth = i % 4 === 0 ? 1.5 : 1.1; x.beginPath(); x.moveTo(0, -360); x.lineTo(0, i % 4 === 0 ? -371 : -366); x.stroke(); x.restore(); } x.globalAlpha = 1; },
  ornateB(x) { const leaf = new Path2D("M0,-340 C 11,-326 12,-306 0,-288 C -12,-306 -11,-326 0,-340 Z");   // a small leaf between every pair of petals, a circle at every petal's tip
    for (let i = 0; i < 18; i++) { x.save(); x.rotate((i + 0.5) * Math.PI / 9); x.lineWidth = 1.4; x.stroke(leaf); x.restore(); x.save(); x.rotate(i * Math.PI / 9); x.globalAlpha = 0.9; x.lineWidth = 1.3; x.beginPath(); x.arc(0, -351, 3.6, 0, Math.PI * 2); x.stroke(); x.restore(); }
    ring(x, 351, 1, 0.35, [1.5, 5.5]); },
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

// ---------- the shield's geometry, in the unit frame (radius 1 = 360 drawing units); angles run clockwise from the top ----------
// a round shield of blackened steel: a rolled, riveted rim; eighteen angled plates on a shallow cone, one per chapter, with light
// rising through the seams; a cord-bound collar; a hammered field rising to a turned boss that holds the orb
const SEG = Math.PI / 9;                                   // 20 degrees: eighteen chapters
const polar = (r, a) => new THREE.Vector2(r * Math.sin(a), r * Math.cos(a));
const R_RIM = 0.652, R_OUT = 0.729, R_PL0 = 0.447, R_PL1 = 0.666, R_ORB = 0.6;
const plateZ = (r) => 0.042 + 0.16 * (R_PL1 - r);         // the plates' front face: a shallow cone, so the shield bulges towards the reader
const FIELD = [[0.41, 0.046], [0.41, 0.066], [0.4, 0.073], [0.36, 0.082], [0.3, 0.09], [0.24, 0.096], [0.18, 0.1], [0.148, 0.101], [0.142, 0.096]];
function fieldZ(r) { for (let i = 2; i < FIELD.length; i++) { const [r0, z0] = FIELD[i - 1], [r1, z1] = FIELD[i]; if (r <= r0 && r >= r1) return z0 + (z1 - z0) * (r0 - r) / (r0 - r1); } return r > 0.4 ? 0.073 : 0.101; }
function tagged(geo, part) {   // non-indexed, with the part id the steel shader finishes by
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute && g.attributes.uv && part >= 0 && g.deleteAttribute("uv");
  g.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1)); return g;
}
function chiselled(geo, part) {   // crisp chamfers, smooth curves: normals shared only across shallow creases
  const g = tagged(geo, part); g.scale(1000, 1000, 1000); const out = toCreasedNormals(g, 0.42); out.scale(0.001, 0.001, 0.001); return out;
}
function extrude(shape, depth, bt, bs, z0, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 2, curveSegments: curve, steps: 1 });
  g.translate(0, 0, z0 - depth / 2); return g;
}
function petalShape(scale, cx, cy, path) {   // the site's petal / lotus paths, flipped into y-up units
  const s = new THREE.Shape(), k = 1 / 360 * scale, P = (x, y) => [cx + x * k, cy - y * k];
  const m = path.match(/-?\d+(\.\d+)?/g).map(Number);   // M x y C (6) C (6)
  s.moveTo(...P(m[0], m[1])); s.bezierCurveTo(...P(m[2], m[3]), ...P(m[4], m[5]), ...P(m[6], m[7])); s.bezierCurveTo(...P(m[8], m[9]), ...P(m[10], m[11]), ...P(m[12], m[13]));
  return s;
}
function annulusSector(r0, r1, a0, a1, n) {
  const pts = []; for (let i = 0; i <= n; i++) pts.push(polar(r1, a0 + (a1 - a0) * i / n)); for (let i = n; i >= 0; i--) pts.push(polar(r0, a0 + (a1 - a0) * i / n));
  return new THREE.Shape(pts);
}
const lathe = (prof, seg) => { const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), seg); g.rotateX(Math.PI / 2); return g; };
function bend(geo, fz) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + fz(Math.hypot(p.getX(i), p.getY(i)))); return geo; }

function buildShieldGeometry() {
  const rim = [], plates = [], field = [], seams = [], spokes = [];
  // the rim: rolled steel, its inner lip overhanging the plates' outer edge
  rim.push(chiselled(lathe([[R_RIM, -0.004], [R_RIM, 0.03], [0.66, 0.047], [0.675, 0.057], [0.695, 0.061], [0.712, 0.055], [0.724, 0.041], [R_OUT, 0.02], [0.728, -0.012], [0.72, -0.034], [0.7, -0.047], [0.668, -0.05]], 220), 1));
  for (let i = 0; i < 18; i++) {
    const a = i * SEG;
    // the plate, centred on its chapter's angle, with a socket for the chapter's orb near the rim
    const g = extrude(annulusSector(R_PL0, R_PL1, a - SEG / 2 + 0.016, a + SEG / 2 - 0.016, 30), 0.024, 0.006, 0.005, 0.0, 2);
    g.translate(0, 0, 0.024); bend(g, (r) => 0.16 * (R_PL1 - r)); plates.push(chiselled(g, 2));
    const sock = new THREE.CylinderGeometry(0.025, 0.028, 0.014, 32, 1); sock.rotateX(Math.PI / 2); const p = polar(R_ORB, a); sock.translate(p.x, p.y, plateZ(R_ORB) + 0.004); plates.push(chiselled(sock, 3));
    // the seam after it: light rising from under the plates
    const slab = new THREE.BoxGeometry(0.006, R_PL1 - R_PL0 - 0.012, 0.03, 1, 6, 1); slab.translate(0, (R_PL0 + R_PL1) / 2, 0.02); slab.rotateZ(-(a + SEG / 2)); bend(slab, (r) => 0.16 * (R_PL1 - r));
    seams.push(inlayTag(slab, 2, i));
    // the chapter's line down the plate's middle, from the collar to its orb
    const len = R_ORB - 0.028 - 0.462, strip = new THREE.PlaneGeometry(0.0046, len, 1, 4); strip.translate(0, 0.462 + len / 2, 0); strip.rotateZ(-a); bend(strip, (r) => plateZ(r) + 0.0008);
    spokes.push(inlayTag(strip, 0, i));
  }
  // the shield's back, and the floor under the plates: a shallow dish
  field.push(chiselled(lathe([[0.0, -0.077], [0.2, -0.075], [0.4, -0.067], [0.58, -0.057], [0.664, -0.048], [0.668, -0.02], [0.668, 0.0], [0.6, 0.011], [0.445, 0.036], [0.412, 0.042]], 180), 0));
  // the field, hammered, rising to the boss; the boss, turned, its lip seating the orb
  field.push(chiselled(lathe(FIELD, 200), 4));
  field.push(chiselled(lathe([[0.145, 0.094], [0.145, 0.104], [0.139, 0.113], [0.127, 0.125], [0.112, 0.135], [0.099, 0.141], [0.092, 0.14], [0.088, 0.131], [0.085, 0.118]], 160), 5));
  // ten lotus petals in relief on the field, round the boss (the old wheel's lotus)
  for (let i = 0; i < 10; i++) { const g = extrude(petalShape(1, 0, 0, LOTUS), 0.006, 0.003, 0.0025, 0.0, 16); g.rotateZ(-i * Math.PI / 5); bend(g, (r) => fieldZ(r) + 0.004); field.push(chiselled(g, 7)); }
  const toGeo = (list) => (list.length ? mergeGeometries(list) : null);
  return { rim: toGeo(rim), plates: toGeo(plates), field: toGeo(field), seams: toGeo(seams), spokes: toGeo(spokes) };
}
function inlayTag(geo, kind, idx) {
  const g = geo.index ? geo.toNonIndexed() : geo; const n = g.attributes.position.count;
  g.deleteAttribute("uv"); g.deleteAttribute("normal");
  g.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1)); g.setAttribute("aIdx", new THREE.BufferAttribute(new Float32Array(n).fill(idx), 1)); return g;
}

function boot() {
  const canvas = document.getElementById("gl");
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const glc = renderer.getContext(), dbgExt = glc.getExtension("WEBGL_debug_renderer_info"), gpuName = dbgExt ? String(glc.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL)) : "";
  const HW = /[?&]hw=1/.test(location.search);
  const software = !HW && /swiftshader|llvmpipe|basic render|software/i.test(gpuName), strong = HW || /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro/i.test(gpuName);
  const webgl2 = renderer.capabilities.isWebGL2, msaaOk = webgl2 && renderer.extensions.has("EXT_color_buffer_float");
  const tier = software || !webgl2 ? 0 : coarse ? ((navigator.hardwareConcurrency || 4) >= 8 ? 2 : 1) : 3;
  const TIER = [{ px: 0.6e6, n: 6000, oct: 3, bloom: 0.25 }, { px: 0.8e6, n: 14000, oct: 3, bloom: 0.3 }, { px: 1.2e6, n: 22000, oct: 4, bloom: 0.35 }, { px: strong ? 3.4e6 : 1.8e6, n: 30000, oct: 4, bloom: 0.4 }][tier];
  // resolution: Q scales the screen's own pixel ratio (up to 2). A discrete GPU starts at full sharpness; anything else starts
  // from its tier's pixel budget and climbs towards full sharpness while frames stay on time
  const fullPx = () => window.innerWidth * window.innerHeight * Math.pow(Math.min(window.devicePixelRatio || 1, 2), 2);
  // and four levels of effects (glow resolution, how much dust, smoke detail, how often the smoke is redrawn, the stone's
  // detail and edge smoothing), each with a resolution ceiling. Late frames lower the level, so the effects lighten before
  // the image softens; frames on time first raise the resolution to the level's ceiling, then the level
  const LVS = [[0.16, 0.35, 2, 3, 2, 0], [0.22, 0.55, 3, 2, 3, 2], [0.3, 0.75, 3, 1, 4, 4], [TIER.bloom, 1, TIER.oct, 1, 5, 4]].map(([bloom, parts, oct, neb, det, msaa], i) =>
    ({ bloom: Math.min(bloom, TIER.bloom), parts, oct: Math.min(oct, TIER.oct), neb, det, msaa: msaaOk ? msaa : 0, q: strong ? (i ? 1 : 0.86) : [0.72, 0.86, 1, 1][i] }));
  let LV = software ? 0 : strong ? 3 : 2;
  let Q = strong ? 1 : Math.min(LVS[LV].q, Math.sqrt(TIER.px / fullPx()));
  const QMIN = strong ? 0.86 : software ? 0.4 : 0.6;
  const PERF = window.DVPerf = { fps: 60, q: Q, lv: LV, gpu: gpuName, software, strong, late: 0, calm: false, w: 0, h: 0 };
  const dpr = () => Q * Math.min(window.devicePixelRatio || 1, 2);
  const col = {}; for (const k in PAL.akash) col[k] = new THREE.Color(PAL[palName()][k]);
  const PALC = {}; for (const n in PAL) { PALC[n] = {}; for (const k in PAL[n]) PALC[n][k] = new THREE.Color(PAL[n][k]); }
  const easeCols = (r) => { const p = PALC[palName()]; for (const k in col) col[k].lerp(p[k], r); };
  const SC = {}; for (const k in STEEL) SC[k] = new THREE.Color(STEEL[k]);
  renderer.setClearColor(col.ink, 1);

  // nebula and the smoke that curls around the wheel, into a small target
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const nebU = { uRes: { value: new THREE.Vector2(4, 4) }, uTime: { value: 0 }, uIntensity: { value: 0 }, uOct: { value: TIER.oct }, uInk: { value: col.ink }, uMist: { value: col.mist }, uAccent: { value: col.glow }, uGlow: { value: new THREE.Vector3(0.5, 0.5, 0) }, uWheel: { value: new THREE.Vector4(0, 0, 1, 0) } };
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: FS_VERT, depthTest: false, depthWrite: false, uniforms: nebU,
    fragmentShader: NOISE + `uniform vec2 uRes; uniform float uTime, uIntensity; uniform int uOct; uniform vec3 uInk, uMist, uAccent, uGlow; uniform vec4 uWheel;
      void main(){ vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; float t = uTime * 0.02;
        vec2 q = vec2(fbm(uv * 1.6 + vec2(0.0, t), uOct), fbm(uv * 1.6 + vec2(5.2, 1.3 - t), uOct));
        float n = fbm(uv * 1.9 + 1.8 * q + vec2(t, 0.0), uOct);
        vec3 c = mix(uInk, uMist, smoothstep(0.32, 0.95, n) * uIntensity);
        vec2 g = (gl_FragCoord.xy / uRes - uGlow.xy) * vec2(uRes.x / uRes.y, 1.0);
        c += uAccent * 0.07 * exp(-length(g) * 2.4) * uGlow.z * uIntensity;
        // violet smoke curling around the stone, drifting the way the rim turns
        vec2 w = (gl_FragCoord.xy - uWheel.xy) / max(uWheel.z, 1.0); float wr = length(w);
        float ca = cos(uTime * 0.05), sa = sin(uTime * 0.05); vec2 sw = mat2(ca, -sa, sa, ca) * w;
        float sm = fbm(sw * 2.1 + q * 1.4 + vec2(0.0, uTime * 0.04), uOct);
        float band = smoothstep(0.55, 0.98, wr) * (1.0 - smoothstep(1.05, 1.85, wr)) + 0.35 * exp(-wr * 5.0);
        vec3 smokeC = mix(uAccent, vec3(dot(uAccent, vec3(0.333))), 0.45); c += smokeC * smoothstep(0.42, 0.82, sm) * band * 0.15 * uWheel.w;
        c *= 1.0 - 0.6 * smoothstep(0.25, 1.15, length(uv));
        gl_FragColor = vec4(c, 1.0); }` })));

  const scene = new THREE.Scene(); scene.background = rt.texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60); camera.position.z = 10;
  const viewH = (z) => 2 * (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // a small studio for reflections on iron and polished edges: dark, a soft cool light above, violet below
  {
    const envScene = new THREE.Scene(), envU = { uGlow: { value: new THREE.Color(PAL.akash.glow) }, uTopL: { value: D.envTop }, uStrip: { value: D.strip }, uStripW: { value: D.stripW }, uBelow: { value: D.envBelow } };
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: envU,
      vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 uGlow; uniform float uTopL, uStrip, uStripW, uBelow; varying vec3 vD; void main(){ float y = vD.y;
        vec3 c = vec3(0.012, 0.01, 0.016) + vec3(1.1, 1.06, 1.17) * uTopL * smoothstep(0.42, 0.97, y) * smoothstep(-0.2, 0.6, vD.z) + uGlow * uBelow * smoothstep(-0.3, -0.85, y) + vec3(0.25, 0.22, 0.3) * smoothstep(0.6, 1.0, -vD.x) * 0.6
          + vec3(0.2, 0.19, 0.23) * smoothstep(0.3, 0.95, vD.z) * smoothstep(-0.4, 0.7, y) + vec3(0.75, 0.73, 0.8) * uStrip * (1.0 - smoothstep(0.0, uStripW, abs(vD.x + 0.42))) * smoothstep(0.0, 0.5, vD.z) * smoothstep(-0.6, 0.6, y);
        gl_FragColor = vec4(c, 1.0); }` })));
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.04).texture; pm.dispose();
  }
  const keyDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  scene.add(new THREE.HemisphereLight(0x2c2834, 0x050407, 0.55));
  const key = new THREE.DirectionalLight(0xfff3e8, 3.4); key.position.copy(keyDir).multiplyScalar(10); scene.add(key);
  const rimL = new THREE.DirectionalLight(0x9a70ff, 1.5); rimL.position.set(6, -1.5, 2.5); scene.add(rimL);
  const fillL = new THREE.DirectionalLight(0x606a90, 0.45); const WHITE = new THREE.Color(1, 1, 1); fillL.position.set(-3, -4, 4); scene.add(fillL);

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
  const partU = { uW: { value: new THREE.Vector4(1, 0, 0, 0) }, uTime: { value: 0 }, uSize: { value: 30 }, uPR: { value: 1 }, uDrift: { value: 0.03 }, uTurb: { value: 0.35 }, uColor: { value: col.accent }, uAlpha: { value: 0 }, uSpin: { value: 0 }, uGold: { value: SC.gold }, uGoldDust: { value: 0 } };
  const parts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: partU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: NOISE + `attribute vec3 aS0; attribute vec3 aS1; attribute vec3 aS2; attribute vec3 aS3; attribute float aSeed;
      uniform vec4 uW; uniform float uTime, uSize, uPR, uDrift, uTurb, uSpin; varying float vA, vG;
      void main(){ vec4 w = pow(uW, vec4(1.0 + aSeed * 2.0)); w /= max(dot(w, vec4(1.0)), 1e-5);
        vec3 s1 = aS1; float c = cos(uSpin), s = sin(uSpin); s1.xy = mat2(c, -s, s, c) * s1.xy;
        vec3 p = aS0 * w.x + s1 * w.y + aS2 * w.z + aS3 * w.w;
        float transit = 1.0 - max(max(w.x, w.y), max(w.z, w.w));
        p.xy += curl2(p.xy * 1.4 + aSeed * 7.0 + uTime * 0.04) * (uDrift * (0.4 + w.x * 2.0) + transit * uTurb);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPR * (0.5 + 0.8 * aSeed) / -mv.z;
        vA = 0.3 + 0.7 * fract(aSeed * 13.7 + uTime * 0.08); vG = step(fract(aSeed * 7.13), 0.2); }`,
    fragmentShader: "uniform vec3 uColor, uGold; uniform float uAlpha, uGoldDust; varying float vA, vG; void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a; float g = vG * uGoldDust; gl_FragColor = vec4(mix(uColor, uGold * 2.2, g), a * vA * uAlpha * (1.0 + g * 1.5)); }" }));
  parts.frustumCulled = false; parts.renderOrder = 6;

  // ---------- the shield, with the old wheel behind it as light ----------
  const wheel = new THREE.Group(); scene.add(wheel); wheel.add(parts);
  const tiltG = new THREE.Group(); wheel.add(tiltG);                       // the shield leans; the dust keeps the page's plane
  const outerG = new THREE.Group(), innerG = new THREE.Group(), staticG = new THREE.Group(); tiltG.add(outerG, innerG, staticG);
  const haloParent = D.turns ? outerG : staticG;                           // the vignette turns with the rim, or stays under its chapters
  const litArr = new Float32Array(18), litTarget = new Float32Array(18);
  const big = coarse ? 1536 : 2048;
  const lineTex = (fn) => { const { c, x } = canvasFor(big, 380); fn(x); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t; };
  const etchTex = lineTex(draw.etch);
  // the drawing as a haze: drawn off the canvas with its shadow brought back, so only the blurred copy is left (blur: shadow radius in canvas pixels)
  const softTex = (fn, blur) => { const size = 1024, { c, x } = canvasFor(size, 380), off = size * 3, k = size / 760; x.translate(-off / k, 0); x.shadowColor = "#fff"; x.shadowBlur = blur; x.shadowOffsetX = off; fn(x); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };
  const W = { uP: { value: 0 }, uA: { value: 0 }, uTime: { value: 0 }, uGlow: { value: col.glow }, uHot: { value: col.hot }, uDet: { value: LVS[LV].det }, uLit: { value: litArr }, uHl: { value: -1 }, uKey: { value: keyDir },
    uSteelDark: { value: SC.dark }, uSteel: { value: SC.base }, uSteelWarm: { value: SC.warm }, uSteelEdge: { value: SC.edge }, uLeather: { value: SC.leather }, uLeather2: { value: SC.leather2 }, uRune: { value: 0 }, uWs: { value: 1 },
    uEtch: { value: 0 }, uEtchMap: { value: etchTex },
    // the design's finish
    uRough: { value: D.rough }, uWear: { value: D.wear }, uVeinK: { value: D.vein }, uGrooveK: { value: D.groove }, uHam: { value: D.ham }, uFlick: { value: D.flick }, uOx: { value: D.ox }, uEtchK: { value: D.etchK },
    uSmall: { value: 0 }, uCap: { value: D.cap }, uLineBase: { value: D.lineBase }, uLineLit: { value: D.lineLit }, uPulse: { value: D.pulse }, uSeamK: { value: D.seam } };
  const REVEAL = `
    float wAng = fract(atan(vObj.x, vObj.y) / 6.28318 + 1.0); float wTip = 0.0;
    if (uP < 0.999) { float edge = uP * 1.08 + 0.02 * vn3(vObj * 40.0) - 0.04; if (wAng > edge) discard; wTip = exp(-abs(wAng - edge) * 70.0); }`;
  // standard (lit, physically based) materials, finished and revealed by the same uniforms
  function wheelMaterial(params, kind) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ transparent: true, depthWrite: true }, params));
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, W);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aPart; varying vec3 vObj; varying vec3 vObjN; varying float vPart; varying vec2 vWrapUv;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position; vObjN = normal; vPart = aPart; vWrapUv = vec2(0.0);\n#ifdef USE_WRAP\nvWrapUv = uv;\n#endif");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + NOISE3 + `
        uniform float uP, uA, uTime, uHl, uRune, uWs, uEtch; uniform int uDet; uniform float uLit[18]; uniform vec3 uGlow, uHot, uSteelDark, uSteel, uSteelWarm, uSteelEdge, uLeather, uLeather2; uniform sampler2D uEtchMap;
        uniform float uRough, uWear, uVeinK, uGrooveK, uHam, uFlick, uOx, uEtchK, uSmall, uCap;
        varying vec3 vObj; varying vec3 vObjN; varying float vPart; varying vec2 vWrapUv;
        float g2(float x){ return exp(-x * x); }
        float sdTri(vec2 p){ const float k = 1.7320508; p.x = abs(p.x) - 1.0; p.y = p.y + 1.0 / k; if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0, 0.0); return -length(p) * sign(p.y); }
        vec3 bumpN(vec3 pos, vec3 n, float h){ vec3 dx = dFdx(pos), dy = dFdy(pos); vec2 dh = vec2(dFdx(h), dFdy(h)); vec3 r1 = cross(dy, n), r2 = cross(n, dx); float det = dot(dx, r1); vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2); return normalize(abs(det) * n - grad); }`)
        .replace("void main() {", "void main() {\n" + REVEAL + `
          float sH = 0.0, sGroove = 0.0, sRough = 0.5, sEdge = 0.0, sVein = 0.0, sLit = 0.0, sEtch = 0.0; vec3 sAlb = vec3(1.0);
          {
            vec3 P = vObj * 9.0; float fw = fwidth(P.x) * 14.0, fineK = 1.0 - smoothstep(0.35, 1.2, fw);
            float big = fb3(P * 0.33, 2), mid = fb3(P * 1.6, uDet), fine = vn3(P * 14.0) * fineK;
            float r = length(vObj.xy), ang = atan(vObj.x, vObj.y), front = smoothstep(0.55, 0.9, vObjN.z);
            float nA = floor(ang / 0.3490659 + 0.5) * 0.3490659, t = r * sin(ang - nA);
            float idx = mod(floor(wAng * 18.0 + 0.5), 18.0); float lit = 0.0; for (int k = 0; k < 18; k++){ if (float(k) == idx) lit = uLit[k]; }
            sLit = lit + step(abs(idx - uHl), 0.5);
            int part = int(vPart + 0.5);
            ${kind === "wrap" ? `
              // cord wound round the collar (like the bow's grip), with iron clamps
              float b = fract(vWrapUv.x * 150.0 + vWrapUv.y), gap = smoothstep(0.0, 0.16, b) * smoothstep(1.0, 0.82, b);
              sH = gap * 0.5 + fine * 0.1; sAlb = mix(uLeather, uLeather2, smoothstep(0.3, 0.8, mid)) * (0.55 + 0.45 * gap) * (0.85 + 0.3 * fine); sRough = 0.62 + 0.2 * (1.0 - gap);` : kind === "iron" ? `
              sH = fine * 0.15 + mid * 0.2;` : `
              // the finish: hammered plates and field; turned rim, sockets and boss
              float turnF = r * 1500.0, turned = (sin(turnF + vn3(vec3(r * 30.0, 1.0, 2.0)) * 6.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.4, 1.4, fwidth(turnF)));
              float dents = vn3(P * 2.4) * 0.65 + vn3(P * 6.1 + 3.0) * 0.35;
              bool lathed = part == 1 || part == 3 || part == 5;
              sH = lathed ? turned * 0.22 + mid * 0.18 + fine * 0.1 : dents * 0.8 + mid * 0.2 + fine * 0.12;
              // wear: the plates' and petals' chamfers, the rim's crest and lip, the sockets' and boss's edges rubbed back to bright steel
              float bev = 1.0 - abs(vObjN.z);
              if (part == 2 || part == 7) sEdge = smoothstep(0.12, 0.42, bev) * (1.0 - smoothstep(0.86, 0.98, bev));
              if (part == 1) sEdge = g2((r - 0.697) / 0.011) * front + 0.6 * g2((r - 0.658) / 0.006);
              if (part == 3) { vec2 c0 = vec2(sin(nA), cos(nA)) * ${R_ORB.toFixed(3)}; sEdge = smoothstep(0.019, 0.025, length(vObj.xy - c0)) * front; }
              if (part == 5) sEdge = g2((r - 0.1) / 0.008) * 0.9 + g2((r - 0.142) / 0.005) * 0.6;
              sEdge *= 0.55 + 0.45 * smoothstep(0.3, 0.7, vn3(P * 3.0 + 11.0));   // worn unevenly
              sEdge = min(1.0, sEdge * uWear * (1.0 + 1.6 * uSmall));             // the design's wear; a small wheel keeps a bright rim
              // marks cut into the steel: two small triangles on each plate either side of its chapter line (the glyphs on the
              // bow's limbs), notches round the rim, ticks round the boss
              if (part == 2) { vec2 g = vec2(abs(t) - 0.034, r - 0.508);
                float tri = sdTri(g / 0.016) * 0.016, inT = sdTri((g - vec2(0.0, 0.0015)) / 0.0055) * 0.0055;
                sGroove = max(1.0 - smoothstep(0.0016, 0.0032, abs(tri)), 1.0 - smoothstep(-0.0004, 0.001, inT)) * front; }
              if (part == 1) { float n = abs(fract(ang / 6.28318 * 72.0) - 0.5) * 2.0; sGroove = (1.0 - smoothstep(0.08, 0.18, n)) * step(0.684, r) * step(r, 0.71) * front * 0.7; }
              if (part == 5) { float n = abs(fract(ang / 6.28318 * 36.0) - 0.5) * 2.0; sGroove = (1.0 - smoothstep(0.1, 0.22, n)) * step(0.118, r) * step(r, 0.132) * 0.8; }
              sGroove *= 1.0 - 0.6 * uSmall;
              // violet lightning in some plates, like the cracks of light on the bow's limbs
              if (part == 2) { float hp = h13(vec3(idx, 4.0, 9.0));
                if (hp > 0.62) { float sd = hp > 0.81 ? 1.0 : -1.0;
                  float yq = sd * 0.05 + (vn3(vec3(r * 90.0, idx * 7.1, 0.5)) - 0.5) * 0.016 + (vn3(vec3(r * 300.0, idx * 3.3, 1.5)) - 0.5) * 0.006;
                  float w = 0.0007 + fwidth(t) * 0.6, mk = smoothstep(0.47, 0.5, r) * (1.0 - smoothstep(0.6, 0.64, r));
                  sVein = (1.0 - smoothstep(w, w * 2.6, abs(t - yq))) * mk * front; } }
              // the old wheel's drawing, cut into the face as light
              sEtch = texture2D(uEtchMap, vObj.xy * (360.0 / 380.0) * 0.5 + 0.5).a * smoothstep(0.35, 0.8, vObjN.z) * uEtch * step(0.5, vPart);
              sH -= sGroove * 0.6 + sVein * 0.3 + sEtch * 0.25;
              // colour: blackened steel, plum-brown where it has oxidised, bright where it is worn
              vec3 a0 = mix(uSteelDark, uSteel, 0.35 + 0.4 * smoothstep(0.3, 0.72, mid)); a0 = mix(a0, uSteelWarm, min(1.0, smoothstep(0.55, 0.82, big) * 0.55 * uOx));
              a0 *= 0.86 + 0.28 * smoothstep(0.3, 0.8, lathed ? turned : dents);
              sAlb = mix(a0 * (0.86 + 0.28 * fine), uSteelEdge, sEdge) * (1.0 - max(sGroove, sVein) * 0.65) * (1.0 - sEtch * 0.4);
              sRough = (part == 5 ? 0.36 : part == 0 ? 0.62 : 0.44) + 0.16 * mid - 0.1 * fine - sEdge * 0.22 + sGroove * 0.25 + uRough;
              if (part == 0) sAlb *= 0.55;
              `}
          }`)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + (kind === "iron" ? "diffuseColor.rgb *= 0.85 + 0.3 * sH;" : "diffuseColor.rgb = sAlb;") + "\ndiffuseColor.a *= uA;")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + (kind === "iron" ? "roughnessFactor = clamp(roughnessFactor + (sH - 0.2) * 0.25, 0.3, 1.0);" : "roughnessFactor = clamp(sRough, 0.3, 1.0);"))
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpN(-vViewPosition, normal, sH * " + (kind === "wrap" ? "0.004" : kind === "iron" ? "0.0012" : "0.005") + " * uWs * uHam * (1.0 - 0.7 * uSmall));")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          float flick = 0.72 + 0.28 * sin(uTime * 2.6 + vObj.x * 23.0) * sin(uTime * 1.7 + vObj.y * 17.0);
          totalEmissiveRadiance += uGlow * (sVein * 1.6 * uVeinK * mix(1.0, flick, uFlick) + sGroove * (0.03 * uGrooveK + 0.3 * uRune) + sEtch * (1.0 + 0.3 * flick) * uEtchK);
          totalEmissiveRadiance += (uHot * 0.6 + uGlow * 0.9) * wTip * 1.5;`);
      // no sparkle brighter than this: a single pixel of it turns into a square in the glow
      sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.6));\nfloat lumS = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor.rgb *= min(1.0, uCap / max(lumS, 1e-4));   // a design can hold the steel under the glow threshold, so only the violet blooms");
    };
    m.customProgramCacheKey = () => "shield-" + kind;
    if (kind === "wrap") m.defines = Object.assign({}, m.defines, { USE_WRAP: "" });
    return m;
  }
  const G = buildShieldGeometry();
  const steelMat = wheelMaterial({ color: 0xffffff, roughness: 0.45, metalness: 1.0, envMapIntensity: 1.0 * D.env }, "metal");
  const ironMat = wheelMaterial({ color: SC.iron, roughness: 0.34, metalness: 0.95, envMapIntensity: 1.3 * D.env }, "iron");
  const wrapMat = wheelMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.25 }, "wrap");
  const mesh = (g, m, parent, order = 0) => { const o = new THREE.Mesh(g, m); o.renderOrder = order; o.frustumCulled = false; parent.add(o); return o; };
  mesh(G.rim, steelMat, outerG).name = "rim"; mesh(G.plates, steelMat, staticG).name = "plates"; mesh(G.field, steelMat, staticG).name = "field";
  // thirty-six rivets round the rim (they turn with it)
  { const rv = []; for (let i = 0; i < 36; i++) { const s = new THREE.SphereGeometry(0.0085, 14, 8); s.scale(1, 1, 0.6); const p = polar(0.697, (i + 0.5) * SEG / 2); s.translate(p.x, p.y, 0.06); rv.push(tagged(s, 8)); } mesh(mergeGeometries(rv), ironMat, outerG); }
  // the collar: cord wound round a ring between the plates and the field, with three iron clamps (it turns the other way)
  { const t = new THREE.TorusGeometry(0.428, 0.019, 14, 240); t.translate(0, 0, 0.074); t.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(t.attributes.position.count).fill(10), 1)); mesh(t, wrapMat, innerG);
    const cl = []; for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + 0.3, c = new THREE.TorusGeometry(0.0235, 0.005, 8, 28); c.rotateY(Math.PI / 2); c.rotateZ(-a); c.translate(0.428 * Math.sin(a), 0.428 * Math.cos(a), 0.074); cl.push(tagged(c, 8)); } mesh(mergeGeometries(cl), ironMat, innerG); }
  // the orb's setting: a collar and three claws rising from the boss
  { const st = [], collar = new THREE.TorusGeometry(0.082, 0.0075, 12, 72); collar.translate(0, 0, 0.128); st.push(tagged(collar, 8));
    for (let k = 0; k < 3; k++) {
      const a = Math.PI + k * Math.PI * 2 / 3, c = new THREE.CatmullRomCurve3([[0.12, 0.128], [0.104, 0.158], [0.084, 0.185], [0.052, 0.205]].map(([r, z]) => new THREE.Vector3(r * Math.sin(a), r * Math.cos(a), z)));
      const t = new THREE.TubeGeometry(c, 20, 0.0085, 10, false), tp = t.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i <= 20; i++) { const cp = c.getPointAt(i / 20), s = 1 - 0.82 * Math.pow(i / 20, 1.4); for (let j = 0; j <= 10; j++) { const n = i * 11 + j; v.fromBufferAttribute(tp, n).sub(cp).multiplyScalar(s).add(cp); tp.setXYZ(n, v.x, v.y, v.z); } }
      t.computeVertexNormals(); st.push(tagged(t, 8));
    }
    mesh(mergeGeometries(st), ironMat, staticG); }
  // light inlays: each chapter's line down its plate (brighter once read, with pulses running out from the hub), and the seams
  const inlayMat = new THREE.ShaderMaterial({ uniforms: W, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "attribute float aKind, aIdx; varying vec3 vObj; varying float vKind, vIdx; void main(){ vObj = position; vKind = aKind; vIdx = aIdx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: NOISE3 + `uniform float uP, uA, uTime, uHl, uLineBase, uLineLit, uPulse, uSeamK; uniform float uLit[18]; uniform vec3 uGlow, uHot; varying vec3 vObj; varying float vKind, vIdx;
      void main(){ ${REVEAL}
        float r = length(vObj.xy), lit = 0.0; for (int k = 0; k < 18; k++){ if (float(k) == vIdx) lit = uLit[k]; }
        float hl = step(abs(vIdx - uHl), 0.5); vec3 c;
        if (vKind < 0.5) { float t = clamp((r - 0.462) / ${(R_ORB - 0.028 - 0.462).toFixed(4)}, 0.0, 1.0), ph = fract(uTime * 0.3 + vIdx * 0.1387 * 3.0), d = (t - ph) * 10.0;
          float pulse = exp(-d * d) * (0.2 + 0.8 * lit);
          c = uGlow * (0.22 * uLineBase + 1.2 * lit * uLineLit + 0.9 * hl) + uHot * pulse * 1.2 * uPulse; c *= smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.94, t); }
        else { float fl = 0.7 + 0.3 * sin(uTime * 2.1 + vIdx * 1.9) * sin(uTime * 3.3 + vIdx), t = clamp((r - ${R_PL0.toFixed(3)}) / ${(R_PL1 - R_PL0).toFixed(4)}, 0.0, 1.0);
          c = (uGlow * 1.6 + uHot * 0.3) * fl * uSeamK * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.9, t); }
        gl_FragColor = vec4((c + uHot * wTip * 1.1) * uA, 1.0); }` });
  mesh(G.seams, inlayMat, staticG, 3); mesh(G.spokes, inlayMat, staticG, 3);
  // the orbs: dark violet glass with energy turning inside; the boss's big one lights the steel round it
  const orbMat = new THREE.ShaderMaterial({ uniforms: Object.assign({ uSize: { value: 1 }, uOrbGain: { value: D.orbGain } }, W), transparent: true, depthWrite: true,
    vertexShader: `uniform float uLit[18]; uniform float uHl; varying vec3 vN, vV, vO; varying float vL, vSeed, vGain;
      void main(){ vec4 p = vec4(position, 1.0); float l = 1.0, s = 0.0;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; s = float(gl_InstanceID); l = 0.0; for (int k = 0; k < 18; k++){ if (k == gl_InstanceID) l = uLit[k]; } l = max(l, step(abs(s - uHl), 0.5) * 0.7);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vN = normalize(normalMatrix * normal);
        #endif
        vec4 mv = modelViewMatrix * p; vV = -mv.xyz; vO = normalize(position); vL = l; vSeed = s; gl_Position = projectionMatrix * mv;
        #ifdef USE_INSTANCING
          vGain = 0.5;
        #else
          vGain = 1.0;
        #endif
      }`,
    fragmentShader: NOISE3 + `uniform float uP, uA, uTime, uOrbGain; uniform vec3 uGlow, uHot, uKey; varying vec3 vN, vV, vO; varying float vL, vSeed, vGain;
      void main(){ vec3 N = normalize(vN), V = normalize(vV); float nv = max(dot(N, V), 0.0), fres = pow(1.0 - nv, 3.0);
        vec3 q = vO * 1.9 - V * 0.9 * (1.0 - nv) + vSeed * 3.7;
        float sw = fb3(q * 1.3 + vec3(0.0, uTime * 0.2, uTime * 0.08), 3), sw2 = fb3(q * 2.6 - vec3(uTime * 0.13, 0.0, uTime * 0.05), 3);
        float f1 = 1.0 - smoothstep(0.0, 0.035 + fwidth(sw) * 1.2, abs(sw - 0.5)), f2 = 1.0 - smoothstep(0.0, 0.03 + fwidth(sw2) * 1.2, abs(sw2 - 0.5));
        float cloud = smoothstep(0.35, 0.85, fb3(q * 0.8 + uTime * 0.05, 2)), core = pow(nv, 5.0), e = mix(0.12, 1.0, vL);
        vec3 c = mix(vec3(0.01, 0.005, 0.018), uGlow * 0.2, cloud * (0.35 + 0.65 * e)) * (0.4 + 0.6 * nv);
        c += ((uGlow * f1 * 0.85 + uGlow * f2 * 0.55) * e + uHot * f1 * f2 * 0.8 * e + uGlow * core * 0.18 * e) * uOrbGain + uGlow * fres * (0.25 + 0.35 * e);
        vec3 H = normalize(uKey + V); c += vec3(1.0, 0.97, 1.0) * (pow(max(dot(N, H), 0.0), 140.0) * 2.4 + pow(max(dot(N, H), 0.0), 18.0) * 0.08);
        float show = smoothstep(0.86, 1.0, uP);
        c = vGain < 0.99 ? min(c * vGain, vec3(0.85)) : c;   // the small orbs stay below the glow threshold: their halos do the glowing
        gl_FragColor = vec4(c, uA * show); }` });
  const hubOrb = new THREE.Mesh(new THREE.SphereGeometry(0.074, 64, 40), orbMat); hubOrb.position.z = 0.142; hubOrb.renderOrder = 2; staticG.add(hubOrb);
  const chOrbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0175 * D.orb, 24, 14), orbMat, 18); chOrbs.renderOrder = 2; chOrbs.frustumCulled = false;
  { const m4 = new THREE.Matrix4(); for (let i = 0; i < 18; i++) { const p = polar(R_ORB, i * SEG); m4.makeTranslation(p.x, p.y, plateZ(R_ORB) + 0.011); chOrbs.setMatrixAt(i, m4); } } staticG.add(chOrbs);
  const orbLight = new THREE.PointLight(PAL.akash.glow, 1, 1, 2); orbLight.position.set(0, 0, 0.26); staticG.add(orbLight);
  // the old wheel, behind the shield as light: its petals and rings glow round the rim, brightest at the steel's edge and
  // fading outwards, with light spilling from behind the rim. It turns with the rim (or, in the progress design, stays put).
  // Every strength below is the design's: how sharp or hazy the lines are, how far the light reaches, whether a wedge is
  // dimmer for a chapter unread, whether the light gathers above the shield, whether beams run between the petals
  const HALO_FRAG = NOISE + `uniform sampler2D uMap, uFatMap, uSoftMap; uniform vec3 uGlow, uHot;
    uniform float uA, uP, uTime, uStr, uHS, uSA, uLine, uSharp, uSoft, uVigIn, uVigOut, uSpill, uSpillFall, uRays, uBreathe, uProg, uDim, uLitK, uSpillDim, uNext, uReach, uCrown, uBeam, uBeamTop, uFat, uSmall, uRel;
    uniform float uLit[18]; varying vec2 vUv;
    void main(){ vec2 q = (vUv * 2.0 - 1.0) * (380.0 / 360.0), p = q * uHS * uSA;   // q: the drawing's own units (it scales with its plane); p: the shield's
      float rt = length(q), r = length(p), ang = atan(p.x, p.y), a01 = fract(ang / 6.28318 + 1.0);
      float shown = 1.0, tip = 0.0;
      if (uP < 0.999){ float pp = uP * 1.08; shown = 1.0 - smoothstep(pp - 0.02, pp, a01 + 0.02 * vnoise(p * 30.0)); tip = exp(-abs(a01 - pp) * 60.0); }
      float line = texture2D(uMap, vUv).a * uSharp + texture2D(uSoftMap, vUv).a * uSoft;
      line = mix(line, texture2D(uFatMap, vUv).a * max(uSharp, 0.5), uSmall * uFat);
      // the chapter's wedge: petal i stands at i * 20 degrees, clockwise from the top, like the plate under it
      float f = a01 * 18.0, i0 = floor(f), t = f - i0, l0 = 0.0, l1 = 0.0;
      for (int k = 0; k < 18; k++){ float fk = float(k); if (abs(fk - i0) < 0.5) l0 = uLit[k]; if (abs(fk - mod(i0 + 1.0, 18.0)) < 0.5) l1 = uLit[k]; }
      float lit = mix(l0, l1, t * t * (3.0 - 2.0 * t));
      float dn = abs(f - uReach); dn = min(dn, 18.0 - dn); float nx = (1.0 - smoothstep(0.0, 1.0, dn)) * step(uReach, 17.5) * step(uReach + 0.5, uRel);   // the next chapter, if it is out
      float sealed = smoothstep(uRel - 0.6, uRel - 0.1, f) * (1.0 - smoothstep(17.5, 18.0, f)) * step(uRel, 17.5);   // chapters not yet released
      float wedge = mix(1.0, mix(uDim * (1.0 - 0.55 * sealed), uLitK, lit), uProg) + uProg * uNext * nx * (0.55 + 0.45 * sin(uTime * 1.6));
      float crown = mix(1.0, smoothstep(-0.95, 0.15, p.y / max(r, 1e-4)), uCrown);
      float vig = smoothstep(uVigOut, uVigIn, rt), breathe = 1.0 - uBreathe + uBreathe * sin(uTime * 0.9 - r * 6.0);
      vec3 c = (uGlow * 1.5 + uHot * 0.22) * line * uLine * vig * breathe * wedge * crown;
      float spill = smoothstep(0.62, 0.73, r) * exp(-max(0.0, r - 0.73) * uSpillFall) * smoothstep(1.05 * uHS, 0.88 * uHS, r), rays = 1.0 - uRays + uRays * vnoise(vec2(ang * 9.0, uTime * 0.15));
      float spillW = mix(1.0, mix(uSpillDim, 1.0, lit) + uNext * nx * 0.5, uProg);
      c += uGlow * spill * rays * uSpill * spillW * crown;
      float bm = pow(max(0.0, -cos(6.28318 * f)), 20.0) * smoothstep(0.76, 0.84, r) * exp(-(r - 0.76) * 2.6) * (0.65 + 0.35 * sin(uTime * 0.7 + i0 * 1.7)) * smoothstep(1.2 * uHS, 0.9 * uHS, r);
      c += (uGlow * 0.9 + uHot * 0.25) * bm * uBeam * mix(1.0, smoothstep(-0.95, 0.15, p.y / max(r, 1e-4)), uBeamTop) * crown;
      gl_FragColor = vec4(c * (shown + tip * 1.5) * uA * uStr, 1.0); }`;
  const halos = [];
  function makeHalo(drawFn, fatFn, parent, z, over) {
    const tex = lineTex(drawFn), fat = fatFn ? lineTex(fatFn) : tex, soft = D.soft > 0 && !over ? softTex(draw.outerFat, D.blur) : tex;
    const u = Object.assign({ uMap: { value: tex }, uFatMap: { value: fat }, uSoftMap: { value: soft }, uGlow: { value: col.glow }, uHot: { value: col.hot }, uA: { value: 0 }, uP: { value: 0 }, uTime: { value: 0 }, uStr: { value: 1 },
      uHS: { value: D.hs }, uSA: { value: 1 }, uLine: { value: D.line }, uSharp: { value: D.sharp }, uSoft: { value: D.soft }, uVigIn: { value: D.vigIn }, uVigOut: { value: D.vigOut },
      uSpill: { value: D.spill }, uSpillFall: { value: D.spillFall }, uRays: { value: D.rays }, uBreathe: { value: D.breathe },
      uProg: { value: D.prog }, uDim: { value: D.dim }, uLitK: { value: D.litK }, uSpillDim: { value: D.spillDim }, uNext: { value: D.next }, uReach: { value: 0 }, uLit: { value: litArr },
      uRel: { value: (window.DV_CONTENT && window.DV_CONTENT.released) || 18 }, uCrown: { value: D.crown }, uBeam: { value: D.beam }, uBeamTop: { value: D.beamTop }, uFat: { value: D.fat }, uSmall: { value: 0 } }, over || {});
    const sa = u.uSA.value, m = new THREE.Mesh(new THREE.PlaneGeometry(2 * 380 / 360 * D.hs * sa, 2 * 380 / 360 * D.hs * sa), new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: QUAD_VERT, fragmentShader: HALO_FRAG }));
    m.position.z = z; m.renderOrder = 1; m.frustumCulled = false; parent.add(m); halos.push({ m, u }); return m;
  }
  const halo = makeHalo(D.halo === "ornate" ? draw.ornateA : draw.outer, D.fat ? draw.outerFat : null, haloParent, -0.1, { uSA: { value: RING.truthS } });
  if (D.halo === "ornate") makeHalo(draw.ornateB, null, innerG, -0.105, { uSA: { value: RING.chapS }, uSpill: { value: 0 }, uBeam: { value: 0 }, uLine: { value: D.line * 0.85 }, uVigOut: { value: D.vigOut + 0.04 } });   // a second ring, turning the other way
  function haloFrame(a, p, t, small) { for (const h of halos) { const u = h.u; u.uA.value = a; u.uP.value = p; u.uTime.value = t; u.uSmall.value = small; u.uReach.value = reached; } }
  // prototype switch: the old wheel as light behind the shield, behind it and cut into the steel, or only cut into the steel
  const GLOW = { vignette: [1, 0], both: [1, 1], etched: [0, 1] };
  function setGlow(mode) {
    const g = GLOW[mode] || GLOW.vignette; halos.forEach((h) => { h.u.uStr.value = g[0]; h.m.visible = g[0] > 0; }); W.uEtch.value = g[1];
    document.querySelectorAll("[data-glow]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.glow === mode)));
  }
  setGlow((/[?&]glow=(vignette|both|etched)/.exec(location.search) || [])[1] || D.glow);

  // the sealed truths (two petals) and the halos of the lit chapters stay as light drawn in the page's plane
  const layerMat = (tex, color) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: tex }, uColor: { value: color }, uP: { value: 0 }, uA: { value: 0 } }, vertexShader: QUAD_VERT,
    fragmentShader: NOISE + `uniform sampler2D uMap; uniform vec3 uColor; uniform float uP, uA; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0;
        vec4 t = texture2D(uMap, vUv); if (t.a < 0.004) discard;
        float shown = 1.0, tip = 0.0;
        if (uP < 0.999){ float r = length(p); float ang = (r > 1e-4 ? atan(p.x, p.y) : 0.0) / 6.28318 + 0.5; float pp = uP * 1.08;
          shown = 1.0 - smoothstep(pp - 0.02, pp, fract(ang + 0.5) + 0.02 * vnoise(p * 30.0)); tip = exp(-abs(fract(ang + 0.5) - pp) * 60.0); }
        gl_FragColor = vec4(uColor * t.a * (shown + tip * 2.0) * uA, 1.0); }` });
  function layer(drawFn, size, span, color, z, parent) {
    const { c, x } = canvasFor(size, span); drawFn(x);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * span / 360, 2 * span / 360), layerMat(tex, color)); m.position.z = z; m.renderOrder = 4; parent.add(m);
    m.userData.redraw = (fn) => { x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, size, size); x.restore(); fn(x); tex.needsUpdate = true; };
    return m;
  }
  let reached = 0;
  const L = { truths: layer((x) => draw.truths(x, reached), big, 380, col.lit, -0.095, haloParent) };   // behind the steel, among the glowing petals
  L.truths.scale.setScalar(D.hs * RING.truthS);
  const pg = new THREE.BufferGeometry(); const pp = new Float32Array(18 * 3), pi = new Float32Array(18);
  for (let i = 0; i < 18; i++) { const a = i * Math.PI / 9; pp[i * 3] = Math.sin(a) * R_ORB; pp[i * 3 + 1] = Math.cos(a) * R_ORB; pp[i * 3 + 2] = plateZ(R_ORB) + 0.03; pi[i] = i; }
  pg.setAttribute("position", new THREE.BufferAttribute(pp, 3)); pg.setAttribute("aI", new THREE.BufferAttribute(pi, 1));
  const ptU = { uLit: { value: litArr }, uPR: { value: 1 }, uScale: { value: 1 }, uColor: { value: col.lit }, uDim: { value: col.line }, uA: { value: 0 }, uHover: { value: -1 }, uBase: { value: 0 } };
  const points = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: ptU, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aI; uniform float uLit[18]; uniform float uPR, uScale, uHover; varying float vL; varying float vH;
      void main(){ float l = 0.0; for (int i = 0; i < 18; i++){ if (float(i) == aI) l = uLit[i]; } vL = l; vH = step(abs(aI - uHover), 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (10.0 + 30.0 * l + 12.0 * vH) * uPR * uScale; }`,
    fragmentShader: `uniform vec3 uColor, uDim; uniform float uA, uBase; varying float vL; varying float vH;
      void main(){ float d = length(gl_PointCoord - 0.5); float halo = exp(-d * 8.0) * (1.0 - smoothstep(0.3, 0.5, d));
        gl_FragColor = vec4(uColor * halo * (0.55 * vL + 0.6 * vH + uBase * (1.0 - vL)) * uA, 1.0); }` }));
  points.frustumCulled = false; points.renderOrder = 5; tiltG.add(points);

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
  const eclipse = new THREE.Mesh(new THREE.CircleGeometry(0.4, 96), new THREE.MeshBasicMaterial({ color: col.ink, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  eclipse.position.z = 0.3; eclipse.renderOrder = 10; wheel.add(eclipse);

  // ---------- post: multisampled scene (the steel's edges are real geometry), bloom only above 1, then a film finish ----------
  const msTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: LVS[LV].msaa });
  const composer = new EffectComposer(renderer, msTarget);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.8, 0.55, 1.0);
  const setB = bloom.setSize.bind(bloom); bloom.setSize = (a, b) => setB(a * LVS[LV].bloom, b * LVS[LV].bloom);
  composer.addPass(bloom); if (/[?&]nobloom=1/.test(location.search)) bloom.enabled = false;
  const finU = { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVignette: { value: 0.5 }, uCA: { value: 0.007 } };
  const finPass = new ShaderPass({ uniforms: finU, vertexShader: QUAD_VERT,
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
        gl_FragColor = vec4(col, 1.0); }` });
  composer.addPass(finPass);

  // ---------- where the wheel goes. x, y are shares of the viewport; r is the radius as a share of its height;
  //            px: a function of (w, h) giving pixels, for the reading dock ----------
  const SCENES = {
    intro: { x: 0.5, y: 0.47, r: 0.3, w: [0.0, 1, 0, 0], neb: 0.7, tear: 0.0, parts: 0.7, rings: 1, pts: 1 },
    home: { anchor: true, w: [0.35, 0.65, 0, 0], neb: 0.75, tear: 0.0, parts: 0.15, rings: 1, pts: 1 },
    "home:index": { x: 0.5, y: 0.5, r: 0.6, w: [0.55, 0.45, 0, 0], neb: 0.8, tear: 0.0, parts: 0.12, rings: 0.16, pts: 0.55 },
    "home:four": { x: 0.88, y: 0.2, r: 0.16, w: [0.85, 0.15, 0, 0], neb: 0.75, tear: 0.0, parts: 0.2, rings: 0.6, pts: 1 },
    contents: { x: 0.9, y: 0.5, r: 0.46, w: [0.5, 0.5, 0, 0], neb: 0.8, tear: 0.0, parts: 0.14, rings: 0.4, pts: 1 },
    reader: { px: (w, h) => [w - (w < 700 ? 40 : 64), h - (w < 700 ? 40 : 64), (w < 700 ? D.dock[1] : D.dock[0]) / D.fit], w: [1, 0, 0, 0], neb: 0.3, tear: 0.0, parts: 0.0, rings: 0.9, pts: 1 },
    codex: { x: 0.82, y: 0.3, r: 0.22, w: [0.6, 0, 0, 0.4], neb: 0.7, tear: 0.0, parts: 0.22, rings: 0.75, pts: 1 },
    story: { x: 0.9, y: 0.5, r: 0.4, w: [0.6, 0.4, 0, 0], neb: 0.8, tear: 0.0, parts: 0.14, rings: 0.35, pts: 1 },
    tears: { x: 0.74, y: 0.45, r: 0.46, w: [0.4, 0, 0.6, 0], neb: 0.6, tear: 1.0, parts: 0.16, rings: 0.0, pts: 0 },
    powers: { x: 0.68, y: 0.42, r: 0.36, w: [0.15, 0, 0, 0.85], neb: 0.8, tear: 0.0, parts: 0.45, rings: 0.0, pts: 0 },
    about: { x: 0.85, y: 0.5, r: 0.36, w: [1, 0, 0, 0], neb: 0.5, tear: 0.0, parts: 0.14, rings: 0.4, pts: 1 },
    menu: { x: 0.84, y: 0.5, r: 0.42, w: [0.4, 0.6, 0, 0], neb: 0.6, tear: 0.0, parts: 0.25, rings: 0.55, pts: 1 },
  };
  const UNDOCKED = new Set(["intro", "home", "reader", "tears", "powers", "menu"]);   // on phones every other page docks the wheel in the corner
  const S = { neb: 0, tear: 0, parts: 0, rings: 0, pts: 0, cx: window.innerWidth / 2, cy: window.innerHeight * 0.47, r: window.innerHeight * 0.3, draw: 0, boost: 0, lean: 0 };
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
    if (rr < 0.42 || rr > 1.04 * D.hs * RING.truthS || S.r < 60) return null;
    let a = Math.atan2(dx, -dy); a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let ap = a - (D.turns ? outerAngle : 0); ap = ((ap % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return { ch: Math.round(a / (Math.PI / 9)) % 18, petal: Math.round(ap / (Math.PI / 9)) % 18, outer: rr > 0.94 };   // the truths' petals start beyond the chapters' ring
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
  // the canvas is drawn for its own CSS size. On phones that is 100lvh, taller than innerHeight while the browser's bars show;
  // drawing for innerHeight and stretching it squashed the wheel. The bars showing and hiding fire resize without changing it
  let nebDirty = true, rtScale = 0.5, canW = window.innerWidth, canH = window.innerHeight, sized = "";
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = Math.min(canvas.clientHeight || window.innerHeight, (window.screen && window.screen.height ? window.screen.height * 1.5 : 1e5));
    const d = dpr(), key = w + "x" + h + "@" + d + "/" + LV; canW = w; canH = h;
    if (key === sized) return; sized = key;
    renderer.setPixelRatio(d); renderer.setSize(w, h, false); composer.setPixelRatio(d); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    rtScale = d / (coarse ? 3 : 2);
    rt.setSize(Math.max(2, Math.round(w * rtScale)), Math.max(2, Math.round(h * rtScale))); nebU.uRes.value.set(rt.width, rt.height);
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
    // w, h: the visible window, where the wheel is placed; canH: the canvas, which the scene is drawn for
    const w = canW, h = window.innerHeight || canH, s = SCENES[state] || SCENES.about, ar = s.anchor ? anchorRect() : null;
    let tx, ty, tr;
    if (ar) { tx = ar.left + ar.width / 2; ty = ar.top + ar.height / 2; tr = ar.width / 2; }
    else if (s.px) { [tx, ty, tr] = s.px(w, h); }
    else if (w < 700 && !UNDOCKED.has(state)) { const vis = Math.min(w * 0.17, 76); tr = vis / (1.38 * D.fit); tx = w - vis - 14; ty = h - vis - 22; }   // phones: small, in the corner, out of the way (sized by the light round it, which reaches 1.38 of the shield)
    else { tx = s.x * w; ty = s.y * h; tr = s.r * h; if (w < 900 && (state === "contents" || state === "home:index" || state === "story" || state === "about")) { tx = w * 1.02; tr = Math.min(tr, w * 0.55); }
      if (w < 900 && state === "codex") { tx = w * 0.96; ty = h * 0.13; tr = Math.min(tr, w * 0.4); }
      if (w < 900 && state === "tears") tx = w * 0.93; }
    const k = follow >= 1 ? 1 : Math.min(1, dt * (2 + 6 * follow));
    S.cx += (tx - S.cx) * k; S.cy += (ty - S.cy) * k; S.r += (tr * D.fit - S.r) * k;
    const u = viewH(0) / canH, ws = Math.max(0.0001, S.r * u);
    tilt.x += (tiltT.x - tilt.x) * Math.min(1, dt * 2); tilt.y += (tiltT.y - tilt.y) * Math.min(1, dt * 2);
    wheel.position.set((S.cx - w / 2) * u, -(S.cy - canH / 2) * u, 0); wheel.scale.setScalar(ws);
    // it leans towards the pointer and sways a little on its own, so the shield's depth always reads; on the intro it rises
    // from lying back to face the reader
    const docked = still || page === "reader", sway = docked ? 0 : 1;
    wheel.rotation.x = docked ? 0 : -tilt.y * 0.12; wheel.rotation.y = docked ? 0 : tilt.x * 0.14;
    tiltG.rotation.x = sway * (-tilt.y * 0.22 + 0.05 * Math.sin(T * 0.23)) - S.lean * 1.05;
    tiltG.rotation.y = sway * (tilt.x * 0.3 + 0.07 * Math.sin(T * 0.17 + 1.3));
    tiltG.rotation.z = S.lean * 0.6;
    tear.position.set(wheel.position.x, wheel.position.y, -0.6); tear.scale.set(Math.max(1.2, wheel.scale.x * 1.2), viewH(-0.6) * 1.05, 1);
    if (!still) { outerAngle += SPIN * D.spin * dt; innerAngle += SPIN_IN * D.spin * dt; }
    outerG.rotation.z = -outerAngle; innerG.rotation.z = innerAngle;
    const ringsA = S.rings, drawP = S.draw;
    tiltG.visible = ringsA > 0.004;
    W.uP.value = drawP; W.uA.value = ringsA; W.uTime.value = T; W.uWs.value = ws; W.uRune.value = 0.25 * flash + Math.max(0, S.boost) * 0.8;
    const hl = hoverWheel >= 0 && hoverWheel < 100 ? hoverWheel : hoverCh >= 0 ? hoverCh : S.boost > 0.02 ? boostI : -1; W.uHl.value = hl;
    W.uSmall.value = D.fat ? sstep(150, 52, S.r) : 0; haloFrame(ringsA, drawP, T, Math.max(W.uSmall.value, D.fatMin)); ptU.uBase.value = 0.9 * D.dots * W.uSmall.value;
    rimL.color.copy(col.glow).lerp(WHITE, 0.4); orbLight.color.copy(col.glow); orbLight.distance = ws * 0.9; orbLight.intensity = ws * ws * (0.09 + 0.02 * Math.sin(T * 1.7)) * ringsA * Math.min(1, Math.max(0, drawP * 4 - 3));
    flash *= 0.9; L.truths.material.uniforms.uP.value = drawP; L.truths.material.uniforms.uA.value = ringsA * (0.75 + 1.4 * flash); L.truths.material.uniforms.uColor.value = col.lit;
    S.boost *= Math.pow(0.35, dt);
    ptU.uA.value = S.pts * Math.min(1, Math.max(0, drawP * 1.4 - 0.4)); ptU.uScale.value = Math.max(D.ptMin, S.r / 260); ptU.uHover.value = hl;
    partU.uTime.value = T; partU.uAlpha.value = S.parts; partU.uSize.value = 24 * Math.max(0.6, Math.min(1.6, S.r / 300));
    tearU.uOpen.value = S.tear; tearU.uTime.value = T;
    nebU.uTime.value = T; nebU.uIntensity.value = S.neb; nebU.uGlow.value.set(S.cx / w, 1 - S.cy / canH, ringsA);
    nebU.uWheel.value.set(S.cx * rtScale, (canH - S.cy) * rtScale, S.r * rtScale, ringsA * Math.min(1, drawP * 1.5) * D.smoke);
    finU.uTime.value = still ? 0 : Math.floor(T * 24) / 24;
    { const dk = D.dockFix ? sstep(170, 70, S.r) : 0; finPass.uniforms.uCA.value = 0.007 * (1 - dk * (1 - D.dockCA)); finPass.uniforms.uVignette.value = 0.5 * (1 - dk * (1 - D.dockVig)); }
    if (nebDirty || calm || still || frameNo % LVS[LV].neb === 0) { renderer.setRenderTarget(rt); renderer.render(bgScene, bgCam); renderer.setRenderTarget(null); nebDirty = false; }   // the smoke changes slowly
    composer.render();
  }

  // ---------- what the pages ask for ----------
  const API = {
    intro(returning) {   // dust gathers into the wheel; the shield forms along a burning edge while it rises to face the reader
      const cur0 = window.DVRoute && window.DVRoute.current(); page = cur0 ? cur0.name : "home"; goState("intro", true); S.draw = 0; S.neb = 0; partU.uW.value.set(1, 0, 0, 0); S.parts = 0.7;
      S.lean = reduced() ? 0 : 1;
      tw(S, { neb: 0.7 }, returning ? 0.8 : 2.2, "power2.out");
      tw(partU.uW.value, { x: 0.0, y: 1 }, returning ? 1.0 : 2.8, "power2.inOut", returning ? 0 : 0.5);
      tw(S, { draw: 1 }, returning ? 1.0 : 2.8, "power2.inOut", returning ? 0.2 : 1.0);
      tw(S, { lean: 0 }, returning ? 1.4 : 3.6, "power3.inOut", returning ? 0 : 0.6);
    },
    open() { tw(S, { draw: 1 }, 0.4); tw(S, { lean: 0 }, 0.6); goState(pageState()); },
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
    _glow(m) { setGlow(m); },   // inspection: switch how the old wheel is lit
    _scene(def) { SCENES._dbg = Object.assign({ x: 0.5, y: 0.5, r: 0.4, w: [0.5, 0.5, 0, 0], neb: 0.75, tear: 0, parts: 0.12, rings: 1, pts: 1 }, def); page = "_dbg"; goState("_dbg", true); },   // inspection: pose the wheel anywhere
    _objs() { return { bloom, composer, renderer, parts, rt, scene, bgScene, nebU, partU, W, S, tiltG, setLevel }; },
  };
  syncProgress(false);
  window.DVGL = API;
  { const q = /[?&]pose=([\d.]+),([\d.]+),([\d.]+)/.exec(location.search); if (q) setTimeout(() => API._scene({ x: +q[1], y: +q[2], r: +q[3] }), 400); }
  { const h = (/[?&]hide=([a-z,]+)/.exec(location.search) || [])[1]; if (h) { const set = new Set(h.split(",")), byMat = { steel: steelMat, iron: ironMat, wrap: wrapMat, inlay: inlayMat, orb: orbMat }; scene.traverse((o) => { for (const k in byMat) if (set.has(k) && o.material === byMat[k]) o.visible = false; if (o.name && set.has(o.name)) o.visible = false; }); if (set.has("halo")) halos.forEach((h) => { h.m.visible = false; }); if (set.has("parts")) parts.visible = false; if (set.has("points")) points.visible = false; if (set.has("truths")) L.truths.visible = false; } }
  let period = 1000 / 60, recent = [], late = 0, count = 0, secT = 0, bad = 0, good = 0, warmT = 0, rest = 0;
  const lost = [0, 0, 0, 0];   // how often each level was lost; climbing back to it waits longer each time
  const applyLevel = () => { const L0 = LVS[LV]; nebU.uOct.value = L0.oct; W.uDet.value = L0.det; geo.setDrawRange(0, Math.floor(N * L0.parts)); PERF.lv = LV;
    if (msTarget.samples !== L0.msaa) { composer.renderTarget1.samples = composer.renderTarget2.samples = L0.msaa; composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); } };
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
        if (warmT > 5000 && !HW) {
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
