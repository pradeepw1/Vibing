// The Wallpaper's own parts: where the camera goes, what its settings are, and its names.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { auToScene, planetPosition } from "../src/ephemeris.js";
import { PLANETS } from "../src/bodies.js";
import * as A from "astronomy-engine";
import { BLACK_HOLE_PLACES } from "../src/skyplaces.js";
import { distanceFor, PATH, pathAt, placeCamera } from "../src/wallpaper-camera.js";
import { createLabels } from "../src/wallpaper-labels.js";
import { DEFAULTS, loadSettings, parse, save } from "../src/wallpaper-settings.js";

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

test("all nine planets are in the picture at every moment, wherever Pluto is on its orbit", () => {
  // Pluto's orbit is long and lopsided: 30 to 49 AU. Four dates: now, and out to its farthest (about 2114).
  for (const date of ["2026-10-21", "2060-01-01", "2113-07-01", "2200-01-01"]) {
    const time = A.MakeTime(new Date(date));
    const positions = PLANETS.map((p) => planetPosition(p, time, new Vector3()));
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1080, 1920], [390, 844]]) {
      const camera = new PerspectiveCamera(45, w / h, 0.5, 3000);
      for (let t = 0; t < 1700; t += 53) {
        placeCamera(camera, t, PATH, positions);
        camera.updateMatrixWorld();
        for (const [i, v] of positions.entries()) {
          const ndc = v.clone().project(camera);
          assert.ok(Math.abs(ndc.x) <= 0.97 && Math.abs(ndc.y) <= 0.97, `${date} ${w}x${h} at ${t}s: ${PLANETS[i].id} is off the screen (${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`);
        }
      }
    }
  }
});

test("the path alone, with no planets to fit, shows out to Neptune's orbit at its closest and Pluto's farthest at its widest", () => {
  const near = PATH.reach.mid / PATH.reach.ratio;
  const far = PATH.reach.mid * PATH.reach.ratio;
  assert.ok(near >= auToScene(30.33) - 0.5, `closest reach ${near.toFixed(1)} holds Neptune's farthest (${auToScene(30.33).toFixed(1)})`);
  assert.ok(far >= auToScene(49.3), `widest reach ${far.toFixed(1)} holds Pluto's farthest (${auToScene(49.3).toFixed(1)})`);
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

test("only what the person changed is remembered, and a damaged store doesn't stop the page", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    // One-off values from the address are never written by someone else's change.
    save({ labels: false });
    assert.deepEqual(JSON.parse([...store.values()][0]), { labels: false });
    save({ speed: "day", view: "mars", nonsense: 1 }); // (only the Wallpaper's own settings are kept)
    assert.deepEqual(JSON.parse([...store.values()][0]), { labels: false, speed: "day" });
    assert.equal(loadSettings("").labels, false);
    assert.equal(loadSettings("").speed, "day");
    assert.equal(loadSettings("?labels=1").labels, true, "the address wins over what was saved");
    assert.equal(loadSettings("", true).drift, false);
    save({ labels: true });
    assert.equal(JSON.parse([...store.values()][0]).drift, undefined, "the 'camera still' default for reduced motion was never saved");
    for (const damaged of ["null", "5", "true", "[1,2]", '"text"', "{", "{\"__proto__\":{\"x\":1}}"]) {
      store.set([...store.keys()][0], damaged);
      assert.doesNotThrow(() => loadSettings(""), damaged);
      assert.equal(loadSettings("").fps, 20, damaged);
    }
  } finally {
    delete globalThis.localStorage;
  }
});

// --- Names ---
function fakeDocument() {
  const made = [];
  const element = () => {
    const el = {
      className: "", textContent: "", style: {}, children: [], listeners: [],
      classList: { toggle() {} },
      append(...c) { this.children.push(...c); },
      addEventListener(type) { this.listeners.push(type); },
    };
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

test("a name is moved to another side when its first choice runs off the screen, and holes are named before galaxies", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const sun = { kind: "sun", def: { name: "Sun" }, radius: 2.4, group: { position: new Vector3(0, 0, 0), scale: { x: 1 } } };
    // Neptune ends up near the right-hand edge of the screen; Pluto near the left.
    const mk = (name, x) => ({ kind: "planet", def: { name }, radius: 0.5, group: { position: new Vector3(x, 0, 0), scale: { x: 1 } } });
    const neptune = mk("Neptune", 40);
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const edge = neptune.group.position.clone().project(camera); // where it lands
    assert.ok(edge.x > 0.5, "Neptune is to the right");
    // Push it so its name can't fit on the right.
    neptune.group.position.x = 69.5; // about 1900 px of 1920
    const there = new Vector3(0.35, 0.2, -1).normalize(); // beside the Sun, not behind it
    const m87 = { name: "Messier 87", lightYears: "53 million light-years", direction: there.clone(), distance: 950 };
    const hole = { name: "M87*", lightYears: "53.5 million light-years", direction: there.clone(), distance: 950, hole: true };
    const box = { children: [], append(...c) { this.children.push(...c); } };
    const labels = createLabels({ box, bodies: [sun, neptune], places: [m87, hole] });
    labels.update(camera, 1920, 1080);
    const byText = (text) => box.children.find((el) => (el.children.length ? el.children[0].textContent : el.textContent) === text);
    const neptuneLabel = byText("Neptune");
    assert.equal(neptuneLabel.style.opacity, "1", "Neptune is still named");
    const x = Number(/translate\((-?\d+)px/.exec(neptuneLabel.style.transform)[1]);
    assert.ok(x + 60 <= 1920 - 8, `the whole name is on the screen (starts at ${x})`);
    // Both names at the same spot on the sky: the black hole first, the galaxy on the other side.
    assert.equal(byText("M87*").style.opacity, "1", "the black hole is named");
    assert.equal(byText("Messier 87").style.opacity, "1", "and the galaxy beside it");
    assert.notEqual(byText("M87*").style.transform, byText("Messier 87").style.transform);
  } finally {
    delete globalThis.document;
  }
});

test("names keep off the clock", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    // A galaxy straight ahead lands in the middle of the screen. Put the clock box over the middle.
    const place = { name: "Andromeda Galaxy", lightYears: "2.5 million light-years", direction: new Vector3(0, 0, -1), distance: 950 };
    const box = { children: [], append(...c) { this.children.push(...c); } };
    const labels = createLabels({ box, bodies: [], places: [place], avoid: () => [{ x: 900, y: 500, w: 300, h: 100 }] });
    labels.update(camera, 1920, 1080);
    assert.equal(box.children[0].style.opacity, "0", "kept off the clock's box");
    const clear = { children: [], append(...c) { this.children.push(...c); } };
    const elsewhere = createLabels({ box: clear, bodies: [], places: [place], avoid: () => [{ x: 0, y: 900, w: 300, h: 100 }] });
    elsewhere.update(camera, 1920, 1080);
    assert.equal(clear.children[0].style.opacity, "1", "and shown when the clock is elsewhere");
  } finally {
    delete globalThis.document;
  }
});
