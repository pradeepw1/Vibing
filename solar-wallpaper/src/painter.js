// Hands out the surface painting. Uses a background worker when the browser
// allows it, and otherwise paints on the page a little each frame.
import { painterFor } from "./surfaces.js";

/* global PAINT_WORKER_SOURCE */

function makeWorker() {
  try {
    if (typeof PAINT_WORKER_SOURCE !== "string" || typeof OffscreenCanvas === "undefined") return null;
    const url = URL.createObjectURL(new Blob([PAINT_WORKER_SOURCE], { type: "text/javascript" }));
    return new Worker(url);
  } catch {
    return null; // some wallpaper apps block workers
  }
}

/**
 * Paints every job in `jobs` (body ids, "clouds" or "milkyway", optionally
 * with a size like "moon@2048"), calling onPainted(job, { map, extra }) with
 * ImageData as each one is ready, then onDone().
 * Returns step(budgetMs), to be called every frame; it only does work in the
 * fallback mode.
 */
export function startPainting(jobs, onPainted, onDone) {
  let left = [...jobs];
  let worker = makeWorker();

  if (worker) {
    worker.onmessage = ({ data }) => {
      const images = {};
      for (const key of ["map", "extra"]) {
        const d = data[key];
        if (d) images[key] = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
      }
      left = left.filter((j) => j !== data.job);
      onPainted(data.job, images);
      if (!left.length) {
        worker.terminate();
        onDone();
      }
    };
    worker.onerror = (e) => {
      // Fall back to painting on the page for whatever is left.
      e.preventDefault?.();
      worker.terminate();
      worker = null;
    };
    for (const job of jobs) worker.postMessage({ job });
  }

  let current = null;
  let currentJob = null;
  return function step(budgetMs) {
    if (worker || (!left.length && !current)) return;
    const end = performance.now() + budgetMs;
    while (performance.now() < end) {
      if (!current) {
        if (!left.length) {
          onDone();
          return;
        }
        currentJob = left.shift();
        current = painterFor(currentJob);
      }
      const r = current.next();
      if (r.done) {
        const out = r.value;
        onPainted(currentJob, out instanceof ImageData ? { map: out } : out);
        current = null;
      }
    }
  };
}
