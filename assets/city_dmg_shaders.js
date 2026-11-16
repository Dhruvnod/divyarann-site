/* The story's damage on the city (made in the story lab on 31 October 2026, built into the map on 5 November): the shaders the damage mock-up adds. Part of the damage layer (city_damage.js).
   The building program is the city's own (city_shaders.js) with five edits made by string patches, so the lab can be changed without touching the shipping files: a per-vertex damage attribute (aD), a
   rubble / slab / charred-wall / crater / vehicle look for the geometry the lab adds, soot on walls, windows that stay dark in a ruin (and lit in a building with a generator), and the light of the fires.
   The ground, roads and areas get only the fires' light. */

/* the fires' light: up to NFIRE points, each a warm pool that flickers (the flicker is worked out here from the time, so nothing is updated per frame) */
export const FIRE_GLSL = /* glsl */`
#define NFIRE 24
uniform vec4 uFire[NFIRE];          // world position, strength (0 ends the list)
vec3 fireLight(vec3 wp, vec3 N) {
  vec3 acc = vec3(0.0);
  float nightK = 1.0 - uDay;
  if (nightK <= 0.001 || uFire[0].w <= 0.0) return acc;
  for (int i = 0; i < NFIRE; i++) {
    vec4 f = uFire[i];
    if (f.w <= 0.0) break;
    vec3 d = f.xyz - wp; float r2 = dot(d, d);
    float R = 16.0 + 50.0 * f.w;
    if (r2 > R * R * 7.0) continue;
    float fi = float(i);
    float fl = 0.82 + 0.20 * sin(uTime * 9.0 + fi * 2.7) * sin(uTime * 4.3 + fi * 1.3) + 0.08 * sin(uTime * 23.0 + fi * 5.1);
    float fall = exp(-r2 / (R * R)) * 0.85 + 0.15 * exp(-r2 / (R * R * 5.0));
    float ndl = clamp(dot(N, d * inversesqrt(r2 + 1.0)) * 0.6 + 0.4, 0.0, 1.0);
    acc += vec3(1.0, 0.38, 0.075) * (f.w * fl * fall * ndl * 1.0);
  }
  return acc * nightK;
}
`;

