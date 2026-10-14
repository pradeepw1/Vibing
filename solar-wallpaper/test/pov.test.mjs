// Checks the sky as seen from a planet against real events, at the sizes it's drawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as A from "astronomy-engine";
import { Vector3 } from "three";
import { AU_KM, MOONS, PLANETS, SUN } from "../src/bodies.js";
import { planetAxes, realPositions } from "../src/ephemeris.js";
import { coveredFraction, shownAngle, skyLayout, sunlight } from "../src/pov.js";

const deg = (rad) => (rad * 180) / Math.PI;
const ORIGIN = new Vector3();

// The sky as the app draws it from `id`: real positions as seen from there
// (light-time for Jupiter's moons), then the layout.
function skyFrom(id, date) {
  const real = realPositions(date, planetAxes(date), undefined, new Map(), id);
  return { real, sky: skyLayout(id, real, ORIGIN) };
}
const dir = (e) => e.position.clone().normalize();
const gap = (a, b) => deg(dir(a).angleTo(dir(b)));
const overlap = (a, b) => gap(a, b) < deg(a.angle + b.angle);

const RADIUS_KM = new Map([[SUN.id, SUN.radiusKm], ...PLANETS.map((p) => [p.id, p.radiusKm]), ...MOONS.map((m) => [m.id, m.radiusKm])]);
const PARENT = new Map(MOONS.map((m) => [m.id, m.parent]));
const family = (id) => PARENT.get(id) ?? id;

/**
 * Pairs drawn overlapping from `id` whose real discs don't touch as seen from
 * anywhere on `id`. (Moons of one far planet are spread out from it as a
 * group, so they're left out.)
 */
function fakeContacts(id, date) {
  const { real, sky } = skyFrom(id, date);
  const o = real.get(id);
  const ids = [...sky.keys()];
  const fakes = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]];
      if (PARENT.has(a) && PARENT.has(b) && family(a) === family(b) && family(a) !== family(id)) continue;
      if (!overlap(sky.get(a), sky.get(b))) continue;
      const ra = real.get(a).clone().sub(o);
      const rb = real.get(b).clone().sub(o);
      const angle = (km, v) => Math.asin(Math.min(1, km / (v.length() * AU_KM)));
      const touch = angle(RADIUS_KM.get(a), ra) + angle(RADIUS_KM.get(b), rb);
      const parallax = Math.max(angle(RADIUS_KM.get(id), ra), angle(RADIUS_KM.get(id), rb));
      if (ra.angleTo(rb) - parallax >= touch) fakes.push(`${a}/${b}`);
    }
  return fakes;
}

const ECLIPSE = new Date("2027-08-02T10:06:35Z"); // total solar eclipse, greatest eclipse

test("total solar eclipse of 2027-08-02: from Earth the Moon sits right over the Sun", () => {
  const { sky } = skyFrom("earth", ECLIPSE);
  const sun = sky.get("sun");
  const moon = sky.get("moon");
  assert.ok(gap(sun, moon) < 0.25, `gap ${gap(sun, moon)}`);
  assert.ok(moon.angle >= sun.angle, "the Moon is big enough to cover it");
  assert.ok(moon.position.length() < sun.position.length(), "the Moon is in front");
});

test("no false eclipses: at the other new moons of 2027 the discs don't touch", () => {
  const eclipses = [];
  for (let e = A.SearchGlobalSolarEclipse(new Date("2027-01-01T00:00:00Z")); e.peak.date < new Date("2028-01-01T00:00:00Z"); e = A.NextGlobalSolarEclipse(e.peak))
    eclipses.push(e.peak.date.getTime());
  let newMoon = A.SearchMoonPhase(0, new Date("2027-01-01T00:00:00Z"), 40);
  let checked = 0;
  while (newMoon.date < new Date("2028-01-01T00:00:00Z")) {
    const t = newMoon.date;
    const isEclipse = eclipses.some((p) => Math.abs(p - t.getTime()) < 86400e3);
    const { sky } = skyFrom("earth", t);
    assert.equal(overlap(sky.get("sun"), sky.get("moon")), isEclipse, t.toISOString());
    checked++;
    newMoon = A.SearchMoonPhase(0, new Date(t.getTime() + 20 * 86400e3), 40);
  }
  assert.ok(checked >= 12);
});

test("from Earth, discs only ever touch when the real ones do (every 6 hours through 2026)", () => {
  const found = [];
  for (let h = 0; h < 365 * 24; h += 6) {
    const date = new Date(Date.UTC(2026, 0, 1) + h * 3600e3);
    for (const pair of fakeContacts("earth", date)) found.push(`${pair} ${date.toISOString()}`);
  }
  assert.deepEqual(found, []);
});

