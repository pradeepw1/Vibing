// Checks the planets round other stars: where the stars are, and that every planet can be drawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXOPLANET_SYSTEMS } from "../src/exoplanet-data.js";
import { blackbody, look } from "../src/exosystem.js";

const system = (id) => EXOPLANET_SYSTEMS.find((s) => s.id === id);

test("the nearest stars are where the real ones are", () => {
  const proxima = system("proxima");
  assert.ok(Math.abs(proxima.ra - 217.43) < 0.1 && Math.abs(proxima.dec + 62.68) < 0.1, "Proxima Centauri's place in the sky");
  assert.ok(Math.abs(proxima.ly - 4.25) < 0.1, `Proxima is ${proxima.ly} light-years away`);
  const trappist = system("trappist1");
  assert.ok(Math.abs(trappist.ra - 346.62) < 0.1 && Math.abs(trappist.dec + 5.04) < 0.1, "TRAPPIST-1's place in the sky");
  assert.equal(trappist.planets.length, 7);
  assert.ok(Math.abs(trappist.ly - 40.7) < 1.5);
});

test("every system is listed nearest first, with planets in order out from the star", () => {
  let last = 0;
  for (const s of EXOPLANET_SYSTEMS) {
    assert.ok(s.ly >= last, `${s.id} is out of order`);
    last = s.ly;
    assert.ok(s.planets.length > 0, s.id);
    for (let i = 1; i < s.planets.length; i++) assert.ok(s.planets[i].a >= s.planets[i - 1].a, `${s.id}: ${s.planets[i].name} is out of order`);
  }
});

test("every planet has what's needed to draw it", () => {
  for (const s of EXOPLANET_SYSTEMS) {
    assert.ok(s.name && s.about && s.star.temp > 0 && s.star.radius > 0, s.id);
    for (const p of s.planets) {
      assert.ok(p.r > 0 && p.a > 0 && p.p > 0 && p.t > 0, `${p.name}: ${JSON.stringify(p)}`);
      const lk = look(p);
      assert.ok([0, 1, 2, 3, 4].includes(lk.mode) && lk.kind, p.name);
    }
  }
});

test("a planet's look follows its size and heat", () => {
  const kinds = (size, heat) => look({ name: "test", r: size, t: heat }).kind;
  assert.match(kinds(11, 1500), /hot gas giant/);
  assert.match(kinds(11, 2600), /ultra-hot/);
  assert.match(kinds(1, 288), /seas/);
  assert.match(kinds(1, 1900), /lava/);
  assert.match(kinds(5, 300), /ice giant/);
  assert.match(kinds(1, 100), /frozen/);
});

test("star colours go from red to blue-white as they get hotter", () => {
  const [r1, , b1] = blackbody(2600);
  const [r2, , b2] = blackbody(15000);
  assert.ok(r1 > b1 * 5, "a cool star is red");
  assert.ok(b2 >= r2 * 0.8, "a hot star is blue-white");
});
