// Spaceships. Three are made up (a generation ship, a lane of shuttles, a
// wreck) and two are real (the Voyager probes, drawn small and quiet).
//
// Every ship is dark metal that only shows by what little light finds it, its
// own windows and lamps, and the stars it hides. Hull detail (plating, windows)
// is worked out in the shaders from a couple of numbers per vertex, so the
// models stay light: a few thousand triangles and two or three draw calls.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  Object3D,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import { random, smooth } from "../noise.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const outputChunks = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// --- Building models ----------------------------------------------------------------

// Collects pieces into one geometry. Each piece is a grid of points from a
// formula, with the normals worked out from the formula's own slope so a seam
// closes without a visible line. Every vertex also carries:
//   pc   where it sits on a grid of plating, in panels (the shaders draw the seams)
//   tag  (kind of part, and three numbers the kind's shader may use)
//   mot  (optional) how a loose piece moves: pivot, spin axis + rate, drift
class Mesher {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.pc = [];
    this.tag = [];
    this.mot = [];
    this.index = [];
    this.m = new Matrix4();
    this.nm = new Matrix3();
    this.hasMotion = false;
  }

  /** Everything added after this is moved by `matrix`. */
  place(matrix) {
    this.m.copy(matrix);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  /**
   * A grid of (nu + 1) by (nv + 1) points from fn(u, v), both 0..1, as
   * [x, y, z]. The normal is fn's du cross dv, so order the formula for the
   * side you want to see (or pass flip).
   */
  surface(fn, nu, nv, { tag = [1, 0, 0, 0], pc = (u, v) => [u, v], flip = false, mot = null } = {}) {
    const base = this.pos.length / 3;
    const e = 1e-4;
    const p = new Vector3();
    const n = new Vector3();
    const du = new Vector3();
    const dv = new Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const v = j / nv;
        const a = fn(u, v);
        const ua = fn(u + e, v);
        const ub = fn(u - e, v);
        const va = fn(u, v + e);
        const vb = fn(u, v - e);
        du.set(ua[0] - ub[0], ua[1] - ub[1], ua[2] - ub[2]);
        dv.set(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
        n.crossVectors(du, dv);
        if (n.lengthSq() < 1e-24) n.set(0, 0, 1); // a point (the tip of a cone)
        n.normalize().applyMatrix3(this.nm).normalize();
        if (flip) n.negate();
        p.set(a[0], a[1], a[2]).applyMatrix4(this.m);
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        const c = pc(u, v);
        this.pc.push(c[0], c[1]);
        this.tag.push(tag[0], tag[1], tag[2], tag[3]);
        if (mot) {
          this.hasMotion = true;
          this.mot.push(...mot);
        } else this.mot.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    }
    const w = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        if (flip) this.index.push(a, c, b, b, c, d);
        else this.index.push(a, b, c, b, d, c);
      }
    }
    return this;
  }

  /**
   * A solid of revolution round the z axis from a profile of [z, r] points,
   * walked with the outside on your right (so a closed solid starts at the
   * axis at its low end and ends on the axis at its high end). Each stretch of
   * the profile keeps its own hard edge. `cell` is the panel size.
   */
  lathe(profile, seg, { tag = [1, 0, 0, 0], cell = 0.02, cells = 0, mot = null, flip = false, zOrigin = 0 } = {}) {
    let rMax = 0;
    for (const [, r] of profile) rMax = Math.max(rMax, r);
    const around = cells || Math.max(4, Math.round((TAU * rMax) / cell));
    for (let k = 0; k < profile.length - 1; k++) {
      const [z0, r0] = profile[k];
      const [z1, r1] = profile[k + 1];
      if (Math.abs(z1 - z0) + Math.abs(r1 - r0) < 1e-9) continue;
      const along = Math.abs(z1 - z0) >= Math.abs(r1 - r0);
      this.surface(
        (u, v) => {
          const a = u * TAU;
          const r = r0 + (r1 - r0) * v;
          return [Math.cos(a) * r, Math.sin(a) * r, z0 + (z1 - z0) * v];
        },
        seg,
        1,
        {
          tag,
          mot,
          flip,
          pc: (u, v) => [u * around, along ? (z0 + (z1 - z0) * v - zOrigin) / cell : (r0 + (r1 - r0) * v) / cell + 3.7],
        },
      );
    }
    return this;
  }

  /** A box, centred on the origin. */
  box(sx, sy, sz, { tag = [1, 0, 0, 0], cell = 0.02, mot = null } = {}) {
    const size = [sx, sy, sz];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      for (const s of [1, -1]) {
        this.surface(
          (u, v) => {
            const p = [0, 0, 0];
            p[a] = (s * size[a]) / 2;
            p[b] = (u - 0.5) * size[b];
            p[c] = (v - 0.5) * size[c];
            return p;
          },
          1,
          1,
          { tag, mot, flip: s < 0, pc: (u, v) => [(u * size[b]) / cell, (v * size[c]) / cell] },
        );
      }
    }
    return this;
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("pc", new BufferAttribute(new Float32Array(this.pc), 2));
    g.setAttribute("tag", new BufferAttribute(new Float32Array(this.tag), 4));
    if (this.hasMotion) {
      const mot = new Float32Array(this.mot);
      const split = (from, size) => {
        const out = new Float32Array((mot.length / 10) * size);
        for (let i = 0; i < mot.length / 10; i++) for (let k = 0; k < size; k++) out[i * size + k] = mot[i * 10 + from + k];
        return new BufferAttribute(out, size);
      };
      g.setAttribute("pivot", split(0, 3));
      g.setAttribute("spinAxis", split(3, 4));
      g.setAttribute("drift", split(7, 3));
    }
    g.setIndex(new BufferAttribute(new Uint32Array(this.index), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const move = (x, y, z) => new Matrix4().makeTranslation(x, y, z);
const turned = (axis, angle, x = 0, y = 0, z = 0) =>
  new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeRotationAxis(axis, angle));
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

// --- Shader pieces ----------------------------------------------------------------------

// Small helpers every hull shader uses.
const hullLib = /* glsl */ `
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Plating seams. p is in cells and size is one panel, in cells.
  // x: how much of a seam this pixel is (0..1), y: a random number for the panel.
  vec2 plating(vec2 p, vec2 size, float stagger) {
    vec2 q = p / size;
    vec2 w = fwidth(q);
    float row = floor(q.y);
    q.x += stagger * 0.5 * mod(row, 2.0);
    vec2 id = vec2(floor(q.x), row);
    vec2 f = fract(q);
    vec2 d = min(f, 1.0 - f);
    vec2 s = 1.0 - smoothstep(vec2(0.0), w * 1.4 + 0.025, d);
    float fade = 1.0 - smoothstep(0.25, 0.6, max(w.x, w.y)); // too fine to see: let it blur away
    return vec2(max(s.x, s.y) * fade, h21(id + 0.5));
  }

  uniform vec3 uSun;     // direction to the light, in the world
  uniform vec3 uRim;     // the faint cold light that traces the outline
  // Lit by one far light, and the thin glow along the edges.
  vec3 lightHull(vec3 albedo, vec3 N, vec3 V, float spec, float gloss, float rim) {
    float ndl = dot(N, uSun);
    float lit = clamp(ndl, 0.0, 1.0);
    vec3 col = albedo * (0.004 + 1.3 * lit * vec3(1.0, 0.96, 0.9));
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.97, 0.92) * spec * pow(max(dot(N, H), 0.0), gloss) * lit;
    float f = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += uRim * f * rim;
    return col;
  }
`;

// --- The generation ship ----------------------------------------------------------------

// Part kinds (tag.x): 0 a spinning drum, 1 plated hull, 2 engine bell, 3 radiator.
// For a drum, tag.y is 0 on its side (windows), 1 on its end caps, 2 on its ribs,
// and tag.z is 1 for the drum that turns the other way.
const SHIP = {
  drumR: 0.085,
  cell: 0.009408, // one window row, along the length (25 to a drum)
  around: 36, // window columns round a drum
  bellRing: 0.036,
  stern: -0.53,
  shieldZ: 0.368,
  shieldR: 0.125,
};

function generationHull() {
  const m = new Mesher();
  const hull = [1, 0, 0, 0];
  const { drumR: R, cell, around } = SHIP;

  // A drum: windows between a few ribs, end plates, and a lip at each end.
  // Two of them turn opposite ways, so the ship as a whole doesn't twist.
  const drum = (z0, length, other) => {
    const z1 = z0 + length;
    const side = [0, 0, other, 0];
    const cap = [0, 1, other, 0];
    const rib = [0, 2, other, 0];
    const lathe = (tag, pts) => m.lathe(pts, 120, { tag, cell, cells: around, zOrigin: z0 });
    const lip = R + 0.008;
    lathe(cap, [[z0 + 0.012, 0], [z0 + 0.012, 0.03], [z0, R], [z0, lip], [z0 + 0.012, lip], [z0 + 0.02, R]]);
    const ribEvery = 10 * cell; // every other deck
    let z = z0 + 0.02;
    for (let k = 1; z < z1 - 0.03; k++) {
      const zr = z0 + k * ribEvery;
      if (zr > z1 - 0.03) break;
      lathe(side, [[z, R], [zr - 0.004, R]]);
      lathe(rib, [[zr - 0.004, R], [zr - 0.004, R + 0.0032], [zr + 0.004, R + 0.0032], [zr + 0.004, R]]);
      z = zr + 0.004;
    }
    lathe(side, [[z, R], [z1 - 0.02, R]]);
    lathe(cap, [[z1 - 0.02, R], [z1 - 0.012, lip], [z1, lip], [z1, R], [z1 - 0.012, 0.03], [z1 - 0.012, 0]]);
  };
  drum(-0.2, 0.2352, 0);
  drum(0.08, 0.2352, 1);

  // The hub between them: a still collar and a wide thin flange with little arms and pods round it.
  const gap0 = 0.0352;
  const gap1 = 0.08;
  const mid = (gap0 + gap1) / 2;
  m.lathe([[gap0, 0.018], [gap0, 0.05], [gap1, 0.05], [gap1, 0.018]], 40, { tag: hull, cell: 0.012 });
  m.lathe([[mid - 0.006, 0], [mid - 0.006, 0.108], [mid, 0.11], [mid + 0.006, 0.108], [mid + 0.006, 0]], 120, { tag: hull, cell: 0.012 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2;
    m.place(turned(Z, a, 0, 0, mid).multiply(move(0.13, 0, 0)));
    m.box(0.036, 0.004, 0.004, { tag: hull, cell: 0.01 });
    m.place(turned(Z, a, 0, 0, mid).multiply(move(0.152, 0, 0)));
    m.box(0.014, 0.01, 0.012, { tag: hull, cell: 0.006 });
  }
  m.place(new Matrix4());

  // The spine runs the whole length; the drums turn round it.
  m.lathe([[-0.46, 0], [-0.46, 0.018], [0.5, 0.018], [0.5, 0]], 24, { tag: hull, cell: 0.02 });
  for (const z0 of [-0.236, 0.318]) {
    m.lathe([[z0, 0.018], [z0, 0.042], [z0 + 0.032, 0.042], [z0 + 0.032, 0.018]], 32, { tag: hull, cell: 0.012 });
  }

  // Fuel tanks, six round the spine, held by two rings.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    m.place(move(Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0));
    const r = 0.019;
    const z0 = -0.405;
    const z1 = -0.24;
    const pts = [[z0, 0], [z0 + 0.004, r * 0.55], [z0 + 0.011, r * 0.85], [z0 + 0.02, r]];
    const run = z1 - z0 - 0.04;
    for (let b = 0; b < 4; b++) {
      const zb = z0 + 0.02 + (b * run) / 4;
      pts.push([zb, r], [zb, r + 0.0014], [zb + 0.008, r + 0.0014], [zb + 0.008, r]);
    }
    pts.push([z1 - 0.02, r], [z1 - 0.011, r * 0.85], [z1 - 0.004, r * 0.55], [z1, 0]);
    m.lathe(pts, 16, { tag: hull, cell: 0.012 });
  }
  m.place(new Matrix4());
  for (const z0 of [-0.375, -0.285]) {
    m.lathe([[z0, 0.018], [z0, 0.083], [z0 + 0.006, 0.083], [z0 + 0.006, 0.018]], 36, { tag: hull, cell: 0.012 });
  }

  // Drive housing and three bells: the darkest things on the ship.
  m.lathe([[-0.465, 0], [-0.465, 0.05], [-0.45, 0.058], [-0.42, 0.058], [-0.405, 0.05], [-0.405, 0]], 32, { tag: hull, cell: 0.012 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    m.place(move(Math.cos(a) * SHIP.bellRing, Math.sin(a) * SHIP.bellRing, 0));
    const zh = -0.465;
    const zt = -0.485;
    const ze = SHIP.stern;
    const rt = 0.008;
    const re = 0.025;
    const bell = [[zt + 0.008, 0], [zt + 0.008, rt], [zt, rt]];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      bell.push([zt + (ze - zt) * t, rt + (re - rt) * Math.pow(t, 0.55)]);
    }
    bell.push([ze, re + 0.0026]);
    for (let i = 7; i >= 0; i--) {
      const t = i / 7;
      bell.push([ze + (zh - ze) * t, re + 0.0026 + (0.02 - re - 0.0026) * Math.pow(t, 0.8)]);
    }
    m.lathe(bell, 28, { tag: [2, 0, 0, 0], cell: 0.01 });
  }
  m.place(new Matrix4());

  // Radiators: two big thin fins on arms.
  for (const s of [1, -1]) {
    m.place(turned(Z, s * 0.16, s * 0.15, 0, -0.33));
    m.box(0.18, 0.0015, 0.2, { tag: [3, 0, 0, 0], cell: 0.01 });
    m.place(turned(Z, s * 0.16, s * 0.06, 0, -0.33));
    m.box(0.1, 0.006, 0.006, { tag: hull, cell: 0.01 });
  }
  m.place(new Matrix4());

  // The bow: a shield plate to take the dust, arms to hold it, a mast and a nose.
  const zs = SHIP.shieldZ;
  const rs = SHIP.shieldR;
  m.lathe([[zs, 0], [zs, rs - 0.01], [zs + 0.003, rs], [zs + 0.014, rs], [zs + 0.014, rs - 0.02], [zs + 0.014, 0]], 96, { tag: hull, cell: 0.012 });
  m.lathe([[zs + 0.014, 0], [zs + 0.014, 0.02], [0.44, 0.012], [0.53, 0]], 12, { tag: hull, cell: 0.012 });
  m.lathe([[0.41, 0.012], [0.41, 0.03], [0.42, 0.03], [0.42, 0.012]], 24, { tag: hull, cell: 0.012 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.3;
    m.place(turned(Z, a));
    m.surface(
      (u, v) => [0.04 + 0.07 * v, (u - 0.5) * 0.005, 0.345 + 0.02 * v],
      1, 1, { tag: hull, pc: (u, v) => [u, v] },
    );
  }
  m.place(new Matrix4());
  return m.geometry();
}

// A slow cold torch: three long soft cones out of the bells.
function torchGeometry() {
  const m = new Mesher();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    m.place(move(Math.cos(a) * SHIP.bellRing, Math.sin(a) * SHIP.bellRing, 0));
    m.surface(
      (u, v) => {
        const r = 0.028 * (1 - 0.55 * v) * (1 - Math.pow(v, 5)) + 1e-5;
        return [Math.cos(u * TAU) * r, Math.sin(u * TAU) * r, SHIP.stern - 0.55 * v];
      },
      16, 20, { tag: [0, 0, 0, 0], pc: (u, v) => [u, v] },
    );
  }
  return m.geometry();
}

const hullVertex = ({ spin = false, tumble = false, instanced = false } = {}) => /* glsl */ `
  attribute vec2 pc;
  attribute vec4 tag;
  ${tumble ? "attribute vec3 pivot; attribute vec4 spinAxis; attribute vec3 drift; uniform mat3 uTumble; uniform vec3 uCenter; uniform float uTime;" : ""}
  ${spin ? "uniform float uSpin;" : ""}
  ${instanced ? "attribute vec2 inst; varying vec2 vInst;" : ""}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec2 vPc;
  varying vec4 vTag;
  void main() {
    vec3 p = position;
    vec3 n = normal;
    vObj = position;
    vPc = pc;
    vTag = tag;
    ${spin ? `
    if (tag.x < 0.5) {
      float turn = tag.z > 0.5 ? -uSpin : uSpin; // the second drum turns the other way
      float c = cos(turn);
      float s = sin(turn);
      mat2 r = mat2(c, s, -s, c);
      p.xy = r * p.xy;
      n.xy = r * n.xy;
    }` : ""}
    ${tumble ? `
    if (tag.x > 5.5 && tag.x < 6.5) {
      // A loose piece: turns about its own middle and drifts.
      float ang = spinAxis.w * uTime;
      vec3 k = spinAxis.xyz;
      vec3 q = p - pivot;
      float cs = cos(ang);
      float sn = sin(ang);
      q = q * cs + cross(k, q) * sn + k * dot(k, q) * (1.0 - cs);
      n = n * cs + cross(k, n) * sn + k * dot(k, n) * (1.0 - cs);
      p = pivot + q + drift * uTime;
    } else {
      p = uTumble * p + uCenter;
      n = uTumble * n;
    }` : ""}
    ${instanced ? `
    vInst = inst;
    p = (instanceMatrix * vec4(p, 1.0)).xyz;
    n = mat3(instanceMatrix) * n;` : ""}
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const generationFragment = /* glsl */ `
  ${hullLib}
  uniform float uAlpha;
  uniform float uTime;     // seconds into the sighting
  uniform float uWake;     // when the windows start to come on
  uniform float uBurn;     // how hard the drive is lit
  uniform float uSeed;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec2 vPc;
  varying vec4 vTag;

  // Rows and columns of windows in decks, lit district by district. Returns
  // the light they give, and how much of the surface is window.
  vec3 windows(vec2 pc, float facing, float drum, out float cover) {
    float col = pc.x;
    float row = pc.y;
    vec2 cell = floor(vec2(col, row));
    vec2 f = fract(vec2(col, row));
    float sector = floor(col / 6.0);
    float deck = floor(row / 5.0);
    vec2 dist = vec2(sector, deck) + drum * 17.0;
    bool frame = mod(cell.x, 6.0) > 4.5 || mod(cell.y, 5.0) > 2.5;

    // Which districts are lived in, and when they wake: from the stern forward, raggedly.
    float lived = smoothstep(0.38, 0.62, 0.5 * h21(dist + uSeed) + 0.6 * vnoise(dist * 0.42 + uSeed));
    float wakeAt = uWake + (clamp((deck + drum * 5.0) / 9.0, 0.0, 1.0) * 0.85 + 0.15 * h21(dist + 3.1)) * 46.0;
    float districtOn = smoothstep(wakeAt, wakeAt + 4.0, uTime);

    float own = h21(cell + 0.13);
    float used = step(own, 0.1 + lived * 0.8);
    float windowOn = smoothstep(wakeAt + own * 6.0, wakeAt + own * 6.0 + 2.5, uTime);

    vec2 inner = smoothstep(vec2(0.16, 0.2), vec2(0.26, 0.3), f) * (1.0 - smoothstep(vec2(0.74, 0.7), vec2(0.84, 0.8), f));
    float shape = inner.x * inner.y;
    float built = frame ? 0.0 : 1.0;

    // Once windows are smaller than a pixel they melt into their share of the
    // light: first each one dims to its area, then whole districts go to an average.
    float foot = max(fwidth(col), fwidth(row));
    float blur = smoothstep(0.25, 0.8, foot);
    float far = smoothstep(0.9, 2.4, foot);
    float one = used * windowOn * built * mix(shape, 0.34, blur);
    float all = (0.1 + lived * 0.8) * districtOn * 0.34 * (5.0 / 6.0) * (3.0 / 5.0) * 1.2;
    cover = built * mix(shape, 0.34, blur);
    float amount = mix(one, all, far) * facing;

    vec3 warm = mix(vec3(1.0, 0.46, 0.17), vec3(1.0, 0.72, 0.4), h21(dist + 2.2) * 0.7 + 0.3 * h21(cell + 2.2));
    vec3 cool = vec3(0.72, 0.86, 1.0);
    vec3 tint = h21(cell + 9.1) > 0.97 ? cool : warm;
    return tint * amount * (0.4 + 0.6 * h21(cell + 4.4)) * 1.1;
  }

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    float kind = vTag.x;
    float cap = vTag.y;
    vec3 albedo = vec3(0.022, 0.025, 0.031);
    float spec = 0.35;
    float gloss = 36.0;
    float rim = 0.1;
    vec3 emit = vec3(0.0);
    vec2 pc = vPc;

    if (kind < 0.5) {
      if (cap < 0.5) {
        // The drum wall: big structural panels, finer plating, and the windows.
        vec2 big = plating(pc, vec2(6.0, 5.0), 0.0);
        vec2 fine = plating(pc, vec2(2.0, 1.0), 1.0);
        albedo *= 0.8 + 0.5 * fine.y;
        albedo *= 1.0 - 0.55 * big.x - 0.25 * fine.x;
        albedo *= 0.8 + 0.4 * vnoise(pc * vec2(0.3, 0.5) + uSeed);
        float cover;
        float facing = smoothstep(0.08, 0.4, dot(N, V));
        emit += windows(pc, facing, vTag.z, cover);
        albedo *= 1.0 - 0.7 * cover;
      } else if (cap < 1.5) {
        vec2 a = plating(pc, vec2(6.0, 3.0), 0.0);
        albedo *= (0.85 + 0.4 * a.y) * (1.0 - 0.5 * a.x);
        albedo *= 1.15;
      } else {
        albedo *= 1.5;
        spec = 0.6;
      }
    } else if (kind < 1.5) {
      vec2 a = plating(pc, vec2(4.0, 3.0), 1.0);
      vec2 b = plating(pc, vec2(1.0, 1.0), 1.0);
      albedo *= (0.8 + 0.5 * a.y) * (1.0 - 0.55 * a.x - 0.2 * b.x);
      albedo *= 0.85 + 0.3 * vnoise(pc * 0.7 + uSeed);
    } else if (kind < 2.5) {
      // Engine bells: the darkest thing on the ship.
      albedo *= 0.45;
      spec = 0.5;
      gloss = 18.0;
    } else {
      // Radiator fins: fine ribs along the heat pipes.
      float stripe = 0.5 + 0.5 * cos(pc.x * 6.2831 * 0.5);
      albedo *= 0.7 + 0.5 * stripe;
      spec = 0.5;
      gloss = 60.0;
      rim = 0.25;
    }

    vec3 col = lightHull(albedo, N, V, spec, gloss, rim);
    // When the drive lights, the stern end of the hull picks up its cold light.
    col += vec3(0.25, 0.4, 1.0) * uBurn * 0.12 * (albedo * 18.0 + 0.01) * smoothstep(-0.2, -0.52, vObj.z);
    col += emit;
    gl_FragColor = vec4(col, uAlpha);
    ${outputChunks}
  }
