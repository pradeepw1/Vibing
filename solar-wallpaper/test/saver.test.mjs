// Space Scope as a wallpaper (scope.html?wallpaper): the savings in src/saver.js, and how the flag reaches them.
import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, SphereGeometry, Vector3 } from "three";
import { hostSearch } from "../src/options.js";
import { createDetail, fitRatio, LIMITS, pixelsPerUnit, smoothsEdges } from "../src/saver.js";
import { loadSettings } from "../src/settings.js";

test("the drawing never has many more pixels than the cap, however big the screen", () => {
  const pixels = (ratio, w, h) => ratio * w * ratio * h;
  // A 1080p screen at normal sharpness is under the cap, so it is drawn as sharp as the screen is.
  assert.equal(fitRatio(1, 1920, 1080), 1);
  // A Retina laptop (1440 x 900 points, twice as sharp) would be 5.2 million pixels: scaled back to the cap.
  const retina = fitRatio(2, 1440, 900);
  assert.ok(retina < 2 && retina > 1.3, `${retina}`);
  assert.ok(pixels(retina, 1440, 900) <= LIMITS.maxPixels * 1.001, "no more than the cap");
  assert.ok(pixels(retina, 1440, 900) > LIMITS.maxPixels * 0.95, "and not much less: no sharpness thrown away");
  // A small window at twice the sharpness is fine as it is.
  assert.equal(fitRatio(2, 800, 600), 2);
  // A very big screen, or no figure for the sharpness, still gives something sensible.
  assert.ok(fitRatio(1, 12000, 8000) >= 0.35);
  assert.equal(fitRatio(undefined, 1280, 720), 1);
  assert.equal(fitRatio(3, 800, 600), 2, "never sharper than twice");
});

test("edges are smoothed only where the screen isn't sharp enough to hide them", () => {
  assert.equal(smoothsEdges(1), true);
  assert.equal(smoothsEdges(1.49), true);
  assert.equal(smoothsEdges(1.5), false);
  assert.equal(smoothsEdges(2), false);
});

test("pixels across one unit: the screen's height over the picture's height at distance 1", () => {
  // At 90 degrees across, the picture is 2 units high at distance 1.
  assert.ok(Math.abs(pixelsPerUnit(1000, 90) - 500) < 1e-9);
  assert.ok(pixelsPerUnit(1000, 45) > pixelsPerUnit(1000, 90), "a narrower view magnifies");
});

/** A planet or moon with just what createDetail touches. */
function body(id, kind, radius, parent = null, parts = {}) {
  const group = new Group();
  const mesh = new Mesh(new SphereGeometry(1, 128, 64), new MeshBasicMaterial());
  group.add(mesh);
  const b = { id, kind, radius, parent, group, mesh, ...parts };
  if (parts.halo) b.halo = new Mesh(new SphereGeometry(1, 128, 64), new MeshBasicMaterial());
  if (parts.clouds) b.clouds = new Mesh(new SphereGeometry(1, 128, 64), new MeshBasicMaterial());
  return b;
}

function system() {
  const sun = body("sun", "sun", 2);
  const jupiter = body("jupiter", "planet", 1, null, { halo: true });
  const earth = body("earth", "planet", 0.2, null, { clouds: true });
  const io = body("io", "moon", 0.02, jupiter);
  const titan = body("titan", "moon", 0.05, jupiter);
  jupiter.group.position.set(20, 0, 0);
  earth.group.position.set(10, 0, 0);
  const bodies = new Map([sun, jupiter, earth, io, titan].map((b) => [b.id, b]));
  return { bodies, sun, jupiter, earth, io, titan };
}

const camera = (z) => {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 3000);
  c.position.set(20, 0, z);
  c.lookAt(20, 0, 0);
  c.updateMatrixWorld();
  return c;
};
const SCALE = pixelsPerUnit(1080, 45); // a 1080 pixel tall screen

test("the bodies get lighter spheres than Space Scope's close-up ones", () => {
  const s = system();
  const detail = createDetail(s.bodies);
  const segments = (mesh) => `${mesh.geometry.parameters.widthSegments}x${mesh.geometry.parameters.heightSegments}`;
  assert.equal(segments(s.sun.mesh), "64x32");
  assert.equal(segments(s.jupiter.mesh), "48x24");
  assert.equal(segments(s.jupiter.halo), "32x16");
  assert.equal(segments(s.earth.mesh), "48x24");
  assert.equal(segments(s.earth.clouds), "48x24");
  assert.equal(segments(s.io.mesh), "48x24");
  assert.deepEqual(detail.moons.map((m) => m.id), ["io", "titan"]);
});

test("moons start shown (so they are put in place once), then drop out while too small to see", () => {
  const s = system();
  const detail = createDetail(s.bodies);
  assert.equal(s.io.group.visible, true);
  // From far off Jupiter's moons are specks: Io (radius 0.02) is under a pixel at 3000 units.
  const asked = detail.update(camera(3000), SCALE);
  assert.equal(s.io.group.visible, false);
  assert.equal(s.titan.group.visible, false);
  assert.deepEqual(asked, [], "too small to want a map");
  // Close in (5 units: Io is about 5 pixels across, Titan about 13) they come back and want their maps, once.
  assert.deepEqual(detail.update(camera(5), SCALE).sort(), ["io", "titan"]);
  assert.equal(s.io.group.visible, true);
  assert.deepEqual(detail.update(camera(5), SCALE), [], "a map is asked for once");
  assert.deepEqual([...detail.wanted].sort(), ["io", "titan"]);
});

