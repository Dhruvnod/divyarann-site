/* The Dwarka night city: the shaders (proposal, 28 October 2026). GLSL as strings; city.js makes the materials.
   One look runs through all of them: exponential height fog that takes its colour from the site's palette plus a warm glow lobe towards Delhi, windows lit by a procedural grid with a seed per building,
   the accent as a rim light along every roof edge, roads as soft glowing ribbons with lamp pools and the odd pair of headlights. Output is linear: the post chain (or the renderer, on a weak
   device) does the tone mapping and the colour space. */

export const COMMON = /* glsl */`
#ifdef CITY_DAY
#define DAYK(k) (1.0 - (k) * uMix)
#define DAYV(k) ((k) * uMix)
uniform float uMix;           // the day look's share: 0 at night, 1 from 3.5 degrees below the horizon up (earlier than uDay, so that twilight is lit)
uniform sampler2D uNoise;     // a small tiling noise, four channels (city.js dayNoise): cheaper than the procedural noise, and it fades to its mean by its mipmaps
uniform vec3 uAnti;           // the sky's band opposite a low sun
uniform vec3 uWat[2];         // the water, deep and shallow (the city's day look)
uniform vec3 uIce[2];         // the ice sheet, the sea ice
uniform vec3 uZen;            // the sky overhead
uniform vec3 uAltK;           // the day's exposure as the camera climbs (1 near the city): how the city meets the globe at the dive's meeting point
#else
#define DAYK(k) 1.0
#define DAYV(k) 0.0
#endif
uniform float uTime;
uniform float uAnim;
uniform vec3  uHaze;
uniform vec3  uGlowCol;
uniform vec3  uGlowDir;
uniform vec3  uAccent;
uniform vec3  uMoonDir;
uniform vec3  uMoonCol;
uniform float uFogD;
uniform float uFogK;
uniform float uFogCam;                                // exp(-uFogK * camera height): worked out once a frame, not once a pixel
uniform float uFogBase;                               // the height-free haze (1 / 11000 for Dwarka; a city seen from further off has a clearer sky)
// the light (30 October; city.js setLight): the key light's direction, colour and intensity (tonight the moon), the sky's light on an upward face, 0 night .. 1 day
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunI; uniform vec3 uSkyCol; uniform float uDay;
uniform vec3 uUpDay;          // the light on an upward face, worked out on the CPU for the day terms (tonight's lightUp() stays computed, as it was)
float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + 1.0), f.x), f.y); }
#ifdef CITY_DAY
#ifndef COMMON_IN_VERTEX
// the noise with explicit gradients, the derivatives taken once at the top of main: a fetch or a derivative inside a branch would make Direct3D's compiler flatten the branch (both sides run, and the program takes far longer to build)
vec2 gGX, gGY; float gFw, gTreeK;
uniform vec2 uTreeR;          // the camera's distance over which the far painted canopy takes over from the real trees (both 0 or less: painted everywhere)
void dayGrads(vec3 w) { vec2 p = w.xz; gGX = dFdx(p); gGY = dFdy(p); gFw = length(abs(gGX) + abs(gGY)); gTreeK = smoothstep(uTreeR.x, uTreeR.y, length(w - cameraPosition)); }
#define NZ(q, s) textureGrad(uNoise, (q) * (s), gGX * (s), gGY * (s))
#endif
#endif
float h31(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 fogColor(vec3 d) {
  float e = clamp(d.y, 0.0, 1.0);
  vec2 hd = d.xz; float hl = length(hd); hd = hl > 1e-4 ? hd / hl : vec2(1.0, 0.0);
  float g = max(dot(hd, uGlowDir.xz), 0.0), lobe = g * g * sqrt(g);       // g^2.5 (was pow(g, 2.4): a log and an exp a pixel)
  float x = exp(-e * 1.4), x3 = x * x * x;                                 // exp(-4.2 e) and exp(-7 e) from one exp
#ifdef CITY_DAY
  // by day the fog is the sky's own horizon, so what is far melts into the sky: the haze, the sun's side warm (a wide lobe and a tight one), the band opposite a low sun. Looking down there is no horizon in the view: the lobes go.
  float dn = clamp(-d.y * 5.0, 0.0, 1.0), keep = 1.0 - dn * dn, b = max(-dot(hd, uGlowDir.xz), 0.0);
  vec3 dayFog = uHaze * (0.9 + 0.1 * x3) + (uGlowCol * (0.42 * g * g + 0.58 * lobe * lobe * lobe) + uAnti * b * b) * keep * x3;
  return uMix >= 1.0 ? dayFog : mix(uHaze * (0.62 + 0.55 * x3 * x * x) + uGlowCol * lobe * x3 * 0.55, dayFog, uMix);
#else
  return uHaze * (0.62 + 0.55 * x3 * x * x) + uGlowCol * lobe * x3 * 0.55;       // the glow tints the fog gently: the city far off stays the colour of its lights, not of the haze
#endif
}
#ifndef COMMON_IN_VERTEX
// water: a dark mirror that holds the glow (the water polygons, and the ground beyond a city's box where the sea goes on)
vec3 waterCol(vec3 wp) {
  vec3 v = normalize(cameraPosition - wp); float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
#ifdef CITY_DAY
  // by day: a real blue-green with the sky in it, ripples from the noise, the sun's glitter (the night's mirror, flat, only for the minutes uMix is under 1)
  vec2 p = wp.xz; vec4 a = NZ(p, 0.00004), b = NZ(p, 0.0125), m = NZ(p, 0.0009);
  vec3 N = normalize(vec3((b.g - 0.5) * 0.10, 1.0, (b.b - 0.5) * 0.10)), R = reflect(-v, N);
  float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(v, N), 0.0, 1.0), 5.0), ry = clamp(R.y, 0.0, 1.0);
  vec3 skyR = mix(uHaze * 0.95, uZen, 1.0 - exp(-ry * 2.6));
  vec3 day = mix(mix(uWat[0], uWat[1], smoothstep(0.15, 0.85, a.g)) * (0.92 + 0.16 * m.g) * uUpDay, skyR, fr * 0.85) + uSunCol * uSunI * pow(max(dot(R, uSunDir), 0.0), 180.0) * 0.5;
  return mix(vec3(0.012, 0.024, 0.060) + uHaze * (0.08 + 0.4 * fres) + uAccent * 0.02, day, uMix);
#else
  return vec3(0.012, 0.024, 0.060) + fogColor(reflect(-v, vec3(0.0, 1.0, 0.0))) * (0.10 + 0.55 * fres) + uAccent * 0.02;
#endif
}
// ice, moonlit: a pale blue-grey that takes the night's haze (Akash's is cold, Grahan's warmer)
vec3 iceCol(float n, vec3 wp) {
  vec3 c = vec3(0.030, 0.038, 0.052) * (0.82 + 0.36 * n) + uHaze * 0.9 + uMoonCol * 0.12 + uAccent * 0.004;
#ifdef CITY_DAY
  if (uMix > 0.0) {       // by day: the wind's long streaks, wide changes of tone and blue-white patches
    vec2 p = wp.xz, sc = vec2(0.0003, 0.0034); vec4 a = NZ(p, 0.00012), b = NZ(p, 0.0016); float st = textureGrad(uNoise, p * sc, gGX * sc, gGY * sc).g;
    c = mix(c, mix(uIce[0], uIce[0] * vec3(0.76, 0.86, 1.0), smoothstep(0.42, 0.72, a.a)) * (0.76 + 0.20 * a.g + 0.10 * b.r + 0.14 * st) * uUpDay, uMix);
  }
#endif
  return c;
}
// the frozen sea: the ice's own blue-grey, darker and flatter than the ice sheet, with a little of the water's sheen, so the coast reads where the land ice meets the sea ice
vec3 seaIceCol(float n, vec3 wp) {
#ifdef CITY_DAY
  vec3 c = vec3(0.016, 0.021, 0.032) * (0.90 + 0.20 * n) + uHaze * 0.55 + uMoonCol * 0.06;
#else
  vec3 c = mix(vec3(0.016, 0.021, 0.032) * (0.90 + 0.20 * n) + uHaze * 0.55 + uMoonCol * 0.06, waterCol(wp), 0.18);
#endif
#ifdef CITY_DAY
  if (uMix > 0.0) {       // by day greyer and flatter than the land ice, its floes parted by dark leads
    vec2 p = wp.xz; vec4 a = NZ(p, 0.00016), b = NZ(p, 0.0023); float fw = gFw * 0.00016 * 64.0;
    float lead = 1.0 - smoothstep(0.0, 0.012 + fw, abs(a.b - 0.5) + (b.r - 0.5) * 0.02);
    c = mix(c, uIce[1] * (0.84 + 0.24 * a.g + 0.08 * b.g) * (1.0 - 0.28 * lead) * uUpDay, uMix);
  }
#endif
  return c;
}
#endif
// the sky has the rest of the glow, a band at the horizon on the side of the capital's lights (it all used to ride in the fog, which washed the far city a muddy colour)
vec3 skyGlow(vec3 d) {
  vec2 hz = normalize(d.xz + 1e-5);
  float g = max(dot(hz, uGlowDir.xz), 0.0);
  return uGlowCol * (g * g * sqrt(g)) * exp(-max(d.y, 0.0) * 4.2) * 0.6;
}
// the tear's wash on what lies under it (5 November 2026, from the story lab): a soft violet light thrown on the ground and the roofs where the crack in the sky looks down, by night only
uniform vec4 uTearC;          // the middle of the pool (x, z), its radius, its strength (0: none)
uniform vec3 uTearK;          // its colour
vec3 tearWash(vec3 wp) {
  if (uTearC.w <= 0.0) return vec3(0.0);
  vec2 q = (wp.xz - uTearC.xy) / uTearC.z; float f = exp(-dot(q, q) * 2.2);
  return uTearK * (f * uTearC.w * (0.62 + 0.38 * smoothstep(0.0, 60.0, wp.y)));
}
// v: the fragment's position relative to the camera
vec3 applyFogRel(vec3 c, vec3 v) {
  float d = length(v);
  c += tearWash(cameraPosition + v);
  float k = uFogK, dy = v.y;
  float t = abs(k * dy) < 1e-3 ? 1.0 : (1.0 - exp(-k * dy)) / (k * dy);
  // the fog's density falls with height (the first term), plus a little haze that does not depend on height, so the far ground melts into the sky (the second): two exponentials made one
#ifdef CITY_DAY
  // by day: clear near by, thickening with the path's length, so that the land dissolves into the haze long before it ends; the exposure falls a little as the camera climbs to the globe's meeting point
  float x = (uFogD * uFogCam * t + uFogBase) * d; x += 4.0 * x * x * uMix;
  return mix(c, fogColor(v / max(d, 1e-3)), clamp(1.0 - exp(-x), 0.0, 1.0)) * mix(vec3(1.0), uAltK, uMix);      // (TREE_VERT works this out per vertex, the same way)
#else
  float f = 1.0 - exp(-(uFogD * uFogCam * t + uFogBase) * d);
  return mix(c, fogColor(v / max(d, 1e-3)), clamp(f, 0.0, 1.0));
#endif
}
vec3 applyFog(vec3 c, vec3 wp) { return applyFogRel(c, wp - cameraPosition); }
// the light on an upward face
vec3 lightUp() { return uSunCol * uSunI * max(uSunDir.y, 0.0) + uSkyCol; }
// value noise at frequency f, faded to its mean once its cells are under two pixels (fw: metres per pixel)
float vnAA(vec2 p, float f, float fw) { float k = 1.0 - smoothstep(0.3, 0.7, fw * f); return k > 0.0 ? mix(0.5, vn(p * f), k) : 0.5; }
`;