/* the rubble look: a function of the world position (so it needs no texture and stays put as the camera moves), band-limited by the pixel's size on the ground so it settles to its mean from afar */
export const SOLID_GLSL = /* glsl */`
uniform float uAlb;
#ifdef CITY_DAY
uniform vec3 uBounce;
#endif
float lab3(vec3 p, float f, float fw) { return vnAA(p.xz + p.y * vec2(1.71, 1.13), f, fw); }
// cls: 1 rubble, 2 slab, 3 charred inner wall, 4 crater earth, 5 car body, 6 car glass, 7 dust / ash
vec3 dmgSolid(float cls, vec3 wp, vec3 N, float fw, vec4 D, vec3 rel) {
  float tone = D.y, soot = D.x, ember = D.z;
  float dist = length(rel);
  float f1 = lab3(wp, 0.27, fw), f2 = lab3(wp + 17.0, 1.05, fw), f3 = lab3(wp + 41.0, 3.7, fw), f4 = lab3(wp + 9.0, 11.0, fw), f5 = lab3(wp + 71.0, 0.09, fw);
  vec3 a;
  if (cls < 1.5) {                                          // rubble: broken concrete, plaster, brick, charred timber and voids
    a = vec3(0.285, 0.275, 0.262) * (0.62 + 0.76 * f2);
    a = mix(a, vec3(0.52, 0.48, 0.42), smoothstep(0.50, 0.78, f1 + (tone - 0.5) * 0.3) * 0.8);
    a = mix(a, vec3(0.34, 0.135, 0.10), smoothstep(0.50, 0.70, f3 + (tone - 0.5) * 0.6) * 0.9);
    a = mix(a, vec3(0.045, 0.043, 0.046), smoothstep(0.58, 0.78, f4 * 0.7 + f5 * 0.3) * 0.65);
    a *= 0.70 + 0.55 * smoothstep(0.30, 0.75, f5);
    a *= 0.82 + 0.36 * tone;
  } else if (cls < 2.5) {                                    // a slab, paler and cleaner
    a = vec3(0.40, 0.385, 0.36) * (0.78 + 0.4 * f2);
    a = mix(a, vec3(0.20, 0.19, 0.18), smoothstep(0.6, 0.85, f4) * 0.6);
  } else if (cls < 3.5) {                                    // the inside of a broken wall: raw, sooty plaster
    a = vec3(0.17, 0.155, 0.14) * (0.6 + 0.8 * f2);
    a = mix(a, vec3(0.04), smoothstep(0.45, 0.8, f1) * 0.6);
  } else if (cls < 4.5) {                                    // crater: scorched earth and ash
    a = vec3(0.060, 0.050, 0.043) * (0.55 + 0.9 * f2);
    a = mix(a, vec3(0.21, 0.19, 0.17), smoothstep(0.62, 0.85, f3) * 0.55 * (1.0 - soot));
    a = mix(a, vec3(0.28, 0.26, 0.23), smoothstep(0.0, 1.0, N.y) * f1 * 0.25);
  } else if (cls < 5.5) {                                    // a car: a paint by its tone, dust on top, burnt where there is soot
    vec3 paint = tone < 0.16 ? vec3(0.62, 0.62, 0.60) : tone < 0.34 ? vec3(0.30, 0.30, 0.32) : tone < 0.5 ? vec3(0.03, 0.03, 0.035) : tone < 0.64 ? vec3(0.38, 0.045, 0.035) : tone < 0.78 ? vec3(0.04, 0.09, 0.26) : tone < 0.9 ? vec3(0.62, 0.50, 0.08) : vec3(0.52, 0.50, 0.44);
    a = paint * (0.85 + 0.3 * f2);
    a = mix(a, vec3(0.30, 0.28, 0.25), smoothstep(0.2, 0.9, N.y) * 0.45);
    a = mix(a, vec3(0.035, 0.03, 0.028) + vec3(0.12, 0.05, 0.02) * smoothstep(0.6, 0.85, f3), soot);
  } else if (cls < 6.5) {                                    // glass: dark, a little sky in it
    a = vec3(0.018, 0.022, 0.03) + uSkyCol * 0.05;
  } else a = vec3(0.34, 0.325, 0.30) * (0.7 + 0.5 * f2);   // ash, dust
  a *= 1.0 - 0.62 * soot * (0.55 + 0.45 * f2) * step(cls, 3.5);
  // lit like the buildings round it: the key light (the sun, or the moon), the sky, the capital's glow, the ground's bounce
  float nl = max(dot(N, uSunDir) * 0.85 + 0.15, 0.0);
  vec3 lit = uSunCol * uSunI * nl + uSkyCol * (0.40 + 0.28 * N.y) + uGlowCol * max(dot(N.xz, uGlowDir.xz), 0.0) * 0.9 * (1.0 - uDay);
#ifdef CITY_DAY
  lit += uBounce * (1.0 - N.y) * 0.55 * uMix;
#endif
  vec3 col = a * uAlb * lit;
  // embers in a ruin that still burns: a few deep-red specks, only in the dark
  if (ember > 0.0 && (cls < 2.5 || (cls > 3.5 && cls < 4.5))) col += vec3(1.0, 0.30, 0.05) * smoothstep(0.70, 0.92, f3 * f4 * 1.6 + 0.12 * f2) * ember * (1.0 - uDay) * 1.6;
  return col;
}
`;

