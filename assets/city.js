/* Dwarka at night, and since 30 October by the reader's clock (day, dusk and night: the sun block and updateSun below): the city view of the Tears atlas (proposal, 28 October 2026; optimised 29 October).
   An ES module, imported by app.js only when the city opens (import map: three 0.186.1, with postprocessing 6.39.5 for the stronger quality tiers, from jsDelivr, in the shell).
   The city is the site's own: OpenStreetMap footprints, roads, the elevated metro, parks and water (src/city/dwarka.bin.gz, see city_data.js), lit by shaders in city_shaders.js. It needs no Cesium, no Bing and no
   photographic tiles. mount(host, opts) returns the controls the page needs; dispose() undoes everything it made (loop, listeners, controls, geometry, materials, composer, renderer and its context, DOM).
   Everything that is particular to one city (its home view, the glow's direction, its fog, its camera limits, its labels' positions) is the config the build hands in as data.config (src/city/<id>.json):
   DEFAULT_CONFIG below is Dwarka's and the fallback, so another city is another config and another city file, not a change here (29 October: the page opens any of seven this way).
   Rendering is on demand: a frame is drawn only while the camera moves, a flight or replay runs, a pointer is down, or for a few seconds of ambient life (a train on the viaduct, flickering windows,
   traffic) after anything wakes it; then the loop stops. Reduced motion jumps instead of flying and has no ambient or trail animation.
   Loading (29 October): the first frame is drawn with the plain renderer as soon as the city is built; the post stack (bloom, tone mapping, antialiasing: postprocessing) is fetched after that first paint and
   fades in. (Until 30 October the strongest tier also fetched n8ao, an ambient occlusion pass, once the camera came close; the building shader does that work now.) */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fetchGz, fetchRaw, prepareSteps, heightAt, unpackLines, decodePath, streetIndex, useShapeUtils, noiseData, treeSteps, TREE_TILE } from "./city_data.js?v=fe33627d7b";
import * as S from "./city_shaders.js?v=fe33627d7b";

useShapeUtils(THREE.ShapeUtils);

/* The sun (30 October, the city by the clock): the same block as atlas.js's, byte for byte (a test compares them), because a city can open without the globe and cannot import atlas.js. */
// --- sun (keep identical to the city's copy) ---
/* The sun for the instant the maps are lit by (30 October 2026). sunAt(date, latDeg, lonDeg) is NOAA's simplified solar position (after Meeus: the sun's apparent longitude, the obliquity with the
   nutation's main term, Greenwich mean sidereal time), good to about 0.01 degree in declination and 0.1 degree in elevation for years 1800 to 2200, and finite for any date. It returns
     elevation   degrees above the horizon at (latDeg, lonDeg), geometric (no refraction: sunrise as almanacs give it is elevation -0.833)
     azimuth     degrees clockwise from north
     dirEcef     [x, y, z], the unit vector from the earth's centre to the sun in ECEF (WGS84 earth-fixed: +x to 0 N 0 E, +y to 0 N 90 E, +z to the north pole), as 3d-tiles-renderer's
                 Ellipsoid uses it; the globe's three.js world is that frame turned -90 degrees about x (world = x, z, -y; the world's y is north). It does not depend on latDeg and lonDeg.
     day         0 to 1: 0 with the sun 6 degrees or more below the horizon (civil twilight's end), 1 at 6 degrees above, a smoothstep between
     subLat, subLon   the subsolar point, degrees
   atlasNow() is the Date to light the maps by: the reader's own clock (the true instant, so every place is lit for its own local time, Dwarka for IST), or ?time=<ISO with an offset> (a '+' that the
   address turned into a space is read back) and ?timescale=N (the clock runs N times faster from that start, or from now: a demo). The moving clock is anchored once per page on globalThis, so the
   globe's copy and the city's copy tell the same time. sunNight() is true for ?sun=night: the old all-night look. */
const SUN_RAD = Math.PI / 180;
export function sunAt(date, latDeg = 0, lonDeg = 0) {
  let ms = date instanceof Date ? date.getTime() : +date;
  if (!Number.isFinite(ms)) ms = Date.now();
  let n = ms / 86400000 + 2440587.5 - 2451545;                                                      // days from J2000.0
  if (Math.abs(n) > 73048) n -= 146097 * Math.round(n / 146097);    // a clock centuries off: whole 400-year Gregorian cycles back towards 2000 keep the hour and the season
  const T = n / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032), M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * SUN_RAD;
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
  const om = (125.04 - 1934.136 * T) * SUN_RAD, lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * SUN_RAD;          // the apparent longitude
  const eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om)) * SUN_RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = ((280.46061837 + 360.98564736629 * n + T * T * (0.000387933 - T / 38710000)) % 360) * SUN_RAD;
  const sl = ra - gmst, la = (+latDeg || 0) * SUN_RAD, H = (+lonDeg || 0) * SUN_RAD - sl;           // the subsolar longitude, the hour angle here
  const sinEl = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / SUN_RAD;
  let az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(H)) / SUN_RAD;
  if (az < 0) az += 360;
  const k = Math.min(1, Math.max(0, (el + 6) / 12)), lon = ((((sl / SUN_RAD) % 360) + 540) % 360) - 180;
  return { elevation: el, azimuth: az, dirEcef: [Math.cos(dec) * Math.cos(sl), Math.cos(dec) * Math.sin(sl), Math.sin(dec)], day: k * k * (3 - 2 * k), subLat: dec / SUN_RAD, subLon: lon };
}
function sunQuery() { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(""); } }
export function sunNight() { return sunQuery().get("sun") === "night"; }
export function atlasNow() {
  const q = sunQuery(), s = (q.get("time") || "").trim().replace(/ (\d\d(:?\d\d)?)$/, "+$1"), k = +(q.get("timescale") || 1);
  const t = s ? Date.parse(s) : NaN, rate = Number.isFinite(k) && k > 0 ? Math.min(k, 1e6) : 1;
  if (!Number.isFinite(t) && rate === 1) return new Date();
  const g = globalThis, key = (Number.isFinite(t) ? t : "now") + "|" + rate;
  if (!g.__dvSunClock || g.__dvSunClock.key !== key) g.__dvSunClock = { key, at: performance.now(), from: Number.isFinite(t) ? t : Date.now() };
  const c = g.__dvSunClock, d = new Date(c.from + (performance.now() - c.at) * rate);
  return Number.isFinite(d.getTime()) ? d : new Date();
}
export function atlasClockRate() { const k = +(sunQuery().get("timescale") || 1); return Number.isFinite(k) && k > 0 ? Math.min(k, 1e6) : 1; }
// --- end of sun ---
/* The city's day (30 October, polished). Linear colour, before the tone mapping (ACES: 0.18 shows as 127, 0.5 as 197, 1.2 as 232).
   keys: the light by the sun's height, in degrees, interpolated: sun, the direct sun's colour and strength; sky, the sky's light on an upward face; haze, the horizon's colour (the fog's); glow, added on the sun's side of the
   horizon; mid, the sky's band above the horizon; zen, the zenith; anti, the band opposite a low sun. Under -4 degrees they blend into the night's own values, which they reach at -6 (uMix).
   fog, fogBase: the fog's two densities by day against the night's. look: a city's own colours (sRGB, as its config's `day` key gives them; this default is Delhi's, the config's keys replace it key by key). */
export const CITY_DAY = Object.freeze({
  keys: [
    { el: -4, sun: [0, 0, 0], sky: [0.085, 0.095, 0.17], haze: [0.095, 0.10, 0.17], glow: [0.20, 0.09, 0.09], mid: [0.05, 0.065, 0.16], zen: [0.018, 0.038, 0.11], anti: [0.015, 0.02, 0.05] },
    { el: -2, sun: [0, 0, 0], sky: [0.19, 0.205, 0.33], haze: [0.21, 0.19, 0.30], glow: [0.60, 0.26, 0.14], mid: [0.13, 0.16, 0.36], zen: [0.04, 0.09, 0.26], anti: [0.05, 0.05, 0.11] },
    { el: -0.8, sun: [0, 0, 0], sky: [0.23, 0.21, 0.30], haze: [0.31, 0.22, 0.29], glow: [0.72, 0.28, 0.08], mid: [0.32, 0.24, 0.42], zen: [0.07, 0.13, 0.34], anti: [0.20, 0.12, 0.20] },
    { el: 0.5, sun: [0.95, 0.40, 0.16], sky: [0.25, 0.21, 0.27], haze: [0.40, 0.25, 0.25], glow: [0.80, 0.32, 0.05], mid: [0.46, 0.30, 0.46], zen: [0.09, 0.17, 0.42], anti: [0.30, 0.17, 0.24] },
    { el: 3, sun: [1.45, 0.74, 0.34], sky: [0.23, 0.205, 0.24], haze: [0.56, 0.40, 0.33], glow: [0.80, 0.38, 0.08], mid: [0.60, 0.42, 0.45], zen: [0.10, 0.18, 0.38], anti: [0.30, 0.22, 0.28] },
    { el: 7, sun: [1.6, 0.86, 0.42], sky: [0.26, 0.25, 0.27], haze: [0.78, 0.60, 0.47], glow: [0.85, 0.42, 0.14], mid: [0.52, 0.50, 0.66], zen: [0.12, 0.24, 0.54], anti: [0.16, 0.10, 0.12] },
    { el: 15, sun: [1.32, 1.08, 0.83], sky: [0.28, 0.29, 0.32], haze: [0.80, 0.70, 0.59], glow: [0.30, 0.18, 0.08], mid: [0.44, 0.52, 0.72], zen: [0.12, 0.25, 0.60], anti: [0, 0, 0] },
    { el: 30, sun: [1.18, 1.09, 0.97], sky: [0.29, 0.32, 0.37], haze: [0.80, 0.76, 0.68], glow: [0.12, 0.09, 0.05], mid: [0.32, 0.50, 0.84], zen: [0.12, 0.27, 0.68], anti: [0, 0, 0] },
    { el: 60, sun: [1.15, 1.11, 1.02], sky: [0.29, 0.33, 0.39], haze: [0.78, 0.77, 0.72], glow: [0.10, 0.08, 0.05], mid: [0.30, 0.50, 0.86], zen: [0.12, 0.28, 0.72], anti: [0, 0, 0] },
  ],
  alt: [[-4, 1, 1, 1], [-2.2, 1.12, 0.97, 1.13], [0.96, 0.60, 0.69, 0.90], [4.1, 0.43, 0.52, 0.72], [7.2, 0.37, 0.47, 0.66], [15, 0.37, 0.45, 0.62], [40, 0.395, 0.43, 0.53]],
  dawn: [0.93, 0.97, 1.07], fog: 0.15, fogBase: 0.05, alb: 1.0,
  look: {
    walls: ["#DBCBAC", "#E2DCCD", "#C9A376", "#B46C4A", "#D49F8D", "#D6B574"], roofs: ["#BDB6A8", "#D6D2C6", "#A39A87", "#9A7560"], tower: "#CCC7BC",
    ground: ["#A3927A", "#9A8768", "#A69B8A"], plain: ["#5C6B3E", "#8E8560", "#70604A"], tree: "#55733A",
    park: ["#68853F", "#3A652A"], forest: ["#2A5226", "#35622A"], field: ["#8D9450", "#7E9046"], sand: "#CDBE96", wet: "#4E6645",
    water: ["#1F5660", "#2B7078"], road: ["#5E5C58", "#878272"], ice: ["#F3F6FA", "#B9C8D6"], haze: [1, 0.97, 0.9], zen: [1, 1, 1],
    trees: { spacing: 9, grove: 1, park: 1, forest: 1, street: 0.55, species: [{ shape: "round", w: 6, c: ["#5C7C3A", "#80A04C"], h: [7, 14], wid: 1.08 }, { shape: "round", w: 3, c: ["#4C6E36", "#6C8E42"], h: [10, 18], wid: 0.98 }, { shape: "oval", w: 2, c: ["#587A3A", "#7A9A48"], h: [7, 12], wid: 0.8 }], streetSpecies: [0, 2] },
  },
});

/* ---------- making the city's arrays off the main thread (29 October, the seamless entry) ----------
   prepare(file, pre) starts a worker (city_data.js, run as a module worker by its own address) that unpacks the city file and builds every typed array of the scene, and returns a handle whose promise
   gives them back (handed over, not copied). The page calls it as soon as a reader chooses a city on the globe, so that by the time "Fly down" is pressed the city is mostly made; mount() takes the handle
   (opts.prepared) or starts one itself. Where workers fail (an old browser) the same steps run on the main thread between frames. */
const DATA_URL = new URL("./city_data.js?v=fe33627d7b", import.meta.url).href;      // the build gives this address the modules' version, as it does the import above
function threeCoreURL() {     // a worker has no import map: the address of three's core module the page itself loaded (the triangulator lives there)
  try { const im = JSON.parse(document.querySelector('script[type="importmap"][data-atlas]').textContent).imports || {}; const k = Object.keys(im).find((x) => /\/three\.core\.js$/.test(x)); if (k) return im[k]; } catch (e) {}
  try { return import.meta.resolve("three").replace(/three\.module(\.min)?\.js$/, "three.core.min.js"); } catch (e) {}
  return "";
}
/* a renderer made ahead (29 October): creating a WebGL context makes the main thread wait for the GPU process, about 0.13 s on this laptop while the globe streams tiles; the page asks for one while a
   city's card is open and the globe rests, and mount() takes it, so that wait is not in the middle of the dive. One at most; dropSpare() lets it go. */
let spare = null;
/* a phone has no post stack, so its canvas is multisampled (resolved on chip on a phone's GPU); a computer's antialiasing is the post stack's (30 October) */
const touchFirst = () => { try { return matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820); } catch (e) { return false; } };   // Samsung phones count as a fine pointer (audit city-3)
function newRenderer(canvas) {
  const gp = new URLSearchParams(location.search).get("gpu");   // the default power preference, as the globe uses (a laptop is not woken to its second GPU for a page); ?gpu=low or ?gpu=high only for measuring
  return new THREE.WebGLRenderer({ canvas, antialias: touchFirst(), alpha: false, powerPreference: gp === "low" ? "low-power" : gp === "high" ? "high-performance" : "default", stencil: false, depth: true });
}
export function prewarm() { if (spare) return true; try { const canvas = document.createElement("canvas"); spare = { canvas, renderer: newRenderer(canvas), at: performance.now() }; return true; } catch (e) { spare = null; return false; } }
export function dropSpare() { if (!spare) return; try { spare.renderer.dispose(); spare.renderer.forceContextLoss(); } catch (e) {} spare = null; }

export function prepare(file, pre, o = {}) {
  let worker = null, cancelled = false;
  const t0 = performance.now();
  const promise = (async () => {
    if (typeof Worker !== "function" || typeof DecompressionStream !== "function") throw new Error("no worker");
    const gz = await fetchGz(file, undefined, pre);
    if (cancelled) throw new Error("cancelled");
    worker = new Worker(DATA_URL, { type: "module", name: "city" });
    return await new Promise((res, rej) => {
      worker.onmessage = (e) => { const m = e.data || {}; if (worker) worker.terminate(); worker = null; if (m.ok) { m.P.times.wall = Math.round(performance.now() - t0); res(m.P); } else rej(new Error(m.error || "worker")); };
      worker.onerror = (e) => { if (worker) worker.terminate(); worker = null; rej(new Error("worker failed: " + ((e && e.message) || "load"))); };
      worker.postMessage({ id: 1, gz, core: threeCoreURL(), opts: { hfCell: o.hfCell || 6, densSize: 512 } }, [gz]);
    });
  })();
  promise.catch(() => {});
  return { file, promise, startedAt: t0, cancel() { cancelled = true; if (worker) { worker.terminate(); worker = null; } } };
}

/* the one place a city's own assumptions are: views are { x, n, dist, tilt, heading } in the city's local metres (x east, n north of its origin) */
export const DEFAULT_CONFIG = {
  id: "dwarka", name: "Dwarka",
  home: { x: -150, n: 1150, dist: 3500, tilt: 66, heading: 64 },       // the opening view and "Show the whole city"
  high: { x: 0, n: 900, dist: 38000, tilt: 6, heading: 0 },             // where the descent from the globe starts and the climb back ends
  glowDir: [0.96, 0, -0.27],                                            // the horizon glow: towards the capital's lights (east-north-east of Dwarka), x east, z south
  keep: [-4400, -5000, 5400, 5200],                                     // the box the city file covers, until the file's own meta says so
  sectorDist: [700, 6500],                                              // the camera distances between which the faint sector numbers show
  aoRange: [450, 1300],                                                 // the ambient occlusion fades in as the camera comes closer than the second number and is full at the first
  limits: { min: 60, max: 9500, far: 70000 },                           // the camera's nearest and farthest distance from its target, and the far plane
  fog: { d: 1 / 5200, k: 1 / 520, base: 1 / 11000 },                    // the height fog's density and scale height, and the height-free haze
  hfCell: 6,                                                            // the height field's cell, metres (it hides labels behind taller buildings)
  groundSize: 0,                                                        // 0: a 60 km square round the origin; a number: that square round the middle of the box (a very wide city)
  outside: {},                                                          // what lies beyond the box: { w, s, e, n } each "sea" or "ice" (the ground is dark earth where a side is not named)
  groundBase: "",                                                       // "ice": the ground itself is ice
  labels: [],                                                           // geography labels: { id, kind, x, n } (their words are the page's copy)
  labelDist: [400, 12000],                                              // the camera distances between which they show
  procSame: false,                                                      // true: a generated building is lit like a mapped one (Dwarka's own are a little brighter)
  tear: null,                                                           // { x, n, ringKm } once the tear has opened in the story: a ring on the ground and the crack in the sky (or a column of light)
  crack: null,                                                          // the crack in the sky: its size, height, angles and whether it shows at the replay's moment
};

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const AMBIENT = 7000;          // ms of ambient life after anything wakes the view
const SETTLE = 500;
const MAX_PATHS = 48;
const FOG_CLEAR = 0.85;       // 30 October: the haze a little thinner than each city's config

/* the site's colours, read from its tokens (they change with the palette) */
function readPalette() {
  const cs = getComputedStyle(document.documentElement), get = (n, d) => cs.getPropertyValue(n).trim() || d;
  return { accent: new THREE.Color(get("--accent", "#b9a8ff")), bone: new THREE.Color(get("--bone", "#e9e3d8")), ink: new THREE.Color(get("--ink", "#07060b")), grahan: document.documentElement.getAttribute("data-palette") === "grahan" };
}
const lin = (c) => new THREE.Vector3(c.r, c.g, c.b);   // THREE.Color already holds linear values (ColorManagement)

