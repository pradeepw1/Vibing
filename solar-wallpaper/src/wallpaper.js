// The Wallpaper: the Sun and the nine planets where they really are, under the real
// sky (the stars, our galaxy, the near galaxies and the black holes), with the camera
// slowly going round. Made to cost as little battery as it can:
//   - no clicking, dragging or scrolling does anything: there is no code for it here;
//   - it draws only about 20 times a second, at a size no bigger than a 1080p screen needs;
//   - at real speed the planets are moved once a second, not every frame;
//   - it stops completely while the page is hidden.
// Space Scope (main.js) is the page for flying about. The two share the planets, the sky
// and the maps; everything that flies, picks or loads galaxies stays out of this file.
import { PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer } from "three";
import * as A from "astronomy-engine";
import { createBelts } from "./belts.js";
import { createMaps } from "./maps.js";
import { pageAddress, SCOPE_PAGE, scopeAddress, wantsScope } from "./modes.js";
import { SPEEDS, speedRate } from "./options.js";
import { startPainting } from "./painter.js";
import { createSky } from "./sky.js";
import { BLACK_HOLE_PLACES } from "./skyplaces.js";
import { createSystem, setAnisotropy, texture } from "./system.js";
import { placeCamera } from "./wallpaper-camera.js";
import { createLabels } from "./wallpaper-labels.js";
import { loadSettings, parse, save } from "./wallpaper-settings.js";

// An old full-app address (index.html?view=...) goes straight to Space Scope.
const there = scopeAddress(location.search);
if (there) location.replace(there);
else start();

