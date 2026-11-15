// The tour (src/tour.js): where it goes, and what it says when it gets there.
import assert from "node:assert/strict";
import test from "node:test";
import { galaxyOf, VIEWS } from "../src/settings.js";
import { lightTime, placeNote, TOUR_AWAY, TOUR_HOME, tourStop } from "../src/tour.js";

test("the tour goes to the solar system and out among the galaxies in turn, and every stop is a real view", () => {
  const ids = new Set(VIEWS.map((v) => v.id));
  for (let n = 0; n < 200; n++) {
    const id = tourStop(n);
    assert.ok(ids.has(id), `stop ${n}: ${id} is a view`);
    assert.equal(Boolean(galaxyOf(id)), n % 2 === 1, `stop ${n} (${id}): home and away in turn`);
    assert.notEqual(id, tourStop(n + 1), "never the same place twice running");
  }
  // Every place on the lists comes round.
  const seen = new Set(Array.from({ length: 2 * TOUR_HOME.length * TOUR_AWAY.length }, (_, n) => tourStop(n)));
  for (const id of [...TOUR_HOME, ...TOUR_AWAY]) assert.ok(seen.has(id), `${id} comes round`);
});

test("light times read naturally", () => {
  assert.equal(lightTime(384400), "1 second");
  assert.equal(lightTime(3e6), "10 seconds");
  assert.equal(lightTime(1.8e7), "60 seconds"); // (under a minute and a half: in seconds)
  assert.equal(lightTime(3e7), "2 minutes");
  assert.equal(lightTime(149.6e6), "8 minutes");
  assert.equal(lightTime(1.35e9), "75 minutes");
  assert.equal(lightTime(4.35e9), "4 hours 2 minutes");
  assert.equal(lightTime(5.4e9), "5 hours");
});

test("on getting to a planet the tour says how far it really is right now", () => {
  const date = new Date("2026-11-15T12:00:00Z");
  const km = (id) => Number(placeNote(id, date).lines[0].match(/^([\d,]+) million km/)[1].replace(/,/g, "")) * 1e6;
  // Each planet is somewhere between its nearest and furthest from Earth.
  const ranges = { sun: [147e6, 153e6], mercury: [77e6, 222e6], venus: [38e6, 261e6], mars: [54e6, 402e6], jupiter: [588e6, 968e6], saturn: [1195e6, 1660e6], uranus: [2580e6, 3160e6], neptune: [4300e6, 4690e6], pluto: [4280e6, 7530e6] };
  for (const [id, [lo, hi]] of Object.entries(ranges)) {
    const d = km(id);
    assert.ok(d >= lo && d <= hi, `${id}: ${d} km`);
    assert.match(placeNote(id, date).lines[1], /^Its light takes \d/);
  }
  assert.match(placeNote("earth", date).lines[0], /^Home\. The Moon is (3[5-9]\d|40\d),\d{3} km away/);
  for (const id of ["middle", "system", "inner", "galaxy-m31"]) assert.equal(placeNote(id, date), null);
});
