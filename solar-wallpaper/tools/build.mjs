// Bundles src/ into dist/solar.js: one plain script, so dist/index.html works
// straight from disk (file://) and inside wallpaper apps, with no server.
import { readFileSync } from "node:fs";
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

// The real maps in dist/maps/ (made by tools/make-maps.py) are separate files the page loads
// after its first picture. Which ones exist is baked in, so the page never asks for a missing one.
let maps = {};
try {
  maps = JSON.parse(readFileSync(new URL("../dist/maps/manifest.json", import.meta.url), "utf8"));
} catch {
  // none built: the painted surfaces are used
}

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/solar.js",
  legalComments: "eof",
  define: { PAINT_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text), MAP_MANIFEST: JSON.stringify(maps) },
  banner: {
    js: "/*! Solar System Live. Bundles three.js (MIT, three.js authors), astronomy-engine (MIT, Don Cross), simplex noise (MIT, Copyright (C) 2011 Ashima Arts, Ian McEwan and Stefan Gustavson), hash functions (MIT, Copyright (c) 2014 David Hoskins) and data from the Open Exoplanet Catalogue (MIT, Copyright (C) 2012 Hanno Rein). Planet maps: NASA, USGS, Solar System Scope (CC BY 4.0), Natural Earth, Celestia; see CREDITS.txt. */",
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
  strange: { type: "checkbox", value: true, text: "Strange sightings (made up)" },
  photos: { type: "checkbox", value: true, text: "Real maps" },
  credits: { type: "label", text: "Credits: planet maps from NASA, USGS and Solar System Scope (CC BY 4.0, resized and recoloured), Natural Earth and Celestia. Positions by astronomy-engine, drawing by three.js, planets of other stars from the Open Exoplanet Catalogue. Full list in CREDITS.txt." },
  fps: { type: "slider", value: 30, text: "Frames per second (lower saves power)", min: 10, max: 60, step: 5 },
};
const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("../dist/LivelyProperties.json", import.meta.url), JSON.stringify(lively, null, 2) + "\n");
