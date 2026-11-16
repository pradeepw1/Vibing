// What's on in the sky (src/events.js): checked against eclipses and oppositions whose dates are well known.
import assert from "node:assert/strict";
import test from "node:test";
import { tonight, upcomingEvents, whenText } from "../src/events.js";

const at = (iso) => new Date(`${iso}T00:00:00Z`);
const find = (list, title, day) => list.find((e) => e.title === title && e.when.toISOString().startsWith(day));

test("eclipses on the days they really happen", () => {
  const summer = upcomingEvents(at("2026-07-25"), 60);
  assert.ok(find(summer, "Total solar eclipse", "2026-08-12"), "the total solar eclipse over Iceland and Spain, 12 August 2026");
  assert.ok(find(summer, "Partial lunar eclipse", "2026-08-28"), "the partial lunar eclipse, 28 August 2026");
  assert.ok(!find(summer, "Full Moon", "2026-08-28"), "(that night's full moon is the eclipse, not a second event)");
  const spring = upcomingEvents(at("2026-02-20"), 30);
  assert.ok(find(spring, "Total lunar eclipse", "2026-03-03"), "the total lunar eclipse, 3 March 2026");
  assert.match(find(spring, "Total lunar eclipse", "2026-03-03").about, /turns red, for 5\d minutes/);
  const next = upcomingEvents(at("2027-01-25"), 30);
  assert.ok(find(next, "Annular solar eclipse", "2027-02-06"), "the annular eclipse of 6 February 2027");
});

test("planets opposite the Sun when they really are, with their distance", () => {
  const list = upcomingEvents(at("2026-09-20"), 30);
  assert.ok(find(list, "Saturn opposite the Sun", "2026-10-04"));
  const feb = upcomingEvents(at("2027-02-01"), 30);
  assert.ok(find(feb, "Jupiter opposite the Sun", "2027-02-11"));
  const mars = find(feb, "Mars opposite the Sun", "2027-02-19");
  assert.ok(mars, "Mars, 19 February 2027");
  assert.match(mars.about, /\b(9\d|10\d) million km away/, "about 100 million km: a far opposition");
  assert.equal(mars.view, "mars", "to see it: look at Mars");
});

test("Venus at its furthest from the Sun, and in which sky", () => {
  const e = find(upcomingEvents(at("2026-12-20"), 30), "Venus furthest from the Sun", "2027-01-03");
  assert.ok(e);
  assert.match(e.about, /^4[5-8]° from it/);
  assert.match(e.about, /morning sky/);
});

test("planets close together are found, and only when they really are", () => {
  // Venus and Jupiter passed within about 1.6 degrees of each other on 9 June 2026.
  const june = upcomingEvents(at("2026-05-25"), 30);
  const pair = june.find((e) => e.title === "Venus and Jupiter close together");
  assert.ok(pair, "Venus and Jupiter in June 2026");
  assert.ok(Math.abs(pair.when - new Date("2026-06-09T12:00:00Z")) < 2 * 86400000, pair.when.toISOString());
  for (const e of june.filter((x) => x.kind === "pair")) assert.match(e.about, /apart|Moon's width/);
});

test("the list is soonest first, inside the window, and each thing once", () => {
  const from = at("2026-11-15");
  const list = upcomingEvents(from, 90);
  assert.ok(list.length >= 5);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].when >= list[i - 1].when);
  for (const e of list) assert.ok(e.when >= from && e.when <= new Date(from.getTime() + 90 * 86400000));
  assert.equal(new Set(list.map((e) => e.id)).size, list.length);
  for (const e of list) assert.ok(e.title && e.about && e.view, JSON.stringify(e));
});

test("tonight: the eclipse on the night of one, and nothing on a quiet night", () => {
  assert.equal(tonight(new Date("2026-08-12T12:00:00Z"))?.title, "Total solar eclipse");
  assert.equal(tonight(new Date("2026-03-03T06:00:00Z"))?.title, "Total lunar eclipse");
  assert.equal(tonight(new Date("2026-11-08T12:00:00Z")), null);
});

test("dates read naturally, with the year only when it isn't this one", () => {
  const now = new Date("2026-11-15T12:00:00");
  assert.ok(!whenText(new Date("2026-11-24T08:54:00"), now).includes("2026"));
  assert.ok(whenText(new Date("2027-02-19T08:54:00"), now).includes("2027"));
});
