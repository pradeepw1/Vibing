// "Your sky" (src/home.js): over the right place, the right way up, at the right time of day.
import assert from "node:assert/strict";
import test from "node:test";
import * as A from "astronomy-engine";
import { eqjToScene } from "../src/ephemeris.js";
import { homeFacing, homeNote, homePlace, homeUp, parsePlace } from "../src/home.js";

const DEG = 180 / Math.PI;
const chicago = homePlace(null, "America/Chicago");

/** The Sun's direction from Earth, as the scene has it. */
const sunDir = (date) => {
  const v = A.GeoVector(A.Body.Sun, date, true);
  return eqjToScene(v.x, v.y, v.z).normalize();
};
/** How high the Sun is, by astronomy-engine, without the air's bending. */
const sunAltitude = (date, home) => {
  const o = new A.Observer(home.lat, home.lon, 0);
  const e = A.Equator(A.Body.Sun, date, o, true, true);
  return A.Horizon(date, o, e.ra, e.dec, null).altitude;
};

test("with nothing set, it is over the time zone's city", () => {
  assert.deepEqual([chicago.lat, chicago.lon, chicago.name, chicago.guessed], [41.85, -87.65, "Chicago", true]);
  const sydney = homePlace(null, "Australia/Sydney");
  assert.equal(sydney.name, "Sydney");
  assert.ok(sydney.lat < -33 && sydney.lat > -34);
  assert.equal(homePlace(null, "Nowhere/Made_Up").name, "Greenwich", "a zone it doesn't know still gives somewhere");
  assert.deepEqual(homePlace([32.78, -96.8, "Dallas"], "America/Chicago"), { lat: 32.78, lon: -96.8, name: "Dallas", guessed: false });
});

test("places are read as latitude, longitude (and a name if given), and nonsense isn't", () => {
  assert.deepEqual(parsePlace("41.85, -87.65"), [41.85, -87.65]);
  assert.deepEqual(parsePlace(" -33.87 ,151.21, Sydney "), [-33.87, 151.21, "Sydney"]);
  for (const bad of ["", "Chicago", "95, 10", "10, 200", "1"]) assert.equal(parsePlace(bad), undefined, bad);
});

test("straight up over Chicago puts the Sun as high as it really is, through the day", () => {
  for (const iso of ["2026-11-15T18:00:00Z", "2026-11-16T06:00:00Z", "2026-06-21T17:50:00Z", "2026-03-20T12:30:00Z"]) {
    const date = new Date(iso);
    const fromUp = 90 - homeUp(date, chicago).angleTo(sunDir(date)) * DEG;
    const real = sunAltitude(date, chicago);
    assert.ok(Math.abs(fromUp - real) < 0.3, `${iso}: ${fromUp.toFixed(2)} against ${real.toFixed(2)}`);
  }
  assert.ok(sunAltitude(new Date("2026-11-15T18:00:00Z"), chicago) > 25, "(a November noon there: the Sun well up)");
  assert.ok(sunAltitude(new Date("2026-11-16T06:00:00Z"), chicago) < -45, "(midnight: far below)");
});

test("it faces the equator: at noon the Sun is ahead, south in the north and north in the south", () => {
  for (const [home, iso] of [[chicago, "2026-11-15T18:00:00Z"], [homePlace(null, "Australia/Sydney"), "2026-11-15T02:00:00Z"]]) {
    const date = new Date(iso);
    const up = homeUp(date, home);
    const facing = homeFacing(up, home);
    assert.ok(Math.abs(facing.dot(up)) < 1e-9, "level");
    const sun = sunDir(date);
    const level = sun.clone().addScaledVector(up, -sun.dot(up)).normalize();
    assert.ok(level.angleTo(facing) * DEG < 20, `${home.name}: the Sun is ${Math.round(level.angleTo(facing) * DEG)} degrees off ahead`);
  }
});

test("the note says how high the Sun is, when it rises and sets, and the Moon", () => {
  const note = homeNote(new Date("2026-11-15T18:00:00Z"), chicago);
  assert.equal(note.title, "Your sky over Chicago (from your time zone)");
  assert.match(note.lines[0], /^The Sun is \d+° up\. Sunrise .+, sunset .+\.$/);
  assert.match(note.lines[1], /^The Moon is \d+% lit, (growing|shrinking)\.$/);
  assert.match(homeNote(new Date("2026-11-16T06:00:00Z"), chicago).lines[0], /^Night\./);
});
