// GLSL for everything that isn't a stock three.js material.
// Lighting is done by hand. Each body gets `sunDir`, the real direction from
// it to the Sun, rather than working it out from where the body is drawn: in
// the view from a planet, bodies are drawn somewhere else than where they are.

const worldVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    // modelViewMatrix is built on the CPU in double precision, so close-ups don't shimmer.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const outputChunks = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// --- Planets and moons ----------------------------------------------------------

export const planet = {
  vertexShader: worldVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 baseColor;
    uniform float hasMap;
    uniform vec3 sunDir;         // real direction to the Sun
    uniform float sunlight;      // how much of the Sun isn't hidden by a planet (eclipses)
    uniform vec3 eclipseTint;
    uniform float ambient;
    uniform float wrap;          // softens the day/night line (thick atmospheres)
    uniform vec4 atmosphere;     // rim colour + strength
    uniform float opacity;

    uniform float hasExtra;      // Earth: r = city lights, g = water
    uniform sampler2D extraMap;

    uniform float hasRings;      // Saturn: shadow of the rings on the planet
    uniform vec3 ringNormal;
    uniform vec3 center;
    uniform vec2 ringRadii;
    uniform sampler2D ringMap;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUv;

    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = sunDir;
      vec3 V = normalize(cameraPosition - vWorldPos);
      float ndl = dot(N, L);
      float diffuse = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);

      if (hasRings > 0.5) {
        float facing = dot(L, ringNormal);
        if (abs(facing) > 1e-4) {
          float t = dot(center - vWorldPos, ringNormal) / facing;
          if (t > 0.0) {
            float r = length(vWorldPos + L * t - center);
            float f = (r - ringRadii.x) / (ringRadii.y - ringRadii.x);
            if (f > 0.0 && f < 1.0) diffuse *= 1.0 - 0.9 * texture2D(ringMap, vec2(f, 0.5)).a;
          }
        }
      }

      vec3 albedo = hasMap > 0.5 ? texture2D(map, vUv).rgb : baseColor;
      vec3 col = albedo * (diffuse * sunlight + ambient);
      col += albedo * eclipseTint * (1.0 - sunlight) * smoothstep(-0.1, 0.3, ndl);

      if (hasExtra > 0.5) {
        vec3 extra = texture2D(extraMap, vUv).rgb;
        float night = 1.0 - smoothstep(-0.12, 0.08, ndl);
        col += vec3(1.0, 0.72, 0.38) * extra.r * night * 0.9;
        vec3 H = normalize(L + V);
        float glint = pow(max(dot(N, H), 0.0), 160.0) * smoothstep(0.0, 0.2, ndl);
        col += vec3(1.0, 0.9, 0.75) * extra.g * glint * 0.3;
      }

      // A thin glow at the edge, on the sunny side.
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += atmosphere.rgb * atmosphere.a * rim * smoothstep(-0.25, 0.5, ndl) * 0.7;

      gl_FragColor = vec4(col, opacity);
      ${outputChunks}
    }
  `,
};

// Earth's cloud shell. Brightness of the map is cloud cover.
export const clouds = {
  vertexShader: worldVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 sunDir;
    uniform float ambient;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vec3 N = normalize(vNormal);
      float ndl = dot(N, sunDir);
      float c = texture2D(map, vUv).r;
      float light = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
      gl_FragColor = vec4(vec3(0.98) * (light + ambient), c * 0.92);
      ${outputChunks}
    }
  `,
};

