// The Wallpaper's own parts: where the camera goes, what its settings are, and its names.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { auToScene, planetPosition } from "../src/ephemeris.js";
import { PLANETS } from "../src/bodies.js";
import * as A from "astronomy-engine";
import { BLACK_HOLE_PLACES } from "../src/skyplaces.js";
import { closeView, distanceFor, orbitView, PATH, pathAt, TOUR, TOUR_GLIDE, TOUR_STOP, tourAt, viewAt, ZOOMS, zoomOf } from "../src/wallpaper-camera.js";
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
const WIDE = ZOOMS[0];
const SHAPES = [[1920, 1080], [2560, 1080], [1080, 1920], [390, 844], [1024, 1024]];

test("there are four zoom levels, and every one has a name and a note", () => {
  assert.deepEqual(ZOOMS.map((z) => z.id), [1, 2, 3, 4]);
  for (const z of ZOOMS) assert.ok(z.name && z.note.length > 20, `zoom ${z.id}`);
  assert.equal(zoomOf(3).name, "Inner planets");
  assert.equal(zoomOf(99).id, 1, "an unknown level is the widest");
  assert.ok(ZOOMS.slice(0, 3).every((z, i, all) => i === 0 || z.reach.mid < all[i - 1].reach.mid), "each level is closer than the one before");
  assert.ok(ZOOMS[3].tour);
});

