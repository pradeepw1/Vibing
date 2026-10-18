// Strange sights in the sky. All of them are made up, and the app says so.
// Each is a flat card that always faces the camera, painted by a shader. The
// card only holds a shape; any starry or cloudy detail is looked up by the
// direction of the view, so it slides over the real sky the way a distant
// thing would when the camera turns.
import { Group, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const cardVertex = /* glsl */ `
  varying vec2 vP;     // where on the card, in local units
  varying vec3 vDir;   // which way the camera is looking through this point (world)
  varying float vAng;  // radians of sky per local unit
  varying vec3 vAim;   // the same, for the middle of the card
  void main() {
    vP = position.xy;
    float s = length(modelMatrix[0].xyz);
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vAng = s / length(mv.xyz);
    vAim = transpose(mat3(viewMatrix)) * mv.xyz;
    mv.xy += position.xy * s;
    vDir = transpose(mat3(viewMatrix)) * mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// Shared by every card. Light is added to the sky behind; `dark` is how much
// of the sky behind is covered up. Colours are premultiplied for that.
const cardHead = /* glsl */ `
  uniform float pr;   // device pixels to a CSS pixel
  uniform float t;    // seconds into the sighting
  varying vec2 vP;
  varying vec3 vDir;
  varying float vAng;
  varying vec3 vAim;

  // The hash functions are "Hash without Sine" by David Hoskins (MIT, Copyright (c) 2014; text in dist/CREDITS.txt).
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                   mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                   mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float vnoise2(vec2 p, float k) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash13(vec3(i, k)), hash13(vec3(i + vec2(1, 0), k)), f.x),
               mix(hash13(vec3(i + vec2(0, 1), k)), hash13(vec3(i + vec2(1, 1), k)), f.x), f.y);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s / 0.9375;
  }
  // Two turns of the sky, so layers of stars don't line up in a grid together.
  const mat3 TURN1 = mat3(0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0.0, 0.6);
  const mat3 TURN2 = mat3(0.8, -0.36, -0.48, 0.0, 0.8, -0.6, 0.6, 0.48, 0.64);
  // A made-up sky: at most one star in each cell of a grid laid over the
  // directions. x = brightness, y = a random number to pick its colour from.
  // rad is the star's size in radians.
  vec2 starfield(vec3 d, float cells, float chance, float rad) {
    vec3 p = d * cells;
    vec3 c = floor(p);
    vec3 h = hash33(c);
    if (h.x > chance) return vec2(0.0);
    vec3 dl = p - (c + 0.22 + 0.56 * hash33(c + 7.0));
    dl -= d * dot(dl, d); // only the sideways part counts
    float r = rad * cells;
    return vec2(exp(-dot(dl, dl) / (r * r)) * (0.12 + 0.88 * h.y * h.y * h.y), h.z);
  }
  void finish(vec3 light, float dark) {
    gl_FragColor = vec4(light, dark);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // A little noise so faint glows don't show bands.
    gl_FragColor.rgb += (hash13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0 * smoothstep(0.0, 0.01, dot(gl_FragColor.rgb, vec3(1.0)) + gl_FragColor.a);
  }
`;

/** A card of `half` units each way with a shader on it, inside a hidden group. */
function card(body, uniforms, half, pixelRatio) {
  const mat = new ShaderMaterial({
    vertexShader: cardVertex,
    fragmentShader: cardHead + body,
    uniforms: { pr: { value: pixelRatio }, t: { value: 0 }, ...uniforms },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2 * half, 2 * half), mat);
  mesh.frustumCulled = false; // the shader moves it
  const group = new Group();
  group.visible = false;
  group.add(mesh);
  return {
    group,
    mat,
    u: mat.uniforms,
    setPixelRatio: (value) => (mat.uniforms.pr.value = value), // for when the window moves to another screen
    dispose: () => (mesh.geometry.dispose(), mat.dispose()),
  };
}

// --- The Seam -------------------------------------------------------------------
// A crack in the sky. It splits from a point, opens in fits, and through it
// there is a different sky: thick with amber stars, with light bending round
// the edges. Then it shuts, hairline first, and there is nothing there.

const seamShader = /* glsl */ `
  uniform float open;   // how wide the gap is, 0..1
  uniform float reach;  // how long the crack is, 0..1
  uniform float tilt;
  uniform float seed;
  uniform float life;   // 0..1, to fade the whole thing in and out
  uniform float pin;    // the first glint

  float n1(float x) {
    float i = floor(x), f = fract(x);
    return mix(hash13(vec3(i, seed, 1.0)), hash13(vec3(i + 1.0, seed, 1.0)), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0;
  }

  void main() {
    float pxl = max(fwidth(vP.x), 1e-5);    // one device pixel, in local units
    float px = pxl * pr;                    // one CSS pixel
    float pxa = pxl * vAng * pr;            // one CSS pixel, in radians of sky
    float c = cos(tilt), s = sin(tilt);
    vec2 q = vec2(c * vP.x + s * vP.y, -s * vP.x + c * vP.y);

    float H = 0.44 * reach;
    float y = q.y, ay = abs(y);
    float x = q.x - 0.045 * sin(y * 5.0 + seed) - 0.015 * sin(y * 13.0 + seed * 2.0);
    float prof = pow(max(1.0 - y * y / (H * H + 1e-5), 0.0), 0.8);
    float hw = max(open * prof * (0.1 * (0.75 + 0.35 * n1(y * 8.0)) + 0.004 * n1(y * 41.0)), 0.0);
    float f = abs(x) - hw;
    float d = f / max(length(vec2(dFdx(f), dFdy(f))), 1e-5);   // pixels from the edge, + outside
    float along = 1.0 - smoothstep(H * 0.8, H * 1.3 + 0.01, ay);
    float wide = smoothstep(0.0, 1.5, hw / pxl);   // a gap under a pixel across shows nothing

    vec3 dir = normalize(vDir);
    vec3 light = vec3(0.0);
    float dark = 0.0;

    // The sky just outside is pulled towards the gap and stretched into
    // streaks (what we see there is made up, since the real stars can't be bent).
    float away = max(d, 0.0) * pxl;
    float pull = open * along * smoothstep(0.0, 0.03, hw + 0.004) * clamp(d + 0.5, 0.0, 1.0);   // outside the gap only
    dark = 0.8 * exp(-away / 0.06) * pull;
    {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec2 nrm = sign(x) * vec2(c, s);
      vec2 tang = vec2(-nrm.y, nrm.x);
      float shift = 0.06 * exp(-away / 0.045) * vAng;
      vec3 w = normalize(dir + (right * (nrm.x + 0.5 * tang.x) + up * (nrm.y + 0.5 * tang.y)) * shift);
      vec2 a = starfield(TURN1 * w, 45.0, 0.14, 0.9 * pxa);
      vec2 b = starfield(TURN2 * w, 90.0, 0.08, 0.8 * pxa);
      light += (vec3(0.8, 0.9, 1.0) * a.x + vec3(1.0, 0.95, 0.9) * b.x * 0.6) * 0.55 * exp(-away / 0.09) * pull;
      light += vec3(0.1, 0.22, 0.26) * 0.1 * exp(-away / 0.012) * pull;
    }

    // The other side.
    float inside = clamp(0.5 - d, 0.0, 1.0) * wide;
    if (inside > 0.0) {
      float mid = 1.0 - clamp(abs(x) / max(hw, 1e-4), 0.0, 1.0);
      // The view into it drifts slowly outwards, as if it were moving.
      vec3 in_ = normalize(vAim + (vDir - vAim) * (1.0 - 0.0035 * t));
      float cloud = fbm(in_ * 7.0 + seed);
      vec3 col = mix(vec3(0.0004, 0.0035, 0.005), vec3(0.02, 0.006, 0.003), smoothstep(0.3, 0.8, cloud)) * (0.3 + 1.7 * mid);
      vec2 a = starfield(in_, 90.0, 0.55, 0.8 * pxa);
      vec2 b = starfield(TURN1 * in_, 210.0, 0.55, 0.65 * pxa);
      vec2 g = starfield(TURN2 * in_, 34.0, 0.45, 1.4 * pxa);
      vec3 tintA = mix(vec3(1.0, 0.6, 0.26), vec3(0.6, 1.0, 0.85), smoothstep(0.85, 1.0, a.y));
      col += tintA * a.x * 0.9 + vec3(1.0, 0.7, 0.4) * b.x * 0.5 + vec3(1.0, 0.88, 0.7) * g.x * 1.2;
      col += vec3(0.004, 0.011, 0.013) * exp(-max(-d, 0.0) * pxl / 0.02);
      light += col * inside;
      dark = max(dark, inside);
    }

    // The edge: a hot hairline, split a little into colours like glass.
    float lr = exp(-abs(d - 1.0 * pr) / (0.7 * pr));
    float lg = exp(-abs(d) / (0.8 * pr));
    float lb = exp(-abs(d + 1.0 * pr) / (0.7 * pr));
    float swell = 0.75 + 0.25 * sin(y * 9.0 - t * 1.3 + seed);
    light += vec3(lr * 0.25 + lg * 0.55, lg * 0.8, lb * 0.35 + lg * 0.9) * along * smoothstep(0.0, 0.06, reach) * (0.5 + 0.5 * reach) * 0.65 * swell;

    // A glint where it begins.
    light += vec3(0.8, 0.95, 1.0) * pin * exp(-dot(q, q) / (px * px * 3.0));

    light *= life;
    dark *= life;
    finish(light, dark);
  }
`;

function createSeam(pixelRatio) {
  const c = card(seamShader, {
    open: { value: 0 },
    reach: { value: 0 },
    tilt: { value: 0 },
    seed: { value: 0 },
    life: { value: 1 },
    pin: { value: 0 },
  }, 0.8, pixelRatio);
  const seconds = 46;
  let time = 0;
  const self = {
    id: "seam",
    name: "The Seam",
    about: "A crack opens in the sky and shows a different, wrong-coloured sky behind it, then shuts without a mark.",
    group: c.group,
    angle: 22,
    seconds,
    start(ctx) {
      time = 0;
      c.u.seed.value = ctx.random() * 50;
      c.u.tilt.value = (ctx.random() - 0.5) * 0.7;
      c.group.visible = true;
      self.update(0, ctx);
    },
    update(dt) {
      time += dt;
      const T = time;
      c.u.t.value = T;
      // It splits from a point, grows long, then opens in fits.
      const reach = smooth(2.5, 9, T) * (1 - smooth(41, 44, T));
      const open =
        (0.25 * smooth(10, 11.5, T) + 0.3 * smooth(14, 17, T) + 0.45 * smooth(22, 28, T)) *
        (1 - smooth(38, 39.4, T)) * (1 + 0.025 * Math.sin(T * 0.9));
      c.u.reach.value = reach;
      c.u.open.value = open;
      c.u.pin.value = smooth(0.4, 2, T) * (1 - smooth(5, 8, T)) + 0.8 * smooth(43, 44, T) * (1 - smooth(44, 45.2, T));
      c.u.life.value = 1;
      if (T >= seconds) {
        c.group.visible = false;
        return false;
      }
      return true;
    },
    setPixelRatio: c.setPixelRatio,
    dispose: c.dispose,
  };
  return self;
}

// --- The Echo -------------------------------------------------------------------
// A shell of light with no star at its middle, spreading across the sky. Where
// it meets dust the dust lights up, so you see the dust, lit one thin ring at
// a time. The ring itself is a perfect circle. (Real ones do this: Hubble's
// picture of V838 Monocerotis in 2002 is the best known. Real ones have a star
// in the middle.)

const echoShader = /* glsl */ `
  uniform vec3 fronts;  // how far out each ring has got
  uniform vec3 power;   // and how bright each one is
  uniform vec2 centre;
  uniform float seed;

  float fb2(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoise2(p, seed); p = p * 2.07 + 5.3; a *= 0.5; }
    return s / 0.875;
  }
  // Dust in the card's plane: soft clouds with fine threads through them.
  float dust(vec2 p) {
    vec2 q = p * 4.0;
    vec2 w = vec2(fb2(q + 1.7), fb2(q + 9.2)) - 0.5;
    float cloud = fb2(q * 1.6 + w * 2.2 + 4.0);
    float thread = 1.0 - abs(2.0 * fb2(q * 3.2 + w * 3.0 + 8.0) - 1.0);
    return smoothstep(0.38, 0.72, cloud) * (0.15 + 0.85 * pow(max(thread, 0.0), 3.0));
  }

  void main() {
    float px = max(fwidth(vP.x), 1e-5) * pr;
    vec2 p = vP - centre;
    float rr = length(p);
    float edge = 1.0 - smoothstep(0.5, 0.78, max(abs(vP.x), abs(vP.y)));
    vec3 light = vec3(0.0);
    float d = -1.0;
    for (int i = 0; i < 3; i++) {
      float u = fronts[i] - rr;                  // how far behind the front this point is
      if (fronts[i] <= 0.0 || u < -3.0 * px || u > 0.3) continue;
      if (d < 0.0) d = dust(vP);
      float ahead = smoothstep(-1.0 * px, 0.5 * px, u);
      float tail = 0.6 * exp(-u / 0.008) + 0.4 * exp(-u / 0.06);
      float hair = 0.45 * exp(-u * u / (2.0 * px * px));
      vec3 col = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.82, 0.62), smoothstep(0.0, 0.14, u));
      light += col * (ahead * tail * (0.04 + 1.6 * d * d) + hair * (0.25 + 0.75 * d)) * power[i];
    }
    light *= 0.2 * edge;
    finish(light, 0.0);
  }
