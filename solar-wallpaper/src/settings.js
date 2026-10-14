// Settings come from three places, later ones winning:
//   1. the defaults below
//   2. whatever you last picked in the settings panel (saved in this browser)
//   3. the page address, e.g. index.html?speed=day&view=earth&ui=0
// Wallpaper apps (Lively, Wallpaper Engine) can also push changes in; see main.js.
import { PLANETS } from "./bodies.js";

// "live" runs at real speed. If the clock is on today's date, it stays locked to now.
export const SPEEDS = [
  { id: "live", label: "Live", rate: 1 },
  { id: "minute", label: "1 min/s", rate: 60 },
  { id: "hour", label: "1 hour/s", rate: 3600 },
  { id: "day", label: "1 day/s", rate: 86400 },
  { id: "week", label: "1 week/s", rate: 7 * 86400 },
  { id: "month", label: "1 month/s", rate: 30.436875 * 86400 },
  { id: "year", label: "1 year/s", rate: 365.2425 * 86400 },
];

export const VIEWS = [
  { id: "system", label: "Whole solar system", target: "sun", radius: 76, elevation: 24 },
  { id: "middle", label: "Out to Jupiter", target: "sun", radius: 27, elevation: 30 },
  { id: "inner", label: "Inner planets", target: "sun", radius: 15, elevation: 38 },
  { id: "sun", label: "The Sun", target: "sun", radius: 6, elevation: 15 },
  ...PLANETS.map((p) => ({ id: p.id, label: p.name, target: p.id })),
];

export const DEFAULTS = {
  speed: "live",
  reverse: false,
  paused: false,
  view: "middle",
  labels: true,
  orbits: true,
  belts: true,
  clock: true,
  drift: true,
  ui: true, // false hides the settings button completely (for wallpaper use)
  fps: 60,
  date: null, // start at this date instead of now
};

const KEY = "solar-wallpaper:v1";
const SAVED = ["speed", "reverse", "view", "labels", "orbits", "belts", "clock", "drift", "fps"];

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, settings[k]]))));
  } catch {
    // Private windows and some wallpaper hosts block storage. Settings just won't stick.
  }
}

const bool = (v) => !["0", "false", "no", "off"].includes(String(v).toLowerCase());

/** Cleans up one setting value, or returns undefined if it isn't valid. */
export function parse(key, value) {
  switch (key) {
    case "speed":
      return SPEEDS.some((s) => s.id === value) ? value : undefined;
    case "view":
      return VIEWS.some((v) => v.id === value) ? value : undefined;
    case "fps": {
      const n = Math.round(Number(value));
      return n >= 5 && n <= 240 ? n : undefined;
    }
    case "date": {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d.getTime();
    }
    case "reverse":
    case "paused":
    case "labels":
    case "orbits":
    case "belts":
    case "clock":
    case "drift":
    case "ui":
      return bool(value);
    default:
      return undefined;
  }
}

export function loadSettings(search = location.search) {
  const settings = { ...DEFAULTS };
  for (const [k, v] of Object.entries(readSaved())) {
    const parsed = parse(k, v);
    if (parsed !== undefined && SAVED.includes(k)) settings[k] = parsed;
  }
  const params = new URLSearchParams(search);
  for (const [k, v] of params) {
    const parsed = parse(k, v);
    if (parsed !== undefined) settings[k] = parsed;
  }
  // "wallpaper" is shorthand for: no settings button, 30 fps (easy on battery).
  if (params.has("wallpaper") && bool(params.get("wallpaper") || "1")) {
    settings.ui = false;
    if (!params.has("fps")) settings.fps = 30;
  }
  return settings;
}

export const speedRate = (id) => SPEEDS.find((s) => s.id === id)?.rate ?? 1;
