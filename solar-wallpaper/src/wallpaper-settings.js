// The Wallpaper page's settings. Fewer than Space Scope's (no views, no sightings, no
// running time backwards): what's left is what a wallpaper needs. Same three places as
// settings.js: the defaults, what you last picked in the menu (saved in this browser,
// under its own name so it never mixes with Space Scope's), then the page address.
import { bool, parseShared } from "./options.js";

export const DEFAULTS = {
  speed: "live",
  labels: true,
  orbits: true,
  belts: true,
  clock: true,
  drift: true, // the camera goes round the Sun
  photos: true, // real maps (NASA and others) instead of painted surfaces
  ui: true, // false hides the settings button completely
  fps: 20, // low on purpose: the camera moves slowly, and every frame costs battery
  date: null, // start at this date instead of now
};

const KEY = "solar-wallpaper:wallpaper:v1";
const SAVED = ["speed", "labels", "orbits", "belts", "clock", "drift", "photos", "fps"];

/** Cleans up one setting value, or returns undefined if the Wallpaper has no such setting or it isn't valid. */
export function parse(key, value) {
  return key in DEFAULTS ? parseShared(key, value) : undefined;
}

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
