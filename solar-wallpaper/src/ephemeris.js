// Where everything is, and which way it faces, at a given moment.
//
// The real positions come from astronomy-engine. This file turns them into
// scene coordinates and squashes the sizes and distances so it all fits on one
// screen. Squashing only changes how far things are, never the direction, so
// every line-up, conjunction and Moon phase you see is the real one.
//
// Scene axes: the plane of Earth's orbit (the ecliptic) is the floor (X/Z),
// ecliptic north is +Y, and +X points at the March equinox.
import * as A from "astronomy-engine";
import { Matrix4, Quaternion, Vector3 } from "three";
import { AU_KM, MOONS, PLANETS } from "./bodies.js";

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG; // J2000 tilt of Earth's axis to its orbit
const COS_E = Math.cos(OBLIQUITY);
const SIN_E = Math.sin(OBLIQUITY);

export const SCALE = {
  orbit: 10, // Earth's distance from the Sun, in scene units
  orbitPower: 0.5, // distance shown = orbit * AU^orbitPower
  earthRadius: 0.32,
  radiusPower: 0.6, // radius shown = earthRadius * (km / Earth's km)^radiusPower
  minRadius: 0.035,
  moonSpread: 0.9, // see moonDistance()
  sunRadius: 2.4,
};

/** J2000 equatorial (astronomy-engine's frame) to scene coordinates. */
export function eqjToScene(x, y, z, out = new Vector3()) {
  const ey = y * COS_E + z * SIN_E; // ecliptic y
  const ez = -y * SIN_E + z * COS_E; // ecliptic north
  return out.set(x, ez, -ey);
}

export const auToScene = (au) => SCALE.orbit * Math.pow(au, SCALE.orbitPower);

export function displayRadius(radiusKm) {
  return Math.max(SCALE.minRadius, SCALE.earthRadius * Math.pow(radiusKm / 6371, SCALE.radiusPower));
}

/**
 * How far from its planet a moon is drawn. Keeps every moon outside its planet
 * (and Saturn's rings) and in the right order, but squashes the big gaps: the
 * Moon is really 60 Earth radii away, which would put it off screen.
 */
export function moonDistance(distKm, parentRadiusKm, parentShown) {
  const ratio = Math.max(distKm / parentRadiusKm, 1);
  return parentShown * (1 + SCALE.moonSpread * Math.log(ratio));
}

/** Ecliptic longitude of a scene position, in radians (0 at the March equinox). */
export const sceneLongitude = (v) => Math.atan2(-v.z, v.x);

function placeHelio(vec, out) {
  eqjToScene(vec.x, vec.y, vec.z, out);
  const r = out.length();
  return r > 0 ? out.multiplyScalar(auToScene(r) / r) : out;
}

/** A planet's position in the scene. `time` is an astronomy-engine AstroTime or Date. */
export function planetPosition(planet, time, out = new Vector3()) {
  return placeHelio(A.HelioVector(A.Body[planet.body], time), out);
}

/**
 * Points along a planet's real path over its last full orbit, ending where it is
 * now. Returns positions (x,y,z per point) and the longitude of each point.
 */
export function planetOrbit(planet, time, count = 360) {
  const t = A.MakeTime(time);
  const positions = new Float32Array(count * 3);
  const longitudes = new Float32Array(count);
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    const at = t.AddDays((-planet.periodDays * (count - 1 - i)) / count);
    planetPosition(planet, at, v);
    v.toArray(positions, i * 3);
    longitudes[i] = sceneLongitude(v);
  }
  return { positions, longitudes };
}

// --- Which way each body faces --------------------------------------------------

const _P = new Vector3();
const _N = new Vector3();
const _Q = new Vector3();
const _M = new Vector3();
const _E = new Vector3();
const _m = new Matrix4();

/**
 * The rotation that lines a sphere's texture up with the real body.
 *
 * `north` is the body's north pole as a J2000 equatorial unit vector and
 * `spinDeg` is the IAU prime meridian angle W. Both come from
 * astronomy-engine's RotationAxis(). The sphere is assumed to be a three.js
 * SphereGeometry with an ordinary map: longitude 0 in the middle of the image
 * (local +X), north pole at local +Y, 90 degrees east at local -Z.
 */
export function bodyQuaternion(north, spinDeg, out = new Quaternion()) {
  _P.set(north.x, north.y, north.z).normalize();
  // W is measured along the body's equator, starting where it crosses
  // Earth's equator going north (the node, at right ascension pole + 90).
  _N.set(-_P.y, _P.x, 0).normalize();
  _Q.crossVectors(_P, _N);
  const w = spinDeg * DEG;
  _M.copy(_N).multiplyScalar(Math.cos(w)).addScaledVector(_Q, Math.sin(w)); // prime meridian
  _E.crossVectors(_P, _M); // 90 degrees east
  eqjToScene(_M.x, _M.y, _M.z, _M);
  eqjToScene(_P.x, _P.y, _P.z, _P);
  eqjToScene(_E.x, _E.y, _E.z, _E).negate();
  return out.setFromRotationMatrix(_m.makeBasis(_M, _P, _E));
}

