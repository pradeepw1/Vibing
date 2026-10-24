// The Wallpaper's own parts: where the camera goes, what its settings are, and its names.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { displayRadius, moonDistance, moonOffset, planetAxes, planetPosition } from "../src/ephemeris.js";
import { MOONS, PLANETS } from "../src/bodies.js";
import * as A from "astronomy-engine";
import { BLACK_HOLE_PLACES } from "../src/skyplaces.js";
import { distanceFor, orbitView, PATH, pathAt, reachFor, stepZoom, sunwardOf, ZOOM, zoomLabel, zoomState } from "../src/wallpaper-camera.js";
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
const ZOOMS = [1, 1.5, 2, 3, 4, 6];
const RINGS = 2.27 * displayRadius(58232); // Saturn's rings reach this far from its middle, as drawn

/** Saturn and its moons on a date, as the app lays them out (scene units). */
function saturnOn(date) {
  const time = A.MakeTime(new Date(date));
  const axes = planetAxes(time);
  const saturn = planetPosition(PLANETS.find((p) => p.id === "saturn"), time, new Vector3());
  const moons = MOONS.filter((m) => m.parent === "saturn").map((m) => ({ id: m.id, at: moonOffset(m, time, axes, new Vector3()).add(saturn) }));
  return { saturn, moons };
}
const DATES = ["2026-10-21", "2032-03-01", "2040-07-15", "2051-01-01"];

test("the camera swings to and fro over Saturn's sunny side, at one fixed angle", () => {
  for (const date of DATES) {
    const { saturn } = saturnOn(date);
    const sunward = sunwardOf(saturn);
    for (let t = 0; t < 1300; t += 7) {
      const p = pathAt(t, sunward);
      assert.equal(p.elevation, PATH.elevation * DEG, "the angle never changes");
      const off = Math.atan2(Math.sin(p.azimuth - sunward), Math.cos(p.azimuth - sunward)) / DEG;
      assert.ok(Math.abs(off) <= PATH.swing + 1e-9, `never more than ${PATH.swing} degrees from the sunny side (${off.toFixed(1)})`);
    }
    // And the camera really is on the Sun's side of Saturn most of the time, so Saturn is lit.
    let lit = 0;
    for (let t = 0; t < PATH.period; t += 3) {
      const v = orbitView({ seconds: t, fov: 45, aspect: 16 / 9, reach: reachFor(2), center: saturn });
      const toCamera = new Vector3().fromArray(v.position).sub(saturn).normalize();
      if (toCamera.dot(saturn.clone().negate().normalize()) > 0) lit++;
    }
    assert.ok(lit / (PATH.period / 3) > 0.7, `${date}: the sunny side is in view ${Math.round((300 * lit) / PATH.period)}% of the time`);
  }
  assert.equal(PATH.elevation, 9, "the angle that was picked");
  assert.ok(PATH.period >= 300, "a swing takes minutes, not seconds");
  // Smooth: no jump between moments a frame apart.
  let last = pathAt(0, 1);
  for (let t = 0.05; t < 700; t += 0.05) {
    const p = pathAt(t, 1);
    assert.ok(Math.abs(p.azimuth - last.azimuth) < 0.002, `smooth at ${t}`);
    last = p;
  }
});

test("the camera looks at Saturn, at that angle, at every zoom", () => {
  const { saturn } = saturnOn(DATES[0]);
  for (const zoom of ZOOMS) {
    for (let t = 0; t < 600; t += 61) {
      const view = orbitView({ seconds: t, fov: 45, aspect: 16 / 9, reach: reachFor(zoom), center: saturn });
      const camera = cameraFor(view);
      const middle = saturn.clone().project(camera);
      assert.ok(Math.abs(middle.x) < 1e-6 && Math.abs(middle.y) < 1e-6, "Saturn in the middle");
      const rel = new Vector3().fromArray(view.position).sub(saturn);
      assert.ok(Math.abs(Math.asin(rel.y / rel.length()) / DEG - 9) < 1e-9, `${zoom}x at ${t}s: 9 degrees`);
    }
  }
});

test("zoom runs from Saturn and its moons (1x) to its rings filling the screen (6x)", () => {
  assert.equal(reachFor(ZOOM.min), ZOOM.whole);
  assert.equal(reachFor(99), reachFor(ZOOM.max), "no closer than the most");
  assert.equal(reachFor(0.1), reachFor(ZOOM.min), "no farther than the least");
  const iapetus = moonDistance(3560820, 58232, displayRadius(58232));
  assert.ok(reachFor(1) > iapetus, "1x takes in Iapetus, the farthest big moon");
  assert.ok(reachFor(ZOOM.default) > iapetus, "and so does the default");
  assert.ok(reachFor(ZOOM.max) < RINGS, "at the closest, the rings run off the screen");
  assert.equal(zoomLabel(1), "Saturn, out past its moons");
  assert.equal(zoomLabel(ZOOM.default), "Saturn and its moons");
  assert.equal(zoomLabel(ZOOM.max), "Saturn's rings, up close");
  const { saturn } = saturnOn(DATES[0]);
  let last = Infinity;
  for (let z = ZOOM.min; z <= ZOOM.max; z += 0.05) {
    const v = orbitView({ seconds: 0, fov: 45, aspect: 16 / 9, reach: reachFor(z), center: saturn });
    const dist = new Vector3().fromArray(v.position).distanceTo(saturn);
    assert.ok(dist < last, `zooming in always comes closer (${z.toFixed(2)}x)`);
    last = dist;
  }
});

