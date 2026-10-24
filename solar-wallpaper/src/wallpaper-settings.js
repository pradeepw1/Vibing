// The Wallpaper page's settings. Fewer than Space Scope's (no views, no sightings, no
// running time backwards): what's left is what a wallpaper needs. Same three places as
// settings.js: the defaults, what you last picked in the menu (saved in this browser,
// under its own name so it never mixes with Space Scope's), then the page address.
import { bool, parseShared } from "./options.js";
import { ZOOMS } from "./wallpaper-camera.js";

export const DEFAULTS = {
  speed: "live",
  labels: true,
  orbits: true,
  belts: true,
  clock: true,
  zoom: 2, // 1 to 4: how close the camera is (see wallpaper-camera.js)
  drift: true, // the camera goes round the Sun
  photos: true, // real maps (NASA and others) instead of painted surfaces
  ui: true, // false hides the settings button completely
  fps: 20, // low on purpose: the camera moves slowly, and every frame costs battery
  date: null, // start at this date instead of now
};

const KEY = "solar-wallpaper:wallpaper:v1";
const SAVED = ["speed", "zoom", "labels", "orbits", "belts", "clock", "drift", "photos", "fps"];

/** Cleans up one setting value, or returns undefined if the Wallpaper has no such setting or it isn't valid. */
export function parse(key, value) {
  if (key === "zoom") {
    const n = typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? Number(value) : NaN;
    return ZOOMS.some((z) => z.id === n) ? n : undefined;
  }
  return key in DEFAULTS ? parseShared(key, value) : undefined;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}; // (a stored null or a list would otherwise stop the page)
  } catch {
    return {};
  }
}

/**
 * Remembers settings the person changed (`changes` is { name: value }). Only those are written, on top of what was
 * saved before, so a setting nobody touched stays at its default: a one-off value from the address, or the
 * "camera still" default for someone who asked their computer for less motion, is never saved by accident.
 */
export function save(changes) {
  try {
    const next = { ...readSaved() };
    for (const [key, value] of Object.entries(changes)) if (SAVED.includes(key)) next[key] = value;
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private windows and some wallpaper hosts block storage. Settings just won't stick.
  }
}

export function loadSettings(search = location.search, reducedMotion = false) {
  const settings = { ...DEFAULTS, drift: !reducedMotion };
  for (const [k, v] of Object.entries(readSaved())) {
    const parsed = parse(k, v);
    if (parsed !== undefined && SAVED.includes(k)) settings[k] = parsed;
  }
  const params = new URLSearchParams(search);
  for (const [k, v] of params) {
    const parsed = parse(k, v);
    if (parsed !== undefined) settings[k] = parsed;
  }
  // "wallpaper" takes the settings button away (the Wallpaper is already easy on battery).
  if (params.has("wallpaper") && bool(params.get("wallpaper") || "1")) settings.ui = false;
  return settings;
}