`;

function createEcho(pixelRatio) {
  const c = card(echoShader, {
    fronts: { value: new Vector3() },
    power: { value: new Vector3() },
    centre: { value: new Vector2() },
    seed: { value: 0 },
  }, 0.8, pixelRatio);
  const seconds = 80;
  let time = 0;
  const self = {
    id: "echo",
    name: "The Echo",
    about: "A ring of light spreads from a place with no star and lights the dust it crosses, like the real light echoes seen round the star V838 Monocerotis.",
    group: c.group,
    angle: 56,
    seconds,
    start(ctx) {
      time = 0;
      c.u.seed.value = Math.floor(ctx.random() * 90);
      const a = ctx.random() * 6.283;
      c.u.centre.value.set(Math.cos(a) * 0.14, Math.sin(a) * 0.1);
      c.group.visible = true;
      self.update(0, ctx);
    },
    update(dt) {
      time += dt;
      const T = time;
      c.u.t.value = T;
      // Rings spread fast at first and slow down, the way an echo does.
      const front = (late, speed) => (T > late ? 0.5 * Math.sqrt((T - late) / speed) : 0);
      const fade = (late) => smooth(late, late + 3, T) * (1 - smooth(60 + late * 0.2, 78, T));
      c.u.fronts.value.set(front(0, 56), front(16, 56), front(34, 56));
      c.u.power.value.set(fade(0), 0.55 * fade(16), 0.3 * fade(34));
      if (T >= seconds) {
        c.group.visible = false;
        return false;
      }
      return true;
    },
    setPixelRatio: c.setPixelRatio,
    dispose: c.dispose,
  };
  return self;
}

// --- The Count -----------------------------------------------------------------
// One cold point of light that sends out thin rings, in groups of 2, 3, 5, 7
// and then 11: the first primes. It stops in the middle of the last group, and
// the point stays lit for a while, then goes out. (Inspired by the radio
// bursts that repeat in a steady rhythm, and by the first pulsar, which was
// at first thought to be a signal. Everything about this one is invented.)

const countShader = /* glsl */ `
  uniform float births[12];  // when each ring left the point (-1 = none)
  uniform float lamp;        // how bright the point is
  uniform float seed;

  void main() {
    float px = max(fwidth(vP.x), 1e-5) * pr;
    float rr = length(vP);
    float ang = atan(vP.y, vP.x);
    float edge = 1.0 - smoothstep(0.5, 0.62, max(abs(vP.x), abs(vP.y)));
    vec3 light = vec3(0.0);
    float flare = 0.0;
    for (int i = 0; i < 12; i++) {
      float age = t - births[i];
      if (births[i] < 0.0 || age < 0.0 || age > 8.0) continue;
      float R = 0.5 * pow(age / 7.0, 0.85);
      float d1 = (rr - R) / (px * 0.7);
      float d2 = (rr - R) / (0.004 + 0.012 * age / 7.0);
      float line = exp(-d1 * d1);
      float soft = 0.18 * exp(-d2 * d2);
      float fade = exp(-age / 3.4) * (1.0 - smoothstep(6.0, 8.0, age));
      float lean = 0.8 + 0.2 * sin(2.0 * ang + births[i] * 7.0 + seed);
      vec3 col = mix(vec3(0.82, 0.96, 1.0), vec3(0.42, 0.62, 1.0), age / 7.0);
      light += col * (line + soft) * fade * lean / (1.0 + 5.0 * R);
      flare += exp(-age / 0.35);
    }
    // The point itself: tight and cold, with a faint skirt.
    float core = exp(-rr * rr / (px * px * 1.6)) + 0.1 * exp(-rr / (px * 7.0));
    light += vec3(0.8, 0.95, 1.0) * core * lamp * (1.0 + 0.9 * flare);
    finish(light * edge * 0.9, 0.0);
  }
