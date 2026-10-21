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
import { EXOPLANET_SYSTEMS } from "./exoplanet-data.js";
import { GALAXIES, skyDirection } from "./galaxies.js";
import { blackbody } from "./exosystem.js";
import { createGateMesh, GATE } from "./gate.js";
import { barredCloud, blob, BRIGHTNESS, cloud, colliding, elliptical, GLOW_SCALE, holeCrowd, OLD, put, ring, spiral, YOUNG } from "./clouds.js";
import { random } from "./noise.js";
import { galacticBasis } from "./sky.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;
// Distance from the Sun. M32 sits about 10,000 light-years in front of Andromeda, M110 about 40,000 behind.
export const KLY = {
  lmc: 161.7, smc: 203.7, sgr: 86, m31: 2495, m33: 2740, m32: 2485, m110: 2534,
  // Far beyond the Local Group.
  m81: 11800, m82: 11400, cena: 12000, ngc253: 11400, m101: 20900, m51: 28000, m104: 29000, m87: 53500, ngc1300: 61000, antennae: 65000, cartwheel: 500000,
};
const SUN_FROM_CENTRE = 26.7; // kly from the Milky Way's centre
const EXPOSURE = 2.5; // the whole picture, before the brightest parts are rolled off
const SATURATION = 1.7; // richer colour than the plain sum of the stars, which washes towards white
const STAR_SIZE = 10; // the most a star is drawn across, in CSS pixels
const GLOW_SIZE = 6; // the glow fades out past this: it's only there to fill in a galaxy seen from far off
const GLOW_LIGHT = 0.7; // a spiral's glow gives off this much light for each bit from its stars
const ROLL_SPEED = Math.PI / 3; // how fast a flight turns the picture round, unless it must go faster to finish in time (60 degrees a second)
const CLEAR = 1.2; // how far to keep from a galaxy on the way past, in its radii
const HOLE_VIEW = 32; // how far from a black hole you arrive, in its radii
const HOLE_ON = 6000; // the bending of light starts to show this far out (in radii)...
const HOLE_FULL = 1500; // ...and is all there from here
const HOLE_GLOW = 0.55; // how much the blurred picture glows round a black hole's bright disc
const SYSTEM_VIEW = 0.00045; // how far from a star with planets you arrive: just under half a light-year
const SYSTEM_STAR_PX = 7; // how big its glow looks there, in pixels
const GATE_VIEW = 0.0007; // how far from the Gate you arrive, in thousands of light-years (about 0.7 of one)
const GATE_RING = 0.17; // the ring's radius, as a share of that: it fills about half the screen height on arrival
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

  // --- Far beyond the Local Group: the famous ones, in their true colours. ---
  // Sizes are real (kly). Their tilts are roughly right; the stars are made up.
  // Bode's Galaxy: a grand-design spiral with a big golden middle.
  m81: { kind: "spiral", stars: 80000, radius: 45, scale: 9, bulge: 6, bulgeShare: 0.2, pitch: 14, armShare: 0.5, arms: [{ r0: 14, weight: 1 }, { r0: 14, weight: 1, phase: Math.PI }], light: 0.75, tilt: { inclination: 59, nodes: 157, near: 247 }, winding: 1, palette: { old: [1.0, 0.82, 0.55], young: [0.4, 0.58, 1.0], warm: [1.0, 0.9, 0.75] } },
  // The Cigar: seen nearly edge-on, with red-pink gas blown out above and below.
  m82: { kind: "spiral", stars: 50000, radius: 20, scale: 4, bulge: 2, bulgeShare: 0.14, pitch: 20, armShare: 0.3, arms: [{ r0: 6, weight: 1 }, { r0: 6, weight: 1, phase: Math.PI }], light: 0.9, tilt: { inclination: 80, nodes: 65, near: 155 }, winding: 1, plume: { count: 7000, length: 14, width: 4.5 }, palette: { old: [1.0, 0.78, 0.55], young: [1.0, 0.65, 0.7], glowing: [1.0, 0.3, 0.42] } },
  // Centaurus A: a giant golden galaxy cut across by a dark lane, with new stars along its edges.
  cena: { kind: "elliptical", stars: 70000, axes: [36, 30, 34], light: 0.55, clusters: 200, lane: { half: 3.2, r1: 30, cut: 0.97 }, tilt: { inclination: 72, nodes: 115, near: 205 }, radius: 36 },
  // The Sculptor Galaxy: edge-on, golden, with clumps of pink and red outflow.
  ngc253: { kind: "spiral", stars: 80000, radius: 45, scale: 9, bulge: 4, bulgeShare: 0.15, pitch: 16, armShare: 0.4, arms: [{ r0: 12, weight: 1 }, { r0: 12, weight: 1, phase: Math.PI }], light: 0.8, tilt: { inclination: 78, nodes: 52, near: 142 }, winding: 1, plume: { count: 6000, length: 12, width: 5 }, palette: { old: [1.0, 0.8, 0.55], young: [1.0, 0.72, 0.75], glowing: [1.0, 0.35, 0.45] } },
  // The Pinwheel: huge, face on, blue-white, with pink knots all along its arms.
  m101: { kind: "spiral", stars: 110000, radius: 85, scale: 17, bulge: 3, bulgeShare: 0.05, pitch: 22, armShare: 0.65, arms: [{ r0: 20, weight: 1 }, { r0: 20, weight: 1, phase: Math.PI }, { r0: 30, weight: 0.4, phase: 1.0 }], light: 0.65, tilt: { inclination: 18, nodes: 39, near: 129 }, winding: 1, palette: { old: [1.0, 0.86, 0.68], young: [0.35, 0.55, 1.0], glowing: [1.0, 0.22, 0.45] } },
  // The Whirlpool: two bold arms, and a small galaxy (NGC 5195) pulled up against one of them.
  m51: { kind: "spiral", stars: 90000, radius: 45, scale: 9, bulge: 3.5, bulgeShare: 0.08, pitch: 17, armShare: 0.62, arms: [{ r0: 12, weight: 1 }, { r0: 12, weight: 1, phase: Math.PI }], light: 0.7, tilt: { inclination: 22, nodes: 163, near: 253 }, winding: 1, palette: { old: [1.0, 0.8, 0.55], young: [0.33, 0.55, 1.0], glowing: [1.0, 0.22, 0.42] }, companion: { x: 54, z: -20, radius: 11, stars: 6000, color: [1.0, 0.78, 0.5] } },
  // The Sombrero: an enormous golden bulge, a thin disc, and a dark dust lane across the front.
  m104: { kind: "spiral", stars: 90000, radius: 50, scale: 10, bulge: 11, bulgeShare: 0.5, bulgeFlat: 0.85, pitch: 10, armShare: 0, arms: [{ r0: 30, weight: 1 }], light: 0.7, tilt: { inclination: 84, nodes: 89, near: 179 }, winding: 1, lane: { half: 1.6, r0: 2, r1: 42, cut: 0.95 }, palette: { old: [1.0, 0.86, 0.66], warm: [1.0, 0.92, 0.8], young: [0.9, 0.85, 0.85] } },
  // M87: the biggest of them, with a blue jet shot out of its middle (the same way as its black hole's axis).
  m87: { kind: "elliptical", stars: 80000, axes: [60, 52, 56], light: 0.3, clusters: 700, jet: { length: 9, along: "m87bh" }, radius: 60 },
  // NGC 1300: a barred spiral, golden bar, blue arms curling off its ends.
  ngc1300: { kind: "spiral", stars: 70000, radius: 55, scale: 12, bulge: 3, bulgeShare: 0.1, bar: { half: 20, angle: 0.5 }, barShare: 0.22, pitch: 18, armShare: 0.5, arms: [{ r0: 20, weight: 1 }, { r0: 20, weight: 1, phase: Math.PI }], light: 0.7, tilt: { inclination: 49, nodes: 106, near: 196 }, winding: 1, palette: { old: [1.0, 0.82, 0.55], young: [0.35, 0.55, 1.0] } },
  // The Antennae: two galaxies colliding, with two long tails of stars thrown out.
  antennae: { kind: "colliding", stars: 60000, radius: 110, light: 0.8, tilt: { inclination: 50, nodes: 30, near: 120 } },
  // The Cartwheel: a ring of blue stars blown outwards when a small galaxy ran through its middle.
  cartwheel: { kind: "ring", stars: 50000, radius: 75, light: 0.85, tilt: { inclination: 28, nodes: 90, near: 180 } },
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
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.00001, 1e6);
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
  const nearStars = materials[3]; // like the others, but not dimmed when close

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

  // Stars with planets: a glowing point at the real place and distance, to fly up to and dive into.
  const systems = [];
  for (const sys of EXOPLANET_SYSTEMS) {
    const dir = skyDirection(sys.ra, sys.dec);
    const place = {
      id: sys.id,
      name: sys.name,
      sub: `${sys.ly < 100 ? sys.ly.toFixed(1) : Math.round(sys.ly).toLocaleString("en-US")} light-years`,
      position: dir.clone().multiplyScalar(sys.ly / 1000),
      dir,
      radius: SYSTEM_VIEW * 0.4,
      system: sys,
      labelRange: 0.06, // its name shows only once you're within about 60 light-years
    };
    places.set(sys.id, place);
    systems.push(place);
  }

  // The Gate: made up, at the place the "Wow!" signal came from, to fly up to and go through.
  {
    const dir = skyDirection(GATE.ra, GATE.dec);
    places.set(GATE.id, {
      id: GATE.id,
      name: GATE.name,
      sub: GATE.sub,
      fixedSub: true, // its distance isn't known, so the label doesn't pretend
      position: dir.clone().multiplyScalar(GATE.kly),
      dir,
      radius: GATE_VIEW * GATE_RING,
      gate: GATE,
    });
  }

  const gateMesh = createGateMesh({ billboard: true, size: GATE_VIEW * GATE_RING, minPx: 8, viewHeight: innerHeight * pixelRatio });

  /** The stars of one galaxy: built when first needed (the far ones are only a dot until then). */
  const clouds = new Map();
  const standIns = new Map();
  function buildGalaxy(g) {
    if (clouds.has(g.id)) return;
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
    if (s.jet?.along) {
      // The jet runs the way that black hole's axis does: turn that direction into this galaxy's own frame.
      const axis = places.get(s.jet.along).hole.normal;
      s.jet = { ...s.jet, dir: axis.clone().applyMatrix4(new Matrix4().extractRotation(place.frame).transpose()) };
    }
    const builders = { spiral, cloud: barredCloud, blob, elliptical, ring, colliding };
    const c = builders[s.kind](s, 200 + GALAXIES.indexOf(g));
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
    clouds.set(g.id, p);
    const dot = standIns.get(g.id);
    if (dot) {
      scene.remove(dot);
      dot.geometry.dispose();
      standIns.delete(g.id);
    }
  }
  /** Far galaxies are a small soft dot (the same light) until you're near: there are a lot of stars in all of them. */
  function standInFor(g) {
    const place = places.get(g.id);
    const s = SHAPES[g.id];
    const colours = g.colors ?? [[1, 0.9, 0.75], [0.8, 0.85, 1]];
    const tint = [0, 1, 2].map((i) => (colours[0][i] + colours[1][i]) / 2);
    const c = cloud(1);
    put(c, 0, 0, 0, tint, place.radius * 1.8, s.light * BRIGHTNESS * 0.7);
    const dot = pointsOf(c, materials);
    dot.position.copy(place.position);
    scene.add(dot);
    standIns.set(g.id, dot);
  }
  const FAR_FROM = 5000; // kly: past this, a galaxy is a dot until you go there
  const isFar = (g) => KLY[g.id] > FAR_FROM;

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
    for (const g of GALAXIES) {
      if (isFar(g)) standInFor(g);
      else buildGalaxy(g);
    }
    holes.forEach((place, i) => {
      const crowd = holeCrowd(place.hole, 300 + i);
      const p = pointsOf(crowd, materials);
      p.position.copy(place.position);
      scene.add(p);
    });
    // The stars of the systems, each as big as its glow should look when you get there.
    const c = cloud(systems.length * 2);
    for (const place of systems) {
      const tint = blackbody(place.system.star.temp);
      const size = (SYSTEM_STAR_PX * SYSTEM_VIEW) / 1156; // in kly, so it's about that many pixels across at the arrival spot
      put(c, place.position.x, place.position.y, place.position.z, tint, size, 3);
      put(c, place.position.x, place.position.y, place.position.z, tint, size * 6, 0.12);
    }
    const starPoints = pointsOf(c, [nearStars, nearStars]);
    scene.add(starPoints);
    gateMesh.position.copy(places.get(GATE.id).position);
    scene.add(gateMesh);
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
    if (place.gate) {
      // Between us and the ring, looking at it, a little off to one side so it's seen at a slant.
      const from = place.dir.clone().negate().multiplyScalar(0.95).addScaledVector(basis.north, 0.2).normalize();
      return { target: place.position, position: place.position.clone().addScaledVector(from, GATE_VIEW), up: basis.north, minDistance: GATE_VIEW * 0.15 };
    }
    if (place.system) {
      // Between us and the star, looking at it, a little under half a light-year off.
      const from = place.dir.clone().negate().multiplyScalar(0.9).addScaledVector(basis.north, 0.3).normalize();
      return { target: place.position, position: place.position.clone().addScaledVector(from, SYSTEM_VIEW), up: basis.north, minDistance: SYSTEM_VIEW * 0.2 };
    }
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
    // Seen edge-on from here (like the Sombrero, with its dust lane): look from close to the disc's level.
    const edgeOn = (SHAPES[place.id]?.tilt?.inclination ?? 0) >= 70;
    const from = away.multiplyScalar(edgeOn ? 0.99 : 0.75).addScaledVector(up, edgeOn ? 0.1 : 0.5).normalize();
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
    // Where we're going has to be there, in full (the far ones are only a dot until now).
    for (const gid of [id, place.hole?.host]) {
      const g = GALAXIES.find((x) => x.id === gid);
      if (g) buildGalaxy(g);
    }
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
      duration: 3200 + 600 * Math.min(4, Math.abs(Math.log(d0 / Math.max(d1, 0.01)))),
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
      if (p === place || p.small || p.unpickable || p.hole || p.system || p.gate) continue;
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
    // Close enough to a far galaxy to see it as more than a dot: make its stars (one a frame, it takes a moment).
    for (const [gid] of standIns) {
      const place = places.get(gid);
      if (camera.position.distanceTo(place.position) < place.radius * 300) {
        buildGalaxy(GALAXIES.find((x) => x.id === gid));
        break;
      }
    }
    materials[0].uniforms.viewHeight.value = innerHeight;
    gateMesh.material.uniforms.uTime.value = now / 1000;
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
      saturation: { value: SATURATION },
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
    gateMesh.material.uniforms.uViewHeight.value = h;
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
  return [make(STAR_SIZE, {}), make(STAR_SIZE, { GLOW_BACK: "" }), make(GLOW_SIZE, { GLOW: "" }), make(STAR_SIZE * 1.5, { NO_NEAR_FADE: "" })];
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