/** North pole (scene direction) and spin angle of a planet, the Sun or the Moon. */
export function rotationAxis(bodyName, time) {
  const axis = A.RotationAxis(A.Body[bodyName], time);
  return { north: axis.north, spin: axis.spin, pole: eqjToScene(axis.north.x, axis.north.y, axis.north.z).normalize() };
}

/**
 * Turns a moon so its prime meridian faces its planet, like a tidally locked
 * moon does. `toParent` is the direction from the moon to the planet.
 */
export function lockedQuaternion(toParent, pole, out = new Quaternion()) {
  _M.copy(toParent).normalize();
  _P.copy(pole).addScaledVector(_M, -pole.dot(_M)).normalize();
  _E.crossVectors(_M, _P);
  return out.setFromRotationMatrix(_m.makeBasis(_M, _P, _E));
}

// --- Moons ------------------------------------------------------------------------

const PLANET_BY_ID = Object.fromEntries(PLANETS.map((p) => [p.id, p]));

// Moons whose planet spins backwards (Uranus) go round backwards too.
const SPIN_SENSE = { uranus: -1 };

const _u = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The plane a "circle" moon moves in, as two axes. Going from u towards v is
 * the direction of travel.
 */
function circlePlane(moon, parentPole) {
  _u.crossVectors(parentPole, UP);
  if (_u.lengthSq() < 1e-8) _u.set(1, 0, 0);
  _u.normalize();
  _n.copy(parentPole);
  if (moon.tiltDeg) {
    // Tip the orbit over about the u axis.
    const t = moon.tiltDeg * DEG;
    _v.crossVectors(_u, parentPole);
    _n.multiplyScalar(Math.cos(t)).addScaledVector(_v, Math.sin(t)).normalize();
  }
  if ((SPIN_SENSE[moon.parent] ?? 1) < 0) _n.negate();
  _v.crossVectors(_n, _u).normalize();
  return { u: _u, v: _v, normal: _n };
}

// A fixed, made-up starting angle for each circle moon, so they don't all line up.
const startAngle = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 3600, 7) / 10 * DEG;

/**
 * Where a moon is, relative to its planet, already squashed for display.
 * `axes` maps planet id to { pole, primeMeridian } in scene directions.
 * `galilean` is astronomy-engine's JupiterMoons() result for this moment
 * (optional; it's worked out here if missing).
 */
export function moonOffset(moon, time, axes, out = new Vector3(), galilean) {
  const parent = PLANET_BY_ID[moon.parent];
  const parentShown = displayRadius(parent.radiusKm);
  let distKm;
  if (moon.orbit === "moon" || moon.orbit === "galilean") {
    const v = moon.orbit === "moon" ? A.GeoMoon(time) : (galilean ?? A.JupiterMoons(time))[moon.id];
    eqjToScene(v.x, v.y, v.z, out);
    distKm = out.length() * AU_KM;
    out.normalize();
  } else if (moon.orbit === "charon") {
    out.copy(axes[moon.parent].primeMeridian);
    distKm = moon.aKm;
  } else {
    const t = A.MakeTime(time);
    const { u, v } = circlePlane(moon, axes[moon.parent].pole);
    const angle = startAngle(moon.id) + (2 * Math.PI * t.tt) / moon.periodDays;
    out.copy(u).multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
    distKm = moon.aKm;
  }
  return out.multiplyScalar(moonDistance(distKm, parent.radiusKm, parentShown));
}

/** Points along a moon's path around its planet (relative to the planet). */
export function moonOrbit(moon, time, axes, count = 96) {
  const t = A.MakeTime(time);
  const positions = new Float32Array(count * 3);
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    moonOffset(moon, t.AddDays((-moon.periodDays * (count - 1 - i)) / count), axes, v);
    v.toArray(positions, i * 3);
  }
  return positions;
}

export const moonsOf = (planetId) => MOONS.filter((m) => m.parent === planetId);

/** Pole and prime meridian (scene directions) of every planet, for moonOffset(). */
export function planetAxes(time) {
  const axes = {};
  for (const p of PLANETS) {
    const { north, spin, pole } = rotationAxis(p.body, time);
    const q = bodyQuaternion(north, spin);
    axes[p.id] = { north, spin, pole, quaternion: q, primeMeridian: new Vector3(1, 0, 0).applyQuaternion(q) };
  }
  return axes;
}
