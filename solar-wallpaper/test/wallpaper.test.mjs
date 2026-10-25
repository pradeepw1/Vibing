// The Wallpaper's own parts: where the camera goes, what its settings are, and its names.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { auToScene, planetPosition } from "../src/ephemeris.js";
import { PLANETS } from "../src/bodies.js";
import * as A from "astronomy-engine";
import { BLACK_HOLE_PLACES } from "../src/skyplaces.js";
import { distanceFor, orbitView, PATH, pathAt, reachFor, stepZoom, ZOOM, zoomLabel, zoomState } from "../src/wallpaper-camera.js";
import { createLabels } from "../src/wallpaper-labels.js";
import { DEFAULTS, loadSettings, parse, save } from "../src/wallpaper-settings.js";

const DEG = Math.PI / 180;

/** A camera standing where `view` says, looking where it says. */
function cameraFor(view, aspect = 16 / 9) {
  const camera = new PerspectiveCamera(45, aspect, 0.5, 3000);
  camera.position.fromArray(view.position);
  camera.lookAt(new Vector3().fromArray(view.target));
  camera.updateMatrixWorld();
  return camera;
}
const SHAPES = [[1920, 1080], [2560, 1080], [3440, 1440], [1080, 1920], [390, 844], [1024, 1024]];
const ZOOMS = [1, 1.3, 1.9, 2.5, 4, 6, 10];

test("the camera goes all the way round, slowly, at one fixed angle", () => {
  const a = pathAt(0);
  const b = pathAt(PATH.lap);
  assert.ok(Math.abs(b.azimuth - a.azimuth - 2 * Math.PI) < 1e-9, "one lap takes PATH.lap seconds");
  assert.ok(PATH.lap >= 300, "a lap takes minutes, not seconds");
  for (let t = 0; t < 4000; t += 7) assert.equal(pathAt(t).elevation, PATH.elevation * DEG, "the angle never changes");
  assert.equal(PATH.elevation, 9, "the angle of the picture that was picked");
  // And the angle really is that, whatever the zoom.
  for (const zoom of ZOOMS) {
    const { position } = orbitView({ seconds: 123, fov: 45, aspect: 16 / 9, reach: reachFor(zoom) });
    const v = new Vector3().fromArray(position);
    assert.ok(Math.abs(Math.asin(v.y / v.length()) / DEG - 9) < 1e-9, `${zoom}x`);
  }
});

test("zoom runs from the whole system (1x) to the Sun and Mercury (10x)", () => {
  assert.equal(reachFor(1), ZOOM.whole);
  assert.ok(ZOOM.whole >= auToScene(49.3), "1x holds Pluto at its farthest");
  assert.ok(reachFor(10) >= auToScene(0.467) - 0.5, "10x still holds Mercury's orbit");
  assert.equal(reachFor(50), reachFor(10), "no closer than 10x");
  assert.equal(reachFor(0.1), reachFor(1), "no farther than 1x");
  assert.equal(zoomLabel(1), "The whole system");
  assert.equal(zoomLabel(ZOOM.default), "The whole system", "it opens on all nine planets");
  assert.equal(zoomLabel(10), "Out to Mercury");
  let last = Infinity;
  for (let z = 1; z <= 10; z += 0.1) {
    const d = orbitView({ seconds: 0, fov: 45, aspect: 16 / 9, reach: reachFor(z) }).position;
    const dist = Math.hypot(...d);
    assert.ok(dist < last, `zooming in always comes closer (${z.toFixed(1)}x)`);
    last = dist;
  }
});

test("the default zoom takes in all nine planets, out to Pluto", () => {
  assert.equal(ZOOM.default, ZOOM.min, "it opens at the widest");
  assert.ok(reachFor(ZOOM.default) >= auToScene(39.48), "Pluto's orbit is inside the reach");
});

/** The largest distance (in screen halves) any point of a flat disc of this radius reaches from the middle of the picture. */
function discExtent(camera, reach) {
  let across = 0;
  let up = 0;
  const v = new Vector3();
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * 2 * Math.PI;
    v.set(Math.cos(a) * reach, 0, Math.sin(a) * reach).project(camera);
    across = Math.max(across, Math.abs(v.x));
    up = Math.max(up, Math.abs(v.y));
  }
  return { across, up };
}

