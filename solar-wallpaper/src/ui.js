// The clock, the settings panel, planet names and keyboard shortcuts.
import { Vector3 } from "three";
import { SPEEDS, VIEWS } from "./settings.js";

const $ = (sel) => document.querySelector(sel);

export function createUI({ settings, bodies, set, goLive, jumpToNow }) {
  const clockEl = $("#clock");
  const dateEl = $("#clock .date");
  const timeEl = $("#clock .time");
  const rateEl = $("#clock .rate-text");
  const dotEl = $("#clock .dot");
  const panel = $("#panel");
  const menuBtn = $("#menu-btn");
  const labelsEl = $("#labels");
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
  for (const v of VIEWS) viewSel.append(new Option(v.label, v.id));
  viewSel.addEventListener("change", () => set("view", viewSel.value));
  $("#pause").addEventListener("click", () => set("paused", !settings.paused));
  $("#reverse").addEventListener("click", () => set("reverse", !settings.reverse));
  $("#now").addEventListener("click", jumpToNow);
  const toggles = { "labels-on": "labels", "orbits-on": "orbits", "belts-on": "belts", "clock-on": "clock", "drift-on": "drift" };
  for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener("change", (e) => set(key, e.target.checked));

  menuBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    menuBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  function sync() {
    for (const b of speedBox.children) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));
    $("#pause").setAttribute("aria-pressed", String(settings.paused));
    $("#reverse").setAttribute("aria-pressed", String(settings.reverse));
    if (VIEWS.some((v) => v.id === settings.view)) viewSel.value = settings.view;
    for (const [id, key] of Object.entries(toggles)) $(`#${id}`).checked = settings[key];
    menuBtn.hidden = !settings.ui || hiddenAll;
    if (!settings.ui || hiddenAll) panel.hidden = true;
    clockEl.hidden = !settings.clock || hiddenAll;
    labelsEl.hidden = !settings.labels || hiddenAll;
  }

  // Hide the button and cursor after a few seconds of no mouse movement.
  let idleTimer = 0;
  function wake() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => panel.hidden && document.body.classList.add("idle"), 3000);
  }
  addEventListener("pointermove", wake);
  addEventListener("pointerdown", wake);
  wake();

  // --- Keyboard ---
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
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
      case "f": document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
      case "0": set("view", "middle"); break;
      default:
        if (e.key >= "1" && e.key <= "9") set("view", VIEWS.filter((v) => v.target !== "sun")[Number(e.key) - 1].id);
        else return;
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
    el.addEventListener("click", () => set("view", body.id));
    labelsEl.append(el);
    labels.push({ body, el, shown: null, x: 0, y: 0 });
  }

  // Bigger things get their names first; a name that would overlap one already placed is skipped.
  const rank = { sun: 0, planet: 1, moon: 2 };
  labels.sort((a, b) => rank[a.body.kind] - rank[b.body.kind] || b.body.radius - a.body.radius);
  for (const l of labels) l.width = l.body.def.name.length * 7.5 + 6;

  const v = new Vector3();
  const camDir = new Vector3();
  const placed = [];
  function updateLabels(camera, width, height) {
    if (!settings.labels || hiddenAll) return;
    camera.getWorldDirection(camDir);
    const scale = (camera.projectionMatrix.elements[5] * height) / 2;
    placed.length = 0;
    for (const l of labels) {
      const { body } = l;
      v.copy(body.group.position);
      const depth = v.clone().sub(camera.position).dot(camDir);
      let show = depth > 0.01;
      if (body.kind === "moon") {
        const near = camera.position.distanceTo(body.parent.group.position) / body.parent.radius;
        show &&= near < 30 && body.fade > 0.5;
      }
      if (show) {
        v.project(camera);
        const px = ((v.x + 1) / 2) * width;
        const py = ((1 - v.y) / 2) * height;
        const r = (body.radius * scale) / depth;
        const x = Math.round(px + Math.max(r * 0.7, 4) + 4);
        const y = Math.round(py + Math.max(r * 0.7, 4) - 4);
        show = x > -100 && x < width + 20 && y > -20 && y < height + 20;
        show &&= !placed.some((p) => x < p.x + p.w && p.x < x + l.width && Math.abs(y - p.y) < 13);
        if (show) placed.push({ x, y, w: l.width });
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

  function doneLoading() {
    $("#loading").classList.add("done");
  }

  sync();
  return { sync, updateClock, updateLabels, doneLoading };
}