/** The largest distance (in screen halves) any point of a flat disc of this radius round `center` reaches from the middle of the picture. */
function discExtent(camera, center, reach) {
  let across = 0;
  let up = 0;
  const v = new Vector3();
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * 2 * Math.PI;
    v.set(center.x + Math.cos(a) * reach, center.y, center.z + Math.sin(a) * reach).project(camera);
    across = Math.max(across, Math.abs(v.x));
    up = Math.max(up, Math.abs(v.y));
  }
  return { across, up };
}

test("on a wide screen the disc the zoom promises fits, and not with room to waste (a square or tall one crops the sides at the widest zooms)", () => {
  const { saturn } = saturnOn(DATES[0]);
  for (const zoom of ZOOMS) {
    const reach = reachFor(zoom);
    for (const [w, h] of SHAPES.filter(([w, h]) => w / h >= 1.5)) {
      for (let t = 0; t < 600; t += 37) {
        const camera = cameraFor(orbitView({ seconds: t, fov: 45, aspect: w / h, reach, center: saturn, maxDistance: 0.85 * saturn.length() }), w / h);
        const { across, up } = discExtent(camera, saturn, reach);
        assert.ok(across <= 0.96 && up <= 0.96, `${zoom}x ${w}x${h} at ${t}s: disc reaches ${across.toFixed(2)} across, ${up.toFixed(2)} up`);
        assert.ok(Math.max(across, up) >= 0.9, `${zoom}x ${w}x${h} at ${t}s: the disc fills the screen (${Math.max(across, up).toFixed(2)})`);
      }
    }
  }
});

test("the camera never stands behind the Sun, on any screen shape (a tall one crops the sides instead)", () => {
  for (const date of DATES) {
    const { saturn } = saturnOn(date);
    for (const zoom of ZOOMS) {
      for (const [w, h] of SHAPES) {
        for (let t = 0; t < 600; t += 23) {
          const view = orbitView({ seconds: t, fov: 45, aspect: w / h, reach: reachFor(zoom), center: saturn, maxDistance: 0.85 * saturn.length() });
          const camera = new Vector3().fromArray(view.position);
          assert.ok(camera.distanceTo(saturn) <= 0.85 * saturn.length() + 1e-9, `${date} ${zoom}x ${w}x${h}`);
          assert.ok(camera.length() > 0.15 * saturn.length() - 1e-6, "well clear of the Sun");
        }
      }
    }
  }
  assert.ok(distanceFor(10, 45, 9 / 16, 9 * DEG) > distanceFor(10, 45, 16 / 9, 9 * DEG), "(a thinner screen has to stand further back)");
});

test("Saturn's moons inside the zoom stay in the picture (on a wide screen), wherever they are on their orbits", () => {
  for (const date of DATES) {
    const { saturn, moons } = saturnOn(date);
    for (const zoom of ZOOMS) {
      const reach = reachFor(zoom);
      for (const [w, h] of SHAPES.filter(([w, h]) => w / h >= 1.5)) {
        for (let t = 0; t < 600; t += 41) {
          const camera = cameraFor(orbitView({ seconds: t, fov: 45, aspect: w / h, reach, center: saturn, points: moons.map((m) => m.at), maxDistance: 0.85 * saturn.length() }), w / h);
          for (const { id, at } of moons) {
            if (at.distanceTo(saturn) > reach) continue;
            const ndc = at.clone().project(camera);
            assert.ok(Math.abs(ndc.x) <= 0.97 && Math.abs(ndc.y) <= 0.97, `${date} ${zoom}x ${w}x${h} at ${t}s: ${id} is off the screen (${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`);
          }
        }
      }
    }
  }
});

test("a change of zoom eases in and out: a gentle start, no overshoot, all but there in about two seconds", () => {
  for (const [from, to] of [[2, 6], [6, 1], [2, 2.5], [4, 3.2]]) {
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
  const a = zoomState(2);
  const b = zoomState(2);
  stepZoom(a, 5, 0.25);
  for (let i = 0; i < 5; i++) stepZoom(b, 5, 0.05);
  assert.ok(Math.abs(a.value - b.value) < 0.02);
  assert.equal(stepZoom(zoomState(3), 3, 0.05), false, "nothing to do: not moving");
  // And a moon coming inside the reach while zooming never makes the camera jump.
  const { saturn } = saturnOn(DATES[0]);
  const tipped = saturn.clone().add(new Vector3(3, -2.5, 4)); // well below the plane, like a moon on Saturn's tipped orbits
  let last = null;
  for (let z = 1; z <= 4; z += 0.002) {
    const v = orbitView({ seconds: 0, fov: 45, aspect: 16 / 9, reach: reachFor(z), center: saturn, points: [tipped] });
    const d = new Vector3().fromArray(v.position).distanceTo(saturn);
    if (last !== null) assert.ok(Math.abs(d - last) < 0.2, `no jump at ${z.toFixed(3)}x (${last.toFixed(2)} to ${d.toFixed(2)})`);
    last = d;
  }
});

test("the Wallpaper's settings: only the ones it has", () => {
  assert.equal(DEFAULTS.fps, 20);
  assert.equal(parse("speed", "day"), "day");
  assert.equal(parse("fps", "30"), 30);
  assert.equal(parse("labels", "0"), false);
  assert.equal(DEFAULTS.zoom, 2);
  for (const [given, kept] of [[1, 1], [2.5, 2.5], ["3.25", 3.25], [6, 6], [1.234, 1.23], [30, 6], [0.2, 1], [0, 1]]) assert.equal(parse("zoom", given), kept, `zoom ${given}`);
  for (const bad of ["x", null, "", true, [2], "1e3", "-2", NaN, Infinity]) assert.equal(parse("zoom", bad), undefined, `zoom ${JSON.stringify(bad)}`);
  assert.equal(loadSettings("?zoom=4").zoom, 4);
  assert.equal(loadSettings("?zoom=99").zoom, 6);
  assert.equal(loadSettings("?zoom=nope").zoom, 2);
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
