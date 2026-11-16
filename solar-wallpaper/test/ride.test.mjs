// Riding a beam of light (src/ride.js): the way out past each planet, and light's true travel time.
import assert from "node:assert/strict";
import test from "node:test";
import { AU_KM, PLANETS, SUN } from "../src/bodies.js";
import { Vector3 } from "three";
import { LIGHT_KM_S, lightTimeText, rideAt, ridePlan, rideToNext } from "../src/ride.js";

const date = new Date("2026-11-15T00:00:00Z");
const plan = ridePlan(date);

test("light from the Sun takes 8 minutes 19 seconds to come 1 AU, and over 4 hours to Neptune", () => {
  assert.equal(lightTimeText(AU_KM), "8 min 19 s");
  assert.equal(lightTimeText(LIGHT_KM_S * 59), "59 s");
  assert.equal(lightTimeText(LIGHT_KM_S * 60), "1 min 0 s");
  assert.equal(lightTimeText(LIGHT_KM_S * 3600), "1 h 0 min");
  assert.equal(lightTimeText(LIGHT_KM_S * 86400 * 1.5), "1 d 12 h");
  const neptune = plan.stops.find((s) => s.id === "neptune").at.length();
  assert.match(lightTimeText(neptune), /^4 h \d+ min$/);
});

test("the way out starts at the Sun's surface and passes every planet in order, never on its night side", () => {
  assert.deepEqual(plan.stops.map((s) => s.id), PLANETS.map((p) => p.id));
  assert.ok(Math.abs(plan.start.length() / SUN.radiusKm - 1.02) < 1e-9);
  assert.deepEqual([...new Set(plan.legs.map((l) => l.stop))], PLANETS.map((p, i) => i), "a leg (or two) to each, in order");
  const legTo = (i) => plan.legs.findLast((l) => l.stop === i);
  for (const [i, s] of plan.stops.entries()) {
    const off = s.pass.distanceTo(s.at) / s.radiusKm;
    assert.ok(Math.abs(off - 5) < 1e-6, `${s.id}: passed ${off} radii off`);
    // The Sun is at the origin: the side facing it is the side towards -at.
    const toSun = s.at.clone().negate().normalize();
    assert.ok(s.pass.clone().sub(s.at).normalize().dot(toSun) > -1e-6, `${s.id} not passed on its night side`);
    assert.ok(legTo(i).to.equals(s.pass));
  }
  // Real distances: Earth's a little under or over 1 AU, Neptune's about 30.
  assert.ok(Math.abs(plan.stops[2].at.length() / AU_KM - 1) < 0.02);
  assert.ok(Math.abs(plan.stops[7].at.length() / AU_KM - 30) < 0.5);
});

test("along the way: from the start, through each pass point, to the last, with no jumps", () => {
  assert.ok(rideAt(plan, 0).at.equals(plan.start));
  assert.ok(rideAt(plan, -5).at.equals(plan.start));
  let km = 0;
  for (const [i, leg] of plan.legs.entries()) {
    if (i > 0) assert.ok(leg.from.equals(plan.legs[i - 1].to), "each leg starts where the last one ended");
    km += leg.length;
    const { at, leg: n, stop } = rideAt(plan, km - 0.01); // (just short of the end: adding the lengths up rounds a little)
    assert.equal(n, i);
    assert.equal(stop, leg.stop);
    assert.ok(at.distanceTo(leg.to) < 1, `end of leg ${i}`);
  }
  assert.ok(Math.abs(km - plan.length) < 1e-3 * plan.length);
  // How far to the next planet: all the way to it at the start, none at a pass point.
  assert.ok(Math.abs(rideToNext(plan, 0) - plan.legs.filter((l) => l.stop === 0).reduce((n, l) => n + l.length, 0)) < 1);
  assert.ok(rideToNext(plan, km / 2) <= km / 2);
  // Past the last planet, on out from the Sun.
  const last = plan.stops.at(-1).pass;
  const beyond = rideAt(plan, plan.length + 1e9);
  assert.equal(beyond.leg, plan.legs.length);
  assert.equal(beyond.stop, plan.stops.length);
  assert.ok(Math.abs(beyond.at.length() - last.length() - 1e9) < 1, "straight out");
  // A small step along never moves more than that step.
  let was = rideAt(plan, 0).at.clone();
  for (let k = 0; k <= plan.length * 1.1; k += plan.length / 2000) {
    const at = rideAt(plan, k).at;
    assert.ok(at.distanceTo(was) <= plan.length / 2000 + 1, `at ${k}`);
    was = at.clone();
  }
});

/** How near a straight piece from `a` to `b` comes to `p`. */
function nearest(a, b, p) {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

test("on any date, the way never cuts across a planet or through the Sun", () => {
  let detours = 0;
  for (let y = 2000; y <= 2060; y += 0.37) {
    const when = new Date(Date.UTC(Math.floor(y), Math.round((y % 1) * 12), 1));
    const p = ridePlan(when);
    for (const [i, leg] of p.legs.entries()) {
      for (const s of p.stops) {
        const off = nearest(leg.from, leg.to, s.at) / s.radiusKm;
        assert.ok(off > 4.9, `${when.toISOString().slice(0, 7)}, leg ${i}: within ${off.toFixed(2)} radii of ${s.id}`);
      }
      if (i > 0) {
        const sun = nearest(leg.from, leg.to, new Vector3()) / SUN.radiusKm;
        assert.ok(sun > 3, `${when.toISOString().slice(0, 7)}, leg ${i}: within ${sun.toFixed(2)} of the Sun's radius`);
      }
    }
    detours += p.legs.length - p.stops.length;
  }
  assert.ok(detours > 0, "(some dates do need to go round the Sun)");
});
