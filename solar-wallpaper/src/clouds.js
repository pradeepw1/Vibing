// The clouds of stars that make up each galaxy: how many, where, what colour.
// Each builder returns { pos, color, size, n } (see cloud()), in the galaxy's
// own frame: its disc lies flat in x/z, +y is the way out of the disc. The
// stars are made up, to match what's known of each galaxy's shape.
import { Vector3 } from "three";
import { random } from "./noise.js";

const DEG = Math.PI / 180;
export const BRIGHTNESS = 0.07; // how much light each star adds
export const GLOW_SCALE = 5; // a spiral's soft glow is drawn with points this much bigger than its stars

export const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

export function cloud(count) {
  // glowFrom: where the soft glow starts, after the stars (drawn its own way).
  return { pos: new Float32Array(count * 3), color: new Float32Array(count * 3), size: new Float32Array(count), n: 0, glowFrom: null };
}
export function put(c, x, y, z, color, size, light) {
  const i = c.n++;
  c.pos.set([x, y, z], i * 3);
  c.color.set([color[0] * light, color[1] * light, color[2] * light], i * 3);
  c.size[i] = size;
}

export const OLD = [1.0, 0.76, 0.48]; // old yellowish stars: bulges, bars, the space between arms
export const YOUNG = [0.5, 0.64, 1.0]; // young blue-white stars along the arms
export const GLOWING = [1.0, 0.3, 0.5]; // pink clouds of glowing gas where stars are being born
export const WARM = [1.0, 0.88, 0.72];

