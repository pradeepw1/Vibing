// Starts everything: the renderer, the scene, the clock and the camera.
import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Scene, Sphere, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as A from "astronomy-engine";
import { createBelts } from "./belts.js";
import { createPovCamera, povFov } from "./povcam.js";
import { createExoSystem } from "./exosystem.js";
import { createLocalGroup } from "./localgroup.js";
import { galaxyOf, loadSettings, parse, save, SPEEDS, speedRate, viewpoint, VIEWS } from "./settings.js";
import { createSky } from "./sky.js";
import { createSystem, texture } from "./system.js";
import { startPainting } from "./painter.js";
import { createUI } from "./ui.js";
import { createElsewhere } from "./elsewhere.js";
import { createStage } from "./oddities/stage.js";
import { SIGHTINGS as UFOS } from "./oddities/ufo.js";
import { SIGHTINGS as SHIPS } from "./oddities/ships.js";
import { SIGHTINGS as PHENOMENA } from "./oddities/phenomena.js";

const DEG = Math.PI / 180;
const MIN_YEAR = 1600; // the moons' and Pluto's models are good for a few centuries either side of now
const MAX_YEAR = 2400;

const settings = loadSettings();

let renderer;
try {
  renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
} catch {
  document.getElementById("error").hidden = false;
  throw new Error("WebGL is not available");
}
const pixelRatio = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.enablePan = false;
controls.autoRotateSpeed = 0.12; // one lap every 8 minutes or so
controls.maxDistance = 500;

const sky = createSky(pixelRatio);
scene.add(sky.group);
const system = createSystem(scene, pixelRatio);
const belts = createBelts(pixelRatio);
scene.add(...belts.parts);
const { bodies } = system;
const lg = createLocalGroup(renderer.domElement, pixelRatio); // out among the galaxies
const ex = createExoSystem(renderer.domElement, pixelRatio); // round another star
const beyond = createElsewhere(renderer.domElement); // through the Gate

// --- The clock ---
// `synced` means "showing right now": the clock just follows the computer's clock.
const clock = { time: settings.date ?? Date.now(), synced: settings.date === null };
const minTime = Date.UTC(MIN_YEAR, 0, 1);
const maxTime = Date.UTC(MAX_YEAR, 0, 1);

function rate() {
  return settings.paused ? 0 : speedRate(settings.speed) * (settings.reverse ? -1 : 1);
}

function tickClock(dt) {
  if (settings.paused) return;
  if (clock.synced && settings.speed === "live" && !settings.reverse) {
    clock.time = Date.now();
    return;
  }
  clock.synced = false;
  clock.time += dt * 1000 * rate();
  if (clock.time < minTime || clock.time > maxTime) {
    clock.time = Math.min(maxTime, Math.max(minTime, clock.time));
    set("paused", true);
  }
}

// --- Settings changes, from the panel, keys or a wallpaper app ---
// A view picked by clicking a planet isn't saved: on a desktop wallpaper a
// stray click shouldn't change what you see after a restart. Views picked in
// the panel, the address or a wallpaper app are.
let savedView = settings.view;
// The last "look at" view, which Back returns to.
let lastLookView = viewpoint(settings.view) ? "middle" : settings.view;

// --- Out among the galaxies ---
// away.stage: null in the solar system; "leaving" while the camera turns to
// face the galaxy and the screen dips to black; "there" in among the galaxies
// (flying, or looking round); "returning" while flying home.
const away = {
  stage: null,
  galaxy: null,
  home: viewpoint(settings.view) || !galaxyOf(settings.view) ? settings.view : "middle", // the solar system view to come back to
  then: null, // a different view asked for on the way home
  start: 0,
  scene: "galaxies", // or "system" (down among the planets of another star), or "elsewhere" (through the Gate)
  dive: null, // when we began to dive into a system
  arrived: -Infinity, // when we last switched between the solar system and the galaxies
  fromTurn: new Quaternion(),
  toTurn: new Quaternion(),
};

function store() {
  save({ ...settings, view: savedView });
}

/** Changes a setting. `how`: { remember: false } for clicks, { instant: true } to skip the camera move. */
function set(key, value, how = {}) {
  if (key === "view") {
    if (!VIEWS.some((v) => v.id === value) && !viewpoint(value) && !bodies.has(value)) return;
  } else {
    value = parse(key, value);
    if (value === undefined) return;
  }
  settings[key] = value;
  if (key === "view") {
    if (how.remember !== false) savedView = value;
    flyTo(value, how.instant ?? performance.now() < instantUntil);
  }
  if (key === "strange") stage.enabled = value && !reducedMotion;
  if (key === "speed" || key === "reverse") settings.paused = false;
  if (key === "speed" && value !== "live") clock.synced = false;
  store();
  ui.sync();
}
// Settings a wallpaper app pushes in as the page starts are applied without a camera move.
let instantUntil = performance.now() + 1500;

function goLive() {
  Object.assign(settings, { speed: "live", reverse: false, paused: false });
  clock.time = Date.now();
  clock.synced = true;
  store();
  ui.sync();
}

function jumpToNow() {
  clock.time = Date.now();
  clock.synced = settings.speed === "live" && !settings.reverse;
  settings.paused = false;
  ui.sync();
}

/** Leave a galaxy or the view from a body, back to whatever you were looking at before. */
function goBack() {
  if (away.stage === "returning" || away.stage === "unturning") return; // on the way back already
  // Only saved if the view we're leaving was (not one reached by a click).
  const remember = savedView === settings.view;
  if (galaxyOf(settings.view)) set("view", away.home, { remember });
  else if (viewpoint(settings.view)) set("view", lastLookView, { remember });
}

/** What a view is called, for the Back button. */
function labelOf(id) {
  const listed = VIEWS.find((v) => v.id === id);
  if (listed) return listed.label;
  const body = bodies.get(viewpoint(id));
  return body ? `From ${body.def.name}` : "the overview";
}

