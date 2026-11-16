// One picture across all the screens: each screen's page draws only its own part of one big picture (the screens laid
// out as macOS has them), so a planet half off one screen goes on across the edge onto the next. Every page is told
// where its screen is in the whole, and one moment they all count from, so their clocks and the camera's drift agree.

/**
 * "x,y,w,h,W,H,epoch": this screen's rectangle (x, y from the top left) in the whole W × H, in points, and the moment
 * (ms since 1970) the pages count from. Returns { x, y, w, h, W, H, epoch }, or null if it doesn't make sense.
 */
export function parseSpan(text) {
  if (text === null || text === undefined || text === "") return null;
  const n = String(text).split(",").map(Number);
  if (n.length !== 7 || !n.every(Number.isFinite)) return null;
  const [x, y, w, h, W, H, epoch] = n;
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > W + 1 || y + h > H + 1) return null;
  return { x, y, w, h, W, H, epoch };
}

/** Points `camera` at this screen's part of the whole picture (or the whole of it, for none). */
export function fitSpan(camera, span) {
  if (!camera) return;
  if (span) {
    camera.aspect = span.W / span.H;
    camera.setViewOffset(span.W, span.H, span.x, span.y, span.w, span.h);
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

/** The clock's time at `now` for pages that all started at the span's moment going at `rate` (clock ms per real ms). */
export function spanTime(span, rate, now = Date.now()) {
  return span.epoch + (now - span.epoch) * rate;
}
