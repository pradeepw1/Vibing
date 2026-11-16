// Moons' shadows on their planets (src/shadows.js): the Moon's on Earth where eclipses of the Sun really fall.
import assert from "node:assert/strict";
import test from "node:test";
import * as A from "astronomy-engine";
import { eqjToScene } from "../src/ephemeris.js";
import { homeUp } from "../src/home.js";
import { moonShadow } from "../src/shadows.js";

const DEG = 180 / Math.PI;
const helio = (body, t) => {
  const v = A.HelioVector(body, t);
  return eqjToScene(v.x, v.y, v.z);
};
const moonOnEarth = (t) => moonShadow(helio(A.Body.Earth, t), helio(A.Body.Moon, t), 6371, 1737.4);

test("the Moon's shadow is where astronomy-engine says each eclipse is greatest, full or a ring", () => {
  for (const [from, total] of [["2026-08-01", true], ["2027-01-25", false], ["2027-07-25", true]]) {
    const e = A.SearchGlobalSolarEclipse(new Date(from));
    const shadow = moonOnEarth(e.peak.date);
    assert.ok(shadow, `${e.kind} eclipse of ${e.peak.date.toISOString().slice(0, 10)}: a shadow on Earth`);
    const off = shadow.dir.angleTo(homeUp(e.peak.date, { lat: e.latitude, lon: e.longitude })) * DEG;
    assert.ok(off < 1, `its middle ${off.toFixed(2)} degrees from where the eclipse is greatest`);
    assert.equal(shadow.umbra > 0, total, `${e.kind}: ${total ? "a full shadow" : "a ring of fire, no full shadow"}`);
    assert.ok(shadow.penumbra * 6371 > 3000 && shadow.penumbra * 6371 < 3800, "the part shadow is about 7,000 km across");
  }
});

test("no shadow on Earth when there's no eclipse, and none at a full moon", () => {
  assert.equal(moonOnEarth(new Date("2026-08-01T12:00:00Z")), null);
  assert.equal(moonOnEarth(new Date("2026-11-24T14:54:00Z")), null);
});

test("Io's shadow crosses Jupiter every day and three quarters, a small dark spot", () => {
  let found = null;
  for (let h = 0; h < 48 && !found; h += 0.25) {
    const t = new Date(Date.UTC(2026, 10, 15) + h * 3600000);
    const jup = helio(A.Body.Jupiter, t);
    const io = A.JupiterMoons(t).io; // (from Jupiter, J2000 equatorial, AU)
    const ioPos = jup.clone().add(eqjToScene(io.x, io.y, io.z));
    found = moonShadow(jup, ioPos, 69911, 1821.6);
  }
  assert.ok(found, "within two days");
  assert.ok(found.umbra > 0 && found.umbra < found.penumbra && found.penumbra < 0.06, JSON.stringify({ u: found.umbra, p: found.penumbra }));
});
