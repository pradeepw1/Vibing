// The nearest galaxies, painted on the sky where they really are.
//
// Each one is a flat patch on the star sphere, centred on its real J2000
// position, as big as it looks in a long-exposure photo and turned to its real
// position angle (measured from north through east). The look is painted in
// a shader: a spiral for Andromeda and Triangulum, a lumpy barred cloud for
// the Large Magellanic Cloud, and so on. Positions and sizes come from
// SIMBAD, NED and HyperLeda.
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, ShaderMaterial, Vector2, Vector3 } from "three";
import { eqjToScene } from "./ephemeris.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;
const RADIUS = 950; // between the stars (900) and the Milky Way (1000)
const PAD = 1.4; // the glow runs a little past the catalogue size

/** Galaxy shapes, as the shader knows them. */
const SPIRAL = 0;
const BARRED_CLOUD = 1;
const CLOUD = 2;
const DWARF = 3; // small and smooth, bright in the middle (Andromeda's companions)
const FAINT = 4; // spread thin, only just there

/**
 * ra, dec: J2000 centre (degrees). major, minor: apparent size (degrees).
 * pa: position angle of the long axis (degrees, north through east).
 * light: how bright it's drawn. lightYears: for its label.
 */
export const GALAXIES = [
  {
    id: "lmc", name: "Large Magellanic Cloud", lightYears: "160,000 light-years",
    ra: 80.894, dec: -69.756, major: 10.75, minor: 9.17, pa: 170, shape: BARRED_CLOUD, light: 0.07,
    // Its bar, and the Tarantula Nebula (30 Doradus), a big pink star-forming cloud.
    bar: 115, spot: { ra: 84.676, dec: -69.101 },
  },
  {
    id: "smc", name: "Small Magellanic Cloud", lightYears: "200,000 light-years",
    ra: 13.187, dec: -72.829, major: 5.33, minor: 3.08, pa: 45, shape: CLOUD, light: 0.06,
  },
  {
    id: "sgr", name: "Sagittarius Dwarf", lightYears: "70,000 light-years",
    // The nearest galaxy we know of, but spread thin behind the middle of the
    // Milky Way, so it's only just there.
    ra: 283.83, dec: -30.545, major: 7.5, minor: 3.6, pa: 104, shape: FAINT, light: 0.006,
  },
  {
    id: "m31", name: "Andromeda Galaxy", lightYears: "2.5 million light-years",
    ra: 10.6846, dec: 41.269, major: 3.17, minor: 1.0, pa: 38, shape: SPIRAL, light: 0.6, winding: 2.2,
  },
  {
    id: "m33", name: "Triangulum Galaxy", lightYears: "2.7 million light-years",
    ra: 23.4625, dec: 30.66, major: 1.18, minor: 0.7, pa: 23, shape: SPIRAL, light: 0.4, winding: 1.6,
  },
  // Andromeda's two brightest companions. Too small to name at this scale.
  { id: "m32", ra: 10.674, dec: 40.865, major: 0.145, minor: 0.108, pa: 170, shape: DWARF, light: 0.5 },
  { id: "m110", ra: 10.092, dec: 41.685, major: 0.365, minor: 0.182, pa: 170, shape: DWARF, light: 0.3 },
];

/** Unit direction (scene axes) of a J2000 right ascension and declination, in degrees. */
export function skyDirection(raDeg, decDeg, out = new Vector3()) {
  const c = Math.cos(decDeg * DEG);
  return eqjToScene(c * Math.cos(raDeg * DEG), c * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG), out).normalize();
}

/** North and east on the sky at a J2000 position, as scene directions. */
function northEast(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const north = eqjToScene(-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)).normalize();
  const east = eqjToScene(-Math.sin(ra), Math.cos(ra), 0).normalize();
  return { north, east };
}

const COLORS = {
  [SPIRAL]: { core: new Color(1.0, 0.86, 0.66), disk: new Color(0.7, 0.8, 1.0) },
  [BARRED_CLOUD]: { core: new Color(0.95, 0.93, 1.0), disk: new Color(0.72, 0.8, 1.0) },
  [CLOUD]: { core: new Color(0.95, 0.93, 1.0), disk: new Color(0.72, 0.8, 1.0) },
  [DWARF]: { core: new Color(1.0, 0.9, 0.78), disk: new Color(0.9, 0.86, 0.8) },
  [FAINT]: { core: new Color(1.0, 0.92, 0.82), disk: new Color(0.95, 0.9, 0.84) },
};

function patch(g, seed) {
  const center = skyDirection(g.ra, g.dec);
  const { north, east } = northEast(g.ra, g.dec);
  const pa = g.pa * DEG;
  const long = north.clone().multiplyScalar(Math.cos(pa)).addScaledVector(east, Math.sin(pa));
  const short = north.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(east, Math.cos(pa));
  const a = RADIUS * Math.tan((g.major / 2) * DEG) * PAD;
  const b = RADIUS * Math.tan((g.minor / 2) * DEG) * PAD;
  const mid = center.clone().multiplyScalar(RADIUS);
  const pos = [];
  const uv = [];
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = mid.clone().addScaledVector(long, a * i).addScaledVector(short, b * j);
    pos.push(p.x, p.y, p.z);
    uv.push(i * PAD, j * PAD); // in units of the catalogue half-sizes
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  // Where the bright spot sits in the patch, in the same units.
  const spot = new Vector2(9, 9);
  if (g.spot) {
    const d = skyDirection(g.spot.ra, g.spot.dec).sub(center);
    spot.set(d.dot(long) / Math.tan((g.major / 2) * DEG), d.dot(short) / Math.tan((g.minor / 2) * DEG));
  }
  const colors = COLORS[g.shape];
  const material = new ShaderMaterial({
    ...shaders.galaxy,
    uniforms: {
      shape: { value: g.shape },
      light: { value: g.light },
      opacity: { value: 1 },
      squash: { value: g.minor / g.major },
      winding: { value: g.winding ?? 2 },
      bar: { value: ((g.bar ?? g.pa) - g.pa) * DEG },
      spot: { value: spot },
      seed: { value: seed },
      coreColor: { value: colors.core },
      diskColor: { value: colors.disk },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return { mesh, material, center };
}

export function createGalaxies() {
  const group = new Group();
  const materials = [];
  const named = [];
  GALAXIES.forEach((g, i) => {
    const { mesh, material, center } = patch(g, i * 7.31 + 1.7);
    group.add(mesh);
    materials.push(material);
    if (g.name) named.push({ id: g.id, name: g.name, lightYears: g.lightYears, direction: center, distance: RADIUS });
  });
  return {
    group,
    /** The ones with names, for labels: direction from the middle of the sky. */
    named,
    /** Fades them with the stars (1 = full). */
    setFade(amount) {
      for (const m of materials) m.uniforms.opacity.value = amount;
      group.visible = amount > 0.01;
    },
  };
}
