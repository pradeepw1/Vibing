// Bundles src/ into dist/solar.js: one plain script, so dist/index.html works
// straight from disk (file://) and inside wallpaper apps, with no server.
import { build } from "esbuild";

// The painter runs in a background worker. Wallpaper apps load the page from
// disk, where separate worker files are blocked, so the worker's code is
// baked into the main script as a string and started from a blob.
const worker = await build({
  entryPoints: ["src/paint-worker.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
});

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/solar.js",
  legalComments: "eof",
  define: { PAINT_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
  banner: {
    js: "/* Solar System Live. Bundles three.js (MIT, three.js authors) and astronomy-engine (MIT, Don Cross). */",
  },
  logLevel: "info",
});

// Lively Wallpaper's settings, made from the same lists the page uses so they can't drift apart.
const { SPEEDS, VIEWS } = await import("../src/settings.js");
const lookAt = VIEWS.filter((v) => !v.from);
const lively = {
  speed: { type: "dropdown", value: 0, text: "Speed", items: SPEEDS.map((s) => s.label) },
  view: { type: "dropdown", value: lookAt.findIndex((v) => v.id === "middle"), text: "Look at", items: lookAt.map((v) => v.label) },
  from: { type: "dropdown", value: 0, text: "Look from", items: ["Nothing", ...VIEWS.filter((v) => v.from).map((v) => v.label)] },
  labels: { type: "checkbox", value: true, text: "Show names" },
  orbits: { type: "checkbox", value: true, text: "Show orbits" },
  belts: { type: "checkbox", value: true, text: "Show asteroids" },
  clock: { type: "checkbox", value: true, text: "Show clock" },
  drift: { type: "checkbox", value: true, text: "Slow camera drift" },
  fps: { type: "slider", value: 30, text: "Frames per second (lower saves power)", min: 10, max: 60, step: 5 },
};
const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("../dist/LivelyProperties.json", import.meta.url), JSON.stringify(lively, null, 2) + "\n");
