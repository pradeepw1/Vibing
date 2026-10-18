// Shaders for planets round other stars, and the stars themselves.
//
// Nobody has seen what these worlds look like (the best we have is a size, a
// weight, a temperature and a few hints), so each one is drawn as a plausible
// planet of its kind: a rocky world with oceans, a banded gas giant, a smooth
// blue ice giant, a glowing lava world, a barren rock. All drawn per pixel
// from noise, so they stay sharp however close you get.
import { snoise } from "./shaders.js";

const finish = /* glsl */ `
  #include <colorspace_fragment>
`;

const lit = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vLocal;
`;

const vertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vLocal;
  void main() {
    vLocal = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * A planet. `mode`: 0 rocky with oceans, 1 gas giant, 2 ice giant or mini-Neptune,
 * 3 lava, 4 barren rock or ice. Colours come in as three palette colours.
 */
export const exoPlanet = {
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
    uniform vec3 sunDir;        // from the planet to its star
    uniform vec3 starColor;
    uniform float starPower;    // how bright the star shines here
    uniform float mode;
    uniform vec3 colA;
    uniform vec3 colB;
    uniform vec3 colC;
    uniform float seed;
    uniform float ocean;        // how much of a rocky world is sea (0..1)
    uniform float ice;          // how far the ice caps reach (0..1)
    uniform vec3 glowColor;     // light the planet gives off itself (hot worlds)
    uniform float glowPower;
    uniform vec4 rim;           // atmosphere's colour and strength
    uniform float time;
    ${lit}
    ${snoise}
    float fbm(vec3 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        s += a * snoise(p);
        p = p * 2.03 + vec3(7.1, 3.3, 1.7);
        a *= 0.5;
      }
      return s;
    }
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 p = vLocal;
      float lat = p.y;
      vec3 albedo = colA;
      vec3 emit = vec3(0.0);
      float gloss = 0.0;
      float cloud = 0.0;
      if (mode < 0.5) {
        // Continents and sea, ice at the poles, a few clouds.
        float h = fbm(p * 2.4 + seed) + 0.25 * snoise(p * 9.0 + seed);
        float sea = (ocean - 0.5) * 1.1;
        float land = smoothstep(sea - 0.02, sea + 0.04, h);
        float dry = fbm(p * 3.1 + seed * 2.0 + 11.0) * 0.5 + 0.5;
        vec3 ground = mix(colB, colC, smoothstep(0.35, 0.7, dry)); // greener to drier
        ground *= 0.85 + 0.3 * snoise(p * 22.0);
        vec3 water = mix(colA * 0.35, colA, smoothstep(sea - 0.25, sea, h));
        albedo = mix(water, ground, land);
        gloss = (1.0 - land) * 0.9;
        float cap = smoothstep(1.0 - ice, 1.0 - ice + 0.07 + 0.05 * snoise(p * 7.0), abs(lat));
        albedo = mix(albedo, vec3(0.92, 0.95, 1.0), cap);
        gloss *= 1.0 - cap;
        cloud = smoothstep(0.1, 0.6, fbm(p * 3.2 + vec3(seed, time * 0.004, 0.0)));
        albedo = mix(albedo, vec3(1.0), cloud * 0.8);
        gloss *= 1.0 - cloud;
      } else if (mode < 1.5) {
        // A banded giant: stripes of different gases, stirred by swirls.
        float stir = fbm(p * vec3(2.0, 9.0, 2.0) + seed) * 0.12;
        float band = sin((lat + stir) * 14.0 + 2.0 * snoise(vec3(lat * 3.0, seed, 0.0)));
        float fine = snoise(vec3(p.x * 2.5, lat * 20.0 + stir * 14.0, p.z * 2.5) + seed);
        albedo = mix(colA, colB, smoothstep(-0.7, 0.7, band));
        albedo = mix(albedo, colC, smoothstep(0.3, 1.0, fine * 0.4 + 0.6 * band) * 0.45);
        // One big storm.
        vec2 q = vec2(atan(p.z, p.x) - seed, (lat + 0.28) * 2.6);
        float storm = 1.0 - smoothstep(0.35, 0.7, length(vec2(sin(q.x * 0.5) * 1.6, q.y)));
        albedo = mix(albedo, colC * 1.1, storm * 0.8);
      } else if (mode < 2.5) {
        // A smooth ice giant or mini-Neptune: soft bands under a haze.
        float b = snoise(vec3(lat * 4.0, seed, 0.0)) * 0.5 + 0.5;
        albedo = mix(colA, colB, b * 0.6 + 0.2 * snoise(p * 3.0 + seed));
        albedo = mix(albedo, colC, smoothstep(0.55, 0.95, snoise(p * vec3(3.0, 14.0, 3.0) + seed) * 0.5 + 0.5) * 0.25);
      } else if (mode < 3.5) {
        // Black rock cracked open, glowing from inside.
        float r = abs(fbm(p * 3.0 + seed));
        float crack = 1.0 - smoothstep(0.0, 0.1, r);
        float plate = 0.4 + 0.6 * fbm(p * 7.0 + seed + 3.0);
        albedo = colB * (0.3 + 0.5 * plate);
        emit = colA * crack * 2.4 + colC * pow(crack, 3.0) * 1.4;
      } else {
        // Bare rock or old ice: dull, pitted.
        float big = fbm(p * 1.6 + seed);
        float rough = fbm(p * 4.0 + seed + 5.0) * 0.5 + 0.5;
        float pits = snoise(p * 11.0 + seed) * 0.5 + snoise(p * 23.0 + seed) * 0.25;
        albedo = mix(colA, colB, smoothstep(-0.3, 0.5, big) * 0.65 + rough * 0.35);
        albedo *= 0.88 + 0.2 * pits;
        // Rounded craters, and long cracks.
        vec3 cell = p * 7.0 + seed;
        float crater = smoothstep(0.55, 0.62, length(fract(cell) - 0.5) * 2.0) - smoothstep(0.62, 0.8, length(fract(cell) - 0.5) * 2.0);
        albedo *= 1.0 - 0.18 * crater * (0.5 + 0.5 * snoise(floor(cell) * 3.1));
        float crack = 1.0 - smoothstep(0.0, 0.035, abs(fbm(p * 4.5 + seed * 1.7)));
        albedo = mix(albedo, colC, crack * 0.45);
      }
      float ndl = dot(N, sunDir);
      // Where night begins: a gas giant's light fades softly in, a rock's quickly.
      float wrap = mode > 0.5 && mode < 2.5 ? 0.2 : 0.0;
      float day = smoothstep(-0.05 - wrap, 0.32, ndl);
      vec3 colour = albedo * (starColor * starPower * day + 0.012);
      // The glint of the star on the sea.
      vec3 H = normalize(sunDir + V);
      colour += starColor * starPower * gloss * 0.5 * pow(max(dot(N, H), 0.0), 120.0) * smoothstep(0.0, 0.2, ndl);
      // Hot worlds shine on their night side.
      colour += glowColor * glowPower * (1.0 - day) * (0.35 + 0.65 * (0.5 + 0.5 * snoise(p * 4.0 + seed)));
      colour += emit * (0.35 + 0.65 * smoothstep(-0.4, 0.5, ndl)) * max(glowPower, 0.25);
      // Air at the edge, lit where the star is.
      float edge = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      colour += rim.rgb * rim.a * edge * (0.12 + 0.88 * smoothstep(-0.35, 0.4, ndl)) * starColor;
      gl_FragColor = vec4(colour, 1.0);
      ${finish}
    }
  `,
};

