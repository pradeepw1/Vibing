// Out among the galaxies: the Milky Way and its nearest neighbours as 3D
// clouds of stars, each at its real distance and direction from the Sun.
//
// Units here are thousands of light-years, with the Sun at the origin and the
// same axes as the solar system scene (so a galaxy sits in the same direction
// as its patch on the solar system's sky). The shapes are made up to match
// what's known: how big each one is, how it's tilted towards us, its bar and
// spiral arms. The stars themselves are invented.
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  LinearMipmapLinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  Ray,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BLACK_HOLES } from "./blackholes.js";
import { GALAXIES, skyDirection } from "./galaxies.js";
import { random } from "./noise.js";
import { galacticBasis } from "./sky.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;
// Distance from the Sun. M32 sits about 10,000 light-years in front of Andromeda, M110 about 40,000 behind.
export const KLY = { lmc: 161.7, smc: 203.7, sgr: 86, m31: 2495, m33: 2740, m32: 2485, m110: 2534 };
const SUN_FROM_CENTRE = 26.7; // kly from the Milky Way's centre
const BRIGHTNESS = 0.07; // how much light each star adds
const EXPOSURE = 2.5; // the whole picture, before the brightest parts are rolled off
const STAR_SIZE = 10; // the most a star is drawn across, in CSS pixels
const GLOW_SIZE = 6; // the glow fades out past this: it's only there to fill in a galaxy seen from far off
const GLOW_LIGHT = 0.7; // a spiral's glow gives off this much light for each bit from its stars
const GLOW_SCALE = 5; // and its points are this much bigger
const ROLL_SPEED = Math.PI / 3; // how fast a flight turns the picture round, unless it must go faster to finish in time (60 degrees a second)
const CLEAR = 1.2; // how far to keep from a galaxy on the way past, in its radii
const HOLE_VIEW = 32; // how far from a black hole you arrive, in its radii
const HOLE_ON = 6000; // the bending of light starts to show this far out (in radii)...
const HOLE_FULL = 1500; // ...and is all there from here
const HOLE_GLOW = 0.55; // how much the blurred picture glows round a black hole's bright disc
const HOLE_WIDE = 1.4; // near one, the stars are drawn this much wider than the screen, so bent light has something to pick up from past the edge
// Going outwards, Andromeda's arms turn clockwise on our sky, Triangulum's anticlockwise.
const WIND = { m31: -1, m33: 1 };

/**
 * The shape of each galaxy, in its own frame: the disc lies flat in x/z, +y
 * is the side facing up out of the disc. Sizes are radii in kly.
 *   tilt: how the disc is turned to us. inclination 0 = face-on; nodes: the
 *   position angle on the sky of the line the disc is tilted about; near:
 *   the position angle of the side nearest to us.
 *   winding: which way the arms turn going outwards (+1 or -1), to match the sky.
 *   spot: a big pink star-forming cloud, at its real place on the sky.
 */
export const SHAPES = {
  // Andromeda: big, with a bright bulge, tightly wound arms and its ring of star birth.
  m31: { kind: "spiral", stars: 110000, radius: 70, scale: 17, bulge: 8, bulgeShare: 0.2, pitch: 10, armShare: 0.35, arms: [{ r0: 38, weight: 1 }, { r0: 38, weight: 1, phase: Math.PI }, { r0: 25, weight: 0.5 }, { r0: 25, weight: 0.5, phase: Math.PI }], ring: 32.6, light: 1.0, tilt: { inclination: 77, nodes: 38, near: 308 }, winding: WIND.m31 },
  // Triangulum: small, loose, patchy arms, and NGC 604, a huge glowing cloud.
  m33: { kind: "spiral", stars: 50000, radius: 28.5, scale: 6, bulge: 1.2, bulgeShare: 0.04, pitch: 25, armShare: 0.45, arms: [{ r0: 9, weight: 1 }, { r0: 9, weight: 1, phase: Math.PI }, { r0: 14, weight: 0.4, phase: 1.3 }], light: 0.6, tilt: { inclination: 54, nodes: 22, near: 292 }, winding: WIND.m33, spot: { ra: 23.637, dec: 30.7844 } },
  // The Large Magellanic Cloud: a lumpy disc, a bar off-centre (seen at position angle 120), and the Tarantula Nebula.
  lmc: { kind: "cloud", stars: 30000, radius: 15, thick: 0.12, bar: { half: 5, pa: 120 }, light: 0.6, tilt: { inclination: 26, nodes: 150, near: 60 }, spot: { ra: 84.677, dec: -69.101 } },
  // Dwarfs: half-lengths across, up, and along their long axis, which points
  // along our line of sight (the deep Small Magellanic Cloud), to galactic
  // north (the Sagittarius Dwarf, stretched out along its orbit), or along
  // the long axis we see on the sky. side: which way round to look at it
  // from (see viewpointFor).
  // A cigar 44,000 light-years long, pointing within 20 degrees of us, its near end towards the north-east.
  smc: { kind: "blob", stars: 30000, axes: [5.5, 5.5, 22], light: 0.6, long: "smc", side: 45 },
  // Stretched along its orbit, nearly at right angles to the Milky Way.
  sgr: { kind: "blob", stars: 8000, axes: [5.5, 4, 16.5], light: 0.3, long: "sgr", side: -30 },
  m32: { kind: "blob", stars: 3000, axes: [2.3, 2.3, 3.1], light: 0.18, core: true },
  m110: { kind: "blob", stars: 5000, axes: [4, 4, 8], light: 0.15 },
};

