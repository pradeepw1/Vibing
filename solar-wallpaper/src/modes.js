// The two ways to use it.
//
//   Wallpaper (index.html): the Sun and the nine planets under the real sky, with the camera
//   slowly going round. Nothing reacts to clicks. Made to cost as little battery as it can.
//   Space Scope (scope.html): everything: fly to any planet or moon, out to other galaxies,
//   black holes, other stars' planets, the Gate and the rest.
export const WALLPAPER_PAGE = "index.html";
export const SCOPE_PAGE = "scope.html";

// Settings only Space Scope understands (the Wallpaper has no views, no sightings and no running time
// backwards). An address with one of these (like the old index.html?view=galaxy-sgra) is sent on to
// Space Scope, so old links keep working. The settings both share (speed, names, orbits...) stay.
const SCOPE_PARAMS = ["view", "strange", "reverse", "paused"];

/** Where an address meant for Space Scope should go (the address after "?"), or null to stay on the wallpaper. */
export function scopeAddress(search) {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "scope" && !SCOPE_PARAMS.some((k) => params.has(k))) return null;
  params.delete("mode");
  const rest = params.toString();
  return SCOPE_PAGE + (rest ? `?${rest}` : "");
}

// These follow you from one page to the other, so a wallpaper that hid its menu button keeps it hidden.
const KEPT_PARAMS = ["wallpaper", "ui"];

/** The address of `page`, carrying over only the settings that belong to both pages. */
export function pageAddress(page, search) {
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) if (from.has(key)) kept.set(key, from.get(key));
  const rest = kept.toString();
  return page + (rest ? `?${rest}` : "");
}

/** A wallpaper app's "mode" setting: a dropdown position (0, 1) or the name picked. */
export const wantsScope = (value) => value === 1 || /scope/i.test(String(value));
export const wantsWallpaper = (value) => value === 0 || /wallpaper/i.test(String(value));