/** A star: a glowing ball with churning cells and a darker edge. */
export const exoStar = {
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
    uniform vec3 tint;
    uniform float time;
    uniform float seed;
    ${lit}
    ${snoise}
    void main() {
      vec3 p = vLocal;
      float big = snoise(p * 3.0 + vec3(0.0, time * 0.02, seed));
      float mid = snoise(p * 12.0 + vec3(time * 0.04, seed, 0.0));
      float fine = snoise(p * 40.0 - vec3(time * 0.08));
      float g = 0.5 * big + 0.3 * mid + 0.2 * fine;
      float mu = clamp(dot(normalize(vNormal), normalize(cameraPosition - vWorldPos)), 0.0, 1.0);
      // Hot and bright in the middle, deeper in colour towards the edge, in the star's own colour.
      vec3 col = mix(tint * 0.5, tint * 1.1 + 0.1, pow(mu, 0.5));
      col *= 0.86 + 0.22 * g;
      gl_FragColor = vec4(col, 1.0);
      ${finish}
    }
  `,
};

/** The soft glow round a star, or a pulsar's beam: additive, fading to nothing at the edge. */
export const exoGlow = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 tint;
    uniform float power;
    uniform float falloff;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float a = pow(max(1.0 - d, 0.0), falloff);
      gl_FragColor = vec4(tint * a * power, 1.0);
      ${finish}
    }
  `,
};