const MILKY_WAY = {
  kind: "spiral", stars: 120000, radius: 52, scale: 9, bulge: 5, bulgeShare: 0.12, pitch: 13, armShare: 0.45, light: 1.0,
  bar: { half: 16, angle: 27 * DEG },
  // Where each arm crosses the line from the centre through the Sun (kly from the centre).
  arms: [
    { name: "Perseus", r0: 33, weight: 1 },
    { name: "Scutum-Centaurus", r0: 17.8, weight: 1 },
    { name: "Sagittarius-Carina", r0: 22.5, weight: 0.55 },
    { name: "Norma-Outer", r0: 14.5, weight: 0.55 },
  ],
  spur: { r: 27.9, length: 12 }, // the Local (Orion) spur: the Sun sits on its inner edge
};

// --- Making the clouds of stars ---

const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

function cloud(count) {
  // glowFrom: where the soft glow starts, after the stars (drawn its own way).
  return { pos: new Float32Array(count * 3), color: new Float32Array(count * 3), size: new Float32Array(count), n: 0, glowFrom: null };
}
function put(c, x, y, z, color, size, light) {
  const i = c.n++;
  c.pos.set([x, y, z], i * 3);
  c.color.set([color[0] * light, color[1] * light, color[2] * light], i * 3);
  c.size[i] = size;
}

const OLD = [1.0, 0.76, 0.48]; // old yellowish stars: bulges, bars, the space between arms
const YOUNG = [0.5, 0.64, 1.0]; // young blue-white stars along the arms
const GLOWING = [1.0, 0.3, 0.5]; // pink clouds of glowing gas where stars are being born
const WARM = [1.0, 0.88, 0.72];

/** A spiral: bulge, maybe a bar, an exponential disc and log-spiral arms that trail the spin. */
function spiral(s, seed) {
  const rand = random(seed);
  const c = cloud(Math.ceil(s.stars * 1.2));
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
      put(c, r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th), OLD, dot * 0.8, light * 1.3);
      continue;
    }
    if (s.bar && u < s.bulgeShare + 0.08) {
      const along = gauss(rand) * s.bar.half * 0.5;
      const across = gauss(rand) * s.bar.half * 0.13;
      const ca = Math.cos(s.bar.angle);
      const sa = Math.sin(s.bar.angle);
      put(c, along * ca - across * sa, gauss(rand) * 0.4, along * sa + across * ca, OLD, dot, light * 1.1);
      continue;
    }
    // The disc: more stars near the middle, thinning outwards.
    let r = -s.scale * Math.log(rand() * 0.98 + 0.02);
    if (r > s.radius * 1.1) r = rand() * s.radius;
    let th;
    let color = OLD;
    let size = dot;
    let shine = light * 0.6;
    if (s.ring && rand() < 0.12) {
      // Andromeda's ring of star birth, about 33,000 light-years out.
      r = s.ring + gauss(rand) * 2;
      th = rand() * 2 * Math.PI;
      color = rand() < 0.15 ? GLOWING : YOUNG;
      shine = light;
    } else if (rand() < (s.armShare ?? 0.5)) {
      // On an arm. Each one is a log spiral: radius grows by the same factor
      // every turn, winding backwards against the spin.
      let pick = rand() * totalWeight;
      const arm = s.arms.find((a) => (pick -= a.weight) <= 0) ?? s.arms[0];
      th = (arm.phase ?? 0) - ((s.winding ?? 1) * Math.log(Math.max(r, 2) / arm.r0)) / k + gauss(rand) * (0.16 + 1.5 / Math.max(r, 3));
      const young = rand();
      color = young < 0.05 ? GLOWING : young < 0.7 ? YOUNG : WARM;
      size = dot * (young < 0.05 ? 1.6 : 1);
      shine = light * (young < 0.05 ? 1.4 : 1);
    } else {
      th = rand() * 2 * Math.PI;
    }
    if (s.spur && rand() < 0.004) {
      // A short spur of stars through the Sun's spot.
      r = s.spur.r + gauss(rand) * 1.5;
      th = (rand() - 0.5) * (s.spur.length / s.spur.r) - Math.log(r / s.spur.r) / k;
      color = YOUNG;
    }
    const height = gauss(rand) * (0.03 + 0.02 * (r / s.radius)) * s.scale * 0.35;
    if (s.spot?.x !== undefined && rand() < 0.004) {
      // A big glowing cloud (NGC 604 in Triangulum), about 1,500 light-years across.
      put(c, s.spot.x + gauss(rand) * 0.35, height * 0.3, s.spot.z + gauss(rand) * 0.35, GLOWING, size, shine);
      continue;
    }
    put(c, r * Math.cos(th), height, r * Math.sin(th), color, size, shine);
  }
  // A soft glow under it all: the light of stars too faint and many to show one by one.
  c.glowFrom = c.n;
  const glow = c.pos.length / 3 - c.n;
  for (let i = 0; i < glow; i++) {
    const bulge = rand() < 0.3;
    const r = bulge ? s.bulge * Math.abs(gauss(rand)) * 0.8 : -s.scale * Math.log(rand() * 0.97 + 0.03);
    const th = rand() * 2 * Math.PI;
    put(c, r * Math.cos(th), gauss(rand) * (bulge ? r * 0.5 : s.scale * 0.03), r * Math.sin(th), bulge ? OLD : WARM, dot * GLOW_SCALE, light * 0.1);
  }
  return c;
}