test("a moon on the edge of being seen doesn't flicker: it comes in and goes out at different sizes", () => {
  const s = system();
  const detail = createDetail(s.bodies);
  // Io's size on screen is 0.02 * SCALE / distance. Find distances for 1.0 px and 0.75 px (between the two limits).
  const at = (px) => (0.02 * SCALE) / px;
  detail.update(camera(at(0.3)), SCALE); // gone
  assert.equal(s.io.group.visible, false);
  detail.update(camera(at(0.75)), SCALE); // between the limits, and it was gone: stays gone
  assert.equal(s.io.group.visible, false);
  detail.update(camera(at(1.0)), SCALE); // big enough: shown
  assert.equal(s.io.group.visible, true);
  detail.update(camera(at(0.75)), SCALE); // between the limits, and it was shown: stays shown
  assert.equal(s.io.group.visible, true);
  detail.update(camera(at(0.5)), SCALE); // too small: gone
  assert.equal(s.io.group.visible, false);
});

test("standing on a body, every moon is shown whatever its size", () => {
  const s = system();
  const detail = createDetail(s.bodies);
  detail.update(camera(3000), SCALE);
  assert.equal(s.io.group.visible, false);
  detail.update(camera(3000), SCALE, { showAll: true });
  assert.equal(s.io.group.visible, true);
  assert.equal(s.titan.group.visible, true);
});

test("a planet gets a finer sphere only while it is big on screen, and its halo and clouds with it", () => {
  const s = system();
  const detail = createDetail(s.bodies);
  const segments = (mesh) => mesh.geometry.parameters.widthSegments;
  // Jupiter (radius 1) is r pixels across its radius at SCALE / r distance.
  detail.update(camera(SCALE / (LIMITS.closePx / 2)), SCALE); // half the limit
  assert.equal(segments(s.jupiter.mesh), 48);
  detail.update(camera(SCALE / (LIMITS.closePx * 1.5)), SCALE); // past it
  assert.equal(segments(s.jupiter.mesh), 96);
  assert.equal(segments(s.jupiter.halo), 64);
  detail.update(camera(3000), SCALE); // far off again
  assert.equal(segments(s.jupiter.mesh), 48);
  assert.equal(segments(s.jupiter.halo), 32);
  // Earth, with clouds, is far from the camera here: it stays light. Bring the camera next to it.
  const c = new PerspectiveCamera(45, 16 / 9, 0.1, 3000);
  c.position.set(10, 0, 1);
  c.lookAt(10, 0, 0);
  c.updateMatrixWorld();
  detail.update(c, SCALE);
  assert.equal(segments(s.earth.mesh), 96);
  assert.equal(segments(s.earth.clouds), 96);
});

test("the wallpaper flag turns the savings on, and quiets the sightings unless asked for", () => {
  assert.equal(loadSettings("").saver, false);
  assert.equal(loadSettings("").fps, 60, "Space Scope proper is unchanged");
  assert.equal(loadSettings("").strange, true);
  const w = loadSettings("?wallpaper");
  assert.equal(w.saver, true);
  assert.equal(w.ui, false);
  assert.equal(w.fps, 30);
  assert.equal(w.strange, false, "nothing made up drifts by on its own");
  assert.equal(loadSettings("?wallpaper&strange=1").strange, true, "but it can be asked for");
  assert.equal(loadSettings("?wallpaper&fps=15").fps, 15);
  assert.equal(loadSettings("?wallpaper=0").saver, false);
});

test("an app that can't write the settings in the address can set them in solarSearch before the page starts", () => {
  const had = { window: globalThis.window, location: globalThis.location };
  try {
    delete globalThis.location;
    globalThis.window = { solarSearch: "?wallpaper=1&view=jupiter" };
    assert.equal(hostSearch(), "?wallpaper=1&view=jupiter");
    assert.equal(loadSettings().view, "jupiter");
    assert.equal(loadSettings().saver, true);
    // An address with settings in it wins.
    globalThis.location = { search: "?speed=day" };
    assert.equal(hostSearch(), "?speed=day");
    // Neither: nothing.
    globalThis.location = { search: "" };
    globalThis.window = {};
    assert.equal(hostSearch(), "");
    delete globalThis.window;
    assert.equal(hostSearch(), "");
  } finally {
    if (had.window === undefined) delete globalThis.window;
    else globalThis.window = had.window;
    if (had.location === undefined) delete globalThis.location;
    else globalThis.location = had.location;
  }
});

test("positions are not touched by the sphere changes", () => {
  const s = system();
  const before = s.jupiter.group.position.clone();
  const detail = createDetail(s.bodies);
  detail.update(camera(100), SCALE);
  assert.ok(before.equals(s.jupiter.group.position));
  assert.ok(new Vector3(10, 0, 0).equals(s.earth.group.position));
});