/* ---------------- buildings ---------------- */
/* 30 October (NOTES.md, "Sharper buildings"): faces lit as albedo x (key light + sky), windows laid wall by wall and box-filtered, drawn in blocks from afar; a face's light is worked out per vertex. */
export const BUILDING_VERT = /* glsl */`
attribute vec4 aM;          // seed, height x 2 + 256 x kind code + 4096 x role, wall length x 25, normal (x, z a byte each): the same on every vertex of a wall
attribute float aU;         // metres along the wall x 25
uniform float uAlb;
uniform float uProcSame;
uniform float uLights;
varying vec4 vR;            // position relative to the camera, metres along the wall
varying vec4 vM;            // seed, height, role + 4 tower + 8 commercial + 16 narrow bays + 32 generated, wall length
varying vec4 vC;            // the face's lit colour, the street light's strength on a wall
#define COMMON_IN_VERTEX
${COMMON}
#ifdef CITY_DAY
uniform vec3 uWalls[6];     // the city's day look: its walls, its roofs, its towers
uniform vec3 uRoofs[4];
uniform vec3 uTower;
uniform vec3 uBounce;       // the light the sunlit ground sends back up a wall (warm at its foot)
varying vec3 vGlass;        // the day's glass on this wall: each building its own, from dark to sky-coloured, a little of the lit wall in it, and the sun's glint when the sun is low
#endif
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float c = aM.y, role = floor(c / 4096.0 + 0.001); c -= role * 4096.0; float kc = floor(c / 256.0 + 0.001); c -= kc * 256.0;
  float H = c * 0.5, seed = aM.x / 65536.0, proc = step(7.5, kc), kind = kc - 8.0 * proc;
  float h1 = seed, h2 = fract(seed * 16.0), h3 = fract(seed * 256.0), h4 = fract(seed * 4096.0);       // the seed's four hex digits: four draws
  float tower = step(27.0, H), com = step(1.5, kind) * step(kind, 2.5), k1 = step(0.5, kind) * step(kind, 1.5);
  // plaster, cream, brick, pale stone, concrete; towers darker and cooler
  vec3 alb = h1 < 0.30 ? vec3(0.40, 0.37, 0.33) : h1 < 0.52 ? vec3(0.36, 0.36, 0.38) : h1 < 0.70 ? vec3(0.42, 0.33, 0.30) : h1 < 0.86 ? vec3(0.34, 0.27, 0.24) : vec3(0.45, 0.43, 0.41);
  alb = mix(alb, vec3(0.20, 0.23, 0.29), 0.6 * tower) * uAlb * (0.85 + 0.3 * h2);
  vec3 col = vec3(0.0); float spill = 0.0;
#ifdef CITY_DAY
  if (uMix < 1.0)
#endif
  if (role > 1.5) {
    // the lip's outer edge: lit from above, and the accent rim
    col = alb * 1.25 * lightUp() + uAccent * (0.66 * (0.75 + 0.25 * h4)) * (1.0 - 0.45 * smoothstep(0.0, 70.0, H)) * DAYK(1.0);
  } else if (role > 0.5) {
    col = alb * 0.55 * lightUp();          // the roof
  } else {
    // a wall: the key light (wrapped), half the sky, the capital's glow
    float nb = floor(aM.w / 256.0 + 0.001); vec3 N = vec3(nb / 127.5 - 1.0, 0.0, (aM.w - nb * 256.0) / 127.5 - 1.0);
    col = alb * (uSunCol * uSunI * max(dot(N, uSunDir) * 0.8 + 0.2, 0.0) + uSkyCol * 0.47 + uGlowCol * max(dot(N.xz, uGlowDir.xz), 0.0) * 0.9 * (1.0 - uDay));
    spill = dot(alb, vec3(0.333)) * 0.32 * (0.4 + 0.6 * h3) * uLights * (1.0 - uDay);
  }
#ifdef CITY_DAY
  vGlass = vec3(0.0);
  if (uMix > 0.0) {
    // the day's colours: the city's palette, per building; the lip a little brighter than the roof; a wall by the sun, the sky (brighter up high) and the ground's bounce (at its foot)
    vec3 wa = uWalls[int(h1 * 5.999)] * (0.86 + 0.28 * h2), rf = uRoofs[int(h3 * 3.999)] * (0.86 + 0.28 * h4), d;
    wa = mix(wa, uTower, 0.35 * tower);
    if (role > 1.5) d = mix(rf, wa, 0.5) * 1.12 * uUpDay;
    else if (role > 0.5) d = rf * uUpDay;
    else {
      float nb = floor(aM.w / 256.0 + 0.001); vec3 N = vec3(nb / 127.5 - 1.0, 0.0, (aM.w - nb * 256.0) / 127.5 - 1.0);
      float yk = clamp(w.y / max(H, 1.0), 0.0, 1.0), ndl = dot(N, uSunDir), hg = fract(h1 * 41.7 + h3 * 13.1);
      d = wa * (uSunCol * uSunI * max(ndl * 0.95 + 0.05, 0.0) + uSkyCol * (0.38 + 0.2 * yk) + uBounce * (1.0 - yk * 0.8));
      vGlass = uSkyCol * (0.20 + 0.52 * hg) * (hg > 0.7 ? vec3(0.78, 1.0, 1.06) : hg > 0.35 ? vec3(0.95, 1.0, 1.1) : vec3(1.08, 1.0, 0.9)) + d * 0.16;
      if (ndl > 0.0 && uSunDir.y < 0.55) vGlass += uSunCol * uSunI * pow(max(dot(reflect(normalize(w.xyz - cameraPosition), N), uSunDir), 0.0), 20.0) * (0.5 + 1.1 * hg);     // a wall turned so that it throws a low sun at the camera (gold at sunset)
    }
    col = mix(col, d, uMix);
  }
#endif
  vR = vec4(w.xyz - cameraPosition, aU * 0.04);
  vM = vec4(aM.x, H, role + 4.0 * tower + 8.0 * com + 16.0 * k1 + 32.0 * proc * (1.0 - uProcSame), aM.z * 0.04);
  vC = vec4(col, spill);
  gl_Position = projectionMatrix * (viewMatrix * w);      // not (P x V) x w: a matrix product per vertex
}`;