/** The Large Magellanic Cloud: a thick, lumpy disc with an off-centre bar and the Tarantula Nebula. */
function barredCloud(s, seed) {
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
function blob(s, seed) {
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
function holeCrowd(h, seed) {
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

/** materials: [stars, stars of a spiral, its glow]. */
function pointsOf(c, [material, spiralMaterial, glowMaterial]) {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(c.pos.subarray(0, c.n * 3), 3));
  geo.setAttribute("tint", new Float32BufferAttribute(c.color.subarray(0, c.n * 3), 3));
  geo.setAttribute("size", new Float32BufferAttribute(c.size.subarray(0, c.n), 1));
  let use = material;
  if (c.glowFrom !== null) {
    geo.addGroup(0, c.glowFrom, 0);
    geo.addGroup(c.glowFrom, c.n - c.glowFrom, 1);
    use = [spiralMaterial, glowMaterial];
  }
  const p = new Points(geo, use);
  p.frustumCulled = false;
  return p;
}

// --- Where and which way round ---

/** North and east on our sky at a direction, as scene vectors. */
export function skyAxes(dir) {
  const pole = skyDirection(0, 90);
  const north = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const east = new Vector3().crossVectors(north, dir); // looking out along dir, east is to the left of north
  return { north, east };
}

/**
 * The galaxy's frame: x and z in its disc, y out of it. The disc is tilted
 * `inclination` from face-on about the line across it that we see as its
 * long axis (position angle pa), with the side at position angle `near`
 * towards us.
 */
export function tiltFrame(dir, pa, tilt) {
  const { north, east } = skyAxes(dir);
  const along = (a) => north.clone().multiplyScalar(Math.cos(a * DEG)).addScaledVector(east, Math.sin(a * DEG));
  const long = along(pa);
  const short = along(pa + 90);
  const i = (tilt?.inclination ?? 0) * DEG;
  // Two ways to tilt the disc; pick the one that brings the near side towards us.
  let normal = dir.clone().multiplyScalar(-Math.cos(i)).addScaledVector(short, Math.sin(i));
  const inDisc = new Vector3().crossVectors(normal, long).normalize(); // across the disc, along the short axis
  const nearSide = along(tilt?.near ?? pa + 90);
  if (Math.sign(inDisc.dot(nearSide)) === Math.sign(inDisc.dot(dir))) normal = dir.clone().multiplyScalar(-Math.cos(i)).addScaledVector(short, -Math.sin(i));
  normal.normalize();
  const z = new Vector3().crossVectors(long, normal).normalize();
  return new Matrix4().makeBasis(long, normal, z);
}

/** Where a line of sight from the Sun meets a galaxy's disc, in the galaxy's own frame (x, z). */
function inDisc(place, sight) {
  const axes = new Matrix4().extractRotation(place.frame);
  const x = new Vector3().setFromMatrixColumn(axes, 0);
  const n = new Vector3().setFromMatrixColumn(axes, 1);
  const z = new Vector3().setFromMatrixColumn(axes, 2);
  const at = sight.clone().multiplyScalar(place.position.dot(n) / sight.dot(n)).sub(place.position);
  return { x: at.dot(x), z: at.dot(z) };
}

export function createLocalGroup(canvas, pixelRatio) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.0005, 1e6);
  const basis = galacticBasis();
  camera.up.copy(basis.north); // the controls turn round whatever is up when they're made
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.9;
  controls.enablePan = false;
  controls.autoRotateSpeed = 0.25;
  controls.enabled = false;
  controls.maxDistance = 9000;

  const materials = starMaterials(pixelRatio);

  // Every place you can go: the galaxies, and home.
  const centre = basis.center.clone().multiplyScalar(SUN_FROM_CENTRE);
  const places = new Map();
  places.set("milkyway", { id: "milkyway", name: "Milky Way", sub: "Home", position: centre, radius: MILKY_WAY.radius, up: basis.north });
  places.set("sun", { id: "sun", name: "Sun", sub: "You are here", position: new Vector3(), radius: 0.5, unpickable: true });
  for (const g of GALAXIES) {
    const dir = skyDirection(g.ra, g.dec);
    const s = SHAPES[g.id];
    const radius = s.radius ?? Math.max(...s.axes);
    places.set(g.id, {
      id: g.id,
      name: g.name,
      sub: g.lightYears,
      position: dir.clone().multiplyScalar(KLY[g.id]),
      dir,
      radius,
      frame: tiltFrame(dir, s.tilt?.nodes ?? g.pa, s.tilt),
      small: !g.name, // Andromeda's companions: no name, can't be visited
    });
  }

  // Black holes. Where they are is real; the disc is turned the way ours is
  // known to be where that has been measured, and flat to its galaxy where not.
  const holes = [];
  for (const h of BLACK_HOLES) {
    const dir = skyDirection(h.ra, h.dec);
    let normal;
    if (h.tilt.flatTo === "galaxy") normal = basis.north.clone();
    else {
      const { north, east } = skyAxes(dir);
      const lean = north.clone().multiplyScalar(Math.cos(h.tilt.pa * DEG)).addScaledVector(east, Math.sin(h.tilt.pa * DEG));
      normal = dir.clone().multiplyScalar(-Math.cos(h.tilt.towards * DEG)).addScaledVector(lean, Math.sin(h.tilt.towards * DEG));
    }
    normal.normalize();
    const place = { id: h.id, name: h.name, sub: h.lightYears, position: dir.clone().multiplyScalar(h.kly), dir, radius: h.disc.outer * h.rs, hole: { ...h, normal } };
    places.set(h.id, place);
    holes.push(place);
  }

  let built = false;
  /** Makes the clouds of stars (a moment's work, so only when first needed). */
  function build() {
    if (built) return;
    built = true;
    // The Milky Way: x out from the centre towards the Sun, y to galactic north, z the way the Sun goes round.
    const mw = pointsOf(spiral(MILKY_WAY, 101), materials);
    mw.position.copy(centre);
    mw.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(basis.center.clone().negate(), basis.north, basis.east));
    scene.add(mw);
    let seed = 200;
    for (const g of GALAXIES) {
      const place = places.get(g.id);
      const s = { ...SHAPES[g.id] };
      // Put the pink cloud and the bar where they are on our sky, in the galaxy's own frame.
      if (s.spot) s.spot = { ...s.spot, ...inDisc(place, skyDirection(s.spot.ra, s.spot.dec)) };
      if (s.bar?.pa !== undefined) {
        const { north, east } = skyAxes(place.dir);
        const onSky = north.clone().multiplyScalar(Math.cos(s.bar.pa * DEG)).addScaledVector(east, Math.sin(s.bar.pa * DEG));
        const p = inDisc(place, place.dir.clone().multiplyScalar(KLY[g.id]).add(onSky).normalize());
        s.bar = { ...s.bar, angle: Math.atan2(p.z, p.x) };
      }
      const c = s.kind === "spiral" ? spiral(s, seed++) : s.kind === "cloud" ? barredCloud(s, seed++) : blob(s, seed++);
      const p = pointsOf(c, materials);
      p.position.copy(place.position);
      if (s.kind === "blob") {
        const { north, east } = skyAxes(place.dir);
        const onSky = north.clone().multiplyScalar(Math.cos(g.pa * DEG)).addScaledVector(east, Math.sin(g.pa * DEG));
        let long = onSky;
        if (s.long === "sgr") long = basis.center.clone().multiplyScalar(0.26).addScaledVector(basis.east, -0.21).addScaledVector(basis.north, 0.94).normalize();
        if (s.long === "smc") {
          const ne = north.clone().multiplyScalar(Math.cos(45 * DEG)).addScaledVector(east, Math.sin(45 * DEG));
          long = place.dir.clone().multiplyScalar(Math.cos(20 * DEG)).addScaledVector(ne, -Math.sin(20 * DEG)).normalize();
        }
        let across = new Vector3().crossVectors(long, place.dir);
        if (across.lengthSq() < 1e-6) across = new Vector3().crossVectors(long, east);
        across.normalize();
        const third = new Vector3().crossVectors(long, across).normalize();
        p.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(across, third, long));
      } else p.quaternion.setFromRotationMatrix(place.frame);
      scene.add(p);
    }
    for (const place of holes) {
      const crowd = holeCrowd(place.hole, seed++);
      const p = pointsOf(crowd, materials);
      p.position.copy(place.position);
      scene.add(p);
    }
    far = background(pixelRatio);
    scene.add(far);
  }
  let far = null;

  // --- Flights ---
  let flight = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const look = new Matrix4();
  const q = new Quaternion();

  /**
   * Where to watch a place from: from its far side, looking back towards
   * home (so the Milky Way is out there behind it), and a little above its
   * disc so it isn't edge-on.
   */
  function viewpointFor(place) {
    if (place.id === "milkyway" || place.id === "sun") return { target: centre, position: new Vector3(), up: basis.north };
    if (place.hole) {
      // Just above the disc, a little round from the Sun's side, with the disc running across the screen.
      const { normal, rs } = place.hole;
      const flat = place.dir.clone().negate();
      flat.addScaledVector(normal, -flat.dot(normal));
      if (flat.lengthSq() < 1e-6) flat.copy(skyAxes(place.dir).east);
      flat.normalize().applyAxisAngle(normal, 0.7);
      const from = flat.multiplyScalar(Math.cos(0.2)).addScaledVector(normal, Math.sin(0.2));
      return { target: place.position, position: place.position.clone().addScaledVector(from, HOLE_VIEW * rs), up: normal, minDistance: rs * 3.2 };
    }
    const away = place.dir.clone();
    let up = new Vector3(0, 1, 0).applyMatrix4(new Matrix4().extractRotation(place.frame));
    if (Math.abs(up.dot(away)) > 0.95) {
      // No disc to look down on: go up towards galactic north, turned to one
      // side (by `side` degrees) for a good view, and so the way there never
      // looks straight along north (where the camera can't tell which way up
      // to be).
      const north = basis.north.clone().addScaledVector(away, -basis.north.dot(away)).normalize();
      const side = (SHAPES[place.id]?.side ?? 0) * DEG;
      up = north.multiplyScalar(Math.cos(side)).addScaledVector(new Vector3().crossVectors(away, north), Math.sin(side));
    }
    if (up.dot(away) < 0) up.negate();
    const from = away.multiplyScalar(0.75).addScaledVector(up, 0.5).normalize();
    const distance = Math.max(8, place.radius * 2.2);
    return { target: place.position, position: place.position.clone().addScaledVector(from, distance), up: basis.north };
  }

  /**
   * Flies to a place: a galaxy, or "home" (to the Sun's spot in the Milky
   * Way). `from`: where the camera starts if not where it is now.
   */
  function flyTo(id, { instant = false, from = null } = {}) {
    build();
    const place = places.get(id === "home" ? "sun" : id);
    const end = viewpointFor(place);
    controls.enabled = false;
    if (from) {
      camera.position.copy(from.position);
      camera.quaternion.copy(from.quaternion);
      camera.up.copy(end.up);
    }
    if (instant) {
      camera.position.copy(end.position);
      setUp(end.up);
      camera.lookAt(end.target);
      finish(end);
      return;
    }
    const startOffset = camera.position.clone().sub(end.target);
    const d0 = Math.max(startOffset.length(), 1e-3);
    const d1 = end.position.clone().sub(end.target).length();
    flight = {
      start: null, // set on the first frame, so time spent getting ready isn't skipped
      duration: 3200 + 600 * Math.min(4, Math.abs(Math.log(d0 / Math.max(d1, 1)))),
      end,
      fromDir: startOffset.divideScalar(d0),
      toDir: end.position.clone().sub(end.target).normalize(),
      d0,
      d1: Math.max(d1, 1e-3),
      fromQuat: camera.quaternion.clone(),
      up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), // carried along frame to frame
      last: null,
      turn: null, // last frame's way of facing the target (to keep turning the same way round)
      avoid: [],
      home: id === "home",
    };
    flight.avoid = inTheWay(place, flight);
  }

  const at = new Vector3();
  const spin = new Quaternion();
  const turnTo = new Quaternion();
  /** Where a flight would put the camera `e` of the way along (going straight, before any lift). */
  function along(f, e, out) {
    turnTo.setFromUnitVectors(f.fromDir, f.toDir);
    spin.identity().slerp(turnTo, e);
    const d = Math.exp(Math.log(f.d0) + (Math.log(f.d1) - Math.log(f.d0)) * e);
    return out.copy(f.fromDir).applyQuaternion(spin).multiplyScalar(d).add(f.end.target);
  }

  /**
   * The galaxies the flight would pass too close to on the way (most often
   * the one we're leaving: we start on its far side). Not one we start
   * inside (home) or are going to. For each, a detour planned once up
   * front: a smooth bump along the flight, to the side the straight way
   * already passes, just big enough to keep clear. (Worked out from where
   * the camera is each frame it would feed back on itself and kink.)
   */
  function inTheWay(place, f) {
    const found = [];
    const SAMPLES = 200;
    for (const p of places.values()) {
      if (p === place || p.small || p.unpickable || p.hole) continue;
      const start = camera.position.distanceTo(p.position) / p.radius;
      if (start < 1 || f.end.position.distanceTo(p.position) < p.radius * 1.3) continue;
      let closest = CLEAR;
      let when = -1;
      // Looked at evenly in time, since a flight is slow at the start and the end.
      for (let i = 1; i < SAMPLES; i++) {
        const e = ease(i / SAMPLES);
        const near = along(f, e, at).distanceTo(p.position) / p.radius;
        // Closer than it should be, and closer than we start (moving off from right by it is fine).
        if (near < closest && near < start * 0.9) [closest, when] = [near, e];
      }
      if (when < 0) continue;
      // Go round on the side the straight way already passes.
      const passing = along(f, when, new Vector3());
      const step = Math.max(1e-5, when * 0.05);
      const heading = along(f, Math.min(1, when + step), new Vector3()).sub(along(f, Math.max(0, when - step), at)).normalize();
      const over = passing.sub(p.position);
      over.addScaledVector(heading, -over.dot(heading));
      if (over.lengthSq() < 1e-9) over.copy(camera.position).sub(p.position).addScaledVector(heading, -at.copy(camera.position).sub(p.position).dot(heading));
      if (over.lengthSq() < 1e-9) continue;
      over.normalize();
      const avoid = { over, when, end: Math.min(0.97, when + Math.max(0.35, when * 1.5)), amount: 0 };
      // The least that clears it, all along the way.
      for (let amount = 0; amount < p.radius * 8; amount += p.radius * 0.02) {
        avoid.amount = amount;
        let clear = true;
        for (let i = 1; i < SAMPLES && clear; i++) {
          const e = ease(i / SAMPLES);
          along(f, e, at).addScaledVector(over, amount * detour(avoid, e));
          clear = at.distanceTo(p.position) / p.radius >= CLEAR || e > avoid.end;
        }
        if (clear) break;
      }
      found.push(avoid);
    }
    return found;
  }
  /** The shape of a detour: 0 at the start, 1 at its middle (closest approach), back to 0 at its end. Smooth all the way. */
  function detour({ when, end }, e) {
    if (e <= 0 || e >= end) return 0;
    return e < when ? MathUtils.smootherstep(e, 0, when) : 1 - MathUtils.smootherstep(e, when, end);
  }

  /** Sets which way is up for the camera and for the mouse controls (they work it out once, when made). */
  const Y = new Vector3(0, 1, 0);
  function setUp(up) {
    camera.up.copy(up);
    if (controls._quat) {
      controls._quat.setFromUnitVectors(up, Y);
      controls._quatInverse.copy(controls._quat).invert();
    }
  }

  function finish(end) {
    flight = null;
    setUp(end.up);
    controls.target.copy(end.target);
    controls.minDistance = end.minDistance ?? 0.05;
    controls.enabled = true;
    controls.update();
  }

  const dir = new Vector3();
  const forward = new Vector3();
  const up = new Vector3();
  const want = new Vector3();
  const cross = new Vector3();
  /** Moves the camera. Returns how far along a flight is (1 when there's none). */
  function update(now, drift) {
    clockNow = now;
    materials[0].uniforms.viewHeight.value = innerHeight;
    if (far) {
      far.position.copy(camera.position);
      far.children[0].material.uniforms.viewHeight.value = innerHeight;
    }
    if (!flight) {
      controls.autoRotate = drift;
      controls.update();
      return 1;
    }
    const f = flight;
    f.start ??= now;
    f.last ??= now;
    const t = Math.min(1, (now - f.start) / f.duration);
    const e = ease(t);
    along(f, e, camera.position);
    // Round any galaxy in the way, not through it.
    for (const a of f.avoid) camera.position.addScaledVector(a.over, a.amount * detour(a, e));
    camera.up.copy(f.end.up);

    // Which way is up: the end's up (galactic north), as near as we can.
    // Looking almost straight along it, that's no help (it swings right round
    // as we pass), so there up is carried on from the last frame instead,
    // and turned back gently after: no faster than ROLL_SPEED, unless that
    // wouldn't finish by the end.
    forward.subVectors(f.end.target, camera.position).normalize();
    up.copy(f.up).addScaledVector(forward, -forward.dot(f.up));
    if (up.lengthSq() < 1e-12) up.copy(f.end.up).addScaledVector(forward, -forward.dot(f.end.up));
    up.normalize();
    want.copy(f.end.up).addScaledVector(forward, -forward.dot(f.end.up));
    const clear = want.length();
    if (clear > 1e-6) {
      want.divideScalar(clear);
      const angle = Math.atan2(cross.crossVectors(up, want).dot(forward), up.dot(want));
      const left = Math.max(1e-3, ((1 - t) * f.duration) / 1000);
      const rate = Math.max(ROLL_SPEED, Math.abs(angle) / left) * MathUtils.smoothstep(clear, 0.02, 0.1);
      const share = t >= 1 ? 1 : (rate * Math.max(0, now - f.last)) / 1000 / Math.max(Math.abs(angle), 1e-9);
      up.applyAxisAngle(forward, angle * Math.min(1, share));
    }
    f.up.copy(up);
    f.last = now;
    look.lookAt(camera.position, f.end.target, up);
    // Turn from where we were facing to face it, over the first part of the
    // flight. It keeps moving, so carry on turning the same way round rather
    // than always the short way (which would flip once it passes halfway).
    q.setFromRotationMatrix(look);
    if (q.dot(f.turn ?? f.fromQuat) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    f.turn = (f.turn ?? new Quaternion()).copy(q);
    turnBetween(f.fromQuat, q, 1 - (1 - Math.min(1, e * 3)) ** 2, camera.quaternion);
    if (t >= 1) {
      if (f.home) flight = null;
      else finish(f.end);
    }
    return t;
  }

  // --- Clicking ---
  const ray = new Ray();
  /** The galaxy (or the Milky Way) under a screen point, if any. */
  function pick(x, y) {
    ray.origin.copy(camera.position);
    ray.direction.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    let best = null;
    let bestDistance = Infinity;
    for (const p of places.values()) {
      if (p.small || p.unpickable) continue;
      const toIt = p.position.clone().sub(camera.position);
      const along = toIt.dot(ray.direction);
      if (along <= 0) continue;
      const miss = toIt.addScaledVector(ray.direction, -along).length();
      if (miss < p.radius * 0.7 && along < bestDistance) [best, bestDistance] = [p, along];
    }
    return best;
  }

  // Drawing: every star's light is added up first (in a buffer that can go
  // past white), then the bright parts are rolled off once, like a photo.
  // Rolled off star by star, the faint ones would round down to nothing.
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  // Near a black hole the picture goes through a second step that bends it (and
  // is kept with its smaller sizes made, for the glow).
  const bent = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  const screen = new Scene();
  const flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const show = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ ...shaders.rollOff, uniforms: {
      map: { value: target.texture },
      exposure: { value: EXPOSURE },
      bloom: { value: 0 },
      texel: { value: new Vector2(1, 1) },
    }, depthTest: false, depthWrite: false, toneMapped: false }));
  const lensScreen = new Scene();
  const lens = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ ...shaders.holeLens, uniforms: {
      map: { value: target.texture },
      time: { value: 0 },
      holeOn: { value: 0 },
      wide: { value: 1 },
      holeRel: { value: new Vector3() },
      holeNormal: { value: new Vector3(0, 1, 0) },
      holeDisc: { value: new Vector4(3, 15, 1, 12000) },
      holeSpin: { value: 1 },
      camRight: { value: new Vector3(1, 0, 0) },
      camUp: { value: new Vector3(0, 1, 0) },
      camForward: { value: new Vector3(0, 0, -1) },
      tanHalf: { value: new Vector2(1, 1) },
    }, depthTest: false, depthWrite: false, toneMapped: false }));
  show.frustumCulled = lens.frustumCulled = false;
  screen.add(show);
  lensScreen.add(lens);
  const bufferSize = new Vector2();
  const wideCam = new PerspectiveCamera();
  let wideNow = 1; // 1 normally, HOLE_WIDE near a black hole
  let lensScale = 1; // how sharp the bending is drawn: lowered if the graphics chip can't keep up
  let lensLocked = false; // (for testing) keep it at full sharpness
  let slow = 0;
  let fast = 0;
  let lastRender = 0;
  function render(renderer, budgetMs = 1000 / 60) {
    // Some older graphics chips can't draw into a buffer like that: then
    // straight to the screen, each star's light rolled off on its own.
    if (!renderer.extensions.has("EXT_color_buffer_float") && !renderer.extensions.has("EXT_color_buffer_half_float")) {
      const was = renderer.toneMapping;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.render(scene, camera);
      renderer.toneMapping = was;
      return;
    }
    renderer.getDrawingBufferSize(bufferSize);
    camera.updateMatrixWorld();
    const near = aimHole();
    // Wider than the screen while near one (with a little give, so it doesn't flicker on and off at the edge).
    wideNow = near > (wideNow > 1 ? 0.001 : 0.004) ? HOLE_WIDE : 1;
    for (const m of [materials[0], far?.children[0].material]) {
      if (!m) continue;
      m.uniforms.viewHeight.value = innerHeight * wideNow;
      m.uniforms.pixelRatio.value = pixelRatio * wideNow;
    }
    // If the bending is making it stutter, draw it at lower resolution (and back up when there's room).
    if (near > 0.5 && lastRender && !lensLocked) {
      const gap = clockNow - lastRender;
      if (gap > budgetMs * 1.6) [slow, fast] = [slow + 1, 0];
      else if (gap < budgetMs * 1.2) [slow, fast] = [Math.max(0, slow - 1), fast + 1];
      if (slow > 8 && lensScale > 0.4) [lensScale, slow] = [Math.max(0.4, lensScale * 0.8), 0];
      if (fast > 240 && lensScale < 1) [lensScale, fast] = [Math.min(1, lensScale * 1.25), 0];
    }
    lastRender = clockNow;
    const w = Math.round(bufferSize.x * wideNow);
    const h = Math.round(bufferSize.y * wideNow);
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    const bw = Math.round(bufferSize.x * lensScale);
    const bh = Math.round(bufferSize.y * lensScale);
    if (bent.width !== bw || bent.height !== bh) bent.setSize(bw, bh);
    let seen = camera;
    if (wideNow > 1) {
      // The same view, with the field of view stretched.
      wideCam.position.copy(camera.position);
      wideCam.quaternion.copy(camera.quaternion);
      wideCam.near = camera.near;
      wideCam.far = camera.far;
      wideCam.aspect = camera.aspect;
      wideCam.fov = (2 * Math.atan(Math.tan((camera.fov * DEG) / 2) * wideNow)) / DEG;
      wideCam.updateProjectionMatrix();
      wideCam.updateMatrixWorld(true);
      seen = wideCam;
    }
    renderer.setRenderTarget(target);
    renderer.render(scene, seen);
    if (near) {
      lens.material.uniforms.wide.value = wideNow;
      renderer.setRenderTarget(bent);
      renderer.render(lensScreen, flat);
    }
    renderer.setRenderTarget(null);
    show.material.uniforms.map.value = near ? bent.texture : target.texture;
    show.material.uniforms.bloom.value = near ? HOLE_GLOW * near : 0;
    show.material.uniforms.texel.value.set(1 / bent.width, 1 / bent.height);
    renderer.render(screen, flat);
  }

  // The nearest black hole in front of us, if it's close enough to bend the light.
  const holeUniforms = lens.material.uniforms;
  const toHole = new Vector3();
  /** Points the bending at the nearest hole. Returns how strongly it's on (0 = not at all). */
  function aimHole() {
    let best = null;
    let bestR = HOLE_ON;
    for (const place of holes) {
      toHole.subVectors(place.position, camera.position);
      const r = toHole.length() / place.hole.rs;
      if (r < bestR && (r < 60 || toHole.dot(camera.getWorldDirection(forwardNow)) > 0)) [best, bestR] = [place, r];
    }
    const u = holeUniforms;
    u.holeOn.value = best ? 1 - MathUtils.smoothstep(bestR, HOLE_FULL, HOLE_ON) : 0;
    if (!best || u.holeOn.value < 0.001) return 0;
    const h = best.hole;
    u.holeRel.value.subVectors(best.position, camera.position).divideScalar(h.rs);
    u.holeNormal.value.copy(h.normal);
    u.holeDisc.value.set(h.disc.inner, h.disc.outer, h.disc.bright, h.disc.kelvin);
    u.holeSpin.value = h.spin;
    u.time.value = clockNow / 1000;
    camera.matrixWorld.extractBasis(u.camRight.value, u.camUp.value, forwardNow);
    u.camForward.value.copy(forwardNow).negate();
    const tanV = Math.tan((camera.fov * DEG) / 2);
    u.tanHalf.value.set(tanV * camera.aspect, tanV);
    return u.holeOn.value;
  }
  const forwardNow = new Vector3();
  let clockNow = 0;

  return {
    scene,
    camera,
    controls,
    places,
    flyTo,
    update,
    pick,
    render,
    set lensLocked(v) {
      lensLocked = v;
      if (v) lensScale = 1;
    },
    /** Back home: let go of the drawing buffer until next time. */
    release() {
      target.dispose();
      bent.dispose();
    },
    get flying() {
      return Boolean(flight);
    },
    /** Fades every star (0..1), for the dip between scenes. */
    setOpacity(v) {
      materials[0].uniforms.opacity.value = v;
    },
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
  };
}

