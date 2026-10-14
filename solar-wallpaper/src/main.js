// Starts everything: the renderer, the scene, the clock and the camera.
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as A from "astronomy-engine";
import { createBelts } from "./belts.js";
import { loadSettings, parse, save, SPEEDS, speedRate, VIEWS } from "./settings.js";
import { createSky } from "./sky.js";
import { createSystem, texture } from "./system.js";
import { startPainting } from "./painter.js";
import { createUI } from "./ui.js";

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
function set(key, value) {
  if (key === "view") {
    if (!VIEWS.some((v) => v.id === value) && !bodies.has(value)) return;
  } else {
    value = parse(key, value);
    if (value === undefined) return;
  }
  settings[key] = value;
  if (key === "view") flyTo(value);
  if (key === "speed" || key === "reverse") settings.paused = false;
  if (key === "speed" && value !== "live") clock.synced = false;
  save(settings);
  ui.sync();
}

function goLive() {
  Object.assign(settings, { speed: "live", reverse: false, paused: false });
  clock.time = Date.now();
  clock.synced = true;
  save(settings);
  ui.sync();
}

function jumpToNow() {
  clock.time = Date.now();
  clock.synced = settings.speed === "live" && !settings.reverse;
  settings.paused = false;
  ui.sync();
}

const ui = createUI({ settings, bodies, set, goLive, jumpToNow });

// --- Camera: views, smooth flights and following a planet ---
function viewFor(id) {
  const preset = VIEWS.find((v) => v.id === id);
  const body = bodies.get(preset?.target ?? id);
  let radius = preset?.radius;
  if (!radius) {
    const moonReach = Math.max(0, ...(body.moons ?? []).map((m) => m.group.position.distanceTo(body.group.position)));
    radius = Math.max(body.radius * (body.ring ? 4.5 : 3.2), moonReach * 1.12);
  }
  return { body, radius, elevation: preset?.elevation ?? 18 };
}

function fitDistance(radius) {
  const vfov = camera.fov * DEG;
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
  if (view.body.id === "sun") {
    // Keep turning from where we are, or start looking over Earth's shoulder.
    const from = keepAzimuth ? camera.position.clone().sub(controls.target) : bodies.get("earth").group.position.clone();
    azimuth = Math.atan2(from.x, from.z) + (keepAzimuth ? 0 : 25 * DEG);
  } else {
    // Look from partway round towards the Sun, so you see day and night.
    // Try a few angles and take the first one with no other planet in the way.
    const toSun = view.body.group.position.clone().negate();
    const sunAz = Math.atan2(toSun.x, toSun.z);
    const tries = [70, -70, 110, -110, 40, -40].map((d) => sunAz + d * DEG);
    azimuth = tries.find((az) => !blocked(view, offsetAt(az, view.elevation, dist))) ?? tries[0];
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
  const halfFov = (camera.fov / 2) * DEG * Math.max(1, camera.aspect);
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
let paintStep = () => {};

function startPaint(firstId) {
  const order = [...SURFACES];
  if (order.includes(firstId)) order.unshift(...order.splice(order.indexOf(firstId), 1));
  paintStep = startPainting(
    order,
    (job, images) => (job === "milkyway" ? sky.setMilkyWay(texture(images.map)) : system.applySurface(job, images)),
    () => ui.doneLoading(),
  );
}

// --- The loop ---
const startTime = performance.now();
let lastFrame = startTime;
let lastTick = startTime;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function frame(now) {
  requestAnimationFrame(frame);
  paintStep(10);
  const gap = 1000 / settings.fps;
  const elapsed = now - lastFrame;
  if (elapsed < gap - 1) return;
  lastFrame = now - (elapsed % gap) * (elapsed < gap * 2 ? 1 : 0);
  const dt = Math.min((now - lastTick) / 1000, 0.25);
  lastTick = now;

  tickClock(dt);
  const date = new Date(clock.time);
  system.update(date, dt, rate(), camera, innerHeight * pixelRatio, settings.orbits, (now - startTime) / 1000);
  belts.update(A.MakeTime(date).tt);
  for (const p of belts.parts) p.visible = settings.belts;

  moveCamera(now);
  controls.autoRotate = settings.drift && !reducedMotion && !flight;
  controls.update(dt);
  sky.group.position.copy(camera.position);
  system.fitGlow(camera.position.length());

  renderer.render(scene, camera);
  ui.updateClock(clock.time, clock.synced && !settings.paused);
  ui.updateLabels(camera, innerWidth, innerHeight);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Wallpaper apps ---
// Lively Wallpaper (Windows): see LivelyProperties.json next to index.html.
// Lists arrive as a position in the list, so turn those back into names.
window.livelyPropertyListener = (name, value) => {
  if (name === "speed") value = typeof value === "number" ? SPEEDS[value]?.id : value;
  if (name === "view") value = typeof value === "number" ? VIEWS[value]?.id : value;
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
window.solarSystem = { camera, controls, bodies, settings, clock, set };

// Put everything in place for the first frame, then go.
system.update(new Date(clock.time), 0, rate(), camera, innerHeight * pixelRatio, settings.orbits, 0);
flyTo(settings.view, true);
startPaint(focus.body.id);
requestAnimationFrame(frame);
