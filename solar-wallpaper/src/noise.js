// Noise for painting planet surfaces. 3D so textures wrap around a sphere
// without seams or pinched poles.

// Small seeded random number generator (mulberry32).
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const F3 = 1 / 3;
const G3 = 1 / 6;

/** 3D simplex noise (after Stefan Gustavson's public domain version). Returns about -1..1. */
export function simplex(seed = 1) {
  const rand = random(seed);
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  return function noise(x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;

    let n = 0;
    let c = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (c > 0) {
      const g = GRAD[permMod12[ii + perm[jj + perm[kk]]]];
      c *= c;
      n += c * c * (g[0] * x0 + g[1] * y0 + g[2] * z0);
    }
    c = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (c > 0) {
      const g = GRAD[permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]];
      c *= c;
      n += c * c * (g[0] * x1 + g[1] * y1 + g[2] * z1);
    }
    c = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (c > 0) {
      const g = GRAD[permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]];
      c *= c;
      n += c * c * (g[0] * x2 + g[1] * y2 + g[2] * z2);
    }
    c = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (c > 0) {
      const g = GRAD[permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]];
      c *= c;
      n += c * c * (g[0] * x3 + g[1] * y3 + g[2] * z3);
    }
    return 32 * n;
  };
}

/** Layers of noise: big shapes plus finer and finer detail. Returns about -1..1. */
export function fbm(noise, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y, z);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
    z *= lacunarity;
  }
  return sum / norm;
}

// A random number 0..1 for a grid cell, from its coordinates (no memory needed).
function hash(i, j, k, salt) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Craters: returns a function giving how much a point is lowered or raised by
 * craters, using one random crater per grid cell (cellular noise).
 */
export function craters(seed = 1, density = 0.7) {
  const s = seed * 7;
  return function crater(x, y, z) {
    const i0 = Math.floor(x), j0 = Math.floor(y), k0 = Math.floor(z);
    let h = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++)
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          if (hash(i, j, k, s) >= density) continue;
          const r = 0.15 + 0.45 * Math.pow(hash(i, j, k, s + 1), 2.5);
          const dx = x - i - hash(i, j, k, s + 2);
          const dy = y - j - hash(i, j, k, s + 3);
          const dz = z - k - hash(i, j, k, s + 4);
          const d2 = (dx * dx + dy * dy + dz * dz) / (r * r);
          if (d2 >= 1.8225) continue; // outside the rim (1.35 squared)
          const d = Math.sqrt(d2);
          if (d < 1) h -= 0.6 * (1 - d2); // bowl
          else h += 0.35 * (1 - (d - 1) / 0.35) ** 2; // rim
        }
    return h;
  };
}

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;
export function mix3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