test("at every zoom the whole disc of orbits it promises fits the screen, on any screen shape, and not with room to waste", () => {
  for (const zoom of ZOOMS) {
    const reach = reachFor(zoom);
    for (const [w, h] of SHAPES) {
      for (let t = 0; t < 600; t += 37) {
        const camera = cameraFor(orbitView({ seconds: t, fov: 45, aspect: w / h, reach }), w / h);
        const { across, up } = discExtent(camera, reach);
        assert.ok(across <= 0.96 && up <= 0.96, `${zoom}x ${w}x${h} at ${t}s: disc reaches ${across.toFixed(2)} across, ${up.toFixed(2)} up`);
        assert.ok(Math.max(across, up) >= 0.9, `${zoom}x ${w}x${h} at ${t}s: the disc fills the screen (${Math.max(across, up).toFixed(2)})`);
        assert.ok(camera.position.length() > reach, "stands outside the disc it is looking at");
        const sun = new Vector3(0, 0, 0).project(camera);
        assert.ok(Math.abs(sun.x) < 1e-6 && Math.abs(sun.y) < 1e-6, "looks at the Sun");
      }
    }
  }
});

test("a thinner screen has to stand further back", () => {
  assert.ok(distanceFor(59, 45, 9 / 16, 9 * DEG) > distanceFor(59, 45, 16 / 9, 9 * DEG));
});

test("every planet inside the zoom's reach is in the picture, wherever Pluto is on its orbit", () => {
  // Pluto's orbit is long, lopsided and tilted 17 degrees: 30 to 49 AU. Four dates: now, and out to its farthest (about 2114).
  for (const date of ["2026-10-21", "2060-01-01", "2113-07-01", "2200-01-01"]) {
    const time = A.MakeTime(new Date(date));
    const planets = PLANETS.map((p) => ({ id: p.id, at: planetPosition(p, time, new Vector3()) }));
    for (const zoom of ZOOMS) {
      const reach = reachFor(zoom);
      for (const [w, h] of SHAPES) {
        for (let t = 0; t < 600; t += 41) {
          const camera = cameraFor(orbitView({ seconds: t, fov: 45, aspect: w / h, reach, points: planets.map((p) => p.at) }), w / h);
          for (const { id, at } of planets) {
            if (at.length() > reach) continue;
            const ndc = at.clone().project(camera);
            assert.ok(Math.abs(ndc.x) <= 0.97 && Math.abs(ndc.y) <= 0.97, `${date} ${zoom}x ${w}x${h} at ${t}s: ${id} is off the screen (${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`);
          }
        }
      }
    }
  }
});

test("a change of zoom eases in and out: a gentle start, no overshoot, all but there in about two seconds", () => {
  for (const [from, to] of [[1.9, 10], [10, 1], [1.9, 2.4], [4, 3.2]]) {
    const state = zoomState(from);
    const target = Math.log(reachFor(to));
    const start = state.value;
    const steps = [];
    let t = 0;
    let moving = true;
    let nearly = null; // when it is within one percent of the zoom picked
    while (moving && t < 10) {
      const before = state.value;
      moving = stepZoom(state, to, 0.05);
      steps.push(Math.abs(state.value - before));
      t += 0.05;
      if (nearly === null && Math.abs(state.value - target) < 0.01) nearly = t;
      assert.ok((state.value - target) * (start - target) >= -1e-9, `${from}x to ${to}x: never goes past the zoom picked`);
    }
    assert.equal(moving, false);
    assert.equal(state.value, target);
    assert.ok(nearly <= 2.5, `${from}x to ${to}x is within 1% after ${nearly.toFixed(2)} s`);
    assert.ok(t <= 4, `${from}x to ${to}x stops (and the page goes back to drawing once a second) after ${t.toFixed(2)} s`);
    assert.ok(steps[0] < Math.max(...steps) * 0.5, `${from}x to ${to}x starts gently`);
  }
  // A slow frame (a quarter of a second) is taken in small steps, so it lands where many small frames would.
  const a = zoomState(1.9);
  const b = zoomState(1.9);
  stepZoom(a, 6, 0.25);
  for (let i = 0; i < 5; i++) stepZoom(b, 6, 0.05);
  assert.ok(Math.abs(a.value - b.value) < 0.02);
  // And the planets' own places never make the camera jump while zooming (a planet coming inside the reach).
  const pluto = new Vector3(40, -18, 45); // well below the plane, like Pluto in some years
  let last = null;
  for (let z = 1; z <= 2.5; z += 0.002) {
    const d = Math.hypot(...orbitView({ seconds: 0, fov: 45, aspect: 16 / 9, reach: reachFor(z), points: [pluto] }).position);
    if (last !== null) assert.ok(Math.abs(d - last) < 0.5, `no jump at ${z.toFixed(3)}x (${last.toFixed(2)} to ${d.toFixed(2)})`);
    last = d;
  }
  assert.equal(stepZoom(zoomState(3), 3, 0.05), false, "nothing to do: not moving");
});

