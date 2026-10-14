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