// Strange sightings: made-up ships and craft (and two real probes) that drift past now and then.
// Not by themselves for anyone who has asked for less motion (the button still works).
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = createStage({ scene, builders: [...UFOS, ...SHIPS, ...PHENOMENA], pixelRatio });
stage.enabled = settings.strange && !reducedMotion;

const ui = createUI({
  settings,
  bodies,
  galaxies: sky.galaxies,
  set,
  goLive,
  jumpToNow,
  goBack,
  backLabel: () => labelOf(galaxyOf(settings.view) ? away.home : lastLookView),
  travelling: () => away.stage === "returning" || away.stage === "unturning",
  showStrange: () => stage.showOne(),
});

// --- Camera: views, smooth flights and following a planet ---
function viewFor(id) {
  const preset = VIEWS.find((v) => v.id === id);
  const body = bodies.get(preset?.target ?? id);
  let radius = preset?.radius;
  if (!radius) {
    // Measured in the overview layout, which is where we're going even if the
    // view from a body is still on screen.
    const at = (b) => system.overviews.get(b.id) ?? b.group.position;
    const moonReach = Math.max(0, ...(body.moons ?? []).map((m) => at(m).distanceTo(at(body))));
    radius = Math.max(body.radius * (body.ring ? 4.5 : 3.2), moonReach * 1.12);
  }
  return { body, radius, elevation: preset?.elevation ?? 18 };
}

const OVERVIEW_FOV = 45;
function fitDistance(radius) {
  const vfov = OVERVIEW_FOV * DEG;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return radius / Math.sin(Math.min(vfov, hfov) / 2);
}

let focus = null;
let flight = null;
const lastFocus = new Vector3();

/** Where the camera should sit, relative to what it looks at. */
function offsetFor(view, keepAzimuth) {
  const dist = fitDistance(view.radius);
  let azimuth;
  // Directions come from real positions: they're the same as the overview's,
  // and stay right while coming back from the view from a body.
  if (view.body.id === "sun") {
    // Keep turning from where we are, or start looking over Earth's shoulder.
    const from = keepAzimuth ? camera.position.clone().sub(controls.target) : system.real.get("earth").clone();
    azimuth = Math.atan2(from.x, from.z) + (keepAzimuth ? 0 : 25 * DEG);
  } else {
    // Look from partway round towards the Sun, so you see day and night.
    // Try a few angles and take the first one with no other planet in the way.
    const toSun = system.real.get(view.body.id).clone().negate();
    const sunAz = Math.atan2(toSun.x, toSun.z);
    const tries = [70, -70, 110, -110, 40, -40].map((d) => sunAz + d * DEG);
    azimuth = pov.id ? tries[0] : (tries.find((az) => !blocked(view, offsetAt(az, view.elevation, dist))) ?? tries[0]);
  }
  return offsetAt(azimuth, view.elevation, dist);
}

function offsetAt(azimuth, elevationDeg, dist) {
  const el = elevationDeg * DEG;
  return new Vector3(Math.sin(azimuth) * Math.cos(el), Math.sin(el), Math.cos(azimuth) * Math.cos(el)).multiplyScalar(dist);
}

/** Would another planet (or the Sun) sit in view between the camera and what it's looking at? */
function blocked(view, offset) {
  const target = view.body.group.position;
  const cam = target.clone().add(offset);
  const dir = offset.clone().negate().normalize();
  const len = offset.length();
  const halfFov = (OVERVIEW_FOV / 2) * DEG * Math.max(1, camera.aspect);
  for (const b of bodies.values()) {
    if (b === view.body || b.kind === "moon") continue;
    const rel = b.group.position.clone().sub(cam);
    const along = rel.dot(dir);
    if (along < 0 || along > len) continue;
    if (rel.angleTo(dir) < halfFov + Math.atan(b.radius / rel.length())) return true;
  }
  return false;
}

function flyTo(id, instant = false) {
  const galaxy = galaxyOf(id);
  if (galaxy) return goToGalaxy(galaxy, instant);
  if (away.stage) return comeHome(id, instant);
  away.home = id; // where Back goes from a galaxy
  const from = viewpoint(id);
  if (from) return enterPov(from, instant);
  lastLookView = id;
  if (pov.id) return leavePov(id, instant);
  const view = viewFor(id);
  const offset = offsetFor(view, focus?.body.id === "sun" && view.body.id === "sun");
  controls.minDistance = view.body.radius * 1.4;
  focus = view;
  lastFocus.copy(view.body.group.position);
  if (instant) {
    controls.target.copy(view.body.group.position);
    camera.position.copy(controls.target).add(offset);
    flight = null;
    return;
  }
  flight = {
    start: performance.now(),
    duration: 2200,
    fromTarget: controls.target.clone(),
    fromOffset: camera.position.clone().sub(controls.target),
    toOffset: offset,
  };
  controls.enabled = false;
}

// --- Going out to the galaxies and back ---
const TURN_MS = 1100;
const DIP_MS = 400;

function goToGalaxy(id, instant) {
  if (away.stage === "there" || away.stage === "returning") {
    // Already out here: fly across.
    leaveInner();
    away.dive = null;
    away.stage = "there";
    away.galaxy = id;
    away.then = null;
    lg.flyTo(id, { instant });
    if (instant) enterInner();
    return;
  }
  settleMoves();
  away.galaxy = id;
  controls.enabled = false;
  povCam.state.enabled = false;
  if (instant) {
    arriveAmongGalaxies(true);
    return;
  }
  // Turn to face it first.
  away.stage = "leaving";
  away.start = performance.now();
  away.fromTurn.copy(camera.quaternion);
  const dir = lg.places.get(id).dir;
  away.toTurn.setFromRotationMatrix(lookMatrix.lookAt(camera.position, camera.position.clone().add(dir), camera.up));
}

