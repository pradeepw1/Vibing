// The Wallpaper's own parts: where the camera goes, what its settings are, and its names.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { auToScene } from "../src/ephemeris.js";
import { PLANETS } from "../src/bodies.js";
import { BLACK_HOLE_PLACES } from "../src/skyplaces.js";
import { distanceFor, PATH, pathAt, placeCamera } from "../src/wallpaper-camera.js";
import { createLabels } from "../src/wallpaper-labels.js";
import { DEFAULTS, loadSettings, parse } from "../src/wallpaper-settings.js";

const DEG = Math.PI / 180;

test("the camera goes all the way round, slowly, and never stops", () => {
  const a = pathAt(0);
  const b = pathAt(PATH.lap);
  assert.ok(Math.abs(b.azimuth - a.azimuth - 2 * Math.PI) < 1e-9, "one lap takes PATH.lap seconds");
  assert.ok(PATH.lap >= 300, "a lap takes minutes, not seconds");
  for (let t = 0; t < 4000; t += 7) {
    const p = pathAt(t);
    assert.ok(p.elevation / DEG >= PATH.elevation.low - 1e-9 && p.elevation / DEG <= PATH.elevation.high + 1e-9);
    assert.ok(p.reach >= PATH.reach.mid / PATH.reach.ratio - 1e-9 && p.reach <= PATH.reach.mid * PATH.reach.ratio + 1e-9);
  }
  // The flat edge-on view is the dullest, so it is passed through quickly, not lingered in.
  let flat = 0;
  const N = 8400;
  for (let i = 0; i < N; i++) if (Math.abs(pathAt((i / N) * PATH.bob).elevation) < 6 * DEG) flat++;
  assert.ok(flat / N < 0.06, `${((100 * flat) / N).toFixed(1)}% of the time within 6 degrees of edge-on`);
  assert.ok(pathAt(0).elevation / DEG > PATH.elevation.low && Math.min(...Array.from({ length: 200 }, (_, i) => pathAt((i / 200) * PATH.bob).elevation)) / DEG < -35, "it does go well below the plane");
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => pathAt((i / 200) * PATH.bob).elevation)) / DEG > 60, "and well above it");
  // Smooth: no jump between moments a frame apart.
  let last = pathAt(0);
  for (let t = 0.05; t < 700; t += 0.05) {
    const p = pathAt(t);
    assert.ok(Math.abs(p.azimuth - last.azimuth) < 0.002 && Math.abs(p.elevation - last.elevation) < 0.001 && Math.abs(p.reach / last.reach - 1) < 0.001, `smooth at ${t}`);
    last = p;
  }
});

test("the path takes a long time to repeat (the three moves have different lengths)", () => {
  assert.notEqual(PATH.lap, PATH.bob);
  assert.notEqual(PATH.bob, PATH.breath);
  assert.notEqual(PATH.lap, PATH.breath);
});

/** The largest distance (in screen halves) any point of a flat disc of this radius reaches from the middle of the picture. */
function discExtent(camera, reach) {
  let across = 0;
  let up = 0;
  const v = new Vector3();
  camera.updateMatrixWorld();
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * 2 * Math.PI;
    v.set(Math.cos(a) * reach, 0, Math.sin(a) * reach).project(camera);
    across = Math.max(across, Math.abs(v.x));
    up = Math.max(up, Math.abs(v.y));
  }
  return { across, up };
}

test("the whole disc of orbits fits the screen at every moment, on any screen shape, and not with room to waste", () => {
  for (const [w, h] of [[1920, 1080], [2560, 1080], [3440, 1440], [1080, 1920], [390, 844], [1024, 1024]]) {
    const camera = new PerspectiveCamera(45, w / h, 0.5, 3000);
    for (let t = 0; t < 1200; t += 37) {
      placeCamera(camera, t);
      const { reach } = pathAt(t);
      const { across, up } = discExtent(camera, reach);
      assert.ok(across <= 0.96 && up <= 0.96, `${w}x${h} at ${t}s: disc reaches ${across.toFixed(2)} across, ${up.toFixed(2)} up`);
      assert.ok(Math.max(across, up) >= 0.9, `${w}x${h} at ${t}s: the disc fills the screen (${Math.max(across, up).toFixed(2)})`);
      assert.ok(camera.position.length() > reach, "stands outside the disc it is looking at");
    }
  }
});

test("the camera always looks at the Sun", () => {
  const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
  for (let t = 0; t < 900; t += 61) {
    placeCamera(camera, t);
    camera.updateMatrixWorld();
    const sun = new Vector3(0, 0, 0).project(camera);
    assert.ok(Math.abs(sun.x) < 1e-6 && Math.abs(sun.y) < 1e-6);
  }
});

