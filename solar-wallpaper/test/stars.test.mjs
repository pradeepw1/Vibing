// The real stars and constellations (src/stars.js, packed by tools/make-stars.mjs): in their true places, as bright and
// as coloured as they are.
import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { constellationLines, realStars, skyNames, starColour, starLook } from "../src/stars.js";
import { skyDirection } from "../src/galaxies.js";

const stars = realStars();
const near = (s, ra, dec) => Math.abs(((s.ra - ra + 540) % 360) - 180) < 0.05 && Math.abs(s.dec - dec) < 0.05;
const DEG = 180 / Math.PI;

test("every star to magnitude 6, and nothing that isn't", () => {
  assert.ok(stars.length > 5000 && stars.length < 5100, `${stars.length}`);
  for (const s of stars) {
    assert.ok(s.ra >= 0 && s.ra <= 360 && s.dec >= -90 && s.dec <= 90, JSON.stringify(s));
    assert.ok(s.mag >= -1.5 && s.mag <= 6.01, JSON.stringify(s));
  }
});

test("the brightest stars are where they are, as bright as they are, and their colour", () => {
  // Sirius, Canopus, Vega, Betelgeuse and Rigel (J2000 positions, Hipparcos magnitudes and colours).
  const known = [
    ["Sirius", 101.287, -16.716, -1.44, 0.009],
    ["Canopus", 95.988, -52.696, -0.62, 0.164],
    ["Vega", 279.234, 38.784, 0.03, -0.001],
    ["Betelgeuse", 88.793, 7.407, 0.45, 1.5],
    ["Rigel", 78.634, -8.202, 0.18, -0.03],
  ];
  for (const [name, ra, dec, mag, bv] of known) {
    const s = stars.find((x) => near(x, ra, dec));
    assert.ok(s, `${name} is there`);
    assert.ok(Math.abs(s.mag - mag) < 0.02, `${name}'s magnitude: ${s.mag}`);
    assert.ok(Math.abs(s.bv - bv) < 0.1, `${name}'s colour: ${s.bv}`);
  }
  assert.equal(Math.min(...stars.map((s) => s.mag)), -1.44, "Sirius is the brightest");
});

test("in the scene, the pole star is at the sky's north pole, 23.4 degrees from the ecliptic's", () => {
  // The scene's floor is the ecliptic, +Y its north. The Earth's axis leans 23.44 degrees from that.
  const polaris = stars.find((s) => near(s, 37.95, 89.264));
  assert.ok(polaris, "Polaris is there");
  const angle = skyDirection(polaris.ra, polaris.dec).angleTo(new Vector3(0, 1, 0)) * DEG;
  assert.ok(Math.abs(angle - 23.44) < 1, `${angle}`);
});

test("brighter stars are drawn bigger and brighter, and their colours run from blue to red", () => {
  let last = { size: Infinity, bright: Infinity };
  for (const mag of [-1.44, 0, 1, 2, 3, 4, 5, 6]) {
    const look = starLook(mag);
    assert.ok(look.size <= last.size && look.bright <= last.bright, `magnitude ${mag}`);
    assert.ok(look.size >= 1 && look.size <= 4 && look.bright > 0.25 && look.bright <= 1, JSON.stringify(look));
    last = look;
  }
  const [r1, , b1] = starColour(-0.3); // a hot blue star
  const [r2, , b2] = starColour(1.8); // a cool red one
  assert.ok(b1 > r1 && r2 > b2, "blue is blue and red is red");
  assert.ok(starColour(NaN).every((c) => c > 0.5), "a star whose colour wasn't measured is nearly white");
});

test("the constellations: all 88, with lines between real stars", () => {
  const names = skyNames().filter((n) => !n.star);
  // (Serpens comes in two halves, each with its own name: Serpens Caput and Serpens Cauda.)
  assert.equal(new Set(names.map((n) => n.id)).size, 88);
  assert.equal(names.length, 89);
  for (const want of ["Orion", "Ursa Major", "Crux", "Cassiopeia", "Scorpius"]) assert.ok(names.some((n) => n.name === want), want);
  const lines = constellationLines();
  assert.ok(lines.length > 700, `${lines.length} lines`);
  // Nearly every end of a line is on a star (a few run to stars fainter than magnitude 6).
  const onStar = lines.flatMap(([r1, d1, r2, d2]) => [[r1, d1], [r2, d2]]).filter(([r, d]) => stars.some((s) => near(s, r, d)));
  assert.ok(onStar.length / (lines.length * 2) > 0.95, `${onStar.length} of ${lines.length * 2}`);
  // Orion's belt: three stars in a short straight line.
  const belt = [[83.002, -0.299], [84.053, -1.202], [85.19, -1.943]].map(([r, d]) => skyDirection(r, d));
  const across = belt[0].angleTo(belt[2]) * DEG;
  assert.ok(across > 2.5 && across < 3, `${across}`);
  assert.ok(belt[1].distanceTo(belt[0].clone().add(belt[2]).normalize()) < 0.01, "the middle one is in the middle");
});

test("the brightest stars have their names", () => {
  const named = skyNames().filter((n) => n.star).map((n) => n.name);
  for (const want of ["Sirius", "Vega", "Betelgeuse", "Rigel", "Arcturus"]) assert.ok(named.includes(want), want);
  assert.ok(named.length >= 20 && named.length <= 30, `${named.length}`);
});