/** Switches the screen over to the galaxies, at the Sun's spot looking towards the galaxy. */
function arriveAmongGalaxies(instant) {
  away.stage = "there";
  away.arrived = instant ? -Infinity : Infinity; // the fade-in starts once the first picture is drawn
  ui.setAway(lg.places);
  const dir = lg.places.get(away.galaxy).dir;
  const start = { position: new Vector3(), quaternion: new Quaternion().setFromRotationMatrix(lookMatrix.lookAt(new Vector3(), dir, lg.places.get("milkyway").up)) };
  lg.flyTo(away.galaxy, instant ? { instant: true } : { from: start });
  if (instant) enterInner();
}

// --- Diving into a star's own system ---
const DIVE_MS = 700;
/** Goes down from the galaxy view into the planets of the star we've flown up to. */
function enterSystem() {
  const place = lg.places.get(away.galaxy);
  if (!place?.system) return;
  away.scene = "system";
  away.dive = null;
  ex.show(place.system);
  lg.controls.enabled = false;
  ex.controls.enabled = true;
  ui.setAway(ex.places, true);
  const info = ex.info;
  const ly = info.ly < 100 ? info.ly.toFixed(1) : Math.round(info.ly).toLocaleString("en-US");
  showCaption(info.name, [info.about, info.zone ? "Green band: the habitable zone, where water could stay liquid." : "", `Sizes, years and heat are real (Open Exoplanet Catalogue); how the planets look is made up. ${ly} light-years away.`]);
  away.arrived = away.arrived === -Infinity ? -Infinity : Infinity; // fade in once the first picture is drawn
}
/** Down into whatever we've flown up to: a star's planets, or the Gate. */
function enterInner() {
  const place = lg.places.get(away.galaxy);
  if (place?.system) enterSystem();
  else if (place?.gate) enterGate();
}
/** Back up out of a system, or back through the Gate. */
function leaveInner() {
  if (away.scene === "system") leaveSystem();
  else if (away.scene === "elsewhere") leaveGate();
}

// --- Through the Gate ---
const noPlaces = new Map();
function enterGate() {
  away.scene = "elsewhere";
  away.dive = null;
  beyond.show();
  lg.controls.enabled = false;
  beyond.controls.enabled = true;
  ui.setAway(noPlaces);
  const note = (n) => showCaption(beyond.info.name, [beyond.info.about, n ? `Doorways passed: ${n}` : "Made up. Nothing here exists."]);
  note(0);
  beyond.onDimension = note;
  away.arrived = away.arrived === -Infinity ? -Infinity : Infinity; // fade in once the first picture is drawn
}
function leaveGate() {
  away.scene = "galaxies";
  away.dive = null;
  beyond.controls.enabled = false;
  ui.setAway(lg.places);
  showCaption(null);
  lg.controls.enabled = !lg.flying;
}
/** Back up from a system to the galaxy view, where the star is. */
function leaveSystem() {
  away.scene = "galaxies";
  away.dive = null;
  ex.controls.enabled = false;
  ui.setAway(lg.places);
  showCaption(null);
  lg.controls.enabled = !lg.flying;
}

/** Heads back to the solar system, to view `id`. */
function comeHome(id, instant) {
  away.then = id;
  if (instant) {
    finishHome();
    return;
  }
  if (away.stage === "leaving") {
    // Changed our mind while turning to go: turn back, then carry on from there.
    away.stage = "unturning";
    away.start = performance.now();
    away.fromTurn.copy(camera.quaternion);
    return;
  }
  if (away.stage === "returning" || away.stage === "unturning") return;
  leaveInner();
  away.dive = null;
  away.stage = "returning";
  lg.flyTo("home");
}

/** Turning back after changing our mind: from where the turn got to, back to the usual view. */
function unturnFrame(now) {
  const t = Math.min(1, (now - away.start) / (TURN_MS * 0.7));
  turnTo.copy(camera.quaternion); // where the usual camera move just put it
  camera.quaternion.slerpQuaternions(away.fromTurn, turnTo, ease(t));
  setFade(Math.min(fadeShown, 1 - t));
  if (t < 1) return;
  const id = away.then;
  away.stage = null;
  away.then = null;
  povCam.state.enabled = Boolean(pov.id) && !pov.leaving;
  controls.enabled = !pov.id && !flight;
  if (id && id !== away.home) flyTo(id, false);
  ui.sync();
}
const turnTo = new Quaternion();

function finishHome() {
  const id = away.then ?? away.home;
  const wasThere = away.stage !== "leaving";
  away.stage = null;
  away.then = null;
  if (wasThere) away.arrived = performance.now();
  lg.controls.enabled = false;
  lg.release();
  leaveInner();
  ui.setAway(null);
  showCaption(null);
  flyTo(id, true);
  // Whatever flyTo didn't take over, give back.
  povCam.state.enabled = Boolean(pov.id) && !pov.leaving;
  controls.enabled = !pov.id && !flight;
  ui.sync();
}

/** Brings any camera move in the solar system straight to its end. */
function settleMoves() {
  if (tween) {
    if (tween.kind === "out") finishLeaving(tween.view, tween.offset);
    else {
      tween = null;
      pov.from = null;
      pov.blend = 1;
      system.setGround(pov.id);
    }
  }
  if (flight) {
    controls.target.copy(focus.body.group.position);
    camera.position.copy(controls.target).add(flight.toOffset);
    flight = null;
  }
}

/** Turning to leave: the solar system carries on while the camera turns to face the galaxy, then the screen dips to black. */
function leavingFrame(now) {
  const t = Math.min(1, (now - away.start) / TURN_MS);
  camera.quaternion.slerpQuaternions(away.fromTurn, away.toTurn, ease(t));
  setFade((now - away.start - TURN_MS) / DIP_MS);
  if (now - away.start >= TURN_MS + DIP_MS) arriveAmongGalaxies(false);
}