`;

function createCount(pixelRatio) {
  const births = new Array(12).fill(-1);
  const u = { births: { value: births }, lamp: { value: 0 }, seed: { value: 0 } };
  const c = card(countShader, u, 0.62, pixelRatio);
  const seconds = 64;
  const beat = 1.3; // seconds between rings in a group
  let time = 0;
  let schedule = [];
  let ends = 0;
  const self = {
    id: "primes",
    name: "The Primes",
    about: "A point of light sends out rings in groups of 2, 3, 5, 7 and 11 (all prime numbers), like a signal, and stops partway through the last group.",
    group: c.group,
    angle: 30,
    seconds,
    start(ctx) {
      time = 0;
      u.seed.value = ctx.random() * 6;
      schedule = [];
      let at = 5;
      [2, 3, 5, 7, 11].forEach((n, g) => {
        for (let i = 0; i < (g === 4 ? 6 : n); i++) schedule.push(at + i * beat);
        at += n * beat + 4.2;
      });
      ends = schedule[schedule.length - 1] + beat + 4; // a missed beat, then a wait
      c.group.visible = true;
      self.update(0, ctx);
    },
    update(dt) {
      time += dt;
      const T = time;
      c.u.t.value = T;
      // The rings still in the sky, newest last.
      const live = schedule.filter((b) => b <= T && T - b < 8.5).slice(-12);
      for (let i = 0; i < 12; i++) births[i] = i < live.length ? live[i] : -1;
      // Bright while it counts; when the count stops it sinks to a dull glow, waits, and goes out.
      u.lamp.value = (0.35 * smooth(0, 5, T) + 0.65 * smooth(4, 9, T) * (1 - smooth(ends, ends + 1.6, T))) * (1 - smooth(ends + 4, ends + 7, T));
      if (T >= seconds) {
        c.group.visible = false;
        return false;
      }
      return true;
    },
    setPixelRatio: c.setPixelRatio,
    dispose: c.dispose,
  };
  return self;
}

// --- The Curtains ----------------------------------------------------------------
// Sheets of glowing gas hanging in empty space, folded like cloth, with rays
// that stand upright as if there were a field to hold them. Nothing is there to
// make them glow. After a long quiet they brighten all at once, and for a few
// seconds the rays line up evenly, like the teeth of a comb. (Real auroras need a
// planet; these don't have one.)

const curtainShader = /* glsl */ `
  uniform float seed;
  uniform float tilt;
  uniform float glow;    // how much of the curtains is showing, 0..1
  uniform float surge;   // the sudden brightening, 0..1
  uniform float order;   // how evenly the rays are spaced, 0..1

  float n1d(float x, float k) {
    float i = floor(x), f = fract(x);
    return mix(hash13(vec3(i, k, seed)), hash13(vec3(i + 1.0, k, seed)), f * f * (3.0 - 2.0 * f));
  }

  // One sheet. len is how far it reaches each way, lift how high its foot is.
  vec3 curtain(vec2 p, float k, float lift, float amp, float rate, float len, vec3 low, vec3 high, float px) {
    float tt = t * rate + k * 9.0;
    float x = p.x;
    float wave = amp * (0.6 * sin(1.7 * x + tt) + 0.4 * sin(3.9 * x - 1.3 * tt + k));
    float hh = p.y - (lift + wave);
    float ends = 1.0 - smoothstep(0.2 * len, len, abs(x));
    if (hh < -0.01 || ends <= 0.0) return vec3(0.0);
    // The sheet is folded: where it runs towards us its rays crowd together
    // and shine brighter.
    float fold = 0.09 * sin(5.0 * x + 0.8 * tt + k * 2.0) + 0.04 * sin(11.0 * x - tt);
    float crowd = 1.0 + 0.45 * cos(5.0 * x + 0.8 * tt + k * 2.0) + 0.44 * cos(11.0 * x - tt);
    float s = x + fold + 0.25 * (1.0 - order) * sin(t * 0.07 + k) * hh;   // rays lean as they rise
    float ray = 0.5 * n1d(s * 38.0 + tt * 0.3, k) + 0.3 * n1d(s * 91.0 - tt * 0.5, k + 3.0)
              + 0.2 * n1d(s * 190.0, k + 5.0) * (1.0 - smoothstep(0.15, 0.4, 190.0 * px));
    float comb = pow(0.5 + 0.5 * cos(s * 6.2832 * 30.0), 5.0);
    ray = mix(ray, comb, order * 0.85);
    float tall = (0.03 + 0.1 * (0.25 + ray)) * (1.0 + 1.5 * surge) * (0.25 + 0.75 * ends);
    float body = exp(-max(hh, 0.0) / tall) * (1.0 - smoothstep(0.25, 0.55, hh));
    float lower = smoothstep(-0.006, 0.003, hh);
    float rim = exp(-abs(hh) / 0.005);
    vec3 col = mix(low, high, clamp(hh / (tall * 2.8), 0.0, 1.0));
    float shine = 0.3 + 1.5 * ray * ray;
    return (col * body * shine + low * rim * 0.6) * lower * clamp(crowd, 0.4, 2.4) * ends;
  }

  void main() {
    float px = max(fwidth(vP.x), 1e-5);
    float c = cos(tilt), s = sin(tilt);
    vec2 p = vec2(c * vP.x + s * vP.y, -s * vP.x + c * vP.y);
    float edge = (1.0 - smoothstep(0.7, 0.98, abs(vP.x))) * (1.0 - smoothstep(0.7, 0.98, abs(vP.y)));
    float boost = 1.0 + 1.4 * surge;
    vec3 light = vec3(0.0);
    light += curtain(p, 1.0, -0.04, 0.08, 0.12, 0.55, vec3(0.45, 1.0, 0.85), vec3(0.3, 0.2, 0.95), px) * min(1.0, glow * 4.0);
    light += curtain(p + vec2(0.2, 0.0), 2.0, 0.1, 0.06, -0.09, 0.42, vec3(0.3, 0.9, 1.0), vec3(0.6, 0.15, 0.9), px) * 0.55 * glow;
    light += curtain(p - vec2(0.15, 0.0), 3.0, -0.17, 0.09, 0.07, 0.4, vec3(0.5, 1.0, 0.7), vec3(0.15, 0.3, 1.0), px) * 0.45 * glow;
    light *= 0.16 * boost * edge;
    finish(light, 0.0);
  }