/** A spiral: bulge, maybe a bar, an exponential disc and log-spiral arms that trail the spin. */
export function spiral(s, seed) {
  const rand = random(seed);
  const P = { old: OLD, young: YOUNG, glowing: GLOWING, warm: WARM, ...s.palette }; // each galaxy can have its own colours
  const extra = (s.plume?.count ?? 0) + (s.companion ? s.companion.stars + 600 : 0);
  const c = cloud(Math.ceil(s.stars * 1.2) + extra);
  // A dust lane: where it is, stars are left out (a dark band when seen edge-on).
  const lane = s.lane;
  const dusty = (x, y, z) => lane && Math.abs(y) < lane.half && Math.hypot(x, z) > lane.r0 && Math.hypot(x, z) < lane.r1 && rand() < lane.cut;
  const k = Math.tan(s.pitch * DEG);
  const dot = (s.radius * 2.2) / Math.sqrt(s.stars); // star size, so the disc looks filled in from afar
  const light = s.light * BRIGHTNESS; // the same per star whatever the count: stars are drawn bigger when there are fewer
  const totalWeight = s.arms.reduce((sum, a) => sum + a.weight, 0);
  for (let i = 0; i < s.stars; i++) {
    const u = rand();
    if (u < s.bulgeShare) {
      const r = s.bulge * Math.abs(gauss(rand)) * 0.7;
      const th = rand() * 2 * Math.PI;
      const ph = Math.acos(2 * rand() - 1);
      const bx = r * Math.sin(ph) * Math.cos(th);
      const by = r * Math.cos(ph) * (s.bulgeFlat ?? 0.6);
      const bz = r * Math.sin(ph) * Math.sin(th);
      if (!dusty(bx, by, bz)) put(c, bx, by, bz, P.old, dot * 0.8, light * 1.3);
      continue;
    }
    if (s.bar && u < s.bulgeShare + (s.barShare ?? 0.08)) {
      const along = gauss(rand) * s.bar.half * 0.5;
      const across = gauss(rand) * s.bar.half * 0.13;
      const ca = Math.cos(s.bar.angle);
      const sa = Math.sin(s.bar.angle);
      put(c, along * ca - across * sa, gauss(rand) * 0.4, along * sa + across * ca, P.old, dot, light * 1.1);
      continue;
    }
    // The disc: more stars near the middle, thinning outwards.
    let r = -s.scale * Math.log(rand() * 0.98 + 0.02);
    if (r > s.radius * 1.1) r = rand() * s.radius;
    let th;
    let color = P.old;
    let size = dot;
    let shine = light * 0.6;
    if (s.ring && rand() < 0.12) {
      // Andromeda's ring of star birth, about 33,000 light-years out.
      r = s.ring + gauss(rand) * 2;
      th = rand() * 2 * Math.PI;
      color = rand() < 0.15 ? P.glowing : P.young;
      shine = light;
    } else if (rand() < (s.armShare ?? 0.5)) {
      // On an arm. Each one is a log spiral: radius grows by the same factor
      // every turn, winding backwards against the spin.
      let pick = rand() * totalWeight;
      const arm = s.arms.find((a) => (pick -= a.weight) <= 0) ?? s.arms[0];
      th = (arm.phase ?? 0) - ((s.winding ?? 1) * Math.log(Math.max(r, 2) / arm.r0)) / k + gauss(rand) * (0.16 + 1.5 / Math.max(r, 3));
      const young = rand();
      color = young < 0.05 ? P.glowing : young < 0.7 ? P.young : P.warm;
      size = dot * (young < 0.05 ? 1.6 : 1);
      shine = light * (young < 0.05 ? 1.4 : 1);
    } else {
      th = rand() * 2 * Math.PI;
    }
    if (s.spur && rand() < 0.004) {
      // A short spur of stars through the Sun's spot.
      r = s.spur.r + gauss(rand) * 1.5;
      th = (rand() - 0.5) * (s.spur.length / s.spur.r) - Math.log(r / s.spur.r) / k;
      color = P.young;
    }
    const height = gauss(rand) * (0.03 + 0.02 * (r / s.radius)) * s.scale * 0.35;
    if (s.spot?.x !== undefined && rand() < 0.004) {
      // A big glowing cloud (NGC 604 in Triangulum), about 1,500 light-years across.
      put(c, s.spot.x + gauss(rand) * 0.35, height * 0.3, s.spot.z + gauss(rand) * 0.35, P.glowing, size, shine);
      continue;
    }
    const px = r * Math.cos(th);
    const pz = r * Math.sin(th);
    if (!dusty(px, height, pz)) put(c, px, height, pz, color, size, shine);
  }
  if (s.plume) {
    // A starburst blows hot gas out above and below the disc: red-pink filaments in two cones.
    const { count, length, width } = s.plume;
    for (let i = 0; i < count; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      const t = Math.pow(rand(), 0.85);
      const w = width * (0.25 + 1.0 * t);
      const a = rand() * 2 * Math.PI;
      const fil = 0.55 + 0.45 * rand(); // a thin shell, with filaments
      const rad = w * fil + gauss(rand) * w * 0.06;
      const warm = rand();
      put(c, rad * Math.cos(a), side * (0.05 + t) * length, rad * Math.sin(a), warm < 0.7 ? [1.0, 0.3, 0.34] : [1.0, 0.55, 0.5], dot * 1.5, light * (1.1 - 0.7 * t));
    }
  }
  if (s.companion) {
    // A small galaxy passing close, and a thin bridge of stars between.
    const { x, z, radius, stars, color } = s.companion;
    for (let i = 0; i < stars; i++) {
      const r = radius * Math.pow(rand(), 0.8);
      const a = rand() * 2 * Math.PI;
      const e = Math.acos(2 * rand() - 1);
      put(c, x + r * Math.sin(e) * Math.cos(a), r * Math.cos(e) * 0.7, z + r * Math.sin(e) * Math.sin(a), color, dot * 0.8, light * 1.2);
    }
    for (let i = 0; i < 500; i++) {
      const t = rand();
      put(c, x * (1 - t) * 0.9 + gauss(rand) * 1.2, gauss(rand) * 0.5, z * (1 - t) * 0.9 + gauss(rand) * 1.2, P.young, dot, light * 0.6);
    }
  }
  // A soft glow under it all: the light of stars too faint and many to show one by one.
  c.glowFrom = c.n;
  const glow = c.pos.length / 3 - c.n;
  for (let i = 0; i < glow; i++) {
    const bulge = rand() < 0.3;
    const r = bulge ? s.bulge * Math.abs(gauss(rand)) * 0.8 : -s.scale * Math.log(rand() * 0.97 + 0.03);
    const th = rand() * 2 * Math.PI;
    put(c, r * Math.cos(th), gauss(rand) * (bulge ? r * 0.5 : s.scale * 0.03), r * Math.sin(th), bulge ? P.old : P.warm, dot * GLOW_SCALE, light * 0.1);
  }
  return c;
}