test("from Jupiter's moons, with Jupiter filling the sky, it's nearly always right too", () => {
  for (const id of ["io", "europa"]) {
    let wrong = 0;
    let samples = 0;
    for (let h = 0; h < 90 * 24; h += 3) {
      if (fakeContacts(id, new Date(Date.UTC(2026, 3, 1) + h * 3600e3)).length) wrong++;
      samples++;
    }
    assert.ok(wrong / samples < 0.04, `${id}: something wrongly touching ${((100 * wrong) / samples).toFixed(1)}% of the time`);
  }
});

test("dates that once went wrong", () => {
  const cases = [
    // [from, date, a, b, should the discs overlap?]
    ["earth", "2029-01-14T20:30:00Z", "sun", "mercury", false], // Mercury 4.4 degrees from the Sun
    ["earth", "2035-09-02T08:30:00Z", "sun", "venus", false], // Venus 6.6 degrees from the Sun
    ["earth", "2026-07-31T18:00:00Z", "sun", "ganymede", false], // Jupiter's moons near the Sun
    ["earth", "2026-11-03T03:00:00Z", "moon", "callisto", false],
    ["earth", "2026-06-17T19:00:00Z", "moon", "venus", true], // the Moon really covers Venus, seen from the north Pacific
    ["earth", "2026-09-08T18:00:00Z", "moon", "jupiter", true], // and Jupiter, seen from the Arctic
    ["io", "2026-10-14T12:10:00Z", "jupiter", "europa", false], // Europa 18.5 degrees from Jupiter's centre, which is 9.5 across
  ];
  for (const [from, iso, a, b, expected] of cases) {
    const { sky } = skyFrom(from, new Date(iso));
    assert.equal(overlap(sky.get(a), sky.get(b)), expected, `${a}/${b} from ${from} at ${iso}`);
  }
});

test("nothing jumps: every body glides from one second to the next", () => {
  // The Moon passing Jupiter and its moons from Earth, a busy bit of sky.
  const start = Date.UTC(2026, 9, 6, 6);
  let before = null;
  let worst = { step: 0 };
  for (let s = 0; s <= 6 * 3600; s += 5) {
    const date = new Date(start + s * 1000);
    const { sky } = skyFrom("earth", date);
    if (before)
      for (const [id, e] of sky) {
        const step = deg(dir(e).angleTo(before.get(id)));
        if (step > worst.step) worst = { step, id, at: date.toISOString() };
      }
    before = new Map([...sky].map(([id, e]) => [id, dir(e)]));
  }
  assert.ok(worst.step < 0.03, `${worst.id} moved ${worst.step.toFixed(3)} degrees in 5 seconds at ${worst.at}`);
});

test("a lunar eclipse darkens the Moon; a normal full moon doesn't", () => {
  const ecl = A.SearchLunarEclipse(new Date("2026-01-01T00:00:00Z"));
  const at = (date) => {
    const real = realPositions(date, planetAxes(date));
    return sunlight(real.get("moon"), real.get("earth"), 6371);
  };
  if (ecl.kind === "total") assert.ok(at(ecl.peak.date) < 0.01, `${ecl.kind} ${at(ecl.peak.date)}`);
  else assert.ok(at(ecl.peak.date) < 0.6, `${ecl.kind} ${at(ecl.peak.date)}`);
  const ordinary = A.SearchMoonPhase(180, new Date(ecl.peak.date.getTime() + 20 * 86400e3), 40).date;
  assert.equal(at(ordinary), 1);
});

test("Io goes into Jupiter's shadow every orbit", () => {
  let dark = 0;
  for (let h = 0; h < 48; h++) {
    const t = new Date(Date.UTC(2026, 9, 14, h));
    const real = realPositions(t, planetAxes(t));
    if (sunlight(real.get("io"), real.get("jupiter"), 69911) < 0.5) dark++;
  }
  assert.ok(dark >= 2 && dark <= 6, `dark for ${dark} of 48 hours`); // about 2.3 hours per 42.5 hour orbit
});

test("Mars goes backwards across Earth's sky at its 2027 opposition", () => {
  const opposition = new Date("2027-02-19T15:44:00Z");
  const { sky } = skyFrom("earth", opposition);
  assert.ok(Math.abs(gap(sky.get("mars"), sky.get("sun")) - 175.5) < 0.2);
  const lon = (date) => {
    const p = dir(skyFrom("earth", date).sky.get("mars"));
    return deg(Math.atan2(-p.z, p.x));
  };
  assert.ok(lon(new Date("2027-02-20T15:44:00Z")) < lon(new Date("2027-02-18T15:44:00Z")), "longitude shrinking = backwards");
  assert.ok(lon(new Date("2027-06-11T00:00:00Z")) > lon(new Date("2027-06-01T00:00:00Z")), "and forwards again later");
});

