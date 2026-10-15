// Checks that the nearest galaxies sit where they really are in the sky.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as A from "astronomy-engine";
import { GALAXIES, skyDirection } from "../src/galaxies.js";

const deg = (rad) => (rad * 180) / Math.PI;

// Ecliptic longitude and latitude of a scene direction (the scene's floor is the ecliptic, +Y its north).
const ecliptic = (v) => ({ lon: (deg(Math.atan2(-v.z, v.x)) + 360) % 360, lat: deg(Math.asin(v.y)) });

test("each galaxy's direction matches astronomy-engine's J2000 equator-to-ecliptic turn", () => {
  const turn = A.Rotation_EQJ_ECL();
  for (const g of GALAXIES) {
    const ra = (g.ra * Math.PI) / 180;
    const dec = (g.dec * Math.PI) / 180;
    const eqj = new A.Vector(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), new A.AstroTime(0));
    const ecl = A.RotateVector(turn, eqj);
    const want = { lon: (deg(Math.atan2(ecl.y, ecl.x)) + 360) % 360, lat: deg(Math.asin(ecl.z)) };
    const got = ecliptic(skyDirection(g.ra, g.dec));
    assert.ok(Math.abs(got.lat - want.lat) < 1e-3, `${g.id} latitude`); // a few arcseconds
    assert.ok(Math.abs(((got.lon - want.lon + 540) % 360) - 180) < 1e-3, `${g.id} longitude`);
  }
});

test("Andromeda is in the northern autumn sky, the Large Magellanic Cloud near the south ecliptic pole", () => {
  const m31 = ecliptic(skyDirection(...radec("m31")));
  assert.ok(Math.abs(m31.lon - 27.85) < 0.2 && Math.abs(m31.lat - 33.35) < 0.2, JSON.stringify(m31));
  const lmc = ecliptic(skyDirection(...radec("lmc")));
  assert.ok(lmc.lat < -84, JSON.stringify(lmc));
  // Andromeda and Triangulum are about 15 degrees apart.
  const apart = deg(skyDirection(...radec("m31")).angleTo(skyDirection(...radec("m33"))));
  assert.ok(Math.abs(apart - 14.8) < 0.5, `${apart}`);
});

test("every named galaxy says how far away it is", () => {
  for (const g of GALAXIES.filter((x) => x.name)) assert.match(g.lightYears, /light-years$/);
});

function radec(id) {
  const g = GALAXIES.find((x) => x.id === id);
  return [g.ra, g.dec];
}

// --- Out among the galaxies ---
import { Matrix4, Vector3 } from "three";
import { KLY, SHAPES, skyAxes, tiltFrame } from "../src/localgroup.js";

/** The disc's frame for a galaxy, and its centre (kly from the Sun). */
function disc(id) {
  const g = GALAXIES.find((x) => x.id === id);
  const s = SHAPES[id];
  const dir = skyDirection(g.ra, g.dec);
  return { g, s, dir, frame: tiltFrame(dir, s.tilt.nodes, s.tilt), centre: dir.clone().multiplyScalar(KLY[id]) };
}

test("each tilted disc has its known near side towards us, and looks as tilted as it is", () => {
  for (const id of ["m31", "m33", "lmc"]) {
    const { s, dir, frame, centre } = disc(id);
    const { north, east } = skyAxes(dir);
    const near = north.clone().multiplyScalar(Math.cos((s.tilt.near * Math.PI) / 180)).addScaledVector(east, Math.sin((s.tilt.near * Math.PI) / 180));
    const ax = new Matrix4().extractRotation(frame);
    const x = new Vector3().setFromMatrixColumn(ax, 0);
    const n = new Vector3().setFromMatrixColumn(ax, 1);
    const z = new Vector3().setFromMatrixColumn(ax, 2);
    // The disc point that shows up on the near side of the sky is closer to us than the centre.
    const across = new Vector3().crossVectors(n, x).normalize();
    const point = across.dot(near) > 0 ? across : across.negate();
    assert.ok(point.dot(dir) < 0, `${id}: near side is nearer`);
    // Tilted by its inclination from face-on.
    const tilt = (Math.acos(Math.abs(n.dot(dir))) * 180) / Math.PI;
    assert.ok(Math.abs(tilt - s.tilt.inclination) < 0.01, `${id} tilt ${tilt}`);
    assert.ok(Math.abs(x.dot(z)) < 1e-9 && Math.abs(centre.length() - KLY[id]) < 1e-9);
  }
});

test("Andromeda's arms turn clockwise on our sky going outwards, Triangulum's anticlockwise", () => {
  const turn = (id) => {
    const { s, dir, frame, centre } = disc(id);
    const { north, east } = skyAxes(dir);
    const k = Math.tan((s.pitch * Math.PI) / 180);
    const pa = (r) => {
      const th = (-s.winding * Math.log(r / s.arms[0].r0)) / k;
      const p = new Vector3(r * Math.cos(th), 0, r * Math.sin(th)).applyMatrix4(frame).add(centre).normalize().sub(dir);
      return Math.atan2(p.dot(east), p.dot(north));
    };
    return pa(20.3) - pa(20); // position angle grows anticlockwise as we see the sky
  };
  assert.ok(turn("m31") < 0, "Andromeda clockwise");
  assert.ok(turn("m33") > 0, "Triangulum anticlockwise");
});