/** The Large Magellanic Cloud: a thick, lumpy disc with an off-centre bar and the Tarantula Nebula. */
export function barredCloud(s, seed) {
  const rand = random(seed);
  const c = cloud(s.stars);
  const dot = (s.radius * 2.4) / Math.sqrt(s.stars);
  const light = s.light * BRIGHTNESS;
  const lumps = Array.from({ length: 14 }, () => {
    const r = Math.sqrt(rand()) * s.radius * 0.8;
    const th = rand() * 2 * Math.PI;
    return [r * Math.cos(th), r * Math.sin(th), 1 + rand() * 2.5];
  });
  for (let i = 0; i < s.stars; i++) {
    const u = rand();
    if (u < 0.22) {
      const along = gauss(rand) * s.bar.half * 0.55 + 1.0; // a little off-centre
      const across = gauss(rand) * s.bar.half * 0.18;
      const ca = Math.cos(s.bar.angle ?? 0);
      const sa = Math.sin(s.bar.angle ?? 0);
      put(c, along * ca - across * sa, gauss(rand) * 0.5, along * sa + across * ca, OLD, dot, light * 1.2);
    } else if (u < 0.55) {
      const [lx, lz, lr] = lumps[Math.floor(rand() * lumps.length)];
      put(c, lx + gauss(rand) * lr, gauss(rand) * 0.6, lz + gauss(rand) * lr, rand() < 0.08 ? GLOWING : YOUNG, dot, light);
    } else if (u < 0.565) {
      // The Tarantula Nebula, about 1,000 light-years across.
      put(c, s.spot.x + gauss(rand) * 0.3, gauss(rand) * 0.2, s.spot.z + gauss(rand) * 0.3, GLOWING, dot * 1.3, light * 1.2);
    } else {
      const r = -s.radius * 0.28 * Math.log(rand() * 0.97 + 0.03);
      const th = rand() * 2 * Math.PI;
      put(c, r * Math.cos(th), gauss(rand) * s.radius * s.thick * 0.3, r * Math.sin(th), rand() < 0.5 ? WARM : YOUNG, dot, light * 0.7);
    }
  }
  return c;
}

/** A dwarf: a smooth (or lumpy) ellipsoid of stars. axes: half-lengths along x, y, z. */
export function blob(s, seed) {
  const rand = random(seed);
  const c = cloud(s.stars);
  const [ax, ay, az] = s.axes;
  const dot = (Math.max(ax, ay, az) * 1.4) / Math.sqrt(s.stars);
  const light = s.light * BRIGHTNESS;
  for (let i = 0; i < s.stars; i++) {
    const k = s.core && rand() < 0.4 ? 0.3 : 1;
    put(c, gauss(rand) * ax * 0.5 * k, gauss(rand) * ay * 0.5 * k, gauss(rand) * az * 0.5 * k, rand() < 0.15 ? YOUNG : WARM, dot, light);
  }
  return c;
}

/**
 * The stars crowded round a black hole (made up), so the bending of light has
 * something to bend. Positions are in rs, then scaled to the scene's units.
 * If it has a companion star, that and the gas it pours off are here too.
 */
