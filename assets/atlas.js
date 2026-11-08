/* The Seven Tears atlas: the globe (proposal, 28 October 2026).
   An ES module, imported by app.js only when /tears/ opens (its import map: three 0.186.1 and 3d-tiles-renderer 0.5.3 from jsDelivr, in the shell). It streams Cesium World Terrain
   (ion asset 1) with Bing Maps Aerial draped on it (ion asset 2) through NASA-AMMOS 3DTilesRendererJS, with the site's own ion token, darkens and tints the imagery to the site's palette so the
   globe reads as night, and lays the atlas over it: HTML labels, soft glowing regions for the concentrations, a thin atmosphere rim, and the credits ion returns for both assets.
   mount(host, opts) returns { select(id), home(), dispose() }. Everything it makes is undone by dispose(): the render loop, the observers and listeners, the controls, the tiles and their
   plugins, the geometries and materials, the renderer and its WebGL context, the elements it put in the host.
   Rendering is on demand: a frame is drawn only while the camera moves, a fly runs, tiles load or something just changed; then the loop stops until an input or a tile wakes it. */
import * as THREE from "three";
import { TilesRenderer, GlobeControls } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin, TilesFadePlugin, ImageOverlayPlugin, CesiumIonOverlay, UpdateOnChangePlugin } from "3d-tiles-renderer/plugins";

const DEG = Math.PI / 180;
const FOV = 35;                 // vertical field of view, degrees
const MAX_DPR = 1.5;            // the pixel ratio never goes above this
const EARTH_KM = 6371.0088;
const TEAR_LIFT = 400;           // a tear's ring floats this low: it must stay on its place when the camera looks at it from a tilt
const CAP_LIFT = 9000;          // metres: the regions float this far above the ellipsoid, clear of the highest terrain
const SETTLE = 500;             // ms the loop keeps drawing after the last thing that changed
// tile detail: the screen-space error (in device pixels) a tile may have before a finer one is fetched (the quantized-mesh plugin sets its own 2 when ion answers; ours is put back every update).
// 29 October it went from 2 to 3 on a computer (a fly-to cost 1.5 to 2 MB) and to 4.5 on a phone; 30 October it came back down for sharpness (ERR_SHARP, below). ?err=N overrides it, for measuring.
/* 29 October: the detail and the sharpness follow the device (app.js deviceClass, the same class the city gets): a strong computer keeps 3 and a pixel ratio up to 1.5 (as before), a computer with an
   integrated GPU or a slow CPU gets 4 (one half-level coarser) at up to 1.25, a phone 4.5 at up to 1.5 (as before), a weak phone or a very slow device 6 at 1 (a quarter of a phone's tiles). The error is
   in device pixels, so a lower pixel ratio coarsens it again. Without a class from the page (the pinning tool) a phone gets the phone's detail and anything else the strong one. (The numbers in this
   paragraph are 29 October's; 30 October's are ERR_SHARP.) */
/* 30 October: sharper. The imagery is painted into one 256-pixel texture per terrain tile (the overlay plugin's default) from the coarsest Bing level that fills it, and a terrain tile is drawn up to
   about 260 x errorTarget device pixels wide (Cesium's terrain has a geometric error of 1/260 of a tile's width): at detail 3 the imagery was magnified up to three times, which is what made the globe
   soft (seen on the real imagery: northern India, Delhi, the whole globe). Detail 2 on a strong computer (as before 29 October), 3 with an integrated GPU, 3.5 on a phone, 6 kept for the weakest.
   The tiles that cost: while the camera moves fast (a flight, the dive, the climb, a flung globe) the detail is coarser, up to three times the error at full speed (MOVE_ERR, moveK), so the views
   passed through, which are blurred or gone in a moment, are not fetched at full detail (measured on the real imagery: home, the card, the dive into Dwarka cost what they cost at detail 3, 4.6 MB of
   imagery against 4.4, in 508 requests against 542). A 512 texture (?ovres=512) is sharper still but asked for 3.6 times the imagery bytes; not used. */
const ERR_SHARP = { strong: 2, mid: 3, phone: 3.5, low: 6 };
const FAR_ERR = (() => { const q = +(new URLSearchParams(location.search).get("farerr") || 0); return q > 0 ? q : 1.2; })();   // the detail of the whole-globe view (8 November 2026, see tick)
const ERR_BY = ERR_SHARP, DPR_BY = { strong: MAX_DPR, mid: 1.25, phone: MAX_DPR, low: 1 };
const sstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/* ---------- small helpers ---------- */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* the site's colours, read from its tokens (they change with the palette) */
function readPalette() {
  const cs = getComputedStyle(document.documentElement), get = (n, d) => cs.getPropertyValue(n).trim() || d;
  return { accent: new THREE.Color(get("--accent", "#b9a8ff")), bone: new THREE.Color(get("--bone", "#e9e3d8")), ink: new THREE.Color(get("--ink", "#07060b")), grahan: document.documentElement.getAttribute("data-palette") === "grahan" };
}
const srgb = (c) => { const o = {}; c.getRGB(o, THREE.SRGBColorSpace); return new THREE.Vector3(o.r, o.g, o.b); };