export const BUILDING_FRAG = /* glsl */`
precision highp float;
varying vec4 vR;
varying vec4 vM;
varying vec4 vC;
uniform float uWinGain;            // the windows (an event's mood, the blackout)
uniform vec4 uLod;                 // x: windows per pixel where blocks begin; y: the largest block level
uniform float uWinK;               // the lit windows' brightness
${COMMON}
#ifdef CITY_DAY
varying vec3 vGlass;
#endif
// the share of the footprint [x - w/2, x + w/2] inside the pulse [a, b] repeated every 1 (a box filter)
float pulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  float x0 = x - 0.5 * w, x1 = x + 0.5 * w;
  return ((floor(x1) * (b - a) + clamp(fract(x1), a, b)) - (floor(x0) * (b - a) + clamp(fract(x0), a, b))) / w;
}
// 2^n x 2^n windows from afar: one pane lit by their share of lit windows, keeping their mean light
vec3 winBlock(vec2 uv, vec2 fw, float n, float seed, float occ) {
  float B = exp2(n);
  vec2 ub = uv / B, fb = fw / B, ib = floor(ub);
  float h = h21(ib * 1.37 + vec2(seed * 41.0, n * 7.31));
  float fr = clamp(occ + (h - 0.5) * 3.4 * sqrt(occ * (1.0 - occ) / B), 0.0, 1.0);
  vec3 c = fract(h * 7.13) < 0.22 ? vec3(0.80, 0.88, 1.0) : vec3(1.0);
  return c * fr * (1.15 * 0.348 / 0.3136) * pulse(ub.x, 0.22, 0.78, fb.x) * pulse(ub.y, 0.22, 0.78, fb.y);
}
void main() {
  vec3 rel = vR.xyz; float y = rel.y + cameraPosition.y, u = vR.w;
  float seed = floor(vM.x + 0.5) / 65536.0, H = vM.y, code = floor(vM.z + 0.5), Lw = vM.w;
  float role = mod(code, 4.0);
  // derivatives first, in uniform control flow
  float fy = fwidth(y), fu = fwidth(u);
  vec3 col = vC.rgb;
#ifdef CITY_DAY
  float fxz = fwidth(rel.x) + fwidth(rel.z);
#endif
  if (role > 0.5) {
    // the aviation beacon on the tallest roofs
    if (role < 1.5 && H > 40.0) { vec2 xz = rel.xz + cameraPosition.xz; float b = step(0.5, fract(uTime * 0.7 * uAnim + seed * 9.0)); col += vec3(1.0, 0.08, 0.05) * (0.6 + 2.0 * b) * smoothstep(1.2, 0.0, length(fract(xz * 0.04) - 0.5) * 8.0) * DAYK(1.0); }
#ifdef CITY_DAY
    // roof clutter, while it can be seen: a water tank or a stair head here and there, with its small shadow
    if (role < 1.5 && uMix > 0.0 && fxz < 1.0) {
      vec2 q = (rel.xz + cameraPosition.xz) / 7.0, id = floor(q), f = q - id - 0.5; float hr = h21(id + seed * 91.0);
      if (hr > 0.7) {
        vec2 o = (vec2(hr, fract(hr * 7.3)) - 0.5) * 0.46, sz = hr > 0.88 ? vec2(0.17, 0.12) : vec2(0.075), sh = uSunDir.xz / max(uSunDir.y, 0.3) * 0.09;
        float far = 1.0 - smoothstep(0.55, 1.0, fxz), aa = fxz * 0.2;
        vec2 e1 = abs(f - o) - sz, e2 = abs(f - o + sh) - sz;
        float k = (1.0 - smoothstep(-aa, aa, max(e1.x, e1.y))) * far, ks = (1.0 - smoothstep(-aa, aa, max(e2.x, e2.y))) * far;
        col = mix(col, col * vec3(0.66, 0.70, 0.78), ks * uMix);
        col = mix(col, (hr > 0.88 ? vec3(0.50, 0.48, 0.44) : vec3(0.11, 0.115, 0.125)) * uUpDay, k * uMix);
      }
    }
#endif
  } else {
    bool tower = mod(code, 8.0) > 3.5, com = mod(code, 16.0) > 7.5, k1 = mod(code, 32.0) > 15.5, own = code > 31.5;
    // a whole number of bays, floors that fill the height under a parapet
    float fh0 = tower ? 3.3 : com ? 3.6 : 3.1, cw0 = tower ? 2.2 : com ? 4.0 : k1 ? 2.7 : 3.0, park = H > 6.0 ? 0.7 : 0.3;
    float nf = max(1.0, floor((H - park) / fh0 + 0.3)), fh = (H - park) / nf, nc = floor(Lw / cw0 + 0.5), cw = nc > 0.5 && Lw > 1.2 ? Lw / nc : 0.0;
    // the street lamps' sodium low down, the corners lighter (a pixel at least), the foot darker
    float street = (1.0 - smoothstep(1.5, 15.0, y)) * smoothstep(0.0, 1.5, y);
    float corner = 1.0 - smoothstep(0.0, max(0.22, fu * 1.15), min(u, Lw - u));
    col = (col + vec3(1.0, 0.56, 0.22) * vC.w * street) * mix(0.45, 1.0, smoothstep(0.0, 2.2, y)) * (1.0 + 0.55 * corner * DAYK(0.6));
    // the windows come on building by building as the day goes (each building its own moment between sunset and the end of twilight)
    float won = 1.0;
#ifdef CITY_DAY
    if (uDay > 0.0) { float th = 0.25 + 0.6 * h11(seed * 7.9); won = 1.0 - smoothstep(th - 0.1, th + 0.1, uDay); }
    vec3 glass = vGlass;
#endif
    if (cw > 0.0) {
      vec2 uv = vec2(u / cw, y / fh), fw = vec2(fu / cw, fy / fh), id = floor(uv);
      float has = step(id.y, nf - 0.5) * step(0.0, uv.y);
      float ho = h11(seed * 17.3), occ = own ? mix(0.15, 0.7, h11(seed * 19.1)) : mix(0.06, 0.74, ho * (1.25 - 0.25 * ho));      // lit share (ho^0.8)
      if (tower) occ *= 0.8;
      float shop = com ? step(id.y, 0.5) : 0.0;
      // by their size on screen: single windows, then blocks of 2 x 2, 4 x 4 ..., then the mean; neighbouring levels cross over
      float lw = max(fw.x, fw.y), L = max(0.0, log2(lw / uLod.x)), n0 = floor(L), t = smoothstep(0.65, 1.0, L - n0);
      vec3 meanC = vec3(0.90, 0.72, 0.52) * 1.9 * uWinK;
      vec3 em;
#ifdef CITY_DAY
      if (won <= 0.001 && uMix >= 1.0) {         // full day, the window not lit: only the glass (near by pane by pane, from afar the panes' mean), none of the night's window maths
        float pane = 0.348;
        if (L < 1.0) {
          float wx = shop > 0.5 ? pulse(uv.x, 0.1, 0.9, fw.x) : pulse(uv.x, 0.2, 0.8, fw.x), wy = shop > 0.5 ? pulse(uv.y, 0.04, 0.8, fw.y) : pulse(uv.y, 0.24, 0.82, fw.y);
          pane = mix(wx * wy, 0.348, t); glass *= mix(0.72 + 0.56 * fract(h21(id * 3.1 + seed) * 11.3), 1.0, t);
        }
        col = mix(col, glass, pane * has); em = vec3(0.0);
      } else
#endif
      if (L < 1.0) {
        float wx = shop > 0.5 ? pulse(uv.x, 0.1, 0.9, fw.x) : pulse(uv.x, 0.2, 0.8, fw.x);
        float wy = shop > 0.5 ? pulse(uv.y, 0.04, 0.8, fw.y) : pulse(uv.y, 0.24, 0.82, fw.y);
        // two hashes a window: its own and its floor's
        float cc = h21(id * 3.1 + seed), rr = fract(cc * 7.77 + 0.31), fk = fract(cc * 53.7 + 0.71);
        vec3 wc = cc < 0.50 ? vec3(1.0, 0.66, 0.30) : cc < 0.74 ? vec3(1.0, 0.80, 0.46) : cc < 0.90 ? vec3(0.72, 0.86, 1.0) : vec3(0.42, 0.62, 1.0);
        if (tower) wc = mix(wc, vec3(0.80, 0.90, 1.0), 0.35);
        wc = mix(wc, vec3(1.0, 0.86, 0.62), shop);
        float rowCoh = h21(vec2(id.y, seed * 3.7));
        float on = step(mix(rr, rowCoh, 0.28), occ + shop * 0.55);
        // a few flicker
        if (fk > 0.965 && uAnim > 0.5) on *= 0.35 + 0.65 * step(0.4, 0.5 + 0.5 * sin(uTime * (2.0 + fk * 16.0) + fk * 80.0));
        float lum = (0.55 + 0.9 * fract(cc * 29.3 + 0.53)) * on * (1.0 - 0.25 * shop);
        em = wc * lum * 1.9 * uWinK * wx * wy;
        // an unlit pane: darker glass with a little sky
#ifdef CITY_DAY
        col = mix(col, mix(col * 0.45 + uSkyCol * 0.06 + uGlowCol * 0.04, glass * (0.72 + 0.56 * fract(cc * 11.3)), uMix), wx * wy * (1.0 - on * won) * (1.0 - t) * has);
        if (t > 0.0) col = mix(col, glass, 0.348 * t * has * uMix);
#else
        col = mix(col, col * 0.45 + uSkyCol * 0.06 + uGlowCol * 0.04, wx * wy * (1.0 - on * won) * (1.0 - t) * has);
#endif
        if (t > 0.0) em = mix(em, meanC * winBlock(uv, fw, 1.0, seed, occ), t);
      } else if (n0 < uLod.y) {
#ifdef CITY_DAY
        col = mix(col, glass, 0.348 * has * uMix);           // from afar the panes are their mean on the wall, so the wall does not lighten as it goes
#endif
        em = meanC * winBlock(uv, fw, n0, seed, occ);
        if (t > 0.0) em = mix(em, meanC * (n0 + 1.0 > uLod.y ? vec3(occ * 0.348) : winBlock(uv, fw, n0 + 1.0, seed, occ)), t);
      } else {
#ifdef CITY_DAY
        col = mix(col, glass, 0.348 * has * uMix);
#endif
        em = meanC * occ * 0.348;
      }
#ifdef CITY_DAY
      em *= 1.0 - 0.55 * uDay;        // softer while the sun is still up
#endif
      col += em * has * uWinGain * won;
    }
    // the rim at the wall's top: a pixel tall at least, as bright as its share of the pixel (a little more)
    col += uAccent * 0.5 * (1.0 - smoothstep(0.0, max(0.45, fy * 1.1), H - y)) * min(1.0, 1.1 * sqrt(0.5 / max(fy, 1e-3))) * DAYK(1.0);
  }
  gl_FragColor = vec4(applyFogRel(col, rel), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- ground, areas ---------------- */
export const GROUND_VERT = /* glsl */`
varying vec3 vPos;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;