export function holeCrowd(h, seed) {
  const rand = random(seed);
  const { crowd, rs } = h;
  const extra = h.companion ? 700 : 0;
  const c = cloud(crowd.stars + extra);
  for (let i = 0; i < crowd.stars; i++) {
    // More towards the middle, none right at the disc.
    const r = 34 + crowd.radius * Math.pow(rand(), 1.7);
    const th = rand() * 2 * Math.PI;
    const ph = Math.acos(2 * rand() - 1);
    const pick = rand();
    const colour = crowd.colours[pick < crowd.mix[0] ? 0 : pick < crowd.mix[0] + crowd.mix[1] ? 1 : 2];
    const big = rand() < 0.04;
    put(c, r * Math.sin(ph) * Math.cos(th) * rs, r * Math.cos(ph) * rs, r * Math.sin(ph) * Math.sin(th) * rs, colour, rs * (big ? 0.3 : 0.05 + 0.08 * rand()), big ? 1.4 : 0.55 + 0.6 * rand());
  }
  if (h.companion) {
    const { distance, radius, colour, light } = h.companion;
    // A blue giant in the plane of the disc, and a thin spiral of gas from it down to the disc's edge.
    const across = new Vector3(1, 0, 0);
    if (Math.abs(h.normal.x) > 0.9) across.set(0, 0, 1);
    across.addScaledVector(h.normal, -across.dot(h.normal)).normalize();
    const third = new Vector3().crossVectors(h.normal, across);
    const at = (r, a, lift = 0) => [(across.x * Math.cos(a) + third.x * Math.sin(a)) * r + h.normal.x * lift, (across.y * Math.cos(a) + third.y * Math.sin(a)) * r + h.normal.y * lift, (across.z * Math.cos(a) + third.z * Math.sin(a)) * r + h.normal.z * lift];
    const star = at(distance, 0);
    put(c, star[0] * rs, star[1] * rs, star[2] * rs, colour, radius * rs, light);
    put(c, star[0] * rs, star[1] * rs, star[2] * rs, colour, radius * rs * 2.6, light * 0.06);
    for (let i = 0; i < extra - 2; i++) {
      const t = rand();
      const r = distance - (distance - h.disc.outer * 1.05) * Math.pow(t, 0.8);
      const a = 2.6 * Math.pow(t, 0.8) + gauss(rand) * 0.03;
      const p = at(r + gauss(rand) * 0.4, a, gauss(rand) * 0.25);
      put(c, p[0] * rs, p[1] * rs, p[2] * rs, [0.6, 0.72, 1.0], rs * (0.12 + 0.12 * rand()), 0.5 + 0.5 * (1 - t));
    }
  }
  return c;
}

/** Colour of a hot-blue knot of new stars, or a pink cloud of glowing gas, picked at random. */
function knot(rand, pink = 0.2) {
  return rand() < pink ? GLOWING : rand() < 0.75 ? YOUNG : [0.6, 0.75, 1.0];
}

/**
 * A big smooth galaxy of old stars: golden-white, round or squashed. Optionally:
 *   lane   a dust lane across the middle (stars left out there, with new stars
 *          and pink gas along its edges), as in Centaurus A
 *   jet    a thin blue jet of fast gas from the middle, along a direction
 *          given in the galaxy's own frame, as in M87
 *   clusters  how many bright ball-shaped star clusters are scattered round it
 */