// A soft halo just outside a planet with an atmosphere. Drawn on the inside
// (back faces) of a slightly bigger sphere.
export const halo = {
  vertexShader: worldVertex,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform vec3 center;
    uniform vec3 sunDir;
    uniform float strength;
    uniform float edge;    // how far in the planet's edge sits, as a dot product
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      float g = clamp(-dot(N, V) / edge, 0.0, 1.0);
      float sunny = smoothstep(-0.35, 0.6, dot(normalize(vWorldPos - center), sunDir));
      gl_FragColor = vec4(color * strength * g * g * sunny, 1.0);
      ${outputChunks}
    }
  `,
};

// --- Saturn's rings ------------------------------------------------------------------

export const rings = {
  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;
    varying vec2 vLocal;
    void main() {
      vLocal = position.xy;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec2 radii;          // inner and outer edge, in the same units as vLocal
    uniform vec3 center;         // planet centre (world)
    uniform float planetRadius;  // world units
    uniform vec3 normal;         // ring plane normal (world)
    uniform vec3 sunDir;
    uniform float ambient;
    varying vec3 vWorldPos;
    varying vec2 vLocal;
    void main() {
      float f = (length(vLocal) - radii.x) / (radii.y - radii.x);
      if (f < 0.0 || f > 1.0) discard;
      vec4 tex = texture2D(map, vec2(f, 0.5));

      vec3 L = sunDir;
      // In the planet's shadow?
      vec3 oc = vWorldPos - center;
      float b = dot(oc, L);
      float lit = 1.0;
      if (b < 0.0) {
        float miss = sqrt(max(dot(oc, oc) - b * b, 0.0)); // how far the sunbeam passes from the centre
        lit = smoothstep(planetRadius * 0.97, planetRadius * 1.03, miss);
      }

      // The side away from the Sun only gets light that leaks through.
      vec3 V = normalize(cameraPosition - vWorldPos);
      float sameSide = sign(dot(L, normal)) * sign(dot(V, normal));
      float through = sameSide > 0.0 ? 1.0 : 0.35 * (1.0 - tex.a) + 0.12;
      float sunAngle = 0.35 + 0.65 * abs(dot(L, normal));
      vec3 col = tex.rgb * (lit * through * sunAngle + ambient);
      gl_FragColor = vec4(col, tex.a);
      ${outputChunks}
    }
  `,
};

// --- The Sun ---------------------------------------------------------------------

// Simplex noise by Ian McEwan and Stefan Gustavson (MIT, github.com/stegu/webgl-noise).
const snoise = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

