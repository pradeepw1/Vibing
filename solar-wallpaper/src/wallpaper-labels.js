// Names on the Wallpaper: the Sun and planets, the galaxies and the black holes. Just
// text on the picture. Nothing here can be clicked (the boxes ignore the pointer), so a
// stray click on the desktop never changes anything.
//
// A name is put beside its thing, on whichever side has room: not off the edge of the
// screen, not on another name, not over the clock or the settings button, and not on top
// of the Sun or another planet. If no side has room, the name is left out for now.
import { Vector3 } from "three";

const MARGIN = 8; // a name must be this far inside the screen
const GAP = 4; // and this far from anything else (the discs)

const overlaps = (list, x, y, w, h) => list.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);
/** Does the box touch the disc? */
const touches = (x, y, w, h, d, pad = 2) => {
  const nearX = Math.max(x, Math.min(d.x, x + w));
  const nearY = Math.max(y, Math.min(d.y, y + h));
  return Math.hypot(nearX - d.x, nearY - d.y) < d.r + pad;
};

/**
 * `box`: the element to put names in. `bodies`: the Sun and planets (moons are left out: from out here they
 * are under a pixel). `places`: names on the sky, as { name, lightYears, direction, distance, hole }; black
 * holes get their names first. `avoid()`: rectangles { x, y, w, h } to keep names off (the clock, the button).
 */
export function createLabels({ box, bodies, places, avoid = () => [] }) {
  const names = [];
  for (const body of bodies) {
    if (body.kind === "moon") continue;
    const el = document.createElement("div");
    el.className = `label ${body.kind}`;
    el.textContent = body.def.name;
    box.append(el);
    names.push({ body, el, shown: null, x: 0, y: 0, w: body.def.name.length * 7.5 + 6, h: 16 });
  }
  // Bigger things get their names first; one that has no room is skipped.
  const rank = { sun: 0, planet: 1 };
  names.sort((a, b) => rank[a.body.kind] - rank[b.body.kind] || b.body.radius - a.body.radius);

  const far = places.map((place) => {
    const el = document.createElement("div");
    el.className = place.hole ? "label galaxy hole" : "label galaxy";
    const top = document.createElement("span");
    top.textContent = place.name;
    const bottom = document.createElement("span");
    bottom.className = "far";
    bottom.textContent = place.lightYears;
    el.append(top, bottom);
    box.append(el);
    return { place, el, shown: null, x: 0, y: 0, w: Math.max(place.name.length * 7, place.lightYears.length * 5.5) + 6, h: 28 };
  });
  far.sort((a, b) => Number(Boolean(b.place.hole)) - Number(Boolean(a.place.hole))); // black holes pick their spot first

  const v = new Vector3();
  const camDir = new Vector3();
  const placed = [];
  let keepOut = [];
  let dirty = true;

  /** Reads the real size of each name and where the clock and button are (after a resize or a change of settings). */
  function measure() {
    dirty = false;
    for (const l of [...names, ...far]) {
      if (l.el.offsetWidth) l.w = l.el.offsetWidth;
      if (l.el.offsetHeight) l.h = l.el.offsetHeight;
    }
    keepOut = avoid();
  }

  function show(l, on, x, y) {
    if (on && (x !== l.x || y !== l.y)) {
      l.el.style.transform = `translate(${x}px, ${y}px)`;
      l.x = x;
      l.y = y;
    }
    if (on !== l.shown) {
      l.el.style.opacity = on ? "1" : "0";
      l.shown = on;
    }
  }

  return {
    /** The window or the page's layout changed: measure again at the next update. */
    invalidate() {
      dirty = true;
    },

    /** Moves every name to where its thing is on the screen (or hides it). */
    update(camera, width, height) {
      if (dirty) measure();
      camera.getWorldDirection(camDir);
      const scale = (camera.projectionMatrix.elements[5] * height) / 2;
      placed.length = 0;
      const inside = (x, y, w, h) => x >= MARGIN && y >= MARGIN && x + w <= width - MARGIN && y + h <= height - MARGIN;
      const free = (x, y, w, h, discs, own = null) =>
        inside(x, y, w, h) && !overlaps(placed, x, y, w, h) && !overlaps(keepOut, x, y, w, h) && !discs.some((d) => d !== own && touches(x, y, w, h, d));

      // The round bodies on screen: a name behind one is hidden, and no name is put on top of one.
      const discs = [];
      for (const l of names) {
        v.copy(l.body.group.position);
        l.depth = v.clone().sub(camera.position).dot(camDir);
        l.r = (l.body.radius * l.body.group.scale.x * scale) / Math.max(l.depth, 0.01);
        if (l.depth <= 0.01) continue;
        v.project(camera);
        l.px = ((v.x + 1) / 2) * width;
        l.py = ((1 - v.y) / 2) * height;
        l.disc = { l, x: l.px, y: l.py, r: Math.max(l.r * (l.body.ring ? 2.27 : 1), 1) }; // (Saturn's rings count as part of it)
        discs.push(l.disc);
      }

      for (const l of names) {
        let slot = null;
        const behind = l.depth > 0.01 && discs.some((d) => d.l !== l && d.l.depth < l.depth && Math.hypot(l.px - d.x, l.py - d.y) < d.r);
        if (l.depth > 0.01 && !behind) {
          const off = Math.max(l.disc.r * 0.7, 4) + 4;
          // Right of it and below is the usual place; then left, then above, whichever is the first with room.
          const options = [
            [l.px + off, l.py + off - 4],
            [l.px - off - l.w, l.py + off - 4],
            [l.px + off, l.py - off - l.h + 4],
            [l.px - off - l.w, l.py - off - l.h + 4],
          ];
          slot = options.find(([x, y]) => free(x, y, l.w, l.h, discs, l.disc)) ?? null;
        }
        if (slot) placed.push({ x: slot[0], y: slot[1], w: l.w, h: l.h });
        show(l, Boolean(slot), slot ? Math.round(slot[0]) : 0, slot ? Math.round(slot[1]) : 0);
      }

      // The sky's names are as good as infinitely far away: in the same direction from wherever the camera is.
      for (const l of far) {
        const { direction, distance } = l.place;
        let slot = null;
        if (direction.dot(camDir) > 0.05) {
          v.copy(camera.position).addScaledVector(direction, distance).project(camera);
          const px = ((v.x + 1) / 2) * width;
          const py = ((1 - v.y) / 2) * height;
          const onScreen = inside(px - 6, py - 6, 12, 12);
          const behind = discs.some((d) => Math.hypot(px - d.x, py - d.y) < d.r);
          if (onScreen && !behind && !overlaps(keepOut, px - 6, py - 6, 12, 12)) {
            const options = [
              [px + 8, py + 4, false],
              [px - 8 - l.w, py + 4, true], // (turned round, so the black hole's ring is still at its end of the name)
            ];
            slot = options.find(([x, y]) => free(x, y, l.w, l.h, discs)) ?? null;
          }
        }
        if (slot) placed.push({ x: slot[0], y: slot[1], w: l.w, h: l.h });
        if (slot && l.flipped !== slot[2]) {
          l.flipped = slot[2];
          l.el.classList.toggle("flip", slot[2]);
        }
        show(l, Boolean(slot), slot ? Math.round(slot[0]) : 0, slot ? Math.round(slot[1]) : 0);
      }
    },
  };
}