/** Faint, far-off galaxies behind everything, so empty space doesn't look empty. */
function background(pixelRatio) {
  const rand = random(777);
  const c = cloud(2500);
  for (let i = 0; i < 2500; i++) {
    const th = rand() * 2 * Math.PI;
    const z = 2 * rand() - 1;
    const r = Math.sqrt(1 - z * z) * 60000;
    const tint = rand() < 0.5 ? OLD : YOUNG;
    put(c, r * Math.cos(th), z * 60000, r * Math.sin(th), tint, 60 + rand() * 160, 0.2 + rand() * 0.5);
  }
  const g = new Group();
  g.add(pointsOf(c, starMaterials(pixelRatio)));
  return g;
}

/**
 * Stars; a spiral's stars; and the soft glow under a spiral's disc. Close
 * up, a star is drawn as a sharp point no more than a few pixels across, and
 * the glow (only there to fill in a disc seen from afar) fades away, its
 * light going to the spiral's stars instead.
 */
function starMaterials(pixelRatio) {
  const uniforms = {
    pixelRatio: { value: pixelRatio },
    viewHeight: { value: innerHeight },
    opacity: { value: 1 },
    glowSize: { value: GLOW_SIZE },
    glowScale: { value: GLOW_SCALE },
    glowLight: { value: GLOW_LIGHT },
  };
  const make = (maxSize, defines) =>
    new ShaderMaterial({
      ...shaders.galaxyStars,
      uniforms: { ...uniforms, maxSize: { value: maxSize } }, // the rest shared, so setting one sets them all
      defines,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  return [make(STAR_SIZE, {}), make(STAR_SIZE, { GLOW_BACK: "" }), make(GLOW_SIZE, { GLOW: "" })];
}

/** Turns from a to b by `w` (0..1), the way b lies (even past halfway round), not always the short way. */
function turnBetween(a, b, w, out) {
  const cos = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  if (sin < 1e-6) return out.copy(w < 0.5 ? a : b);
  const ka = Math.sin((1 - w) * angle) / sin;
  const kb = Math.sin(w * angle) / sin;
  return out.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb, a.w * ka + b.w * kb).normalize();
}
