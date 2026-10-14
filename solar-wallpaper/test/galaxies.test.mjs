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
