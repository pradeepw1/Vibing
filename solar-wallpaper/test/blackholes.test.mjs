// Checks that the black holes sit where the real ones do.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BLACK_HOLES } from "../src/blackholes.js";
import { skyDirection } from "../src/galaxies.js";
import { galacticBasis } from "../src/sky.js";

const deg = (rad) => (rad * 180) / Math.PI;

// Galactic longitude and latitude of a scene direction.
function galactic(v) {
  const { center, east, north } = galacticBasis();
  return { l: (deg(Math.atan2(v.dot(east), v.dot(center))) + 360) % 360, b: deg(Math.asin(v.dot(north))) };
}
const hole = (id) => BLACK_HOLES.find((h) => h.id === id);

test("Sagittarius A* is at the middle of the Milky Way", () => {
  const { l, b } = galactic(skyDirection(hole("sgra").ra, hole("sgra").dec));
  assert.ok(Math.min(l, 360 - l) < 0.1 && Math.abs(b) < 0.1, JSON.stringify({ l, b }));
});

test("Cygnus X-1 is at galactic longitude 71.3, latitude +3.1", () => {
  const { l, b } = galactic(skyDirection(hole("cygx1").ra, hole("cygx1").dec));
  assert.ok(Math.abs(l - 71.33) < 0.1 && Math.abs(b - 3.07) < 0.1, JSON.stringify({ l, b }));
});

test("M87* is near the north pole of the Milky Way, in Virgo", () => {
  const { l, b } = galactic(skyDirection(hole("m87bh").ra, hole("m87bh").dec));
  assert.ok(Math.abs(l - 283.78) < 0.1 && Math.abs(b - 74.49) < 0.1, JSON.stringify({ l, b }));
});

test("every black hole has what the picture needs", () => {
  for (const h of BLACK_HOLES) {
    assert.ok(h.name && h.lightYears && h.about, h.id);
    assert.ok(h.rs > 0 && h.kly > 0, h.id);
    assert.ok(h.disc.inner >= 3 && h.disc.outer > h.disc.inner, `${h.id}: the disc can't start inside the innermost stable orbit (3 radii)`);
    assert.ok(h.spin === 1 || h.spin === -1, h.id);
  }
});