/* edits to the city's building program (its vertex and fragment shader strings) */
export function patchBuilding(vert, frag) {
  const need = (s, a) => { if (!s.includes(a)) throw new Error("building shader: cannot find " + a.slice(0, 50)); };
  let v = vert, f = frag;
  need(v, "attribute float aU;"); v = v.replace("attribute float aU;", "attribute float aU;\nattribute vec4 aD;\nvarying vec4 vD;");
  need(v, "vC = vec4(col, spill);"); v = v.replace("vC = vec4(col, spill);", "vC = vec4(col, spill); vD = aD;");
  need(f, "varying vec4 vC;"); f = f.replace("varying vec4 vC;", "varying vec4 vC;\nvarying vec4 vD;");
  need(f, "void main() {"); f = f.replace("void main() {", FIRE_GLSL + SOLID_GLSL + "\nvoid main() {");
  // derivatives are taken first, in uniform control flow; then the lab's solids leave early
  const a1 = "float fy = fwidth(y), fu = fwidth(u);";
  need(f, a1);
  f = f.replace(a1, a1 + `
  vec3 wpos = rel + cameraPosition;
  vec3 fN = normalize(cross(dFdx(rel), dFdy(rel))); fN = faceforward(fN, rel, fN);
  float fwm = length(fwidth(wpos));
  float dcl = floor(vD.w * 8.0 + 0.5);
  if (dcl > 0.5) {
    float dist = length(rel);
    vec3 Ns = normalize(mix(fN, vec3(0.0, 1.0, 0.0), smoothstep(160.0, 1100.0, dist) * (dcl < 2.5 || dcl > 3.5 ? 0.85 : 0.5)));
    vec3 sc = dmgSolid(dcl, wpos, Ns, fwm, vD, rel);
    sc += fireLight(wpos, Ns) * (dcl > 4.5 && dcl < 6.5 ? 0.30 : 0.27);
    gl_FragColor = vec4(applyFogRel(sc, rel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }`);
  // a wall: soot in streaks above the windows, the lights of a ruin dark, a generator's lit
  const a2 = "col += em * has * uWinGain * won;";
  need(f, a2);
  f = f.replace(a2, `float sootK = vD.x * (0.50 + 0.5 * vnAA(vec2(u * 0.9, y * 0.35) + seed * 90.0, 1.0, fu + fy));
    col = mix(col, col * 0.10 + vec3(0.010, 0.009, 0.008), clamp(sootK * 1.25, 0.0, 1.0));
    col += em * has * mix(uWinGain, 0.95, vD.z) * won * (1.0 - smoothstep(0.15, 0.55, vD.x));`);
  // the last line: the fires' light on a wall, a roof or a lip
  const a3 = "gl_FragColor = vec4(applyFogRel(col, rel), 1.0);\n  #include <tonemapping_fragment>";
  need(f, a3);
  f = f.replace(a3, `col = mix(col, col * 0.12 + vec3(0.008), clamp(vD.x * 1.1, 0.0, 1.0) * step(0.5, role));
  col += fireLight(wpos, fN) * 0.30;
  gl_FragColor = vec4(applyFogRel(col, rel), 1.0);
  #include <tonemapping_fragment>`);
  return { vert: v, frag: f };
}

/* the fires' light on the ground, the roads and the green areas */
export function patchLit(frag, ident) {
  const re = ident === "ground" ? /gl_FragColor = vec4\(applyFog\(base, vPos\), 1\.0\);/ : ident === "road" ? /gl_FragColor = vec4\(applyFog\(c, vPos\), edge\);\s*#include <tonemapping_fragment>\s*#include <colorspace_fragment>\s*\}\s*$/ : /gl_FragColor = vec4\(applyFog\(col, vPos\), 1\.0\);/;
  const m = frag.match(re);
  if (!m) return null;
  const v = ident === "ground" ? "base" : ident === "road" ? "c" : "col";
  let out = frag.replace("void main() {", FIRE_GLSL + "\nvoid main() {");
  const call = `${v} += fireLight(vPos, vec3(0.0, 1.0, 0.0)) * ${ident === "road" ? "0.30" : "0.26"};\n  `;
  out = out.replace(re, (s) => call + s);
  return out;
}