`;

// The drive: three soft cold cones, lit one engine at a time. tag.x says which engine.
const torchVertex = /* glsl */ `
  attribute vec4 tag;
  uniform float uBurnAt;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vBurn;
  void main() {
    vec3 p = position;
    float on = uBurnAt + tag.x * 3.5;
    float burn = smoothstep(on, on + 9.0, uTime);
    vBurn = burn;
    p.z = -0.53 + (p.z + 0.53) * (0.2 + 0.8 * burn);
    p.xy *= 0.6 + 0.4 * burn;
    vUv = uv;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const torchFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vBurn;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    float soft = pow(abs(dot(N, V)), 2.4);       // fades to nothing at the edges: no hard flame
    float along = vUv.y;
    float core = exp(-along * 5.0);              // bright by the bell, a haze further out
    float haze = 0.16 * (1.0 - along) * (1.0 - along);
    float grain = 0.85 + 0.15 * vnoise(vec2(vUv.x * 7.0, along * 5.0 - uTime * 3.0));
    vec3 col = mix(vec3(0.2, 0.3, 0.95), vec3(0.78, 0.9, 1.0), core * core);
    col *= soft * (core + haze) * grain * 0.5 * vBurn * vBurn;
    gl_FragColor = vec4(col * uAlpha, 1.0);
    ${outputChunks}
  }