test("the camera goes all the way round, slowly, and never stops", () => {
  const a = pathAt(0);
  const b = pathAt(PATH.lap);
  assert.ok(Math.abs(b.azimuth - a.azimuth - 2 * Math.PI) < 1e-9, "one lap takes PATH.lap seconds");
  assert.ok(PATH.lap >= 300, "a lap takes minutes, not seconds");
  for (const zoom of ZOOMS.slice(0, 3)) {
    const { low, high } = zoom.elevation ?? PATH.elevation;
    for (let t = 0; t < 4000; t += 7) {
      const p = pathAt(t, zoom);
      assert.ok(p.elevation / DEG >= low - 1e-9 && p.elevation / DEG <= high + 1e-9);
      assert.ok(p.reach >= zoom.reach.mid / zoom.reach.ratio - 1e-9 && p.reach <= zoom.reach.mid * zoom.reach.ratio + 1e-9);
    }
    // The flat edge-on view is the dullest, so it is passed through quickly, not lingered in.
    let flat = 0;
    const N = 8400;
    for (let i = 0; i < N; i++) if (Math.abs(pathAt((i / N) * PATH.bob, zoom).elevation) < 6 * DEG) flat++;
    assert.ok(flat / N < 0.08, `zoom ${zoom.id}: ${((100 * flat) / N).toFixed(1)}% of the time within 6 degrees of edge-on`);
    // Smooth: no jump between moments a frame apart.
    let last = pathAt(0, zoom);
    for (let t = 0.05; t < 700; t += 0.05) {
      const p = pathAt(t, zoom);
      assert.ok(Math.abs(p.azimuth - last.azimuth) < 0.002 && Math.abs(p.elevation - last.elevation) < 0.001 && Math.abs(p.reach / last.reach - 1) < 0.001, `zoom ${zoom.id} smooth at ${t}`);
      last = p;
    }
  }
  const lows = Array.from({ length: 200 }, (_, i) => pathAt((i / 200) * PATH.bob).elevation / DEG);
  assert.ok(Math.min(...lows) < -35 && Math.max(...lows) > 60, "the widest level goes well below the plane and well above it, so the whole sky comes into view");
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

test("at the levels round the Sun, the whole disc of orbits fits the screen at every moment, on any screen shape, and not with room to waste", () => {
  for (const zoom of ZOOMS.slice(0, 3)) {
    for (const [w, h] of SHAPES.concat([[3440, 1440]])) {
      for (let t = 0; t < 1200; t += 37) {
        const view = orbitView({ seconds: t, fov: 45, aspect: w / h, zoom });
        const camera = cameraFor(view, w / h);
        const { reach } = pathAt(t, zoom);
        const { across, up } = discExtent(camera, reach);
        assert.ok(across <= 0.96 && up <= 0.96, `zoom ${zoom.id} ${w}x${h} at ${t}s: disc reaches ${across.toFixed(2)} across, ${up.toFixed(2)} up`);
        assert.ok(Math.max(across, up) >= 0.9, `zoom ${zoom.id} ${w}x${h} at ${t}s: the disc fills the screen (${Math.max(across, up).toFixed(2)})`);
        assert.ok(camera.position.length() > reach, "stands outside the disc it is looking at");
      }
    }
  }
});

test("the camera always looks at the Sun (at the levels round it)", () => {
  for (const zoom of ZOOMS.slice(0, 3)) {
    for (let t = 0; t < 900; t += 61) {
      const camera = cameraFor(orbitView({ seconds: t, fov: 45, aspect: 16 / 9, zoom }));
      const sun = new Vector3(0, 0, 0).project(camera);
      assert.ok(Math.abs(sun.x) < 1e-6 && Math.abs(sun.y) < 1e-6);
    }
  }
});

test("a thinner screen has to stand further back", () => {
  assert.ok(distanceFor(59, 45, 9 / 16, 24 * DEG) > distanceFor(59, 45, 16 / 9, 24 * DEG));
});

test("the planets each level promises are in the picture at every moment, wherever Pluto is on its orbit", () => {
  // Pluto's orbit is long and lopsided: 30 to 49 AU. Four dates: now, and out to its farthest (about 2114).
  for (const date of ["2026-10-21", "2060-01-01", "2113-07-01", "2200-01-01"]) {
    const time = A.MakeTime(new Date(date));
    const planets = Object.fromEntries(PLANETS.map((p) => [p.id, planetPosition(p, time, new Vector3())]));
    for (const zoom of ZOOMS.slice(0, 3)) {
      const kept = zoom.fit ?? Object.keys(planets);
      for (const [w, h] of SHAPES) {
        for (let t = 0; t < 1700; t += 53) {
          const camera = cameraFor(viewAt({ seconds: t, fov: 45, aspect: w / h, zoom, planets }), w / h);
          for (const id of kept) {
            const ndc = planets[id].clone().project(camera);
            assert.ok(Math.abs(ndc.x) <= 0.97 && Math.abs(ndc.y) <= 0.97, `${date} zoom ${zoom.id} ${w}x${h} at ${t}s: ${id} is off the screen (${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`);
          }
        }
      }
    }
  }
});

test("the widest level on its own shows out to Neptune's orbit at its closest and Pluto's farthest at its widest", () => {
  const near = WIDE.reach.mid / WIDE.reach.ratio;
  const far = WIDE.reach.mid * WIDE.reach.ratio;
  assert.ok(near >= auToScene(30.33) - 0.5, `closest reach ${near.toFixed(1)} holds Neptune's farthest (${auToScene(30.33).toFixed(1)})`);
  assert.ok(far >= auToScene(49.3), `widest reach ${far.toFixed(1)} holds Pluto's farthest (${auToScene(49.3).toFixed(1)})`);
});

test("the closer levels fit what they say: Saturn's orbit at level 2, the asteroid belt and Mars at level 3", () => {
  const two = zoomOf(2).reach;
  const three = zoomOf(3).reach;
  assert.ok(two.mid / two.ratio >= auToScene(9.0) - 1, "level 2's closest still holds Saturn's orbit");
  assert.ok(three.mid / three.ratio >= auToScene(1.67) - 0.5, "level 3's closest holds Mars's orbit");
  assert.ok(three.mid * three.ratio <= auToScene(5.2), "and its widest stays inside Jupiter's");
});

// --- Level 4: up close ---

test("the tour visits every planet in turn, and glides only at the end of each stop", () => {
  const seen = new Set();
  for (let t = 0; t < TOUR_STOP * TOUR.length; t += 1) {
    const { from, to, blend } = tourAt(t);
    seen.add(from);
    assert.ok(blend >= 0 && blend <= 1);
    if (t % TOUR_STOP < TOUR_STOP - TOUR_GLIDE) assert.equal(blend, 0, `no glide at ${t}`);
    assert.equal(to, TOUR[(TOUR.indexOf(from) + 1) % TOUR.length]);
  }
  assert.deepEqual([...seen].sort(), PLANETS.map((p) => p.id).sort(), "all nine, once each");
  assert.equal(tourAt(TOUR_STOP * TOUR.length).from, TOUR[0], "and round again");
  assert.equal(tourAt(TOUR_STOP - 0.001).blend > 0.99, true, "ends the glide as the next stop begins");
});

/** Planets spread out as the app lays them out, with a framing radius each (a planet and what goes round it). */
function fakeWorld() {
  const info = {};
  PLANETS.forEach((p, i) => {
    const r = auToScene([0.39, 0.72, 1, 1.52, 5.2, 9.5, 19.2, 30, 39.5][i]);
    info[p.id] = { position: new Vector3(Math.cos(i * 1.3) * r, Math.sin(i) * 0.8, Math.sin(i * 1.3) * r), radius: 0.8 + i * 0.5 };
  });
  return { info, lookup: (id) => info[id] };
}

test("up close: the planet and what goes round it fill the picture without leaving it, on any screen shape, all through the tour", () => {
  const { info, lookup } = fakeWorld();
  for (const [w, h] of SHAPES) {
    for (let t = 0; t < TOUR_STOP * TOUR.length; t += 7) {
      const view = closeView({ seconds: t, fov: 45, aspect: w / h, info: lookup });
      const camera = cameraFor(view, w / h);
      const { from, to, blend } = tourAt(t);
      if (blend > 0) continue; // (gliding: between two planets)
      const { position, radius } = info[from];
      // Eight points round a sphere of that radius must all be on screen, and some must come near the edge.
      let widest = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        for (const lift of [0, 1, -1]) {
          const ndc = position.clone().add(new Vector3(Math.cos(a) * radius, lift * radius * 0.7, Math.sin(a) * radius)).project(camera);
          widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
        }
      }
      assert.ok(widest > 0.55, `${from} at ${t}s, ${w}x${h}: it doesn't fill the picture (${widest.toFixed(2)})`);
      const centre = position.clone().project(camera);
      assert.ok(Math.abs(centre.x) < 1e-6 && Math.abs(centre.y) < 1e-6, "looking at the planet");
      assert.ok(new Vector3().fromArray(view.position).distanceTo(position) > radius, "outside the sphere it frames");
    }
  }
});

test("up close: the camera favours the sunny side, so a planet is mostly lit", () => {
  const { info, lookup } = fakeWorld();
  let lit = 0;
  let total = 0;
  for (let t = 0; t < 230 * 4; t += 3) {
    const { from, blend } = tourAt(t);
    if (blend > 0) continue;
    const view = closeView({ seconds: t, fov: 45, aspect: 16 / 9, info: lookup });
    const p = info[from].position;
    const toCamera = new Vector3().fromArray(view.position).sub(p).normalize();
    const toSun = p.clone().negate().normalize();
    if (toCamera.dot(toSun) > 0) lit++;
    total++;
  }
  assert.ok(lit / total > 0.7, `${Math.round((100 * lit) / total)}% of the time the sun is on the camera's side of the planet`);
});

test("up close: no jump while gliding from one planet to the next, and none at the start of a glide", () => {
  const { lookup } = fakeWorld();
  let last = closeView({ seconds: 0, fov: 45, aspect: 16 / 9, info: lookup });
  let worst = 0;
  for (let t = 0.05; t < TOUR_STOP * 3; t += 0.05) {
    const view = closeView({ seconds: t, fov: 45, aspect: 16 / 9, info: lookup });
    for (const key of ["position", "target"]) {
      const step = Math.hypot(...view[key].map((x, i) => x - last[key][i]));
      worst = Math.max(worst, step);
    }
    last = view;
  }
  // The planets are up to about 50 units apart in this world; the glide takes 16 s, so a smooth one moves a few units a second at most.
  assert.ok(worst < 1.0, `the camera moved ${worst.toFixed(2)} units in 0.05 s at most`);
});

test("the Wallpaper's settings: only the ones it has", () => {
  assert.equal(DEFAULTS.fps, 20);
  assert.equal(parse("speed", "day"), "day");
  assert.equal(parse("fps", "30"), 30);
  assert.equal(parse("labels", "0"), false);
  assert.equal(DEFAULTS.zoom, 2);
  for (const ok of [1, 2, 3, 4, "3"]) assert.equal(parse("zoom", ok), Number(ok));
  for (const bad of [0, 5, -1, 2.5, "x", null, "", true, [2]]) assert.equal(parse("zoom", bad), undefined, `zoom ${JSON.stringify(bad)}`);
  assert.equal(loadSettings("?zoom=4").zoom, 4);
  assert.equal(loadSettings("?zoom=9").zoom, 2);
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

test("a moon is named only in the close-up, and only while it is drawn", () => {
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
    assert.equal(moonLabel.style.opacity, "0", "not named at the wider levels");
    labels.update(camera, 1920, 1080, { moons: true });
    assert.equal(moonLabel.style.opacity, "1", "named in the close-up");
    moon.group.visible = false;
    labels.update(camera, 1920, 1080, { moons: true });
    assert.equal(moonLabel.style.opacity, "0", "and not once it is no longer drawn");
  } finally {
    delete globalThis.document;
  }
});