/* one colour per character, built on the accent: the hue turns round the accent's, lightness and chroma stay in one calm band so all four read on the dark ground in either palette */
export function characterColors(accent, n) {
  const hsl = {}; accent.getHSL(hsl);
  const offs = [0, 150, 205, 300, 75, 250];
  return Array.from({ length: n }, (_, i) => new THREE.Color().setHSL(((hsl.h * 360 + offs[i % offs.length]) % 360) / 360, clamp(0.74 + (i % 2) * 0.08, 0.5, 0.9), i === 0 ? 0.70 : 0.60, THREE.SRGBColorSpace));
}

const S_TREE = { vert: S.TREE_VERT, frag: S.TREE_FRAG };
export function mount(host, opts) {
  const { data, copy = {}, onSelect = () => {}, onReady = () => {}, onFail = () => {}, onHover = () => {}, onPickTrail = () => {}, onReplay = () => {}, reduced = () => false, from = "" } = opts || {};
  const cfg = { ...DEFAULT_CONFIG, ...((data && data.config) || {}) };
  const HOME = cfg.home, HIGH = cfg.high;
  const state = window.DVCity = { live: true, frames: 0, renders: 0, ready: false, failed: "", tier: "", ms: 0, selected: "", fps: 0, why: { fly: 0, drag: 0, awake: 0, anim: 0, replay: 0, dive: 0 }, config: cfg, marks: {}, post: null, dive: null };
  const mark = (k) => { state.marks[k] = Math.round(performance.now()); };      // a timeline of the load, in ms since the page's navigation start, for the notes and for looking at
  mark("mount");
  const undo = [];
  let disposed = false, failed = false;
  // the layers' modules are fetched now, beside the city file (same folder and version as this module: the build copies and versions them together); a layer that fails to load is left out, the city is not
  const layerMods = (data && data.layers || []).filter((m) => /^[a-z_]+\.js$/.test(m)).map((m) => import(new URL("./" + m + new URL(import.meta.url).search, import.meta.url).href)
    .catch((e) => { state.layerError = String(e && e.message || e); return null; }));
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); undo.push(() => t.removeEventListener(ev, fn, o)); };

  /* ---------- DOM ---------- */
  const pre = spare; spare = null;
  const canvas = pre ? pre.canvas : document.createElement("canvas");
  canvas.className = "city-canvas"; canvas.tabIndex = 0; canvas.setAttribute("role", "application"); canvas.setAttribute("aria-roledescription", "map"); canvas.setAttribute("aria-label", copy.cityLabel || "A night view of " + cfg.name);
  const keys = document.createElement("p"); keys.className = "city-keys"; keys.id = "cityKeys"; keys.textContent = copy.keysOnMap || "Arrow keys move the map. Shift with the arrows turns it. Plus and minus zoom. Home shows the whole city.";
  canvas.setAttribute("aria-describedby", "cityKeys");
  const labels = document.createElement("div"); labels.className = "atlas-labels city-labels"; labels.setAttribute("aria-hidden", "true");
  const credit = document.createElement("div"); credit.className = "atlas-credit city-credit";
  if (!cfg.generic) { const a = document.createElement("a"); a.href = "https://www.openstreetmap.org/copyright"; a.target = "_blank"; a.rel = "noopener"; a.textContent = "© OpenStreetMap contributors"; credit.append(a); }   // a made-up scene is not OpenStreetMap's data
  host.append(canvas, keys, labels, credit);
  const fail = (why) => { if (failed || disposed) return; failed = true; state.failed = why; queueMicrotask(() => onFail(why)); };
  const own = () => { for (const el of [canvas, keys, labels, credit]) el.remove(); };
  // the story's blackout (data.config.blackout: Dwarka's power goes with the tear at the end of its chapter, `at` being that moment's share of the chapter's replay), written into a build only once that chapter is out
  const BLACKOUT = cfg.blackout && cfg.blackout.ch ? cfg.blackout : null;

  /* ---------- renderer ---------- */
  let renderer;
  try { renderer = pre && !pre.renderer.getContext().isContextLost() ? pre.renderer : newRenderer(canvas); state.spare = !!pre; }
  catch (e) { fail("nowebgl"); return { select() {}, home() {}, dispose() { disposed = true; state.live = false; own(); } }; }
  // three asks the GPU for every program's info log on its first use: a synchronous round trip that waits for everything the GPU still has queued (the city's uploads, the globe's tiles), 190 ms of
  // stall at the start of a dive on this laptop (29 October). The shaders are fixed and tested; ?glcheck=1 turns the check back on.
  renderer.debug.checkShaderErrors = /[?&]glcheck=1/.test(location.search);

  /* ---------- tier: what the device can afford ----------
     The page's device class (app.js deviceClass, the same for the globe and the city: strong, mid, phone, low) when it hands one in; this module's own reading of the GPU otherwise (the renderer's own
     context is asked: until 29 October a second, throwaway WebGL context was made just to read the GPU's name). strong: the high tier (post stack, occlusion), mid: bloom and SMAA, phone and low: no post. */
  let gpu = "";
  try { const g = renderer.getContext(), x = g.getExtension("WEBGL_debug_renderer_info"); gpu = x ? String(g.getParameter(x.UNMASKED_RENDERER_WEBGL)) : ""; } catch (e) {}
  const phone = touchFirst();       // a touch screen (Samsung's too, audit city-3), not a small window (31 October: a laptop's browser under 700 px tall was given a phone's tier)
  const soft = /swiftshader|basic render|llvmpipe|software/i.test(gpu);
  const weak = /intel|mali|adreno|powervr|apple gpu|videocore/i.test(gpu) && !/arc|iris xe max/i.test(gpu);
  const force = new URLSearchParams(location.search).get("q");
  const dev = opts.device || null;
  let tier = soft || phone ? "low" : weak ? "mid" : "high";
  if (!phone && /nvidia|geforce|rtx|gtx|radeon rx|apple m\d/i.test(gpu) && (navigator.hardwareConcurrency || 4) >= 6) tier = "high";
  // the site's own governor and CPU score (app.js DVCPU, the wheel's DVPerf) have a say: a weak CPU never gets the strongest tier, a very slow one or a governor already at level 2 gets the lightest
  const sCPU = window.DVCPU || null, sGov = window.DVPerf || null;
  if (sCPU) { if (sCPU.cpu > 12 || (sGov && sGov.lv >= 2)) tier = "low"; else if (sCPU.weak && tier === "high") tier = "mid"; }
  if (dev && dev.cls) tier = dev.cls === "strong" ? "high" : dev.cls === "mid" ? "mid" : "low";
  if (["high", "mid", "low"].includes(force)) tier = force;
  state.tier = tier; state.gpu = gpu; state.device = dev; state.siteGovernor = { cpu: sCPU && sCPU.cpu, weak: sCPU && sCPU.weak, level: sGov && sGov.lv };
  const dprCap = () => (tier === "high" ? 1.5 : tier === "mid" ? 1.25 : 1);
  let dprScale = 1;
  const dpr = () => Math.min(window.devicePixelRatio || 1, dprCap()) * dprScale;
  renderer.setPixelRatio(dpr());
  renderer.setClearColor(0x05040a, 1);
  // the plain path (tone mapping and the colour space in the shaders themselves): the low tier for good, every other tier until its post stack has arrived. Rendering into the composer's targets is
  // never tone mapped by three, so this stays as it is when the stack comes in and no program is built twice for it.
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 2, cfg.limits.far);
  scene.add(camera);
  state.dbg = { scene, camera, renderer, get composer() { return composer; }, get passes() { return passes; } };

  /* ---------- shared uniforms: the palette and the fog ---------- */
  const U = {
    uTime: { value: 0 }, uAnim: { value: 1 }, uHaze: { value: new THREE.Vector3() }, uGlowCol: { value: new THREE.Vector3() }, uGlowDir: { value: new THREE.Vector3(...cfg.glowDir).normalize() },
    uAccent: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3(-0.55, 0.62, -0.56).normalize() }, uMoonCol: { value: new THREE.Vector3() },
    uFogD: { value: cfg.fog.d * FOG_CLEAR }, uFogK: { value: cfg.fog.k }, uFogBase: { value: cfg.fog.base * FOG_CLEAR }, uFogCam: { value: 1 }, uWinGain: { value: 1 }, uLights: { value: 1 }, uWarm: { value: new THREE.Vector3(1, 0.6, 0.26) }, uTraffic: { value: 1 },
    // the light (30 October; applyLight, setLight)
    uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Vector3() }, uSunI: { value: 1 }, uSkyCol: { value: new THREE.Vector3() }, uDay: { value: 0 },
    uTearC: { value: new THREE.Vector4(0, 0, 2700, 0) }, uTearK: { value: new THREE.Vector3(0.34, 0.17, 0.95) }, uLamps: { value: 1 }, uUpDay: { value: new THREE.Vector3() }, uAlb: { value: 0.5 }, uLod: { value: new THREE.Vector4(0.55, 5, 0, 0) }, uWinK: { value: 1 },
    // the day's look (30 October, polished; only the day's programs read these)
    uMix: { value: 0 }, uNoise: { value: null }, uAnti: { value: new THREE.Vector3() }, uZen: { value: new THREE.Vector3() }, uSkyMid: { value: new THREE.Vector3() }, uBounce: { value: new THREE.Vector3() }, uAltK: { value: new THREE.Vector3(1, 1, 1) }, uTreeR: { value: new THREE.Vector2(-2, -1) },
  };
  // a city's own colours by day (its config's `day`), as linear uniforms
  const LOOK = { ...CITY_DAY.look, ...(cfg.day || {}) }, hex1 = (h) => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); }, hexes = (a) => ({ value: a.map(hex1) });
  Object.assign(U, { uWalls: hexes(LOOK.walls), uRoofs: hexes(LOOK.roofs), uTower: { value: hex1(LOOK.tower) }, uGnd: hexes(LOOK.ground), uPlain: hexes(LOOK.plain), uTree: { value: hex1(LOOK.tree) }, uPark: hexes(LOOK.park), uForest: hexes(LOOK.forest),
    uField: hexes(LOOK.field), uSand: { value: hex1(LOOK.sand) }, uWet: { value: hex1(LOOK.wet) }, uWat: hexes(LOOK.water), uRoad: hexes(LOOK.road), uIce: hexes(LOOK.ice) });
  state.dbg.U = U;     // for tuning the look from a script
  state.dbg.poseOf = (v) => poseOf(v); state.dbg.altK = (y) => altExposure(y).toArray();
  // layers: extra modules the data names (content.city.layers, beside this module), mounted once the city is built; `mood` is what a layer may ask of the city's own look
  const layers = [], mood = { windows: 1, lights: 1, traffic: 1, trains: 1, beams: 1 };
  let lastUser = 0;          // when the reader last moved the camera (a layer's camera moves give way to the reader's)
  let pal = readPalette(), palFrame = null;
  function applyPalette() {
    pal = readPalette();
    const a = lin(pal.accent), g = pal.grahan;
    U.uAccent.value.copy(a).multiplyScalar(g ? 0.85 : 0.9);
    const ink = lin(pal.ink);
    // The haze and the glow towards the capital's lights are what colour the night. Akash's are made from its accent (a violet-blue night: the glow was an orange-red here, which made the wide view maroon);
    // Grahan's are an ember night, warm but kept clean: little blue in the haze, an amber horizon, and the glow mostly in the sky, not in the fog (see fogColor and skyGlow).
    if (g) { nightPal.haze.set(0.017, 0.0095, 0.0055); nightPal.glow.set(0.15, 0.062, 0.012); }
    else { nightPal.haze.set(ink.x * 1.6 + a.x * 0.020 + 0.0025, ink.y * 1.6 + a.y * 0.017 + 0.002, ink.z * 1.6 + a.z * 0.026 + 0.0035); nightPal.glow.set(a.x * 0.082, a.y * 0.100, a.z * 0.112); }
    U.uMoonCol.value.set(g ? 0.14 : 0.10, g ? 0.12 : 0.13, g ? 0.10 : 0.22);
    nightPal.zenith.copy(ink).multiplyScalar(1.1).addScaledVector(a, 0.004);
    applyLight();
    colors = characterColors(pal.accent, (data.characters || []).length || 4);
    if (trailMeshes.length) colorTrails();
    colorTear();
    opts.onColors && opts.onColors(colors.map((c) => "#" + c.getHexString()));
  }
  /* the light (30 October). Tonight: the moon is the key light, the sky the haze's dome, the day factor 0. By the reader's clock (updateSun, below) the sun takes over: its direction from sunAt for the
     city's origin, its colour, the sky's light, the horizon, the sky's band, the zenith and the fog by the sun's height from CITY_DAY.keys, blended into the night's own values under 3.5 degrees below the
     horizon (uMix). uDay stays the globe's own `day` (the sun from 6 degrees below the horizon to 6 above), which switches the windows and the street lights. With the sun 6 degrees or more under the horizon every
     uniform is tonight's, value for value. setLight({ sunDir, sunCol, sunI, skyCol, day }) (api.setLight) overrides any of the five, setLight(null) gives them back to the clock. */
  const altTarget = new THREE.Vector3(1, 1, 1);
  let lightOver = null, sunNow = null, lampsOn = 1, postBloom = null, dayOn = false, lamps3 = null, sunShadow = null, shGroup = null, shMat = null, shReady = false, trees = null, treesAsked = false, treeWorker = null, treeGrowFrom = 0;
  const nightPal = { haze: new THREE.Vector3(), glow: new THREE.Vector3(), zenith: new THREE.Vector3(), glowDir: new THREE.Vector3(...cfg.glowDir).normalize() };
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]), lum3 = (v) => v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ALB_NIGHT = 0.5;
  // the table at a height, the city's tints on it; a morning is a little cooler than an evening
  function dayKeys(el, morning) {
    const K = CITY_DAY.keys; let i = 0; while (i < K.length - 2 && el > K[i + 1].el) i++;
    const a = K[i], b = K[i + 1], t = clamp((el - a.el) / (b.el - a.el), 0, 1), o = {};
    for (const k of ["sun", "sky", "haze", "glow", "mid", "zen", "anti"]) o[k] = V3(a[k]).lerp(V3(b[k]), t);
    const hz = V3(LOOK.haze); o.haze.multiply(hz); o.mid.multiply(hz); o.zen.multiply(V3(LOOK.zen));
    if (morning) { const c = new THREE.Vector3(1, 1, 1).lerp(V3(CITY_DAY.dawn), 1 - smooth(4, 22, el)); for (const k of ["sun", "haze", "glow", "mid", "anti"]) o[k].multiply(c); }
    return o;
  }
  function applyLight() {
    const m = U.uMoonCol.value, h = nightPal.haze, D = CITY_DAY;
    const night = { sunDir: U.uMoonDir.value.clone(), sunCol: m.clone().multiplyScalar(1.35), sunI: 1, skyCol: new THREE.Vector3(h.x * 2.6 + m.x * 0.26, h.y * 2.6 + m.y * 0.26, h.z * 2.6 + m.z * 0.26), day: 0 };
    const o = lightOver || {}, v3 = (x, d) => (Array.isArray(x) ? new THREE.Vector3(x[0], x[1], x[2]) : x && x.isVector3 ? x.clone() : d);
    // the sun: the clock's, or the override's direction and day
    let w = 0, el = -90, sd = null, morning = false;
    if (sunNow) { w = sunNow.day; el = sunNow.elevation; morning = sunNow.azimuth < 180; const az = sunNow.azimuth * DEG, e = el * DEG; sd = new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)); }
    if (o.sunDir) { sd = v3(o.sunDir).normalize(); el = Math.asin(clamp(sd.y, -1, 1)) / DEG; }
    if (o.day != null) w = clamp(+o.day, 0, 1);
    const B = o.day != null ? w : (sd && w > 0 ? smooth(-6, -3.5, el) : 0);     // the day look's share: all of it from 3.5 degrees below the horizon up
    const K = B > 0 ? dayKeys(el, morning) : null;
    let L = night;
    if (K) {
      const dir = night.sunDir.clone().multiplyScalar((1 - B) * lum3(night.sunCol));
      if (sd) dir.addScaledVector(sd, lum3(K.sun));
      if (dir.lengthSq() < 1e-12) dir.copy(night.sunDir);
      L = { sunDir: dir.normalize(), sunCol: night.sunCol.clone().multiplyScalar(1 - B).add(K.sun), sunI: 1, skyCol: night.skyCol.clone().lerp(K.sky, B), day: w };
    }
    U.uSunDir.value.copy(v3(o.sunDir, L.sunDir)).normalize(); U.uSunCol.value.copy(v3(o.sunCol, L.sunCol)); U.uSunI.value = o.sunI != null ? +o.sunI : L.sunI;
    U.uSkyCol.value.copy(v3(o.skyCol, L.skyCol)); U.uDay.value = clamp(o.day != null ? +o.day : L.day, 0, 1); U.uMix.value = K ? B : 0;
    // the rest of the look follows the day: the fog's colour and densities, the glow (towards the capital at night, the sun's side by day), the zenith, the buildings' albedo, the street lights
    const W = U.uDay.value, zen = U.uZen.value, f = cfg.fog;
    if (W <= 0 || !K) {
      U.uHaze.value.copy(nightPal.haze); U.uGlowCol.value.copy(nightPal.glow); U.uGlowDir.value.copy(nightPal.glowDir); zen.copy(nightPal.zenith); U.uAlb.value = ALB_NIGHT;
      U.uFogD.value = f.d * FOG_CLEAR; U.uFogBase.value = f.base * FOG_CLEAR;
    } else {
      U.uHaze.value.copy(nightPal.haze).lerp(K.haze, B);
      U.uGlowCol.value.copy(nightPal.glow).lerp(K.glow, B);
      const gd = nightPal.glowDir.clone().multiplyScalar((1 - B) * Math.max(lum3(nightPal.glow), 1e-4));
      if (sd && Math.hypot(sd.x, sd.z) > 1e-3) gd.addScaledVector(new THREE.Vector3(sd.x, 0, sd.z).normalize(), B * Math.max(lum3(K.glow), 1e-4));
      U.uGlowDir.value.copy(gd.lengthSq() > 1e-12 ? gd.normalize() : nightPal.glowDir);
      zen.copy(nightPal.zenith).lerp(K.zen, B); U.uSkyMid.value.copy(K.mid); U.uAnti.value.copy(K.anti).multiplyScalar(B);
      U.uAlb.value = ALB_NIGHT + (D.alb - ALB_NIGHT) * W;
      U.uFogD.value = f.d * FOG_CLEAR * (1 + (D.fog - 1) * B); U.uFogBase.value = f.base * FOG_CLEAR * (1 + (D.fogBase - 1) * B);
    }
    // the light on an upward face, for the shaders' day terms: a low sun still warms a roof (more than its height alone would: the air's scattered light comes with it). The ground's bounce up the walls goes with it.
    const up = K ? Math.max(Math.max(U.uSunDir.value.y, 0), 0.36 * smooth(-0.8, 3, el)) : Math.max(U.uSunDir.value.y, 0);
    U.uUpDay.value.copy(U.uSunCol.value).multiplyScalar(U.uSunI.value * up).add(U.uSkyCol.value);
    U.uBounce.value.copy(U.uUpDay.value).multiply(U.uGnd.value[0]).multiplyScalar(0.5);
    if ((W > 0) !== dayOn) dayVariant(W > 0);
    lampsOn = 1 - smooth(0.4, 0.65, W);                      // the street lights go off a little after sunrise and come on round sunset
    U.uLamps.value = mood.lights * lampsOn;
    if (lamps3) lamps3.visible = lampsOn > 0;                // no point rasterising them by day
    treesLight();
    if (postBloom) dayBloom();
    labels.classList.toggle("is-day", W > 0.3);
    sunShadow = K && sd ? { sd, el, strength: smooth(3, 9, el) } : null; applyShadows();
    if (K) { const A = D.alt; let i = 0; while (i < A.length - 2 && el > A[i + 1][0]) i++; const t = clamp((el - A[i][0]) / (A[i + 1][0] - A[i][0]), 0, 1); altTarget.set(lerp(A[i][1], A[i + 1][1], t), lerp(A[i][2], A[i + 1][2], t), lerp(A[i][3], A[i + 1][3], t)); }
    state.light = { sunDir: U.uSunDir.value.toArray(), sunCol: U.uSunCol.value.toArray(), sunI: U.uSunI.value, skyCol: U.uSkyCol.value.toArray(), day: U.uDay.value, mix: U.uMix.value, override: !!lightOver };
  }
  /* the day's terms are compiled only into the day's programs (CITY_DAY in city_shaders.js): at night the programs are the night's own code, as they were before the clock. Crossing between the two
     (twice a day for a page left open, or once at the opening) builds the other programs on three's parallel compile and then draws. */
  const needsDay = (m) => /CITY_DAY|DAYK|DAYV|waterCol\(|iceCol\(|applyFog|fogColor/.test((m.vertexShader + m.fragmentShader).split(S.COMMON).join(""));     // a material with day terms of its own, or the day's fog
  /* the day's noise: 128 x 128, four channels of periodic gradient noise at different scales (R 8 and 16 cells across the tile, G 16 and 32, B 32 and 64, A 8 and 32 from other seeds), each stretched to the full range, with
     mipmaps, so that it fades to its mean from afar without any work in the shader. Made when the day's programs are first wanted (a night never makes it). */
  function dayNoise() {
    if (U.uNoise.value) return U.uNoise.value;
    const N = 128, d = noiseData();
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = tier === "high" ? 2 : 1; t.needsUpdate = true;
    disposables.push(t);
    return (U.uNoise.value = t);
  }
  function dayVariant(on) {
    dayOn = on;
    if (on) { dayNoise(); if (shReady) askTrees(); }
    for (const m of disposables) {
      if (!m.isShaderMaterial || !needsDay(m)) continue;
      if (on) m.defines.CITY_DAY = ""; else delete m.defines.CITY_DAY;
      m.needsUpdate = true;
    }
    state.dayPrograms = on;
    if (!state.ready || disposed) return;
    const tgt = composer ? composer.inputBuffer : null;
    try { renderer.setRenderTarget(tgt); const pr = renderer.compileAsync(scene, camera); renderer.setRenderTarget(null); pr.catch(() => {}).then(() => { if (!disposed) { dirty = true; schedule(); } }); }
    catch (e) { renderer.setRenderTarget(null); }
  }
  function setLight(o) { lightOver = o ? { ...(lightOver || {}), ...o } : null; applyLight(); wake(400); return state.light; }
  /* the sun's clock (30 October): the reader's own instant (atlasNow: the true instant, so every city is lit for its own local time), worked out once a minute (60/N s with ?timescale=N, at most ten
     times a second) and when the page comes back into view; then one frame is drawn, and the loop goes back to rest. ?sun=night leaves the sun off: tonight everywhere. */
  const sunOff = sunNight(), sunRate = atlasClockRate();
  function updateSun(draw) {
    if (disposed) return;
    const o = (city && city.meta && city.meta.origin) || (cfg.globe ? [cfg.globe.lat, cfg.globe.lon] : null), n = ((state.sun && state.sun.updates) || 0) + 1;
    if (sunOff || !o) { sunNow = null; state.sun = { on: false, updates: n }; }
    else { const at = atlasNow(); sunNow = sunAt(at, o[0], o[1]); state.sun = { on: true, at: at.toISOString(), lat: o[0], lon: o[1], elevation: Math.round(sunNow.elevation * 100) / 100, azimuth: Math.round(sunNow.azimuth * 100) / 100, day: Math.round(sunNow.day * 1000) / 1000, rate: sunRate, updates: n }; }
    applyLight();
    if (draw) { dirty = true; schedule(); }
  }
  const mo = new MutationObserver(() => { applyPalette(); wake(400); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
  undo.push(() => mo.disconnect());
  let colors = [];
  let paths = [], trailMeshes = [], trailGeo = null, pathInfo = [], tearObjs = [], tearRing = null;
  const colorTear = () => { if (tearRing) tearRing.material.uniforms.uCol.value.copy(lin(pal.accent)).multiplyScalar(pal.grahan ? 0.55 : 0.6); };

  /* ---------- the sky, the ground ---------- */
  const common = () => ({ uTime: U.uTime, uAnim: U.uAnim, uHaze: U.uHaze, uGlowCol: U.uGlowCol, uGlowDir: U.uGlowDir, uAccent: U.uAccent, uMoonDir: U.uMoonDir, uMoonCol: U.uMoonCol, uFogD: U.uFogD, uFogK: U.uFogK, uFogBase: U.uFogBase, uFogCam: U.uFogCam,
    uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSunI: U.uSunI, uSkyCol: U.uSkyCol, uDay: U.uDay, uUpDay: U.uUpDay, uMix: U.uMix, uNoise: U.uNoise, uAnti: U.uAnti, uWat: U.uWat, uIce: U.uIce, uZen: U.uZen, uAltK: U.uAltK, uTreeR: U.uTreeR, uTearC: U.uTearC, uTearK: U.uTearK });
  const disposables = [];
  const mk = (vertexShader, fragmentShader, uniforms, extra = {}) => { const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...common(), ...uniforms }, ...extra }); if (dayOn && needsDay(m)) m.defines.CITY_DAY = ""; disposables.push(m); return m; };
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mk(S.SKY_VERT, S.SKY_FRAG, { uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld }, uZenith: U.uZen, uSkyMid: U.uSkyMid }, { depthTest: true, depthFunc: THREE.LessEqualDepth, depthWrite: false }));
  // the sky is drawn last, at the far plane: the depth test then keeps its (dear) shader off every pixel the ground and the buildings have covered, which is most of them
  sky.frustumCulled = false; sky.renderOrder = 100; scene.add(sky); disposables.push(sky.geometry);
  let ground = null, densTex = null;
  applyPalette();

  /* ---------- the city file ---------- */
  const abort = new AbortController(); undo.push(() => abort.abort());
  let city = null, hf = null, snapStreet = null, bounds = cfg.keep;
  updateSun(false);
  { const t = setInterval(() => updateSun(true), Math.max(100, Math.min(60000, 60000 / sunRate))); undo.push(() => clearInterval(t)); }
  const groups = {};          // meshes by role
  const added = [];
  const add = (obj, name) => { scene.add(obj); added.push(obj); if (name) groups[name] = obj; if (obj.geometry) disposables.push(obj.geometry); return obj; };
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  // the arrays of the scene: from the worker the page started when the city was chosen (opts.prepared), from one started here, or, where a worker cannot run, made on this thread between frames
  async function prepared() {
    let h = opts.prepared && opts.prepared.file === data.file ? opts.prepared : null;
    if (!h) h = prepare(data.file, opts.file, { hfCell: cfg.hfCell });
    try { const P = await h.promise; state.prepWhere = "worker"; return P; } catch (e) { if (disposed) return null; state.workerError = String((e && e.message) || e); }
    const raw = await fetchRaw(data.file, abort.signal, null);
    if (disposed) return null;
    const gen = prepareSteps(raw, { hfCell: cfg.hfCell }); let r, t = performance.now();
    while (!(r = gen.next()).done) { if (performance.now() - t > 10) { await yieldNow(); if (disposed) return null; t = performance.now(); } }
    state.prepWhere = "main";
    return r.value;
  }
  let roadLines = null;
  /* a tile further than LIP_FAR from the camera is drawn without its roofs' lips (the last of its triangles; a third of a pixel wide there) (30 October) */
  const bTiles = [], LIP_FAR = 1800;
  function lipRanges() {
    const cp = camera.position;
    for (const t of bTiles) { const far = cp.distanceTo(t.c) - t.r > LIP_FAR; if (far !== t.far) { t.far = far; t.g.setDrawRange(0, far ? t.main : Infinity); } if (shGroup && shGroup.visible) t.sm.visible = !far || cp.distanceTo(t.c) - t.r < SH_RANGE[tier][1]; }
  }
  /* ---------- the trees (30 October): real ones, by day. Where they stand comes from the worker (city_data.js treeSteps), asked for only when the day's programs are wanted: a night makes no worker, no program, no draw call. Each tile of 400 m draws its stand per species with three shapes by its distance (near, middle, far), as many as its distance allows; a tree shrinks away at its own reach, and the ground's painted canopy (uTreeR) comes in over the same distance. ?trees=0 is without them (for measuring). ---------- */
  const treesQ = new URLSearchParams(location.search).get("trees");
  const TREE_TIERS = { high: { r: [240, 800, 3000], sh: 1500, thin: 1, far: 400000 }, mid: { r: [150, 520, 2200], sh: 800, thin: 0.6, far: 180000 }, low: { r: [0, 380, 1100], sh: 0, thin: 0.4, far: 90000 }, phone: { r: [0, 300, 800], sh: 0, thin: 0.25, far: 50000 } };
  const treeTier = () => (phone ? TREE_TIERS.phone : TREE_TIERS[tier]);
  const treeShared = { uBounce: U.uBounce, uAltK: U.uAltK, uMix: U.uMix, uNoise: U.uNoise, uTreeRange: { value: new THREE.Vector2(1, 0) }, uFar: { value: new THREE.Vector4() } };
  function askTrees() {
    if (treesAsked || treesQ === "0" || !dayOn || !city || disposed) return;
    const spec = LOOK.trees; if (!spec || !spec.species || !spec.species.length) return;
    treesAsked = true;
    const noise = dayNoise().image.data, P = city, pathsXY = (data.paths || []).map((p) => p.xy || decodePath(p.pts, data.pathUnit || 0.5)), pl = [];
    for (const p of data.places || []) pl.push(p.x, p.n);
    state.dbg.treePaths = pathsXY; state.dbg.treePlaces = pl;
    const inp = { keep: city.meta.keep, trees: spec, density: phone ? 0.35 : tier === "low" ? 0.6 : 1, areas: { pos: P.areas.pos, kind: P.areas.kind, idx: P.areas.idx }, roads: { k: P.roadLines.k, off: P.roadLines.off, pts: P.roadLines.pts },
      deck: P.metro.deck ? { pos: P.metro.deck.pos, idx: P.metro.deck.idx } : null, rail: P.metro.rail ? { pos: P.metro.rail.pos, idx: P.metro.rail.idx } : null, hf: { hf: P.hf.hf, W: P.hf.W, H: P.hf.H, cell: P.hf.cell, x0: P.hf.x0, n0: P.hf.n0 }, dens: P.dens, paths: pathsXY, places: pl, noise };
    const got = (T) => { if (!disposed && T) makeTrees(T); };
    if (typeof Worker === "function") {
      try {
        treeWorker = new Worker(DATA_URL, { type: "module", name: "trees" });
        treeWorker.onmessage = (e) => { const m = e.data || {}; if (treeWorker) treeWorker.terminate(); treeWorker = null; if (m.ok) got(m.T); else state.treesError = m.error; };
        treeWorker.onerror = (e) => { if (treeWorker) treeWorker.terminate(); treeWorker = null; state.treesError = String((e && e.message) || "worker"); };
        treeWorker.postMessage({ id: 1, trees: inp });
        undo.push(() => { if (treeWorker) treeWorker.terminate(); treeWorker = null; });
        return;
      } catch (e) { treeWorker = null; }
    }
    (async () => { const g = treeSteps(inp); let r, t = performance.now(); while (!(r = g.next()).done) { if (performance.now() - t > 8) { await yieldNow(); if (disposed) return; t = performance.now(); } } got(r.value); })();   // no worker: the same steps between frames
  }
  /* the shapes: a crown of lobes (x, y, z, rx, ry, rz in a unit tree: y up, 1 tall, 1 wide at the widest), a trunk, or a conifer's cones, or a palm's fronds; three levels of detail */
  const ICO = (() => { const t = 1.618034, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
    return { v, f: [0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1] }; })();
  const OCT = { v: [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]], f: [0,2,1,0,3,2,0,4,3,0,1,4,5,1,2,5,2,3,5,3,4,5,4,1] };
  const TREE_SHAPES = {
    round: { lobes: [[0, 0.68, 0, 0.40, 0.22, 0.40], [0.30, 0.58, 0.14, 0.26, 0.18, 0.26], [-0.28, 0.56, -0.16, 0.27, 0.19, 0.27], [0.08, 0.55, -0.34, 0.25, 0.17, 0.25], [-0.12, 0.58, 0.33, 0.25, 0.18, 0.25], [0.03, 0.85, 0.02, 0.26, 0.13, 0.26], [0.40, 0.68, -0.12, 0.13, 0.11, 0.13], [-0.38, 0.70, 0.14, 0.14, 0.11, 0.14], [0.16, 0.76, 0.28, 0.17, 0.12, 0.17], [-0.18, 0.77, -0.26, 0.17, 0.12, 0.17]], mid: [0, 1, 2, 4], trunk: 0.56, tr: 0.055 },
    oval: { lobes: [[0, 0.60, 0, 0.26, 0.30, 0.26], [0.15, 0.40, 0.06, 0.20, 0.16, 0.20], [-0.14, 0.44, -0.10, 0.20, 0.17, 0.20], [0.02, 0.84, 0.02, 0.17, 0.15, 0.17], [0.13, 0.66, -0.12, 0.13, 0.13, 0.13], [-0.12, 0.72, 0.12, 0.12, 0.12, 0.12]], mid: [0, 1, 3], trunk: 0.42, tr: 0.04 },
    gum: { lobes: [[0.10, 0.82, 0.04, 0.20, 0.11, 0.18], [-0.18, 0.70, 0.10, 0.18, 0.10, 0.17], [0.22, 0.60, -0.10, 0.17, 0.09, 0.16], [-0.06, 0.92, -0.10, 0.14, 0.07, 0.14], [-0.10, 0.50, -0.20, 0.15, 0.08, 0.14], [0.04, 0.46, 0.22, 0.13, 0.07, 0.13], [0.28, 0.78, 0.14, 0.11, 0.06, 0.11]], mid: [0, 1, 2, 4], trunk: 0.42, tr: 0.03, ao: 0.66,
      limbs: [[0, 0.38, 0, 0.10, 0.80, 0.04], [0, 0.38, 0, -0.18, 0.68, 0.10], [0, 0.34, 0, 0.22, 0.58, -0.10], [0, 0.30, 0, -0.10, 0.48, -0.20], [0.05, 0.59, 0.02, -0.06, 0.90, -0.10], [0, 0.30, 0, 0.04, 0.44, 0.22], [0.11, 0.46, -0.04, 0.28, 0.76, 0.14]] },
    canopy: { lobes: [[0, 0.78, 0, 0.30, 0.17, 0.30], [0.28, 0.70, 0.18, 0.24, 0.15, 0.24], [-0.30, 0.70, -0.08, 0.24, 0.15, 0.24], [0.06, 0.68, -0.32, 0.24, 0.14, 0.24], [-0.10, 0.72, 0.32, 0.22, 0.14, 0.22], [0.40, 0.62, -0.14, 0.15, 0.10, 0.15], [-0.42, 0.62, 0.16, 0.15, 0.10, 0.15], [0.16, 0.90, 0.10, 0.16, 0.08, 0.16], [-0.16, 0.88, -0.14, 0.15, 0.08, 0.15]], mid: [0, 1, 2, 3], trunk: 0.6, tr: 0.03 },
    conifer: { cones: [[0.10, 0.50, 0.30], [0.36, 0.76, 0.22], [0.60, 1.0, 0.14]], trunk: 0.2, tr: 0.03 },
    palm: { fronds: 8, trunk: 0.92, tr: 0.018, double: true },
  };
  const hashF = (i) => { let t = (i + 0x6D2B79F5) | 0; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function treeGeometry(name, lod) {
    const S = TREE_SHAPES[name], P = [], Nn = [], T = [], I = [];
    const vert = (x, y, z, nx, ny, nz, shade, tone, trunk) => { const l = Math.hypot(nx, ny, nz) || 1; P.push(x, y, z); Nn.push(nx / l, ny / l, nz / l); T.push(shade, tone, trunk); return P.length / 3 - 1; };
    const trunk = (top, r, sides) => { const b = P.length / 3; for (let i = 0; i < sides; i++) { const a = i / sides * 6.2832, c = Math.cos(a), s = Math.sin(a); vert(c * r, 0, s * r, c, 0.1, s, 0.75, 0.5, 1); vert(c * r * 0.55, top, s * r * 0.55, c, 0.1, s, 0.5, 0.5, 1); }
      for (let i = 0; i < sides; i++) { const a = b + i * 2, n = b + ((i + 1) % sides) * 2; I.push(a, a + 1, n, n, a + 1, n + 1); } };
    if (S.lobes) {
      const lobes = lod === 0 ? S.lobes : lod === 1 ? S.mid.map((i) => S.lobes[i]) : null;
      let yLo = 1, yHi = 0; for (const l of S.lobes) { yLo = Math.min(yLo, l[1] - l[4]); yHi = Math.max(yHi, l[1] + l[4]); }
      const cy = (yLo + yHi) / 2, rMax = Math.max(...S.lobes.map((l) => Math.hypot(l[0], l[2]) + l[3]));
      const lump = (l, geo, seed) => { const b = P.length / 3; const tone = hashF(seed * 7 + 3);
        geo.v.forEach((v, i) => { const j = 1 + (hashF(seed * 101 + i * 13) - 0.5) * (geo === ICO ? 0.34 : 0.1), x = l[0] + v[0] * l[3] * j, y = l[1] + v[1] * l[4] * j, z = l[2] + v[2] * l[5] * j, ox = x / rMax, oy = (y - cy) / (yHi - yLo) * 2, oz = z / rMax;
          const h = Math.min(1, Math.max(0, (y - yLo) / (yHi - yLo))), edge = Math.min(1, Math.hypot(x, z) / rMax), ao0 = S.ao || 0.34, shade = (ao0 + (1 - ao0) * h * h * (3 - 2 * h)) * (0.72 + 0.28 * Math.max(edge, h));
          vert(x, y, z, v[0] * 0.5 + ox * 0.5, v[1] * 0.5 + oy * 0.5, v[2] * 0.5 + oz * 0.5, shade, tone, 0); });
        for (const q of geo.f) I.push(b + q); };
      if (lod < 2) { lobes.forEach((l, i) => lump(l, ICO, i + 1)); trunk(S.trunk, S.tr, lod === 0 ? 6 : 3);
        if (S.limbs) for (const m of lod === 0 ? S.limbs : S.limbs.slice(0, 4)) { const b = P.length / 3, r = S.tr * 0.62, dx = m[3] - m[0], dz = m[5] - m[2], dl = Math.hypot(dx, dz) || 1, sx = -dz / dl, sz = dx / dl;     // a limb: a flat tapered strip seen from both sides, three sides from below
          for (const [ox, oy, oz] of [[sx, 0, sz], [-sx, 0, -sz], [0, -1, 0]]) { vert(m[0] + ox * r, m[1] + oy * r, m[2] + oz * r, ox, oy + 0.2, oz, 0.7, 0.5, 1); vert(m[3] + ox * r * 0.45, m[4] + oy * r * 0.45, m[5] + oz * r * 0.45, ox, oy + 0.2, oz, 0.6, 0.5, 1); }
          for (let i = 0; i < 3; i++) { const a = b + i * 2, n = b + ((i + 1) % 3) * 2; I.push(a, a + 1, n, n, a + 1, n + 1); I.push(a, n, a + 1, n, n + 1, a + 1); } } }
      else { const w = Math.max(...S.lobes.map((l) => Math.max(Math.abs(l[0]), Math.abs(l[2])) + l[3] * 0.7)); lump([0, (yLo + yHi) / 2 + 0.03, 0, w, (yHi - yLo) / 2 * 1.05, w], lod === 3 ? ICO : OCT, 1); if (lod === 2) { const q = T; for (let i = 0; i < q.length; i += 3) q[i] = Math.max(q[i], 0.62); } }
    } else if (S.cones) {
      const cones = lod === 0 ? S.cones : lod === 1 ? [S.cones[0], S.cones[2]] : [[S.cones[0][0], 1, S.cones[0][2]]], sides = lod === 0 ? 7 : lod === 1 ? 5 : lod === 3 ? 7 : 4;
      cones.forEach((c, ci) => { const b = P.length / 3, top = vert(0, c[1], 0, 0, 1, 0, 1, ci / 3, 0);
        for (let i = 0; i < sides; i++) { const a = (i + ci * 0.5) / sides * 6.2832, x = Math.cos(a), z = Math.sin(a), j = 0.86 + 0.28 * hashF(ci * 17 + i * 5); vert(x * c[2] * j, c[0], z * c[2] * j, x, 0.45, z, 0.36 + 0.3 * (ci / 3), ci / 3, 0); }
        for (let i = 0; i < sides; i++) I.push(top, b + 1 + ((i + 1) % sides), b + 1 + i); });
      if (lod < 2) trunk(S.trunk, S.tr, 3);
    } else {
      const n = lod === 0 ? S.fronds : lod === 1 ? 6 : 4, segs = lod === 0 ? 3 : lod === 1 ? 2 : 1, y0 = 0.93;   // (a shadow uses level 2's)
      for (let f = 0; f < n; f++) {
        const a = f / n * 6.2832 + hashF(f * 3) * 0.5, dx = Math.cos(a), dz = Math.sin(a), len = 0.40 + hashF(f * 5) * 0.12, up = 0.16 + hashF(f * 7) * 0.1, b = P.length / 3; const tone = hashF(f * 11);
        for (let i = 0; i <= segs; i++) { const t = i / segs, r = t * len, y = y0 + up * Math.sin(t * 2.0) - 0.34 * t * t, wd = (i === segs ? 0.004 : 0.075 * (1 - t * 0.5)), sx = -dz * wd, sz = dx * wd;
          vert(dx * r + sx, y, dz * r + sz, dx * 0.3, 1, dz * 0.3, 0.72 + 0.28 * (1 - t), tone, 0); vert(dx * r - sx, y, dz * r - sz, dx * 0.3, 1, dz * 0.3, 0.72 + 0.28 * (1 - t), tone, 0); }
        for (let i = 0; i < segs; i++) { const q = b + i * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      if (lod < 2) trunk(y0, S.tr, lod === 0 ? 5 : 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(Nn), 3)); g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(T), 3)); g.setIndex(I);
    treeOwn.push(g); return g;
  }
  const treeOwn = [];   // everything the trees made, for dispose (they are not among the day-variant materials: they exist only by day)
  undo.push(() => { for (const o of treeOwn) { try { o.dispose(); } catch (e) {} } });
  function makeTrees(T) {
    const spec = LOOK.trees, group = new THREE.Group(); group.visible = false; scene.add(group);
    const col = (h) => hex1(h), species = spec.species.map((sp) => {
      const S = TREE_SHAPES[sp.shape], geos = [treeGeometry(sp.shape, 0), treeGeometry(sp.shape, 1), treeGeometry(sp.shape, 2), treeGeometry(sp.shape, 3)];
      const uni = { ...common(), ...treeShared, uSp: { value: new THREE.Vector4(sp.h[0], sp.h[1], sp.wid || 0.9, 0) }, uCa: { value: col(sp.c[0]) }, uCb: { value: col(sp.c[1]) }, uTrunk: { value: col(sp.trunk || "#5A4A3C") } };
      const mat = new THREE.ShaderMaterial({ vertexShader: S_TREE.vert, fragmentShader: S_TREE.frag, uniforms: uni, defines: { CITY_DAY: "" }, side: S.double ? THREE.DoubleSide : THREE.FrontSide });
      treeOwn.push(mat);
      return { shape: sp.shape, geos, mat, tris: geos.map((g) => g.index.count / 3), verts: geos.map((g) => g.attributes.position.count), uni };
    });
    const tiles = T.tiles.map((t) => ({ x: t.x, z: t.z, r: TREE_TILE * 0.7072 + 8, sp: t.sp.map((s) => (s ? { n: s.n, iP: new THREE.InstancedBufferAttribute(s.P, 2), iB: new THREE.InstancedBufferAttribute(s.B, 4, true), mesh: null, g: [null, null, null, null], lod: -1, sh: null } : null)) }));
    trees = { group, species, tiles, count: T.count, ms: T.ms, tris: 0, drawn: 0, calls: 0, sg: null };
    state.dbg.trees = trees; state.dbg.city = () => city; state.trees = { count: T.count, street: T.street, ms: T.ms, tiles: tiles.length, cell: T.cell };
    // the far trees (31 October): the view a city opens at is past the reach of the shapes below, so each tree also has a dot (TREE_FAR_VERT): one vertex, one draw call a species
    const farThin = Math.min(1, treeTier().far / T.count); trees.points = 0;      // at most this many, the first ranks: a forested city has close on a million trees
    species.forEach((sp, i) => {
      let n = 0; for (const t of T.tiles) if (t.sp[i]) n += t.sp[i].n;
      const pos = new Float32Array(n * 3), b = new Uint8Array(n * 4); let m = 0;
      for (const t of T.tiles) { const s = t.sp[i]; if (!s) continue; for (let j = 0; j < s.n; j++) { if (s.B[j * 4 + 2] > farThin * 255) continue; pos[m * 3] = t.x + s.P[j * 2] * 0.05; pos[m * 3 + 2] = t.z + s.P[j * 2 + 1] * 0.05; for (let c = 0; c < 4; c++) b[m * 4 + c] = s.B[j * 4 + c]; m++; } }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, m * 3), 3)); g.setAttribute("iB", new THREE.BufferAttribute(b.subarray(0, m * 4), 4, true));
      const mat = new THREE.ShaderMaterial({ vertexShader: S.TREE_FAR_VERT, fragmentShader: S.TREE_FAR_FRAG, uniforms: { ...common(), ...treeShared, uSp: sp.uni.uSp, uCa: sp.uni.uCa, uCb: sp.uni.uCb }, defines: { CITY_DAY: "" } });
      const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = -57; group.add(pts); treeOwn.push(g, mat); trees.points += m;
    });
    state.trees.points = trees.points;
    // the programs are built on three's parallel compile, then the trees grow in
    const proxies = species.map((sp) => { const m = new THREE.Mesh(sp.geos[2], sp.mat); m.frustumCulled = false; m.visible = true; const g = new THREE.InstancedBufferGeometry(); g.index = sp.geos[2].index; for (const k of ["position", "normal", "aT"]) g.setAttribute(k, sp.geos[2].attributes[k]); g.setAttribute("iP", new THREE.InstancedBufferAttribute(new Int16Array(2), 2)); g.setAttribute("iB", new THREE.InstancedBufferAttribute(new Uint8Array(4), 4, true)); g.instanceCount = 0; m.geometry = g; treeOwn.push(g); group.add(m); return m; });
    group.visible = true; const tgt = composer ? composer.inputBuffer : null;
    let pr = null; try { renderer.setRenderTarget(tgt); pr = renderer.compileAsync(group, camera, scene); renderer.setRenderTarget(null); } catch (e) { renderer.setRenderTarget(null); }
    group.visible = false;
    Promise.resolve(pr).catch(() => {}).then(() => { if (disposed) return; proxies.forEach((m) => group.remove(m)); trees.ready = true; treeGrowFrom = performance.now(); mark("trees-ready"); treesLight(); wake(1200); });
  }
  /* by the day: visible only while the day's look has a share; they shrink away through twilight. The ground's painted canopy gives way near by once they are up */
  function treesLight() {
    if (!trees || !trees.ready) return;
    const m = U.uMix.value, grow = clamp((performance.now() - treeGrowFrom) / 800, 0, 1), g = grow * grow * (3 - 2 * grow), R = treeTier().r[2];
    trees.group.visible = m > 0;
    treeShared.uTreeRange.value.set(R, g * smooth(0, 1, m));
    U.uTreeR.value.set(lerp(-2, R * 0.12, g), lerp(-1, R * 0.72, g));
  }
  function treesFrame(now) {
    if (!trees.ready) return;
    if (now - treeGrowFrom < 900) { treesLight(); dirty = true; wake(200); }
    if (!trees.group.visible) return;
    const pxr = renderer.getPixelRatio(); treeShared.uFar.value.set(clamp(cfg.home.dist * 1.9, 5000, 30000), renderer.domElement.height / (2 * Math.tan(camera.fov * DEG / 2)), 1.6 * pxr, 14 * pxr);
    const cp = camera.position, TT = treeTier(), [r0, r1, R] = TT.r, thin = TT.thin, sh = TT.sh && shGroup && shGroup.visible ? TT.sh : 0; let tris = 0, drawn = 0, calls = 0;
    for (const t of trees.tiles) {
      const d = Math.max(0, Math.hypot(cp.x - t.x, cp.y, cp.z - t.z) - t.r);
      t.sp.forEach((s, i) => {
        if (!s) return;
        const frac = d >= R ? 0 : Math.min(1, (1 - d / R) / 0.72) * thin, count = Math.ceil(s.n * frac);
        if (!count) { if (s.mesh) s.mesh.visible = false; if (s.sh) s.sh.visible = false; return; }
        const sp = trees.species[i], lod = d < r0 ? 0 : d < r1 ? 1 : 2;
        if (!s.mesh) { s.mesh = new THREE.Mesh(treeTileGeo(s, sp, lod, 40), sp.mat); s.mesh.position.set(t.x, 0, t.z); s.mesh.matrixAutoUpdate = false; s.mesh.updateMatrix(); s.mesh.renderOrder = -57; trees.group.add(s.mesh); s.lod = lod; }
        else if (s.lod !== lod) { s.mesh.geometry = treeTileGeo(s, sp, lod, 40); s.lod = lod; }
        s.mesh.visible = true; s.mesh.geometry.instanceCount = count; tris += count * sp.tris[lod]; drawn += count; calls++;
        if (sh && d < sh) {
          if (!s.sh) { const g = treeTileGeo(s, sp, 3, 90), m = new THREE.Mesh(g, treeShadowMat(sp)); m.position.copy(s.mesh.position); m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = -29; shGroup.add(m); s.sh = m; }
          s.sh.visible = true; s.sh.geometry.instanceCount = Math.ceil(s.n * Math.min(1, (1 - d / sh) / 0.72) * thin); calls++;
        } else if (s.sh) s.sh.visible = false;
      });
    }
    trees.tris = tris; trees.drawn = drawn; trees.calls = calls;
  }
  function treeTileGeo(s, sp, lod, pad) {
    if (s.g[lod]) return s.g[lod];
    const base = sp.geos[lod], g = new THREE.InstancedBufferGeometry(); g.index = base.index;
    for (const k of ["position", "normal", "aT"]) g.setAttribute(k, base.attributes[k]);
    g.setAttribute("iP", s.iP); g.setAttribute("iB", s.iB); g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), TREE_TILE * 0.7072 + pad); treeOwn.push(g);
    return (s.g[lod] = g);
  }
  function treeShadowMat(sp) {
    if (sp.shMat) return sp.shMat;
    const u = shMat.uniforms;
    sp.shMat = new THREE.ShaderMaterial({ vertexShader: S.SHADOW_TREE_VERT, fragmentShader: S.SHADOW_FRAG, uniforms: { uShK: u.uShK, uShTint: u.uShTint, uShFade: u.uShFade, uSp: sp.uni.uSp, uTreeRange: treeShared.uTreeRange, uShR: { value: treeTier().sh } },
      transparent: true, depthWrite: false, stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, stencilZPass: THREE.IncrementStencilOp, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, toneMapped: false });
    treeOwn.push(sp.shMat);
    return sp.shMat;
  }
  /* the day's shadows (30 October; SHADOW_VERT in city_shaders.js): the near tiles' walls and roofs drawn a second time, flattened along the sun. No shadow map: one small program and the vertices; the stencil (the composer's own
     buffer, so only with the post stack) lets a pixel be darkened once. A shadow multiplies the ground by the share of its light that is the sky's, a little lightened; they fade from 9 degrees to 3 as the sun gets low, and out
     with distance and fog, sooner on the mid tier. ?shadows=0 is without them (for measuring). */
  const shQ = new URLSearchParams(location.search).get("shadows"), SH_RANGE = { high: [3400, 5200], mid: [2300, 3600] };
  const shTier = (t) => shQ !== "0" && !!SH_RANGE[t];
  function makeShadows() {
    const props = { vertexShader: S.SHADOW_VERT, fragmentShader: S.SHADOW_FRAG, uniforms: { uShK: { value: new THREE.Vector2() }, uShTint: { value: new THREE.Vector3(1, 1, 1) }, uShFade: { value: new THREE.Vector4(3400, 5200, 0, 0) } },
      transparent: true, depthWrite: false, stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, stencilZPass: THREE.IncrementStencilOp, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, toneMapped: false };
    shMat = new THREE.ShaderMaterial(props); const shDeck = new THREE.ShaderMaterial({ ...props, side: THREE.DoubleSide });
    disposables.push(shMat, shDeck);
    shGroup = new THREE.Group(); scene.add(shGroup);
    const part = (g, count, sphere) => { const sg = new THREE.BufferGeometry(); sg.setAttribute("position", g.attributes.position); sg.setIndex(g.index); if (count) sg.setDrawRange(0, count); sg.boundingSphere = sphere; disposables.push(sg); return sg; };
    for (const t of bTiles) {
      const m0 = t.mesh, q = 1 / m0.scale.x, bs = t.g.boundingSphere;
      const m = new THREE.Mesh(part(t.g, t.main, new THREE.Sphere(bs.center, bs.radius + 450 * q)), shMat); m.position.copy(m0.position); m.scale.copy(m0.scale); m.renderOrder = -29; m.matrixAutoUpdate = false; m.updateMatrix(); shGroup.add(m); t.sm = m;
    }
    if (groups.deck) { const d = new THREE.Mesh(part(groups.deck.geometry, 0, null), shDeck); d.frustumCulled = false; d.renderOrder = -29; shGroup.add(d); }
    shGroup.updateMatrixWorld(true);
  }
  function applyShadows() {
    if (!shReady) return;
    const on = !!(sunShadow && sunShadow.strength > 0 && composer && bTiles.length && shTier(tier));
    if (on && !composer.inputBuffer.stencilBuffer) {       // the first day of a page opened at night: the composer's buffers get their stencil now (three makes them again at their next use)
      for (const b of [composer.inputBuffer, composer.outputBuffer]) { b.stencilBuffer = true; b.resolveStencilBuffer = false; b.dispose(); }
      passes.render.clearPass.setClearFlags(true, true, true);
    }
    if (on && !shGroup) makeShadows();
    if (shGroup) shGroup.visible = on;
    state.shadows = on;
    if (!on) return;
    const u = shMat.uniforms, sd = sunShadow.sd, sky = U.uSkyCol.value, up = U.uUpDay.value;
    u.uShK.value.set(sd.x / sd.y, sd.z / sd.y);
    u.uShTint.value.set(sky.x / up.x, sky.y / up.y, sky.z / up.z).lerp(new THREE.Vector3(1, 1, 1), 0.22);
    const rg = SH_RANGE[tier]; u.uShFade.value.set(rg[0], rg[1], U.uFogBase.value * 2, sunShadow.strength * bloomFade);
  }
  async function build() {
    const P = await prepared();
    if (disposed || !P) return;
    city = P; state.prepTimes = P.times;
    updateSun(false);
    mark("decoded");
    bounds = city.meta.keep;
    // ground and its glow (the density map: one byte a texel, bottom row first)
    densTex = new THREE.DataTexture(P.dens.data, P.dens.size, P.dens.size, THREE.RedFormat, THREE.UnsignedByteType); densTex.colorSpace = THREE.NoColorSpace; densTex.minFilter = densTex.magFilter = THREE.LinearFilter; densTex.generateMipmaps = false; densTex.needsUpdate = true; disposables.push(densTex);
    const SIDE = { sea: 1, ice: 2, seaice: 3 }, ob = cfg.outside || {};
    ground = new THREE.Mesh(new THREE.PlaneGeometry(cfg.groundSize || 60000, cfg.groundSize || 60000), mk(S.GROUND_VERT, S.GROUND_FRAG, { uDens: { value: densTex }, uBox: { value: new THREE.Vector4(bounds[0], bounds[1], bounds[2], bounds[3]) }, uWarm: U.uWarm, uLights: U.uLamps,
      uOut: { value: new THREE.Vector4(SIDE[ob.w] || 0, SIDE[ob.s] || 0, SIDE[ob.e] || 0, SIDE[ob.n] || 0) }, uGroundIce: { value: cfg.groundBase === "ice" ? 1 : 0 },
      uGnd: U.uGnd, uPlain: U.uPlain, uTree: U.uTree, uEdge: { value: new THREE.Vector4(cfg.groundSize ? (bounds[0] + bounds[2]) / 2 : 0, cfg.groundSize ? -(bounds[1] + bounds[3]) / 2 : 0, (cfg.groundSize || 60000) / 2, 0.5) } }, { depthTest: true, depthWrite: true }));
    // drawn after the buildings and the areas (30 October): what they cover is never shaded
    ground.rotation.x = -Math.PI / 2; ground.renderOrder = -50; ground.frustumCulled = false;
    if (cfg.groundSize) ground.position.set((bounds[0] + bounds[2]) / 2, 0, -(bounds[1] + bounds[3]) / 2);
    add(ground, "ground");
    await yieldNow(); if (disposed) return;
    // parks, water, aprons
    const ribbonGeo = (rb) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(rb.pos, 3)); g.setAttribute("aR", new THREE.BufferAttribute(rb.aR, 4)); g.setIndex(new THREE.BufferAttribute(rb.idx, 1)); return g; };
    const am = P.areas;
    const ag = new THREE.BufferGeometry(); ag.setAttribute("position", new THREE.BufferAttribute(am.pos, 3)); ag.setAttribute("aKind", new THREE.BufferAttribute(am.kind, 1)); ag.setIndex(new THREE.BufferAttribute(am.idx, 1));
    const amesh = new THREE.Mesh(ag, mk(S.AREA_VERT, S.AREA_FRAG, { uPark: U.uPark, uForest: U.uForest, uField: U.uField, uSand: U.uSand, uWet: U.uWet }, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    amesh.renderOrder = -55; amesh.frustumCulled = false; add(amesh, "areas");
    // roads
    const rmesh = new THREE.Mesh(ribbonGeo(P.roads), mk(S.ROAD_VERT, S.ROAD_FRAG, { uWarm: U.uWarm, uTraffic: U.uTraffic, uLights: U.uLamps, uRoad: U.uRoad }, { transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    rmesh.renderOrder = -30; rmesh.frustumCulled = false; add(rmesh, "roads");
    mark("roads");
    // street lamps
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(P.lamps.pos, 3)); lg.setAttribute("aSeed", new THREE.BufferAttribute(P.lamps.seed, 1));
    const lmat = mk(S.LAMP_VERT, S.LAMP_FRAG, { uScale: { value: 900 }, uGain: U.uLamps }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    lamps3 = new THREE.Points(lg, lmat); lamps3.frustumCulled = false; lamps3.renderOrder = 20; lamps3.visible = lampsOn > 0; add(lamps3, "lamps");
    // the buildings, a mesh per tile (its bounding sphere from the worker); 16-bit vertices placed at the tile's origin and scaled back (city_data.js); drawn first, front to back, so what lies behind
    // them is turned away by the depth test before it is shaded (30 October)
    const bmat = mk(S.BUILDING_VERT, S.BUILDING_FRAG, { uWinGain: U.uWinGain, uLights: U.uLamps, uAlb: U.uAlb, uLod: U.uLod, uWinK: U.uWinK, uProcSame: { value: cfg.procSame ? 1 : 0 }, uWalls: U.uWalls, uRoofs: U.uRoofs, uTower: U.uTower, uBounce: U.uBounce });
    const bgroup = new THREE.Group();
    let k = 0, t0 = performance.now();
    for (const t of P.tiles) {
      const g = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(t.pu, 4);
      g.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute("aU", new THREE.InterleavedBufferAttribute(ib, 1, 3));
      g.setAttribute("aM", new THREE.BufferAttribute(t.mt, 4)); g.setIndex(new THREE.BufferAttribute(t.idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.bs[0], t.bs[1], t.bs[2]), t.bs[3]); disposables.push(g);
      const m = new THREE.Mesh(g, bmat); m.position.set(t.o[0], 0, t.o[1]); m.scale.setScalar(1 / t.q); m.renderOrder = -60; m.matrixAutoUpdate = false; m.updateMatrix(); bgroup.add(m);
      bTiles.push({ g, mesh: m, sm: null, main: t.ipMain, c: new THREE.Vector3(t.o[0] + t.bs[0] / t.q, t.bs[1] / t.q, t.o[1] + t.bs[2] / t.q), r: t.bs[3] / t.q, far: false });
      if (++k % 8 === 0 && performance.now() - t0 > 8) { await yieldNow(); if (disposed) return; t0 = performance.now(); }
    }
    add(bgroup, "buildings");
    state.dbg.bTiles = bTiles; state.dbg.bmat = bmat; state.dbg.disposables = disposables; if (!state.dbg.city) state.dbg.city = () => city;     // the damage layer (city_damage.js) swaps hurt tiles in
    mark("buildings");
    // the elevated metro
    buildMetro(P.metro);
    // heights for hiding labels; the street index for snapping is made from the road lines when it is first asked for (only the author's pinning tool asks)
    hf = heightAt(P.hf);
    mark("heights");
    roadLines = P.roadLines;
    mark("built");
    shReady = true;
    askTrees();
    state.counts = P.counts;
  }

  /* ---------- the metro: a deck on pillars, trains ---------- */
  let trains = [];
  function buildMetro(M) {
    const lines = M.lines;
    const ribbonGeo = (rb) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(rb.pos, 3)); g.setAttribute("aR", new THREE.BufferAttribute(rb.aR, 4)); g.setIndex(new THREE.BufferAttribute(rb.idx, 1)); return g; };
    if (M.deck) {
      const deck = new THREE.Mesh(ribbonGeo(M.deck), mk(S.ROAD_VERT, S.DECK_FRAG, {}, { side: THREE.DoubleSide })); deck.frustumCulled = false; add(deck, "deck");
      // the underside: a darker, narrower band 1.2 m below so the deck has a body
      const under = new THREE.Mesh(ribbonGeo(M.under), mk(S.ROAD_VERT, S.PILLAR_FRAG.replace("varying vec3 vN;", "vec3 vN = vec3(0.0, -1.0, 0.0);"), {}, { side: THREE.DoubleSide })); under.frustumCulled = false; add(under, "deckUnder");
      // pillars every ~30 m
      const spots = M.spots;
      const pg = new THREE.BoxGeometry(1.5, 8, 1.7); pg.translate(0, 4, 0); disposables.push(pg);
      const inst = new THREE.InstancedMesh(pg, mk(S.SOLID_VERT, S.PILLAR_FRAG, {}), spots.length / 3);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < spots.length / 3; i++) { e.set(0, spots[i * 3 + 2], 0); q.setFromEuler(e); m4.compose(new THREE.Vector3(spots[i * 3], 0, -spots[i * 3 + 1]), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(i, m4); }
      inst.frustumCulled = false; add(inst, "pillars");
      // two trains on the longest viaducts (the page only moves them while it is awake)
      const longest = lines.map((l) => ({ l, len: polyLen(l.pts) })).sort((a, b) => b.len - a.len).slice(0, 2);
      const tg = new THREE.BoxGeometry(2.9, 3.6, 66); tg.translate(0, 9.2 + 1.9, 0); disposables.push(tg);
      const tm = mk(S.SOLID_VERT, S.TRAIN_FRAG, { uTrainDir: { value: new THREE.Vector3(0, 0, 1) } });
      longest.forEach((t, i) => { const mesh = new THREE.Mesh(tg, tm); mesh.frustumCulled = false; scene.add(mesh); added.push(mesh); trains.push({ mesh, l: t.l, len: t.len, off: i * 0.37, dir: i ? -1 : 1, cum: cumLen(t.l.pts) }); });
      // the head lights: two small bright points per train
      const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)); hg.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array([1, 1]), 1));
      const hp = new THREE.Points(hg, mk(S.LAMP_VERT, S.LAMP_FRAG, { uScale: { value: 2600 }, uGain: { value: 1 } }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); hp.frustumCulled = false; hp.renderOrder = 21; add(hp, "headLights");
      trains.heads = hp;
    }
    if (M.rail) {
      const m = new THREE.Mesh(ribbonGeo(M.rail), mk(S.ROAD_VERT, S.DECK_FRAG, {}, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); m.frustumCulled = false; add(m, "rail");
    }
  }
  const polyLen = (p) => { let s = 0; for (let i = 0; i < p.length / 2 - 1; i++) s += Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]); return s; };
  const cumLen = (p) => { const c = new Float32Array(p.length / 2); for (let i = 1; i < c.length; i++) c[i] = c[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]); return c; };
  function polyAt(l, cum, s) {
    const n = cum.length; s = clamp(s, 0, cum[n - 1]);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
    return [lerp(l.pts[lo * 2], l.pts[hi * 2], t), lerp(l.pts[lo * 2 + 1], l.pts[hi * 2 + 1], t), l.pts[hi * 2] - l.pts[lo * 2], l.pts[hi * 2 + 1] - l.pts[lo * 2 + 1]];
  }
  function moveTrains(sec) {
    if (!trains.length) return;
    const hp = trains.heads.geometry.attributes.position;
    trains.forEach((t, i) => {
      const run = (sec * 24 + t.off * t.len) % (t.len + 200);        // 24 m/s, loops on the viaduct
      const s = t.dir > 0 ? run : t.len - run;
      const [x, z, dx, dz] = polyAt(t.l, t.cum, s);
      t.mesh.position.set(x, 0, -z);
      const hd = Math.atan2(dx * t.dir, dz * t.dir);
      t.mesh.rotation.set(0, hd, 0);
      t.mesh.material.uniforms.uTrainDir.value.set(Math.sin(hd), 0, Math.cos(hd));
      const lead = polyAt(t.l, t.cum, s + t.dir * 33);
      hp.setXYZ(i, lead[0], 11.2, -lead[1]);
    });
    hp.needsUpdate = true;
  }

  /* ---------- the places: a beam of light each, an HTML mark, faint sector numbers ---------- */
  let places = [], marks = [], beams = null, beamState = null, sectorMarks = [];
  const beamGeo = new THREE.CylinderGeometry(0.5, 2.2, 1, 10, 1, true); beamGeo.translate(0, 0.5, 0); disposables.push(beamGeo);
  const beamMat = mk(S.BEAM_VERT, S.BEAM_FRAG, {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  let placePts = null;
  function setPlaces(list) {
    places = list.map((p) => ({ ...p }));
    for (const m of marks) m.el.remove();
    marks = [];
    if (beams) { scene.remove(beams); beams.dispose(); beams = null; }
    if (placePts) { scene.remove(placePts); placePts.geometry.dispose(); placePts = null; }
    if (places.length) {
      beams = new THREE.InstancedMesh(beamGeo, beamMat, places.length);
      beamState = new Float32Array(places.length);
      beams.geometry = beamGeo.clone(); beams.geometry.setAttribute("aState", new THREE.InstancedBufferAttribute(beamState, 1));
      const m4 = new THREE.Matrix4();
      // a place with `beam: false` (a layer's small mark, such as a wreck an event leaves) has its point on the ground and no beam
      places.forEach((p, i) => { m4.compose(new THREE.Vector3(p.x, 0, -p.n), new THREE.Quaternion(), new THREE.Vector3(1, p.beam === false ? 0.001 : 130, 1)); beams.setMatrixAt(i, m4); });
      beams.frustumCulled = false; beams.renderOrder = 15; scene.add(beams);
      const pg = new THREE.BufferGeometry(), pp = new Float32Array(places.length * 3 * 2), ps = new Float32Array(places.length * 2).fill(1);
      places.forEach((p, i) => { pp.set([p.x, p.beam === false ? 1.5 : 130, -p.n], i * 6); pp.set([p.x, 1.5, -p.n], i * 6 + 3); });
      pg.setAttribute("position", new THREE.BufferAttribute(pp, 3)); pg.setAttribute("aSeed", new THREE.BufferAttribute(ps, 1));
      placePts = new THREE.Points(pg, mk(S.LAMP_VERT, S.LAMP_FRAG, { uScale: { value: 7000 }, uGain: { value: 1 } }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      placePts.frustumCulled = false; placePts.renderOrder = 22; scene.add(placePts);
    }
    places.forEach((p, i) => {
      const el = document.createElement("div"), lab = document.createElement("span"), pt = document.createElement("i");
      el.className = "tl-mark cy-mark" + (p.cls ? " " + p.cls : ""); el.dataset.id = p.id; lab.className = "tl-lab"; lab.textContent = p.name; pt.className = "tl-pt";
      pt.addEventListener("click", () => onSelect(p.id));
      el.append(pt, lab); labels.append(el);
      marks.push({ p, i, el, lab, wx: p.x, wz: -p.n, y: 24, x: -1e9, y2: -1e9, lw: 120, shown: true, hidden: false, side: "r", prio: 2, sx: 0, sy: 0, vis: false });
    });
    order = marks.slice();
    measure(); wake(300);
  }
  // move one place without rebuilding anything (the author's pinning tool drags places; the page itself never calls this)
  function movePlace(id, x, n) {
    const m = marks.find((k) => k.p.id === id); if (!m) return;
    m.p.x = x; m.p.n = n; m.wx = x; m.wz = -n;
    if (beams) { const m4 = new THREE.Matrix4(); m4.compose(new THREE.Vector3(x, 0, -n), new THREE.Quaternion(), new THREE.Vector3(1, 130, 1)); beams.setMatrixAt(m.i, m4); beams.instanceMatrix.needsUpdate = true; }
    if (placePts) { const a = placePts.geometry.attributes.position; a.setXYZ(m.i * 2, x, 130, -n); a.setXYZ(m.i * 2 + 1, x, 1.5, -n); a.needsUpdate = true; }
    wake(300);
  }
  let geoMarks = [], faint = [];
  const rebuildFaint = () => { faint = geoMarks.concat(sectorMarks); };           // the faint labels in order of importance: a geography label first, a sector number gives way to it
  function setSectors(list) {
    for (const s of sectorMarks) s.el.remove();
    sectorMarks = (list || []).map(([n, x, z]) => { const el = document.createElement("span"); el.className = "cy-sec"; el.textContent = String(n); labels.append(el); return { el, wx: x, wz: -z, y: 14, shown: true, w: 22 + 10 * String(n).length, x: 0, y2: 0, lo: cfg.sectorDist[0], hi: cfg.sectorDist[1] }; });
    rebuildFaint();
  }
  // geography labels (a lagoon, a bridge, a district): faint words on the ground, between cfg.labelDist; the words are the page's copy, the positions the city's config
  function setGeoLabels(list) {
    for (const s of geoMarks) s.el.remove();
    geoMarks = (list || []).filter((l) => l && l.text).map((l) => {
      const el = document.createElement("span"); el.className = "cy-sec cy-geo is-" + (l.kind || "place"); el.textContent = l.text; labels.append(el);
      return { el, wx: l.x, wz: -l.n, y: l.kind === "water" ? 2 : 22, shown: true, w: 18 + 8.2 * l.text.length, x: 0, y2: 0, lo: cfg.labelDist[0], hi: cfg.labelDist[1], text: l.text };
    });
    rebuildFaint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) { for (const g of geoMarks) g.w = (g.el.offsetWidth || g.w - 8) + 10; wake(200); } });
  }
  // the tear (once it has opened in the story): a ring on the ground, the story's own size, and a column of light at its middle; dashed where its place is not yet decided
  function setTear(t) {
    for (const o of tearObjs) { scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== beamMat && o.material.dispose) o.material.dispose(); }
    tearObjs = []; tearRing = null; state.tear = t || null; crack = null; state.crack = null; U.uTearC.value.w = 0;
    if (!t) return;
    const R = (t.ringKm || 8) * 500;
    const rg = new THREE.CircleGeometry(R + 500, 96); rg.rotateX(-Math.PI / 2);
    const rm = new THREE.ShaderMaterial({ vertexShader: S.RING_VERT, fragmentShader: S.RING_FRAG, uniforms: { uC: { value: new THREE.Vector2(t.x, -t.n) }, uR: { value: R }, uCol: { value: new THREE.Vector3() }, uDash: { value: t.placed === false ? 1 : 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 });   // pulled in front of the ground and the water, which are drawn with a smaller offset: from tens of kilometres off a ring 3 m above the sea is below the depth buffer's step
    const ring = new THREE.Mesh(rg, rm); rg.translate(t.x, 0, -t.n); ring.position.set(0, 3, 0);      // the geometry carries the ring's place: the shader reads world positions
    ring.frustumCulled = false; ring.renderOrder = 18; scene.add(ring); tearObjs.push(ring); tearRing = ring; colorTear();
    // the column: its own material (not the places' beams), fading with the camera's distance from it and soft at its edges: a beacon from afar, almost gone within a kilometre.
    // A tear whose place is not yet decided has its dashed ring only: no light comes through a tear that is not there
    if (t.placed === false) { wake(300); return; }
    if (t.crack !== false) { makeCrack(t); wake(300); return; }          // the crack in the sky stands in for the column of light
    const cg =new THREE.CylinderGeometry(0.5, 2.2, 1, 32, 1, true); cg.translate(0, 0.5, 0);
    const cm = mk(S.COLUMN_VERT, S.COLUMN_FRAG, { uC: { value: new THREE.Vector2(t.x, -t.n) }, uFade: { value: new THREE.Vector2(450, 2600) }, uGain: { value: 0.62 } },
      { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const col = new THREE.Mesh(cg, cm); col.position.set(t.x, 0, -t.n); col.scale.set(5, 2300, 5);
    col.frustumCulled = false; col.renderOrder = 16; scene.add(col); tearObjs.push(col);
    wake(300);
  }
  /* the tear in the sky (5 November 2026; the author's pick of 4 November): about 2.8 km long, its lower tip 1.5 km up, its face looking down 30 degrees at the city, leaning 20, fixed in the
     air facing where the city's opening view stands; through it the open cosmos (look B), by day and by night. By night it throws a soft violet wash on the city where it looks (uTearC, in the
     city's fog). In a replay it shows from the moment the tear opens (the blackout's moment in its own chapter). A config's tear may set `crack` (its own sizes) or `crack: false` (the column). */
  let crack = null;
  function makeCrack(t) {
    const o = { L: 2800, ratio: 3.6, y0: 1500, pitch: 30, roll: 20, ...(t.crack || {}) };
    let seed = 0; for (const c of String(cfg.id || "x")) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    seed = o.seed || (seed % 90) + 3;
    const sh = S.tearShape(seed, o.L, o.ratio), pr = o.pitch * DEG, rr = o.roll * DEG;
    const hz = Math.sin(HOME.tilt * DEG) * HOME.dist, hh = HOME.heading * DEG;
    const fx = HOME.x - Math.sin(hh) * hz - t.x, fz = -HOME.n + Math.cos(hh) * hz + t.n, fl = Math.hypot(fx, fz) || 1, face = [fx / fl, fz / fl];
    const mat = mk(S.TEAR_VERT, S.TEAR_FRAG, {
      uAnchor: { value: new THREE.Vector3(t.x, 0, -t.n) }, uHalf: { value: new THREE.Vector2(sh.Wmax * 2.6 + 280, o.L / 2 * 1.16 + 140) }, uCy: { value: o.y0 + (o.L / 2) * Math.cos(pr) * Math.cos(rr) },
      uPitch: { value: pr }, uRoll: { value: rr }, uFace: { value: new THREE.Vector2(face[0], face[1]) },
      uP: { value: Array.from({ length: S.TEAR_MAXP }, (_, i) => { const q = sh.poly[Math.min(i, sh.poly.length - 1)]; return new THREE.Vector2(q[0], q[1]); }) },
      uHair: { value: Array.from({ length: S.TEAR_MAXH }, (_, i) => { const h = sh.hair[i] || [0, 0, 0, 0]; return new THREE.Vector4(h[0], h[1], h[2], h[3]); }) },
      uHW: { value: sh.Wmax }, uL: { value: o.L }, uN: { value: Math.min(sh.poly.length, S.TEAR_MAXP) }, uSeed: { value: seed }, uReach: { value: Math.max(0.55 * sh.Wmax + 110, 110) }, uLean: { value: 0.8 }, uShow: { value: 1 },
    }, { transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false; mesh.renderOrder = 22; scene.add(mesh); tearObjs.push(mesh);
    const reach = Math.min(2600, (o.y0 + o.L / 2) * Math.tan(pr));       // the wash falls as a pool on the city where it looks
    const at = t.at != null ? t.at : BLACKOUT && BLACKOUT.ch === (t.ch || 0) ? BLACKOUT.at || 0 : 0;
    crack = { mesh, o, face, ch: t.ch || 0, at, shown: -1, wx: t.x + face[0] * reach, wz: -t.n + face[1] * reach };
    state.crack = { L: o.L, y0: o.y0, pitch: o.pitch, roll: o.roll, seed, face, shown: true };
  }
  function stepCrack() {      // its moment in a replay, and the wash by night; says whether anything changed
    if (!crack) return false;
    const show = !R.chapter || R.chapter > crack.ch || (R.chapter === crack.ch && R.t >= crack.at) ? 1 : 0;
    let changed = false;
    if (show !== crack.shown) {
      // the story view: playing the tear's own chapter, the camera looks up as it opens (unless the reader has taken the camera since Play)
      if (show && crack.shown === 0 && R.playing && R.chapter === crack.ch && lastUser < (R.from || 0)) { lookUp(); state.crack.lookedUp = (state.crack.lookedUp || 0) + 1; }
      crack.shown = show; crack.mesh.visible = !!show; state.crack.shown = !!show; changed = true;
    }
    const w = show ? 0.07 * (1 - U.uDay.value) : 0;
    if (Math.abs(U.uTearC.value.w - w) > 1e-4 || U.uTearC.value.x !== crack.wx) { U.uTearC.value.set(crack.wx, crack.wz, 2700, w); changed = true; }
    return changed;
  }
  // the look-up view: low over the city on the side the crack faces, 7 km out and 700 m up, aimed a little above its lower tip (the story lab's view of 1 November)
  function lookUp() {
    if (disposed || !crack || !state.tear) return false;
    const t = state.tear, ty = crack.o.y0 + 300, h = 700;
    let D = 7000; const max = controls.maxDistance * 0.96; if (Math.hypot(D, h - ty) > max) D = Math.sqrt(Math.max(1, max * max - (h - ty) ** 2));
    const dist = Math.hypot(D, h - ty), tilt = Math.atan2(D, h - ty) / DEG, heading = ((Math.atan2(-crack.face[0], crack.face[1]) / DEG) % 360 + 360) % 360;
    setSelected(""); flyTo({ x: t.x, n: t.n, y: ty, dist, tilt, heading }, 3000);
    return true;
  }
  const measure = () => marks.forEach((m) => { m.lw = m.lab.offsetWidth || 120; });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) { measure(); wake(200); } });

  /* ---------- the trails ---------- */
  const stateArr = Array.from({ length: MAX_PATHS }, () => new THREE.Vector4(0, 0, -1, 0));
  const TU = { uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 3.4 }, uPx: { value: 1 }, uPass: { value: 0 }, uState: { value: stateArr }, uFlow: { value: 1 } };
  const charIndex = () => new Map((data.characters || []).map((c, i) => [c.id, i]));
  function setPaths(list) {
    for (const m of trailMeshes) scene.remove(m);
    trailMeshes = []; if (trailGeo) { trailGeo.dispose(); trailGeo = null; }
    paths = list.slice(0, MAX_PATHS).map((p) => ({ ...p }));
    pathInfo = [];
    if (!paths.length) { rebuildReplay(); return; }
    const ci = charIndex();
    const P = [], PREV = [], NEXT = [], T = [], IDX = [];
    paths.forEach((p, pi) => {
      const pts = p.xy || decodePath(p.pts, data.pathUnit || 0.5), n = pts.length / 2;
      const lane = ((ci.get(p.character) ?? 0) - ((data.characters || []).length - 1) / 2) * 2.4;
      // lateral offset so that trails that share a street run side by side
      const xs = new Float32Array(n), zs = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        xs[i] = pts[i * 2] + -dz * lane; zs[i] = pts[i * 2 + 1] + dx * lane;
      }
      const base = P.length / 3; let along = 0;
      for (let i = 0; i < n; i++) {
        if (i) along += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        for (const s of [-1, 1]) {
          P.push(xs[i], 1.6, -zs[i]); PREV.push(xs[a], 1.6, -zs[a]); NEXT.push(xs[b], 1.6, -zs[b]); T.push(s, along, pi, 0);
        }
      }
      for (let i = 0; i < n - 1; i++) { const a = base + i * 2; IDX.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      pathInfo.push({ p, base, count: n * 2, len: along, xs, zs, color: ci.get(p.character) ?? 0 });
      p.len = along;
    });
    trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3)); trailGeo.setAttribute("aPrev", new THREE.BufferAttribute(new Float32Array(PREV), 3));
    trailGeo.setAttribute("aNext", new THREE.BufferAttribute(new Float32Array(NEXT), 3)); trailGeo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(T), 4));
    trailGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(P.length), 3)); trailGeo.setIndex(IDX);
    trailGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    const pass = (n, width, blend, depthFunc, order) => {
      const m = new THREE.ShaderMaterial({ vertexShader: S.TRAIL_VERT, fragmentShader: S.TRAIL_FRAG, uniforms: { ...common(), uRes: TU.uRes, uPx: TU.uPx, uState: TU.uState, uFlow: TU.uFlow, uWidth: { value: width }, uPass: { value: n } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: blend, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: blend, depthFunc });
      disposables.push(m);
      const mesh = new THREE.Mesh(trailGeo, m); mesh.frustumCulled = false; mesh.renderOrder = order; scene.add(mesh); return mesh;
    };
    trailMeshes = [pass(2, 3.2, THREE.OneMinusSrcAlphaFactor, THREE.GreaterDepth, 30), pass(1, 20, THREE.OneMinusSrcAlphaFactor, THREE.LessEqualDepth, 31), pass(0, 4.6, THREE.OneMinusSrcAlphaFactor, THREE.LessEqualDepth, 32)];
    colorTrails(); rebuildReplay(); wake(300);
  }
  function colorTrails() {
    if (!trailGeo) return;
    const a = trailGeo.attributes.aColor;
    for (const pi of pathInfo) { const c = colors[pi.color % colors.length] || pal.accent; for (let v = pi.base; v < pi.base + pi.count; v++) a.setXYZ(v, c.r * 1.25, c.g * 1.25, c.b * 1.25); }
    a.needsUpdate = true;
  }

  /* ---------- the replay: one chapter's journeys in story order; the others fall away ---------- */
  const R = { chapter: 0, t: 0, playing: false, last: 0, segs: new Map(), dur: 18 };
  let charOn = new Map(), charHover = "", hoverPath = -1;
  function rebuildReplay() {
    R.segs.clear();
    const mine = paths.filter((p) => p.ch === R.chapter);
    const orders = [...new Set(mine.map((p) => p.order))].sort((a, b) => a - b);
    const w = orders.map((o) => Math.max(160, ...mine.filter((p) => p.order === o).map((p) => p.len || 0)));
    const total = w.reduce((a, b) => a + b, 0);
    // a layer may claim the opening seconds of a chapter's replay (an event that happens before the journeys); the journeys then share what is left of it
    const lead = R.chapter ? layers.reduce((s, l) => s + ((l.lead && l.lead(R.chapter)) || 0), 0) : 0;
    R.lead = lead; R.dur = lead + (orders.length ? clamp(total / 80, 8, 30) : 0) || clamp(total / 80, 8, 30);
    const t0 = lead ? lead / R.dur : 0, span = 1 - t0;
    const sum = total || 1, gap = 0.015 * (orders.length - 1);
    let t = t0;
    orders.forEach((o, i) => { const d = (w[i] / sum) * (1 - gap) * span; R.segs.set(o, [t, t + d]); t += d + 0.015 * span; });
    applyTrailState();
  }
  function applyTrailState() {
    paths.forEach((p, i) => {
      const s = stateArr[i], onC = charOn.size ? charOn.get(p.character) !== false : true;
      let vis = onC ? 1 : 0, head = -1, hl = 0;
      if (R.chapter) {
        if (p.ch !== R.chapter) vis = 0;
        else { const seg = R.segs.get(p.order) || [0, 1], q = clamp((R.t - seg[0]) / Math.max(1e-4, seg[1] - seg[0]), 0, 1); if (R.t < seg[0]) vis = 0; head = q >= 1 ? 1e6 : q * (p.len || 0); }
      }
      if (charHover && charOn.get(charHover) !== false) { if (p.character === charHover) hl = 1; else vis *= 0.28; }
      if (hoverPath === i) hl = Math.max(hl, 0.8);
      s.set(vis, hl, head, p.len || 0);
    });
    for (let i = paths.length; i < MAX_PATHS; i++) stateArr[i].set(0, 0, -1, 0);
    TU.uFlow.value = reduced() || R.chapter ? 0 : 1;
  }
  function setT(t, opt = {}) { R.t = clamp(t, 0, 1); applyTrailState(); wake(300); if (!opt.silent) onReplay({ chapter: R.chapter, t: R.t, playing: R.playing }); }
  function setChapter(c) {
    R.chapter = c | 0; R.playing = false; R.t = R.chapter ? 1 : 0; rebuildReplay();
    if (R.chapter) frameChapter(R.chapter);
    onReplay({ chapter: R.chapter, t: R.t, playing: false }); wake(500);
  }
  function play() {
    if (!R.chapter || reduced()) return;
    if (R.t >= 0.999) R.t = 0;
    R.playing = true; R.last = performance.now(); R.from = R.last; applyTrailState(); onReplay({ chapter: R.chapter, t: R.t, playing: true }); wake(1000);
  }
  function pause() { R.playing = false; onReplay({ chapter: R.chapter, t: R.t, playing: false }); }

  /* ---------- camera: poses, flights ---------- */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced(); controls.dampingFactor = 0.09; controls.screenSpacePanning = false; controls.zoomToCursor = true;
  controls.minDistance = cfg.limits.min; controls.maxDistance = cfg.limits.max; controls.maxPolarAngle = 84 * DEG; controls.minPolarAngle = 4 * DEG; controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.7; controls.panSpeed = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  undo.push(() => controls.dispose());
  const view = { ...HOME };
  function poseOf(v) {     // y: the height of the point the view aims at (0, the ground, but for the look-up view)
    const h = v.heading * DEG, t = v.tilt * DEG, hz = Math.sin(t) * v.dist, y0 = v.y || 0;
    return { target: new THREE.Vector3(v.x, y0, -v.n), pos: new THREE.Vector3(v.x - Math.sin(h) * hz, y0 + Math.cos(t) * v.dist, -v.n + Math.cos(h) * hz) };
  }
  // aimed at the ground the camera keeps above 6 degrees from the horizon; aimed into the air (the look-up view) it may look up from below
  function syncLimits() { controls.maxPolarAngle = (controls.target.y > 1 ? 106 : 84) * DEG; }
  function viewOfCamera() {
    const tg = controls.target, d = camera.position.clone().sub(tg), dist = d.length(), hz = Math.hypot(d.x, d.z);
    return { x: tg.x, n: -tg.z, y: tg.y, dist, tilt: Math.atan2(hz, d.y) / DEG, heading: ((Math.atan2(-d.x, d.z) / DEG) % 360 + 360) % 360 };
  }
  function setView(v) { Object.assign(view, { y: 0 }, v); const p = poseOf(view); camera.position.copy(p.pos); controls.target.copy(p.target); camera.lookAt(p.target); syncLimits(); controls.update(); camera.updateMatrixWorld(); wake(SETTLE); }
  let flight = null;
  function flyTo(v, dur, flat) {
    if (dive) endDive(true);        // a flight the reader asks for (a place, a key) ends a dive that is still running
    const a = viewOfCamera(), b = { ...a, y: 0, ...v };        // a view that does not say otherwise aims at the ground
    if (reduced()) { flight = null; setView(b); return; }
    let dh = ((b.heading - a.heading + 540) % 360) - 180;
    const travel = Math.hypot(b.x - a.x, b.n - a.n);
    flight = { t0: performance.now(), dur: dur || clamp(1100 + travel * 0.55 + Math.abs(Math.log(b.dist / a.dist)) * 500, 1100, 3600), a, b, dh, rise: flat ? 0 : clamp(travel * 0.38, 0, 2600) };
    wake(SETTLE);
  }
  function stepFlight(now) {
    const f = flight, t = clamp((now - f.t0) / f.dur, 0, 1), e = ease(t);
    const v = { x: lerp(f.a.x, f.b.x, e), n: lerp(f.a.n, f.b.n, e), y: lerp(f.a.y || 0, f.b.y || 0, e), dist: Math.exp(lerp(Math.log(f.a.dist), Math.log(f.b.dist), e)) + f.rise * Math.sin(Math.PI * e), tilt: lerp(f.a.tilt, f.b.tilt, e), heading: f.a.heading + f.dh * e };
    const p = poseOf(v); camera.position.copy(p.pos); controls.target.copy(p.target); camera.lookAt(p.target);
    if (t >= 1) { flight = null; Object.assign(view, f.b); syncLimits(); controls.update(); return false; }
    return true;
  }
  /* ---------- following a plan: the dive from the globe, the climb back to it (29 October, the seamless entry) ----------
     A plan (app.js divePlan, climbPlan) is a function of the time that the globe follows too: plan.at(now) gives the camera's view in this city's metres ({ x, n, dist, tilt, heading }), the lens (fov),
     the strength of the motion blur and whether the move has arrived. Both renderers ask it for the same instant, so the two pictures match while one fades over the other. While the city is still
     hidden behind the globe (before plan.cityFrom) it draws nothing; a reader's drag, a key or a chosen place ends the dive where it is. */
  let dive = null, ownFov = 46, pendingReady = false, warmed = false, labelsOp = 1;
  const dv = { blur: 0 };
  function follow(plan) { if (disposed || !plan) return; flight = null; dive = plan; state.dive = { kind: plan.kind || "dive", followed: 0, startedAt: Math.round(performance.now()), arrivedAt: 0, phase: "follow" }; wake(SETTLE); }
  function stepDive(now) {
    const p = dive.at(now), ps = poseOf(p.city);
    camera.position.copy(ps.pos); controls.target.copy(ps.target); camera.lookAt(ps.target);
    if (Math.abs(camera.fov - p.fov) > 1e-4) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
    dv.blur = p.blur || 0;
    const lo = clamp(1 - dv.blur / 0.09, 0, 1); if (lo !== labelsOp) { labelsOp = lo; labels.style.opacity = lo < 1 ? lo.toFixed(2) : ""; }      // the names are not blurred: they stand back while the picture is
    if (state.dive) { state.dive.followed++; state.dive.s = Math.round(p.s * 1000) / 1000; }
    if (p.done) endDive(false, p);
  }
  function endDive(interrupted, p) {
    const was = dive; dive = null; dv.blur = 0; labelsOp = 1; labels.style.opacity = "";
    if (camera.fov !== ownFov) { camera.fov = ownFov; camera.updateProjectionMatrix(); }
    Object.assign(view, !interrupted && p ? p.city : viewOfCamera());
    syncLimits(); controls.update();
    if (state.dive) { state.dive.phase = interrupted ? "interrupted" : "arrived"; state.dive.arrivedAt = Math.round(performance.now()); }
    if (was && typeof was.onArrive === "function" && !interrupted) { try { was.onArrive(); } catch (e) {} }
    wake(1500);
  }
  /* the dive's motion blur: the frame just drawn is copied to a texture and smeared towards the middle of the view, as the eye sees a fast move straight ahead; the plan says how strongly (its speed) */
  let blur = null;
  const _dbs = new THREE.Vector2();
  function makeBlur() {
    if (blur) return blur;
    const tex = new THREE.FramebufferTexture(1, 1);
    const mat = new THREE.ShaderMaterial({ vertexShader: S.BLUR_VERT, fragmentShader: S.BLUR_FRAG, uniforms: { uTex: { value: tex }, uAmount: { value: 0 } }, defines: { TAPS: tier === "high" ? 12 : 8 },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(q);
    blur = { tex, mat, q, sc, cam: new THREE.OrthographicCamera(), size: new THREE.Vector2() };
    disposables.push(mat, q.geometry);
    return blur;
  }
  function drawBlur(k) {
    const b = makeBlur();
    renderer.getDrawingBufferSize(_dbs);
    if (!_dbs.equals(b.size)) { b.tex.dispose(); b.tex = new THREE.FramebufferTexture(_dbs.x, _dbs.y); b.mat.uniforms.uTex.value = b.tex; b.size.copy(_dbs); }
    renderer.copyFramebufferToTexture(b.tex);
    b.mat.uniforms.uAmount.value = k; state.blurMax = Math.max(state.blurMax || 0, Math.round(k * 1000) / 1000);
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(b.sc, b.cam); renderer.autoClear = ac;
  }
  /* the geometry goes to the GPU a few meshes a frame, each drawn once into a single pixel, instead of all at once in the first real frame (that upload was the longest stall of the city's opening:
     on the dive it fell in the middle of the globe's move). The programs are built before this, on three's parallel compile. */
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  async function uploadSliced(budget = 6) {
    const items = []; scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.geometry && o !== sky) items.push(o); });
    const UP = 31, mask = camera.layers.mask, vp = new THREE.Vector4(), sc = new THREE.Vector4();
    let i = 0;
    while (i < items.length) {
      await nextFrame(); if (disposed) return;
      const t0 = performance.now();
      renderer.getViewport(vp); renderer.getScissor(sc); const st = renderer.getScissorTest(), ac = renderer.autoClear;
      renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true); renderer.autoClear = false; camera.layers.set(UP);
      do { const o = items[i++], fc = o.frustumCulled; o.frustumCulled = false; o.layers.enable(UP); renderer.render(scene, camera); o.layers.disable(UP); o.frustumCulled = fc; } while (i < items.length && performance.now() - t0 < budget);
      camera.layers.mask = mask; renderer.setViewport(vp); renderer.setScissor(sc); renderer.setScissorTest(st); renderer.autoClear = ac;
      state.uploadSlices = (state.uploadSlices || 0) + 1; state.uploadMaxMs = Math.max(state.uploadMaxMs || 0, Math.round(performance.now() - t0));
    }
  }
  function viewForPlace(p) { return { x: p.x, n: p.n, dist: 380, tilt: 56, heading: (36 + 40 * (p.i % 5) / 4 + view.heading * 0) % 360 }; }
  function frameBox(x0, n0, x1, n1, minDist = 420) {
    const cx = (x0 + x1) / 2, cn = (n0 + n1) / 2, span = Math.max(x1 - x0, (n1 - n0) * 1.25, 160);
    return { x: cx, n: cn, dist: clamp(span * 1.15 + 160, minDist, 5200), tilt: 52, heading: view.heading };
  }
  function frameChapter(c) {
    for (const l of layers) { const v = l.frame && l.frame(c); if (v) { flyTo(v); return; } }   // a layer's own view of the chapter comes first
    const ps = paths.filter((p) => p.ch === c); if (!ps.length) return;
    let x0 = 1e9, n0 = 1e9, x1 = -1e9, n1 = -1e9;
    for (const p of ps) { const pi = pathInfo[paths.indexOf(p)]; if (!pi) continue; for (let i = 0; i < pi.xs.length; i++) { x0 = Math.min(x0, pi.xs[i]); x1 = Math.max(x1, pi.xs[i]); n0 = Math.min(n0, pi.zs[i]); n1 = Math.max(n1, pi.zs[i]); } }
    if (x0 < 1e8) flyTo(frameBox(x0, n0, x1, n1));
  }
  function select(id) {
    const m = marks.find((k) => k.p.id === id); if (!m || disposed) return;
    setSelected(id); flyTo(viewForPlace({ ...m.p, i: m.i }));
  }
  function setSelected(id) {
    state.selected = id || "";
    marks.forEach((m) => { m.el.classList.toggle("is-on", m.p.id === id); if (beamState) beamState[m.i] = m.p.id === id ? 1 : 0; });
    if (beams && beams.geometry.attributes.aState) beams.geometry.attributes.aState.needsUpdate = true;
    order = marks.slice().sort((a, b) => (a.p.id === id ? -1 : b.p.id === id ? 1 : a.prio - b.prio));
    wake(300);
  }
  function home() { if (disposed) return; setSelected(""); flyTo(HOME); }
  function begin() { if (disposed) return; flyTo(HOME, 3600); }           // the descent from the globe starts when the page begins its crossfade
  function ascend() { if (disposed) return; flyTo(HIGH, 2800); }          // and the climb back to it
  const activeLines = (t) => { if (!R.chapter) return []; const out = []; for (const l of layers) if (l.captions) out.push(...l.captions(R.chapter, t * R.dur)); for (const p of paths) if (p.ch === R.chapter) { const seg = R.segs.get(p.order); if (seg && t >= seg[0] - 1e-6 && t <= seg[1] + 0.02 && !out.includes(p.line)) out.push(p.line); } return out.slice(0, 2); };

  /* ---------- sizing ---------- */
  const size = { w: 0, h: 0 };
  let composer = null, passes = {};
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size.w = w; size.h = h;
    renderer.setPixelRatio(dpr()); renderer.setSize(w, h, false);
    ownFov = w / h < 0.9 ? 56 : 46;
    camera.aspect = w / h; if (!dive) camera.fov = ownFov; camera.updateProjectionMatrix();       // while a plan is followed its lens is the plan's (it ends on this one)
    TU.uRes.value.set(w * dpr(), h * dpr()); TU.uPx.value = dpr();
    if (composer) composer.setSize(w, h, false);
    measure(); wake(300);
  }
  const ro = new ResizeObserver(resize); ro.observe(host); undo.push(() => ro.disconnect());

  /* ---------- post: bloom, tone mapping, vignette, grain, antialiasing (pmndrs postprocessing) ----------
     Not part of the first paint: fetched after the first frame (mid and high tiers), its effects fading in over 0.8 s. Since 30 October the strongest tier multisamples (2x) instead of SMAA and the mid
     tier keeps SMAA; no occlusion pass (n8ao), the building shader darkens the walls' feet; less grain and vignette, a tighter bloom (NOTES.md, "Sharper buildings"; cfg.aoRange is not read any
     more). ?msaa=0|2|4|8 overrides the multisampling, for measuring only. */
  const FADE_MS = 800;
  let postFrom = 0, govHold = 0;       // govHold: the governor takes no measure while programs are being built (a first frame's time says nothing of the next)
  const msaaQ = new URLSearchParams(location.search).get("msaa");
  const samplesFor = (t) => (msaaQ != null && /^[0-8]$/.test(msaaQ) ? +msaaQ : t === "high" ? 2 : 0);
  async function setupPost() {
    if (disposed || tier === "low" || composer) return;
    mark("post-start");
    try {
      const PP = await import("postprocessing");
      // the stack takes over only when the view is at rest (the opening flight is over): building its programs is a stall, and a stall in a flight would be seen
      for (let i = 0; i < 40 && !disposed && (flight || dive || dragging); i++) await new Promise((r) => setTimeout(r, 200));
      if (disposed || tier === "low") return;
      const gl = renderer.getContext(), maxS = gl.getParameter(gl.MAX_SAMPLES) || 0, samples = Math.min(samplesFor(tier), maxS);
      const comp = new PP.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: samples, stencilBuffer: shTier(tier) && dayOn });
      const rp = new PP.RenderPass(scene, camera); if (shTier(tier) && dayOn) rp.clearPass.setClearFlags(true, true, true);     // the shadows' stencil starts each frame clear
      comp.addPass(rp);
      comp.inputBuffer.resolveStencilBuffer = comp.outputBuffer.resolveStencilBuffer = false;      // nothing reads the stencil afterwards, and resolving a multisampled one costs 3 ms a frame on Direct3D (measured on the GTX 1650 Ti)
      const bloom = new PP.BloomEffect({ intensity: 0, luminanceThreshold: 0.74, luminanceSmoothing: 0.22, mipmapBlur: true, radius: 0.62, levels: 6 });
      const tone = new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.ACES_FILMIC });
      const vig = new PP.VignetteEffect({ offset: 0.3, darkness: 0 });
      const noise = new PP.NoiseEffect({ premultiply: true }); noise.blendMode.opacity.value = 0;
      comp.addPass(new PP.EffectPass(camera, bloom, tone, vig, noise));
      let smaa = null;
      if (!samples) { try { smaa = new PP.SMAAEffect({ preset: PP.SMAAPreset.MEDIUM }); comp.addPass(new PP.EffectPass(camera, smaa)); } catch (e) { smaa = null; } }
      comp.setSize(size.w || host.clientWidth || 1, size.h || host.clientHeight || 1, false);
      // the scene's programs for the composer's float target are not the ones the screen used (no tone mapping, linear output): they are started on three's parallel compile, not on the first frame
      renderer.setRenderTarget(comp.inputBuffer);
      const compiled = renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      await compiled.catch(() => {});
      if (disposed || tier === "low") { comp.dispose(); return; }
      composer = comp; passes = { bloom, tone, vig, noise, smaa, PP, render: rp }; postBloom = bloom;
      state.post = { ao: false, smaa: !!smaa, msaa: samples };
      postFrom = govHold = performance.now(); govHold += 2500; mark("post-ready");
    } catch (e) {
      renderer.setRenderTarget(null);
      composer = null; tier = "low"; state.tier = "low"; state.postError = String(e && e.message || e);
    }
    wake(FADE_MS + 200);
  }
  let bloomFade = 0;
  const meetY = Math.min(HIGH.dist, 1.4 * Math.max(cfg.keep[2] - cfg.keep[0], cfg.keep[3] - cfg.keep[1])) * Math.cos(HIGH.tilt * DEG), altExposure = (y) => U.uAltK.value.set(1, 1, 1).lerp(altTarget, smooth(meetY * 0.35, meetY, y));
  const dayBloom = () => { const W = U.uDay.value, b = postBloom, p = passes; b.intensity = (tier === "high" ? 1.0 : 0.85) * bloomFade * (1 - 0.8 * W); b.luminanceMaterial.threshold = 0.74 + 1.1 * W; if (p && p.vig) { p.vig.darkness = 0.5 * bloomFade * (1 - 0.8 * W); p.noise.blendMode.opacity.value = 0.03 * bloomFade * (1 - 0.7 * W); } };
  const fadeIn = (now) => {                       // the effects arrive gradually, so the picture does not jump when the stack takes over from the plain path
    const k = clamp((now - postFrom) / FADE_MS, 0, 1), e = k * k * (3 - 2 * k), p = passes;
    bloomFade = e; dayBloom(); applyShadows();
    return k < 1;
  };
  function downgrade(why) {
    if (disposed || tier === "low") { if (dprScale > 0.55) { dprScale = Math.max(0.55, dprScale - 0.2); size.w = 0; resize(); state.downgrades = (state.downgrades || []).concat([`resolution ${dprScale.toFixed(2)}: ${why}`]); } return; }
    const to = tier === "high" ? "mid" : "low";
    state.downgrades = (state.downgrades || []).concat([`${tier}->${to}: ${why}`]);
    if (to === "mid" && composer && composer.multisampling > 0) {      // the mid tier's antialiasing: SMAA, not the multisampled target
      composer.multisampling = 0;
      try { const sm = new passes.PP.SMAAEffect({ preset: passes.PP.SMAAPreset.MEDIUM }); composer.addPass(new passes.PP.EffectPass(camera, sm)); passes.smaa = sm; if (state.post) { state.post.smaa = true; state.post.msaa = 0; } } catch (e) {}
    }
    if (to === "low" && composer) { composer.dispose(); composer = null; postBloom = null; }
    tier = to; state.tier = to; renderer.setPixelRatio(dpr()); size.w = 0; resize(); applyShadows(); treesLight();
    for (const m of disposables) if (m.isShaderMaterial) m.needsUpdate = true;
    wake(500);
  }

  /* ---------- labels ----------
     A mark is a point (always drawn) and a label that stands on one of four sides of it: right, left, above, below. Each frame the labels are placed in order of importance (the chosen place first, then
     the story's order): a label takes its last side if that is free, else the first side where its box meets no label already placed, no other mark's point and no edge of the map, and a label with no free side is
     hidden (its point stays, and it comes back when the view opens up). The faint sector numbers come last and give way to everything. A label is also hidden when a taller building stands between the camera and
     its place (a 6 m height-field raster of the buildings, a ray march). */
  let order = [];
  const _v = new THREE.Vector3(), boxes = [], discs = [];
  const occluded = (wx, wy, wz) => {
    if (!hf) return false;
    const cp = camera.position, dx = wx - cp.x, dy = wy - cp.y, dz = wz - cp.z, D = Math.hypot(dx, dz);
    if (D < 30) return false;
    const steps = Math.min(120, Math.ceil(D / 11));
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = cp.x + dx * t, z = cp.z + dz * t, y = cp.y + dy * t;
      if (D * (1 - t) < 22) break;
      if (hf.at(x, -z) > y + 0.5) return true;
    }
    return false;
  };
  const SIDES = ["r", "l", "t", "b"], LAB_H = 24, GAP = 6;
  // the box a label of width w takes on a side of the point (x, y), in the map's pixels: the same offsets the stylesheet gives .tl-lab and its side classes
  const labelBox = (side, x, y, w) => side === "r" ? [x + 12, y - 12, x + 15 + w, y + 12] : side === "l" ? [x - 15 - w, y - 12, x - 12, y + 12] : side === "t" ? [x - w / 2, y - 38, x + w / 2, y - 14] : [x - w / 2, y + 14, x + w / 2, y + 38];
  const hits = (a, b) => a[0] < b[2] + GAP && a[2] > b[0] - GAP && a[1] < b[3] + 2 && a[3] > b[1] - 2;
  function place() {
    const W = size.w, H = size.h, dist = camera.position.distanceTo(controls.target);
    boxes.length = 0; discs.length = 0;
    const list = order.length ? order : marks;
    for (const m of marks) {     // where every point is this frame, and whether it can be seen at all
      _v.set(m.wx, m.y, m.wz).project(camera);
      m.sx = (_v.x * 0.5 + 0.5) * W; m.sy = (-_v.y * 0.5 + 0.5) * H;
      let show = _v.z < 1 && _v.z > -1 && m.sx > -30 && m.sx < W + 30 && m.sy > -10 && m.sy < H + 20;
      if (show) show = !occluded(m.wx, m.y, m.wz);
      m.vis = show;
      if (show !== m.shown) { m.el.classList.toggle("is-off", !show); m.shown = show; }
      if (show) {
        if (Math.abs(m.sx - m.x) > 0.05 || Math.abs(m.sy - m.y2) > 0.05) { m.el.style.transform = `translate3d(${m.sx.toFixed(1)}px, ${m.sy.toFixed(1)}px, 0)`; m.x = m.sx; m.y2 = m.sy; }
        discs.push(m);
      }
    }
    for (const m of list) {
      if (!m.vis) continue;
      const chosen = m.p.id === state.selected;
      let side = "", box = null;
      for (const s of (m.side && m.side !== "?" ? [m.side, ...SIDES.filter((q) => q !== m.side)] : SIDES)) {
        const b = labelBox(s, m.sx, m.sy, m.lw);
        if (b[0] < 4 || b[2] > W - 4 || b[1] < 4 || b[3] > H - 4) continue;                 // it would leave the map
        let free = true;
        for (const r of boxes) if (hits(b, r)) { free = false; break; }
        if (free) for (const o of discs) if (o !== m && b[0] < o.sx + 11 && b[2] > o.sx - 11 && b[1] < o.sy + 11 && b[3] > o.sy - 11) { free = false; break; }
        if (free) { side = s; box = b; break; }
      }
      if (!box && chosen) { side = m.side || "r"; box = labelBox(side, m.sx, m.sy, m.lw); }      // the chosen place always names itself
      const hide = !box;
      if (box && side !== m.side) { m.el.classList.toggle("is-left", side === "l"); m.el.classList.toggle("is-top", side === "t"); m.el.classList.toggle("is-bot", side === "b"); m.side = side; }
      if (hide !== m.hidden) { m.el.classList.toggle("no-lab", hide); m.hidden = hide; }
      if (box) boxes.push(box);
    }
    for (const s of faint) {
      _v.set(s.wx, s.y, s.wz).project(camera);
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      let show = dist > s.lo && dist < s.hi && _v.z < 1 && _v.z > -1 && x > 14 && x < W - 14 && y > 14 && y < H - 14;
      if (show) { const b = [x - s.w / 2, y - 12, x + s.w / 2, y + 12]; for (const r of boxes) if (hits(b, r)) { show = false; break; } if (show) for (const o of discs) if (b[0] < o.sx + 11 && b[2] > o.sx - 11 && b[1] < o.sy + 11 && b[3] > o.sy - 11) { show = false; break; } if (show && s.text) boxes.push(b); }
      if (show !== s.shown) { s.el.style.visibility = show ? "visible" : "hidden"; s.shown = show; }
      if (show) s.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /* ---------- pointer: hovering a trail, tapping a trail ---------- */
  let ptr = { x: 0, y: 0, down: false, moved: false, sx: 0, sy: 0 }, ptrDirty = false;
  const _p3 = new THREE.Vector3();
  function nearestPath(cx, cy) {
    if (!pathInfo.length) return -1;
    let best = -1, bd = 14 * 14;
    const r = canvas.getBoundingClientRect(), W = r.width, H = r.height;
    pathInfo.forEach((pi, i) => {
      if (stateArr[i].x < 0.3) return;
      let px = 0, py = 0, pok = false;
      for (let k = 0; k < pi.xs.length; k += 1) {
        _p3.set(pi.xs[k], 1.6, -pi.zs[k]).project(camera);
        const x = (_p3.x * 0.5 + 0.5) * W + r.left, y = (-_p3.y * 0.5 + 0.5) * H + r.top, ok = _p3.z < 1 && _p3.z > -1;
        if (ok && pok) {
          const dx = x - px, dy = y - py, L2 = dx * dx + dy * dy, t = L2 < 1e-6 ? 0 : clamp(((cx - px) * dx + (cy - py) * dy) / L2, 0, 1), qx = px + dx * t, qy = py + dy * t, d = (cx - qx) ** 2 + (cy - qy) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        px = x; py = y; pok = ok;
      }
    });
    return best;
  }
  on(canvas, "pointerdown", (e) => { ptr.down = true; ptr.moved = false; ptr.sx = e.clientX; ptr.sy = e.clientY; wake(800); }, { passive: true });
  on(canvas, "pointermove", (e) => {
    if (ptr.down) { if (Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) > 5) ptr.moved = true; return; }
    if (e.pointerType === "touch") return;
    ptr.x = e.clientX; ptr.y = e.clientY; if (!ptrDirty) { ptrDirty = true; requestAnimationFrame(() => { ptrDirty = false; if (disposed) return; const i = nearestPath(ptr.x, ptr.y); if (i !== hoverPath) { hoverPath = i; canvas.style.cursor = i >= 0 ? "pointer" : ""; applyTrailState(); onHover(i >= 0 ? paths[i].character : "", i >= 0 ? paths[i] : null); wake(250); } }); }
  }, { passive: true });
  on(canvas, "pointerleave", () => { if (hoverPath >= 0) { hoverPath = -1; canvas.style.cursor = ""; applyTrailState(); onHover("", null); wake(250); } });
  on(window, "pointerup", (e) => {
    const was = ptr.down; ptr.down = false;
    if (was && !ptr.moved && e.target === canvas) { const i = nearestPath(e.clientX, e.clientY); if (i >= 0) onPickTrail(paths[i]); }
  });
  /* ---------- the keyboard: the map takes the keys only while it has the focus (Tab reaches it, Tab leaves it; the page's own keys are untouched) ---------- */
  function nudge(dx, dn, dHeading, dTilt, zoom) {
    const base = flight ? flight.b : viewOfCamera(), h = base.heading * DEG, step = base.dist * 0.14;
    const b = { ...base, x: base.x + (dx * Math.cos(h) + dn * Math.sin(h)) * step, n: base.n + (dn * Math.cos(h) - dx * Math.sin(h)) * step,
      heading: (base.heading + dHeading + 360) % 360, tilt: clamp(base.tilt + dTilt, 4, (base.y || 0) > 1 ? 106 : 84), dist: clamp(base.dist * zoom, controls.minDistance, controls.maxDistance) };
    b.x = clamp(b.x, bounds[0], bounds[2]); b.n = clamp(b.n, bounds[1], bounds[3]);
    flyTo(b, 240, true);
  }
  on(canvas, "keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;       // the browser's own shortcuts (zoom, back, find) are not ours
    const k = e.key, sh = e.shiftKey; let used = true;
    if (k === "ArrowLeft") (sh ? nudge(0, 0, -14, 0, 1) : nudge(-1, 0, 0, 0, 1));
    else if (k === "ArrowRight") (sh ? nudge(0, 0, 14, 0, 1) : nudge(1, 0, 0, 0, 1));
    else if (k === "ArrowUp") (sh ? nudge(0, 0, 0, -6, 1) : nudge(0, 1, 0, 0, 1));
    else if (k === "ArrowDown") (sh ? nudge(0, 0, 0, 6, 1) : nudge(0, -1, 0, 0, 1));
    else if (k === "+" || k === "=" || k === "PageUp") nudge(0, 0, 0, 0, 0.78);
    else if (k === "-" || k === "_" || k === "PageDown") nudge(0, 0, 0, 0, 1.28);
    else if (k === "Home" || k === "0") home();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  });
  on(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
  on(canvas, "webglcontextrestored", () => wake(SETTLE));

  /* ---------- the loop: on demand ---------- */
  const timerGL = renderer.getContext(), timerExt = (() => { try { return timerGL.getExtension("EXT_disjoint_timer_query_webgl2"); } catch (e) { return null; } })();
  let gpuQ = null, gpuMs = 0, gpuSlow = 0, gpuN = 0;     // the GPU's own time for a frame, where the browser can measure it: what the governor trusts when the GPU, not the page, is the limit
  let raf = 0, last = 0, awakeUntil = 0, animUntil = 0, lastChange = 0, dragging = false, inView = true, dirty = true, frameMs = 16, slow = 0, lastDraw = 0, fpsN = 0, fpsT = 0;
  const frameHooks = new Set();
  function wake(ms = SETTLE) { if (disposed) return; dirty = true; awakeUntil = Math.max(awakeUntil, performance.now() + ms); if (!reduced()) animUntil = Math.max(animUntil, performance.now() + AMBIENT); schedule(); }
  function schedule() { if (!raf && !disposed && !asleep && inView && !document.hidden) raf = requestAnimationFrame(tick); }
  // a city the globe has faded over (the climb back): it draws nothing more until it is taken down, which the page leaves until the move has arrived
  let asleep = false;
  function sleep() { asleep = true; dive = null; flight = null; R.playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; state.asleep = true; }
  function tick(now) {
    raf = 0; if (disposed) return;
    if (!state.ready) { last = 0; return; }        // nothing is drawn until the city is made, its programs built and its geometry uploaded: a frame of half a city linked each new program there and then (29 October)
    const t0 = performance.now();
    const dt = last ? clamp((now - last) / 1000, 0.001, 0.1) : 0.016; last = now;
    const animating = !reduced() && now < animUntil;
    const busy = !!flight || !!dive || dragging || R.playing || now < awakeUntil;
    // a calm 30 fps while only the ambient life runs
    if (!busy && animating && now - lastDraw < 30) { schedule(); return; }
    // following a plan while the city is still hidden behind the globe: the camera keeps to the plan, nothing is drawn (the first frame at the plan's pose has been, so nothing is left to upload)
    if (dive && warmed && !(now >= (dive.cityFrom == null ? Infinity : dive.cityFrom))) { stepDive(now); state.why.dive++; schedule(); return; }
    lastDraw = now; state.frames++;
    if (dive) { stepDive(now); dirty = true; } else if (flight) stepFlight(now);
    if (R.playing) { R.t = clamp(R.t + dt / R.dur, 0, 1); applyTrailState(); if (R.t >= 1) { R.playing = false; } onReplay({ chapter: R.chapter, t: R.t, playing: R.playing }); dirty = true; }
    if (!flight && !dive) controls.update();
    // near and far follow the camera: depth precision stays good from a street to the whole city
    const cd = camera.position.distanceTo(controls.target), h = Math.max(camera.position.y, 8);
    const near = clamp(Math.min(cd, h) * 0.04, 1.2, 40);
    if (Math.abs(near - camera.near) > 0.3) { camera.near = near; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (stepCrack()) dirty = true;     // first, so a layer sees the tear as this frame has it (a figure that waits for the tear, 5 November)
    for (const l of layers) if (l.step && l.step(now, dt, cd)) dirty = true;     // the layers move with the replay (and say when they changed something)
    // the city's lights: a layer's event asks for its own (mood.want, the blackout of its night), else the story's blackout from its chapter on (the chapter being replayed, or else the reader's), else the
    // usual city. They go out, or come back, over about a second, so stepping from the chapter before the attack to the one after it shows the power going
    const bc = R.chapter || opts.reached || 0, out = BLACKOUT && (bc > BLACKOUT.ch || (bc === BLACKOUT.ch && (!R.chapter || R.t >= (BLACKOUT.at != null ? BLACKOUT.at : 0))));   // within its own chapter, once the replay reaches the attack
    const want = mood.want || (out ? BLACKOUT : null);
    const tw = want && want.windows != null ? want.windows : 1;
    if (Math.abs(mood.windows - tw) > 0.004) { mood.windows += (tw - mood.windows) * (reduced() ? 1 : 1 - Math.exp(-dt * 2.5)); dirty = true; wake(120); } else mood.windows = tw;
    const tl = want ? (want.lights != null ? want.lights : 0) : 1;       // the street lamps, the sodium on the roads and the city's glow on the ground: out whenever the night is dark
    if (Math.abs(mood.lights - tl) > 0.004) { mood.lights += (tl - mood.lights) * (reduced() ? 1 : 1 - Math.exp(-dt * 2.5)); dirty = true; wake(120); } else mood.lights = tl;
    mood.traffic = want && want.traffic != null ? want.traffic : 1; mood.trains = want && want.trains != null ? want.trains : 1;
    U.uAnim.value = animating ? 1 : 0; U.uTraffic.value = animating && mood.traffic > 0.5 ? 1 : 0; U.uWinGain.value = mood.windows; U.uLights.value = mood.lights; U.uLamps.value = mood.lights * lampsOn; U.uFogCam.value = Math.exp(-U.uFogK.value * camera.position.y); if (dayOn) altExposure(camera.position.y);
    if (trains.length && trains[0].mesh.visible !== mood.trains > 0.5) { for (const t of trains) t.mesh.visible = mood.trains > 0.5; trains.heads.visible = mood.trains > 0.5; }
    if (beams && beams.visible !== mood.beams > 0.5) { beams.visible = mood.beams > 0.5; dirty = true; }
    if (animating || R.playing) { U.uTime.value = now / 1000; moveTrains(now / 1000); dirty = true; }
    if (composer) { if (fadeIn(now)) dirty = true; }
    if (dirty) {
      dirty = false;
      const timed = timerExt && !gpuQ && busy && !dive && (state.renders % 4 === 0);
      let q = null; if (timed) { q = timerGL.createQuery(); timerGL.beginQuery(timerExt.TIME_ELAPSED_EXT, q); }
      lipRanges(); if (trees) treesFrame(now);
      if (composer) composer.render(dt); else renderer.render(scene, camera);
      if (dv.blur > 0.004) drawBlur(dv.blur);
      if (timed) { timerGL.endQuery(timerExt.TIME_ELAPSED_EXT); gpuQ = q; }
      state.renders++; place(); frameHooks.forEach((f) => f());
      state.ms += (performance.now() - t0 - state.ms) * 0.1;
      if (pendingReady) { pendingReady = false; warmed = true; mark("first-frame"); queueMicrotask(() => { if (!disposed) onReady(); }); }   // a plan's city says it is ready once its first frame is drawn (nothing then is left to upload)
    }
    if (gpuQ && timerGL.getQueryParameter(gpuQ, timerGL.QUERY_RESULT_AVAILABLE)) {
      if (!timerGL.getParameter(timerExt.GPU_DISJOINT_EXT) && now > govHold) { const ms = timerGL.getQueryParameter(gpuQ, timerGL.QUERY_RESULT) / 1e6; gpuMs = gpuN++ ? gpuMs + (ms - gpuMs) * 0.4 : ms; state.gpuMs = Math.round(gpuMs * 10) / 10; if (gpuMs > 24 && !reduced()) { if (ms > 90 || ++gpuSlow >= 2) { gpuSlow = 0; gpuN = 0; downgrade(`${gpuMs.toFixed(0)} ms of GPU time a frame`); } } else { gpuSlow = 0; if (!reduced() && gpuN > 2) resolutionStep(now, gpuMs); } }
      timerGL.deleteQuery(gpuQ); gpuQ = null;
    }
    const why = state.why; if (flight) why.fly++; if (dive) why.dive++; if (dragging) why.drag++; if (now < awakeUntil) why.awake++; if (animating) why.anim++; if (R.playing) why.replay++;
    // the governor: only frames that were asked for in a stretch count
    if (busy && !dive && !reduced() && now > govHold) {
      frameMs += (dt * 1000 - frameMs) * 0.12; fpsN++;
      if (frameMs > 36) slow++; else slow = Math.max(0, slow - 2);
      // where the GPU's own time cannot be read (most phones), long frames lower the resolution a step before they lower the tier
      if (!timerExt) { if (frameMs > 28) { if (++slowRes > 30 && now - resAt > 1500 && dprScale > 0.6) { slowRes = 0; resAt = now; setScale(dprScale - 0.1, `${frameMs.toFixed(0)} ms a frame`); } } else slowRes = 0; }
      if (slow > 50) { slow = 0; downgrade(`${frameMs.toFixed(0)} ms a frame`); }
    }
    if (now - fpsT > 1000) { state.fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
    if (flight || dive || dragging || R.playing || now < awakeUntil || animating || now - lastChange < 160) schedule(); else { last = 0; }
  }
  /* dynamic resolution (29 October): while frames are being driven, a GPU that takes more than 14 ms a frame gets the picture a tenth smaller (down to 0.6 of the tier's resolution), and the
     resolution comes back a step at a time once the GPU has had room for 3 s. A strong GPU (1 to 3 ms here) never reaches it; the tier steps (24 ms, below) are still the bigger lever. */
  let resAt = 0, calmSince = 0, slowRes = 0;
  function resolutionStep(now, g) {
    if (g > 14 && dprScale > 0.6 && now - resAt > 1200) { resAt = now; calmSince = 0; setScale(dprScale - 0.1, `${g.toFixed(1)} ms of GPU time a frame`); }
    else if (g < 6 && dprScale < 1) { if (!calmSince) calmSince = now; else if (now - calmSince > 3000 && now - resAt > 3000) { resAt = now; calmSince = 0; setScale(dprScale + 0.1, "the GPU has room again"); } }
    else calmSince = 0;
  }
  function setScale(v, why) {
    dprScale = clamp(Math.round(v * 100) / 100, 0.55, 1); state.resolution = dprScale;
    state.downgrades = (state.downgrades || []).concat([`resolution ${dprScale.toFixed(2)}: ${why}`]);
    renderer.setPixelRatio(dpr()); size.w = 0; resize(); gpuN = 0; wake(300);
  }
  on(controls, "change", () => { lastChange = performance.now(); dirty = true; schedule(); });
  on(controls, "start", () => { dragging = true; flight = null; if (dive) endDive(true); ptr.down = true; lastUser = performance.now(); wake(SETTLE); });
  on(controls, "end", () => { dragging = false; wake(900); });
  for (const ev of ["wheel", "touchstart", "keydown", "dblclick"]) on(canvas, ev, () => { if (ev === "wheel") { flight = null; if (dive) endDive(true); } if (ev !== "touchstart") lastUser = performance.now(); wake(800); }, { passive: true });
  on(document, "visibilitychange", () => { if (!document.hidden) { updateSun(false); wake(SETTLE); } });
  const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; if (inView) wake(SETTLE); }); io.observe(host); undo.push(() => io.disconnect());
  const safety = setInterval(() => { if (!raf && !disposed && !state.ready) schedule(); }, 1500); undo.push(() => clearInterval(safety));

  /* ---------- generic hooks (used by the page, and by the author's local pinning tool) ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const api = {
    select, home, lookUp, tearUp: () => !!crack, begin, ascend, follow, sleep, activeLines, setChapter, play, pause, setT, flyTo: (v, d) => flyTo(v, d), view: () => viewOfCamera(), following: () => !!dive, frameBox: (a, b, c, d, m) => flyTo(frameBox(a, b, c, d, m)), setSelected, setPlaces, setPaths, movePlace, wake, setTear, setGeoLabels,
    setLight, light: () => state.light, sun: () => state.sun,
    setCharacters(map) { charOn = new Map(map); applyTrailState(); wake(300); },
    hoverCharacter(id) { charHover = id || ""; applyTrailState(); wake(300); },
    focusPath(id) { const i = paths.findIndex((p) => p.id === id); if (i < 0) return; const pi = pathInfo[i]; let x0 = 1e9, n0 = 1e9, x1 = -1e9, n1 = -1e9; for (let k = 0; k < pi.xs.length; k++) { x0 = Math.min(x0, pi.xs[k]); x1 = Math.max(x1, pi.xs[k]); n0 = Math.min(n0, pi.zs[k]); n1 = Math.max(n1, pi.zs[k]); } flyTo(frameBox(x0, n0, x1, n1)); },
    trailStates: () => paths.map((p, i) => ({ id: p.id, character: p.character, ch: p.ch, vis: stateArr[i].x, hl: stateArr[i].y, head: stateArr[i].z, len: stateArr[i].w })),
    replay: () => ({ chapter: R.chapter, t: R.t, playing: R.playing, dur: R.dur }),
    project(x, n, y = 0) { _v.set(x, y, -n).project(camera); const r = canvas.getBoundingClientRect(); return { x: (_v.x * 0.5 + 0.5) * r.width, y: (-_v.y * 0.5 + 0.5) * r.height, visible: _v.z < 1 && _v.z > -1 }; },
    ground(cx, cy) { const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, n: -hit.z } : null; },
    snap: (x, n, r) => { if (!snapStreet && roadLines) snapStreet = streetIndex(unpackLines(roadLines)); return snapStreet ? snapStreet(x, n, r) : null; },
    onFrame(f) { frameHooks.add(f); return () => frameHooks.delete(f); },
    getPaths: () => paths, getPlaces: () => places, canvas, host, THREE, camera, controls, scene,
    get tier() { return tier; },
    layers: () => layers.map((l) => (l.info ? l.info() : {})),
    dispose,
  };

  state.api = api;   // for the tests and for looking at the view from a script
  // what a layer is given: the scene and its shared uniforms (fog, palette), a material maker that fogs like the city's own, the replay, the camera's flights, the city's mood, the tier and the sound
  const layerCtx = () => ({ THREE, S, scene, camera, renderer, controls, canvas, host, labels, U, mk, data, cfg, mood, state, api, size, reduced, wake,
    add: (o) => { scene.add(o); added.push(o); return o; }, tier: () => tier, replay: () => R, reached: () => opts.reached || 0, flyTo: (v, d) => flyTo(v, d), flying: () => !!flight, userAt: () => lastUser,
    sound: typeof opts.sound === "function" ? opts.sound : () => null });
  function mountLayers() {
    Promise.all(layerMods).then((mods) => {
      if (disposed) return;
      for (const m of mods) if (m && typeof m.mount === "function") { try { layers.push(m.mount(layerCtx())); } catch (e) { state.layerError = String(e && e.message || e); } }
      if (!layers.length) return;
      rebuildReplay();
      if (R.chapter) { frameChapter(R.chapter); onReplay({ chapter: R.chapter, t: R.t, playing: R.playing }); }
      wake(600);
    });
  }

  /* ---------- the end: everything made above is taken down ---------- */
  function dispose() {
    if (disposed) return; disposed = true; state.live = false;
    if (raf) cancelAnimationFrame(raf); raf = 0; flight = null; dive = null; R.playing = false;
    for (const l of layers.splice(0)) { try { if (l.dispose) l.dispose(); } catch (e) {} }
    undo.splice(0).reverse().forEach((f) => { try { f(); } catch (e) {} });
    try { for (const o of added) scene.remove(o); if (beams) { beams.geometry.dispose(); beams.dispose(); } if (placePts) placePts.geometry.dispose(); } catch (e) {}
    for (const d of disposables) { try { d.dispose(); } catch (e) {} }
    try { if (composer) composer.dispose(); } catch (e) {}
    try { if (blur) blur.tex.dispose(); } catch (e) {}
    try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
    own();      // only what this module put in the host: a new city may already be there (a city is taken down after the climb that left it)
  }

  /* ---------- go ---------- */
  const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(() => { const go = () => { if (!disposed) fn(); }; if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 250); }));
  resize();
  (async () => {
    try {
      await build();
      if (disposed) return;
      setSectors(city.meta.sectors);
      setGeoLabels(opts.labels || []);
      setTear(data.tear || null);
      setPlaces(data.places || []);
      setPaths(data.paths || []);
      resize();
      if (opts.dive) makeBlur();
      try { await renderer.compileAsync(scene, camera); if (blur) await renderer.compileAsync(blur.sc, blur.cam); } catch (e) {}       // the programs are built on three's parallel compile, not in the first frame (which stalled the page for 0.3 s)
      if (disposed) return;
      mark("compiled");
      await uploadSliced();             // and the geometry goes up a few meshes a frame (29 October)
      if (disposed) return;
      mark("uploaded");
      state.ready = true; mark("ready");
      if (opts.dive) { follow(opts.dive); stepDive(performance.now()); pendingReady = true; }       // the dive from the globe: the camera is on the plan's path from its first frame, and the page hears "ready" once that frame is drawn
      else if (from === "globe") { setView(HIGH); if (!opts.hold) begin(); } else if (opts.intro && !reduced()) { setView({ ...HOME, dist: 2300, tilt: 66, heading: HOME.heading - 24 }); flyTo(HOME, 3400); } else setView(HOME);
      wake(1500);
      if (!opts.dive) onReady();
      // what is not needed for the first picture waits until the dive has arrived: the layers (Dwarka's events) and the post stack, whose building would be a stall in the middle of the move
      const whenStill = (fn) => { const go = () => { if (disposed) return; if (dive) { setTimeout(go, 250); return; } fn(); }; go(); };
      whenStill(() => { if (layerMods.length) mountLayers(); afterPaint(() => { mark("paint"); setupPost(); }); });      // the post stack is not part of the first paint
    } catch (e) {
      if (abort.signal.aborted || disposed) return;
      state.error = String(e && e.message || e); fail("failed");
    }
  })();
  return api;
}