test("the Wallpaper's settings: only the ones it has", () => {
  assert.equal(DEFAULTS.fps, 20);
  assert.equal(parse("speed", "day"), "day");
  assert.equal(parse("fps", "30"), 30);
  assert.equal(parse("labels", "0"), false);
  assert.equal(DEFAULTS.zoom, 1);
  for (const [given, kept] of [[1, 1], [2.5, 2.5], ["3.25", 3.25], [10, 10], [1.234, 1.23], [30, 10], [0.2, 1], [0, 1]]) assert.equal(parse("zoom", given), kept, `zoom ${given}`);
  for (const bad of ["x", null, "", true, [2], "1e3", "-2", NaN, Infinity]) assert.equal(parse("zoom", bad), undefined, `zoom ${JSON.stringify(bad)}`);
  assert.equal(loadSettings("?zoom=4").zoom, 4);
  assert.equal(loadSettings("?zoom=99").zoom, 10);
  assert.equal(loadSettings("?zoom=nope").zoom, 1);
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
    assert.equal(box.children.length, 1 + PLANETS.length + 1 + 1 + BLACK_HOLE_PLACES.length, "the Sun, the planets, the moon, a galaxy and the black holes");
    for (const name of ["Sun", ...PLANETS.map((p) => p.name), "Andromeda Galaxy", "Sagittarius A*", "Cygnus X-1", "M87*"]) assert.ok(texts.includes(name), `${name} is named`);
    assert.ok(texts.includes("Moon"));
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

test("a moon is named only when asked, and only while it is drawn", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const earth = { kind: "planet", def: { name: "Earth" }, radius: 0.5, group: { position: new Vector3(0, 0, 0), scale: { x: 1 }, visible: true } };
    const moon = { kind: "moon", def: { name: "Moon" }, radius: 0.1, group: { position: new Vector3(3, 0, 0), scale: { x: 1 }, visible: true } };
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const box = { children: [], append(...c) { this.children.push(...c); } };
    const labels = createLabels({ box, bodies: [earth, moon], places: [] });
    const moonLabel = box.children.find((el) => el.textContent === "Moon");
    labels.update(camera, 1920, 1080);
    assert.equal(moonLabel.style.opacity, "0", "not named unless asked");
    labels.update(camera, 1920, 1080, { moons: true });
    assert.equal(moonLabel.style.opacity, "1", "named when asked");
    moon.group.visible = false;
    labels.update(camera, 1920, 1080, { moons: true });
    assert.equal(moonLabel.style.opacity, "0", "and not once it is no longer drawn");
  } finally {
    delete globalThis.document;
  }
});

test("a planet that fills a good part of the screen isn't named (its name would float off past its rings)", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    const saturn = { kind: "planet", def: { name: "Saturn" }, radius: 1.2, ring: {}, group: { position: new Vector3(0, 0, 0), scale: { x: 1 } } };
    const box = { children: [], append(...c) { this.children.push(...c); } };
    const labels = createLabels({ box, bodies: [saturn], places: [] });
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
    const name = box.children[0];
    camera.position.set(0, 0, 60);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    labels.update(camera, 1920, 1080);
    assert.equal(name.style.opacity, "1", "small: named");
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    labels.update(camera, 1920, 1080);
    assert.equal(name.style.opacity, "0", "big: not named");
  } finally {
    delete globalThis.document;
  }
});