export const GROUND_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
uniform sampler2D uDens;
uniform vec4 uBox;
uniform vec3 uWarm;
uniform vec4 uOut;                 // what lies beyond the box on its west, south, east and north sides: 0 ground, 1 sea, 2 ice, 3 sea ice
uniform float uGroundIce;          // 1: the ground itself is ice (a polar scene)
uniform float uLights;             // the street lights (1; 0 in a blackout, and by day): their warm glow on the ground
${COMMON}
#ifdef CITY_DAY
uniform vec3 uGnd[3];              // the city's ground by day: two earths and what a dense city's ground is
uniform vec3 uPlain[3];            // the land beyond the data: its fields and scrub, patchy, so the dive has something to fall into
uniform vec3 uTree;                // the small trees that speckle the open ground
uniform vec4 uEdge;                // the ground plane's middle (x, z) and half its size, and where (a share of that) its edge starts to fade by day
vec3 groundDay(vec2 uv, float d) {
  vec2 p = vPos.xz;
  float fw = gFw;
  vec4 a = NZ(p, 0.00007), b = NZ(p, 0.00077), c = vec4(0.5);
  if (fw < 6.0) c = NZ(p, 0.0077);
  // beyond the box: fields in irregular patches (a grid turned and warped by the noise, each cell its own colour), broad darker and paler country over them, and next to the box a sprawl: more town than the data knows, roofs as grain
  vec2 out2 = max(max(-uv, uv - 1.0), vec2(0.0)) * (uBox.zw - uBox.xy); float od = max(out2.x, out2.y), o = smoothstep(0.0, 0.35 * min(uBox.z - uBox.x, uBox.w - uBox.y), od), fw0 = fw;
  vec3 g = mix(uGnd[0], uGnd[1], smoothstep(0.3, 0.7, a.g * 0.55 + b.r * 0.45));
  if (o > 0.0 || a.r > 0.42) {
    vec2 fq = mat2(0.96, 0.28, -0.28, 0.96) * (p + (vec2(a.b, b.r) - 0.5) * 1100.0) / 330.0; float fh = h21(floor(fq)), kc = 1.0 - smoothstep(0.3, 0.8, fw0 / 330.0);
    vec3 pl = mix((uPlain[0] + uPlain[1] + uPlain[2]) * 0.333, fh < 0.36 ? uPlain[0] : fh < 0.7 ? uPlain[1] : uPlain[2], kc) * (0.76 + 0.48 * b.g) * (kc * (fract(fh * 17.3) * 0.3 - 0.15) + 1.0);
    pl = mix(pl, uPlain[0] * 0.72, smoothstep(0.52, 0.72, a.g) * 0.8);
    pl = mix(pl, uPlain[1] * 1.12, smoothstep(0.55, 0.75, a.a) * 0.7);
    float sp = (1.0 - smoothstep(600.0, 7000.0, od)) * o;                    // the sprawl
    if (sp > 0.0) { float rf = h21(floor(p / 42.0)), ks = 1.0 - smoothstep(12.0, 42.0, fw0); pl = mix(pl, uGnd[2] * mix(0.86, 0.54 + 0.92 * rf * rf, ks), sp * (0.45 + 0.55 * b.b)); }
    g = mix(g, pl, max(o, 0.35 * smoothstep(0.42, 0.62, a.r)));
  }
  // the grain, and the city's concrete where it is dense
  g = mix(g, uGnd[2] * (0.84 + 0.32 * b.g), smoothstep(0.08, 0.62, d));
  g *= 0.80 + 0.22 * b.b + 0.16 * c.g;
  if (fw < 0.8) g *= 0.93 + 0.14 * NZ(p, 0.07).b;       // near by, the grit
  // trees on the open ground, in groves where the noise allows, thinning where the city is dense, and a few alone. Near by, each crown; from afar, their mean colour in the same patches
  float cov = (smoothstep(0.50, 0.60, b.b * 0.6 + a.a * 0.15 + c.r * 0.25) * 0.92 + 0.04) * (1.0 - smoothstep(0.1, 0.7, d)) * (1.0 - 0.8 * o);
  g = mix(g, mix(g * 0.92, uTree * 0.85, cov * 0.5), gTreeK);        // far off the canopy is painted; near by the real trees stand on bare ground
  return g * uUpDay;
}
#endif
void main() {
#ifdef CITY_DAY
  dayGrads(vPos);
#endif
  vec2 uv = (vPos.xz * vec2(1.0, -1.0) - uBox.xy) / (uBox.zw - uBox.xy);
  float d = (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(uDens, vec2(uv.x, uv.y)).r : 0.0;
  float fw = length(fwidth(vPos.xz));                                                           // metres per pixel
#ifdef CITY_DAY
  float nz = 0.5;                                                                                // the night's ground without its grain: only seen in the minutes uMix is under 1
  vec3 base = vec3(0.009, 0.010, 0.016) + uHaze * 0.05 + (uWarm * d * 0.022 + uWarm * d * d * 0.03) * uLights * (1.0 - uDay);
#else
  float nz = vn(vPos.xz * 0.02), kf = 1.0 - smoothstep(0.25, 0.5, fw * 0.2);
  if (kf > 0.0) nz = mix(nz, nz * 0.6 + vn(vPos.xz * 0.2) * 0.4, kf);                           // the fine grain fades out as it comes under two pixels (it was cut at 1,800 m)
  vec3 base = vec3(0.009, 0.010, 0.016) * (0.85 + 0.3 * nz) + uHaze * 0.05;
  base += (uWarm * d * 0.022 + uWarm * d * d * 0.03) * uLights * (1.0 - uDay);
#endif
#ifdef CITY_DAY
  if (uMix > 0.0) base = mix(base, groundDay(uv, d), uMix);   // by day: the city's own earth, its fields beyond the data, its concrete where it is dense
#endif
  if (uGroundIce > 0.5) base = iceCol(nz, vPos);
  // beyond the kept box the ground may be sea or ice instead of dark earth (a coast's sea runs on to the horizon; a polar coast has sea on one side)
  float beyond = 0.0;
#ifdef CITY_DAY
  // by day the land beyond the box can be seen: the line between two sides is not ruled from the box's corner but wanders away from it
  vec2 ox = max(max(-uv, uv - 1.0), vec2(0.0));
  if (ox.x + ox.y > 0.0 && uMix > 0.0) { vec4 wq = NZ(vPos.xz, 0.00006); uv += ((wq.g - 0.5) * 2.6 + (wq.b - 0.5) * 1.2) * ox.yx; }
#endif
  if (uv.x < 0.0) beyond = max(beyond, uOut.x);
  if (uv.y < 0.0) beyond = max(beyond, uOut.y);
  if (uv.x > 1.0) beyond = max(beyond, uOut.z);
  if (uv.y > 1.0) beyond = max(beyond, uOut.w);
  if (beyond > 0.5) base = beyond < 1.5 ? waterCol(vPos) : beyond < 2.5 ? iceCol(nz, vPos) : seaIceCol(nz, vPos);
  gl_FragColor = vec4(applyFog(base, vPos), 1.0);
#ifdef CITY_DAY
  { vec2 eg = abs(vPos.xz - uEdge.xy) / uEdge.z; float k = smoothstep(uEdge.w, 1.0, max(eg.x, eg.y)); if (k > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor(normalize(vec3(vPos.x - cameraPosition.x, 0.0, vPos.z - cameraPosition.z))) * mix(vec3(1.0), uAltK, uMix), k * uMix); }   // the plane's edge is never seen by day
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const AREA_VERT = /* glsl */`
attribute float aKind;
varying vec3 vPos;
varying float vKind;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; vKind = aKind; gl_Position = projectionMatrix * (viewMatrix * w); }`;

export const AREA_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying float vKind;
${COMMON}
#ifdef CITY_DAY
uniform vec3 uPark[2];             // the city's day look: grass, then the trees on it; the forest's two; fields; sand; wetland; aprons and pitches are shared
uniform vec3 uForest[2];
uniform vec3 uField[2];
uniform vec3 uSand;
uniform vec3 uWet;
vec3 areaDay(float k) {
  vec2 p = vPos.xz; float fw = gFw; vec3 a;
  if (k < 1.5) {                                                     // park: grass with clumps of trees
    vec4 m = NZ(p, 0.0016); float cov = smoothstep(0.46, 0.60, m.g * 0.6 + m.b * 0.4) * 0.95 + 0.03;
    vec3 gr = mix(uPark[0] * (0.82 + 0.36 * m.r), uField[0], smoothstep(0.52, 0.78, m.a) * 0.55); if (fw < 0.8) gr *= 0.90 + 0.20 * NZ(p, 0.05).b;      // grass with dry patches
    a = mix(gr, mix(gr, uPark[1] * (0.78 + 0.44 * m.a), cov * 0.75), gTreeK);       // the same: a painted canopy far off, the real trees near by
  }
  else if (k < 3.5) a = vec3(0.32, 0.32, 0.31) * (0.9 + 0.2 * NZ(p, 0.0014).g);                                        // apron
  else if (k < 4.5) { float st = step(0.5, fract((p.x + p.y) * 0.05)); a = uPark[0] * (1.05 + 0.05 * st * (1.0 - smoothstep(0.5, 1.5, fw))); }           // a pitch, mown
  else if (k < 5.5) { vec4 m = NZ(p, 0.0018); vec2 fq = mat2(0.96, 0.28, -0.28, 0.96) * p / 150.0; float fh = h21(floor(fq)); a = mix(uField[0], uField[1], fh) * (0.84 + 0.32 * m.g); }  // fields, plot by plot
  else if (k < 6.5) {                                                                                                 // forest: a slow drift of colour, a canopy's fine grain, crowns near by
    vec4 m = NZ(p, 0.00018), g2 = NZ(p, 0.0031);
    a = mix(uForest[0], uForest[1], smoothstep(0.2, 0.8, m.g * 0.6 + g2.r * 0.4)) * (0.72 + 0.56 * g2.b) * mix(0.55, 1.0, gTreeK);     // under the real trees, the forest's shaded floor
  }
  else if (k < 7.5) a = uSand * (0.86 + 0.28 * NZ(p, 0.003).g);                                                        // sand and beaches
  else a = uWet * (0.7 + 0.6 * NZ(p, 0.004).g);                                                                        // wetland and mud
  return a * uUpDay;
}
#endif
void main() {
#ifdef CITY_DAY
  dayGrads(vPos);
#endif
  float k = floor(vKind + 0.5);
#ifdef CITY_DAY
  // by day (water, ice and sea ice have their own); the night's colours, flat, only for the minutes uMix is under 1
  vec3 col;
  if (k > 1.5 && k < 2.5) col = waterCol(vPos);
  else if (k > 7.5 && k < 8.5) col = iceCol(0.5, vPos);
  else if (k > 9.5) col = seaIceCol(0.5, vPos);
  else {
    col = areaDay(k);
    if (uMix < 1.0) col = mix(k < 1.5 ? vec3(0.016, 0.048, 0.036) : k < 3.5 ? vec3(0.034, 0.036, 0.050) : k < 4.5 ? vec3(0.030, 0.062, 0.050) : k < 5.5 ? vec3(0.038, 0.040, 0.026) : k < 6.5 ? vec3(0.007, 0.031, 0.016) + uHaze * 0.5 : k < 7.5 ? vec3(0.044, 0.040, 0.031) + uHaze * 0.55 + uMoonCol * 0.15 : vec3(0.009, 0.034, 0.030), col, uMix);
  }
#else
  // the canopy's and the grass's grain, band-limited: its finer octave (0.8 m) was below a pixel from a few hundred metres on and crawled like static
  float fw = length(fwidth(vPos.xz));
  float n = 0.55 * vnAA(vPos.xz, 0.30, fw) + 0.45 * vnAA(vPos.xz, 1.3, fw);
  vec3 col;
  if (k < 1.5) { col = vec3(0.016, 0.044, 0.034) * (0.45 + 1.1 * n); col += uAccent * 0.010; }            // park, grass
  else if (k < 2.5) col = waterCol(vPos);                                                                  // water: a dark mirror that holds the glow
  else if (k < 3.5) col = vec3(0.034, 0.036, 0.050) * (0.8 + 0.4 * n);                                    // apron
  else if (k < 4.5) col = vec3(0.030, 0.062, 0.050) * (0.8 + 0.4 * n);                                    // pitch
  else if (k < 5.5) col = vec3(0.038, 0.040, 0.026) * (0.7 + 0.6 * n);                                    // field
  else if (k < 6.5) { col = vec3(0.007, 0.031, 0.016) * (0.40 + 1.25 * n); col += uHaze * 0.5 + uAccent * 0.004; }   // forest: a darker, bluer green than a park, with a canopy's grain
  else if (k < 7.5) col = vec3(0.044, 0.040, 0.031) * (0.7 + 0.6 * n) + uHaze * 0.55 + uMoonCol * 0.15;                // sand and beaches: the palest ground, but still a dim one, moonlit
  else if (k < 8.5) col = iceCol(n, vPos);                                                                       // ice
  else if (k < 9.5) { col = mix(vec3(0.010, 0.036, 0.034) * (0.5 + 0.9 * n), waterCol(vPos), 0.35); }    // wetland and mud: a green-black that shines a little
  else col = seaIceCol(n, vPos);                                                                            // sea ice (10)
#endif
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- sky ---------------- */
export const SKY_VERT = /* glsl */`varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
export const SKY_FRAG = /* glsl */`
precision highp float;
varying vec2 vNdc;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uZenith;
${COMMON}
#ifdef CITY_DAY
uniform vec3 uSkyMid;              // the band between the horizon's haze and the zenith
#endif
void main() {
  vec4 pv = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(normalize(pv.xyz / pv.w), 0.0)).xyz);
  float e = dir.y;
  vec3 hd = normalize(vec3(dir.x, 0.0, dir.z) + 1e-5);
  vec3 col = mix(fogColor(vec3(hd.x, 0.0, hd.z)), uZenith, pow(smoothstep(-0.02, 0.85, e), 0.55)) + skyGlow(dir) * smoothstep(-0.02, 0.0, e);
  if (e < 0.0) col = fogColor(dir);
  // stars
  if (e > 0.02) {
    vec3 p = dir * 190.0; vec3 c = floor(p); float r = h31(c);
    float star = step(0.9962, r) * smoothstep(0.55, 0.0, length(fract(p) - 0.5));
    float tw = 0.7 + 0.3 * sin(uTime * 0.0 + r * 60.0);
    col += vec3(0.85, 0.88, 1.0) * star * tw * smoothstep(0.02, 0.35, e) * 0.95 * DAYK(1.0);
  }
  // the moon and its halo, high in the north-west
  float dm = dot(dir, uMoonDir);
  col += uMoonCol * (smoothstep(0.99935, 0.99965, dm) * 3.2 + pow(max(dm, 0.0), 220.0) * 0.55 + pow(max(dm, 0.0), 24.0) * 0.06) * DAYK(1.0);
#ifdef CITY_DAY
  if (uMix > 0.0) {
    // a clear sky: the horizon's haze (the fog's own colour, so the land melts into it) through its band to the zenith; the sun's disc and halo
    float up = max(e, 0.0), t1 = smoothstep(0.0, 0.11, up), t2 = smoothstep(0.03, 0.30, up);
    vec3 hz = fogColor(vec3(hd.x, 0.0, hd.z)), dc = mix(mix(hz, uSkyMid, t1), uZenith, t2);
    float ds = max(dot(dir, uSunDir), 0.0);
    dc += uSunCol * uSunI * (smoothstep(0.99982, 0.99992, ds) * 6.0 + pow(ds, 500.0) * 0.5 + pow(ds, 24.0) * 0.07);
    col = mix(col, e < 0.0 ? hz : dc, uMix);
  }
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- roads ---------------- */
export const ROAD_VERT = /* glsl */`
attribute vec4 aR;
varying vec3 vPos;
varying vec4 vR;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; vR = aR; gl_Position = projectionMatrix * (viewMatrix * w); }`;

export const ROAD_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying vec4 vR;
uniform vec3 uWarm;
uniform float uTraffic;
uniform float uLights;             // the street lights (1; 0 in a blackout)
${COMMON}
#ifdef CITY_DAY
uniform vec3 uRoad[2];             // asphalt; a lane's paler surface
#endif
void main() {
  float cls = vR.z, across = vR.x, along = vR.y, hs = vR.w;
#ifdef CITY_DAY
  float fwA = fwidth(across);
#endif
  float dist = length(vPos - cameraPosition);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(across));
  if (cls > 7.5) {      // runway and taxiway
    float cl = cls > 8.5 ? 0.0 : 1.0;
    vec3 c = vec3(0.030, 0.034, 0.046);
#ifdef CITY_DAY
    if (uMix > 0.0) c = mix(c, vec3(0.20, 0.20, 0.195) * uUpDay, uMix);
#endif
    float dash = step(0.5, fract(along / 24.0)) * (1.0 - smoothstep(0.0, 0.06, abs(across)));
    c += vec3(0.9, 0.9, 0.6) * dash * 0.35 * (cls > 8.5 ? 0.6 : 1.0);
    c += vec3(0.1, 0.35, 1.0) * (1.0 - smoothstep(0.88, 0.98, abs(across))) * step(0.5, fract(along / 40.0)) * 0.7 * (1.0 - cl) * DAYK(1.0);   // edge lights
    gl_FragColor = vec4(applyFog(c, vPos), edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec3 asphalt = vec3(0.028, 0.030, 0.040);
#ifdef CITY_DAY
  if (uMix > 0.0) {         // asphalt, lanes paler, a pale kerb along the bigger roads while it can be seen
    vec3 ad = mix(uRoad[0], uRoad[1], smoothstep(4.5, 6.5, cls));
    float kerb = smoothstep(0.74, 0.86, abs(across)) * (1.0 - smoothstep(0.0, 0.7, fwA * 1.6)) * (1.0 - smoothstep(4.5, 5.5, cls));
    asphalt = mix(asphalt, mix(ad, uRoad[1] * 1.5, kerb) * uUpDay, uMix);
  }
#endif
#ifdef CITY_DAY
  vec3 c = asphalt;
  if (uLights > 0.0) {                                         // by day the street lights are off: none of their pools is worked out
#endif
  float big = 1.0 - smoothstep(1.0, 4.5, cls);                 // motorway .. secondary glow most, residential least
  float spacing = cls < 3.5 ? 34.0 : cls < 5.5 ? 40.0 : 60.0;
  float lp = fract(along / spacing + hs * 7.0) - 0.5;
  float pool = exp(-lp * lp * spacing * spacing / 90.0) * (1.0 - smoothstep(0.2, 1.0, abs(across)) * 0.3);
  float core = exp(-across * across * 3.2);
  vec3 sodium = vec3(1.0, 0.50, 0.15);
#ifdef CITY_DAY
  c += sodium * (0.028 + 0.15 * big * core + (0.05 + 0.20 * big) * pool) * (0.9 + 0.2 * uWarm.x) * uLights;
  }
#else
  vec3 c = asphalt + sodium * (0.028 + 0.15 * big * core + (0.05 + 0.20 * big) * pool) * (0.9 + 0.2 * uWarm.x) * uLights;
#endif
  // centre dashes on the main roads
  if (cls < 4.5) c += vec3(0.7, 0.68, 0.6) * (0.10 + DAYV(0.25)) * step(0.5, fract(along / 7.0)) * (1.0 - smoothstep(0.0, 0.05 + 0.5 / max(dist * 0.02, 1.0) * 0.1, abs(across)));
  // traffic: a pair of headlights and tail lights, only while the page is awake
  if (cls < 5.5 && uTraffic > 0.5) {
    float sp = 6.0 + 7.0 * h11(hs * 41.0), dir = across > 0.0 ? 1.0 : -1.0;
    float ph = fract((along * 0.016 + hs * 3.0 + dir * uTime * sp * 0.016));
    float car = smoothstep(0.012, 0.0, abs(ph - 0.5) * 1.0) * step(0.55, h21(vec2(floor((along * 0.016 + hs * 3.0 + dir * uTime * sp * 0.016) ), hs * 9.0)));
    float lane = exp(-pow(abs(across) - 0.45, 2.0) * 40.0);
#ifdef CITY_DAY
    c = mix(c + (dir > 0.0 ? vec3(1.0, 0.95, 0.8) : vec3(1.0, 0.10, 0.06)) * car * lane * 2.4, mix(c, (fract(hs * 91.0 + ph * 3.0) > 0.5 ? vec3(0.75, 0.75, 0.74) : vec3(0.07, 0.07, 0.08)) * uUpDay, car * lane), uMix * (1.0 - uLights));     // by day a car is a car, not its lights
#else
    c += (dir > 0.0 ? vec3(1.0, 0.95, 0.8) : vec3(1.0, 0.10, 0.06)) * car * lane * 2.4;
#endif
  }
  gl_FragColor = vec4(applyFog(c, vPos), edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- the day's shadows (30 October): the near tiles' buildings drawn again, flattened onto the ground along the sun, in one colour that multiplies what is there. The stencil lets a pixel be
   darkened once, however many flattened faces cover it; the flattened walls that turn away from the camera (those on the buildings' far side from the sun) are culled, the rest and the roofs still cover the whole shadow. ---------------- */
export const SHADOW_VERT = /* glsl */`
uniform vec2 uShK;                  // the sun's slope: how far a metre of height throws its shadow in x and z
uniform vec3 uShTint;               // what a shadow multiplies the ground by, at full strength
uniform vec4 uShFade;               // the camera's distance at which they start to fade and are gone; the fog's optical depth a metre, at the camera; the strength
varying vec3 vS;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 p = vec3(w.x - uShK.x * w.y, 0.4, w.z - uShK.y * w.y);
  float d = length(p - cameraPosition);
  vS = mix(vec3(1.0), uShTint, uShFade.w * (1.0 - smoothstep(uShFade.x, uShFade.y, d)) * exp(-uShFade.z * d));
  gl_Position = projectionMatrix * (viewMatrix * vec4(p, 1.0));
}`;
export const SHADOW_FRAG = /* glsl */`
precision highp float;
varying vec3 vS;
void main() { gl_FragColor = vec4(vS, 1.0); }`;

/* ---------------- the trees (30 October): instanced low-poly shapes, day programs only (a night never builds them). A shape's vertices carry a normal between its lobe's and the whole crown's, and (aT) a shade: darker low down and inside, so a crown has an underside. Lit by the same sun, sky and bounce as the walls, with a warm rim against a low sun, and fogged the same way, per vertex; the fragment only adds the leaves' grain. A tree shrinks away by distance (its rank decides how far it reaches, so a stand thins out) and through twilight. ---------------- */
export const TREE_VERT = /* glsl */`
attribute vec2 iP;          // x, z from the tile's middle, 1/20 m
attribute vec4 iB;          // yaw, size, rank, tint (normalized bytes)
attribute vec3 aT;          // shade, this lobe's own tone, 1 on the trunk
uniform vec4 uSp;           // the species: shortest, tallest, width over height, the top of the trunk's colour share
uniform vec3 uCa; uniform vec3 uCb; uniform vec3 uTrunk;
uniform vec2 uTreeRange;    // how far the first-ranked tree reaches; the arrival and twilight's scale
uniform vec3 uBounce;
varying vec3 vC; varying vec4 vF; varying vec3 vW;
#define COMMON_IN_VERTEX
${COMMON}
void main() {
  vec3 base = (modelMatrix * vec4(iP.x * 0.05, 0.0, iP.y * 0.05, 1.0)).xyz, rel0 = base - cameraPosition;
  float d0 = length(rel0), reach = uTreeRange.x * (1.0 - 0.72 * iB.z), k = (1.0 - smoothstep(0.72 * reach, reach, d0)) * uTreeRange.y;
  float a = iB.x * 6.2831853, sa = sin(a), ca = cos(a), hgt = mix(uSp.x, uSp.y, iB.y) * k, wid = hgt * uSp.z * (0.84 + 0.32 * fract(iB.x * 7.31));
  vec3 q = vec3(position.x * wid, position.y * hgt, position.z * wid), P = vec3(ca * q.x + sa * q.z, q.y, -sa * q.x + ca * q.z), w = base + P;
  vec3 N = normalize(vec3(ca * normal.x + sa * normal.z, normal.y, -sa * normal.x + ca * normal.z));
  float ndl = dot(N, uSunDir), tone = 0.82 + 0.36 * aT.y;
  vec3 lit = uSunCol * uSunI * max(ndl * 0.86 + 0.14, 0.0) * mix(0.55, 1.0, aT.x) + uSkyCol * (0.42 + 0.34 * N.y) + uBounce * (0.26 * max(-N.y, 0.0) + 0.08);
  vec3 alb = mix(mix(uCa, uCb, iB.w) * tone, uTrunk, aT.z);
  vec3 col = alb * lit * mix(aT.x, 1.0, aT.z * 0.6);
  // against a low sun the crown's edge catches it
  vec3 rel = w - cameraPosition; float dd = length(rel); vec3 V = rel / max(dd, 1e-3);
  float rim = pow(1.0 - clamp(dot(N, -V), 0.0, 1.0), 3.0) * max(dot(V, uSunDir), 0.0) * (1.0 - aT.z);
  col += alb * uSunCol * uSunI * rim * 1.1;
  // the fog, as applyFogRel, per vertex
  float kf = uFogK, dy = rel.y, t = abs(kf * dy) < 1e-3 ? 1.0 : (1.0 - exp(-kf * dy)) / (kf * dy), x = (uFogD * uFogCam * t + uFogBase) * dd; x += 4.0 * x * x * uMix;
  vC = col; vF = vec4(fogColor(V), clamp(1.0 - exp(-x), 0.0, 1.0)); vW = w;
  gl_Position = projectionMatrix * (viewMatrix * vec4(w, 1.0));
}`;
export const TREE_FRAG = /* glsl */`
precision highp float;
varying vec3 vC; varying vec4 vF; varying vec3 vW;
uniform sampler2D uNoise;
uniform vec3 uAltK;
uniform float uMix;
void main() {
  vec4 n = texture2D(uNoise, (vW.xz + vW.y * vec2(0.6, -0.4)) * 0.11);
  vec3 c = vC * (0.58 + 0.46 * n.r + 0.38 * n.g);
  gl_FragColor = vec4(mix(c, vF.rgb, vF.a) * mix(vec3(1.0), uAltK, uMix), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
/* a far tree (31 October): one dot, top-lit, standing at the crown. It takes over from its tree over the distance the tree shrinks away, and thins out by rank beyond the view the city opens at */
export const TREE_FAR_VERT = /* glsl */`
attribute vec4 iB;          // yaw, size, rank, tint (normalized bytes)
uniform vec4 uSp; uniform vec3 uCa; uniform vec3 uCb;
uniform vec2 uTreeRange;    // how far the first-ranked tree reaches; the arrival and twilight's scale
uniform vec4 uFar;          // how far the first-ranked dot reaches, the pixels a metre covers at one metre, the smallest dot, the largest
uniform vec3 uBounce;
varying vec3 vC; varying vec4 vF;
#define COMMON_IN_VERTEX
${COMMON}
void main() {
  float d0 = length(position - cameraPosition), near = uTreeRange.x * (1.0 - 0.72 * iB.z), far = uFar.x * (1.0 - 0.72 * iB.z);
  float k = smoothstep(0.72 * near, near, d0) * (1.0 - smoothstep(0.72 * far, far, d0)) * uTreeRange.y;
  float hgt = mix(uSp.x, uSp.y, iB.y), wid = hgt * uSp.z * (0.84 + 0.32 * fract(iB.x * 7.31)), px = clamp(wid * uFar.y / max(d0, 1.0), uFar.z, uFar.w) * k;
  if (px < 0.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 w = position + vec3(0.0, hgt * 0.62, 0.0), rel = w - cameraPosition; float dd = length(rel); vec3 V = rel / max(dd, 1e-3);
  vec3 lit = uSunCol * uSunI * max(uSunDir.y * 0.86 + 0.14, 0.0) * 0.86 + uSkyCol * 0.76 + uBounce * 0.08;
  float kf = uFogK, dy = rel.y, t = abs(kf * dy) < 1e-3 ? 1.0 : (1.0 - exp(-kf * dy)) / (kf * dy), x = (uFogD * uFogCam * t + uFogBase) * dd; x += 4.0 * x * x * uMix;
  vC = mix(uCa, uCb, iB.w) * (0.82 + 0.36 * fract(iB.x * 3.7)) * lit * 0.68; vF = vec4(fogColor(V), clamp(1.0 - exp(-x), 0.0, 1.0));
  gl_PointSize = px;
  gl_Position = projectionMatrix * (viewMatrix * vec4(w, 1.0));
}`;
export const TREE_FAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vC; varying vec4 vF;
uniform vec3 uAltK;
uniform float uMix;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  if (dot(p, p) > 0.25) discard;
  vec3 c = vC * mix(1.2, 0.5, p.y + 0.5);
  gl_FragColor = vec4(mix(c, vF.rgb, vF.a) * mix(vec3(1.0), uAltK, uMix), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
/* a tree's shadow: its simplest shape, flattened onto the ground along the sun, in the same pass as the buildings' (the stencil lets a pixel be darkened once) */
export const SHADOW_TREE_VERT = /* glsl */`
attribute vec2 iP; attribute vec4 iB;
uniform vec4 uSp; uniform vec2 uTreeRange;
uniform vec2 uShK; uniform vec3 uShTint; uniform vec4 uShFade; uniform float uShR;
varying vec3 vS;
void main() {
  vec3 base = (modelMatrix * vec4(iP.x * 0.05, 0.0, iP.y * 0.05, 1.0)).xyz;
  float d0 = length(base - cameraPosition), reach = min(uTreeRange.x * (1.0 - 0.72 * iB.z), uShR), k = (1.0 - smoothstep(0.72 * reach, reach, d0)) * uTreeRange.y;
  float a = iB.x * 6.2831853, sa = sin(a), ca = cos(a), hgt = mix(uSp.x, uSp.y, iB.y) * k, wid = hgt * uSp.z * (0.84 + 0.32 * fract(iB.x * 7.31));
  vec3 q = vec3(position.x * wid, position.y * hgt, position.z * wid), w = base + vec3(ca * q.x + sa * q.z, q.y, -sa * q.x + ca * q.z);
  vec3 p = vec3(w.x - uShK.x * w.y, 0.4, w.z - uShK.y * w.y);
  float d = length(p - cameraPosition);
  vS = mix(vec3(1.0), uShTint, uShFade.w * (1.0 - smoothstep(uShFade.x, uShFade.y, d)) * exp(-uShFade.z * d));
  gl_Position = projectionMatrix * (viewMatrix * vec4(p, 1.0));
}`;

/* ---------------- lamps (points) ---------------- */
export const LAMP_VERT = /* glsl */`
attribute float aSeed;
uniform float uScale;
varying float vA;
varying vec3 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz;
  vec4 mv = viewMatrix * w;
  float d = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 5.0 / max(d, 1.0) * (0.7 + 0.6 * aSeed), 1.6, 9.0);
  vA = (1.0 - smoothstep(1800.0, 4200.0, d)) * (0.55 + 0.45 * aSeed);
}`;
export const LAMP_FRAG = /* glsl */`
precision highp float;
varying float vA;
varying vec3 vPos;
uniform float uGain;                // the street lamps' share of the city's lights (0 in a blackout); 1 for the trains' and places' points
${COMMON}
void main() {
  vec2 p = gl_PointCoord - 0.5; float r = length(p) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, r)); a *= a;
  vec3 c = vec3(1.0, 0.66, 0.30) * 1.5;
  gl_FragColor = vec4(applyFog(c, vPos) * a * vA * uGain, a * vA * uGain);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- the elevated metro: deck, pillars, trains ---------------- */
export const DECK_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying vec4 vR;
uniform float uTrack;
${COMMON}
void main() {
  float across = vR.x, along = vR.y;
  vec3 c = vec3(0.060, 0.062, 0.078);
#ifdef CITY_DAY
  if (uMix > 0.0) c = mix(c, vec3(0.42, 0.41, 0.39) * uUpDay, uMix);
#endif
  float lite = smoothstep(0.78, 0.92, abs(across)) * (1.0 - smoothstep(0.96, 1.0, abs(across)));
  c += uAccent * lite * 1.35 * DAYK(0.85);                                                       // the guide-light along both edges of the deck
  c += vec3(0.55, 0.65, 1.0) * 0.18 * (1.0 - smoothstep(0.0, 0.07, abs(abs(across) - 0.32))) * step(0.5, fract(along / 3.0)); // the rails
  gl_FragColor = vec4(applyFog(c, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const SOLID_VERT = /* glsl */`
varying vec3 vPos;
varying vec3 vN;
void main() {
  #ifdef USE_INSTANCING
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  #else
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  #endif
  vPos = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w);
}`;
export const PILLAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying vec3 vN;
${COMMON}
void main() {
  vec3 c = vec3(0.040, 0.042, 0.054) * (uMoonCol * max(dot(vN, uMoonDir), 0.0) * 2.0 + uHaze * 0.9 + 0.2);
  c += vec3(1.0, 0.56, 0.22) * 0.05 * (1.0 - smoothstep(0.0, 12.0, vPos.y)) * DAYK(1.0);
#ifdef CITY_DAY
  if (uMix > 0.0) c = mix(c, vec3(0.46, 0.45, 0.43) * (uSunCol * uSunI * max(dot(vN, uSunDir) * 0.9 + 0.1, 0.0) + uSkyCol * (0.5 + 0.3 * vN.y)), uMix);
#endif
  gl_FragColor = vec4(applyFog(c, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export const TRAIN_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying vec3 vN;
uniform vec3 uTrainDir;
${COMMON}
void main() {
  // car windows as a lit band, the head light a flare at the leading face
  float along = dot(vPos, uTrainDir) / 22.0;
  float band = smoothstep(0.38, 0.45, fract(along)) * (1.0 - smoothstep(0.88, 0.95, fract(along)));
  float wy = smoothstep(2.0, 2.3, vPos.y - 9.2) * (1.0 - smoothstep(3.3, 3.6, vPos.y - 9.2));
  vec3 body = vec3(0.10, 0.11, 0.14);
#ifdef CITY_DAY
  if (uMix > 0.0) body = mix(body, vec3(0.62, 0.63, 0.66) * (uSunCol * uSunI * max(dot(vN, uSunDir) * 0.9 + 0.1, 0.0) + uSkyCol * (0.5 + 0.3 * vN.y)), uMix);
#endif
  vec3 c = body + vec3(1.0, 0.92, 0.72) * band * wy * 1.8 * DAYK(0.75) + uAccent * 0.28 * (1.0 - smoothstep(0.0, 1.0, abs(vPos.y - 9.4 - 0.4))) * DAYK(0.8);
  gl_FragColor = vec4(applyFog(c, vPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- the places: a beam of light and a ring on the ground ---------------- */
export const BEAM_VERT = /* glsl */`
attribute float aState;
varying vec3 vPos;
varying float vY;
varying float vState;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vPos = w.xyz; vY = position.y; vState = aState;
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;
export const BEAM_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying float vY;
varying float vState;
${COMMON}
void main() {
  float a = pow(1.0 - clamp(vY, 0.0, 1.0), 1.6) * (0.55 + 0.9 * vState) * DAYK(0.72);
  vec3 c = mix(uAccent, vec3(1.0), 0.35 + 0.35 * vState) * 1.6;
  gl_FragColor = vec4(applyFog(c, vPos) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- the tear's ring: a disc drawn only along one circle (a thin line, a pixel or two wide at any distance) ---------------- */
export const RING_VERT = /* glsl */`
varying vec3 vPos;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;
export const RING_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
uniform vec2 uC;
uniform float uR;
uniform vec3 uCol;
uniform float uDash;
void main() {
  vec2 q = vPos.xz - uC;
  float r = length(q);
  float w = max(fwidth(r) * 1.25, 2.2);
  float d = abs(r - uR);
  if (d > w * 1.7) discard;
  float a = 1.0 - smoothstep(w * 0.45, w * 1.5, d);
  if (uDash > 0.5) a *= step(0.5, fract(atan(q.y, q.x) * (28.0 / 6.2831853)));
  gl_FragColor = vec4(uCol * a * 0.9, a * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- the tear's column of light: a beacon from afar that thins to almost nothing as the camera comes within about a kilometre, its edges soft (bright where the column faces the camera,
   gone at its silhouette), so that close by it is a haze of light and not a glass pillar ---------------- */
export const COLUMN_VERT = /* glsl */`
varying vec3 vPos;
varying float vY;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz; vY = position.y; vN = normalize(mat3(modelMatrix) * vec3(position.x, 0.0, position.z));
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;
export const COLUMN_FRAG = /* glsl */`
precision highp float;
varying vec3 vPos;
varying float vY;
varying vec3 vN;
uniform vec2 uC;                    // the column's foot (x, z)
uniform vec2 uFade;                 // the camera's distance from the column at which it is gone, and at which it is whole
uniform float uGain;
${COMMON}
void main() {
  vec3 v = cameraPosition - vPos; vec2 h = normalize(v.xz + 1e-5);
  float facing = abs(dot(normalize(vN.xz + 1e-5), h));                       // 1 down the middle of the column as seen, 0 at its edges
  float far = smoothstep(uFade.x, uFade.y, length(cameraPosition.xz - uC));
  float a = pow(1.0 - clamp(vY, 0.0, 1.0), 1.6) * pow(facing, 2.4) * far * uGain;
  vec3 c = mix(uAccent, vec3(1.0), 0.28) * 1.6;
  gl_FragColor = vec4(applyFog(c, vPos) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- trails: screen-space ribbons (fat lines) with a flowing gradient and a comet head ---------------- */
export const TRAIL_VERT = /* glsl */`
attribute vec3 aPrev;
attribute vec3 aNext;
attribute vec4 aT;          // side, distance along (m), path index, lane offset sign
attribute vec3 aColor;
uniform vec2 uRes;
uniform float uWidth;
uniform float uPx;
varying vec4 vT;
varying vec3 vColor;
varying vec3 vPos;
void main() {
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c = vp * modelMatrix * vec4(position, 1.0);
  vec4 p = vp * modelMatrix * vec4(aPrev, 1.0);
  vec4 n = vp * modelMatrix * vec4(aNext, 1.0);
  vec2 sc = uRes * 0.5;
  vec2 cs = c.xy / c.w * sc, ps = p.xy / p.w * sc, ns = n.xy / n.w * sc;
  vec2 d1 = cs - ps, d2 = ns - cs;
  vec2 dir = normalize((length(d1) > 1e-4 ? normalize(d1) : vec2(0.0)) + (length(d2) > 1e-4 ? normalize(d2) : vec2(0.0)) + 1e-5 * vec2(1.0, 0.0));
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = uWidth * uPx;
  vec2 off = nrm * aT.x * wpx * 0.5;
  gl_Position = c; gl_Position.xy += off / sc * c.w;
  vT = aT; vColor = aColor; vPos = (modelMatrix * vec4(position, 1.0)).xyz;
}`;

export const TRAIL_FRAG = /* glsl */`
precision highp float;
varying vec4 vT;
varying vec3 vColor;
varying vec3 vPos;
uniform float uPass;               // 0 the line, 1 its halo, 2 the ghost seen through buildings
uniform vec4 uState[48];           // per path: visible (0..1), highlight (0..1), head distance (m, -1 = whole), length (m)
uniform float uFlow;
${COMMON}
void main() {
  int pi = int(vT.z + 0.5);
  vec4 st = uState[pi];
  float vis = st.x; if (vis < 0.01) discard;
  float d = vT.y, across = vT.x;
  float body = 1.0 - smoothstep(0.35, 1.0, abs(across));
  float head = st.z, tail = 1.0;
  float a = 1.0, comet = 0.0;
  if (head >= 0.0) {                                     // a replay: the part the head has passed stays lit, the head burns
    float behind = head - d;
    if (behind < 0.0) a = 0.0; else {
      comet = exp(-behind / 38.0);
      a = 0.34 + 0.66 * comet;
    }
    float hd = exp(-pow((d - head) / 15.0, 2.0)); comet = max(comet * 0.85, hd * 1.35);
    a *= smoothstep(0.0, 2.0, head - d + 2.0);
  } else {
    float flow = fract((d - uTime * 46.0 * uFlow) / 120.0);
    a = 0.55 + 0.45 * pow(1.0 - flow, 3.0) * uFlow + 0.45 * (1.0 - uFlow);
    comet = 0.0;
  }
  float hl = st.y;
  vec3 col = vColor * (1.0 + 1.5 * comet + 0.9 * hl);
#ifdef CITY_DAY
  col = mix(col, vColor * vColor * (0.72 + 1.5 * comet + 0.9 * hl), uMix);
#endif
  float alpha;
  if (uPass < 0.5) { alpha = body * a * vis * (0.9 + 0.1 * hl); col += vec3(1.0) * comet * 0.9;
#ifdef CITY_DAY
    alpha = mix(alpha, min(alpha * 1.6, body * vis), uMix);     // by day the line is solid: on bright ground a thin colour does not read
#endif
  }
  else if (uPass < 1.5) { float g = exp(-across * across * 1.8); alpha = g * a * vis * (0.26 + 0.35 * hl + 1.0 * comet); }
  else { alpha = body * a * vis * 0.20; }
  if (alpha < 0.004) discard;
#ifdef CITY_DAY
  if (uPass > 0.5 && uPass < 1.5) { gl_FragColor = vec4(mix(col, col * 0.16, uMix) * alpha, alpha * 0.55 * uMix); }     // the halo: light by night, a soft dark casing by day
  else
#endif
  gl_FragColor = vec4(col * alpha, uPass < 1.5 ? alpha * (uPass < 0.5 ? 1.0 : 0.0) : alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* the dive's motion blur (29 October): the frame just drawn (copied to uTex) is averaged along the line from each pixel towards the middle of the view, over uAmount of the way, which is what a fast
   move straight ahead does to the picture. A per-pixel offset of the taps (interleaved gradient noise) turns their banding into a fine grain. It writes the copied colours back as they were drawn: no tone
   mapping, no colour conversion, no blending. The globe (atlas.js) carries the same few lines. */
export const BLUR_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex; uniform float uAmount;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < TAPS; i++) { float t = (float(i) + j) / float(TAPS); acc += texture2D(uTex, 0.5 + d * (1.0 - uAmount * t)); }
  gl_FragColor = acc / float(TAPS);
}`;

/* ---------- the tear in the sky (5 November 2026; the author's pick of 4 November, made in the story lab on 31 October and 1 November) ----------
   One quad and one shader. The quad hangs fixed in the air over the tear (it turns only as the camera goes round it), its face looking down at the city by a pitch, its long axis leaning
   by a roll. The slit is a polygon (seeded per city: bends, barbs, uneven lips) measured in the shader as a distance, so its edge stays hard at any zoom; what shows through it (the author's
   look B: an open cosmos, nebula in violet, blue and gold, dense stars) is looked up by the view's direction, like a window. Nothing in it moves with time, so it costs no frames at rest. */
export const TEAR_MAXP = 64, TEAR_MAXH = 12;
function tearRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// the outline: a spine of bends from the lower needle to the upper, a lip either side at its own width, notches between the bends and a few barbs (local metres: u across, v along, 0 at the middle)
export function tearShape(seed, L, ratio) {
  const R = tearRng(seed * 7919 + 13), S = 10, peak = 0.38, expo = 1.5, Wmax = L / ratio / 2;
  const lean = (R() < 0.5 ? -1 : 1) * (0.015 + R() * 0.02) * L, sp = [];
  let sg = R() < 0.5 ? -1 : 1;
  for (let i = 0; i <= S; i++) {
    const t = i / S, edge = i === 0 || i === S, jt = edge ? t : Math.min(0.97, Math.max(0.03, t + (R() - 0.5) * 0.06));
    const kink = edge ? 0 : sg * L * (0.014 + 0.05 * R()) * Math.sin(Math.PI * t) ** 0.7;
    sg = R() < 0.78 ? -sg : sg;
    sp.push({ t: jt, p: [kink + (jt - 0.5) * lean, (jt - 0.5) * L] });
  }
  const pw = Math.log(0.5) / Math.log(peak), hw = (t) => Wmax * Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, t)), pw)) ** expo;
  const dirAt = (i) => { const a = sp[Math.max(0, i - 1)].p, b = sp[Math.min(S, i + 1)].p, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const segDir = (i) => { const a = sp[i].p, b = sp[i + 1].p, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const side = (sgn) => {
    const pts = [];
    for (let i = 0; i < S; i++) {
      if (i > 0) { const d = dirAt(i), n = [-d[1] * sgn, d[0] * sgn], w = hw(sp[i].t) * (0.7 + 0.55 * R()); pts.push({ p: [sp[i].p[0] + n[0] * w, sp[i].p[1] + n[1] * w], bend: sp[i].t > 0.16 && sp[i].t < 0.86, n, d }); }
      const a = sp[i], b = sp[i + 1], tau = 0.28 + 0.44 * R(), d = segDir(i), n = [-d[1] * sgn, d[0] * sgn];
      const tm = a.t + (b.t - a.t) * tau, wm = hw(tm) * (i % 3 === 1 ? 0.55 + 0.4 * R() : 0.8 + 0.7 * R());
      pts.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * tau + n[0] * wm, a.p[1] + (b.p[1] - a.p[1]) * tau + n[1] * wm] });
    }
    return pts;
  };
  const hair = [];
  const barb = (arr, pickN) => {
    const cand = []; arr.forEach((q, k) => { if (q.bend) cand.push(k); });
    const chosen = new Set(); while (chosen.size < Math.min(pickN, cand.length)) chosen.add(cand[Math.floor(R() * cand.length)]);
    const out = [];
    arr.forEach((q, k) => {
      if (!chosen.has(k)) { out.push(q.p); return; }
      const toward = q.p[1] > 0 ? 1 : -1, len = L * (0.022 + 0.034 * R()), ph = 0.35 + 0.5 * R();
      const dv = [q.d[0] * toward * Math.sin(ph) + q.n[0] * Math.cos(ph), q.d[1] * toward * Math.sin(ph) + q.n[1] * Math.cos(ph)], bw = L * (0.0016 + 0.0014 * R());
      const e = q.p, tip = [e[0] + dv[0] * len, e[1] + dv[1] * len];
      out.push([e[0] - q.d[0] * bw * 2.4, e[1] - q.d[1] * bw * 2.4], tip, [e[0] + q.d[0] * bw * 0.9, e[1] + q.d[1] * bw * 0.9]);
      if (hair.length < TEAR_MAXH - 3) hair.push([tip[0], tip[1], tip[0] + dv[0] * len * 0.7, tip[1] + dv[1] * len * 0.7]);
    });
    return out;
  };
  const left = side(1), right = side(-1), lp = barb(left, 3), rp = barb(right, 3);
  const poly = [sp[0].p, ...lp, sp[S].p, ...rp.slice().reverse()];
  const e0 = sp[0].p, e1 = sp[S].p, d0 = segDir(0), d1 = segDir(S - 1);
  hair.push([e0[0], e0[1], e0[0] - d0[0] * L * 0.13, e0[1] - d0[1] * L * 0.13]);
  hair.push([e1[0], e1[1], e1[0] + d1[0] * L * 0.13, e1[1] + d1[1] * L * 0.13]);
  for (let k = 0; k < 4 && hair.length < TEAR_MAXH; k++) {
    const i = 2 + Math.floor(R() * (S - 3)), sgn = R() < 0.5 ? 1 : -1, d = dirAt(i), n = [-d[1] * sgn, d[0] * sgn], w = hw(sp[i].t) * 0.95, len = L * (0.02 + 0.03 * R());
    const o = [sp[i].p[0] + n[0] * w, sp[i].p[1] + n[1] * w], ang = (R() - 0.5) * 1.1, c = Math.cos(ang), sn = Math.sin(ang), nn = [n[0] * c - n[1] * sn, n[0] * sn + n[1] * c];
    hair.push([o[0], o[1], o[0] + nn[0] * len, o[1] + nn[1] * len]);
  }
  return { poly: poly.slice(0, TEAR_MAXP), hair: hair.slice(0, TEAR_MAXH), Wmax, L };
}
export const TEAR_VERT = /* glsl */`
uniform vec3 uAnchor; uniform vec2 uHalf; uniform float uCy; uniform float uPitch; uniform float uRoll; uniform vec2 uFace;
varying vec2 vUV; varying vec3 vW; varying vec3 vR; varying vec3 vUp; varying vec3 vN; varying vec2 vP;
void main() {
  vec3 C = vec3(uAnchor.x, uCy, uAnchor.z);
  vec3 nh = normalize(vec3(uFace.x, 0.0, uFace.y)), r = normalize(cross(vec3(0.0, 1.0, 0.0), nh));
  vec3 n = normalize(nh * cos(uPitch) - vec3(0.0, 1.0, 0.0) * sin(uPitch));          // its face looks down by the pitch: the top leans in over the city
  r = normalize(r - n * dot(r, n));
  vec3 up = cross(n, r);
  float ca = cos(uRoll), sa = sin(uRoll);
  vec3 r2 = r * ca + up * sa, up2 = up * ca - r * sa;                                   // the long axis leans off the vertical by the roll
  vec2 q = position.xy * uHalf;
  vec3 w = C + r2 * q.x + up2 * q.y;
  vUV = q; vP = position.xy; vW = w; vR = r2; vUp = up2; vN = n;
  gl_Position = projectionMatrix * (viewMatrix * vec4(w, 1.0));
}`;
export const TEAR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUV; varying vec3 vW; varying vec3 vR; varying vec3 vUp; varying vec3 vN; varying vec2 vP;
uniform vec2 uP[${TEAR_MAXP}]; uniform vec4 uHair[${TEAR_MAXH}];
uniform float uHW; uniform float uL; uniform float uSeed; uniform float uReach; uniform float uLean; uniform float uShow; uniform int uN;
${COMMON}
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int n) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { if (i >= n) break; s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float sdPoly(vec2 p) {          // the distance to the outline (negative inside), over its uN corners only
  float d = dot(p - uP[0], p - uP[0]), s = 1.0;
  for (int i = 0; i < ${TEAR_MAXP}; i++) {
    if (i >= uN) break;
    int j = i == 0 ? uN - 1 : i - 1;
    vec2 e = uP[j] - uP[i], w = p - uP[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uP[i].y, p.y < uP[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
float sdSeg(vec2 p, vec4 s) { vec2 a = s.xy, b = s.zw, e = b - a, w = p - a; float t = clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0); return length(w - e * t); }
// stars at infinity, a grid on each face of a cube round the viewer: a point (never wider than its pixel), a colour from its own temperature
vec4 stars(vec3 d, float scale, float dens, float rad, float seed) {
  vec3 a = abs(d); float m = max(a.x, max(a.y, a.z)); vec2 uv; float face;
  if (a.x >= m) { uv = d.zy / m; face = d.x > 0.0 ? 0.0 : 1.0; } else if (a.y >= m) { uv = d.xz / m; face = d.y > 0.0 ? 2.0 : 3.0; } else { uv = d.xy / m; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 p = uv * scale; float px = length(fwidth(p)); vec2 c = floor(p), f = p - c;
  float r = h21(c * 1.13 + face * 31.7 + seed);
  if (r > dens) return vec4(0.0);
  vec2 sp = vec2(h21(c * 1.7 + face + seed + 3.1), h21(c * 2.3 + face + seed + 9.7)) * 0.66 + 0.17;
  float size = max(rad, px * 0.85), dd = length(f - sp) / size;
  float k = max(1.0 - dd, 0.0); k *= k;
  float mag = pow(h21(c + seed + 5.5), 2.2), temp = h21(c * 3.1 + seed);
  vec3 tint = mix(mix(vec3(0.62, 0.74, 1.0), vec3(1.0), smoothstep(0.0, 0.5, temp)), vec3(1.0, 0.82, 0.55), smoothstep(0.55, 1.0, temp));
  return vec4(tint * k * (0.35 + 1.9 * mag) * min(1.0, rad / size + 0.25), k);
}
vec3 cosmos(vec3 d, float env) {            // the author's look B: an open cosmos, nebula in violet, blue and gold, dust lanes, dense stars
  vec3 q = d * 4.2 + uSeed;
  vec3 w = vec3(fbm(q * 1.2 + 3.0, 3), fbm(q * 1.2 + 11.0, 3), fbm(q * 1.2 + 23.0, 3));
  q += (w - 0.5) * 2.1;
  float n1 = fbm(q, 5), n2 = fbm(q * 1.9 + 7.0, 4), n3_ = fbm(q * 0.8 - 4.0, 3);
  vec3 col = vec3(0.012, 0.010, 0.045);
  col = mix(col, vec3(0.36, 0.12, 0.80) * 0.85, smoothstep(0.28, 0.72, n1) * (0.5 + 0.7 * n3_));
  col += vec3(0.10, 0.26, 0.95) * 0.7 * smoothstep(0.42, 0.85, n2) * (0.35 + 0.8 * n3_);
  col += vec3(1.0, 0.60, 0.20) * 1.7 * pow(smoothstep(0.46, 0.84, n1 * 0.55 + n2 * 0.55), 1.4);
  col += vec3(0.95, 0.30, 0.62) * 0.35 * pow(smoothstep(0.55, 0.9, n2 * n3_ * 1.9), 1.5);
  float lane = fbm(q * 2.3 + 31.0, 4); col *= 1.0 - 0.72 * smoothstep(0.50, 0.70, lane);
  col *= 0.55 + 0.9 * env;
  col += stars(d, 46.0, 0.34, 0.036, uSeed).rgb * 1.5 + stars(d, 118.0, 0.50, 0.032, uSeed + 3.0).rgb * 0.8 + stars(d, 19.0, 0.10, 0.04, uSeed + 8.0).rgb * 2.6;
  return col;
}
void main() {
  vec2 q = vUV;
  float pw = max(length(fwidth(q)) * 0.7071, 0.05);
  // the edge: the outline's distance, roughened where the pixels are fine enough to show it
  float d = sdPoly(q);
  d += ((n3(vec3(q * 0.115, uSeed)) - 0.5) * 7.0 + (n3(vec3(q * 0.031, uSeed + 4.0)) - 0.5) * 16.0) * clamp(1.0 - pw / 14.0, 0.0, 1.0);
  float aa = pw * 0.8, inside = 1.0 - smoothstep(-aa, aa, d), out_d = max(d, 0.0), dayF = uDay;
  // what lies behind the opening, looked up by the view's direction
  vec3 dir = normalize(vW - cameraPosition);
  float env = exp(-pow(q.y / (uL * 0.36), 2.0));
  vec3 inner = inside > 0.001 ? cosmos(dir, env) * mix(0.4, 1.0, smoothstep(0.0, 18.0, -d)) : vec3(0.0);      // the cosmos only where it shows; the needles fade to the dark
  // the light about it: a rim, a halo, hairline splits, and the sky about it leaning in (strands pulled towards the line, dense at its lips)
  float halo = exp(-out_d / (0.10 * uHW + 22.0));
  float rimW = max(pw * 1.05, 5.0), rim = exp(-out_d / rimW), rimIn = exp(-max(-d, 0.0) / (rimW * 1.2)) * 0.28;
  float hair = 0.0;
  for (int i = 0; i < ${TEAR_MAXH}; i++) { float dd = sdSeg(q, uHair[i]); hair = max(hair, (1.0 - smoothstep(pw * 0.4, pw * 1.5 + 2.0, dd)) * 0.85); }
  hair *= 0.5 + 0.5 * exp(-out_d / (0.5 * uHW + 120.0));
  float pull = exp(-out_d / uReach);
  float lu = q.x + sign(q.x + 1e-3) * pull * (uHW * 0.9 + 0.9 * uReach + 60.0);
  float lv = q.y + sign(q.y + 1e-3) * pull * (0.5 * uHW + 0.5 * uReach + 30.0) * smoothstep(0.0, 0.2 * uL, abs(q.y));
  float st1 = n3(vec3(lu * 0.004, lv * 0.022, uSeed)), st2 = n3(vec3(lu * 0.009, lv * 0.071, uSeed + 3.0));
  float strand = smoothstep(0.0, 1.0, 1.0 - abs(st1 - 0.5) * 8.0) * smoothstep(0.38, 0.85, st2) * pull * uLean * 0.7;
  float tipPull = smoothstep(uL * 0.62, uL * 0.46, abs(q.y));
  vec3 rimCol = mix(vec3(0.80, 0.62, 1.0), vec3(1.0, 0.95, 0.88), dayF), haloCol = mix(vec3(0.42, 0.22, 1.0), vec3(1.0, 0.93, 0.85), dayF);
  vec3 add = rimCol * rim * 1.9 + haloCol * halo * (0.22 + 0.16 * (1.0 - dayF)) * (1.0 - smoothstep(0.0, aa, -d) * 0.5) + rimCol * hair * 0.7 + haloCol * strand * mix(0.55, 0.30, dayF) * tipPull;
  vec2 ef = abs(vP); add *= (1.0 - smoothstep(0.55, 0.98, ef.x)) * (1.0 - smoothstep(0.72, 0.99, ef.y));
  add *= 1.0 - inside;
  add += rimCol * rimIn * rim * inside * 0.5;
  float backK = dot(cameraPosition - vW, vN) > 0.0 ? 1.0 : 0.45;                   // from behind the sheet the opening is dimmer
  vec3 rgb = inner * inside * backK;
  float alpha = inside;
  rgb += add;
  // it stands in the air: the haze takes a little of it, more by day
  vec3 f1 = applyFog(vec3(1.0), vW), f0 = applyFog(vec3(0.0), vW);
  float fk = clamp(1.0 - (f1.g - f0.g), 0.0, 1.0);
  vec3 fogc = f0 / max(fk, 1e-3);
  rgb = rgb * (1.0 - fk * 0.30) + (alpha * fogc * fk * 0.18);
  rgb *= uShow; alpha *= uShow;
  if (rgb.r + rgb.g + rgb.b + alpha < 0.0004) discard;
  gl_FragColor = vec4(rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
