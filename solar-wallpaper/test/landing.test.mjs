// The flight home from the galaxies that ends in the solar system: the galaxies' half of it (src/localgroup.js).
// Space Scope ties the solar system's camera to this one (so many times as far from what it looks at, on the same side,
// turned the same way), so the picture is only right if this flight ends exactly where it was asked to, facing the Sun
// the right way up, and comes straight in once the solar system is in sight.
import assert from "node:assert/strict";
import test from "node:test";
import { Matrix4, Quaternion, Vector3 } from "three";

// (The scene asks how big the window is, and its mouse controls want something to listen on. Nothing is drawn here.)
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
const nothing = { addEventListener() {}, removeEventListener() {} };
const canvas = { ...nothing, style: {}, clientWidth: 1280, clientHeight: 720, getRootNode: () => nothing };
const { createLocalGroup } = await import("../src/localgroup.js");

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(0.62, 0.31, -0.72).normalize(); // which side of the Sun the view of the solar system is from
const FROM = 2.5; // the solar system comes into sight this far out (thousands of light-years)...
const END = FROM / 1500; // ...and the flight stops here

/** Flies home from where the camera is, a frame at a time. Returns what the camera did. */
function land(lg, landing = { dir: SIDE, up: UP, distance: END, settleBy: FROM }) {
  lg.flyTo("home", { landing });
  const steps = [];
  let now = 1000;
  for (let i = 0; i < 2000; i++, now += 16) {
    const t = lg.update(now, false);
    steps.push({ ms: now - 1000, position: lg.camera.position.clone(), quaternion: lg.camera.quaternion.clone() });
    if (t >= 1) break;
  }
  return steps;
}

const facing = (position, up = UP) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, new Vector3(), up));

test("the flight home lands where the solar system's view is, facing the Sun, the right way up", () => {
  const lg = createLocalGroup(canvas, 1);
  for (const galaxy of ["m31", "lmc", "m104"]) {
    lg.flyTo(galaxy, { instant: true });
    const steps = land(lg);
    const last = steps.at(-1);
    assert.equal(lg.flying, false, `${galaxy}: the flight is over`);
    assert.ok(last.ms > 2600 && last.ms <= 10016, `${galaxy}: it takes a few seconds, never more than ten (${last.ms} ms)`);
    assert.ok(Math.abs(last.position.length() / END - 1) < 1e-9, `${galaxy}: it stops as far from the Sun as asked`);
    assert.ok(last.position.clone().normalize().angleTo(SIDE) < 1e-9, `${galaxy}: on the side asked for`);
    assert.ok(last.quaternion.angleTo(facing(last.position)) < 1e-6, `${galaxy}: looking at the Sun, the solar system's way up`);
    assert.ok(steps.every((s) => [...s.position.toArray(), ...s.quaternion.toArray()].every(Number.isFinite)), `${galaxy}: every frame is somewhere`);
  }
});

test("once the solar system is in sight the way in is straight, and only ever nearer", () => {
  const lg = createLocalGroup(canvas, 1);
  for (const galaxy of ["m31", "lmc", "smc", "sgr", "m33", "sgra", "cygx1"]) {
    lg.flyTo(galaxy, { instant: true });
    const steps = land(lg);
    const inSight = steps.filter((s) => s.position.length() <= FROM);
    assert.ok(inSight.length > 60, `${galaxy}: the way down takes a good second or more (${inSight.length} frames)`);
    assert.ok(inSight.length < steps.length, `${galaxy}: and it starts out of sight`);
    let last = Infinity;
    for (const s of inSight) {
      const d = s.position.length();
      assert.ok(d <= last, `${galaxy}: never further away again`);
      // (Off to one side, the solar system would swing about on its way up the screen.)
      assert.ok(s.position.clone().normalize().angleTo(SIDE) < 1e-6, `${galaxy}: on its line at ${d}`);
      assert.ok(s.quaternion.angleTo(facing(s.position, new Vector3(0, 1, 0).applyQuaternion(s.quaternion))) < 1e-6, `${galaxy}: looking straight at the Sun at ${d}`);
      last = d;
    }
    // No lurch: from one frame to the next it never gets more than a sixth nearer.
    for (let i = 1; i < inSight.length; i++) assert.ok(inSight[i - 1].position.length() / inSight[i].position.length() < 1.2, `${galaxy}: a steady pace`);
  }
});