`;

// Round lamps: sized in screen pixels like the stars, so they read at any size.
// `on` is when a lamp starts to come on, and `ramp` how many seconds it takes.
const lampVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uBias;      // pulls the lamp towards the camera so its own ship doesn't cover it
  uniform float uTime;
  uniform float uAlpha;
  attribute float size;
  attribute vec3 tint;
  attribute vec2 timing;    // on, ramp
  varying vec3 vTint;
  varying float vLight;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    mv.z += uBias + 1.5e-5 * mv.z * mv.z; // and a little more the farther off it is, where depth gets coarse
    gl_Position = projectionMatrix * mv;
    float k = smoothstep(timing.x, timing.x + timing.y, uTime);
    vLight = k * uAlpha;
    vTint = tint;
    gl_PointSize = size * (0.4 + 0.6 * k) * uPixelRatio;
  }
`;

const lampFragment = /* glsl */ `
  varying vec3 vTint;
  varying float vLight;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0 || vLight < 0.003) discard;
    float fall = (1.0 - d * d);
    float core = smoothstep(0.3, 0.04, d);
    gl_FragColor = vec4(vTint * (core * 1.1 + fall * fall * fall * 0.55) * vLight, 1.0);
    ${outputChunks}
  }
`;

// --- Bits every sighting shares --------------------------------------------------------

const sunScratch = new Vector3();

/**
 * Direction to the light: towards the Sun, which is the world's origin unless the stage puts a
 * `sun` position in ctx. Copy the result if you keep it.
 */
function sunDirection(ctx, out = sunScratch) {
  if (ctx.sun) out.copy(ctx.sun).sub(ctx.anchor);
  else out.copy(ctx.anchor).negate();
  if (out.lengthSq() < 1e-6) out.set(0.3, 0.8, 0.5);
  return out.normalize();
}

/** The camera's place in a group's own space. */
function cameraIn(group, camera, out = new Vector3()) {
  group.updateWorldMatrix(true, false);
  return group.worldToLocal(out.copy(camera.position));
}

const frameInverse = new Matrix4();

/**
 * How the camera sees a group, in the group's own space: `toCam` points at the camera, `across`
 * runs along the longer side of the screen (sideways on a desktop, up and down on a phone held
 * upright) and `up` is the other way, so that across x up = toCam. Built from the camera's own
 * axes, so it still means "across the view" when the camera is rolled or looking from a planet.
 */
function viewFrame(group, camera) {
  group.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  frameInverse.copy(group.matrixWorld).invert();
  const toCam = cameraIn(group, camera).normalize();
  const e = camera.matrixWorld.elements;
  const wide = !(camera.aspect < 1);
  const across = new Vector3(e[wide ? 0 : 4], e[wide ? 1 : 5], e[wide ? 2 : 6]).transformDirection(frameInverse);
  across.addScaledVector(toCam, -across.dot(toCam));
  if (across.lengthSq() < 1e-6) across.crossVectors(toCam, Y); // the object is right off to the side of the view
  if (across.lengthSq() < 1e-6) across.crossVectors(toCam, X);
  across.normalize();
  return { toCam, across, up: new Vector3().crossVectors(toCam, across) };
}

const lookTo = new Vector3();

/**
 * How much of a lamp the camera can see, for a lamp that only shines out of one side:
 * `axis` is the way it faces, `coneDeg` the half-angle it can be seen across, softly edged.
 */
function coneSeen(axis, at, camera, coneDeg) {
  lookTo.copy(camera).sub(at).normalize();
  const edge = Math.cos(coneDeg * DEG);
  return smooth(edge - 0.12, edge + 0.12, axis.dot(lookTo));
}

/** Fades in over `fadeIn` seconds from the start and out over `fadeOut` before `seconds`. */
function envelope(t, seconds, fadeIn, fadeOut) {
  return Math.min(smooth(0, fadeIn, t), 1 - smooth(seconds - fadeOut, seconds, t));
}

const RIM_LAMP = [0.62, 0.9, 1.0];
const BELL_GLOW = [0.5, 0.7, 1.0];

// The faint cold light that traces every outline: all that's left when the Sun isn't on a ship.
const COLD_RIM = [0.05, 0.1, 0.12];