/** One frame out among the galaxies. Returns false if that's just ended (home again). */
function galaxyFrame(now) {
  if (away.scene === "system") return systemFrame(now);
  if (away.scene === "elsewhere") return elsewhereFrame(now);
  const t = lg.update(now, settings.drift && !reducedMotion);
  // Arrived at a star with planets: sink into it.
  if (away.stage === "there" && t >= 1 && !lg.flying && (lg.places.get(away.galaxy)?.system || lg.places.get(away.galaxy)?.gate)) {
    away.dive ??= now;
    setFade((now - away.dive) / DIVE_MS);
    if (now - away.dive >= DIVE_MS) {
      enterInner();
      away.arrived = Infinity;
    }
  }
  if (away.stage === "returning") {
    setFade((t - 0.8) / 0.2);
    if (t >= 1) {
      finishHome();
      return false;
    }
  } else setFade(1 - (now - away.arrived) / DIP_MS);
  renderer.autoClear = true;
  lg.render(renderer, 1000 / settings.fps);
  // Getting ready (making the stars, the first picture) is done in the dark.
  if (away.arrived === Infinity) away.arrived = performance.now();
  ui.updateAwayLabels(lg.camera, innerWidth, innerHeight, away.stage === "there" ? away.galaxy : null);
  return true;
}

/** One frame on the other side of the Gate. */
let lastBeyondFrame = 0;
function elsewhereFrame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - (lastBeyondFrame || now)) / 1000));
  lastBeyondFrame = now;
  beyond.update(dt, now, settings.drift && !reducedMotion);
  setFade(1 - (now - away.arrived) / DIP_MS);
  renderer.autoClear = true;
  beyond.render(renderer, 1000 / settings.fps);
  if (away.arrived === Infinity) away.arrived = performance.now();
  return true;
}

/** One frame among the planets of another star. */
let lastSystemFrame = 0;
function systemFrame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - (lastSystemFrame || now)) / 1000));
  lastSystemFrame = now;
  ex.update(dt, now, settings.drift && !reducedMotion);
  setFade(1 - (now - away.arrived) / DIP_MS);
  renderer.autoClear = true;
  renderer.render(ex.scene, ex.camera);
  if (away.arrived === Infinity) away.arrived = performance.now();
  ui.updateAwayLabels(ex.camera, innerWidth, innerHeight, null);
  return true;
}

let fadeShown = 0;
function setFade(v) {
  v = Math.min(1, Math.max(0, v));
  if (v === fadeShown) return;
  fadeShown = v;
  fadeEl.style.opacity = String(v);
}
const fadeEl = document.getElementById("fade");

// --- The view from a body ---
// pov.id is the body we stand on (or are leaving). A change of view blends
// from pov.from (a description of what was on screen when it started) to the
// new layout, with pov.blend running 0 -> 1 alongside the camera move.
const pov = { id: null, leaving: false, from: null, blend: 1, camOffset: new Vector3() }; // camOffset: camera relative to the ground body, for centring the sky
const povCam = createPovCamera(renderer.domElement);
const povPose = povCam.newPose();
let tween = null; // camera move into, out of, or between views from a body
let settle = false; // just jumped onto a body: lay the sky out again once the camera is there
const Y_UP = new Vector3(0, 1, 0);
const lookMatrix = new Matrix4();
const MOVE_MS = 2600;

/**
 * What's on screen now, for a new change of view to start from: the overview,
 * a body's sky, or (if a change is already under way) exactly where everything
 * is drawn. `belts` says where the asteroids start, as they can't be snapshotted.
 */
function onScreen() {
  const target =
    pov.id && !pov.leaving
      ? { kind: "sky", id: pov.id, offset: system.skyAnchor.clone().sub(system.overviews.get(pov.id)) }
      : { kind: "overview", ground: pov.id ? null : nextTo([...bodies.keys()]) };
  if (!tween) return target;
  const before = pov.from?.kind === "snapshot" ? pov.from.belts : pov.from;
  return {
    kind: "snapshot",
    map: system.snapshot(),
    share: system.overviewShare,
    ground: nextTo([tween?.left, pov.id]), // the one it's leaving or the one it's reaching
    belts: pov.blend > 0.5 || !before ? target : before,
  };
}

/** Of the bodies `ids`, the one the camera is right next to, if any. */
function nextTo(ids) {
  let best = null;
  let closest = 14; // in the body's radii: as high as you can go standing on one
  for (const id of ids) {
    const b = id && id !== "sun" && bodies.get(id);
    if (!b) continue;
    const d = camera.position.distanceTo(b.group.position) / (b.radius * b.group.scale.x);
    if (d < closest) [best, closest] = [id, d];
  }
  return best;
}

/** Starts a camera move from where it is now. `left`: the body the camera starts next to, if any. */
function startTween(kind, left, extra) {
  tween = {
    kind,
    start: performance.now(),
    duration: MOVE_MS,
    from: camPose(),
    left,
    leftStart: left && bodies.get(left).group.position.clone(),
    ...extra,
  };
}

/** The body the camera is next to as a change of view starts. */
const startingGround = (from) => (from?.kind === "sky" ? from.id : (from?.ground ?? null));

function enterPov(id, instant) {
  if (id === pov.id && !pov.leaving) return; // already there or on the way
  const returning = id === pov.id; // changed our mind while leaving
  pov.from = instant ? null : onScreen();
  let left = startingGround(pov.from);
  if (left === id) left = null;
  pov.id = id;
  pov.leaving = false;
  pov.blend = instant ? 1 : 0;
  focus = { body: bodies.get(id), radius: 1, elevation: 0 };
  system.setGround(id, left); // the body we're leaving keeps its fine sphere until we're away
  if (instant) settle = true;
  if (!returning) povCam.reset(bodies.get(id).kind === "moon", povFov(camera.aspect), camera.aspect);
  povCam.state.enabled = true;
  controls.enabled = false;
  flight = null;
  if (instant) tween = null;
  else startTween("in", left, { center: bodies.get(id).group.position.clone() });
  sharpen(id);
}

function leavePov(viewId, instant) {
  const view = viewFor(viewId);
  focus = view;
  povCam.state.enabled = false;
  const offset = offsetFor(view, false);
  if (instant) {
    finishLeaving(view, offset);
    return;
  }
  pov.from = onScreen();
  const left = startingGround(pov.from);
  pov.leaving = true;
  pov.blend = 0;
  system.setGround(pov.id, left !== pov.id ? left : null);
  startTween("out", left, { view, offset, center: view.body.group.position.clone() });
}

