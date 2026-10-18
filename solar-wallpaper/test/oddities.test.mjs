import assert from "node:assert/strict";
import test from "node:test";
import { Group, Line3, PerspectiveCamera, Vector3 } from "three";
import { createStage } from "../src/oddities/stage.js";
import { SIGHTINGS as UFOS } from "../src/oddities/ufo.js";
import { SIGHTINGS as SHIPS } from "../src/oddities/ships.js";
import { SIGHTINGS as PHENOMENA } from "../src/oddities/phenomena.js";

const ALL = [...UFOS, ...SHIPS, ...PHENOMENA];

/** Numbers that repeat the same way every time. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function fakeScene() {
  const added = new Set();
  return { add: (o) => added.add(o), remove: (o) => added.delete(o), added };
}

function fakeSighting(id, seconds = 10) {
  const group = new Group();
  const log = { starts: [], t: 0 };
  return {
    id,
    name: id,
    about: "",
    group,
    angle: 20,
    seconds,
    log,
    start(ctx) {
      log.starts.push({ anchor: ctx.anchor.clone(), scale: ctx.scale });
      log.t = 0;
      group.visible = true;
    },
    update(dt) {
      log.t += dt;
      if (log.t >= seconds) {
        group.visible = false;
        return false;
      }
      return true;
    },
    dispose() {},
  };
}

function cameraAt(x, y, z, look = [0, 0, 0]) {
  const c = new PerspectiveCamera(45, 16 / 9, 0.01, 3000);
  c.position.set(x, y, z);
  c.lookAt(...look);
  c.updateMatrixWorld();
  return c;
}

const open = (spheres = []) => ({ allowed: true, up: null, spheres });

test("every sighting follows the contract and has its own id", () => {
  const ids = new Set();
  for (const make of ALL) {
    const s = make(1);
    assert.equal(typeof s.id, "string");
    assert.ok(!ids.has(s.id), `id ${s.id} is used twice`);
    ids.add(s.id);
    assert.ok(s.name && s.about, `${s.id} needs a name and a note`);
    assert.ok(s.group instanceof Group);
    assert.ok(s.angle > 0 && s.angle < 90, `${s.id} angle`);
    assert.ok(s.seconds > 20, `${s.id} seconds`);
    for (const fn of ["start", "update", "dispose"]) assert.equal(typeof s[fn], "function", `${s.id}.${fn}`);
    s.dispose();
  }
  assert.equal(ids.size, 13);
});

test("only the Voyager probes are real", () => {
  const real = ALL.map((m) => m(1)).filter((s) => s.real);
  assert.deepEqual(real.map((s) => s.id).sort(), ["voyager1", "voyager2"]);
});

for (const [name, camera] of [
  ["a wide window", () => cameraAt(0, 20, 60)],
  ["a phone held upright", () => Object.assign(cameraAt(0, 20, 60), { aspect: 9 / 16 })],
]) {
  test(`every sighting plays to the end and hides itself (${name})`, () => {
    for (const make of ALL) {
      const cam = camera();
      cam.updateProjectionMatrix();
      const s = make(1);
      const group = s.group;
      const anchor = new Vector3(0, 10, 0);
      const scale = 2 * 100 * Math.tan((s.angle * Math.PI) / 360);
      group.position.copy(anchor);
      group.scale.setScalar(scale);
      group.updateMatrixWorld(true);
      const ctx = { camera: cam, random: seeded(3), anchor: group.position, scale };
      s.start(ctx);
      assert.ok(group.visible, `${s.id} shows on start`);
      let alive = true;
      let t = 0;
      for (; t < s.seconds + 30 && alive; t += 0.1) {
        alive = s.update(0.1, ctx);
        const p = group.position;
        assert.ok(Number.isFinite(p.x + p.y + p.z), `${s.id} position at ${t.toFixed(1)}s`);
      }
      assert.ok(!alive, `${s.id} still running after ${t.toFixed(0)}s`);
      assert.ok(!group.visible, `${s.id} hides when done`);
      assert.equal(s.update(0.1, ctx), false, `${s.id} stays finished`);
      s.dispose();
    }
  });
}

test("the stage puts a sighting in front of the camera, at the size it asked for", () => {
  const scene = fakeScene();
  const sighting = fakeSighting("a");
  const stage = createStage({ scene, builders: [() => sighting], pixelRatio: 1, random: seeded() });
  const camera = cameraAt(0, 0, 50);
  assert.ok(stage.showOne());
  stage.update(0.1, camera, open());
  assert.ok(stage.running);
  assert.ok(scene.added.has(sighting.group));
  const { anchor, scale } = sighting.log.starts[0];
  const toIt = anchor.clone().sub(camera.position);
  const ahead = camera.getWorldDirection(new Vector3());
  const angleOff = (toIt.angleTo(ahead) * 180) / Math.PI;
  assert.ok(angleOff < 16, `off the middle by ${angleOff.toFixed(1)} degrees`);
  assert.ok(toIt.length() >= 1, "not on top of the camera");
  const covers = 2 * Math.atan(scale / 2 / toIt.length()) * (180 / Math.PI);
  assert.ok(Math.abs(covers - sighting.angle) < 1, `covers ${covers.toFixed(1)} degrees`);
});

test("the stage stays clear of planets in the way", () => {
  for (let seed = 1; seed < 40; seed++) {
    const scene = fakeScene();
    const sighting = fakeSighting("a");
    const stage = createStage({ scene, builders: [() => sighting], pixelRatio: 1, random: seeded(seed) });
    const camera = cameraAt(0, 0, 100);
    const planet = { center: new Vector3(0, 0, 40), radius: 8 };
    stage.showOne();
    stage.update(0.1, camera, open([planet]));
    if (!stage.running) continue;
    const { anchor } = sighting.log.starts[0];
    assert.ok(anchor.distanceTo(planet.center) > planet.radius, `inside the planet (seed ${seed})`);
    // And the planet isn't between the camera and it.
    const line = new Line3(camera.position, anchor);
    assert.ok(line.closestPointToPoint(planet.center, true, new Vector3()).distanceTo(planet.center) > planet.radius, `hidden by the planet (seed ${seed})`);
  }
});

test("it will not start from inside a planet's keep-clear zone", () => {
  const stage = createStage({ scene: fakeScene(), builders: [() => fakeSighting("a")], pixelRatio: 1, random: seeded() });
  const camera = cameraAt(0, 0, 10);
  stage.showOne();
  stage.update(0.1, camera, open([{ center: new Vector3(0, 0, 0), radius: 9 }]));
  assert.ok(!stage.running);
});

test("on the ground it waits for a look at the sky, unless asked", () => {
  // A small world under the camera, which hangs just above the surface.
  const ground = { allowed: true, up: new Vector3(0, 1, 0), spheres: [{ center: new Vector3(0, -100, 0), radius: 100, clear: 1.03 }] };
  const at = (rise) => cameraAt(0, 0.5, 0, [10, 10 * Math.tan((rise * Math.PI) / 180) + 0.5, 0]);
  const make = (id, seed = 5) => createStage({ scene: fakeScene(), builders: [() => fakeSighting(id)], pixelRatio: 1, random: seeded(seed) });

  // By itself: not while the view is on the ground, yes once it is up in the sky.
  const stage = make("a");
  stage.update(1000, at(-12), ground);
  assert.ok(!stage.running, "waits while the view is on the ground");
  stage.update(3, at(12), ground); // it tries again a couple of seconds after a miss
  assert.ok(stage.running, "starts once they look up");

  // Asked for, with the view a little below the horizon: tipped up, so it clears the ground.
  const asked = make("b");
  asked.showOne();
  asked.update(0.1, at(-6), ground);
  assert.ok(asked.running, "tipped up over the ground");
  const { anchor } = asked.current.log.starts[0];
  assert.ok(anchor.y > 0.5 - 0.1, "above the camera's own height");

  // Asked for while staring at the ground: it waits for a better view, then goes.
  const low = make("c", 9);
  low.showOne();
  low.update(0.1, at(-40), ground);
  assert.ok(!low.running);
  low.update(0.1, at(2), ground);
  assert.ok(low.running);
});

test("the first one comes after a wait, then they come now and then", () => {
  const sighting = fakeSighting("a", 5);
  const stage = createStage({ scene: fakeScene(), builders: [() => sighting], pixelRatio: 1, random: seeded(5) });
  const camera = cameraAt(0, 0, 50);
  stage.update(30, camera, open());
  assert.ok(!stage.running, "not in the first half minute");
  let started = 0;
  for (let t = 30; t < 3600 * 2; t += 1) {
    const before = stage.running;
    stage.update(1, camera, open());
    if (!before && stage.running) started++;
  }
  assert.ok(started >= 8 && started <= 40, `${started} in two hours`);
});

test("switched off, none come by themselves; the button still works", () => {
  const stage = createStage({ scene: fakeScene(), builders: [() => fakeSighting("a")], pixelRatio: 1, random: seeded() });
  stage.enabled = false;
  const camera = cameraAt(0, 0, 50);
  for (let t = 0; t < 7200; t += 1) stage.update(1, camera, open());
  assert.ok(!stage.running);
  stage.showOne();
  stage.update(0.1, camera, open());
  assert.ok(stage.running);
});

test("switching off, or leaving the view, ends one that is showing", () => {
  const ended = [];
  const sighting = fakeSighting("a");
  const stage = createStage({ scene: fakeScene(), builders: [() => sighting], pixelRatio: 1, random: seeded() });
  stage.onEnd = (s) => ended.push(s.id);
  const camera = cameraAt(0, 0, 50);
  stage.showOne();
  stage.update(0.1, camera, open());
  assert.ok(stage.running);
  stage.update(0.1, camera, { ...open(), allowed: false });
  assert.ok(!stage.running);
  assert.ok(!sighting.group.visible);
  assert.deepEqual(ended, [], "no note for one cut short");
  stage.showOne();
  stage.update(0.1, camera, open());
  stage.enabled = false;
  assert.ok(!stage.running);
});

test("a finished sighting leaves a note, and every one gets a turn before any repeats", () => {
  const ids = ["a", "b", "c", "d"];
  const sightings = ids.map((id) => fakeSighting(id, 3));
  const stage = createStage({ scene: fakeScene(), builders: sightings.map((s) => () => s), pixelRatio: 1, random: seeded(11) });
  const seen = [];
  stage.onEnd = (s) => seen.push(s.id);
  const camera = cameraAt(0, 0, 50);
  for (let i = 0; i < 8; i++) {
    stage.showOne();
    for (let t = 0; t < 10; t += 0.5) stage.update(0.5, camera, open());
  }
  assert.equal(seen.length, 8);
  assert.deepEqual([...seen.slice(0, 4)].sort(), ids);
  assert.deepEqual([...seen.slice(4)].sort(), ids);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
});

test("one can be asked for by name", () => {
  const sightings = ["a", "b", "c"].map((id) => fakeSighting(id));
  const stage = createStage({ scene: fakeScene(), builders: sightings.map((s) => () => s), pixelRatio: 1, random: seeded() });
  stage.showOne("c");
  stage.update(0.1, cameraAt(0, 0, 50), open());
  assert.equal(stage.current.id, "c");
});