function start() {
  const $ = (sel) => document.querySelector(sel);
  const MIN_TIME = Date.UTC(1600, 0, 1); // the moons' and Pluto's models are good for a few centuries either side of now
  const MAX_TIME = Date.UTC(2400, 0, 1);
  const LAYOUT_EVERY = 1000; // ms between moving the planets, when time runs at real speed
  const MAX_PIXELS = 4.2e6; // the most pixels drawn, however big the screen: 2560 x 1640

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = loadSettings(location.search, reducedMotion);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  } catch {
    $("#error").hidden = false;
    return;
  }
  const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.max(0.75, Math.sqrt(MAX_PIXELS / (innerWidth * innerHeight))));
  setAnisotropy(1);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 3000);
  const sky = createSky(pixelRatio, { places: BLACK_HOLE_PLACES });
  scene.add(sky.group);
  const system = createSystem(scene, pixelRatio);
  const belts = createBelts(pixelRatio);
  scene.add(...belts.parts);
  const bodies = [...system.bodies.values()];
  // From out here a planet is a few dozen pixels across, so the fine spheres Space Scope uses for close-ups are wasted:
  // lighter ones draw the same picture with a sixth of the triangles. The moons are left out (under a pixel each).
  const planetSphere = new SphereGeometry(1, 48, 24);
  const sunSphere = new SphereGeometry(1, 64, 32);
  const haloSphere = new SphereGeometry(1, 32, 16);
  for (const b of bodies) {
    if (b.kind === "moon") {
      b.group.visible = false;
      continue;
    }
    b.mesh.geometry = b.kind === "sun" ? sunSphere : planetSphere;
    if (b.halo) b.halo.geometry = haloSphere;
    if (b.clouds) b.clouds.geometry = planetSphere;
  }
  const sunMaterial = system.bodies.get("sun").mesh.material;
  const labels = createLabels({ box: $("#labels"), bodies, places: sky.galaxies });

  // --- The clock ---
  const clock = { time: settings.date ?? Date.now(), synced: settings.date === null };

  function tickClock(dt) {
    if (clock.synced && settings.speed === "live") {
      clock.time = Date.now();
      return;
    }
    clock.synced = false;
    clock.time += dt * 1000 * speedRate(settings.speed);
    if (clock.time < MIN_TIME || clock.time > MAX_TIME) goLive(); // ran off the end of the years the models cover
  }

  function goLive() {
    settings.speed = "live";
    clock.time = Date.now();
    clock.synced = true;
    store();
    sync();
  }

  // --- Settings ---
  const store = () => save(settings);
  let busyUntil = 0; // while a map is fading in the planets are moved every frame, so the fade is smooth

  /** Changes a setting, from the menu or a wallpaper app. Settings the Wallpaper doesn't have are ignored. */
  function set(key, value) {
    value = parse(key, value);
    if (value === undefined) return;
    if (key === "speed" && value === "live") return goLive();
    settings[key] = value;
    if (key === "speed") clock.synced = false;
    if (key === "photos") usePhotos(value);
    store();
    sync();
  }

  // --- The menu ---
  const panel = $("#panel");
  const menuButton = $("#menu-btn");
  const speedBox = $("#speeds");
  for (const s of SPEEDS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = s.label;
    b.dataset.speed = s.id;
    b.addEventListener("click", () => set("speed", s.id));
    speedBox.append(b);
  }
  const toggles = { "labels-on": "labels", "orbits-on": "orbits", "belts-on": "belts", "clock-on": "clock", "drift-on": "drift", "photos-on": "photos" };
  for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener("change", (e) => set(key, e.target.checked));

  const setOpen = (open) => {
    panel.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  };
  menuButton.addEventListener("click", () => setOpen(panel.hidden));
  addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  const goToScope = () => location.assign(pageAddress(SCOPE_PAGE, location.search));
  $("#mode-scope").addEventListener("click", goToScope);

  const clockBox = $("#clock");
  const labelsBox = $("#labels");
  function sync() {
    for (const b of speedBox.children) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));
    for (const [id, key] of Object.entries(toggles)) $(`#${id}`).checked = settings[key];
    menuButton.hidden = !settings.ui;
    if (!settings.ui) setOpen(false);
    clockBox.hidden = !settings.clock;
    labelsBox.hidden = !settings.labels;
    lastText = ""; // the clock's note may have changed
    busyUntil = Math.max(busyUntil, performance.now() + 100); // lay the planets out again at once
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  const shortTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  let lastText = "";
  let lastClockDraw = -Infinity;
  /** Writes the date and time in the corner (a few times a second is plenty). */
  function drawClock(now) {
    if (!settings.clock || now - lastClockDraw < 250) return;
    lastClockDraw = now;
    const d = new Date(clock.time);
    const fast = settings.speed !== "live" && settings.speed !== "minute";
    const status = clock.synced ? "Live" : settings.speed === "live" ? "Real speed" : SPEEDS.find((s) => s.id === settings.speed).label;
    const text = [dateFormat.format(d), (fast ? shortTimeFormat : timeFormat).format(d), status].join("|");
    if (text === lastText) return;
    lastText = text;
    const [date, time, rate] = text.split("|");
    $("#clock .date").textContent = date;
    $("#clock .time").textContent = time;
    $("#clock .rate-text").textContent = rate;
    $("#clock .dot").classList.toggle("off", !clock.synced);
  }

  // --- Painting and the real maps ---
  // The Milky Way has no real map, so it is painted. With real maps on, the planets are painted only
  // where a map is missing; with them off, all of them are.
  const SURFACES = ["earth", "clouds", "milkyway", "moon", "jupiter", "saturn", "mars", "venus", "mercury", "uranus",
    "neptune", "pluto", "io", "europa", "ganymede", "callisto", "titan", "charon", "triton", "rhea", "iapetus",
    "phobos", "deimos", "miranda", "ariel", "umbriel", "titania", "oberon"];
  const painters = [];
  const painting = new Set(); // jobs given to a painter, so none is painted twice

  function showSurface(job, images) {
    if (job === "milkyway") sky.setMilkyWay(texture(images.map));
    else system.applySurface(job, images);
  }
  function paintJobs(jobs, onDone = () => {}) {
    const todo = jobs.filter((j) => !painting.has(j));
    for (const j of todo) painting.add(j);
    if (todo.length) painters.push(startPainting(todo, showSurface, onDone));
    else onDone();
  }

  let paintDone = false;
  let mapsDone = false;
  let loadedShown = false;
  function checkLoaded() {
    if (paintDone && mapsDone && !loadedShown) {
      loadedShown = true;
      $("#loading").classList.add("done");
    }
  }

  const photos = createMaps({
    renderer,
    system,
    enabled: settings.photos,
    onSettled: () => {
      mapsDone = true;
      busyUntil = performance.now() + 3000; // the last map is still fading in
      checkLoaded();
    },
    onMissing: (id) => SURFACES.includes(id) && paintJobs([id]),
  });

  /** Real maps on or off, from the menu. Off, whatever isn't painted yet gets painted. */
  function usePhotos(on) {
    photos.setEnabled(on);
    busyUntil = performance.now() + 3000;
    if (!photos.enabled) {
      paintJobs(SURFACES, () => {
        mapsDone = true;
        checkLoaded();
      });
    }
  }

  paintJobs(photos.enabled ? ["milkyway"] : SURFACES, () => {
    paintDone = true;
    checkLoaded();
  });

  // --- The loop ---
  const startTime = performance.now();
  let lastTick = startTime;
  let lastFrame = startTime;
  let lastLayout = -Infinity;
  let cameraTime = 0; // seconds the camera has been going round (it stands still while that is switched off)
  let photosStarted = false;
  let waiting = false;

  /** Moves the planets, moons and asteroids to the clock's date. */
  function layOut(now, date) {
    const dt = Math.min((now - Math.max(lastLayout, startTime)) / 1000, 1);
    system.update(date, dt, speedRate(settings.speed), camera, innerHeight * pixelRatio, settings.orbits, (now - startTime) / 1000);
    belts.update(A.MakeTime(date).tt, null);
    for (const p of belts.parts) p.visible = settings.belts;
    lastLayout = now;
  }

  function frame(now) {
    waiting = false;
    for (const step of painters) step(10 / painters.length);
    const dt = Math.min((now - lastTick) / 1000, 0.25);
    const elapsed = now - lastFrame;
    lastTick = lastFrame = now;

    tickClock(dt);
    if (settings.speed !== "live" || now < busyUntil || !loadedShown || now - lastLayout >= LAYOUT_EVERY) layOut(now, new Date(clock.time));
    sunMaterial.uniforms.time.value = (now - startTime) / 1000; // the Sun's surface keeps moving between layouts

    if (settings.drift) cameraTime += dt;
    placeCamera(camera, cameraTime);
    sky.group.position.copy(camera.position);
    system.fitGlow(camera);
    renderer.render(scene, camera);

    if (settings.labels) labels.update(camera, innerWidth, innerHeight);
    drawClock(now);
    photos.update(camera, now, elapsed, 1000 / settings.fps);
    if (!photosStarted) {
      photosStarted = true;
      photos.start();
    }
    schedule();
  }

  /**
   * The next frame: wait out the rest of this one's time, then draw on the screen's next refresh.
   * While the page is hidden the refresh never comes, so nothing runs until it is shown again.
   */
  function schedule() {
    if (waiting || document.hidden) return;
    waiting = true;
    const wait = Math.max(0, 1000 / settings.fps - (performance.now() - lastFrame) - 8);
    setTimeout(() => requestAnimationFrame(frame), wait);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // Shown again: don't count the time away as one long frame.
    lastTick = lastFrame = performance.now();
    if (!waiting) schedule();
  });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (!document.hidden && !waiting) schedule();
    else busyUntil = performance.now() + 100; // hidden: draw once when it comes back
  });

  // --- Wallpaper apps ---
  // Lively (Windows) and Wallpaper Engine push their settings in by name. Only the Wallpaper's own are used.
  // The Mode setting switches to Space Scope; what a wallpaper app pushes in as the page starts is ignored
  // (the page that opens is always Wallpaper, which is the easy one on battery).
  window.livelyPropertyListener = (name, value) => {
    if (name === "mode") {
      if (wantsScope(value) && performance.now() > 4000) goToScope();
      return;
    }
    if (name === "speed" && typeof value === "number") value = SPEEDS[value]?.id;
    set(name, value);
  };
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      for (const [name, p] of Object.entries(props)) if (p && "value" in p) window.livelyPropertyListener(name, p.value);
    },
  };

  // Handy for poking at things from the browser console.
  window.solarWallpaper = {
    camera, settings, clock, system, sky, renderer, photos, set, labels,
    seek: (seconds) => (cameraTime = seconds), // jump the camera along its path
  };

  // Put everything in place for the first frame, then go.
  sync();
  layOut(performance.now(), new Date(clock.time));
  placeCamera(camera, 0);
  system.fitGlow(camera);
  sky.group.position.copy(camera.position);
  schedule();
}