`;

function createCurtains(pixelRatio) {
  const u = { seed: { value: 0 }, tilt: { value: 0 }, glow: { value: 0 }, surge: { value: 0 }, order: { value: 0 } };
  const c = card(curtainShader, u, 1.0, pixelRatio);
  const seconds = 96;
  let time = 0;
  const self = {
    id: "curtains",
    name: "The Curtains",
    about: "Glowing sheets of gas hang in empty space like an aurora with no planet under it, and for a moment their rays line up like a comb.",
    group: c.group,
    angle: 44,
    seconds,
    start(ctx) {
      time = 0;
      u.seed.value = Math.floor(ctx.random() * 80);
      u.tilt.value = (ctx.random() - 0.5) * 0.8;
      c.group.visible = true;
      self.update(0, ctx);
    },
    update(dt) {
      time += dt;
      const T = time;
      c.u.t.value = T;
      u.glow.value = smooth(4, 40, T) * (1 - smooth(78, 94, T));
      // One quiet hour in a minute, then the sudden part.
      const surge = smooth(54, 57, T) * (1 - smooth(60, 80, T));
      u.surge.value = surge;
      u.order.value = smooth(56, 57.5, T) * (1 - smooth(63, 67, T));
      if (T >= seconds) {
        c.group.visible = false;
        return false;
      }
      return true;
    },
    setPixelRatio: c.setPixelRatio,
    dispose: c.dispose,
  };
  return self;
}

// --- The Dimming ---------------------------------------------------------------
// A bright star with dark pieces going round it. The pieces have no light of
// their own: you see them by the bites they take out of the star as they cross
// it, and by the stars they cover, the way you'd see a spacecraft cross the
// Sun. At first they are scattered and odd. Then identical six-sided plates
// take up one orbit and the star blinks on a steady beat. Then more plates
// arrive and fit together over the star, one by one, until only thin cracks of
// light are left, and then none.
// (Inspired by KIC 8462852, Tabby's Star, which dims in ways nobody has fully
// explained. The pieces are invented.)

const PIECES = 16;

const dimmingShader = /* glsl */ `
  uniform vec4 pa[16];   // x, y on the card; 1 if in front of the star; how solid
  uniform vec4 pb[16];   // shape (0 slab, 1 hexagon, 2 arc); two sizes; turn
  uniform float lamp;
  uniform float build;   // how much of the star's face is covered by plates
  uniform float shut;    // how tight the plates have fitted, 0..1
  uniform float veil;    // how much the dark pieces cover the sky behind, 0..1
  const float TILE = 0.05;   // width of one plate, in local units

  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float sdHex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float sdArc(vec2 p, float r, float th) {
    return max(abs(length(p) - r) - th, (abs(atan(p.x, p.y)) - 0.95) * r);
  }
  float shape(vec2 q, vec4 b) {
    return b.x < 0.5 ? sdBox(q, b.yz) : b.x < 1.5 ? sdHex(q, b.y) : sdArc(q, b.y, b.z);
  }
  // Distance to the middle of a honeycomb cell, 0.5 at the edge.
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.73))), p.x);
  }

  void main() {
    float pxl = max(fwidth(vP.x), 1e-5);
    float px = pxl * pr;
    float r = length(vP);
    float front = 0.0;   // how much of the star is covered
    float block = 0.0;   // how much of the sky behind is covered
    for (int i = 0; i < 16; i++) {
      vec4 a = pa[i], b = pb[i];
      if (a.w <= 0.0) continue;
      vec2 q = vP - a.xy;
      if (dot(q, q) > (b.y + b.z + 0.01) * (b.y + b.z + 0.01)) continue;
      float c = cos(b.w), s = sin(b.w);
      q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
      float cover = clamp(0.5 - shape(q, b) / pxl, 0.0, 1.0) * a.w;
      block = max(block, cover);
      if (a.z > 0.5) front = max(front, cover);   // only the near side of the orbit crosses the star
    }
    // The plates that close over the star.
    if (build > 0.0 && r < 0.17) {
      vec2 uv = vP / TILE;
      vec2 rr = vec2(1.0, 1.73);
      vec2 h = rr * 0.5;
      vec2 ga = mod(uv, rr) - h, gb = mod(uv - h, rr) - h;
      vec2 gv = dot(ga, ga) < dot(gb, gb) ? ga : gb;
      vec2 id = uv - gv;
      vec2 cell = floor(id / vec2(0.5, 0.865) + 0.5);
      float rc = length(id) * TILE;
      if (rc < 0.135) {
        float order = 0.65 * hash13(vec3(cell, 3.0)) + 0.35 * (1.0 - rc / 0.135);
        float have = clamp((build * 1.05 - order) / 0.02, 0.0, 1.0);
        float inner = (0.5 - hexDist(gv)) * TILE;
        float gap = (1.0 - shut) * 0.6 * px;
        float cover = have * clamp(0.5 + (inner - gap) / pxl, 0.0, 1.0);
        front = max(front, cover);
        block = max(block, cover);
      }
    }
    // The star: a hot disc, darker and redder towards its rim, with a little
    // grain, a glare just outside it and a glow that doesn't reach far.
    float R0 = 0.062;
    float inDisc = 1.0 - smoothstep(R0 - px, R0 + px, r);
    float mu = sqrt(max(1.0 - (r * r) / (R0 * R0), 0.0));
    float limb = 1.0 - 0.6 * (1.0 - mu);
    float grain = 1.0;
    if (inDisc > 0.0) grain = 0.92 + 0.16 * fbm(vec3(vP * 55.0, t * 0.04));
    vec3 disc = mix(vec3(1.0, 0.5, 0.26), vec3(1.0, 0.93, 0.8), mu) * limb * grain * 0.95;
    float over = max(r - R0, 0.0);
    vec3 glow = vec3(1.0, 0.8, 0.58) * (0.2 * exp(-over / 0.011) + 0.045 * exp(-r / 0.05) + 0.012 * exp(-r / 0.15) + 0.002 * exp(-r / 0.4));
    vec3 col = mix(glow, disc, inDisc);
    float edge = 1.0 - smoothstep(0.5, 0.75, max(abs(vP.x), abs(vP.y)));
    finish(col * lamp * edge * (1.0 - front), block * veil * edge);
  }