export function elliptical(s, seed) {
  const rand = random(seed);
  const [ax, ay, az] = s.axes;
  const lane = s.lane;
  const knots = lane ? 1800 : 0;
  const jetStars = s.jet ? 1400 : 0;
  const clusters = s.clusters ?? 0;
  const glow = Math.ceil(s.stars * 0.6);
  const c = cloud(s.stars + knots + jetStars + clusters + glow);
  // Bigger, fainter stars than the others use, so the glow comes out smooth.
  const dot = (Math.max(ax, ay, az) * 4.4) / Math.sqrt(s.stars);
  const light = s.light * BRIGHTNESS * 0.35;
  const tones = s.tones ?? [OLD, WARM, [1.0, 0.92, 0.82]];
  for (let i = 0; i < s.stars; i++) {
    // Packed tightly in the middle, thinning out a long way (the shape of a real one).
    const r = Math.pow(rand(), 3.0);
    const th = rand() * 2 * Math.PI;
    const ph = Math.acos(2 * rand() - 1);
    const x = ax * r * Math.sin(ph) * Math.cos(th);
    const y = ay * r * Math.cos(ph);
    const z = az * r * Math.sin(ph) * Math.sin(th);
    if (lane && Math.abs(y) < lane.half && Math.hypot(x, z) < lane.r1 && rand() < lane.cut) continue;
    put(c, x, y, z, tones[Math.floor(rand() * tones.length)], dot, light * (0.7 + 0.8 * (1 - r)));
  }
  for (let i = 0; i < clusters; i++) {
    // Bright ball-shaped clusters of old stars scattered all round.
    const r = 0.15 + 1.1 * Math.pow(rand(), 0.8);
    const th = rand() * 2 * Math.PI;
    const ph = Math.acos(2 * rand() - 1);
    put(c, ax * r * Math.sin(ph) * Math.cos(th), ay * r * Math.cos(ph), az * r * Math.sin(ph) * Math.sin(th), [1.0, 0.9, 0.75], dot * 0.6, light * 2.2);
  }
  for (let i = 0; i < knots; i++) {
    // New stars and glowing gas strung along both edges of the lane, warped a little.
    const th = rand() * 2 * Math.PI;
    const r = lane.r1 * (0.25 + 0.75 * Math.sqrt(rand()));
    const edge = rand() < 0.5 ? -1 : 1;
    const warp = 0.35 * lane.half * Math.sin(th * 2 + r * 0.1);
    put(c, r * Math.cos(th), edge * lane.half * (0.8 + 0.6 * rand()) + warp, r * Math.sin(th), knot(rand, 0.35), dot * (rand() < 0.1 ? 1.6 : 0.9), light * 1.5);
  }
  if (s.jet) {
    // A thin jet one way, a fainter one the other, with brighter knots.
    const { dir, length } = s.jet;
    for (let i = 0; i < jetStars; i++) {
      const side = i % 5 === 0 ? -1 : 1;
      const t = Math.pow(rand(), 0.9);
      const scatter = 0.035 * length * (0.4 + t);
      const bead = rand() < 0.06 ? 3 : 1;
      // Small and bright, whatever size the galaxy's own stars are drawn: it's a thin line.
      put(c, dir.x * side * t * length + gauss(rand) * scatter, dir.y * side * t * length + gauss(rand) * scatter, dir.z * side * t * length + gauss(rand) * scatter, [0.5, 0.7, 1.0], length * 0.01 * bead, (side > 0 ? 3.2 : 1.1) * BRIGHTNESS * (1 - 0.5 * t) * bead);
    }
  }
  // The glow of all the stars too faint to show one by one (last: it's drawn its own way).
  c.glowFrom = c.n;
  for (let i = 0; i < glow; i++) {
    const r = Math.pow(rand(), 1.6);
    const th = rand() * 2 * Math.PI;
    const ph = Math.acos(2 * rand() - 1);
    const x = ax * r * Math.sin(ph) * Math.cos(th);
    const y = ay * r * Math.cos(ph);
    const z = az * r * Math.sin(ph) * Math.sin(th);
    if (lane && Math.abs(y) < lane.half * 1.2 && Math.hypot(x, z) < lane.r1 && rand() < lane.cut) continue;
    put(c, x, y, z, WARM, dot * GLOW_SCALE, light * 0.16);
  }
  return c;
}

/**
 * A ring galaxy (the Cartwheel): a big blue ring of new stars and pink gas
 * thrown outwards when a small galaxy ran through its middle, an inner ring,
 * spokes between them, and a yellow centre.
 */
