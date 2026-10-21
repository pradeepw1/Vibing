// Makes the files in dist/ that are built from src/, as text, without writing anything.
// tools/build.mjs writes them; test/dist.test.mjs makes them again and checks the committed ones match.
//   dist/solar.js              Space Scope (dist/scope.html): everything
//   dist/wallpaper.js          the Wallpaper page (dist/index.html): the planets and the sky,
//                              without flying, galaxies up close, other stars' planets or sightings
//   dist/LivelyProperties.json Lively Wallpaper's settings, made from the same lists the pages use
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const THREE = "three.js (MIT, three.js authors), astronomy-engine (MIT, Don Cross), simplex noise (MIT, Copyright (C) 2011 Ashima Arts, Ian McEwan and Stefan Gustavson), hash functions (MIT, Copyright (c) 2014 David Hoskins)";
const MAPS = "Planet maps: NASA, USGS, Solar System Scope (CC BY 4.0), Natural Earth, Celestia; see CREDITS.txt.";
const BANNERS = {
  "dist/solar.js": `/*! Solar System Live (Space Scope). Bundles ${THREE} and data from the Open Exoplanet Catalogue (MIT, Copyright (C) 2012 Hanno Rein). ${MAPS} */`,
  "dist/wallpaper.js": `/*! Solar System Live (Wallpaper). Bundles ${THREE}. ${MAPS} */`,
};

export async function makeBundles() {
  // The painter runs in a background worker. Wallpaper apps load the page from
  // disk, where separate worker files are blocked, so the worker's code is
  // baked into the main script as a string and started from a blob.
  const worker = await build({
    absWorkingDir: root.pathname,
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
    maps = JSON.parse(readFileSync(new URL("dist/maps/manifest.json", root), "utf8"));
  } catch {
    // none built: the painted surfaces are used
  }
  const define = { PAINT_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text), MAP_MANIFEST: JSON.stringify(maps) };

  const files = {};
  for (const [entry, outfile] of [["src/main.js", "dist/solar.js"], ["src/wallpaper.js", "dist/wallpaper.js"]]) {
    const result = await build({
      absWorkingDir: root.pathname,
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "iife",
      target: "es2020",
      outfile,
      write: false,
      legalComments: "eof",
      define,
      banner: { js: BANNERS[outfile] },
    });
    files[outfile] = result.outputFiles[0].text;
  }

  // Lively Wallpaper's settings. One file serves both pages, and Lively pushes every setting to whichever page is
  // open, so a setting both pages have but want different values for (the frame rate) is two settings here.
  const { SPEEDS, VIEWS } = await import("../src/settings.js");
  const { DEFAULTS } = await import("../src/wallpaper-settings.js");
  const lookAt = VIEWS.filter((v) => !v.from);
  const lively = {
    mode: { type: "dropdown", value: 0, text: "Mode", items: ["Wallpaper (the planets, easy on battery)", "Space Scope (fly anywhere)"] },
    speed: { type: "dropdown", value: 0, text: "Speed", items: SPEEDS.map((s) => s.label) },
    view: { type: "dropdown", value: lookAt.findIndex((v) => v.id === "middle"), text: "Look at (Space Scope)", items: lookAt.map((v) => v.label) },
    from: { type: "dropdown", value: 0, text: "Look from (Space Scope)", items: ["Nothing", ...VIEWS.filter((v) => v.from).map((v) => v.label)] },
    labels: { type: "checkbox", value: true, text: "Show names" },
    orbits: { type: "checkbox", value: true, text: "Show orbits" },
    belts: { type: "checkbox", value: true, text: "Show asteroids" },
    clock: { type: "checkbox", value: true, text: "Show clock" },
    drift: { type: "checkbox", value: true, text: "Camera goes round / slow drift" },
    strange: { type: "checkbox", value: true, text: "Strange sightings (made up, Space Scope)" },
    photos: { type: "checkbox", value: true, text: "Real maps" },
    ui: { type: "checkbox", value: true, text: "Show settings button" },
    credits: { type: "label", text: "Credits: planet maps from NASA, USGS and Solar System Scope (CC BY 4.0, resized and recoloured), Natural Earth and Celestia. Positions by astronomy-engine, drawing by three.js, planets of other stars from the Open Exoplanet Catalogue. Full list in CREDITS.txt." },
    fps: { type: "slider", value: 30, text: "Frames per second in Space Scope (lower saves power)", min: 10, max: 60, step: 5 },
    wallpaperFps: { type: "slider", value: DEFAULTS.fps, text: "Frames per second in Wallpaper (lower saves power)", min: 5, max: 60, step: 5 },
  };
  files["dist/LivelyProperties.json"] = JSON.stringify(lively, null, 2) + "\n";
  return files;
}