function finishLeaving(view, offset) {
  system.setGround(null);
  pov.id = pov.from = null;
  pov.leaving = false;
  pov.blend = 1;
  tween = null;
  camera.up.copy(Y_UP);
  camera.layers.set(0);
  controls.target.copy(view.body.group.position);
  camera.position.copy(controls.target).add(offset);
  controls.minDistance = view.body.radius * 1.4;
  controls.enabled = true;
  lastFocus.copy(view.body.group.position);
  camera.near = 0.01;
  camera.fov = OVERVIEW_FOV;
  camera.updateProjectionMatrix();
}

function camPose() {
  return { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, near: camera.near };
}

const aim = new Vector3();
/** Where the camera wants to be in the view from `pov.id` right now. */
function povTarget() {
  const b = bodies.get(pov.id);
  // Planets: built around the Sun, low over the horizon. Moons: around their
  // planet, risen just clear of the horizon.
  let height = 14;
  if (b.kind === "moon") {
    const parent = b.parent.group;
    aim.subVectors(parent.position, b.group.position);
    const parentAngle = Math.atan((b.parent.radius * parent.scale.x) / aim.length()) / DEG;
    aim.normalize();
    height = Math.min(parentAngle * 0.85 + 5, 30);
  } else aim.copy(b.material.uniforms.sunDir.value);
  const ringPole = b.ring ? b.material.uniforms.ringNormal.value : null;
  return povCam.pose(b.group.position, b.radius * b.group.scale.x, aim, povFov(camera.aspect), povPose, height, ringPole);
}

const toTurn = new Quaternion();

/** Like three's slerp, but follows `b` as given rather than always taking the short way round. */
function slerpAlong(a, b, t, out) {
  const theta = Math.acos(MathUtils.clamp(a.dot(b), -1, 1));
  const s = Math.sin(theta);
  if (s < 1e-6) return out.copy(t < 0.5 ? a : b); // the same turn either way
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb, a.w * wa + b.w * wb).normalize();
}

const rel0 = new Vector3();
const ride = new Vector3();
const rel1 = new Vector3();
const dir0 = new Vector3();
/**
 * Moves the camera along a curve round `center`: the direction turns and the
 * distance shrinks or grows smoothly, so it never cuts through the body.
 */
function swing(center, fromPos, fromCenter, toPos, e) {
  rel0.subVectors(fromPos, fromCenter);
  rel1.subVectors(toPos, center);
  const d0 = Math.max(rel0.length(), 1e-6);
  const d1 = Math.max(rel1.length(), 1e-6);
  dir0.copy(rel0).divideScalar(d0);
  const q = new Quaternion().setFromUnitVectors(dir0, rel1.divideScalar(d1));
  const turned = dir0.applyQuaternion(new Quaternion().slerp(q, e));
  return camera.position.copy(center).addScaledVector(turned, Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e));
}

/** Runs the camera while in, or moving into or out of, the view from a body. */
function movePovCamera(now, dt) {
  const ground = bodies.get(pov.id);
  const groundR = ground.radius * ground.group.scale.x;
  if (tween) {
    const t = Math.min(1, (now - tween.start) / tween.duration);
    const e = ease(t);
    let to;
    let center;
    if (tween.kind === "in") {
      to = povTarget();
      to.fov = povFov(camera.aspect);
      center = ground.group.position;
    } else {
      center = tween.view.body.group.position;
      const position = center.clone().add(tween.offset);
      to = {
        position,
        quaternion: new Quaternion().setFromRotationMatrix(lookMatrix.lookAt(position, center, Y_UP)),
        fov: OVERVIEW_FOV,
        near: 0.01,
      };
    }
    swing(center, tween.from.position, tween.center, to.position, e);
    // At first, ride along with the body we start next to: at high speed it
    // carries on along its orbit (and the place we're heading for can swing
    // round the old sky), so it mustn't be left behind in the first frames.
    const left = tween.left && bodies.get(tween.left);
    if (left) {
      ride.copy(tween.from.position).add(left.group.position).sub(tween.leftStart);
      camera.position.lerpVectors(ride, camera.position, MathUtils.smoothstep(e, 0, 0.35));
    }
    // Never pass through anything on the way (the planet two of its moons go
    // round, say). Keep the near plane as far out as the nearest surface
    // allows: depth stays sharp, and no ground right under the camera gets
    // cut away.
    let gap = Infinity;
    for (const b of bodies.values()) {
      const r = b.radius * b.group.scale.x;
      if (camera.position.distanceTo(b.group.position) < r * 1.01) camera.position.sub(b.group.position).setLength(r * 1.01).add(b.group.position);
      gap = Math.min(gap, camera.position.distanceTo(b.group.position) - r);
    }
    // Turn towards where we're heading. That keeps moving (at high speed, or
    // if you drag), so follow it round smoothly rather than always taking the
    // short way, which would flip right round once it passes halfway.
    toTurn.copy(to.quaternion);
    if (toTurn.dot(tween.lastTurn ?? tween.from.quaternion) < 0) toTurn.set(-toTurn.x, -toTurn.y, -toTurn.z, -toTurn.w);
    tween.lastTurn = (tween.lastTurn ?? new Quaternion()).copy(toTurn);
    slerpAlong(tween.from.quaternion, toTurn, e, camera.quaternion);
    camera.fov = tween.from.fov + (to.fov - tween.from.fov) * e;
    camera.near = MathUtils.clamp(0.3 * gap, 0.0004, 0.01);
    camera.updateProjectionMatrix();
    if (t >= 1) {
      if (tween.kind === "out") finishLeaving(tween.view, tween.offset);
      else {
        tween = null;
        pov.from = null;
        pov.blend = 1;
        system.setGround(pov.id); // let go of the body we hopped from, if any
      }
    }
    return;
  }
  if (settings.drift && !reducedMotion) povCam.drift(dt);
  const p = povTarget();
  camera.position.copy(p.position);
  camera.quaternion.copy(p.quaternion);
  camera.up.copy(p.up);
  camera.fov = povFov(camera.aspect);
}