/* a field of faint stars behind the globe: one inline SVG, drawn once, no animation */
function starfield(color) {
  const R = rng(2610), c = srgb(color).toArray().map((v) => Math.round(v * 255)).join(",");
  let s = "";
  for (let i = 0; i < 90; i++) { const r = R(); s += `<circle cx="${(R() * 1000).toFixed(0)}" cy="${(R() * 1000).toFixed(0)}" r="${(0.5 + r * r * 1.1).toFixed(2)}" fill="rgb(${c})" opacity="${(0.12 + R() * 0.38).toFixed(2)}"/>`; }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">${s}</svg>`)}")`;
}

/* ion's credits arrive as HTML from a third party: only text, links, images from https and plain wrappers are kept, built into the page with DOM calls */
function credit(html) {
  const out = document.createElement("span");
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");   // an inert document: nothing runs, no image is fetched
  const walk = (from, to) => {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.textContent)); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName.toLowerCase();
      if (t === "a") { const a = document.createElement("a"); const h = n.getAttribute("href") || ""; if (/^https:\/\//i.test(h)) { a.href = h; a.target = "_blank"; a.rel = "noopener"; } walk(n, a); to.appendChild(a); }
      else if (t === "img") { const s = n.getAttribute("src") || ""; if (/^https:\/\//i.test(s)) { const i = document.createElement("img"); i.src = s; i.alt = n.getAttribute("alt") || n.getAttribute("title") || ""; i.decoding = "async"; to.appendChild(i); } }
      else if (["span", "b", "i", "em", "strong", "small", "p", "div"].includes(t)) walk(n, to);
      else if (t === "br") to.appendChild(document.createTextNode(" "));
    }
  };
  walk(doc.body, out);
  return out;
}

export { credit as sanitizeCredit };   // for the tests

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
/* The globe's day look, for a city that has to meet it at the dive's meeting point (30 October). Linear colour, before the canvas's sRGB output. Where the sun is up, a terrain pixel is
     imagery (Bing, linear) desaturated to `saturation` of its colour, times `tint`, times (sky x day + sun x max(0, N.S)), N the terrain's normal and S the sun's direction,
     times mix(1, lowSun, w * w) with w = 1 - smoothstep(-0.02, 0.42, sin(elevation)) (warmer as the sun gets low),
   blended with the night look by `day` (sunAt's: elevation -6 to +6 degrees), plus twilightGlow x 4 day (1 - day). The night look (day 0) is the one approved on 29 October. */
export const GLOBE_DAY = Object.freeze({ tint: [0.92, 0.92, 0.95], sky: 0.26, sun: 0.82, saturation: 0.92, lowSun: [1.0, 0.62, 0.42], twilightGlow: [0.007, 0.0028, 0.0018] });

/* ---------- the regions: a cap on the ellipsoid, soft at the edge, with a thin ring (dashed where the coverage is weak) ---------- */
// (30 October) in daylight a glow adds to bright ground instead of dark: the fill is dimmed by uDayDim.x and the ring by uDayDim.y where the sun is up (the sun's height worked out per pixel, as on the terrain)
const CAP_VERT = `attribute vec2 aPol; varying vec2 vPol; varying vec3 vUp; void main() { vPol = aPol; vUp = mat3(modelMatrix) * position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CAP_FRAG = `
precision highp float;
uniform vec3 uColor; uniform float uFill; uniform float uRing; uniform float uDash; uniform float uSel; uniform float uNear;
uniform vec3 uSunW; uniform float uSunOn; uniform vec2 uDayDim;
varying vec2 vPol; varying vec3 vUp;
void main() {
  float r = vPol.x;
  float w = max(fwidth(r), 1e-4);
  float body = pow(clamp(1.0 - r * r, 0.0, 1.0), 1.25);
  float ring = smoothstep(1.0 - 3.2 * w, 1.0 - 1.6 * w, r) * (1.0 - smoothstep(1.0 - 1.0 * w, 1.0, r));
  float dash = uDash > 0.5 ? step(0.5, fract(vPol.y * 64.0)) : 1.0;
  float day = uSunOn * smoothstep(-0.104528, 0.104528, dot(normalize(vUp * vec3(1.0, 1.0067395, 1.0)), uSunW));
  float a = (body * uFill * uNear * (1.0 - uDayDim.x * day) + ring * uRing * max(uNear, 0.75) * dash * (1.0 - uDayDim.y * day)) * (1.0 + 0.7 * uSel);
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
}`;

function capGeometry(radii, lonDeg, latDeg, radiusKm, lift, ell) {
  // every vertex is placed by its own latitude and longitude (the point at angular distance a and bearing b from the centre), then on the ellipsoid at height `lift`. Until 29 October the
  // centre's up direction was scaled onto the ellipsoid from the earth's middle, which lands at the place's geocentric latitude: a tear's ring sat some 20 km off its marker at mid latitudes
  const K = 24, S = 128, rho = radiusKm / EARTH_KM, lat = latDeg * DEG, lon = lonDeg * DEG, sl = Math.sin(lat), cl = Math.cos(lat);
  const p = new THREE.Vector3();
  const pos = new Float32Array((1 + K * S) * 3), pol = new Float32Array((1 + K * S) * 2), idx = [];
  const put = (i, la, lo, r, az) => {
    ell.getCartographicToPosition(la, lo, lift, p);
    pos.set([p.x, p.y, p.z], i * 3); pol.set([r, az], i * 2);
  };
  put(0, lat, lon, 0, 0);
  for (let k = 1; k <= K; k++) for (let s = 0; s < S; s++) {
    const r = k / K, a = rho * r, b = (s / S) * Math.PI * 2;
    const la = Math.asin(sl * Math.cos(a) + cl * Math.sin(a) * Math.cos(b));
    put(1 + (k - 1) * S + s, la, lon + Math.atan2(Math.sin(b) * Math.sin(a) * cl, Math.cos(a) - sl * Math.sin(la)), r, s / S);
  }
  for (let s = 0; s < S; s++) idx.push(0, 1 + s, 1 + ((s + 1) % S));
  for (let k = 1; k < K; k++) for (let s = 0; s < S; s++) {
    const a = 1 + (k - 1) * S + s, b = 1 + (k - 1) * S + ((s + 1) % S), c = a + S, d = b + S;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aPol", new THREE.BufferAttribute(pol, 2)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ---------- the atmosphere: a thin rim, worked out per pixel from the ray and the ellipsoid, so it needs no geometry and no depth ---------- */
const ATM_VERT = `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const ATM_FRAG = `
precision highp float;
uniform mat4 uInvProj; uniform mat4 uCam; uniform vec3 uCamPos; uniform vec3 uRadii; uniform vec3 uColor; uniform float uStrength;
uniform vec3 uSunW; uniform float uSunOn; uniform vec3 uDayRim; uniform float uDayRimK;
varying vec2 vNdc;
void main() {
  vec4 pv = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCam * vec4(normalize(pv.xyz / pv.w), 0.0)).xyz);
  vec3 S = 1.0 / uRadii;
  vec3 o = uCamPos * S, d = dir * S;
  float A = dot(d, d), B = dot(o, d), C = dot(o, o) - 1.0;
  float disc = B * B - A * C;
  float alt = (length(o) - 1.0) * uRadii.x;
  float a = 0.0;
  vec3 p = o;
  if (disc < 0.0) {
    float t0 = -B / A;
    if (t0 > 0.0) { p = o + d * t0; float h = length(p) - 1.0; a = exp(-h / 0.0085) * 0.85; }
  } else {
    float t = (-B - sqrt(disc)) / A;
    if (t > 0.0) {
      p = o + d * t;
      vec3 n = normalize(p * S);
      float f = 1.0 - clamp(dot(n, -dir), 0.0, 1.0);
      a = pow(f, 3.5) * 0.5 * smoothstep(3.0e5, 3.0e6, alt);
    }
  }
  // (30 October) where the rim's air is in sunlight it turns a pale sky colour; on the night side it keeps the palette's rim
  float day = uSunOn * smoothstep(-0.2, 0.25, dot(normalize(p), uSunW));
  gl_FragColor = vec4(mix(uColor, uDayRim, day), clamp(a * uStrength * mix(1.0, uDayRimK, day), 0.0, 1.0));
}`;

/* ---------- the seamless entry (29 October): one continuous move between the globe and a city (moved here from app.js, which every page loads) ----------
   A plan is one curve in two legs that meet at the city's `high` view (38 km up, nearly straight down). Going down, the globe's leg runs from wherever its camera is to that view, speeding up, and the
   city's leg from there to the city's `home` view, slowing to a stop; coming back up, the other way round. Along both legs the camera's distance from its target changes exponentially with one
   progress s (0 at the start, 1 at the end), so the eye reads a steady rate, and the legs are timed so that the speed at the meeting point is the same from either side: the fastest moment, where the
   motion blur is strongest and one picture fades over the other. Tilt, heading, the point looked at and the lens change only inside a leg, with no jolt where the legs meet. Both renderers ask the plan
   for the same instant (plan.at(now): .geo for the globe, .city in the city's metres), so their pictures stay matched while they cross.
   The gate: the second renderer must be ready (made, uploaded, its first frame drawn) before it is shown. If it is not by the meeting point, the move goes on past it ever more slowly (a power law:
   still moving after seconds, never past a set share of the way) instead of stopping, and once it is ready the rest of the way is re-timed from the speed the camera has then. */
const D2R = Math.PI / 180;
const sst = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const hdiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
// a city's local metres (x east, n north of its origin, as its file is built: equirectangular) to and from longitude and latitude
function cityFrame(B) {
  const g = (B.config && B.config.globe) || {}, o = B.origin && B.origin[0] != null ? B.origin : [g.lat || 0, g.lon || 0];
  const lat0 = +o[0], lon0 = +o[1], p = lat0 * D2R;
  const my = +B.my || 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p), mx = +B.mx || Math.max(1, 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p));
  return { toGeo: (x, n) => [lon0 + x / mx, lat0 + n / my], toLocal: (lon, lat) => [hdiff(lon0, lon) * mx, (lat - lat0) * my] };
}
const unit = (ll) => { const lo = ll[0] * D2R, la = ll[1] * D2R; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
const arcLL = (a, b) => { const p = unit(a), q = unit(b); return Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))); };
function slerpLL(a, b, t) {
  const p = unit(a), q = unit(b), w = arcLL(a, b);
  if (w < 1e-9) return [a[0], a[1]];
  const s0 = Math.sin((1 - t) * w) / Math.sin(w), s1 = Math.sin(t * w) / Math.sin(w), r = [p[0] * s0 + q[0] * s1, p[1] * s0 + q[1] * s1, p[2] * s0 + q[2] * s1];
  return [Math.atan2(r[1], r[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, r[2] / Math.hypot(r[0], r[1], r[2])))) / D2R];
}
// the progress s(t) and its speed, t in seconds: the first leg (t1 s) eases in, starting at a quarter of its arrival speed from the first frame; the second (t2 s) leaves the meeting point at that
// speed and comes to rest (a cubic Hermite: the dive's t2 makes it the plain cubic ease-out, the climb's is longer, so its globe leg speeds up a little more before it slows); `wait` is the share of the
// second leg the move may creep through past the meeting point while the gate is shut
const herm = (u, s0, m0, dur) => { const u2 = u * u, u3 = u2 * u, D = 1 - s0; return [s0 + D * (3 * u2 - 2 * u3) + m0 * (u3 - 2 * u2 + u), u >= 1 ? 0 : (D * (6 * u - 6 * u2) + m0 * (3 * u2 - 4 * u + 1)) / dur]; };
function timeline(sh, t1, t2, wait) {
  const a = 0.25, vA = (2 - a) * sh / t1, m2 = Math.min(vA * t2, 3 * (1 - sh));
  const W = Math.max(0.01, wait * (1 - sh)), tau = 2 * W / (Math.PI * vA);     // the creep: its speed falls off as 1 / (1 + (t / tau)^2), smoothly from the meeting speed, and it never covers more than W
  let tr = -1, sr = 0, vr = 0, dr = 1, m0 = 0;
  const first = (t) => { const u = Math.max(0, t) / t1; return [sh * (a * u + (1 - a) * u * u), sh * (a + 2 * (1 - a) * u) / t1]; };
  const second = (t) => herm(Math.min(1, (t - t1) / t2), sh, m2, t2);
  const hold = (t) => { const x = (t - t1) / tau; return [sh + vA * tau * Math.atan(x), vA / (1 + x * x)]; };
  const late = (t) => herm(Math.min(1, (t - tr) / dr), sr, m0, dr);
  return {
    t1, end: () => (tr < 0 ? Infinity : tr <= t1 ? t1 + t2 : tr + dr),
    at: (t) => (t <= t1 ? first(t) : tr >= 0 && tr <= t1 ? second(t) : tr < 0 || t < tr ? hold(t) : late(t)),
    release(t) { if (tr >= 0) return; tr = Math.max(0, t); if (tr > t1) { [sr, vr] = hold(tr); const D = 1 - sr; dr = Math.min(3.4, Math.max(1.4, 2 * D / Math.max(vr, 1e-4))); m0 = Math.min(vr * dr, 3 * D); } },
  };
}
const BLUR_MAX = 0.16;            // the strongest smear: 16% of the way from a pixel to the middle of the view, at the top speed of a dive
const blurOf = (speed) => Math.min(1, Math.max(0, (speed - 0.9) / 1.6)) * BLUR_MAX;   // speed: the camera's distance changing by e^speed a second
function planBase(t0, tl, speedAt) {
  return { t0, cityFrom: null, onArrive: null, handoff: () => t0 + tl.t1 * 1000, endsAt: () => t0 + Math.min(tl.end(), 60) * 1000, release: (now) => tl.release((now - t0) / 1000), done: (now) => (now - t0) / 1000 >= tl.end(),
    fadeMs: (now) => (speedAt((now - t0) / 1000) > 1 ? 600 : 900) };
}
// from the globe's camera now (globe.pose()) down to the city's home view
// by day the two pictures meet lower (30 October): with the sun up the globe's imagery holds until the city's own box about fills the view, so the fade is not onto the plain beyond the data. Night as it was.
function meetDist(cfg, hi) {
  const k = cfg.keep;
  if (!k || !cfg.globe || sunNight() || sunAt(atlasNow(), cfg.globe.lat, cfg.globe.lon).day <= 0.1) return hi.dist;
  return Math.min(hi.dist, 1.4 * Math.max(k[2] - k[0], k[3] - k[1]));
}
export function divePlan(start, B, box) {
  const F = cityFrame(B), cfg = B.config || {}, hi = cfg.high || { x: 0, n: 0, dist: 38000, tilt: 6, heading: 0 }, ho = cfg.home || hi;
  const fovC = box.w / box.h < 0.9 ? 56 : 46, fov0 = start.fov || 35, d0 = Math.max(start.range, 60), dE = ho.dist;
  const dH = Math.max(dE * 1.5, Math.min(meetDist(cfg, hi), d0 / 1.5));             // the meeting point: the city's high view (by day lower, meetDist), or lower when the globe's camera is already close
  const LA = Math.log(d0 / dH), LB = Math.log(dH / dE), sh = Math.min(0.8, Math.max(0.2, LA / (LA + LB)));
  const hiLL = F.toGeo(hi.x, hi.n), st = [start.lon, start.lat], ang = arcLL(st, hiLL);
  const arc = Math.min(1.2, (ang * 6.371e6) / d0 * 0.6);                               // a long way round the globe rises on the way, as the globe's own flights do
  const T = Math.min(5.4, Math.max(3.4, 0.9 * (LA + LB))) + Math.min(1.5, ang * 3), t1 = T / (1 + 3 * (1 - sh) / (1.75 * sh));
  const tl = timeline(sh, t1, T - t1, 0.45), t0 = performance.now(), dhA = hdiff(start.heading, hi.heading), dhB = hdiff(hi.heading, ho.heading);
  const logd = (s) => (s <= sh ? Math.log(d0) - (s / sh) * LA : Math.log(dH) - ((Math.min(s, 1) - sh) / (1 - sh)) * LB);
  const speed = (s, v) => Math.abs(v) * (s <= sh ? LA / sh : LB / (1 - sh));
  const plan = planBase(t0, tl, (t) => { const [s, v] = tl.at(t); return speed(s, v); });
  return Object.assign(plan, { kind: "dive", fovCity: fovC, holdTiles: dH < hi.dist && dH === meetDist(cfg, hi) ? plan.handoff() - 350 : 0,      // by day: from the fade's start the globe asks for no finer tiles; it is on its way out, low over the city, and they would only cost the city's frames
    at(now) {
      const t = (now - t0) / 1000, [s, v] = tl.at(t), done = t >= tl.end(), d = Math.exp(logd(s)), out = { s, t, fov: fovC, done, blur: done ? 0 : blurOf(speed(s, v)) };
      if (s <= sh) {
        const r = s / sh, k = sst(r), ll = slerpLL(st, hiLL, sst(r / 0.85)), range = d * Math.exp(arc * Math.sin(Math.PI * Math.min(1, r / 0.85))), tilt = start.tilt + (hi.tilt - start.tilt) * k, heading = start.heading + dhA * k;
        const xy = F.toLocal(ll[0], ll[1]);
        out.geo = { lon: ll[0], lat: ll[1], range, tilt, heading }; out.city = { x: xy[0], n: xy[1], dist: range, tilt, heading }; out.fov = fov0 + (fovC - fov0) * sst(r / 0.9);
      } else {
        const k = done ? 1 : sst((s - sh) / (1 - sh)), c = { x: hi.x + (ho.x - hi.x) * k, n: hi.n + (ho.n - hi.n) * k, dist: done ? dE : d, tilt: hi.tilt + (ho.tilt - hi.tilt) * k, heading: hi.heading + dhB * k };
        const ll = F.toGeo(c.x, c.n);
        out.city = c; out.geo = { lon: ll[0], lat: ll[1], range: c.dist, tilt: c.tilt, heading: c.heading };
      }
      return out;
    } });
}
// the whole globe as the globe's own home view frames it (atlas.js homePose: India in the middle, the globe fitted to the view)
function globeHome(box) { const tanV = Math.tan(17.5 * D2R), tanFit = Math.min(tanV, tanV * (box.w / box.h)) * 0.84, R = 6378137; return { lon: 72, lat: 20, range: R / Math.sin(Math.atan(tanFit)) - R, tilt: 0, heading: 0 }; }
// from the city's view now (city.view()) up to the globe's home view: the city's leg climbs to its high view, the globe's leg on to the whole globe; the gate is the globe's tiles at the meeting point
export function climbPlan(from, B, box) {
  const F = cityFrame(B), cfg = B.config || {}, hi = cfg.high || { x: 0, n: 0, dist: 38000, tilt: 6, heading: 0 }, home = globeHome(box);
  const fovC = box.w / box.h < 0.9 ? 56 : 46, d0 = Math.max(from.dist, 30), dH = Math.max(d0 * 1.5, meetDist(cfg, hi)), dE = home.range;
  const LA = Math.log(dH / d0), LB = Math.log(dE / dH), sh = Math.min(0.8, Math.max(0.2, LA / (LA + LB)));
  const hiLL = F.toGeo(hi.x, hi.n), homeLL = [home.lon, home.lat];
  // the city's leg takes 1.9 s whatever its height (most of the climb's distance is the globe's, and the globe needs that time to open), the globe's 2.8 s; the city may not climb more than 15% past
  // its high view while the globe is still opening
  const tl = timeline(sh, 1.9, 2.8, Math.log(1.15) / Math.max(LB, 0.1)), t0 = performance.now(), dhA = hdiff(from.heading, hi.heading), dhB = hdiff(hi.heading, home.heading);
  const logd = (s) => (s <= sh ? Math.log(d0) + (s / sh) * LA : Math.log(dH) + ((Math.min(s, 1) - sh) / (1 - sh)) * LB);
  const speed = (s, v) => Math.abs(v) * (s <= sh ? LA / sh : LB / (1 - sh));
  const plan = planBase(t0, tl, (t) => { const [s, v] = tl.at(t); return speed(s, v); });
  return Object.assign(plan, { kind: "climb", fovCity: fovC,
    meeting: () => ({ lon: hiLL[0], lat: hiLL[1], range: dH, tilt: hi.tilt, heading: hi.heading, fov: fovC }), end: () => ({ ...home, fov: 35 }),
    at(now) {
      const t = (now - t0) / 1000, [s, v] = tl.at(t), done = t >= tl.end(), d = Math.exp(logd(s)), out = { s, t, fov: fovC, done, blur: done ? 0 : blurOf(speed(s, v)) };
      if (s <= sh) {
        const k = sst(s / sh), c = { x: from.x + (hi.x - from.x) * k, n: from.n + (hi.n - from.n) * k, dist: d, tilt: from.tilt + (hi.tilt - from.tilt) * k, heading: from.heading + dhA * k };
        const ll = F.toGeo(c.x, c.n);
        out.city = c; out.geo = { lon: ll[0], lat: ll[1], range: d, tilt: c.tilt, heading: c.heading };
      } else {
        const r = done ? 1 : (s - sh) / (1 - sh), k = sst(r), ll = slerpLL(hiLL, homeLL, sst((r - 0.25) / 0.75)), xy = F.toLocal(ll[0], ll[1]);
        out.geo = { lon: ll[0], lat: ll[1], range: done ? dE : d, tilt: hi.tilt * (1 - k), heading: hi.heading + dhB * k };
        out.city = { x: xy[0], n: xy[1], dist: out.geo.range, tilt: out.geo.tilt, heading: out.geo.heading };
        out.fov = fovC + (35 - fovC) * sst(r / 0.6);
      }
      return out;
    } });
}

/* ================= the globe ================= */
export function mount(host, opts) {
  const { features = [], token = "", onSelect = () => {}, onReady = () => {}, onFirst = () => {}, onFail = () => {}, reduced = () => false } = opts || {};
  const state = window.DVAtlas = { live: true, frames: 0, ready: false, failed: "", selected: "", renders: 0, ms: 0, why: { fly: 0, drag: 0, awake: 0, change: 0, loading: 0 } };   // for the tests: whether the loop runs, and whether it stopped
  const undo = [];           // everything to take off again, in dispose()
  let disposed = false, failed = false;
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); undo.push(() => t.removeEventListener(ev, fn, o)); };

  /* the DOM this module owns inside the host */
  const canvas = document.createElement("canvas");
  canvas.className = "atlas-canvas"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", (opts.copy && opts.copy.globeLabel) || "A globe");
  const labels = document.createElement("div"); labels.className = "atlas-labels"; labels.setAttribute("aria-hidden", "true");
  const credits = document.createElement("div"); credits.className = "atlas-credit";
  const stars = document.createElement("div"); stars.className = "atlas-stars"; stars.setAttribute("aria-hidden", "true");
  let pal = readPalette();
  stars.style.backgroundImage = starfield(pal.bone);
  host.prepend(stars);
  host.append(canvas, labels, credits);

  const fail = (why) => { if (failed || disposed) return; failed = true; state.failed = why; queueMicrotask(() => onFail(why)); };
  const own = () => { for (const el of [stars, canvas, labels, credits]) el.remove(); };

  /* renderer */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });   // the default power preference: a laptop is not woken to its second GPU for a page
  } catch (e) {
    fail("nowebgl");
    return { select() {}, home() {}, dispose() { disposed = true; state.live = false; own(); } };
  }
  const phone0 = matchMedia("(pointer: coarse)").matches;
  const devCls = (opts.device && ERR_BY[opts.device.cls] != null) ? opts.device.cls : phone0 ? "phone" : "strong";
  let dprScale = 1;           // dynamic resolution: lowered a step while the GPU takes too long a frame, raised again when it has room
  const dpr = () => Math.min(window.devicePixelRatio || 1, DPR_BY[devCls]) * dprScale;
  renderer.setPixelRatio(dpr());
  renderer.setClearColor(0x000000, 0);
  renderer.debug.checkShaderErrors = /[?&]glcheck=1/.test(location.search);   // no info-log round trips to the GPU on a program's first use (see city.js); ?glcheck=1 turns them back on

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1.6e8);
  state.cam = camera.position;   // read by the tests
  scene.add(camera);
  // the night's light, as the author approved it: an even fill and a light that rides on the camera (so the relief shades from the viewer's upper left). Since 30 October it is the night side's only
  // light; the day side is lit by the real sun in the terrain's own shader (sunPatch, below), which replaces this light's result there
  const ambient = new THREE.AmbientLight(0xffffff, 0.7), camLight = new THREE.DirectionalLight(0xffffff, 2.3);
  camLight.position.set(-0.7, 0.9, 1); camera.add(ambient, camLight, camLight.target);

  /* the tiles: terrain, with the aerial imagery draped on it, faded in as it arrives */
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId: "1", autoRefreshToken: true }));
  const fadePlugin = new TilesFadePlugin();
  tiles.registerPlugin(fadePlugin);
  tiles.registerPlugin(new UpdateOnChangePlugin());
  const imagery = new CesiumIonOverlay({ assetId: 2, apiToken: token, autoRefreshToken: true });
  /* 7 November 2026: one ion endpoint request per visit. ion counts every request for asset 2's endpoint as a Bing imagery session (1,000 a month on the free Community plan), and the credit
     below used to ask for it a second time; it now reads the overlay's own answer (null if the imagery never came). */
  let epDone = null; const epReady = new Promise((r) => { epDone = r; });
  { const rt = imagery.auth.refreshToken.bind(imagery.auth); imagery.auth.refreshToken = (...a) => rt(...a).then((j) => { epDone(j); return j; }, (err) => { epDone(null); throw err; }); }
  const resq = +(new URLSearchParams(location.search).get("ovres") || 0), RES = resq >= 64 && resq <= 2048 ? Math.round(resq) : 256;
  const overlayPlugin = new ImageOverlayPlugin({ renderer, overlays: [imagery], resolution: RES });
  tiles.registerPlugin(overlayPlugin);
  const errq = +(new URLSearchParams(location.search).get("err") || 0);
  const ERR = errq > 0 ? errq : ERR_BY[devCls], moveq = new URLSearchParams(location.search).get("moverr"), MOVE_ERR = moveq != null && +moveq >= 0 ? +moveq : 2;   // up to three times the error at full speed; ?moverr=N sets the extra (0: none), for measuring
  state.device = { cls: devCls, err: ERR, dprCap: DPR_BY[devCls], given: !!opts.device, overlay: RES };
  tiles.group.rotation.x = -Math.PI / 2;   // ECEF z (the pole) to the world's y
  scene.add(tiles.group);
  const ell = tiles.ellipsoid, radii = ell.radius;
  // Cesium World Terrain's water mask arrives as a roughness map, which makes the sea glossy, and the light that rides on the camera then puts a white sun glint on the water wherever the view
  // lines up with it (a bright disc over the Gujarat coast). The terrain is made fully matte as each tile loads: no specular at all, the relief still shades by the light.
  const matte = (scene) => scene.traverse((o) => {
    for (const m of [].concat((o.isMesh && o.material) || [])) { if (m.roughnessMap) { m.roughnessMap = null; m.needsUpdate = true; } m.roughness = 1; m.metalness = 0; sunPatch(m); }
  });
  /* ---------- the sun on the terrain (30 October) ----------
     Every terrain tile's material gets a few lines at the end of its fragment shader (after the overlay plugin's and the fade plugin's own changes, which it calls first). The night look is left exactly
     as it was (the imagery multiplied by the night tint, lit by the fill and the camera's light); where the sun is up, the imagery itself (the tint divided back out) is lit by the sun from its real
     direction on the terrain's own normals, with a little sky light, and the two are blended through civil twilight (the sun from 6 degrees below the horizon to 6 above, as sunAt's day), with a
     warm band where the sun is on the horizon. The sun's direction is one uniform in world space, shared by every material (and by the regions and the rim): it changes once a minute, never per frame. */
  const L = GLOBE_DAY, sunU = { uSunW: { value: new THREE.Vector3(0, 0, 1) }, uSunOn: { value: 0 }, uNightInv: { value: new THREE.Vector3(1, 1, 1) }, uDayTint: { value: new THREE.Vector3(...L.tint) },
    uDayLight: { value: new THREE.Vector3(L.sky, L.sun, L.saturation) }, uTwi: { value: new THREE.Vector3(...L.lowSun) }, uTwiGlow: { value: new THREE.Vector3(...L.twilightGlow) } };
  const SUN_DECL = "uniform vec3 uSunW; uniform float uSunOn; uniform vec3 uNightInv; uniform vec3 uDayTint; uniform vec3 uDayLight; uniform vec3 uTwi; uniform vec3 uTwiGlow;\n";
  const SUN_FRAG = `
	if ( uSunOn > 0.5 ) {
		vec3 sunWp = cameraPosition - vViewPosition * mat3( viewMatrix );
		float sunMu = dot( normalize( sunWp * vec3( 1.0, 1.0067395, 1.0 ) ), uSunW );
		float sunDay = smoothstep( -0.104528, 0.104528, sunMu );
		if ( sunDay > 0.0 ) {
			vec3 sunRaw = diffuseColor.rgb;
			#ifdef LAYER_COUNT
			#if LAYER_COUNT != 0
			sunRaw = min( sunRaw * uNightInv, vec3( 1.0 ) );
			#endif
			#endif
			float sunLam = max( dot( normal, normalize( mat3( viewMatrix ) * uSunW ) ), 0.0 );
			float sunTw = sunDay * ( 1.0 - sunDay ) * 4.0, sunWarm = 1.0 - smoothstep( -0.02, 0.42, sunMu );
			sunLam = mix( sunLam, max( sunLam, 0.36 * smoothstep( -0.015, 0.05, sunMu ) ), 1.0 - smoothstep( 0.12, 0.5, sunMu ) );   // a low sun still warms the land: its scattered light comes with it (the city's up-light has the same floor)
			sunRaw = mix( vec3( dot( sunRaw, vec3( 0.2126, 0.7152, 0.0722 ) ) ), sunRaw, uDayLight.z );
			vec3 sunCol = sunRaw * uDayTint * ( uDayLight.x * sunDay + uDayLight.y * sunLam ) * mix( vec3( 1.0 ), uTwi, sunWarm * sunWarm );
			outgoingLight = mix( outgoingLight, sunCol, sunDay ) + uTwiGlow * sunTw;
		}
	}
	#include <opaque_fragment>`;
  function sunPatch(m) {
    if (!m || m.userData.dvSun || !m.isMeshStandardMaterial) return;
    m.userData.dvSun = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      if (!/#include <opaque_fragment>/.test(sh.fragmentShader)) return;
      Object.assign(sh.uniforms, sunU);
      sh.fragmentShader = sh.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, (s) => SUN_DECL + s).replace("#include <opaque_fragment>", SUN_FRAG);
    };
    m.customProgramCacheKey = function () { return "dvsun1|" + this.onBeforeCompile.toString(); };   // the plugins may wrap this function again after us; a patched program is never shared with an unpatched one
    m.needsUpdate = true;
  }
  Promise.resolve(imagery.whenReady()).catch(() => { epDone(null); fail("failed"); });

  /* the world group the atlas hangs on: the same rotation, so ellipsoid positions can be used as they are */
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);
  scene.updateMatrixWorld(true);

  /* the regions (concentrations) */
  const caps = [];
  const capDim = { value: new THREE.Vector2(0.65, 0.3) }, capSun = () => ({ uSunW: sunU.uSunW, uSunOn: sunU.uSunOn, uDayDim: capDim });   // the sun's uniforms, shared (see sunPatch)
  for (const f of features) {
    if (f.kind !== "concentration") continue;
    const mat = new THREE.ShaderMaterial({
      vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Vector3() }, uFill: { value: f.uncertain ? 0.2 : f.focus ? 0.62 : 0.4 }, uRing: { value: f.uncertain ? 0.55 : f.focus ? 0.95 : 0.7 }, uDash: { value: f.uncertain ? 1 : 0 }, uSel: { value: 0 }, uNear: { value: 1 }, ...capSun() },
    });
    const mesh = new THREE.Mesh(capGeometry(radii, f.lon, f.lat, f.radius_km, CAP_LIFT, ell), mat);
    mesh.raycast = () => {}; mesh.renderOrder = 2; mesh.frustumCulled = false;
    world.add(mesh); caps.push({ id: f.id, mesh, mat });
  }

  /* the tears (29 October): a city's marker with a tear carries its ring, the story's own size, drawn with the same cap shader as the regions: no fill, a thin ring (dashed where the place is a draft).
     At the globe's scale it is a point; it reads once the camera is within a few hundred kilometres, and on the dive down. */
  state.tears = [];
  for (const f of features) {
    if (f.kind !== "city" || !f.tear) continue;
    const mat = new THREE.ShaderMaterial({
      vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Vector3() }, uFill: { value: 0 }, uRing: { value: 0.95 }, uDash: { value: f.tear.draft ? 1 : 0 }, uSel: { value: 0 }, uNear: { value: 1 }, ...capSun() },
    });
    const mesh = new THREE.Mesh(capGeometry(radii, f.tear.lon != null ? f.tear.lon : f.lon, f.tear.lat != null ? f.tear.lat : f.lat, (f.tear.ringKm || 8) / 2, TEAR_LIFT, ell), mat);
    mesh.raycast = () => {}; mesh.renderOrder = 3; mesh.frustumCulled = false;
    world.add(mesh); caps.push({ id: f.id, mesh, mat }); state.tears.push(f.id);
  }

  /* the atmosphere rim: a full-screen triangle pair drawn last, with the ray-and-ellipsoid maths above */
  const atmMat = new THREE.ShaderMaterial({
    vertexShader: ATM_VERT, fragmentShader: ATM_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    // the polar axis is the world's y after the group's rotation, so the radii are (a, b, a)
    uniforms: { uInvProj: { value: camera.projectionMatrixInverse }, uCam: { value: camera.matrixWorld }, uCamPos: { value: camera.position }, uRadii: { value: new THREE.Vector3(radii.x, radii.z, radii.x) }, uColor: { value: new THREE.Vector3() }, uStrength: { value: 1 },
      uSunW: sunU.uSunW, uSunOn: sunU.uSunOn, uDayRim: { value: new THREE.Vector3(0.56, 0.74, 1.0) }, uDayRimK: { value: 1.1 } },
  });
  const atm = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), atmMat);
  atm.frustumCulled = false; atm.renderOrder = 100; atm.raycast = () => {};
  scene.add(atm);

  /* darkened, tinted, and follows the palette */
  function applyPalette() {
    pal = readPalette();
    const a = pal.accent, k = pal.grahan ? 0.9 : 1;
    // the aerial image is multiplied by this colour: dim, leaning to the accent, so land and sea read as a moonlit grey-violet (Akash) or umber (Grahan)
    imagery.color.setRGB(0.045 + a.r * 0.13 * k, 0.045 + a.g * 0.13 * k, 0.045 + a.b * 0.13 * k);
    sunU.uNightInv.value.set(1 / imagery.color.r, 1 / imagery.color.g, 1 / imagery.color.b);     // the day side divides the night tint back out of the imagery
    const rim = pal.accent.clone().lerp(new THREE.Color(1, 1, 1), 0.3), rgb = srgb(rim);
    atmMat.uniforms.uColor.value.copy(rgb);
    caps.forEach((c) => c.mat.uniforms.uColor.value.copy(srgb(pal.accent.clone().lerp(new THREE.Color(1, 1, 1), 0.12))));
    stars.style.backgroundImage = starfield(pal.bone);
  }
  applyPalette();
  const mo = new MutationObserver(() => { applyPalette(); wake(300); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
  undo.push(() => mo.disconnect());

  /* ---------- the sun's clock (30 October): the reader's own instant (atlasNow), once a minute ----------
     The sun's direction is worked out on the CPU (sunAt) and set in one shared uniform; then one frame is drawn, and only if the globe is on screen (the loop is not kept awake). Every 60 s, at once when
     the page comes back into view, and faster with ?timescale=N (a demo: every 60/N s, at most ten times a second). ?sun=night leaves the sun off: the old night everywhere. */
  const sunOff = sunNight(), sunRate = atlasClockRate(), _sunV = new THREE.Vector3();
  function updateSun(draw) {
    if (disposed) return;
    if (sunOff) { sunU.uSunOn.value = 0; state.sun = { on: false }; return; }
    const at = atlasNow(), s = sunAt(at);
    _sunV.set(s.dirEcef[0], s.dirEcef[1], s.dirEcef[2]).transformDirection(world.matrixWorld);
    sunU.uSunW.value.copy(_sunV); sunU.uSunOn.value = 1;
    state.sun = { on: true, at: at.toISOString(), subLat: Math.round(s.subLat * 1000) / 1000, subLon: Math.round(s.subLon * 1000) / 1000, rate: sunRate, updates: ((state.sun && state.sun.updates) || 0) + 1 };
    if (draw) { dirty = true; schedule(); }
  }
  updateSun(false);
  const sunTimer = setInterval(() => updateSun(true), Math.max(100, Math.min(60000, 60000 / sunRate)));
  undo.push(() => clearInterval(sunTimer));
  on(document, "visibilitychange", () => { if (!document.hidden) updateSun(true); });

  /* camera controls */
  const controls = new GlobeControls(scene, camera, canvas, null);
  state.dbg = { scene, camera, renderer, controls, tiles, sunU, capDim, atmMat, overlayPlugin };   // read by the tests and when something odd shows on the globe (and the sun's uniforms, for tuning its look by hand)
  controls.setEllipsoid(ell, tiles.group);
  controls.enableDamping = !reduced();
  controls.dampingFactor = 0.18;
  controls.minDistance = 1500;
  controls.maxDistance = 2.6e7;
  controls.enableDoubleTapZoom = !reduced();

  /* the marks: HTML over the canvas */
  const R_EQ = radii.x;
  const marks = features.map((f) => {
    const el = document.createElement("div"), lab = document.createElement("span");
    el.className = "tl-mark " + (f.kind === "station" ? "is-station" : f.kind === "city" ? "is-station is-city" + (f.tear ? " is-tear" + (f.tear.draft ? " is-draft" : "") : "") : "is-conc" + (f.focus ? " is-focus" : "") + (f.uncertain ? " is-faint" : ""));
    el.dataset.id = f.id; lab.className = "tl-lab"; lab.textContent = f.name;
    if (f.kind === "station" || f.kind === "city") { const pt = document.createElement("i"); pt.className = "tl-pt"; el.append(pt); pt.addEventListener("click", () => onSelect(f.id)); }
    el.append(lab);
    labels.append(el);
    const pos = new THREE.Vector3(), n = new THREE.Vector3();
    ell.getCartographicToPosition(f.lat * DEG, f.lon * DEG, 0, pos).applyMatrix4(world.matrixWorld);
    ell.getCartographicToNormal(f.lat * DEG, f.lon * DEG, n).transformDirection(world.matrixWorld);
    return { f, id: f.id, el, lab, pos, n, x: -1e9, y: -1e9, shown: true, hidden: false, left: false, lw: 120, kind: f.kind === "city" ? "station" : f.kind, prio: f.focus ? 1 : f.kind === "city" ? 1 : f.kind === "station" ? 2 : 3 };
  });
  const byId = new Map(marks.map((m) => [m.id, m]));
  let order = marks.slice().sort((a, b) => a.prio - b.prio);
  const measure = () => marks.forEach((m) => { m.lw = m.lab.offsetWidth || 120; });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) { measure(); wake(200); } });
  measure();

  /* sizing */
  const size = { w: 0, h: 0 };
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h || (w === size.w && h === size.h)) return;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    tiles.setResolutionFromRenderer(camera, renderer);
    for (const a of aux) tiles.setResolutionFromRenderer(a, renderer);
    measure();
    if (!placed) { placed = true; const s = opts.startAt; if (s && s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); } setPose(s ? lookAtPlace(s.lon, s.lat, s.range, s.tilt, s.heading || 0) : homePose()); }   // a climb from a city opens the globe in the city's lens and heading
    wake(300);
  }
  let placed = false;
  tiles.setCamera(camera);
  const ro = new ResizeObserver(resize); ro.observe(host); undo.push(() => ro.disconnect());

  /* ---------- poses and flights ---------- */
  const _E = new THREE.Vector3(), _N = new THREE.Vector3(), _U = new THREE.Vector3(), _P = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();
  // a camera `range` metres from the surface point (lon, lat), tilted `tilt` degrees from straight down, looking towards `heading` (0 = north up)
  function lookAtPlace(lonDeg, latDeg, range, tilt, heading = 0) {
    const lat = latDeg * DEG, lon = lonDeg * DEG;
    ell.getEastNorthUpAxes(lat, lon, _E, _N, _U);
    ell.getCartographicToPosition(lat, lon, 0, _P);
    const mw = world.matrixWorld;
    _P.applyMatrix4(mw); _E.transformDirection(mw); _N.transformDirection(mw); _U.transformDirection(mw);
    const ct = Math.cos(tilt * DEG), st = Math.sin(tilt * DEG), ch = Math.cos(heading * DEG), sh = Math.sin(heading * DEG);
    _d.copy(_N).multiplyScalar(-ch).addScaledVector(_E, -sh);                      // the way the camera sits off to the side
    const pos = _P.clone().addScaledVector(_U, ct * range).addScaledVector(_d, st * range);
    const up = _N.clone().multiplyScalar(ch).addScaledVector(_E, sh);
    _m.lookAt(pos, _P, up);
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(_m) };
  }
  // the whole globe, centred on India (the story's centre), far enough that it fits the view whatever its shape
  function homePose() {
    const tanV = Math.tan(FOV * DEG / 2), tanH = tanV * camera.aspect, tanFit = Math.min(tanV, tanH) * 0.84;
    const dist = R_EQ / Math.sin(Math.atan(tanFit));
    return lookAtPlace(72, 20, dist - R_EQ, 0);
  }
  function poseFor(f) {
    return f.kind === "city" ? lookAtPlace(f.lon, f.lat, 5.2e5, 14) : f.kind === "station" ? lookAtPlace(f.lon, f.lat, 2.4e6, 16) : lookAtPlace(f.lon, f.lat, Math.max(3.2e6, f.radius_km * 1000 * 4.3), 20);
  }
  function setPose(p) { camera.position.copy(p.pos); camera.quaternion.copy(p.quat); camera.updateMatrixWorld(); wake(SETTLE); }
  /* views whose tiles are fetched beside the camera's own (29 October): a climb back from a city opens the globe at 38 km, and its end (the whole globe) needs coarse tiles a globe that opened down
     there never loaded; a second camera that is never drawn, at that end, has the library fetch them from the start, so the globe is never empty on the way up. Taken away when the move is over. */
  const aux = [];
  function alsoLoad(poses) {
    for (const ps of poses || []) {
      const c = new THREE.PerspectiveCamera(ps.fov || FOV, camera.aspect || 1, 1, 1.6e8), q = lookAtPlace(ps.lon, ps.lat, ps.range, ps.tilt || 0, ps.heading || 0);
      c.position.copy(q.pos); c.quaternion.copy(q.quat); c.updateMatrixWorld(); scene.add(c);
      aux.push(c); tiles.setCamera(c); if (size.w) tiles.setResolutionFromRenderer(c, renderer);
    }
    wake(SETTLE);
  }
  function dropAux() { for (const c of aux.splice(0)) { try { tiles.deleteCamera(c); } catch (e) {} scene.remove(c); } }

  let fly = null;
  const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
  function flyTo(p, dur) {
    if (reduced()) { fly = null; setPose(p); return Promise.resolve(); }          // reduced motion: a jump cut
    if (fly && fly.done) fly.done();
    const p0 = camera.position.clone(), q0 = camera.quaternion.clone(), r0 = p0.length(), r1 = p.pos.length();
    const d0 = p0.clone().normalize(), d1 = p.pos.clone().normalize(), ang = d0.angleTo(d1);
    const rot = new THREE.Quaternion().setFromUnitVectors(d0, d1), arc = clamp(ang * R_EQ * 0.28, 0, 2.4e6);
    let done; const pr = new Promise((r) => { done = r; });
    fly = { t0: performance.now(), dur: dur || clamp(900 + ang * 1500, 900, 2700), p0, q0, r0, r1, d0, rot, arc, q1: p.quat.clone(), done };
    wake(SETTLE);
    return pr;
  }
  function stepFly(now) {
    const t = clamp((now - fly.t0) / fly.dur, 0, 1), e = ease(t);
    _qi.identity(); _q.copy(_qi).slerp(fly.rot, e);
    const dir = fly.d0.clone().applyQuaternion(_q);
    const r = fly.r0 + (fly.r1 - fly.r0) * e + fly.arc * Math.sin(Math.PI * e);
    camera.position.copy(dir.multiplyScalar(r));
    camera.quaternion.copy(fly.q0).slerp(fly.q1, e);
    camera.updateMatrixWorld();
    if (t >= 1) { const d = fly.done; fly = null; if (d) d(); return false; }
    return true;
  }

  /* ---------- selection ---------- */
  function setSelected(id) {
    state.selected = id || "";
    marks.forEach((m) => m.el.classList.toggle("is-on", m.id === id));
    caps.forEach((c) => { c.mat.uniforms.uSel.value = c.id === id ? 1 : 0; });
    order = marks.slice().sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : a.prio - b.prio));
  }
  function select(id) {
    const m = byId.get(id); if (!m || disposed) return;
    setSelected(id); flyTo(poseFor(m.f));
  }
  function home() { if (disposed) return; setSelected(""); flyTo(homePose()); }
  // (29 October) the old dive (a fly to 52 km, then a wait of up to 3.5 s for the picture to settle before the city faded in) is gone: the page's plan drives the camera now (follow, below), and the
  // city takes over at the fastest, most blurred moment, so there is nothing to wait for
  /* ---------- the seamless entry (29 October): the camera as a place, and following a plan ----------
     pose() says where the camera is as the page's plans describe a view: the point of the ground the middle of the view rests on (where its ray meets the ellipsoid, or the point below the camera when it
     looks past the earth), the distance to it, the tilt from straight down, the heading (from the camera's up direction, which also holds when it looks straight down) and the lens. follow(plan) puts the
     camera on the plan's path (app.js divePlan, climbPlan: plan.at(now).geo, the same instant the city asks for), with its lens and motion blur, until the plan arrives or stop() is called; the controls
     rest meanwhile. The first 0.35 s blend from the camera as it was, so a roll the controls left cannot jump. */
  const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(), _S = new THREE.Vector3(1 / radii.x, 1 / radii.y, 1 / radii.z);
  function pose() {
    camera.updateMatrixWorld();
    _inv.copy(world.matrixWorld).invert();
    _o.copy(camera.position).applyMatrix4(_inv);
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion).transformDirection(_inv);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(_inv);
    const os = _o.clone().multiply(_S), ds = _dir.clone().multiply(_S), A = ds.dot(ds), B = os.dot(ds), Cc = os.dot(os) - 1, disc = B * B - A * Cc;
    const p = new THREE.Vector3(), tHit = disc >= 0 ? (-B - Math.sqrt(disc)) / A : -1;
    if (tHit > 0) p.copy(_o).addScaledVector(_dir, tHit);
    else { ell.getPositionToCartographic(_o, _carto); ell.getCartographicToPosition(_carto.lat, _carto.lon, 0, p); }
    ell.getPositionToCartographic(p, _carto);
    ell.getEastNorthUpAxes(_carto.lat, _carto.lon, _E, _N, _U);
    const v = _o.clone().sub(p), range = v.length(), tilt = Math.acos(clamp(v.dot(_U) / Math.max(range, 1e-6), -1, 1)) / DEG;
    const heading = ((Math.atan2(_up.dot(_E), _up.dot(_N)) / DEG) % 360 + 360) % 360;
    return { lon: _carto.lon / DEG, lat: _carto.lat / DEG, range, tilt, heading, fov: camera.fov };
  }
  let plan = null, planT0 = 0, blurK = 0, labelsOp = 1;
  const planP0 = new THREE.Vector3(), planQ0 = new THREE.Quaternion();
  function follow(p) {
    if (disposed || !p) return;
    if (fly && fly.done) fly.done(); fly = null;
    plan = p; planT0 = performance.now(); planP0.copy(camera.position); planQ0.copy(camera.quaternion);
    controls.enabled = false; setSelected("");
    state.follow = { kind: p.kind || "", n: 0, s: 0, startedAt: Math.round(planT0) };
    wake(SETTLE);
  }
  function stop() { if (!plan) return; plan = null; blurK = 0; labelsOp = 1; labels.style.opacity = ""; controls.enabled = true; if (camera.fov !== FOV) { camera.fov = FOV; camera.updateProjectionMatrix(); } wake(SETTLE); }
  function stepPlan(now) {
    const p = plan.at(now), g = p.geo, ps = lookAtPlace(g.lon, g.lat, g.range, g.tilt, g.heading), k = sstep((now - planT0) / 350);
    if (k < 1) { camera.position.copy(planP0).lerp(ps.pos, k); camera.quaternion.copy(planQ0).slerp(ps.quat, k); } else { camera.position.copy(ps.pos); camera.quaternion.copy(ps.quat); }
    // the clip planes, as the controls set them when they are on (they rest while a plan is followed): the far plane past the horizon, the near one a small share of the height. A globe opened at 38 km
    // for a climb kept a far plane fit for 38 km, and the whole earth fell behind it on the way up
    const dc = camera.position.length(), alt = Math.max(1, dc - radii.z), far = Math.sqrt(Math.max(0, dc * dc - radii.z * radii.z)) + radii.x * 0.6, near = clamp(alt * 0.0006, 1, 2e4);
    camera.fov = p.fov; camera.near = near; camera.far = Math.max(far, near * 10); camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    blurK = p.blur || 0; state.follow.n++; state.follow.s = Math.round(p.s * 1000) / 1000;
    const lo = clamp(1 - blurK / 0.09, 0, 1); if (lo !== labelsOp) { labelsOp = lo; labels.style.opacity = lo < 1 ? lo.toFixed(2) : ""; }      // the names stand back while the picture is blurred
    if (p.done) { const was = plan; plan = null; blurK = 0; controls.enabled = true; state.follow.arrivedAt = Math.round(now); labelsOp = 1; labels.style.opacity = ""; dropAux(); if (typeof was.onArrive === "function") { try { was.onArrive(); } catch (e) {} } }
  }
  /* the dive's motion blur, as the city draws it (city_shaders.js BLUR_FRAG): the drawn frame (premultiplied, with the canvas's alpha) is copied and smeared towards the middle of the view */
  const BLUR_VERT = `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const BLUR_FRAG = `precision highp float; uniform sampler2D uTex; uniform float uAmount; varying vec2 vUv;