test("a thinner screen has to stand further back", () => {
  assert.ok(distanceFor(59, 45, 9 / 16, 24 * DEG) > distanceFor(59, 45, 16 / 9, 24 * DEG));
});

test("the closest framing still shows out to Neptune's orbit, and the widest shows Pluto's whole orbit", () => {
  const near = PATH.reach.mid / PATH.reach.ratio;
  const far = PATH.reach.mid * PATH.reach.ratio;
  assert.ok(near >= auToScene(30.1) - 1.5, `closest reach ${near.toFixed(1)} holds Neptune's orbit (${auToScene(30.1).toFixed(1)})`);
  assert.ok(far >= auToScene(39.5) - 1, `widest reach ${far.toFixed(1)} holds Pluto's average distance (${auToScene(39.5).toFixed(1)})`);
});

test("the Wallpaper's settings: only the ones it has", () => {
  assert.equal(DEFAULTS.fps, 20);
  assert.equal(parse("speed", "day"), "day");
  assert.equal(parse("fps", "30"), 30);
  assert.equal(parse("labels", "0"), false);
  for (const key of ["view", "strange", "reverse", "paused", "from", "mode", "nonsense"]) assert.equal(parse(key, "1"), undefined, `${key} is not a Wallpaper setting`);
  const s = loadSettings("?speed=hour&labels=0&fps=10&view=mars");
  assert.equal(s.speed, "hour");
  assert.equal(s.labels, false);
  assert.equal(s.fps, 10);
  assert.equal(s.view, undefined, "a view can't be picked");
  assert.equal(loadSettings("").ui, true);
  assert.equal(loadSettings("?wallpaper").ui, false);
  assert.equal(loadSettings("?wallpaper").fps, 20, "the Wallpaper is already easy on battery: no change to the speed");
  assert.equal(loadSettings("").drift, true);
  assert.equal(loadSettings("", true).drift, false, "someone who asked for less motion starts with the camera still");
  assert.equal(loadSettings("?speed=banana").speed, "live");
});

// --- Names ---
function fakeDocument() {
  const made = [];
  const element = () => {
    const el = { className: "", textContent: "", style: {}, children: [], listeners: [], append(...c) { this.children.push(...c); }, addEventListener(type) { this.listeners.push(type); } };
    made.push(el);
    return el;
  };
  return { made, createElement: element };
}

test("the names: Sun, nine planets, galaxies and black holes, none of them clickable", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const bodies = [{ kind: "sun", def: { name: "Sun" }, radius: 2.4, group: { position: new Vector3(0, 0, 0), scale: { x: 1 } } }];
    PLANETS.forEach((p, i) => bodies.push({ kind: "planet", def: { name: p.name }, radius: 0.5, group: { position: new Vector3(10 * (i + 1), 0, 4 * i), scale: { x: 1 } } }));
    bodies.push({ kind: "moon", def: { name: "Moon" }, radius: 0.1, group: { position: new Vector3(10.5, 0, 12), scale: { x: 1 } } });
    const galaxies = [{ name: "Andromeda Galaxy", lightYears: "2.5 million light-years", direction: new Vector3(0, 0, -1), distance: 950 }];
    const box = { children: [], append(...c) { this.children.push(...c); } };
    const labels = createLabels({ box, bodies, places: [...galaxies, ...BLACK_HOLE_PLACES] });
    const texts = box.children.map((el) => el.children.length ? el.children[0].textContent : el.textContent);
    assert.equal(box.children.length, 1 + PLANETS.length + 1 + BLACK_HOLE_PLACES.length, "no label for the moon");
    for (const name of ["Sun", ...PLANETS.map((p) => p.name), "Andromeda Galaxy", "Sagittarius A*", "Cygnus X-1", "M87*"]) assert.ok(texts.includes(name), `${name} is named`);
    assert.ok(!texts.includes("Moon"));
    assert.equal(box.children.filter((el) => el.className.includes("hole")).length, BLACK_HOLE_PLACES.length, "black holes get the ring marker");
    assert.ok(doc.made.every((el) => el.listeners.length === 0), "nothing has a click (or any other) listener");
    // And they are put on screen.
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
    camera.position.set(0, 60, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    labels.update(camera, 1920, 1080);
    const sunLabel = box.children.find((el) => el.textContent === "Sun");
    assert.equal(sunLabel.style.opacity, "1");
    assert.match(sunLabel.style.transform, /^translate\(\d+px, \d+px\)$/);
  } finally {
    delete globalThis.document;
  }
});