export function ring(s, seed) {
  const rand = random(seed);
  const R = s.radius;
  const c = cloud(s.stars);
  const dot = (R * 2.4) / Math.sqrt(s.stars);
  const light = s.light * BRIGHTNESS;
  for (let i = 0; i < s.stars; i++) {
    const u = rand();
    const th = rand() * 2 * Math.PI;
    if (u < 0.46) {
      // The outer ring: clumpy, thickest where new stars are born.
      const clump = 0.55 + 0.9 * Math.abs(Math.sin(th * 7 + rand() * 0.6));
      const r = R * (1 + gauss(rand) * 0.045);
      put(c, r * Math.cos(th), gauss(rand) * R * 0.012, r * Math.sin(th), knot(rand, 0.3), dot * (rand() < 0.07 ? 1.8 : 1), light * clump * 1.2);
    } else if (u < 0.6) {
      // The inner ring, paler and yellower.
      const r = R * 0.33 * (1 + gauss(rand) * 0.06);
      put(c, r * Math.cos(th), gauss(rand) * R * 0.01, r * Math.sin(th), rand() < 0.5 ? WARM : [1.0, 0.8, 0.55], dot, light * 1.1);
    } else if (u < 0.78) {
      // Spokes: eight bent strands from the inner ring out to the outer one.
      const spoke = Math.floor(rand() * 8);
      const t = rand();
      const a = (spoke / 8) * 2 * Math.PI + t * 0.5 + gauss(rand) * 0.02;
      const r = R * (0.33 + 0.67 * t);
      put(c, r * Math.cos(a), gauss(rand) * R * 0.01, r * Math.sin(a), rand() < 0.7 ? WARM : YOUNG, dot, light * 0.65);
    } else if (u < 0.9) {
      // The yellow centre.
      const r = R * 0.1 * Math.abs(gauss(rand));
      const a = rand() * 2 * Math.PI;
      const e = Math.acos(2 * rand() - 1);
      put(c, r * Math.sin(e) * Math.cos(a), r * Math.cos(e) * 0.6, r * Math.sin(e) * Math.sin(a), [1.0, 0.82, 0.55], dot, light * 1.7);
    } else {
      // A faint disc filling the space, out past the ring.
      const r = R * 1.25 * Math.sqrt(rand());
      put(c, r * Math.cos(th), gauss(rand) * R * 0.015, r * Math.sin(th), [0.7, 0.78, 1.0], dot * 1.2, light * 0.3);
    }
  }
  return c;
}

/**
 * Two galaxies in the middle of colliding (the Antennae): two golden cores
 * with a knot of pink new-star clouds between them, and two long curved tails
 * of stars flung out.
 */
export function colliding(s, seed) {
  const rand = random(seed);
  const R = s.radius; // how far the tails reach
  const c = cloud(s.stars);
  const dot = (R * 2.3) / Math.sqrt(s.stars);
  const light = s.light * BRIGHTNESS;
  const gap = R * 0.1; // each core is this far from the middle
  const cores = [
    { x: -gap, z: gap * 0.3, spin: 1 },
    { x: gap, z: -gap * 0.3, spin: -1 },
  ];
  for (let i = 0; i < s.stars; i++) {
    const u = rand();
    if (u < 0.4) {
      // The two cores: small discs of golden stars with blue edges.
      const core = cores[i % 2];
      const r = R * 0.1 * Math.pow(rand(), 0.7);
      const th = rand() * 2 * Math.PI;
      put(c, core.x + r * Math.cos(th), gauss(rand) * R * 0.012, core.z + r * Math.sin(th), r < R * 0.04 ? OLD : knot(rand, 0.18), dot, light * (r < R * 0.04 ? 1.4 : 0.9));
    } else if (u < 0.55) {
      // Where they overlap: a crowd of new stars and pink gas.
      const a = rand() * 2 * Math.PI;
      const r = R * 0.08 * Math.sqrt(rand());
      put(c, r * Math.cos(a), gauss(rand) * R * 0.015, r * Math.sin(a) * 0.8, knot(rand, 0.45), dot * (rand() < 0.1 ? 1.8 : 1), light * 1.3);
    } else {
      // The tails, one from each core: a long curve that thins out.
      const core = cores[i % 2];
      const t = Math.pow(rand(), 0.8);
      const a = (core.spin > 0 ? 0.4 : Math.PI + 0.4) + core.spin * 2.1 * t;
      const reach = R * (0.1 + 0.9 * t);
      const sc = R * 0.045 * (0.3 + t);
      put(c, core.x + reach * Math.cos(a) + gauss(rand) * sc, (core.spin > 0 ? 1 : -1) * R * 0.18 * t * t + gauss(rand) * sc * 0.5, core.z + reach * Math.sin(a) + gauss(rand) * sc, rand() < 0.05 ? GLOWING : rand() < 0.8 ? [0.4, 0.6, 1.0] : [0.75, 0.85, 1.0], dot * (rand() < 0.05 ? 1.7 : 1), light * (1 - 0.65 * t));
    }
  }
  return c;
}
