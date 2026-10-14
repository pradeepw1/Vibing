// The background: stars and the Milky Way, turned to where the real Milky Way
// sits in the sky. The stars themselves are made up, but they crowd towards the
// galaxy's plane like real ones do.
import {
  BackSide,
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
import { clamp, random } from "./noise.js";
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

function makeStars(count, basis) {
  const rand = random(4242);
  const pos = [];
  const size = [];
  const tint = [];
  const palette = [
    [0.66, 0.75, 1.0], [0.8, 0.86, 1.0], [1.0, 1.0, 1.0], [1.0, 0.95, 0.85], [1.0, 0.85, 0.65], [1.0, 0.72, 0.52],
  ];
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    let l, b;
    if (rand() < 0.45) {
      // Crowded towards the galaxy's plane.
      l = rand() * 2 * Math.PI;
      const g = Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
      b = clamp(g * 0.2, -1.5, 1.5);
    } else {
      l = rand() * 2 * Math.PI;
      b = Math.asin(2 * rand() - 1);
    }
    v.copy(basis.center).multiplyScalar(Math.cos(b) * Math.cos(l))
      .addScaledVector(basis.east, Math.cos(b) * Math.sin(l))
      .addScaledVector(basis.north, Math.sin(b))
      .normalize()
      .multiplyScalar(900);
    pos.push(v.x, v.y, v.z);
    const bright = Math.pow(rand(), 7); // a few bright ones, lots of faint ones
    size.push(1.1 + 2.6 * bright);
    const c = palette[Math.floor(rand() * palette.length)];
    const k = 0.35 + 0.65 * Math.min(1, bright * 2 + rand() * 0.3);
    tint.push(c[0] * k, c[1] * k, c[2] * k);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("size", new Float32BufferAttribute(size, 1));
  g.setAttribute("tint", new Float32BufferAttribute(tint, 3));
  return g;
}

export function createSky(pixelRatio) {
  const group = new Group();
  const basis = galacticBasis();

  const milkyMat = new MeshBasicMaterial({ color: 0x000000, side: BackSide, depthWrite: false });
  const milky = new Mesh(new SphereGeometry(1000, 64, 32), milkyMat);
  milky.quaternion.setFromRotationMatrix(basis.matrix);
  milky.renderOrder = -2;
  group.add(milky);

  const starMat = new ShaderMaterial({
    ...shaders.stars,
    uniforms: { pixelRatio: { value: pixelRatio } },
    depthWrite: false,
    transparent: true,
  });
  const starPoints = new Points(makeStars(7000, basis), starMat);
  starPoints.renderOrder = -1;
  starPoints.frustumCulled = false;
  group.add(starPoints);

  return {
    group,
    starMat,
    /** Shows the painted Milky Way (a texture made from paintMilkyWay()'s result). */
    setMilkyWay(texture) {
      milkyMat.map = texture;
      milkyMat.color.set(0xffffff);
      milkyMat.needsUpdate = true;
    },
  };
}
