// Comets, spacecraft and meteor showers (src/visitors.js): where they are, against NASA JPL's own positions.
import assert from "node:assert/strict";
import test from "node:test";
import { COMETS, CRAFT } from "../src/visitors-data.js";
import { cometPosition, craftPosition, eclipticToScene, nextPerihelion, SHOWERS, showerStrength } from "../src/visitors.js";
import { upcomingEvents } from "../src/events.js";
import { auToScene } from "../src/ephemeris.js";

const comet = (id) => COMETS.find((c) => c.id === id);
const date = new Date("2026-11-15T00:00:00Z");

test("comets are where JPL's Horizons puts them (heliocentric, ecliptic J2000, AU)", () => {
  // From Horizons for 15 November 2026, with every planet's pull counted. Ours follows the Sun's pull alone.
  for (const [id, jpl, within] of [["encke", [1.4891, 0.6546, 0.249], 0.01], ["pons-brooks", [-2.6281, -8.6203, -1.563], 0.02], ["halley", [-19.331, 27.4736, -9.848], 0.3]]) {
    const p = cometPosition(comet(id), date);
    const off = Math.hypot(p.x - jpl[0], p.y - jpl[1], p.z - jpl[2]);
    assert.ok(off < within, `${id}: ${off.toFixed(4)} AU off`);
  }
});

test("a comet is at its nearest the Sun on its perihelion day, and comes round again a period later", () => {
  for (const c of COMETS) {
    const tp = new Date((c.tp - 2440587.5) * 86400000);
    assert.ok(Math.abs(cometPosition(c, tp).length() - c.q) < 1e-6, `${c.id} at perihelion`);
    const a = c.q / (1 - c.e);
    assert.ok(cometPosition(c, new Date(tp.getTime() + 100 * 86400000)).length() > c.q, `${c.id} further away after`);
    assert.ok(cometPosition(c, new Date(tp.getTime() - 100 * 86400000)).length() < a * (1 + c.e) + 1e-6, `${c.id} never past aphelion`);
  }
  // Encke goes round every 3.3 years: its next return after 2023's is early 2027.
  const encke = nextPerihelion(comet("encke"), new Date("2024-01-01"));
  assert.ok(encke > new Date("2027-01-01") && encke < new Date("2027-03-31"), encke.toISOString());
  // Halley's next return is in July 2061. By the Sun's pull alone (its 1968 orbit, no planets) it comes out a few
  // months later: the known cost of not following the planets' pulls over a whole 76-year lap.
  const halley = nextPerihelion(comet("halley"), date);
  assert.ok(halley > new Date("2061-01-01") && halley < new Date("2062-06-30"), halley.toISOString());
});

test("the spacecraft are as far out as they really are, and moving out", () => {
  const far = (id, d) => craftPosition(CRAFT.find((c) => c.id === id), d).length();
  // (From Horizons on 1 January 2026 they were 169.3, 141.7 and 63.6 AU out; this is ten and a half months on.)
  assert.ok(far("voyager1", date) > 171 && far("voyager1", date) < 174, `${far("voyager1", date)}`);
  assert.ok(far("voyager2", date) > 143 && far("voyager2", date) < 146, `${far("voyager2", date)}`);
  assert.ok(far("newhorizons", date) > 64 && far("newhorizons", date) < 67, `${far("newhorizons", date)}`);
  // Voyager 1 goes about 3.6 AU a year.
  const year = far("voyager1", new Date("2027-11-15")) - far("voyager1", date);
  assert.ok(year > 3.4 && year < 3.8, `${year}`);
});

test("into the scene: the same squashed distances as the planets, and the same turn", () => {
  const v = eclipticToScene({ x: 4, y: 0, z: 0 });
  assert.ok(Math.abs(v.length() - auToScene(4)) < 1e-9);
  // Ecliptic north is the scene's +Y.
  assert.ok(eclipticToScene({ x: 0, y: 0, z: 2 }).y > 0);
});

test("meteor showers at their best on the right nights, and the events say so", () => {
  const perseids = SHOWERS.find((s) => s.id === "perseids");
  assert.equal(showerStrength(perseids, 140), 1);
  assert.ok(showerStrength(perseids, 145) < 0.01, "gone a few days later");
  const august = upcomingEvents(new Date("2026-08-01T00:00:00Z"), 20);
  const peak = august.find((e) => e.title === "Perseids meteor shower at its best");
  assert.ok(peak && peak.when.toISOString().startsWith("2026-08-12"), peak?.when.toISOString());
  const december = upcomingEvents(new Date("2026-12-01T00:00:00Z"), 20);
  assert.ok(december.find((e) => e.title === "Geminids meteor shower at its best" && e.when.toISOString().startsWith("2026-12-14")));
  // And a comet's return: Encke's in early 2027.
  const early = upcomingEvents(new Date("2027-01-15T00:00:00Z"), 60);
  assert.ok(early.find((e) => e.title === "Comet Encke nearest the Sun"));
});
