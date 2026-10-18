import assert from "node:assert/strict";
import test from "node:test";
import { BLACK_HOLES } from "../src/blackholes.js";
import { dimensionOf, palette } from "../src/elsewhere.js";
import { EXOPLANET_SYSTEMS } from "../src/exoplanet-data.js";
import { GALAXIES } from "../src/galaxies.js";
import { GATE } from "../src/gate.js";
import { galaxyOf, VIEWS } from "../src/settings.js";

test("the Gate is in the menu, and says it is made up", () => {
  const view = VIEWS.find((v) => v.galaxy === GATE.id);
  assert.ok(view, "has a view");
  assert.equal(galaxyOf(view.id), GATE.id);
  assert.ok(view.fiction);
  assert.match(view.label, /made up/i);
  assert.match(GATE.sub, /made up/i);
});

test("its name isn't used by anything real", () => {
  const taken = new Set([...GALAXIES.map((g) => g.id), ...BLACK_HOLES.map((h) => h.id), ...EXOPLANET_SYSTEMS.map((s) => s.id), "milkyway", "sun"]);
  assert.ok(!taken.has(GATE.id));
});

test("it sits where the Wow! signal came from (Sagittarius), at a made-up distance", () => {
  assert.ok(GATE.ra > 285 && GATE.ra < 295, "right ascension");
  assert.ok(GATE.dec > -30 && GATE.dec < -24, "declination");
  assert.ok(GATE.kly > 0 && GATE.kly < 10);
  assert.match(GATE.about, /made-up/);
});

test("every place beyond is the same every time, and quite unlike its neighbours", () => {
  for (let k = 0; k < 40; k++) {
    const a = dimensionOf(k);
    assert.deepEqual(a, dimensionOf(k), `place ${k} changes between calls`);
    assert.ok(a.hue >= 0 && a.hue < 1);
    assert.ok([5, 6, 7, 8, 10, 12].includes(a.sides));
    assert.equal(a.mix.length, 4);
    assert.ok(a.mix.every((v) => v >= 0 && v <= 1.01));
    assert.ok(a.glow > 0.4 && a.glow < 1.2);
    const next = dimensionOf(k + 1);
    const dh = Math.abs(a.hue - next.hue);
    assert.ok(Math.min(dh, 1 - dh) > 0.2, `places ${k} and ${k + 1} have colours too alike`);
  }
});

test("the kinds of place come round in order: rush, lattice, turning", () => {
  for (let k = 0; k < 12; k++) {
    const d = dimensionOf(k);
    if (k % 3 === 1) assert.ok(d.mix[1] > d.mix[0], `${k} should lean on the grid`);
    else assert.ok(d.mix[0] > d.mix[1], `${k} should lean on streaks`);
    assert.equal(d.twist !== 0, k % 3 === 2, `${k} turns only if it's the third kind`);
  }
});

test("the doorway palette stays in range", () => {
  for (let i = 0; i < 20; i++) for (const c of palette(i / 20, i / 7)) assert.ok(c >= 0 && c <= 1);
});
