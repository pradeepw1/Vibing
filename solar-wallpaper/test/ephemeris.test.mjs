// Checks the scene geometry against things that really happened in the sky.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as A from "astronomy-engine";
import { SphereGeometry, Vector3 } from "three";
import { MOONS, PLANETS } from "../src/bodies.js";
import {
  bodyQuaternion,
  moonOffset,
  planetAxes,
  planetOrbit,
  planetPosition,
  rotationAxis,
  sceneLongitude,
} from "../src/ephemeris.js";

const planet = (id) => PLANETS.find((p) => p.id === id);
const deg = (rad) => (rad * 180) / Math.PI;
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

test("at the March equinox, Earth is at longitude 180 (the Sun at 0)", () => {
  const equinox = A.Seasons(2026).mar_equinox;
  const earth = planetPosition(planet("earth"), equinox);
  // The scene uses the year-2000 equinox. The real one has since drifted
  // (precession, 50 arcseconds a year), about 0.36 degrees by 2026.
  const lon = deg(sceneLongitude(earth));
  assert.ok(Math.abs(wrap(lon - 180 + 0.36)) < 0.05, `lon ${lon}`);
  assert.ok(Math.abs(earth.y) < 0.01, "Earth sits on the ecliptic floor");
});

test("Mars opposition on 2025-01-16: Earth and Mars line up", () => {
  const t = new Date("2025-01-16T03:00:00Z");
  const earth = sceneLongitude(planetPosition(planet("earth"), t));
  const mars = sceneLongitude(planetPosition(planet("mars"), t));
  assert.ok(Math.abs(wrap(deg(mars - earth))) < 0.5);
});

test("planets go round counterclockwise seen from above", () => {
  const a = planetPosition(planet("earth"), new Date("2026-01-01T00:00:00Z"));
  const b = planetPosition(planet("earth"), new Date("2026-01-11T00:00:00Z"));
  assert.ok(wrap(deg(sceneLongitude(b) - sceneLongitude(a))) > 9);
  // Seen from +Y looking down, with +X right, longitude grows toward -Z (up the screen).
  assert.ok(new Vector3().crossVectors(a, b).y > 0);
});

test("the orbit line ends exactly at the planet", () => {
  const t = new Date("2026-10-14T00:00:00Z");
  const { positions } = planetOrbit(planet("mars"), t, 120);
  const last = new Vector3().fromArray(positions, (120 - 1) * 3);
  const now = planetPosition(planet("mars"), t);
  assert.ok(last.distanceTo(now) < 0.2);
});

test("three.js spheres put texture longitude 0 at +X and 90 east at -Z", () => {
  const g = new SphereGeometry(1, 8, 4);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(uv.getY(i) - 0.5) > 1e-6) continue; // equator only
    const u = uv.getX(i);
    if (Math.abs(u - 0.5) < 1e-6) assert.ok(pos.getX(i) > 0.99);
    if (Math.abs(u - 0.75) < 1e-6) assert.ok(pos.getZ(i) < -0.99);
  }
});

// Where on Earth the Sun is straight overhead, in degrees.
function subsolarPoint(date) {
  const earth = planetPosition(planet("earth"), date);
  const { north, spin } = rotationAxis("Earth", date);
  const q = bodyQuaternion(north, spin).invert();
  const toSun = earth.clone().negate().normalize().applyQuaternion(q);
  return { lat: deg(Math.asin(toSun.y)), lon: deg(Math.atan2(-toSun.z, toSun.x)) };
}

test("the Sun is over Greenwich around noon UTC at the equinox", () => {
  const p = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
  assert.ok(Math.abs(p.lat) < 0.6, `lat ${p.lat}`);
  // The Sun runs about 7 minutes late in March, so it's still ~1.8 degrees east.
  assert.ok(Math.abs(p.lon - 1.8) < 1, `lon ${p.lon}`);
});

test("the Sun is over the Tropic of Cancer at the June solstice", () => {
  const p = subsolarPoint(A.Seasons(2026).jun_solstice.date);
  assert.ok(Math.abs(p.lat - 23.44) < 0.1, `lat ${p.lat}`);
});

test("the Sun is over the Pacific at midnight UTC", () => {
  const p = subsolarPoint(new Date("2026-09-23T00:00:00Z"));
  assert.ok(Math.abs(Math.abs(p.lon) - 180) < 3, `lon ${p.lon}`);
});

test("at full moon the Moon is on the far side of Earth from the Sun", () => {
  const full = A.SearchMoonPhase(180, new Date("2026-10-01T00:00:00Z"), 40).date;
  const earth = planetPosition(planet("earth"), full);
  const axes = planetAxes(full);
  const moon = moonOffset(MOONS.find((m) => m.id === "moon"), full, axes);
  const toSun = earth.clone().negate();
  assert.ok(deg(moon.angleTo(toSun)) > 170);
});

test("moons stay outside their planet, in the right order", () => {
  const t = new Date("2026-10-14T00:00:00Z");
  const axes = planetAxes(t);
  for (const p of PLANETS) {
    const moons = MOONS.filter((m) => m.parent === p.id);
    const dist = moons.map((m) => moonOffset(m, t, axes).length());
    for (let i = 1; i < dist.length; i++) assert.ok(dist[i] > dist[i - 1] * 0.9, `${moons[i].id} after ${moons[i - 1].id}`);
  }
});

test("Charon hangs over Pluto's prime meridian", () => {
  const t = new Date("2026-10-14T00:00:00Z");
  const axes = planetAxes(t);
  const charon = moonOffset(MOONS.find((m) => m.id === "charon"), t, axes);
  assert.ok(deg(charon.angleTo(axes.pluto.primeMeridian)) < 1e-6);
});