/** How far the change of view has got, from the camera move's progress. */
function updateBlend(now) {
  pov.blend = tween ? ease(Math.min(1, (now - tween.start) / tween.duration)) : 1;
}

/** What the asteroid belts should show (see belts.update). */
const beltsFrom = new Vector3();
function beltView() {
  if (!pov.id) return null;
  const sky = (d) => (d?.kind === "sky" ? { real: system.real.get(d.id), shown: beltsFrom.copy(system.overviews.get(d.id)).add(d.offset) } : null);
  const start = pov.from?.kind === "snapshot" ? pov.from.belts : pov.from;
  return {
    blend: pov.from ? pov.blend : 1,
    to: pov.leaving ? null : { real: system.real.get(pov.id), shown: system.skyAnchor },
    from: pov.from ? sky(start) : null,
  };
}

// Standing on a body, the view stays turned to the Sun (or the planet), so at
// fast speeds the stars sweep past. Past a point that's just a blur: fade them.
const lastTurn = new Quaternion();
let turnRate = 0;
let wasSteady = false;
function fadeStarsWhenSpinning(dt) {
  // Only time turning the view counts: not a camera jump, and not you looking around.
  const steady = Boolean(pov.id && !tween && !away.stage) && performance.now() - povCam.state.lastInput > 400 && !povCam.state.dragging;
  if (!steady || !wasSteady || dt <= 0) {
    turnRate = 0;
    sky.setStarFade(1);
  } else {
    const degPerSec = (lastTurn.angleTo(camera.quaternion) / DEG / dt) || 0;
    turnRate += (degPerSec - turnRate) * Math.min(1, dt * 3); // smoothed
    sky.setStarFade(1 - Math.min(1, Math.max(0, (turnRate - 10) / 50)));
  }
  wasSteady = steady;
  lastTurn.copy(camera.quaternion);
}

/** Where the sky is centred: on the camera once it's down near the ground, so directions are right from there. */
function updateSkyCentre() {
  if (!pov.id) return;
  const b = bodies.get(pov.id);
  const r = b.radius * b.group.scale.x;
  pov.camOffset.subVectors(camera.position, b.group.position);
  const d = pov.camOffset.length();
  pov.camOffset.multiplyScalar(Math.min(1, Math.max(0, (3 * r - d) / (1.5 * r))));
}

/**
 * Draws the frame. Standing on a body, the sky and the ground get separate
 * passes: one depth range can't cover both the ground a few metres away and
 * planets far off without things showing through each other.
 */
function render() {
  if (!pov.id || tween) {
    camera.layers.enableAll();
    renderer.autoClear = true;
    renderer.render(scene, camera);
    return;
  }
  const b = bodies.get(pov.id);
  const r = b.radius * b.group.scale.x;
  renderer.autoClear = false;
  renderer.clear();
  camera.layers.set(0);
  camera.near = 0.5;
  camera.far = 3000;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  renderer.clearDepth();
  camera.layers.set(1);
  camera.near = povPose.near;
  camera.far = r * (povCam.state.altitude + 4);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  camera.far = 3000;
}

// --- Strange sightings ---
// The stage (oddities/stage.js) runs them; this feeds it what it needs to know and
// says what each one was when it ends.
const strangeSpheres = [...bodies.values()].map((b) => ({ body: b, center: b.group.position, radius: 0 }));
const strangeView = { allowed: false, up: null, spheres: strangeSpheres };
let noteUntil = 0;

/** Shows (or clears) the note in the corner, and stops a sighting's note clearing it later. */
function showCaption(title, lines) {
  noteUntil = 0;
  ui.setCaption(title, lines);
}

stage.onEnd = (s) => {
  const lines = s.real ? [s.about] : [s.about.replace(/^An invented sighting: ([a-z])/, (_, c) => c.toUpperCase()), "None of it is real. It was made up for this wallpaper."];
  ui.setCaption(s.real ? s.name : `Made up: ${s.name}`, lines);
  noteUntil = performance.now() + 10000;
};

function strangeFrame(dt, now) {
  if (noteUntil && now > noteUntil) {
    noteUntil = 0;
    ui.setCaption(null);
  }
  strangeView.allowed = !away.stage && !tween && !flight && !settle;
  strangeView.up = pov.id ? camera.up : null;
  for (const s of strangeSpheres) {
    s.radius = s.body.radius * s.body.group.scale.x;
    s.clear = pov.id === s.body.id ? 1.03 : undefined; // standing on it: only the ground itself is in the way
  }
  stage.update(dt, camera, strangeView);
}

