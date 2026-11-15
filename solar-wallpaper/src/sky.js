// The background: stars, the Milky Way and the nearest galaxies, turned to
// where the real ones sit in the sky. The stars are the real ones, as faint as
// eyes can see (from the Hipparcos catalogue: see stars.js), and the
// constellations can be drawn over them.
import {
  AdditiveBlending,
  BackSide,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { eqjToScene } from "./ephemeris.js";
import { createGalaxies, skyDirection } from "./galaxies.js";
import { constellationLines, realStars, skyNames, starColour, starLook } from "./stars.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;

function radec(raDeg, decDeg) {
  const c = Math.cos(decDeg * DEG);
  return eqjToScene(c * Math.cos(raDeg * DEG), c * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)).normalize();
}

/** Rotation from galactic coordinates (x to the centre, z to the north pole) into the scene. */
export function galacticBasis() {
  const center = radec(266.40499, -28.93617); // Sagittarius A*
  const north = radec(192.85948, 27.12825);
  north.addScaledVector(center, -north.dot(center)).normalize();
  const east = new Vector3().crossVectors(center, north).negate(); // galactic longitude 90
  return { center, north, east, matrix: new Matrix4().makeBasis(center, north, east.clone().negate()) };
}

/** The real stars, to magnitude 6 (see stars.js): each where it is in the sky, as bright and as coloured as it is. */
function makeStars() {
  const pos = [];
  const size = [];
  const tint = [];
  const v = new Vector3();
  for (const s of realStars()) {
    skyDirection(s.ra, s.dec, v).multiplyScalar(900);
    pos.push(v.x, v.y, v.z);
    const { size: px, bright } = starLook(s.mag);
    size.push(px);
    const c = starColour(s.bv);
    tint.push(c[0] * bright, c[1] * bright, c[2] * bright);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("size", new Float32BufferAttribute(size, 1));
  g.setAttribute("tint", new Float32BufferAttribute(tint, 3));
  return g;
}

/** The constellations' lines, just inside the stars. */
function makeLines() {
  const pos = [];
  const v = new Vector3();
  for (const [r1, d1, r2, d2] of constellationLines()) {
    skyDirection(r1, d1, v).multiplyScalar(890);
    pos.push(v.x, v.y, v.z);
    skyDirection(r2, d2, v).multiplyScalar(890);
    pos.push(v.x, v.y, v.z);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return g;
}

/** `places` are more names for labels besides the galaxies', as { id, name, lightYears, direction, distance }. */
export function createSky(pixelRatio, { places = [] } = {}) {
  const group = new Group();
  const basis = galacticBasis();

  // Transparent from the start, so it can fade with the stars (three.js won't
  // switch an opaque material to see-through without rebuilding it).
  const milkyMat = new MeshBasicMaterial({ color: 0x000000, side: BackSide, depthWrite: false, transparent: true, dithering: true }); // (dithered, or the faint gradient shows steps)
  const milky = new Mesh(new SphereGeometry(1000, 64, 32), milkyMat);
  milky.quaternion.setFromRotationMatrix(basis.matrix);
  milky.renderOrder = -2;
  group.add(milky);

  // Stars add their light to whatever glow is behind them rather than covering it.
  const starMat = new ShaderMaterial({
    ...shaders.stars,
    uniforms: { pixelRatio: { value: pixelRatio }, opacity: { value: 1 } },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const starPoints = new Points(makeStars(), starMat);
  starPoints.renderOrder = -1;
  starPoints.frustumCulled = false;
  group.add(starPoints);

  const galaxies = createGalaxies();
  group.add(galaxies.group);

  // The constellations: off unless asked for.
  const linesMat = new LineBasicMaterial({ color: 0x7088c0, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
  const lines = new LineSegments(makeLines(), linesMat);
  lines.renderOrder = -1;
  lines.frustumCulled = false;
  lines.visible = false;
  group.add(lines);
  let linesOn = false;
  const showLines = () => {
    linesMat.opacity = linesOn ? 0.3 * fade : 0;
    lines.visible = linesOn && fade > 0.01;
  };

  // The ecliptic: the line across the sky that the Sun and planets follow.
  // Only shown in the view from a body.
  const eclipticPoints = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * 2 * Math.PI;
    eclipticPoints.push(Math.cos(a) * 850, 0, Math.sin(a) * 850);
  }
  const eclipticGeo = new BufferGeometry();
  eclipticGeo.setAttribute("position", new Float32BufferAttribute(eclipticPoints, 3));
  const eclipticMat = new LineBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0, depthWrite: false });
  const ecliptic = new LineLoop(eclipticGeo, eclipticMat);
  ecliptic.renderOrder = -1;
  ecliptic.frustumCulled = false;
  ecliptic.visible = false;
  group.add(ecliptic);

  let fade = 1;
  return {
    group,
    starMat,
    /** How much the stars are showing (see setStarFade). */
    get fade() {
      return fade;
    },
    /**
     * Skip drawing the galaxy patches that are off the screen. The patches sit on a sphere round the camera
     * and the sky moves with it, so this is safe; Space Scope doesn't bother (it turns about too fast to gain).
     */
    cullGalaxies() {
      for (const patch of galaxies.group.children) patch.frustumCulled = true;
    },
    /** The named galaxies and anything else with a name on the sky, for labels. */
    galaxies: [...galaxies.named, ...places],
    /** The constellations' names and the brightest stars', for labels when the constellations are shown. */
    names: skyNames().map((n) => ({ ...n, distance: 890 })),
    /** Draws the constellations' lines (or not). */
    setConstellations(on) {
      linesOn = on;
      showLines();
    },
    /**
     * Dims the stars, the Milky Way and the galaxies (1 = full). Used when the view turns so fast
     * against the stars that they'd only streak.
     */
    setStarFade(amount) {
      fade = amount;
      starMat.uniforms.opacity.value = amount;
      milkyMat.opacity = amount;
      starPoints.visible = milky.visible = amount > 0.01; // not the ecliptic line: it doesn't streak
      showLines();
      galaxies.setFade(amount);
    },
    /** Fades the ecliptic line in (1) or out (0). */
    setEcliptic(amount) {
      eclipticMat.opacity = 0.22 * amount;
      ecliptic.visible = amount > 0.01;
    },
    /** Shows the painted Milky Way (a texture made from paintMilkyWay()'s result). */
    setMilkyWay(texture) {
      milkyMat.map = texture;
      milkyMat.color.set(0xffffff);
      milkyMat.needsUpdate = true;
    },
  };
}
