// The Mac menu's sky facts (src/facts.js, built into dist/facts.js and run in JavaScriptCore).
import assert from "node:assert/strict";
import test from "node:test";
import { moonNow, nextEclipses, skyFacts } from "../src/facts.js";

test("the Moon's phase, how much is lit, and when it's next full and new", () => {
  const full = moonNow(new Date("2026-11-24T14:54:00Z"));
  assert.equal(full.name, "Full moon");
  assert.equal(full.symbol, "moonphase.full.moon");
  assert.ok(full.lit > 0.99);
  const quarter = moonNow(new Date("2026-11-16T12:00:00Z"));
  assert.match(quarter.name, /First quarter|Waxing/);
  assert.ok(Math.abs(quarter.nextFull - Date.parse("2026-11-24T14:54:00Z")) < 3600000, new Date(quarter.nextFull).toISOString());
  assert.ok(quarter.nextNew > quarter.nextFull);
});

test("the next eclipses of the Sun and the Moon, soonest first", () => {
  const [first, second] = nextEclipses(new Date("2026-11-16T00:00:00Z"));
  assert.equal(first.title, "Ring of fire (annular) eclipse of the Sun");
  assert.equal(new Date(first.when).toISOString().slice(0, 10), "2027-02-06");
  assert.match(second.title, /eclipse of the Moon/);
  assert.equal(new Date(second.when).toISOString().slice(0, 10), "2027-02-20");
});

test("everything, as the menu reads it (plain numbers and text, no dates)", () => {
  const facts = JSON.parse(globalThis.solarFacts.skyFacts(Date.parse("2026-11-16T12:00:00Z")));
  assert.equal(typeof facts.moon.name, "string");
  assert.equal(facts.eclipses.length, 2);
  assert.ok(facts.coming.length > 0 && facts.coming.length <= 4);
  assert.ok(facts.coming.every((e) => typeof e.title === "string" && Number.isFinite(e.when) && !/eclipse/i.test(e.title)));
  assert.deepEqual(skyFacts(Date.parse("2026-11-16T12:00:00Z")), facts);
});
