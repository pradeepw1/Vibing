// The Wallpaper: the Sun and the nine planets where they really are, under the real sky
// (the stars, our galaxy, the near galaxies and the black holes), with the camera slowly
// going round. Made to cost as little battery as it can:
//   - no clicking, dragging or scrolling does anything: there is no code for it here;
//   - it draws about 20 times a second (and once a second when nothing is moving), at a
//     size that never goes past about 2.5 million pixels;
//   - at real speed the planets are moved once a second, not every frame;
//   - it stops completely while the page is hidden.
// Space Scope (main.js) is the page for flying about. The two share the planets, the sky
// and the maps; everything that flies, picks or loads galaxies stays out of this file.
import { PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer } from "three";
import * as A from "astronomy-engine";
import { createBelts } from "./belts.js";
import { createMaps } from "./maps.js";
import { createModeGate, pageAddress, SCOPE_PAGE, scopeAddress, wantsScope } from "./modes.js";
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
  const LAYOUT_EVERY = 1000; // ms between moving the planets (and drawing, when nothing else moves), at real speed
  const MAX_PIXELS = 2.5e6; // the most pixels drawn, however big the screen is (a 1080p screen is 2.1 million)
  const EARLY = 4; // ms: a frame this much early is still on time

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = loadSettings(location.search, reducedMotion);

  // How much to scale the drawing: the screen's own sharpness, but never so many pixels that a big screen costs a lot more.
  const fitRatio = () => Math.max(0.35, Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / Math.max(1, innerWidth * innerHeight))));
  let pixelRatio = fitRatio();

  // An opaque drawing surface (the sky fills every pixel, so there is nothing to blend with the page behind), and
  // smoothing of edges only where the screen isn't sharp enough to hide them.
  let renderer;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { alpha: false, antialias: pixelRatio < 1.5, depth: true, stencil: false, powerPreference: "low-power" });
    if (!context) throw new Error("WebGL is not available");
    renderer = new WebGLRenderer({ canvas, context });
  } catch {
    $("#error").hidden = false;
    for (const id of ["#loading", "#clock", "#menu-btn", "#panel"]) $(id).hidden = true; // nothing to show or to set
    return;
  }
  setAnisotropy(1);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 3000);
  const sky = createSky(pixelRatio, { places: BLACK_HOLE_PLACES });
  sky.cullGalaxies();
  scene.add(sky.group);
  const system = createSystem(scene, pixelRatio);
  const belts = createBelts(pixelRatio);
  scene.add(...belts.parts);
  const bodies = [...system.bodies.values()];
  const planetSpots = bodies.filter((b) => b.kind === "planet").map((b) => b.group.position); // (these are the objects the planets move, so they stay current)
  const moonIds = new Set(bodies.filter((b) => b.kind === "moon").map((b) => b.id));
  // From out here a planet is a few dozen pixels across, so the fine spheres Space Scope uses for close-ups are wasted:
  // lighter ones draw the same picture with far fewer triangles. The moons are left out (under a pixel each), and
  // so are their maps. The night side of a planet is a little less black than in Space Scope, so a planet standing
  // between us and the Sun still reads as a planet.
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
    if (b.kind === "planet") b.material.uniforms.ambient.value = 0.03;
  }
  const sunMaterial = system.bodies.get("sun").mesh.material;
  const labels = createLabels({
    box: $("#labels"),
    bodies,
    places: sky.galaxies,
    // Names stay off the clock and the settings button.
    avoid: () =>
      ["#clock", "#menu-btn"]
        .map((sel) => $(sel))
        .filter((el) => el && !el.hidden)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 };
        }),
  });

  // --- The clock ---
  const clock = { time: settings.date ?? Date.now(), synced: settings.date === null };

  function tickClock(dt) {
    if (clock.synced && settings.speed === "live") {
      clock.time = Date.now();
      return;
    }
    clock.synced = false;
    clock.time += dt * 1000 * speedRate(settings.speed);
    if (clock.time < MIN_TIME || clock.time > MAX_TIME) goLive(false); // ran off the end of the years the models cover
  }

  /** Back to real time. `remember`: false when it isn't something the person chose. */
  function goLive(remember = true) {
    settings.speed = "live";
    clock.time = Date.now();
    clock.synced = true;
    if (remember) save({ speed: "live" });
    sync();
  }

  // --- Settings ---
  let busyUntil = 0; // while a map is fading in, or just after a change, the planets are moved every frame

  /** Changes a setting, from the menu or a wallpaper app. Settings the Wallpaper doesn't have are ignored. */
  function set(key, value) {
    value = parse(key, value);
    if (value === undefined) return;
    if (key === "speed" && value === "live") return goLive();
    settings[key] = value;
    if (key === "speed") clock.synced = false;
    if (key === "photos") usePhotos(value);
    save({ [key]: value });
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
  // A click anywhere else puts the menu away (it does nothing else: the picture ignores clicks).
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !menuButton.contains(e.target)) setOpen(false);
  });
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
    labels.invalidate(); // the clock or the button may have appeared or gone
    busyUntil = Math.max(busyUntil, performance.now() + 100); // lay the planets out again at once
    reschedule(); // the pace may have changed (the camera stopped, or time sped up)
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
    labels.invalidate(); // the clock's size may have changed
  }

  // --- Painting and the real maps ---
  // The Milky Way has no real map, so it is painted. With real maps on, the planets are painted only
  // where a map is missing; with them off, all of them are. (Moons aren't drawn, so they get neither.)
  const SURFACES = ["earth", "clouds", "milkyway", "jupiter", "saturn", "mars", "venus", "mercury", "uranus", "neptune", "pluto"];
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
    skip: moonIds,
    onSettled: () => {
      mapsDone = true;
      busyUntil = performance.now() + 1000; // the last map may still be fading in (the fade is followed through, see `system.fading`)
      checkLoaded();
    },
    onMissing: (id) => SURFACES.includes(id) && paintJobs([id]),
  });

  /** Real maps on or off, from the menu. Off, whatever isn't painted yet gets painted. */
  function usePhotos(on) {
    photos.setEnabled(on);
    busyUntil = performance.now() + 1000;
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
  let waiting = false; // a frame is on its way
  let timer = 0; // the wait before it (0 once the screen's next refresh is what is being waited for)
  let failed = false;

  /** Is anything on the picture moving? If not, once a second is all it needs. */
  const still = (now) => !settings.drift && settings.speed === "live" && loadedShown && now >= busyUntil && !system.fading;
  const frameGap = (now) => (still(now) ? LAYOUT_EVERY : 1000 / settings.fps);

  /** Moves the planets and the asteroids to the clock's date. */
  function layOut(now, date) {
    const dt = Math.min((now - Math.max(lastLayout, startTime)) / 1000, 1);
    system.update(date, dt, speedRate(settings.speed), camera, innerHeight * pixelRatio, settings.orbits, (now - startTime) / 1000);
    belts.update(A.MakeTime(date).tt, null);
    for (const p of belts.parts) p.visible = settings.belts;
    lastLayout = now;
  }

  /** Puts the camera on its path and draws. */
  function draw() {
    placeCamera(camera, cameraTime, undefined, planetSpots);
    sky.group.position.copy(camera.position);
    system.fitGlow(camera);
    renderer.render(scene, camera);
    if (settings.labels) labels.update(camera, innerWidth, innerHeight);
  }

  function frame() {
    waiting = false;
    timer = 0;
    try {
      const now = performance.now();
      const gap = frameGap(now);
      if (now - lastFrame < gap - EARLY) return; // early (a screen that refreshes faster than 60 times a second): wait for the next one
      const dt = Math.min((now - lastTick) / 1000, 0.25);
      const elapsed = now - lastFrame;
      lastTick = lastFrame = now;

      tickClock(dt);
      if (settings.speed !== "live" || now < busyUntil || !loadedShown || system.fading || now - lastLayout >= LAYOUT_EVERY) layOut(now, new Date(clock.time));
      sunMaterial.uniforms.time.value = (now - startTime) / 1000; // the Sun's surface keeps moving between layouts
      if (settings.drift) cameraTime += dt;
      for (const step of painters) step(10 / painters.length);
      draw();

      drawClock(now);
      photos.update(camera, now, elapsed, gap);
      if (!photosStarted) {
        photosStarted = true;
        photos.start();
      }
    } catch (error) {
      // A hiccup in one frame must not stop a wallpaper that is meant to run for days. Say so once.
      if (!failed) console.error(error);
      failed = true;
    } finally {
      schedule();
    }
  }

  /**
   * The next frame: wait out the rest of this one's time, then draw on the screen's next refresh. While the page is
   * hidden the refresh never comes, so nothing runs until it is shown again.
   */
  function schedule() {
    if (waiting || document.hidden) return;
    waiting = true;
    const now = performance.now();
    const wait = Math.max(0, frameGap(now) - (now - lastFrame) - 8); // (8: about half a refresh at 60 Hz, which the screen adds)
    timer = setTimeout(() => {
      timer = 0;
      requestAnimationFrame(frame);
    }, wait);
  }

  /** The pace changed (a setting): start the wait again with the new one. */
  function reschedule() {
    if (!waiting || !timer) return; // not running, or the screen's refresh is already what is awaited
    clearTimeout(timer);
    timer = 0;
    waiting = false;
    schedule();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // Shown again: don't count the time away as one long frame.
    lastTick = lastFrame = performance.now();
    busyUntil = Math.max(busyUntil, lastFrame + 100);
    schedule();
  });

  addEventListener("resize", () => {
    if (!innerWidth || !innerHeight) return;
    // The window (or the screen it is on) changed, so work out the drawing size again, or the cap on pixels would only
    // hold for the size the page started at.
    pixelRatio = fitRatio();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    sky.starMat.uniforms.pixelRatio.value = pixelRatio;
    for (const p of belts.parts) p.material.uniforms.pixelRatio.value = pixelRatio;
    system.markers.material.uniforms.pixelRatio.value = pixelRatio;
    labels.invalidate();
    if (!document.hidden && loadedShown) {
      layOut(performance.now(), new Date(clock.time)); // (the markers' size is set when the planets are laid out)
      draw(); // setSize clears the picture: draw it again now rather than leave it blank until the next frame
    }
    busyUntil = Math.max(busyUntil, performance.now() + 100);
  });

  // --- Wallpaper apps ---
  // Lively (Windows) pushes its settings in by name, all of them as the page starts and one when it changes. Wallpaper
  // Engine does the same if the wallpaper has a project.json listing them (not included). Only the Wallpaper's own
  // settings are used. The Mode setting switches to Space Scope; the first push of it is only what the app has saved,
  // so it is ignored (the page that opens is always Wallpaper, the easy one on battery).
  const modeGate = createModeGate();
  const index = (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value); // dropdowns may send their position as text
  window.livelyPropertyListener = (name, value) => {
    if (name === "mode") {
      if (modeGate() && wantsScope(value)) goToScope();
      return;
    }
    if (name === "speed") value = SPEEDS[index(value)]?.id ?? value;
    if (name === "wallpaperFps") name = "fps"; // (the app's own "fps" setting is for Space Scope, which runs at 30 or 60)
    else if (name === "fps") return;
    if (name === "drift" && reducedMotion && value) return; // a saved "on" from the app must not undo the computer's own request for less motion
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
  layOut(performance.now(), new Date(clock.time));
  sync();
  draw();
  schedule();
}
