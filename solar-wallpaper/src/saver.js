// What Space Scope does to go easy on the battery when it is a wallpaper (scope.html?wallpaper). The Wallpaper
// page has these savings built in; here they are for Space Scope, which draws a lot more: its spheres are made
// for close-ups (about 200 thousand triangles, with every planet and moon on show), it is woken on every
// refresh of the screen, and it moves every planet every frame.
//
// Plain arithmetic and a little scene tidying, so most of it can be tested without a browser.
import { SphereGeometry } from "three";

export const LIMITS = {
  maxPixels: 2.5e6, // the most pixels drawn, however big the screen is (a 1080p screen is 2.1 million)
  layoutEvery: 1000, // ms between moving the planets, at real speed
  early: 4, // ms: a frame this much early is still on time
  moonShownPx: 0.9, // a moon is drawn once it is this many pixels across its radius (and dropped below the next figure)
  moonHiddenPx: 0.6,
  moonMapPx: 4, // and gets its map once it is this big: before that it is a dot, and a map would only be memory
  closePx: 70, // a planet this big on screen gets a finer sphere
};

/** How much to scale the drawing: the screen's own sharpness, but never so many pixels that a big screen costs a lot more. */
export const fitRatio = (deviceRatio, width, height, maxPixels = LIMITS.maxPixels) =>
  Math.max(0.35, Math.min(deviceRatio || 1, 2, Math.sqrt(maxPixels / Math.max(1, width * height))));

/** Smoothing the edges only where the screen isn't sharp enough to hide them. */
export const smoothsEdges = (pixelRatio) => pixelRatio < 1.5;

/** Pixels across one unit, at distance 1. */
export const pixelsPerUnit = (heightPx, fovDegrees) => heightPx / (2 * Math.tan((fovDegrees * Math.PI) / 360));

/**
 * Lighter spheres for the bodies, finer ones only for a planet that is big on screen, and moons only once they are
 * big enough to see. `bodies`: the system's bodies (id -> body). Call `update` before the bodies are moved, so a
 * moon that has just come into view is put in its place at once.
 */
export function createDetail(bodies) {
  const all = [...bodies.values()];
  const planets = all.filter((b) => b.kind === "planet");
  const moons = all.filter((b) => b.kind === "moon");
  const spheres = {
    plain: new SphereGeometry(1, 48, 24),
    fine: new SphereGeometry(1, 96, 48),
    sun: new SphereGeometry(1, 64, 32),
    halo: new SphereGeometry(1, 32, 16),
    fineHalo: new SphereGeometry(1, 64, 32),
  };
  for (const b of all) {
    if (b.kind === "moon") {
      b.mesh.geometry = spheres.plain; // (it starts out shown, so it is put in its place once; `update` hides it if it is too small)
      continue;
    }
    b.mesh.geometry = b.kind === "sun" ? spheres.sun : spheres.plain;
    if (b.halo) b.halo.geometry = spheres.halo;
    if (b.clouds) b.clouds.geometry = spheres.plain;
  }
  const wanted = new Set(); // moons that have been big enough for a map

  return {
    spheres,
    moons,
    /** Moons whose maps have been asked for. */
    wanted,
    /**
     * `scale`: pixelsPerUnit for the screen as drawn. `showAll`: every moon, whatever its size (standing on a body, its
     * sky has to be right). Returns the ids of moons that have just become big enough to want a map.
     */
    update(camera, scale, { showAll = false } = {}) {
      const asked = [];
      for (const m of moons) {
        const r = (m.radius * scale) / Math.max(camera.position.distanceTo(m.parent.group.position), 0.01);
        m.group.visible = showAll || (m.group.visible ? r >= LIMITS.moonHiddenPx : r >= LIMITS.moonShownPx); // (two limits, so a moon on the edge doesn't flicker)
        if (r >= LIMITS.moonMapPx && !wanted.has(m.id)) {
          wanted.add(m.id);
          asked.push(m.id);
        }
      }
      for (const b of planets) {
        const r = (b.radius * scale) / Math.max(camera.position.distanceTo(b.group.position), 0.01);
        const close = r > LIMITS.closePx;
        if (close === Boolean(b.fine)) continue;
        b.fine = close;
        b.mesh.geometry = close ? spheres.fine : spheres.plain;
        if (b.halo) b.halo.geometry = close ? spheres.fineHalo : spheres.halo;
        if (b.clouds) b.clouds.geometry = close ? spheres.fine : spheres.plain;
      }
      return asked;
    },
  };
}