test("phases seen from Earth match astronomy-engine", () => {
  for (const [id, body] of [["venus", A.Body.Venus], ["moon", A.Body.Moon], ["mars", A.Body.Mars]]) {
    const date = new Date("2026-10-20T00:00:00Z");
    const { real } = skyFrom("earth", date);
    const toSun = real.get(id).clone().negate().normalize();
    const toEarth = real.get("earth").clone().sub(real.get(id)).normalize();
    const fraction = (1 + toSun.dot(toEarth)) / 2;
    assert.ok(Math.abs(fraction - A.Illumination(body, date).phase_fraction) < 2e-3, id);
  }
});

test("from Earth, Jupiter's moons cross its disc when they really do (light-time included)", () => {
  // Io starts across Jupiter (a transit) at about 16:05 UTC on 2027-02-20, as seen from Earth.
  const before = skyFrom("earth", new Date("2027-02-20T15:45:00Z")).sky;
  assert.ok(!overlap(before.get("jupiter"), before.get("io")), "not yet at 15:45");
  const { sky } = skyFrom("earth", new Date("2027-02-20T16:30:00Z"));
  const jupiter = sky.get("jupiter");
  const io = sky.get("io");
  assert.ok(overlap(jupiter, io), "on the disc by 16:30");
  assert.ok(io.position.length() + io.radius < jupiter.position.length() - jupiter.radius, "and drawn in front of it");
  // Most of the time most of them are clear of it.
  const later = skyFrom("earth", new Date("2026-10-14T00:00:00Z")).sky;
  const clear = ["io", "europa", "ganymede", "callisto"].filter((id) => !overlap(later.get("jupiter"), later.get(id)));
  assert.ok(clear.length >= 3, `only ${clear} clear`);
});

test("from Jupiter's moons, Jupiter covers the Sun exactly when the moon is in its shadow", () => {
  for (const id of ["io", "europa", "callisto"]) {
    let mismatches = 0;
    for (let h = 0; h < 24 * 20; h += 2) {
      const t = new Date(Date.UTC(2026, 9, 1) + h * 3600e3);
      const { real, sky } = skyFrom(id, t);
      const dark = sunlight(real.get(id), real.get("jupiter"), 69911) < 1;
      if (overlap(sky.get("sun"), sky.get("jupiter")) !== dark) mismatches++;
    }
    assert.ok(mismatches <= 1, `${id}: ${mismatches} mismatches`); // allow one sample right on the edge
  }
});

test("Phobos isn't pinned onto the Sun", () => {
  let onSun = 0;
  const samples = 240;
  for (let i = 0; i < samples; i++) {
    const t = new Date(Date.UTC(2026, 9, 14) + i * 600e3); // every 10 minutes for 40 hours
    const { sky } = skyFrom("mars", t);
    if (overlap(sky.get("sun"), sky.get("phobos"))) onSun++;
  }
  assert.ok(onSun / samples < 0.03, `on the Sun ${((100 * onSun) / samples).toFixed(1)}% of the time`);
});

test("from the Moon, Earth looks clearly wider than the Sun (really 3.6 times)", () => {
  const { sky } = skyFrom("moon", new Date("2026-10-14T00:00:00Z"));
  const ratio = sky.get("earth").angle / sky.get("sun").angle;
  assert.ok(ratio > 1.5 && ratio < 3.6, `ratio ${ratio}`);
});

test("discs grow with their real size, and big ones aren't blown up", () => {
  const deg = Math.PI / 180;
  let last = 0;
  for (let r = 0.0001; r < 40; r *= 1.05) {
    const shown = shownAngle(r * deg);
    assert.ok(shown > last && shown >= r * deg, `at ${r} degrees`);
    last = shown;
  }
  assert.equal(shownAngle(9.5 * deg), 9.5 * deg); // Jupiter from Io
});

test("nearer things are drawn in front of farther ones", () => {
  const { sky } = skyFrom("mars", new Date("2026-10-14T00:00:00Z"));
  const byAu = [...sky.values()].sort((a, b) => a.distanceAu - b.distanceAu);
  for (let i = 1; i < byAu.length; i++) {
    const [a, b] = [byAu[i - 1], byAu[i]];
    if (overlap(a, b)) assert.ok(b.position.length() > a.position.length());
  }
});

test("covered fraction of a disc", () => {
  assert.equal(coveredFraction(1, 1, 3), 0);
  assert.equal(coveredFraction(1, 2, 0.5), 1);
  assert.ok(Math.abs(coveredFraction(1, 0.5, 0) - 0.25) < 1e-12);
  assert.ok(Math.abs(coveredFraction(1, 1, 1) - 0.391) < 1e-3); // two unit circles, centres 1 apart
});
