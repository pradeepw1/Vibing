// The clock, the settings panel, planet names and keyboard shortcuts.
import { Ray, Vector3 } from "three";
import { galaxyOf, SPEEDS, viewpoint, VIEWS } from "./settings.js";

const $ = (sel) => document.querySelector(sel);
const fromName = (id) => (id === "moon" ? "From the Moon" : `From ${id[0].toUpperCase()}${id.slice(1)}`);

export function createUI({ settings, bodies, galaxies = [], set, goLive, jumpToNow, goBack, backLabel, travelling = () => false }) {
  const clockEl = $("#clock");
  const dateEl = $("#clock .date");
  const timeEl = $("#clock .time");
  const rateEl = $("#clock .rate-text");
  const dotEl = $("#clock .dot");
  const panel = $("#panel");
  const menuBtn = $("#menu-btn");
  const labelsEl = $("#labels");
  // Names in the solar system, and names out among the galaxies: one set shows at a time.
  const solarEl = document.createElement("div");
  const awayEl = document.createElement("div");
  solarEl.className = awayEl.className = "label-set";
  awayEl.hidden = true;
  labelsEl.append(solarEl, awayEl);
  let hiddenAll = false;

  // --- Settings panel ---
  const speedBox = $("#speeds");
  for (const s of SPEEDS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = s.label;
    b.dataset.speed = s.id;
    b.addEventListener("click", () => (s.id === "live" ? goLive() : set("speed", s.id)));
    speedBox.append(b);
  }
  const viewSel = $("#view");
  const lookAt = document.createElement("optgroup");
  lookAt.label = "Look at";
  const lookFrom = document.createElement("optgroup");
  lookFrom.label = "Look from";
  const visit = document.createElement("optgroup");
  visit.label = "Fly out to a galaxy or black hole";
  for (const v of VIEWS) (v.from ? lookFrom : v.galaxy ? visit : lookAt).append(new Option(v.label, v.id));
  const extra = new Option("", ""); // for views from moons that aren't in the list
  extra.hidden = true;
  lookFrom.append(extra);
  viewSel.append(lookAt, lookFrom, visit);
  const pill = $("#pov");
  const pillName = $("#pov .name");
  // While idle the Back pill and the settings button are hidden. A click that
  // lands on one as it reappears was meant for the sky, not for them.
  const justWoke = (e) => e.detail > 0 && performance.now() - wokeAt < 400; // detail is 0 for Space and Enter
  $("#pov-back").addEventListener("click", (e) => justWoke(e) || goBack());
  // Whether the last focus change came from Tab (rather than a click).
  let tabbing = false;
  viewSel.addEventListener("change", () => {
    set("view", viewSel.value);
    // Picked with the mouse: let go, so Esc and the other keys work straight
    // away. Reached with Tab: keep it, so the arrow keys step through the list.
    if (!tabbing) viewSel.blur();
  });
  $("#pause").addEventListener("click", () => set("paused", !settings.paused));
  $("#reverse").addEventListener("click", () => set("reverse", !settings.reverse));
  $("#now").addEventListener("click", jumpToNow);
  const toggles = { "labels-on": "labels", "orbits-on": "orbits", "belts-on": "belts", "clock-on": "clock", "drift-on": "drift" };
  for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener("change", (e) => set(key, e.target.checked));

  menuBtn.addEventListener("click", (e) => {
    if (justWoke(e)) return;
    panel.hidden = !panel.hidden;
    menuBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  function sync() {
    for (const b of speedBox.children) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));
    $("#pause").setAttribute("aria-pressed", String(settings.paused));
    $("#reverse").setAttribute("aria-pressed", String(settings.reverse));
    const from = viewpoint(settings.view);
    const listed = VIEWS.some((v) => v.id === settings.view);
    extra.hidden = listed || !from; // only for views from moons that aren't in the list
    if (!extra.hidden) {
      extra.value = settings.view;
      extra.textContent = fromName(from);
    }
    if (listed || from) viewSel.value = settings.view;
    // The way back shows even in wallpaper mode: a click may have brought you here.
    const galaxy = galaxyOf(settings.view);
    pill.hidden = !(from || galaxy) || hiddenAll || travelling(); // no second Back while already on the way
    if (from || galaxy) {
      pillName.textContent = galaxy ? VIEWS.find((v) => v.id === settings.view).label : fromName(from);
      $("#pov-back").title = `Back: ${backLabel()}`;
    }
    for (const [id, key] of Object.entries(toggles)) $(`#${id}`).checked = settings[key];
    menuBtn.hidden = !settings.ui || hiddenAll;
    if (!settings.ui || hiddenAll) panel.hidden = true;
    clockEl.hidden = !settings.clock || hiddenAll;
    labelsEl.hidden = !settings.labels || hiddenAll;
  }

  // Hide the button and cursor after a few seconds of no mouse movement.
  let idleTimer = 0;
  let wokeAt = -Infinity;
  function wake() {
    if (document.body.classList.contains("idle")) wokeAt = performance.now();
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => panel.hidden && document.body.classList.add("idle"), 3000);
  }
  addEventListener("pointermove", wake);
  addEventListener("pointerdown", wake);
  wake();

  // --- Keyboard ---
  // (Shown on the page too, so a button you've tabbed to stays in sight while idle.)
  addEventListener("pointerdown", () => document.body.classList.toggle("tabbing", (tabbing = false)), true);
  addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      document.body.classList.toggle("tabbing", (tabbing = true));
      wake(); // show the buttons you're stepping through
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Leave keys alone that a focused control needs: the dropdown uses most
    // keys, and buttons and tick boxes reached with Tab are pressed with
    // Space and Enter. One just clicked with the mouse keeps focus too, but
    // then Space should still pause.
    const t = e.target;
    if (t instanceof HTMLSelectElement && e.key !== "Escape" && e.key !== "Backspace") return;
    // Buttons take Space and Enter, tick boxes only Space.
    const takes = t instanceof HTMLButtonElement ? e.key === " " || e.key === "Enter" : t instanceof HTMLInputElement && e.key === " ";
    if (takes) {
      if (tabbing) return;
      t.blur();
    }
    // The digit row and number pad, by key position: the same on every keyboard layout.
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
    if (digit) {
      if (digit === "0") set("view", "middle");
      else {
        // 1-9: look at a planet. Shift+1-9: look from it.
        const planet = VIEWS.filter((v) => v.target && v.target !== "sun")[Number(digit) - 1].id;
        set("view", e.shiftKey ? `from-${planet}` : planet);
      }
      e.preventDefault();
      return;
    }
    const i = SPEEDS.findIndex((s) => s.id === settings.speed);
    switch (e.key) {
      case " ": set("paused", !settings.paused); break;
      case "ArrowRight": set("speed", SPEEDS[Math.min(i + 1, SPEEDS.length - 1)].id); break;
      case "ArrowLeft": i <= 1 ? goLive() : set("speed", SPEEDS[i - 1].id); break;
      case "r": set("reverse", !settings.reverse); break;
      case "n": goLive(); break;
      case "l": set("labels", !settings.labels); break;
      case "o": set("orbits", !settings.orbits); break;
      case "h": hiddenAll = !hiddenAll; sync(); break;
      case "Escape": if (!panel.hidden) { panel.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); } else goBack(); break;
      case "Backspace":
      case "b": goBack(); break; // Esc is taken by the browser in full screen
      case "Enter":
        // Looking at a planet: look from it instead.
        if (viewpoint(settings.view) || !bodies.has(settings.view) || settings.view === "sun") return;
        set("view", `from-${settings.view}`);
        break;
      case "f": document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
      default:
        return;
    }
    e.preventDefault();
  });

  // --- Clock ---
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  const shortTimeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  let lastText = "";
  function updateClock(timeMs, synced) {
    const d = new Date(timeMs);
    const fast = settings.speed !== "live" && settings.speed !== "minute";
    const rate = SPEEDS.find((s) => s.id === settings.speed);
    let status;
    if (settings.paused) status = "Paused";
    else if (synced) status = "Live";
    else if (settings.speed === "live") status = "Real speed";
    else status = `${settings.reverse ? "◀ " : ""}${rate.label}`;
    const text = [dateFmt.format(d), (fast ? shortTimeFmt : timeFmt).format(d), status].join("|");
    if (text === lastText) return;
    lastText = text;
    const [a, b, c] = text.split("|");
    dateEl.textContent = a;
    timeEl.textContent = b;
    rateEl.textContent = c;
    dotEl.classList.toggle("off", !synced || settings.paused);
  }

  // --- Names next to each body ---
  const labels = [];
  for (const body of bodies.values()) {
    const el = document.createElement("div");
    el.className = `label ${body.kind}`;
    el.textContent = body.def.name;
    // Clicking a name shows the sky from that body (the Sun's: look at the Sun).
    el.title = body.kind === "sun" ? "Look at the Sun" : `See the sky from ${body.def.name === "Moon" ? "the Moon" : body.def.name}`;
    el.addEventListener("click", () => set("view", body.kind === "sun" ? "sun" : `from-${body.id}`, { remember: false }));
    solarEl.append(el);
    labels.push({ body, el, shown: null, x: 0, y: 0 });
  }

  // Bigger things get their names first; a name that would overlap one already placed is skipped.
  const rank = { sun: 0, planet: 1, moon: 2 };
  labels.sort((a, b) => rank[a.body.kind] - rank[b.body.kind] || b.body.radius - a.body.radius);
  for (const l of labels) l.width = l.body.def.name.length * 7.5 + 6;

  // The nearest galaxies: a name and how far away. Clicking one flies you there.
  const twoLines = (box, name, sub, onClick, title) => {
    const el = document.createElement("div");
    el.className = "label galaxy";
    const top = document.createElement("span");
    top.textContent = name;
    const bottom = document.createElement("span");
    bottom.className = "far";
    bottom.textContent = sub;
    el.append(top, bottom);
    el.title = title;
    el.addEventListener("click", onClick);
    box.append(el);
    return el;
  };
  const galaxyLabels = galaxies.map((g) => ({
    galaxy: g,
    el: twoLines(solarEl, g.name, g.lightYears, () => set("view", `galaxy-${g.id}`, { remember: false }), `Fly to the ${g.name}`),
    shown: null,
    x: 0,
    y: 0,
    width: g.name.length * 7 + 6,
  }));

  const v = new Vector3();
  const camDir = new Vector3();
  const placed = [];
  const toBody = new Ray();
  const hitGround = new Vector3();
  function updateLabels(camera, width, height, standingOn = null, ground = null, skyFade = 1) {
    if (!settings.labels || hiddenAll) return;
    camera.getWorldDirection(camDir);
    const scale = (camera.projectionMatrix.elements[5] * height) / 2;
    placed.length = 0;
    // Discs of everything big enough on screen to hide something behind it.
    const discs = [];
    for (const l of labels) {
      const b = l.body;
      v.copy(b.group.position);
      const depth = v.clone().sub(camera.position).dot(camDir);
      if (depth <= 0.01) continue;
      const r = (b.radius * b.group.scale.x * scale) / depth;
      if (r < 3) continue;
      v.project(camera);
      discs.push({ body: b, x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, r, depth });
    }
    for (const l of labels) {
      const { body } = l;
      v.copy(body.group.position);
      const depth = v.clone().sub(camera.position).dot(camDir);
      let show = depth > 0.01 && body.id !== standingOn;
      if (body.kind === "moon" && standingOn) {
        // From a body, name the moons of its own family; other planets' moons are too close to them to label.
        const family = bodies.get(standingOn).kind === "moon" ? bodies.get(standingOn).parent.id : standingOn;
        show &&= body.parent.id === family && body.fade > 0.5;
      } else if (body.kind === "moon") {
        const near = camera.position.distanceTo(body.parent.group.position) / body.parent.radius;
        show &&= near < 30 && body.fade > 0.5;
      }
      if (show) {
        v.project(camera);
        const px = ((v.x + 1) / 2) * width;
        const py = ((1 - v.y) / 2) * height;
        const r = (body.radius * body.group.scale.x * scale) / depth;
        const x = Math.round(px + Math.max(r * 0.7, 4) + 4);
        const y = Math.round(py + Math.max(r * 0.7, 4) - 4);
        show = x > -100 && x < width + 20 && y > -20 && y < height + 20;
        show &&= !discs.some((d) => d.body !== body && d.depth < depth && Math.hypot(px - d.x, py - d.y) < d.r);
        if (show && ground) {
          // Below the horizon of the body we stand on?
          toBody.origin.copy(camera.position);
          toBody.direction.copy(body.group.position).sub(camera.position);
          const far = toBody.direction.length();
          toBody.direction.divideScalar(far);
          const hit = toBody.intersectSphere(ground, hitGround);
          show = !hit || hit.distanceTo(camera.position) > far;
        }
        show &&= !overlaps(x, y, l.width, 13);
        if (show) placed.push({ x, y, w: l.width, h: 13 });
        if (show && (x !== l.x || y !== l.y)) {
          l.el.style.transform = `translate(${x}px, ${y}px)`;
          l.x = x;
          l.y = y;
        }
      }
      if (show !== l.shown) {
        l.el.style.opacity = show ? "1" : "0";
        l.el.style.pointerEvents = show ? "auto" : "none";
        l.shown = show;
      }
    }

    // Galaxies are as good as infinitely far away: in the same direction from
    // wherever the camera is.
    for (const l of galaxyLabels) {
      const { direction, distance } = l.galaxy;
      // Not while the sky is faded out because the view is spinning.
      let show = skyFade > 0.5 && direction.dot(camDir) > 0.05;
      if (show) {
        v.copy(camera.position).addScaledVector(direction, distance).project(camera);
        const px = ((v.x + 1) / 2) * width;
        const py = ((1 - v.y) / 2) * height;
        const x = Math.round(px + 8);
        const y = Math.round(py + 4);
        show = x > -100 && x < width + 20 && y > -30 && y < height + 20;
        show &&= !discs.some((d) => Math.hypot(px - d.x, py - d.y) < d.r);
        if (show && ground) {
          toBody.origin.copy(camera.position);
          toBody.direction.copy(direction);
          show = !toBody.intersectSphere(ground, hitGround);
        }
        show &&= !overlaps(x, y, l.width, 26);
        if (show) placed.push({ x, y, w: l.width, h: 26 });
        if (show && (x !== l.x || y !== l.y)) {
          l.el.style.transform = `translate(${x}px, ${y}px)`;
          l.x = x;
          l.y = y;
        }
      }
      if (show !== l.shown) {
        l.el.style.opacity = show ? "1" : "0";
        l.el.style.pointerEvents = show ? "auto" : "none";
        l.shown = show;
      }
    }
  }

  // --- Names out among the galaxies ---
  let awayLabels = null;
  /** Shows the solar system's names, or (away = the places out there) the galaxies'. */
  function setAway(places) {
    solarEl.hidden = Boolean(places);
    awayEl.hidden = !places;
    if (!places || awayLabels) return;
    awayLabels = [...places.values()]
      .filter((p) => !p.small)
      .map((p) => {
        const home = p.id === "milkyway" || p.id === "sun";
        const go = home ? goBack : () => set("view", `galaxy-${p.id}`, { remember: false });
        const el = twoLines(awayEl, p.name, p.sub, go, home ? "Fly home" : `Fly to the ${p.name}`);
        return { place: p, el, sub: el.lastChild, said: "", shown: null, x: 0, y: 0, width: p.name.length * 7 + 6 };
      });
  }
  const at = new Vector3();
  function updateAwayLabels(camera, width, height, visiting = null) {
    if (!awayLabels || !settings.labels || hiddenAll) return;
    camera.getWorldDirection(camDir);
    placed.length = 0;
    for (const l of awayLabels) {
      const { place } = l;
      at.copy(place.position).sub(camera.position);
      const distance = at.length();
      // The Sun only once you're close enough to the Milky Way to pick it out,
      // and not the galaxy you're visiting while you're near it (the Back pill names it).
      let show = at.dot(camDir) > 0 && !(place.id === "sun" && distance > 120) && !(place.id === visiting && distance < place.radius * 6);
      // Not the Milky Way's name over a black hole at its heart, once you're in close.
      if (place.id === "milkyway" && distance < 3) show = false;
      if (show) {
        at.copy(place.position).project(camera);
        const x = Math.round(((at.x + 1) / 2) * width + 8);
        const y = Math.round(((1 - at.y) / 2) * height + 4);
        show = x > -100 && x < width + 20 && y > -30 && y < height + 20 && !overlaps(x, y, l.width, 26);
        if (show) placed.push({ x, y, w: l.width, h: 26 });
        if (show && (x !== l.x || y !== l.y)) {
          l.el.style.transform = `translate(${x}px, ${y}px)`;
          l.x = x;
          l.y = y;
        }
        // How far it is from here, out here.
        const say = place.id === "sun" ? "Home" : `${lightYears(distance)} away`;
        if (show && say !== l.said) l.sub.textContent = l.said = say;
      }
      if (show !== l.shown) {
        l.el.style.opacity = show ? "1" : "0";
        l.el.style.pointerEvents = show ? "auto" : "none";
        l.shown = show;
      }
    }
  }
  /** A distance in thousands of light-years, said the way people say it. */
  function lightYears(kly) {
    if (kly >= 995) return `${(kly / 1000).toFixed(1)} million light-years`;
    const step = 10 ** (Math.floor(Math.log10(Math.max(kly, 0.01))) - 1); // two significant figures
    const ly = Math.round(Math.round(kly / step) * step * 1000);
    return `${ly.toLocaleString("en-US")} light-years`;
  }
  const overlaps = (x, y, w, h) => placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);

  /** Highlights the name of the body under the pointer (or none). */
  let hovered = null;
  function hover(id) {
    if (hovered === id) return;
    for (const l of labels) l.el.classList.toggle("hover", l.body.id === id);
    hovered = id;
  }

  function doneLoading() {
    $("#loading").classList.add("done");
  }

  sync();
  return { sync, updateClock, updateLabels, updateAwayLabels, setAway, doneLoading, hover };
}