void main() { vec2 d = vUv - 0.5; float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); vec4 acc = vec4(0.0);
  for (int i = 0; i < TAPS; i++) { float t = (float(i) + j) / float(TAPS); acc += texture2D(uTex, 0.5 + d * (1.0 - uAmount * t)); }
  gl_FragColor = acc / float(TAPS); }`;
  let blur = null; const _dbs = new THREE.Vector2();
  function drawBlur(k) {
    if (!blur) drawBlurPrep();
    renderer.getDrawingBufferSize(_dbs);
    if (!_dbs.equals(blur.size)) { blur.tex.dispose(); blur.tex = new THREE.FramebufferTexture(_dbs.x, _dbs.y); blur.mat.uniforms.uTex.value = blur.tex; blur.size.copy(_dbs); }
    renderer.copyFramebufferToTexture(blur.tex);
    blur.mat.uniforms.uAmount.value = k; state.blurMax = Math.max(state.blurMax || 0, Math.round(k * 1000) / 1000);
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(blur.sc, blur.cam); renderer.autoClear = ac;
  }
  // its program is built ahead, on the parallel compile, when a dive is likely (a city's card is open), so the first blurred frame does not stall
  function prepareBlur() { try { drawBlurPrep(); } catch (e) {} }
  function drawBlurPrep() {
    if (blur) return;
    const tex = new THREE.FramebufferTexture(1, 1), mat = new THREE.ShaderMaterial({ vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, uniforms: { uTex: { value: tex }, uAmount: { value: 0 } }, defines: { TAPS: devCls === "strong" ? 12 : 8 },
      depthTest: false, depthWrite: false, toneMapped: false, transparent: false, blending: THREE.NoBlending });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(q); blur = { tex, mat, q, sc, cam: new THREE.OrthographicCamera(), size: new THREE.Vector2() };
    renderer.compileAsync(sc, blur.cam).catch(() => {});
  }

  /* ---------- dynamic resolution: while the camera moves, a GPU that takes more than 14 ms a frame gets the picture a tenth smaller (down to 0.7), and it comes back once the GPU has had room for 3 s ---------- */
  const timerGL = renderer.getContext(), timerExt = (() => { try { return timerGL.getExtension("EXT_disjoint_timer_query_webgl2"); } catch (e) { return null; } })();
  let gpuQ = null, gpuMs = 0, gpuN = 0, resAt = 0, calmSince = 0;
  function readGpu(now) {
    if (!gpuQ || !timerGL.getQueryParameter(gpuQ, timerGL.QUERY_RESULT_AVAILABLE)) return;
    if (!timerGL.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      const ms = timerGL.getQueryParameter(gpuQ, timerGL.QUERY_RESULT) / 1e6; gpuMs = gpuN++ ? gpuMs + (ms - gpuMs) * 0.35 : ms; state.gpuMs = Math.round(gpuMs * 10) / 10;
      if (gpuN > 3 && !reduced()) {
        if (gpuMs > 14 && dprScale > 0.7 && now - resAt > 1200) { resAt = now; calmSince = 0; setScale(dprScale - 0.1, `${gpuMs.toFixed(1)} ms of GPU time a frame`); }
        else if (gpuMs < 6 && dprScale < 1) { if (!calmSince) calmSince = now; else if (now - calmSince > 3000 && now - resAt > 3000) { resAt = now; calmSince = 0; setScale(dprScale + 0.1, "the GPU has room again"); } }
        else calmSince = 0;
      }
    }
    timerGL.deleteQuery(gpuQ); gpuQ = null;
  }
  function setScale(v, why) {
    dprScale = clamp(Math.round(v * 100) / 100, 0.7, 1); state.resolution = dprScale; gpuN = 0;
    state.downgrades = (state.downgrades || []).concat([`resolution ${dprScale.toFixed(2)}: ${why}`]);
    renderer.setPixelRatio(dpr()); size.w = 0; resize(); wake(300);
  }

  /* ---------- placing the marks (no layout reads: sizes were measured when they could change) ---------- */
  const _v = new THREE.Vector3(), boxes = [];
  function place() {
    const W = size.w, H = size.h, cp = camera.position;
    boxes.length = 0;
    for (const m of order) {
      _v.copy(m.pos).project(camera);
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      const facing = (cp.x - m.pos.x) * m.n.x + (cp.y - m.pos.y) * m.n.y + (cp.z - m.pos.z) * m.n.z > 0;
      const show = facing && _v.z < 1 && x > -40 && x < W + 40 && y > -20 && y < H + 20;
      if (show !== m.shown) { m.el.classList.toggle("is-off", !show); m.shown = show; }
      if (!show) continue;
      if (Math.abs(x - m.x) > 0.05 || Math.abs(y - m.y) > 0.05) { m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; m.x = x; m.y = y; }
      const w = m.lw, left = m.kind === "station" && x + 15 + w > W - 6 && x - 15 - w > 6;   // a label that would leave the view stands on the other side of its point
      if (left !== m.left) { m.el.classList.toggle("is-left", left); m.left = left; }
      const box = m.kind === "station" ? (left ? [x - 15 - w, y - 12, x - 12, y + 12] : [x + 12, y - 12, x + 15 + w, y + 12]) : [x - w / 2, y - 13, x + w / 2, y + 13];
      let hide = false;
      if (m.id !== state.selected) for (const r of boxes) if (box[0] < r[2] + 8 && box[2] > r[0] - 8 && box[1] < r[3] + 2 && box[3] > r[1] - 2) { hide = true; break; }
      if (hide !== m.hidden) { m.el.classList.toggle("no-lab", hide); m.hidden = hide; }
      if (!hide) boxes.push(box);
    }
  }

  /* ---------- credits ----------
     What ion returns, kept as it comes and split by its own `collapsible` flag, as Cesium's viewer does: the flag-less ones (its logo, the "upgrade" line) are always on the globe, small, at the bottom
     right; the collapsible ones (the terrain's long list of data sources) sit behind a "Data sources" button that opens a panel over the globe (closed by Esc, a click outside, or the button).
     ion returns nothing for the Bing imagery itself, so Bing's own words are read from its metadata: its logo and a short "(c) year Microsoft" stay in the strip, its full copyright goes in the panel. */
  let creditKey = "", bing = null, dataOpen = false;
  const cp = opts.copy || {};
  const bingShort = () => { const y = /(\d{4})\s+Microsoft/.exec(bing.copyright || ""); return "© " + (y ? y[1] + " " : "") + "Microsoft"; };
  function setData(open, focus) {
    dataOpen = open;
    const panel = credits.querySelector(".atlas-credit-data"), btn = credits.querySelector(".atlas-credit-more");
    if (panel) panel.hidden = !open;
    if (btn) { btn.setAttribute("aria-expanded", String(open)); if (focus && !open) btn.focus(); }
  }
  function updateCredits() {
    let list = [];
    try { list = tiles.getAttributions([]); } catch (e) { return; }
    const items = list.filter((a) => a && a.type === "html" && a.value);
    const key = items.map((a) => (a.collapsible ? "c" : "f") + a.value).join("\u0001") + "\u0002" + (bing ? bing.copyright + bing.logo : "");
    if (key === creditKey) return;
    creditKey = key;
    credits.replaceChildren();
    const seen = new Set(), panel = document.createElement("div");
    panel.className = "atlas-credit-data"; panel.hidden = !dataOpen; panel.id = "atlasCreditData"; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", cp.creditsMore || "Data sources");
    for (const a of items) {
      if (seen.has(a.value)) continue; seen.add(a.value);
      (a.collapsible ? panel : credits).append(credit(a.value));
    }
    if (bing) {
      const el = document.createElement("span"); el.className = "atlas-bing";
      const a = document.createElement("a"); a.href = "https://www.bing.com/maps"; a.target = "_blank"; a.rel = "noopener";
      if (/^https:\/\//i.test(bing.logo)) { const i = document.createElement("img"); i.src = bing.logo; i.alt = "Bing Maps"; i.decoding = "async"; a.append(i); } else a.textContent = "Bing Maps";
      el.append(a, document.createTextNode(" " + bingShort()));
      credits.append(el);
      if (bing.copyright) { const p = document.createElement("span"); p.textContent = bing.copyright; panel.append(p); }
    }
    if (panel.childNodes.length) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "atlas-credit-more"; btn.textContent = cp.creditsMore || "Data sources";
      btn.setAttribute("aria-expanded", String(dataOpen)); btn.setAttribute("aria-controls", "atlasCreditData");
      btn.addEventListener("click", () => setData(!dataOpen, true));
      credits.append(btn, panel);
    }
  }
  on(document, "keydown", (e) => { if (e.key === "Escape" && dataOpen) { setData(false, true); e.stopPropagation(); } });
  on(document, "pointerdown", (e) => { if (dataOpen && !credits.contains(e.target)) setData(false, false); }, true);
  const abort = new AbortController(); undo.push(() => abort.abort());
  (async () => {   // the Bing credit: the overlay's answer from ion's endpoint for asset 2 gives the key, Bing's metadata gives the logo and the copyright (one small request, once)
    try {
      const ep = await epReady; if (abort.signal.aborted) return; if (!ep) throw new Error("no imagery");
      const o = ep.options || {}; if (!o.url || !o.key) return;
      const m = await fetch(`${o.url}/REST/v1/Imagery/Metadata/${o.mapStyle || "Aerial"}?key=${o.key}&uriScheme=https`, { signal: abort.signal }).then((r) => (r.ok ? r.json() : Promise.reject()));
      bing = { logo: String(m.brandLogoUri || ""), copyright: String(m.copyright || "") };
    } catch (e) { if (abort.signal.aborted) return; bing = { logo: "", copyright: "" }; }
    if (!disposed) updateCredits();
  })();

  /* ---------- the loop: on demand ---------- */
  let raf = 0, poll = 0, last = 0, awakeUntil = 0, lastChange = 0, dragging = false, inView = true, wasReady = false, sawFirst = false, moveK = 0;
  const moveLast = new THREE.Vector3();
  let dirty = true;   // something changed since the last drawing
  function wake(ms = SETTLE) { if (disposed) return; dirty = true; awakeUntil = Math.max(awakeUntil, performance.now() + ms); schedule(); }
  function schedule() { if (!raf && !disposed && !asleep && inView && !document.hidden) raf = requestAnimationFrame(tick); }
  // a globe a city has faded over: it draws nothing more and loads nothing more until it is taken down (dispose), which the page leaves until the move has arrived
  let asleep = false;
  function sleep() { asleep = true; plan = null; if (raf) cancelAnimationFrame(raf); if (poll) clearTimeout(poll); raf = poll = 0; state.asleep = true; }
  const loading = () => tiles.stats.queued + tiles.stats.downloading + tiles.stats.parsing > 0;   // work really pending (the renderer's own isLoading flag only clears in a full update, which is skipped while the camera rests)
  function tick(now) {
    raf = 0; if (disposed) return;
    const t0 = performance.now();
    const dt = last ? clamp((now - last) / 1000, 0.001, 0.064) : 0.016; last = now;
    state.frames++;
    if (plan) { stepPlan(now); dirty = true; } else if (fly) { stepFly(now); dirty = true; }
    if (!plan) controls.update(dt);
    camera.updateMatrixWorld();
    // the detail: ours is put back before every update (the terrain plugin sets its own 2 when ion's answer arrives, after this module has started), coarser while the camera moves fast (30 October):
    // the camera's travel in a second, measured against its height, from 0.6 (a slow drift: full detail) to 1.8 (a dive at full speed: three times the error)
    const cp0 = camera.position, alt0 = Math.max(300, cp0.length() - radii.z);
    const rate = moveLast.lengthSq() ? cp0.distanceTo(moveLast) / alt0 / dt : 0; moveLast.copy(cp0);
    moveK += ((plan || fly || dragging ? clamp((rate - 0.6) / 1.2, 0, 1) : 0) - moveK) * (rate > 0.6 && (plan || fly || dragging) ? 0.5 : 0.25);
    if (moveK < 0.01) moveK = 0;
    // 8 November 2026 (the author, on a OnePlus Nord CE2: the globe from afar was blurry): far out the whole globe is a few dozen tiles, so it is drawn at full detail (1.2) whatever the
    // device; from 8,000 km down to 3,000 km the detail eases back to the device's own. Measured on a phone at the home view: 11 tiles, 1.1 MB at 3.5 against 73 tiles, 2.35 MB at 1.2. ?farerr=N overrides it
    const farK = sstep((alt0 - 3e6) / 5e6), errBase = ERR * (1 - farK) + Math.min(ERR, FAR_ERR) * farK;
    const errNow = errBase * (1 + MOVE_ERR * moveK);
    if (tiles.errorTarget !== errNow) tiles.errorTarget = errNow;
    state.moveK = Math.round(moveK * 100) / 100; state.errNow = Math.round(errNow * 100) / 100;   // read by the tests
    if (!(plan && plan.holdTiles && now >= plan.holdTiles)) tiles.update();
    // the uniforms that follow the camera
    const alt = camera.position.length() - 6371000, k = clamp((alt - 5e6) / 1e7, 0, 1), near = 0.28 + 0.72 * k * k * (3 - 2 * k);   // the regions fade back as the camera comes close, so the ground shows through
    caps.forEach((c) => { c.mat.uniforms.uNear.value = near; });
    if (dirty) {
      dirty = false;
      const moving = !!plan || !!fly || dragging, timed = timerExt && !gpuQ && moving && !blurK && (state.renders % 4 === 0);
      if (timed) { gpuQ = timerGL.createQuery(); timerGL.beginQuery(timerExt.TIME_ELAPSED_EXT, gpuQ); }
      renderer.render(scene, camera);
      if (blurK > 0.004) drawBlur(blurK);
      if (timed) timerGL.endQuery(timerExt.TIME_ELAPSED_EXT);
      state.renders++;
      place();
      state.ms += (performance.now() - t0 - state.ms) * 0.1;   // the main thread's time for a drawn frame (running mean), for the notes
    }
    if (gpuQ) readGpu(now);
    if (!sawFirst && tiles.visibleTiles.size > 0 && state.renders > 0 && !failed) { sawFirst = true; state.firstAt = Math.round(now); onFirst(); }    // the first tiles are drawn (finer ones may still be coming)
    if (!wasReady && tiles.visibleTiles.size > 0 && !loading() && !failed) { wasReady = true; state.ready = true; onReady(); }
    const why = state.why;
    if (plan) why.plan = (why.plan || 0) + 1;
    if (fly) why.fly++; if (dragging) why.drag++; if (now < awakeUntil) why.awake++; if (now - lastChange < 160) why.change++;
    if (plan || fly || dragging || now < awakeUntil || now - lastChange < 160) schedule();
    else if (loading()) { why.loading++; if (!poll) poll = setTimeout(() => { poll = 0; schedule(); }, 120); }   // only waiting for tiles: a look every 120 ms, a drawing only if something changed
    else { last = 0; moveLast.set(0, 0, 0); }   // idle: no frame is asked for until something wakes the loop
  }
  // a slow tick as a safety net: if a download finished while nothing was listening, the loop starts again
  const watch = setInterval(() => { if (!raf && !poll && !disposed && (loading() || !wasReady)) schedule(); }, 1500);
  undo.push(() => clearInterval(watch));

  for (const ev of ["needs-render", "needs-update", "load-model", "tile-visibility-change", "tiles-load-start", "load-tileset", "load-root-tileset"]) on(tiles, ev, () => wake(SETTLE));
  on(tiles, "load-model", (e) => matte(e.scene));
  on(tiles, "tiles-load-end", () => { updateCredits(); wake(SETTLE); });
  on(tiles, "load-root-tileset", () => { updateCredits(); });
  on(tiles, "load-error", (e) => { if (!e.tile && !wasReady) fail("failed"); });
  imagery.whenReady() && imagery.whenReady().then(() => { updateCredits(); wake(SETTLE); }).catch(() => {});
  on(controls, "change", () => { lastChange = performance.now(); dirty = true; schedule(); });
  on(controls, "start", () => { dragging = true; if (fly && fly.done) fly.done(); fly = null; wake(SETTLE); });
  on(controls, "end", () => { dragging = false; wake(700); });
  for (const ev of ["pointerdown", "wheel", "touchstart", "keydown", "dblclick"]) on(canvas, ev, () => wake(800), { passive: true });
  // a click (not a drag) on a region chooses it: the ray through the pointer meets the ellipsoid, the nearest concentration whose disc holds that point is the one
  const caps2 = features.filter((f) => f.kind === "concentration");
  const _ray = new THREE.Raycaster(), _inv = new THREE.Matrix4(), _carto = { lat: 0, lon: 0, height: 0 }, _ndc = new THREE.Vector2();
  function pickRegion(cx, cy) {
    if (!caps2.length) return "";
    const r = canvas.getBoundingClientRect(); _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld(); _ray.setFromCamera(_ndc, camera);
    _inv.copy(world.matrixWorld).invert();
    const o = _ray.ray.origin.clone().applyMatrix4(_inv), d = _ray.ray.direction.clone().transformDirection(_inv);
    const S = new THREE.Vector3(1 / radii.x, 1 / radii.y, 1 / radii.z); o.multiply(S); d.multiply(S);
    const A = d.dot(d), B = o.dot(d), Cc = o.dot(o) - 1, disc = B * B - A * Cc; if (disc < 0) return "";
    const t = (-B - Math.sqrt(disc)) / A; if (t < 0) return "";
    const p = _ray.ray.origin.clone().applyMatrix4(_inv).addScaledVector(_ray.ray.direction.clone().transformDirection(_inv), t);
    ell.getPositionToCartographic(p, _carto);
    let best = "", bd = 1e9;
    for (const f of caps2) {
      const la = f.lat * DEG, lo = f.lon * DEG, h = Math.sin((_carto.lat - la) / 2) ** 2 + Math.cos(la) * Math.cos(_carto.lat) * Math.sin((_carto.lon - lo) / 2) ** 2, km = 2 * EARTH_KM * Math.asin(Math.sqrt(h));
      if (km <= f.radius_km && km / f.radius_km < bd) { bd = km / f.radius_km; best = f.id; }
    }
    return best;
  }
  let down = null;
  on(canvas, "pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
  on(window, "pointerup", (e) => { const d = down; down = null; if (!d || e.target !== canvas || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 500) return; const id = pickRegion(e.clientX, e.clientY); if (id) onSelect(id); });
  on(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
  on(canvas, "webglcontextrestored", () => wake(SETTLE));
  on(document, "visibilitychange", () => { if (!document.hidden) wake(SETTLE); });
  const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; if (inView) wake(SETTLE); }); io.observe(host); undo.push(() => io.disconnect());

  /* ---------- the end: everything made above is taken down ---------- */
  function dispose() {
    if (disposed) return; disposed = true; state.live = false;
    if (raf) cancelAnimationFrame(raf); if (poll) clearTimeout(poll); raf = poll = 0; fly = null; plan = null; dropAux();
    try { if (gpuQ) timerGL.deleteQuery(gpuQ); } catch (e) {} gpuQ = null;
    if (blur) { try { blur.tex.dispose(); blur.mat.dispose(); blur.q.geometry.dispose(); } catch (e) {} }
    undo.splice(0).reverse().forEach((f) => { try { f(); } catch (e) {} });
    try { controls.dispose(); } catch (e) {}
    try { scene.remove(tiles.group); tiles.dispose(); } catch (e) {}
    caps.forEach((c) => { c.mesh.geometry.dispose(); c.mat.dispose(); });
    atm.geometry.dispose(); atmMat.dispose();
    try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
    own();      // only what this module put in the host: a new map may already be there (a globe is taken down after the move that left it)
  }

  resize();
  if (opts.alsoLoad) alsoLoad(opts.alsoLoad);
  state.aux = () => aux.length;
  wake(2000);
  return { select, home, pose, follow, stop, sleep, prepareBlur, following: () => !!plan, busy: () => !!plan || !!fly || dragging, dispose };
}
