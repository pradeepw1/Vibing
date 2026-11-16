// A picture of the view at any size (4K, 8K...), for saving. It is drawn a piece at a time at the size the page draws
// already, so it never needs a bigger drawing buffer than the screen's own: a whole 8K one, smoothed, could run the
// graphics out of memory, and a wallpaper that loses its graphics has to start again.

export const SNAPSHOT_MAX = 8192; // pixels each way (about the most a 2D canvas reliably holds)

/** A clean size: whole pixels, 16 to SNAPSHOT_MAX each way. Null if it can't be. */
export function snapshotSize(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!(w >= 16 && h >= 16 && w <= SNAPSHOT_MAX && h <= SNAPSHOT_MAX)) return null;
  return { width: w, height: h };
}

/** The pieces: rectangles of at most tileW × tileH covering width × height, a row at a time from the top left. */
export function snapshotTiles(width, height, tileW, tileH) {
  const out = [];
  for (let y = 0; y < height; y += tileH) {
    for (let x = 0; x < width; x += tileW) out.push({ x, y, w: Math.min(tileW, width - x), h: Math.min(tileH, height - y) });
  }
  return out;
}

/**
 * Draws the picture and gives it back as a PNG (a data: address). `cameras`: every camera a scene may be drawn with
 * (each is pointed at the piece being drawn, then put back); `draw()`: draws one frame without moving anything on;
 * `pointScale(s)`: things sized in screen pixels (stars, markers) drawn s times as big, or as usual for null;
 * `cssWidth`, `cssHeight`: the page's size, which it is put back to.
 */
export function takeSnapshot({ renderer, cameras, width, height, cssWidth, cssHeight, draw, pointScale }) {
  const size = snapshotSize(width, height);
  if (!size) throw new Error(`a picture can be 16 to ${SNAPSHOT_MAX} pixels each way`);
  const { width: W, height: H } = size;
  const canvas = renderer.domElement;
  const tileW = canvas.width;
  const tileH = canvas.height;
  const ratio = renderer.getPixelRatio();
  const kept = cameras.filter(Boolean).map((c) => ({ c, aspect: c.aspect, view: c.view?.enabled ? { ...c.view } : null }));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(tileW, tileH, false);
    pointScale(W / cssWidth); // (the picture looks like the screen, only bigger)
    for (const t of snapshotTiles(W, H, tileW, tileH)) {
      for (const { c } of kept) {
        c.aspect = W / H;
        c.setViewOffset(W, H, t.x, t.y, tileW, tileH);
        c.updateProjectionMatrix();
      }
      draw();
      ctx.drawImage(canvas, 0, 0, t.w, t.h, t.x, t.y, t.w, t.h); // (in the same task as the drawing, while it's there)
    }
  } finally {
    for (const { c, aspect, view } of kept) {
      c.aspect = aspect;
      if (view) c.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      else c.clearViewOffset();
      c.updateProjectionMatrix();
    }
    renderer.setPixelRatio(ratio);
    renderer.setSize(cssWidth, cssHeight);
    pointScale(null);
    draw();
  }
  return out.toDataURL("image/png");
}