/**
 * A handful of round lamps drawn as one Points object. Each has its own spot,
 * size in pixels, colour (which may be changed every frame to blink it) and the
 * time it comes on.
 */
class Lamps {
  constructor(count, pixelRatio, shared) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.size = new Float32Array(count).fill(6);
    this.tint = new Float32Array(count * 3);
    this.timing = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) this.timing.set([-10, 1], i * 2);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("size", new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("tint", new BufferAttribute(this.tint, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute("timing", new BufferAttribute(this.timing, 2));
    this.mat = new ShaderMaterial({
      vertexShader: lampVertex,
      fragmentShader: lampFragment,
      uniforms: { uPixelRatio: { value: pixelRatio }, uBias: { value: 0 }, uTime: shared.uTime, uAlpha: shared.uAlpha },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  set(i, x, y, z, size, color, brightness = 1) {
    this.pos.set([x, y, z], i * 3);
    this.size[i] = size;
    this.tint.set([color[0] * brightness, color[1] * brightness, color[2] * brightness], i * 3);
  }

  timeIt(i, on, ramp) {
    this.timing.set([on, ramp], i * 2);
    this.geo.attributes.timing.needsUpdate = true;
  }

  changed() {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.tint.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// --- The generation ship (the sighting) --------------------------------------------------

export function createGenerationShip(pixelRatio) {
  const group = new Group();
  group.visible = false;
  const ship = new Group(); // the ship's own frame: bow along +z
  group.add(ship);

  const shared = {
    uSun: { value: new Vector3(0, 1, 0) },
    uRim: { value: new Vector3(...COLD_RIM) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  const seconds = 130;
  const tWake = 14; // windows start to wake
  const tLamps = 76; // the cold lamps
  const tBurn = 100; // the drive

  const hullMat = new ShaderMaterial({
    vertexShader: hullVertex({ spin: true }),
    fragmentShader: generationFragment,
    uniforms: { ...shared, uSpin: { value: 0 }, uWake: { value: tWake }, uBurn: { value: 0 }, uSeed: { value: 1 } },
    transparent: true,
    side: DoubleSide,
  });
  const hullGeo = generationHull();
  const hull = new Mesh(hullGeo, hullMat);
  hull.frustumCulled = false;
  ship.add(hull);

  const torchMat = new ShaderMaterial({
    vertexShader: torchVertex,
    fragmentShader: torchFragment,
    uniforms: { uBurnAt: { value: tBurn }, uTime: shared.uTime, uAlpha: shared.uAlpha },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const torchGeo = torchGeometry();
  // The torch has no uv of its own; the surface's pc is (angle, how far along).
  torchGeo.setAttribute("uv", torchGeo.getAttribute("pc"));
  const torch = new Mesh(torchGeo, torchMat);
  torch.frustumCulled = false;
  torch.renderOrder = 2;
  ship.add(torch);

  // Twelve cold lamps set in the rim of the shield plate, coming on one at a time before the
  // drive lights, then a glow in each bell as it lights. A lamp shines outwards, so it is
  // only there for a camera on that side (the plate hides it otherwise).
  const lampCount = 12;
  const lamps = new Lamps(lampCount + 3, pixelRatio, shared);
  const lampAt = [];
  const lampFaces = [];
  for (let i = 0; i < lampCount; i++) {
    const a = (i / lampCount) * TAU;
    lampAt.push(new Vector3(Math.cos(a) * (SHIP.shieldR + 0.002), Math.sin(a) * (SHIP.shieldR + 0.002), SHIP.shieldZ + 0.009));
    lampFaces.push(new Vector3(Math.cos(a), Math.sin(a), 0));
    lamps.timeIt(i, tLamps + i * 1.1, 0.9);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    lampAt.push(new Vector3(Math.cos(a) * SHIP.bellRing, Math.sin(a) * SHIP.bellRing, SHIP.stern - 0.004));
    lampFaces.push(new Vector3(0, 0, -1));
    lamps.timeIt(lampCount + k, tBurn + k * 3.5, 8);
  }
  ship.add(lamps.points);

  const state = { t: 0, along: 0, speed: 0.0065, spin: 0, axis: new Vector3(0, 0, 1) };
  const camS = new Vector3();

  return {
    id: "generation",
    name: "Generation ship",
    about: "An invented sighting: a vast, silent ship turning its great drums for a crew that has been asleep for centuries.",
    group,
    angle: 24,
    seconds,
    start(ctx) {
      const rand = ctx.random;
      state.t = 0;
      state.spin = rand() * TAU;
      // Across the view, with the stern tipped a little towards you: the dark bells come first.
      const { toCam, across } = viewFrame(group, ctx.camera);
      const sideways = across.applyAxisAngle(toCam, (rand() - 0.5) * 1.2);
      if (rand() < 0.5) sideways.negate();
      const tilt = 0.28 + 0.14 * rand();
      state.axis.copy(sideways).multiplyScalar(Math.cos(tilt)).addScaledVector(toCam, -Math.sin(tilt)).normalize();
      ship.quaternion.setFromUnitVectors(Z, state.axis);
      ship.quaternion.multiply(new Quaternion().setFromAxisAngle(Z, rand() * TAU));
      state.along = -0.62;
      hullMat.uniforms.uSeed.value = 1 + Math.floor(rand() * 90);
      hullMat.uniforms.uBurn.value = 0;
      lamps.mat.uniforms.uBias.value = 0.06 * ctx.scale;
      shared.uAlpha.value = 0;
      shared.uTime.value = 0;
      ship.position.copy(state.axis).multiplyScalar(state.along);
      group.visible = true;
    },
    update(dt, ctx) {
      state.t += dt;
      const t = state.t;
      if (t >= seconds) {
        group.visible = false;
        return false;
      }
      shared.uAlpha.value = envelope(t, seconds, 9, 14);
      shared.uTime.value = t;
      state.spin += dt * 0.06;
      hullMat.uniforms.uSpin.value = state.spin;
      const burn = smooth(tBurn, tBurn + 12, t);
      hullMat.uniforms.uBurn.value = burn;
      // Drifts, then the drive takes hold and it leaves.
      state.along += (state.speed + 0.0016 * Math.max(0, t - tBurn - 6) * burn) * dt;
      ship.position.copy(state.axis).multiplyScalar(state.along);
      hullMat.uniforms.uSun.value.copy(sunDirection(ctx));
      cameraIn(ship, ctx.camera, camS);
      for (let i = 0; i < lampAt.length; i++) {
        const bell = i >= lampCount;
        const seen = coneSeen(lampFaces[i], lampAt[i], camS, bell ? 80 : 100);
        const p = lampAt[i];
        if (bell) lamps.set(i, p.x, p.y, p.z, 26, BELL_GLOW, seen);
        else lamps.set(i, p.x, p.y, p.z, 7, RIM_LAMP, seen);
      }
      lamps.changed();
      return true;
    },
    dispose() {
      hullGeo.dispose();
      torchGeo.dispose();
      hullMat.dispose();
      torchMat.dispose();
      lamps.dispose();
    },
  };
}

// --- The shuttle lane ---------------------------------------------------------------------

// One small shuttle, nose to +z and about one unit long (the sighting scales it down).
// Parts (tag.x): 1 plated hull, 2 engine bell, 4 the canopy, which gives off a cold light.
function shuttleGeometry() {
  const m = new Mesher();
  const hull = [1, 0, 0, 0];
  const cell = 0.05;
  m.place(new Matrix4().makeScale(1, 0.7, 1));
  m.lathe([[-0.4, 0], [-0.4, 0.09], [-0.32, 0.12], [0.12, 0.12], [0.3, 0.085], [0.43, 0.03], [0.47, 0]], 10, { tag: hull, cell });
  m.place(turned(X, -0.2, 0, 0.083, 0.22));
  m.box(0.075, 0.03, 0.11, { tag: [4, 0, 0, 0], cell });
  for (const s of [1, -1]) {
    // Engine pod, with its dark bell, on a strut; a swept stub of a wing; the cargo pod below.
    m.place(move(s * 0.17, -0.02, 0));
    m.lathe([[-0.46, 0], [-0.46, 0.05], [-0.4, 0.06], [-0.05, 0.06], [0.03, 0.04], [0.07, 0]], 10, { tag: hull, cell });
    m.lathe([[-0.52, 0], [-0.52, 0.052], [-0.46, 0.05]], 10, { tag: [2, 0, 0, 0], cell });
    m.place(move(s * 0.09, -0.02, -0.2));
    m.box(0.12, 0.02, 0.1, { tag: hull, cell });
    m.place(turned(Y, s * 0.3, s * 0.22, -0.02, -0.06));
    m.box(0.2, 0.012, 0.15, { tag: hull, cell });
  }
  m.place(turned(X, 0.25, 0, 0.14, -0.3));
  m.box(0.012, 0.16, 0.14, { tag: hull, cell });
  m.place(move(0, -0.1, -0.08));
  m.box(0.18, 0.075, 0.36, { tag: hull, cell });
  return m.geometry();
}

// The lamps on every shuttle, the way aircraft carry them: red on the left, green on the
// right, white at the tail, each seen only from the side it faces, and one strobe that
// flashes twice and rests. `cone` is the half-angle (degrees) it can be seen across.
const SHUTTLE_LAMPS = [
  { at: [0.33, -0.02, -0.1], axis: [0.819, 0, 0.574], cone: 62, color: [1.0, 0.05, 0.03], size: 12, level: 1 },
  { at: [-0.33, -0.02, -0.1], axis: [-0.819, 0, 0.574], cone: 62, color: [0.1, 1.0, 0.3], size: 12, level: 0.85 },
  { at: [0, 0.0, -0.42], axis: [0, 0, -1], cone: 70, color: [0.9, 0.95, 1.0], size: 8, level: 0.6 },
  { at: [0, 0.228, -0.33], axis: [0, 1, 0], cone: 180, color: [0.92, 0.96, 1.0], size: 12, level: 0.9, strobe: true },
  { at: [0.17, -0.02, -0.535], axis: [0, 0, -1], cone: 80, color: [0.5, 0.72, 1.0], size: 9, level: 0.6 },
  { at: [-0.17, -0.02, -0.535], axis: [0, 0, -1], cone: 80, color: [0.5, 0.72, 1.0], size: 9, level: 0.6 },
];

const laneFragment = /* glsl */ `
  ${hullLib}
  uniform float uAlpha;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vPc;
  varying vec4 vTag;
  varying vec2 vInst;   // how much of the shuttle is there, and how bright its cabin light is
  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    float kind = vTag.x;
    vec3 albedo = vec3(0.075, 0.08, 0.09);
    float spec = 0.5;
    float gloss = 30.0;
    vec3 emit = vec3(0.0);
    if (kind < 1.5) {
      vec2 a = plating(vPc, vec2(2.0, 1.6), 1.0);
      albedo *= (0.8 + 0.5 * a.y) * (1.0 - 0.6 * a.x);
    } else if (kind < 2.5) {
      albedo *= 0.4;
    } else {
      albedo = vec3(0.01);
      spec = 1.0;
      gloss = 80.0;
      emit = vec3(0.5, 0.78, 1.0) * vInst.y * (0.45 + 0.55 * pow(max(dot(N, V), 0.0), 0.5));
    }
    vec3 col = lightHull(albedo, N, V, spec, gloss, 0.45) + emit;
    gl_FragColor = vec4(col, uAlpha * vInst.x);
    ${outputChunks}
  }
`;

export function createShuttleLane(pixelRatio) {
  const group = new Group();
  group.visible = false;
  const count = 5;
  const seconds = 84;
  const shared = {
    uSun: { value: new Vector3(0, 1, 0) },
    uRim: { value: new Vector3(...COLD_RIM) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  const geo = shuttleGeometry();
  const inst = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
  inst.setUsage(DynamicDrawUsage);
  geo.setAttribute("inst", inst);
  const mat = new ShaderMaterial({
    vertexShader: hullVertex({ instanced: true }),
    fragmentShader: laneFragment,
    uniforms: { ...shared },
    transparent: true,
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  group.add(mesh);
  const lamps = new Lamps(count * SHUTTLE_LAMPS.length, pixelRatio, shared);
  group.add(lamps.points);

  const spacing = 0.25;
  const speed = 0.011;
  const turner = count - 1; // the last one in line
  const ships = [];
  const state = { t: 0, dir: new Vector3(1, 0, 0), side: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1), lead: 0.33 };
  const camL = new Vector3();
  const pos = new Vector3();
  const lampAt = new Vector3();
  const axis = new Vector3();
  const qBase = new Quaternion();
  const qFace = new Quaternion();
  const q = new Quaternion();
  const dummy = new Object3D();
  const basis = new Matrix4();

  return {
    id: "lane",
    name: "Shuttle lane",
    about: "An invented sighting: a line of small ships, running their lights as aircraft do, going somewhere in perfect order.",
    group,
    angle: 16,
    seconds,
    start(ctx) {
      const rand = ctx.random;
      state.t = 0;
      const { toCam: toCamera, across } = viewFrame(group, ctx.camera);
      state.dir.copy(across).applyAxisAngle(toCamera, (rand() - 0.5) * 0.9);
      if (rand() < 0.5) state.dir.negate();
      // Slantwise, so each ship shows its side lamp and either its tail or its nose too.
      const tilt = (0.5 + 0.25 * rand()) * (rand() < 0.7 ? 1 : -1);
      state.dir.multiplyScalar(Math.cos(tilt)).addScaledVector(toCamera, -Math.sin(tilt)).normalize();
      state.side.crossVectors(state.dir, toCamera).normalize();
      state.up.crossVectors(state.dir, state.side).normalize();
      basis.makeBasis(state.side, state.up, state.dir);
      qBase.setFromRotationMatrix(basis);
      ships.length = 0;
      for (let i = 0; i < count; i++) {
        ships.push({
          size: 0.17 * (0.9 + 0.2 * rand()),
          phase: rand() * TAU,
          sway: [0.15 + 0.1 * rand(), 0.12 + 0.1 * rand(), rand() * TAU, rand() * TAU],
          on: 2 + i * 3.5, // when its lamps come on
          flash: i * 0.18, // each strobe fires just after the one in front: a ripple down the line
        });
      }
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < SHUTTLE_LAMPS.length; j++) lamps.timeIt(i * SHUTTLE_LAMPS.length + j, ships[i].on, 1.5);
      }
      shared.uAlpha.value = 0;
      lamps.mat.uniforms.uBias.value = 0.04 * ctx.scale;
      group.visible = true;
    },
    update(dt, ctx) {
      state.t += dt;
      const t = state.t;
      if (t >= seconds) {
        group.visible = false;
        return false;
      }
      shared.uAlpha.value = envelope(t, seconds, 3, 8);
      shared.uTime.value = t;
      mat.uniforms.uSun.value.copy(sunDirection(ctx));
      cameraIn(group, ctx.camera, camL);
      // The last ship turns to look at you, stops its strobe, and turns back.
      const face = smooth(32, 41, t) * (1 - smooth(58, 67, t));
      const lead = state.lead + speed * t;
      let k = 0;
      for (let i = 0; i < count; i++) {
        const s = ships[i];
        const along = lead - i * spacing;
        pos.copy(state.dir).multiplyScalar(along);
        pos.addScaledVector(state.side, 0.006 * Math.sin(t * s.sway[0] + s.sway[2]));
        pos.addScaledVector(state.up, 0.006 * Math.sin(t * s.sway[1] + s.sway[3]));
        q.copy(qBase);
        let looking = 0;
        if (i === turner && face > 0) {
          dummy.position.copy(pos);
          dummy.up.copy(state.up); // keep its own way up while it turns
          dummy.lookAt(camL);
          qFace.copy(dummy.quaternion);
          q.slerp(qFace, face);
          looking = face;
        }
        const here = smooth(s.on - 1, s.on + 2, t);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        dummy.scale.setScalar(s.size);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        inst.setXY(i, here, 0.3 + 0.7 * smooth(0.4, 0.95, looking));

        for (const lamp of SHUTTLE_LAMPS) {
          lampAt.set(...lamp.at).multiplyScalar(s.size).applyQuaternion(q).add(pos);
          const seen = lamp.cone < 170 ? coneSeen(axis.set(...lamp.axis).applyQuaternion(q), lampAt, camL, lamp.cone) : 1;
          let level = lamp.level * seen;
          if (lamp.strobe) {
            const ph = ((t + s.flash) % 1.9) / 1.9;
            const flash = ph < 0.07 || (ph > 0.14 && ph < 0.21) ? 1 : 0; // two flashes and a rest, long enough to catch at a low frame rate
            level *= flash * (1 - smooth(0.3, 0.7, looking));
          }
          lamps.set(k, lampAt.x, lampAt.y, lampAt.z, lamp.size, lamp.color, level);
          k++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      inst.needsUpdate = true;
      lamps.changed();
      return true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
      lamps.dispose();
    },
  };
}

// --- The derelict -------------------------------------------------------------------------

// Part kinds (tag.x): 1 plated skin, 3 radiator panel (torn by the shader), 5 bare frame,
// 6 a loose piece (moves by itself), 7 dark glass.
// The wreck's long axis is z and it travels along +x. Everything is built round the origin;
// the shader tumbles the wreck and moves it along.
const WRECK = { R: 0.07, fore: 0.28, travel: 0.0085 };
const BEACON_AT = [0.0, 0.178, 0.1];
// The bridge window (a flat pane on the nose, tipped back 0.12 radians) and the way it faces.
const GLASS_AT = new Vector3(0, 0.083, 0.39);
const GLASS_FACE = new Vector3(0, Math.cos(0.12), -Math.sin(0.12));

function derelictHull() {
  const rand = random(404);
  const m = new Mesher();
  const hull = [1, 0, 0, 0];
  const frame = [5, 0, 0, 0];
  const { R, fore } = WRECK;
  const cell = 0.012;

  // The skin, in strips round the hull. Each strip is torn off at its own length with a
  // ragged edge, and a few curl outwards like petals. The torn side faces one way.
  const strips = 22;
  for (let s = 0; s < strips; s++) {
    const a0 = (s / strips) * TAU;
    const a1 = ((s + 1) / strips) * TAU;
    const near = 0.5 + 0.5 * Math.sin(a0 + 0.9); // 1 on the side that took the damage
    const end = -0.34 + 0.3 * (1 - near) * (0.5 + 0.5 * rand()) + 0.05 * rand();
    const peel = rand() < 0.5 + 0.3 * near ? 0.025 + 0.075 * rand() : 0;
    const jagK = 3 + Math.floor(rand() * 3);
    const jag = 0.012 + 0.024 * rand();
    const point = (u, w) => {
      const a = a0 + (a1 - a0) * u;
      const zEnd = end - jag * Math.abs(((u * jagK * 2) % 2) - 1);
      const curl = Math.pow(Math.max(0, 1 - w / 0.3), 2);
      const r = R + peel * curl;
      return [Math.cos(a) * r, Math.sin(a) * r, zEnd + (fore - zEnd) * w];
    };
    m.surface(point, 3, 10, { tag: hull, pc: (u, w) => [((s + u) / strips) * 44, point(u, w)[2] / cell] });
  }
  // Raised bands round the sound part of the hull.
  for (const z of [0.2, 0.09, -0.02]) {
    m.lathe([[z - 0.007, R], [z - 0.007, R + 0.003], [z + 0.007, R + 0.003], [z + 0.007, R]], 44, { tag: hull, cell });
  }

  // The frame showing where the skin has gone: rings, some knocked out of line, and stringers.
  const ring = (z, tilt, dx) => {
    m.place(turned(X, tilt, dx, 0, z));
    const a = R - 0.012;
    const b = R - 0.002;
    m.lathe([[-0.003, a], [-0.003, b], [0.003, b], [0.003, a], [-0.003, a]], 44, { tag: frame, cell: 0.01 });
  };
  [-0.32, -0.25, -0.18, -0.11, -0.04, 0.03, 0.1].forEach((z, i) => ring(z, i < 3 ? (rand() - 0.5) * 0.18 : 0, i < 3 ? (rand() - 0.5) * 0.012 : 0));
  m.place(new Matrix4());
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * TAU + 0.07;
    const len = 0.12 + 0.3 * rand();
    const z1 = 0.05;
    const bend = rand() < 0.35 ? 0.15 + 0.3 * rand() : 0;
    m.place(turned(Z, a).multiply(move(R - 0.008, 0, z1 - len / 2)).multiply(new Matrix4().makeRotationY(bend)));
    m.box(0.005, 0.007, len, { tag: frame, cell: 0.01 });
  }
  m.place(new Matrix4());

  // The bridge: a blunt faceted nose with a strip of dead glass.
  m.lathe([[fore, 0], [fore, 0.076], [0.33, 0.086], [0.42, 0.07], [0.49, 0.03], [0.52, 0]], 8, { tag: hull, cell: 0.014 });
  m.place(turned(X, -0.12, 0, 0.083, 0.39));
  m.box(0.07, 0.004, 0.05, { tag: [7, 0, 0, 0], cell: 0.01 });
  m.place(move(0, 0.11, 0.1));
  m.box(0.006, 0.07, 0.006, { tag: hull, cell: 0.01 }); // the beacon's mast
  m.place(move(0.04, 0.09, 0.2));
  m.box(0.004, 0.05, 0.004, { tag: hull, cell: 0.01 });
  m.place(new Matrix4());

  // A rail down one side with the containers still on it; two have come adrift on bent arms.
  m.place(move(-0.105, 0, -0.02));
  m.box(0.008, 0.008, 0.52, { tag: hull, cell: 0.012 });
  m.place(new Matrix4());
  const slots = [0.2, 0.1, 0.0, -0.1, -0.2];
  slots.forEach((z, i) => {
    if (i === 3) return; // gone
    const loose = i === 1 || i === 4;
    m.place(turned(Z, 0, -0.105, 0, 0).multiply(move(0, 0, z - 0.02)));
    m.box(0.07, 0.006, 0.006, { tag: hull, cell: 0.01 });
    const lift = loose ? 0.3 + 0.2 * rand() : 0;
    m.place(turned(Y, (rand() - 0.5) * (loose ? 0.6 : 0.04), -0.148 - (loose ? 0.02 : 0), 0.0 + (loose ? 0.04 : 0), z - 0.02).multiply(new Matrix4().makeRotationZ(lift * (i === 1 ? 1 : -1))));
    m.box(0.065, 0.058, 0.085, { tag: hull, cell: 0.014 });
  });
  m.place(new Matrix4());

  // The radiator wing: one panel on an arm, one folded back, both torn.
  m.place(move(0.17, 0.02, 0.12));
  m.box(0.2, 0.006, 0.006, { tag: hull, cell: 0.01 });
  m.place(turned(Z, 0.12, 0.28, 0.03, 0.12));
  m.surface((u, v) => [(u - 0.5) * 0.2, 0, (v - 0.5) * 0.34], 1, 1, { tag: [3, 10, 17, 0], pc: (u, v) => [u * 10, v * 17] });
  m.place(turned(Y, 0.0, 0.46, 0.1, 0.11).multiply(new Matrix4().makeRotationZ(0.9)));
  m.surface((u, v) => [(u - 0.5) * 0.14, 0, (v - 0.5) * 0.3], 1, 1, { tag: [3, 7, 15, 0], pc: (u, v) => [u * 7, v * 15] });
  m.place(new Matrix4());

  // A fuel tank dangling from the broken stern by one strut.
  m.place(turned(X, 0.35, 0.0, -0.1, -0.31));
  const tank = [[-0.1, 0], [-0.096, 0.025], [-0.085, 0.04], [-0.07, 0.045], [0.07, 0.045], [0.085, 0.04], [0.096, 0.025], [0.1, 0]];
  m.lathe(tank, 16, { tag: hull, cell: 0.012 });
  m.place(turned(X, 0.5, 0, -0.05, -0.2));
  m.box(0.006, 0.006, 0.14, { tag: frame, cell: 0.01 });
  m.place(new Matrix4());

  // Loose pieces strung out behind and a little ahead: plates, girders and a pod. Each turns
  // about its own middle and drifts, in step with the wreck.
  const pieces = 20;
  for (let i = 0; i < pieces; i++) {
    const behind = i < 15 ? -(0.08 + 0.85 * Math.pow(rand(), 0.8)) : 0.1 + 0.25 * rand();
    const spread = 0.04 + 0.1 * Math.abs(behind);
    const at = [-0.5 + behind - 0.1, (rand() - 0.5) * spread * 2, (rand() - 0.5) * spread * 2];
    const axis = randomUnit(rand);
    const mot = [at[0], at[1], at[2], axis[0], axis[1], axis[2], (rand() < 0.5 ? -1 : 1) * (0.03 + 0.25 * rand()), WRECK.travel + (rand() - 0.5) * 0.004, (rand() - 0.5) * 0.004, (rand() - 0.5) * 0.004];
    m.place(move(at[0], at[1], at[2]).multiply(new Matrix4().makeRotationFromEuler(new Euler(rand() * TAU, rand() * TAU, rand() * TAU))));
    const kind = rand();
    if (kind < 0.55) m.box(0.025 + 0.06 * rand(), 0.003, 0.025 + 0.05 * rand(), { tag: [6, 0, 0, 0], cell: 0.012, mot });
    else if (kind < 0.85) m.box(0.004, 0.005, 0.07 + 0.14 * rand(), { tag: [6, 1, 0, 0], cell: 0.012, mot });
    else m.lathe([[-0.025, 0], [-0.02, 0.014], [0.02, 0.014], [0.025, 0]], 8, { tag: [6, 0, 0, 0], cell: 0.012, mot });
  }
  m.place(new Matrix4());
  return m.geometry();
}

function randomUnit(rand) {
  const z = 2 * rand() - 1;
  const a = TAU * rand();
  const s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, Math.sin(a) * s, z];
}

const derelictFragment = /* glsl */ `
  ${hullLib}
  uniform float uAlpha;
  uniform vec3 uBeacon;       // world position of the beacon
  uniform float uBeaconLight; // how bright it is right now
  uniform float uCabin;       // the cold light behind the bridge glass
  uniform float uScale;       // world size of one unit of the model
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying vec2 vPc;
  varying vec4 vTag;
  void main() {
    float kind = vTag.x;
    vec3 N = normalize(vNormal);
    if (kind > 2.5 && kind < 3.5) {
      // A radiator panel: ragged where it has been torn, and ribbed where it hasn't.
      vec2 g = vPc;
      float tear = vnoise(g * 0.9) * 0.6 + vnoise(g * 2.3) * 0.3 + vnoise(g * 5.0) * 0.1;
      vec2 across = abs(vPc / vTag.yz - 0.5) * 2.0;
      float edge = max(across.x, across.y);
      if (tear + 0.55 * edge * edge > 0.95 || tear < 0.22) discard;
    }
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 albedo = vec3(0.05, 0.052, 0.058);
    float spec = 0.4;
    float gloss = 30.0;
    float rim = 0.18;
    if (kind < 1.5 || (kind > 5.5 && kind < 6.5)) {
      vec2 a = plating(vPc, vec2(4.0, 3.0), 1.0);
      vec2 b = plating(vPc, vec2(1.0, 1.0), 1.0);
      albedo *= (0.7 + 0.6 * a.y) * (1.0 - 0.6 * a.x - 0.2 * b.x);
      // soot and old scorching, in long streaks
      float soot = vnoise(vPc * vec2(0.5, 0.2) + 3.0) * vnoise(vPc * vec2(1.3, 0.5));
      albedo *= 1.0 - 0.7 * smoothstep(0.15, 0.4, soot);
    } else if (kind < 3.5) {
      float ribs = 0.5 + 0.5 * cos(vPc.x * 6.2831);
      albedo = vec3(0.035, 0.04, 0.05) * (0.6 + 0.6 * ribs);
      gloss = 60.0;
    } else if (kind < 5.5) {
      albedo = vec3(0.04, 0.038, 0.037) * (0.6 + 0.8 * vnoise(vObj.xz * 90.0));
      spec = 0.2;
    } else {
      albedo = vec3(0.004);
      spec = 1.2;
      gloss = 90.0;
    }
    vec3 col = lightHull(albedo, N, V, spec, gloss, rim);

    // The beacon lights what is near it, red, and shows the shape of the wreck as it swells.
    vec3 toB = uBeacon - vWorld;
    float dist = length(toB) / uScale;
    vec3 L = toB / max(length(toB), 1e-5);
    float near = 1.0 / (1.0 + dist * dist * 34.0);
    float facing = clamp(dot(N, L) * 0.85 + 0.15, 0.0, 1.0);
    vec3 red = vec3(1.0, 0.14, 0.07);
    col += red * (albedo * 9.0 + 0.008) * facing * near * uBeaconLight;
    vec3 H = normalize(L + V);
    col += red * spec * pow(max(dot(N, H), 0.0), gloss) * near * uBeaconLight * 0.6;
    if (kind > 6.5) col += vec3(0.4, 0.8, 0.74) * uCabin * (0.2 + 0.3 * pow(max(dot(N, V), 0.0), 0.6));
    gl_FragColor = vec4(col, uAlpha);
    ${outputChunks}
  }
`;

export function createDerelict(pixelRatio) {
  const group = new Group();
  group.visible = false;
  const rig = new Group(); // turned so the wreck travels across the view
  group.add(rig);
  const shared = {
    uSun: { value: new Vector3(0, 1, 0) },
    uRim: { value: new Vector3(...COLD_RIM) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  const seconds = 110;
  const mat = new ShaderMaterial({
    vertexShader: hullVertex({ tumble: true }),
    fragmentShader: derelictFragment,
    uniforms: {
      ...shared,
      uTumble: { value: new Matrix3() },
      uCenter: { value: new Vector3() },
      uBeacon: { value: new Vector3() },
      uBeaconLight: { value: 0 },
      uCabin: { value: 0 },
      uScale: { value: 1 },
    },
    transparent: true,
    side: DoubleSide,
  });
  const geo = derelictHull();
  const hull = new Mesh(geo, mat);
  hull.frustumCulled = false;
  rig.add(hull);

  // Lamp 0 is the beacon. Lamp 1 is a cold glow behind the bridge glass, which comes on once.
  const lamps = new Lamps(2, pixelRatio, shared);
  lamps.set(0, 0, 0, 0, 20, [1.0, 0.16, 0.08], 0);
  lamps.set(1, 0, 0, 0, 10, [0.45, 0.85, 0.8], 0);
  rig.add(lamps.points);

  const state = { t: 0, spin: new Quaternion(), x: -0.5, cabin: 0, cabinAt: 58, cabinSince: 0 };
  const step = new Quaternion();
  const omega = new Vector3(0.05, 0.022, 0.11); // radians a second about the wreck's own axes
  const euler = new Euler();
  const m3 = new Matrix3();
  const m4 = new Matrix4();
  const beacon = new Vector3();
  const glass = new Vector3();
  const glassFace = new Vector3();
  const toGlass = new Vector3();
  const camera = new Vector3();
  const period = 5.4;
  const cabinFor = 11; // how long it stays

  return {
    id: "derelict",
    name: "Derelict",
    about: "An invented sighting: a dead ship, torn open and tumbling, with one emergency beacon still calling out to nobody.",
    group,
    angle: 12,
    seconds,
    start(ctx) {
      const rand = ctx.random;
      state.t = 0;
      state.cabin = 0;
      state.cabinAt = 50 + 18 * rand(); // earliest the bridge light may come on
      state.spin.setFromAxisAngle(new Vector3(...randomUnit(rand)), rand() * TAU);
      // It travels across the view, with a little of the way towards or away from you.
      const { toCam, across } = viewFrame(group, ctx.camera);
      const dir = across.applyAxisAngle(toCam, (rand() - 0.5) * 0.8);
      if (rand() < 0.5) dir.negate();
      const tilt = (0.15 + 0.2 * rand()) * (rand() < 0.5 ? 1 : -1);
      dir.multiplyScalar(Math.cos(tilt)).addScaledVector(toCam, Math.sin(tilt)).normalize();
      const side = new Vector3().crossVectors(dir, toCam).normalize();
      const upAxis = new Vector3().crossVectors(side, dir).normalize();
      m4.makeBasis(dir, upAxis, side); // +x along the way it goes
      rig.quaternion.setFromRotationMatrix(m4);
      state.x = -0.5;
      mat.uniforms.uScale.value = ctx.scale;
      mat.uniforms.uCabin.value = 0;
      shared.uAlpha.value = 0;
      lamps.mat.uniforms.uBias.value = 0.05 * ctx.scale;
      group.visible = true;
    },
    update(dt, ctx) {
      state.t += dt;
      const t = state.t;
      if (t >= seconds) {
        group.visible = false;
        return false;
      }
      shared.uAlpha.value = envelope(t, seconds, 6, 10);
      shared.uTime.value = t;
      // Tumble: turn a little about each of the wreck's own axes.
      step.setFromEuler(euler.set(omega.x * dt, omega.y * dt, omega.z * dt));
      state.spin.multiply(step).normalize();
      m4.makeRotationFromQuaternion(state.spin);
      m3.setFromMatrix4(m4);
      state.x += WRECK.travel * dt;
      mat.uniforms.uTumble.value.copy(m3);
      mat.uniforms.uCenter.value.set(state.x, 0, 0);

      // The beacon swells over a second or so, then dies back.
      const ph = (t % period) / period;
      const swell = ph < 0.2 ? smooth(0, 0.2, ph) : Math.exp(-(ph - 0.2) * 4.8);
      const level = 0.04 + 0.96 * swell;
      beacon.set(...BEACON_AT).applyMatrix4(m4).add(mat.uniforms.uCenter.value);
      lamps.set(0, beacon.x, beacon.y, beacon.z, 10 + 24 * level, [1.0, 0.16, 0.08], level);

      // Late on, once the bridge window has turned to face you, a cold light comes up behind it,
      // stays a while and goes out. If it never faces you in time, it never comes on.
      glass.copy(GLASS_AT).applyMatrix4(m4).add(mat.uniforms.uCenter.value);
      glassFace.copy(GLASS_FACE).transformDirection(m4);
      toGlass.copy(cameraIn(rig, ctx.camera, camera)).sub(glass).normalize();
      const facing = glassFace.dot(toGlass);
      if (state.cabin === 0 && t > state.cabinAt && facing > 0.35) {
        state.cabin = 1;
        state.cabinSince = t;
      } else if (state.cabin === 0 && t > seconds - 20) state.cabin = 2;
      let cabin = 0;
      if (state.cabin === 1) {
        const since = t - state.cabinSince;
        cabin = smooth(0, 3, since) * (1 - smooth(cabinFor - 3, cabinFor, since));
        if (since >= cabinFor) state.cabin = 2;
      }
      mat.uniforms.uCabin.value = cabin;
      lamps.set(1, glass.x, glass.y, glass.z, 10, [0.45, 0.85, 0.8], cabin * 0.55 * smooth(0.0, 0.3, facing));
      lamps.changed();

      rig.updateWorldMatrix(true, false);
      mat.uniforms.uBeacon.value.copy(beacon).applyMatrix4(rig.matrixWorld);
      mat.uniforms.uBeaconLight.value = level;
      mat.uniforms.uSun.value.copy(sunDirection(ctx));
      return true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lamps.dispose();
    },
  };
}

// --- The Voyagers (real) --------------------------------------------------------------------

// A model of the real probe, one unit being about 14 metres, so its 13 m magnetometer boom
// is nearly a unit long and the 3.7 m dish about a quarter of that. The dish points up (+z),
// towards the Sun and Earth. Thin parts are drawn thicker than life so they stay visible.
// Parts (tag.x): 0 dish (tag.y 2 on its rim), 1 gold foil on the body, 2 booms and rods,
// 3 the power units on their boom, 5 the camera platform.
const M = 1 / 14;

/** A thin square rod from a to b, in metres. */
function rod(m, a, b, thick, tag) {
  const from = new Vector3(a[0] * M, a[1] * M, a[2] * M);
  const to = new Vector3(b[0] * M, b[1] * M, b[2] * M);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(Z, dir.normalize());
  m.place(new Matrix4().compose(from.add(to).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  m.box(thick, thick, len, { tag, cell: 0.02 });
}

function voyagerGeometry() {
  const m = new Mesher();
  const dishR = 1.83 * M;
  const depth = 0.8 * M;

  // The dish: a shallow bowl, seen from inside from the Sun's side.
  m.surface(
    (u, v) => {
      const a = u * TAU;
      const r = dishR * (0.01 + 0.99 * v);
      return [Math.cos(a) * r, Math.sin(a) * r, -depth * (1 - Math.pow(0.01 + 0.99 * v, 2))];
    },
    48, 6, { tag: [0, 0, 0, 0], flip: true, pc: (u, v) => [u * 24, v * 6] },
  );
  m.lathe([[-0.004, dishR], [-0.004, dishR + 0.006], [0.004, dishR + 0.006], [0.004, dishR]], 48, { tag: [0, 2, 0, 0], cell: 0.02 });

  // The feed on four struts, and its small mirror.
  const apex = [0, 0, 0.45];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.78;
    rod(m, [Math.cos(a) * 1.83, Math.sin(a) * 1.83, 0], apex, 0.006, [2, 0, 0, 0]);
  }
  m.place(new Matrix4());
  m.lathe([[0.45 * M - 0.004, 0], [0.45 * M - 0.004, 0.2 * M], [0.45 * M + 0.002, 0.2 * M], [0.45 * M + 0.002, 0]], 16, { tag: [2, 0, 0, 0], cell: 0.02 });

  // The body: a ten-sided box wrapped in gold foil, right under the dish.
  const bz0 = -depth - 0.47 * M;
  const bz1 = -depth;
  const br = 0.89 * M;
  for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * TAU;
    const a1 = ((k + 1) / 10) * TAU;
    m.surface(
      (u, v) => [Math.cos(a0 + (a1 - a0) * u) * br, Math.sin(a0 + (a1 - a0) * u) * br, bz0 + (bz1 - bz0) * v],
      1, 1, { tag: [1, 0, 0, 0], pc: (u, v) => [u + k, v] },
    );
  }
  m.lathe([[bz0, 0], [bz0, br]], 10, { tag: [1, 0, 0, 0], cell: 0.02 });
  const zc = (bz0 + bz1) / 2 / M; // the middle of the body, in metres

  // The boom with the three power units, out to one side.
  rod(m, [-0.89, 0, zc], [-3.5, 0, zc], 0.008, [2, 0, 0, 0]);
  for (const x of [-1.9, -2.5, -3.1]) {
    m.place(turned(Y, -Math.PI / 2, x * M, 0, zc * M));
    const r = 0.2 * M;
    const h = 0.28 * M;
    const pts = [[-h, 0], [-h, r]];
    for (let i = 0; i < 4; i++) pts.push([-h + (i + 0.5) * (2 * h / 4) - 0.003, r], [-h + (i + 0.5) * (2 * h / 4) - 0.003, r * 1.25], [-h + (i + 0.5) * (2 * h / 4) + 0.003, r * 1.25], [-h + (i + 0.5) * (2 * h / 4) + 0.003, r]);
    pts.push([h, r], [h, 0]);
    m.lathe(pts, 14, { tag: [3, 0, 0, 0], cell: 0.01 });
  }
  m.place(new Matrix4());

  // The other boom, with the camera platform.
  rod(m, [0.89, 0, zc], [3.2, 0, zc - 0.5], 0.008, [2, 0, 0, 0]);
  m.place(new Matrix4().makeTranslation(3.3 * M, 0, (zc - 0.6) * M));
  m.box(0.5 * M, 0.5 * M, 0.45 * M, { tag: [5, 0, 0, 0], cell: 0.01 });
  for (const y of [-0.12, 0.14]) {
    m.place(new Matrix4().makeTranslation(3.3 * M, y * M, (zc - 0.6 + 0.4) * M));
    m.lathe([[-0.2 * M, 0], [-0.2 * M, 0.1 * M], [0.2 * M, 0.1 * M], [0.2 * M, 0]], 10, { tag: [5, 1, 0, 0], cell: 0.01 });
  }
  m.place(new Matrix4());

  // The long magnetometer boom, the two plasma wave whips and a little low-gain antenna.
  const down = zc - 0.3;
  rod(m, [0.3, 0.3, down], [3.8, 6.6, down - 11.6], 0.011, [2, 1, 0, 0]);
  rod(m, [0.3, 0.3, down], [1.5, 1.3, down - 1.5], 0.016, [2, 0, 0, 0]);
  rod(m, [-0.3, -0.4, down], [-9.6, -3.0, down - 3.2], 0.006, [4, 0, 0, 0]);
  rod(m, [0.2, -0.5, down], [-4.8, -7.2, down - 4.0], 0.006, [4, 0, 0, 0]);
  rod(m, [0.0, 0.5, zc], [0.0, 0.75, zc + 0.3], 0.01, [2, 0, 0, 0]);
  m.place(new Matrix4());
  return m.geometry();
}

const voyagerFragment = /* glsl */ `
  ${hullLib}
  uniform float uAlpha;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vPc;
  varying vec4 vTag;
  float lines(float x) {
    float d = abs(fract(x + 0.5) - 0.5);
    return 1.0 - smoothstep(0.0, 0.07 + fwidth(x), d);
  }
  void main() {
    vec3 N = normalize(vNormal);
    bool front = gl_FrontFacing;
    if (!front) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    float kind = vTag.x;
    vec3 albedo = vec3(0.1);
    float spec = 0.4;
    float gloss = 30.0;
    if (kind < 0.5) {
      // White paint, in panels like a petal pattern; the back is plain and dark.
      albedo = front ? vec3(0.3, 0.31, 0.34) : vec3(0.1, 0.105, 0.11);
      albedo *= 1.0 - 0.28 * max(lines(vPc.x), lines(vPc.y * 0.5));
      if (vTag.y > 1.5) albedo = vec3(0.3);
      spec = 0.25;
    } else if (kind < 1.5) {
      // Crinkled gold foil.
      float c = 0.5 * vnoise(vPc * 13.0) + 0.5 * vnoise(vPc * 31.0 + 7.0);
      N = normalize(N + 0.55 * vec3(c - 0.5, vnoise(vPc * 19.0 + 3.0) - 0.5, vnoise(vPc * 23.0) - 0.5));
      albedo = vec3(0.6, 0.38, 0.09) * (0.5 + 0.8 * c);
      spec = 0.9;
      gloss = 18.0;
    } else if (kind < 2.5) {
      albedo = vec3(0.1, 0.1, 0.11);
      if (vTag.y > 0.5) albedo *= 0.5 + 0.5 * lines(vPc.y * 60.0);
    } else if (kind < 3.5) {
      albedo = vec3(0.07, 0.07, 0.08) + vec3(0.15) * step(0.5, fract(vPc.y * 2.0));
    } else if (kind < 4.5) {
      albedo = vec3(0.2);
    } else {
      albedo = vTag.y > 0.5 ? vec3(0.01) : vec3(0.2, 0.2, 0.21);
      if (vTag.y > 0.5) { spec = 1.0; gloss = 80.0; }
    }
    vec3 col = lightHull(albedo, N, V, spec, gloss, 0.5);
    gl_FragColor = vec4(col, uAlpha);
    ${outputChunks}
  }
`;

function createVoyager(pixelRatio, o) {
  const group = new Group();
  group.visible = false;
  const rig = new Group();
  group.add(rig);
  const shared = {
    uSun: { value: new Vector3(0, 1, 0) },
    uRim: { value: new Vector3(...COLD_RIM) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new ShaderMaterial({
    vertexShader: hullVertex(),
    fragmentShader: voyagerFragment,
    uniforms: { ...shared },
    transparent: true,
    side: DoubleSide,
  });
  const geo = voyagerGeometry();
  const hull = new Mesh(geo, mat);
  hull.frustumCulled = false;
  rig.add(hull);
  // A small steady light on the feed, so it can be found. It is not on the real probe, and it
  // is drawn over the dish too, so it can be found from behind.
  const lamps = new Lamps(1, pixelRatio, shared);
  lamps.mat.depthTest = false;
  lamps.set(0, 0, 0, 0.45 * M, 6, o.light, 0.9);
  lamps.timeIt(0, 1.5, 4);
  lamps.changed();
  rig.add(lamps.points);

  const seconds = 60;
  const state = { t: 0, away: new Vector3() };
  const sun = new Vector3();
  const inverse = new Matrix4();

  return {
    id: o.id,
    name: o.name,
    about: o.about,
    real: true, // not invented: the stage may want to label it differently
    sky: o.sky, // where it really is as seen from the Sun (J2000, degrees), for a stage that wants to put it there
    group,
    angle: 7,
    seconds,
    start(ctx) {
      const rand = ctx.random;
      state.t = 0;
      // Dish towards the Sun, and the probe drifting away from it, a little across your view.
      const { toCam } = viewFrame(group, ctx.camera); // also brings the group's matrix up to date
      sunDirection(ctx, sun).transformDirection(inverse.copy(group.matrixWorld).invert());
      const across = new Vector3().crossVectors(toCam, sun);
      if (across.lengthSq() < 1e-4) across.crossVectors(Y, toCam);
      if (across.lengthSq() < 1e-4) across.crossVectors(X, toCam);
      across.normalize();
      state.away.copy(sun).negate().addScaledVector(across, o.lean).normalize();
      rig.quaternion.setFromUnitVectors(Z, sun);
      rig.quaternion.multiply(new Quaternion().setFromAxisAngle(Z, o.roll + (rand() - 0.5) * 0.3));
      rig.position.copy(state.away).multiplyScalar(-0.5 * o.speed * seconds);
      shared.uAlpha.value = 0;
      group.visible = true;
    },
    update(dt, ctx) {
      state.t += dt;
      if (state.t >= seconds) {
        group.visible = false;
        return false;
      }
      shared.uAlpha.value = envelope(state.t, seconds, 5, 7);
      shared.uTime.value = state.t;
      rig.position.addScaledVector(state.away, o.speed * dt);
      shared.uSun.value.copy(sunDirection(ctx));
      return true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lamps.dispose();
    },
  };
}

export function createVoyager1(pixelRatio) {
  return createVoyager(pixelRatio, {
    id: "voyager1",
    name: "Voyager 1",
    about:
      "This one is real: Voyager 1, launched in 1977 and now the farthest thing people have made, shown as a small model with a marker light added so you can find it.",
    sky: { ra: 258.4, dec: 12.4 }, // towards Ophiuchus
    light: [1.0, 0.86, 0.58],
    speed: 0.012,
    lean: 0.7,
    roll: 0.4,
  });
}

export function createVoyager2(pixelRatio) {
  return createVoyager(pixelRatio, {
    id: "voyager2",
    name: "Voyager 2",
    about:
      "This one is real: Voyager 2, launched in 1977 and the only craft to have flown past Uranus and Neptune, shown as a small model with a marker light added so you can find it.",
    sky: { ra: 298.0, dec: -58.0 }, // far to the south, towards Telescopium and Pavo
    light: [1.0, 0.9, 0.7],
    speed: 0.01,
    lean: -0.55,
    roll: 2.2,
  });
}

export const SIGHTINGS = [createGenerationShip, createShuttleLane, createDerelict, createVoyager1, createVoyager2];