`;

function createDimming(pixelRatio) {
  const pa = Array.from({ length: PIECES }, () => new Vector4());
  const pb = Array.from({ length: PIECES }, () => new Vector4());
  const u = { pa: { value: pa }, pb: { value: pb }, lamp: { value: 0 }, build: { value: 0 }, shut: { value: 0 }, veil: { value: 1 } };
  const c = card(dimmingShader, u, 0.75, pixelRatio);
  const seconds = 84;
  const PANELS = 9;
  let time = 0;
  let loose = [];
  let om = 0;
  let spin = 0; // how far the panels have gone round

  function update(dt) {
    time += dt;
    const T = time;
    c.u.t.value = T;
    spin += dt * 0.32;
    let n = 0;
    const put = (a, inc, o, th, type, w, h, alpha) => {
      const x0 = a * Math.cos(th), y0 = -a * Math.sin(th) * Math.sin(inc);
      const dx = -a * Math.sin(th), dy = -a * Math.cos(th) * Math.sin(inc);
      const co = Math.cos(o), so = Math.sin(o);
      pa[n].set(x0 * co - y0 * so, x0 * so + y0 * co, Math.sin(th) > 0 ? 1 : 0, alpha);
      pb[n].set(type, w, h, Math.atan2(dx * so + dy * co, dx * co - dy * so));
      n++;
    };
    // Pieces take a few seconds to show or to go: it looks like a star fading out behind them.
    for (const p of loose) {
      p.th += dt * p.rate;
      const alpha = smooth(p.from, p.from + 4, T) * (1 - smooth(p.until - 4, p.until, T));
      if (alpha > 0) put(p.a, p.inc, p.om, p.th, p.type, p.w, p.h, alpha);
    }
    // Nine identical plates, evenly spaced, on one orbit.
    for (let k = 0; k < PANELS; k++) {
      const alpha = smooth(36 + k * 0.9, 40 + k * 0.9, T) * (1 - smooth(53, 58, T));
      if (alpha > 0) put(0.36, 0.085, om, spin + (k * 6.2832) / PANELS, 1, 0.025, 0, alpha);
    }
    for (; n < PIECES; n++) pa[n].w = 0;
    u.lamp.value = smooth(0, 6, T) * (1 - smooth(68, 77, T));
    u.build.value = smooth(50, 72, T);
    u.shut.value = smooth(71, 75, T);
    u.veil.value = 1 - smooth(77, 83.5, T);
    if (T >= seconds) {
      c.group.visible = false;
      return false;
    }
    return true;
  }

  return {
    id: "dimming",
    name: "The Dimming",
    about: "Dark pieces cross a star, fall into step, and fit together over it. A nod to Tabby's Star (KIC 8462852), whose light dips unevenly and where what blocks it is still argued over.",
    group: c.group,
    angle: 34,
    seconds,
    start(ctx) {
      const r = ctx.random;
      time = 0;
      spin = r() * 6.28;
      om = (r() - 0.5) * 0.7;
      loose = Array.from({ length: 7 }, (_, i) => {
        const type = [0, 1, 2, 0, 1, 0, 2][i];
        const a = 0.2 + 0.3 * r();
        return {
          a, type, inc: 0.06 + 0.2 * r(), th: r() * 6.28, om: om + (r() - 0.5) * 0.8,
          rate: 0.2 * Math.pow(0.3 / a, 1.5), // nearer ones go faster
          w: type === 0 ? 0.006 + 0.014 * r() : type === 1 ? 0.016 + 0.024 * r() : 0.06 + 0.05 * r(),
          h: type === 0 ? 0.03 + 0.045 * r() : 0.007 + 0.006 * r(),
          from: 5 + i * 2.5, until: 38 + i * 2,
        };
      });
      c.group.visible = true;
      update(0);
    },
    update,
    setPixelRatio: c.setPixelRatio,
    dispose: c.dispose,
  };
}

export const SIGHTINGS = [createSeam, createEcho, createCount, createCurtains, createDimming];