// --- Clicking a planet or moon ---
const raycaster = new Raycaster();
const pointer = new Vector2();
let press = null;
let quietUntil = 0; // ignore clicks for a moment after one (double-clicks on a desktop)
renderer.domElement.addEventListener("pointerdown", (e) => {
  press = e.button === 0 && e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
renderer.domElement.addEventListener("pointerup", (e) => {
  const now = performance.now();
  if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6 || now - press.t > 700) return;
  press = null;
  if (away.stage) {
    // Out among the galaxies: click one to fly to it, or the Milky Way to go home.
    if (away.scene === "elsewhere") return; // dragging is for looking round
    if (away.scene === "system") {
      // Down among the planets: click one to go to it, or the star (or space) to see them all.
      if (away.stage === "there" && now >= quietUntil) {
        quietUntil = now + 300;
        ex.flyTo(ex.pick(e.clientX, e.clientY)?.id ?? "star");
      }
      return;
    }
    const place = away.stage === "there" && !lg.flying && now >= quietUntil ? lg.pick(e.clientX, e.clientY) : null;
    if (!place) return;
    quietUntil = now + 400;
    if (place.id === "milkyway") goBack();
    else if (place.id !== away.galaxy) set("view", `galaxy-${place.id}`, { remember: false });
    return;
  }
  if (tween || now < quietUntil) return; // mid-flight, clicks would land on things that are moving
  const hit = pick(e.clientX, e.clientY, e.pointerType === "touch" ? 22 : 9);
  if (!hit) return;
  quietUntil = now + 400;
  visit(hit);
});

/** Where clicking (or tapping) a body takes you. */
function visit(body) {
  // The Sun's name takes you to look at it; its disc in the middle of the screen
  // is too easy to hit by accident, so clicking that does nothing.
  if (body.kind === "sun") return;
  set("view", `from-${body.id}`, { remember: false });
}

// Show which body a click would go to. Checked again every few frames while
// the pointer rests, as things move under it.
let resting = null; // where the mouse is, if it is over the canvas
let hoverChecked = 0;
renderer.domElement.addEventListener("pointermove", (e) => {
  resting = e.buttons || e.pointerType === "touch" ? null : { x: e.clientX, y: e.clientY };
  hoverChecked = 0;
});
renderer.domElement.addEventListener("pointerleave", () => (resting = null));
function updateHover(now) {
  if (now - hoverChecked < 200) return;
  hoverChecked = now;
  const awake = resting && !document.body.classList.contains("idle");
  if (away.stage) {
    const place = awake && away.stage === "there" && away.scene !== "elsewhere" ? (away.scene === "system" ? ex.pick(resting.x, resting.y) : !lg.flying ? lg.pick(resting.x, resting.y) : null) : null;
    renderer.domElement.classList.toggle("pointing", Boolean(place && (away.scene === "system" || place.id !== away.galaxy)));
    ui.hover(null);
    return;
  }
  const hit = awake && !tween ? pick(resting.x, resting.y, 9) : null;
  const target = hit && hit.kind !== "sun" ? hit : null;
  renderer.domElement.classList.toggle("pointing", Boolean(target));
  ui.hover(target?.id ?? null);
}

/**
 * The body under a screen point. Small or far ones get a few pixels of slack,
 * and planets win near-misses over their tiny moons (click a moon's name, or
 * zoom in, to get the moon).
 */
function pick(x, y, slack = 9) {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const ray = raycaster.ray;
  const pxPerWorld = (camera.projectionMatrix.elements[5] * innerHeight) / 2; // at distance 1
  // Standing on a body, anything behind the ground can't be clicked.
  let groundAt = Infinity;
  if (pov.id) {
    const g = bodies.get(pov.id);
    const hit = ray.intersectSphere(new Sphere(g.group.position, g.radius * g.group.scale.x), tmp);
    if (hit) groundAt = hit.distanceTo(camera.position);
  }
  let best = null;
  for (const b of bodies.values()) {
    if (b.id === pov.id || !b.mesh.visible) continue;
    const center = b.group.position;
    const along = tmp.subVectors(center, camera.position).dot(ray.direction);
    if (along <= 0 || along > groundAt) continue;
    const scale = pxPerWorld / along; // pixels per scene unit at that distance
    const off = Math.sqrt(ray.distanceSqToPoint(center)) * scale; // pixels from its centre
    const miss = off - b.radius * b.group.scale.x * scale; // pixels outside its edge
    const onRings = b.ring && off < b.radius * b.group.scale.x * 2.27 * scale; // Saturn's rings count too
    if (miss > slack && !onRings) continue;
    // A direct hit on the nearest disc wins; otherwise the closest near-miss
    // (or Saturn's rings), planets before their moons.
    const score = miss <= 0 ? -1e6 + along : (onRings ? 2 : miss) + (b.kind === "moon" ? 8 : 0);
    if (!best || score < best.score) best = { body: b, score };
  }
  return best?.body ?? null;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const tmp = new Vector3();

function moveCamera(now) {
  const focusPos = focus.body.group.position;
  if (flight) {
    const t = Math.min(1, (now - flight.start) / flight.duration);
    const e = ease(t);
    controls.target.lerpVectors(flight.fromTarget, focusPos, e);
    const d0 = flight.fromOffset.length();
    const d1 = flight.toOffset.length();
    tmp.lerpVectors(flight.fromOffset.clone().normalize(), flight.toOffset.clone().normalize(), e).normalize();
    tmp.multiplyScalar(Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e));
    camera.position.copy(controls.target).add(tmp);
    if (t >= 1) {
      flight = null;
      controls.enabled = true;
    }
  } else {
    // Ride along with whatever we're looking at.
    tmp.subVectors(focusPos, lastFocus);
    camera.position.add(tmp);
    controls.target.add(tmp);
  }
  lastFocus.copy(focusPos);
}

// --- Painting the planets' surfaces ---
const SURFACES = ["earth", "clouds", "milkyway", "moon", "jupiter", "saturn", "mars", "venus", "mercury", "uranus",
  "neptune", "pluto", "io", "europa", "ganymede", "callisto", "titan", "charon", "triton", "rhea", "iapetus",
  "phobos", "deimos", "miranda", "ariel", "umbriel", "titania", "oberon"];
const painters = []; // each one does a little work per frame if it has no worker
const sharpness = new Map(); // job -> width of the best map shown so far

function showSurface(job, images) {
  const name = job.split("@")[0];
  if ((sharpness.get(name) ?? 0) > images.map.width) return; // a sharper one already arrived
  sharpness.set(name, images.map.width);
  if (name === "milkyway") {
    const milky = texture(images.map);
    sky.setMilkyWay(milky);
    ex.setMilkyWay(milky);
  } else system.applySurface(name, images);
}

function startPaint(...first) {
  const order = [...SURFACES];
  for (const id of first.filter(Boolean).reverse()) if (order.includes(id)) order.unshift(...order.splice(order.indexOf(id), 1));
  painters.push(startPainting(order, showSurface, () => ui.doneLoading()));
}

/** The body you stand on fills half the screen, so paint it again in more detail. */
const SHARP = 2048;
const queued = new Set();
function sharpen(id) {
  const jobs = [id, ...(id === "earth" ? ["clouds"] : [])]
    .filter((j) => (sharpness.get(j) ?? 0) < SHARP && !queued.has(j))
    .map((j) => `${j}@${SHARP}`);
  for (const j of jobs) queued.add(j.split("@")[0]);
  if (jobs.length) painters.push(startPainting(jobs, showSurface, () => {}));
}

// --- The loop ---
const startTime = performance.now();
let lastFrame = startTime;
let lastTick = startTime;

/** Moves everything to `date` (and the asteroids). */
function layOut(date, dt, seconds) {
  system.update(date, dt, rate(), camera, innerHeight * pixelRatio, settings.orbits, seconds, pov.id ? pov : null);
  belts.update(A.MakeTime(date).tt, beltView());
}

/**
 * Straight after jumping onto a body with no move, the sky was laid out
 * round the old camera. Now the camera is in place, lay it out again round
 * the new one, so the first frame doesn't twitch.
 */
function settleSky(now, date, seconds) {
  settle = false;
  for (let i = 0; i < 2 && pov.id; i++) {
    layOut(date, 0, seconds);
    movePovCamera(now, 0);
    updateSkyCentre();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  for (const step of painters) step(10 / painters.length);
  const gap = 1000 / settings.fps;
  const elapsed = now - lastFrame;
  if (elapsed < gap - 1) return;
  lastFrame = now - (elapsed % gap) * (elapsed < gap * 2 ? 1 : 0);
  const dt = Math.min((now - lastTick) / 1000, 0.25);
  lastTick = now;

  tickClock(dt);
  ui.updateClock(clock.time, clock.synced && !settings.paused);
  if ((away.stage === "there" || away.stage === "returning") && galaxyFrame(now)) {
    updateHover(now);
    return;
  }
  if (!away.stage) setFade(1 - (now - away.arrived) / DIP_MS); // just home: the dip clears
  const date = new Date(clock.time);
  updateBlend(now);
  layOut(date, dt, (now - startTime) / 1000);
  for (const p of belts.parts) p.visible = settings.belts;

  if (pov.id) movePovCamera(now, dt);
  else {
    moveCamera(now);
    controls.autoRotate = settings.drift && !reducedMotion && !flight;
    controls.update(dt);
  }
  updateSkyCentre();
  if (settle) settleSky(now, date, (now - startTime) / 1000);
  // After the camera's usual move, so the turn wins.
  if (away.stage === "leaving") leavingFrame(now);
  else if (away.stage === "unturning") unturnFrame(now);
  fadeStarsWhenSpinning(dt);
  sky.group.position.copy(camera.position);
  sky.setEcliptic(settings.orbits ? 1 - system.overviewShare : 0);
  system.fitGlow(camera);
  strangeFrame(dt, now);

  render();
  const ground = pov.id && bodies.get(pov.id);
  // Label as seen from the ground only once we're down there (or on the way back up).
  const down = ground && (!tween || camera.position.distanceTo(ground.group.position) < 3 * ground.radius * ground.group.scale.x);
  ui.updateLabels(camera, innerWidth, innerHeight, down ? pov.id : null, down && new Sphere(ground.group.position, ground.radius * ground.group.scale.x), sky.fade);
  updateHover(now);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  lg.resize();
  ex.resize();
  beyond.resize();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Wallpaper apps ---
// Lively Wallpaper (Windows): see LivelyProperties.json next to index.html.
// Lists arrive as a position in the list, so turn those back into names.
// The View list there holds the "look at" views; "Look from" picks a body to
// see the sky from (or Nothing), so the wallpaper app's own setting is always
// the one that counts when it starts up again.
const LOOK_AT = VIEWS.filter((v) => !v.from);
const LOOK_FROM = VIEWS.filter((v) => v.from);
let livelyFrom = null;
let livelyLookAt = null; // what Look from: Nothing goes back to
window.livelyPropertyListener = (name, value) => {
  if (name === "back") return goBack();
  if (name === "from") {
    const view = typeof value === "number" ? LOOK_FROM[value - 1]?.id : value && value !== "none" ? `from-${value}` : null;
    livelyFrom = viewpoint(view) ? view : null;
    if (livelyFrom) set("view", livelyFrom);
    // Nothing: off the body, back to the Look at view (a galaxy picked there stays put).
    else if (viewpoint(settings.view)) set("view", livelyLookAt ?? lastLookView);
    return;
  }
  if (name === "view") {
    value = typeof value === "number" ? LOOK_AT[value]?.id : value;
    if (!value) return;
    livelyLookAt = value;
    if (livelyFrom && viewpoint(settings.view)) {
      // Look from is set and we're on a body: just remember it. (Back from a
      // body goes to a solar system view, never a galaxy.)
      if (!galaxyOf(value)) lastLookView = value;
      ui.sync();
      return;
    }
  }
  if (name === "speed") value = typeof value === "number" ? SPEEDS[value]?.id : value;
  if (name === "speed" && value === "live") goLive();
  else set(name, value);
};
// Wallpaper Engine (Windows): property names match the settings above.
window.wallpaperPropertyListener = {
  applyUserProperties(props) {
    for (const [name, p] of Object.entries(props)) if (p && "value" in p) window.livelyPropertyListener(name, p.value);
  },
};

// Handy for poking at things from the browser console.
window.solarSystem = { camera, controls, bodies, settings, clock, set, pov, povCam, system, sky, lg, ex, beyond, away, ui, stage, strangeView };

// Put everything in place for the first frame, then go.
system.update(new Date(clock.time), 0, rate(), camera, innerHeight * pixelRatio, settings.orbits, 0);
if (galaxyOf(settings.view)) flyTo(away.home, true); // set up the solar system to come back to
flyTo(settings.view, true);
if (settle) settleSky(performance.now(), new Date(clock.time), 0);
startPaint(focus.body.id, focus.body.kind === "moon" ? focus.body.parent.id : null);
requestAnimationFrame(frame);