test("from inside the Milky Way the flight goes up and out of it first, then comes down", () => {
  const lg = createLocalGroup(canvas, 1);
  const { position: middle, up: north } = lg.places.get("milkyway");
  const off = (s, point) => (new Vector3(0, 0, -1).applyQuaternion(s.quaternion).angleTo(point.clone().sub(s.position)) * 180) / Math.PI;
  // The black hole at the middle of the galaxy, one in its disc a few thousand light-years from the Sun, and a star
  // with planets a couple of thousand light-years over the disc.
  for (const place of ["sgra", "cygx1", "psr1257"]) {
    lg.flyTo(place, { instant: true });
    const lookedAt = lg.places.get(place).position;
    const start = lg.camera.position.length();
    const steps = land(lg);
    const reach = steps.map((s) => s.position.length());
    const top = Math.max(...reach);
    const topAt = reach.indexOf(top);
    assert.ok(start > 2 && start < 40, `${place}: it starts in the galaxy, some way from the Sun (${start})`);
    assert.ok(Math.abs(top - 60) < 0.5, `${place}: out to where the whole galaxy is in view (${top})`);
    assert.ok(Math.abs(steps[topAt].position.clone().sub(middle).dot(north)) > 40, `${place}: well over the disc at the top`);
    assert.ok(steps[topAt].ms > 1200, `${place}: not in a rush (${steps[topAt].ms} ms to the top)`);
    assert.ok(steps.at(-1).ms <= 10016, `${place}: still no more than ten seconds`);
    assert.ok(Math.abs(reach.at(-1) / END - 1) < 1e-9, `${place}: and it lands where it should`);
    steps.forEach((s, i) => {
      if (i === 0) return;
      if (i > topAt) assert.ok(reach[i] <= reach[i - 1] * (1 + 1e-9), `${place}: from the top, only ever nearer (frame ${i})`);
      assert.ok(s.position.distanceTo(steps[i - 1].position) < Math.max(2, reach[i - 1] * 0.2), `${place}: no lurch (frame ${i})`);
      // Something to look at all the way: once it has turned from what it was looking at, the galaxy's middle, and
      // over the top the Sun's part of it.
      const sees = Math.min(off(s, middle), off(s, new Vector3()));
      const turning = s.ms < 1600 && lookedAt.distanceTo(middle) > 1;
      if (!turning && (reach[i] > FROM || i <= topAt)) assert.ok(sees < 30, `${place}: the galaxy in front of it (frame ${i} at ${s.ms} ms: ${sees.toFixed(1)} degrees off)`);
    });
    // (The solar system is not to come into sight on the way up, however near the Sun that passes.)
    lg.flyTo(place, { instant: true });
    lg.flyTo("home", { landing: { dir: SIDE, up: UP, distance: END, settleBy: FROM } });
    let sawTop = false;
    for (let now = 1000, t = 0; t < 1; now += 16) {
      t = lg.update(now, false);
      if (lg.camera.position.length() > 59) sawTop = true;
      if (!sawTop) assert.ok(lg.nearing < 1, `${place}: not in sight before the top`);
      if (lg.nearing >= 1) assert.ok(sawTop && lg.camera.position.length() <= FROM * (1 + 1e-9), `${place}: in sight only once it is down to where it should be`);
    }
    assert.equal(lg.nearing, 1, `${place}: and in sight at the end`);
  }
  // From another galaxy there is nothing to rise out of: only ever nearer.
  lg.flyTo("m31", { instant: true });
  lg.flyTo("home", { landing: { dir: SIDE, up: UP, distance: END, settleBy: FROM } });
  let last = Infinity;
  for (let now = 1000, t = 0; t < 1; now += 16) {
    t = lg.update(now, false);
    const d = lg.camera.position.length();
    assert.ok(d <= last * (1 + 1e-9), "from Andromeda: only ever nearer");
    assert.equal(lg.nearing >= 1, d <= FROM * (1 + 1e-9), "from Andromeda: in sight exactly when it is near enough");
    last = d;
  }
});

test("a flight home that starts on the Sun's own spot, or right by it, still lands", () => {
  const lg = createLocalGroup(canvas, 1);
  for (const start of [new Vector3(), new Vector3(0.0002, 0, 0.0001), new Vector3(0, 0.0042, 0)]) {
    lg.flyTo("m31", { instant: true });
    lg.camera.position.copy(start);
    // (Starting nearer, everything is that much smaller: see `planLanding` in main.js.)
    const from = Math.min(FROM, Math.max(start.length(), 1e-3) / 4);
    const steps = land(lg, { dir: SIDE, up: UP, distance: from / 1500, settleBy: from });
    const last = steps.at(-1);
    assert.ok(steps.every((s) => [...s.position.toArray(), ...s.quaternion.toArray()].every(Number.isFinite)), "every frame is somewhere");
    assert.ok(Math.abs(last.position.length() / (from / 1500) - 1) < 1e-9, "it stops as far from the Sun as asked");
    assert.ok(last.position.clone().normalize().angleTo(SIDE) < 1e-9, "on the side asked for");
    assert.ok(last.quaternion.angleTo(facing(last.position)) < 1e-6, "looking at the Sun");
  }
});

test("without a landing, the flight home is as it was: to the Sun's spot, looking at the middle of the Milky Way", () => {
  const lg = createLocalGroup(canvas, 1);
  lg.flyTo("m31", { instant: true });
  lg.flyTo("home");
  let now = 1000;
  let t = 0;
  for (let i = 0; i < 2000 && t < 1; i++, now += 16) t = lg.update(now, false);
  assert.ok(now - 1000 <= 5700, "no longer than before");
  assert.ok(lg.camera.position.length() < 1e-9, "at the Sun's spot");
  const centre = lg.places.get("milkyway").position;
  assert.ok(new Vector3(0, 0, -1).applyQuaternion(lg.camera.quaternion).angleTo(centre.clone().normalize()) < 1e-6, "looking at the middle of the galaxy");
});