export const sun = {
  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocal;
    void main() {
      vLocal = normalize(position);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float time;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocal;
    ${snoise}
    void main() {
      vec3 p = vLocal;
      float big = snoise(p * 3.0 + vec3(0.0, time * 0.02, 0.0));
      float mid = snoise(p * 12.0 + vec3(time * 0.04));
      float fine = snoise(p * 45.0 - vec3(time * 0.08));
      float g = 0.5 * big + 0.3 * mid + 0.2 * fine;
      float mu = clamp(dot(normalize(vNormal), normalize(cameraPosition - vWorldPos)), 0.0, 1.0);
      // Hot white-yellow in the middle, deeper orange at the edge (limb darkening).
      vec3 col = mix(vec3(1.0, 0.42, 0.05), vec3(1.0, 0.93, 0.72), pow(mu, 0.55));
      col *= 0.82 + 0.28 * g;
      gl_FragColor = vec4(col, 1.0);
      ${outputChunks}
    }
  `,
};

// --- Orbit lines -------------------------------------------------------------------

// Brightest just behind the planet, fading away round the orbit like a trail.
export const orbit = {
  vertexShader: /* glsl */ `
    varying vec2 vFlat;
    void main() {
      vFlat = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float opacity;
    uniform float planetLon;
    uniform float trail;   // 1 = fade behind the planet, 0 = even line
    varying vec2 vFlat;
    void main() {
      float lon = atan(-vFlat.y, vFlat.x);
      float behind = mod(planetLon - lon, 6.2831853) / 6.2831853;
      float a = mix(1.0, 0.18 + 0.82 * pow(1.0 - behind, 2.5), trail);
      gl_FragColor = vec4(color, opacity * a);
      ${outputChunks}
    }
  `,
};

// --- Asteroids and Kuiper belt objects -------------------------------------------------

// Every particle has its own orbit and moves by Kepler's laws on the GPU.
export const belt = {
  vertexShader: /* glsl */ `
    uniform float days;          // days since 2000-01-01 12:00
    uniform float orbitScale;
    uniform float orbitPower;
    uniform float pixelRatio;
    uniform float sizeScale;
    // Changing view blends from one layout to another (each the overview, or the
    // sky seen from some body): the "from" one to the "to" one, by povBlend.
    uniform float povBlend;
    uniform float toSky;         // 1: the target is the sky seen from a body
    uniform vec3 observerReal;   // that body's real position (AU, scene axes)
    uniform vec3 observerShown;  // where its sky is centred
    uniform float fromSky;       // 1: the start is the sky seen from a body
    uniform vec3 fromReal;
    uniform vec3 fromShown;
    attribute vec3 shape;        // a (AU), e, inclination
    attribute vec4 angles;       // node, perihelion, mean anomaly at J2000, mean motion (rad/day)
    attribute float bright;
    varying float vBright;
    void main() {
      float e = shape.y;
      float M = mod(angles.z + angles.w * days, 6.2831853);
      float E = M + e * sin(M);
      for (int k = 0; k < 4; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
      float xv = shape.x * (cos(E) - e);
      float yv = shape.x * sqrt(1.0 - e * e) * sin(E);
      float cw = cos(angles.y), sw = sin(angles.y);
      float cn = cos(angles.x), sn = sin(angles.x);
      float ci = cos(shape.z), si = sin(shape.z);
      float x1 = xv * cw - yv * sw;
      float y1 = xv * sw + yv * cw;
      vec3 ecl = vec3(x1 * cn - y1 * ci * sn, x1 * sn + y1 * ci * cn, y1 * si);
      float r = length(ecl);
      vec3 real = vec3(ecl.x, ecl.z, -ecl.y);
      vec3 p = real * (orbitScale * pow(r, orbitPower) / r);
      if (toSky > 0.5 || fromSky > 0.5) {
        // Same layout as pov.js: real direction from the observer, distance 30 * (1 + sqrt(AU)).
        vec3 a = p;
        vec3 b = p;
        if (fromSky > 0.5) {
          vec3 rel = real - fromReal;
          float d = length(rel);
          a = fromShown + rel / d * 30.0 * (1.0 + sqrt(d));
        }
        if (toSky > 0.5) {
          vec3 rel = real - observerReal;
          float d = length(rel);
          b = observerShown + rel / d * 30.0 * (1.0 + sqrt(d));
        }
        p = mix(a, b, povBlend);
      }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(sizeScale / -mv.z, 1.0, 2.6) * pixelRatio;
      vBright = bright;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float opacity;
    varying float vBright;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(color, opacity * vBright * smoothstep(0.5, 0.15, d));
      ${outputChunks}
    }
  `,
};

// --- Stars --------------------------------------------------------------------------

export const stars = {
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    attribute float size;
    attribute vec3 tint;
    varying vec3 vTint;
    void main() {
      vTint = tint;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * pixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float opacity;
    varying vec3 vTint;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float core = smoothstep(1.0, 0.0, d);
      gl_FragColor = vec4(vTint * core * core * opacity, 1.0);
      ${outputChunks}
    }
  `,
};

// The nearest galaxies (see galaxies.js). uv runs across the patch in units
// of the galaxy's catalogue half-sizes, so in uv the galaxy's own disc is round.
export const galaxy = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float shape;    // 0 spiral, 1 cloud with a bar, 2 cloud, 3 small dwarf, 4 faint dwarf
    uniform float light;
    uniform float opacity;
    uniform float squash;   // short axis over long axis, as seen
    uniform float winding;  // how tightly the arms wind
    uniform float bar;      // angle of the bar from the long axis (radians)
    uniform vec2 spot;      // a pink star-forming cloud, in uv
    uniform float seed;
    uniform vec3 coreColor;
    uniform vec3 diskColor;
    varying vec2 vUv;
    ${snoise}
    float fbm(vec2 p) {
      float sum = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        sum += amp * snoise(vec3(p, seed));
        p *= 2.1;
        amp *= 0.5;
      }
      return sum;
    }
    void main() {
      vec2 p = vUv;                     // in the galaxy's own plane
      vec2 q = vec2(p.x, p.y * squash); // as it looks on the sky, in long half-axes
      float r = length(p);
      float edge = 1.0 - smoothstep(0.7, 1.38, r);
      float core = 0.0;
      float disk = 0.0;
      vec3 spotGlow = vec3(0.0);
      if (shape < 0.5) {
        // A bright middle, a disc fading outwards, and two arms winding out,
        // with darker dust lanes between them.
        float th = atan(p.y, p.x);
        float arms = 0.5 + 0.5 * cos(2.0 * (th - winding * log(r + 0.04)) + seed);
        float lumpy = 0.8 + 0.4 * fbm(p * 5.0);
        core = exp(-length(q) / 0.03) * 1.4 + exp(-length(q) / 0.1) * 0.45;
        disk = exp(-r * 2.4) * mix(0.3, 1.0, arms) * lumpy;
        disk *= 1.0 - 0.4 * smoothstep(0.25, 0.0, arms) * smoothstep(0.12, 0.45, r);
      } else if (shape < 2.5) {
        // The Magellanic Clouds: lumpy and irregular.
        float lumpy = max(0.0, 0.6 + 0.7 * fbm(p * 2.4 + 3.0));
        disk = exp(-r * r * 2.2) * lumpy;
        if (shape < 1.5) {
          vec2 b = vec2(cos(bar) * q.x + sin(bar) * q.y, -sin(bar) * q.x + cos(bar) * q.y);
          core = exp(-(b.x * b.x / 0.1 + b.y * b.y / 0.007)) * (0.75 + 0.35 * fbm(p * 7.0));
          float d = length((p - spot) * vec2(1.0, squash)) / 0.06;
          spotGlow = vec3(1.0, 0.42, 0.62) * exp(-d * d) * 0.8;
        } else {
          core = exp(-dot(q, q) / 0.06) * 0.3;
        }
      } else if (shape < 3.5) {
        // A small, smooth glow, brighter in the middle.
        disk = exp(-r * r * 3.0);
        core = exp(-r * r * 14.0) * 0.5;
      } else {
        // Spread thin: a soft, even haze.
        disk = exp(-r * r * 2.0) * (0.85 + 0.25 * fbm(p * 2.0));
      }
      vec3 color = (coreColor * core + diskColor * disk + spotGlow) * edge;
      gl_FragColor = vec4(color * light * opacity, 1.0);
      ${outputChunks}
    }
  `,
};

// Stars in the galaxies, out in the view among the galaxies (localgroup.js).
// Each one is as big as its share of the galaxy, so a galaxy looks the same
// brightness all over however far away it is; smaller than a pixel, it fades
// by area instead of shrinking, which keeps far galaxies from vanishing.
export const galaxyStars = {
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    uniform float viewHeight;
    uniform float maxSize; // CSS pixels
    attribute float size;
    attribute vec3 tint;
    varying vec3 vTint;
    varying float vFade;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float dist = max(-mv.z, 1e-4);
      float px = size * projectionMatrix[1][1] * viewHeight * 0.5 / dist;
      float shown = clamp(px, 1.0, maxSize);
      vFade = min(1.0, px * px); // smaller than a pixel: a pixel, dimmer to match
      vFade *= smoothstep(0.3, 2.5, dist); // right by the camera
      #ifdef GLOW
        vFade *= 1.0 - smoothstep(maxSize, maxSize * 2.0, px);
      #endif
      if (mv.z > 0.0 || vFade < 0.002) {
        // Nothing to see: off the screen, so it costs nothing to draw.
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        vFade = 0.0;
        vTint = vec3(0.0);
        return;
      }
      vTint = tint;
      gl_PointSize = shown * pixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float opacity;
    varying vec3 vTint;
    varying float vFade;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float a = 1.0 - d * d;
      gl_FragColor = vec4(vTint * a * a * vFade * opacity, 1.0);
      ${outputChunks}
    }
  `,
};

/**
 * Shows the added-up light of the galaxies. The brightness is rolled off
 * smoothly (no floor, so faint far-off stars still show), keeping each
 * colour: a galaxy's middle stays golden instead of going flat white.
 */
export const rollOff = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform float exposure;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(map, vUv).rgb * exposure;
      float light = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= (1.0 - exp(-light)) / max(light, 1e-6);
      // Past white in one colour: hold the colour, and let a little white in, as film does.
      float top = max(c.r, max(c.g, c.b));
      if (top > 1.0) c = mix(c / top, vec3(1.0), min(1.0, (top - 1.0) * 0.5));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      // A touch of noise, so faint glows don't show bands.
      gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    }
  `,
};

// Little dots that keep far-away planets visible when they're smaller than a pixel.
export const markers = {
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    uniform float viewHeight;
    attribute float radius;
    attribute vec3 tint;
    attribute float alpha;
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
      vTint = tint;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float px = radius * projectionMatrix[1][1] * viewHeight * 0.5 / -mv.z;
      vAlpha = alpha * (1.0 - smoothstep(1.5, 3.5, px));
      gl_PointSize = 5.0 * pixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0 || vAlpha < 0.01) discard;
      gl_FragColor = vec4(vTint, vAlpha * smoothstep(1.0, 0.3, d));
      ${outputChunks}
    }
  `,
};
