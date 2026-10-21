// The Wallpaper page: a still picture and a small menu. This is all of its script;
// nothing runs between clicks, so the page uses almost no battery.
import { pageAddress, scopeAddress, SCOPE_PAGE, wantsScope } from "./modes.js";

const goToScope = () => location.assign(pageAddress(SCOPE_PAGE, location.search));

// An old full-app address (index.html?view=...) goes straight to Space Scope.
const there = scopeAddress(location.search);
if (there) location.replace(there);
else start();

function start() {
  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const button = $("#menu-btn");
  const panel = $("#panel");
  const sunBox = $("#sun-on");
  const KEY = "solar-wallpaper:milkyway";

  // ?ui=0 and ?wallpaper take the menu button away completely.
  if (params.get("ui") === "0" || params.has("wallpaper")) button.hidden = true;

  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => setOpen(panel.hidden));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  $("#mode-scope").addEventListener("click", goToScope);

  // Whether to mark where the Sun is. Remembered if the browser lets it.
  const markSun = (on) => document.body.classList.toggle("no-sun", !on);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (saved.sun === false) sunBox.checked = false;
  } catch {
    // no storage (a private window, some wallpaper apps): it just won't be remembered
  }
  markSun(sunBox.checked);
  sunBox.addEventListener("change", () => {
    markSun(sunBox.checked);
    try {
      localStorage.setItem(KEY, JSON.stringify({ sun: sunBox.checked }));
    } catch {
      // see above
    }
  });

  // Wallpaper apps: Lively and Wallpaper Engine can switch to Space Scope from their own panels.
  window.livelyPropertyListener = (name, value) => {
    if (name === "mode" && wantsScope(value)) goToScope();
  };
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      for (const [name, p] of Object.entries(props)) if (p && "value" in p) window.livelyPropertyListener(name, p.value);
    },
  };
}
