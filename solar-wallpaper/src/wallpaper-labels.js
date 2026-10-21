// Names on the Wallpaper: the Sun and planets, the galaxies and the black holes. Just
// text on the picture. Nothing here can be clicked (the boxes ignore the pointer), so a
// stray click on the desktop never changes anything.
import { Vector3 } from "three";

const overlaps = (placed, x, y, w, h) => placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);

/**
 * `box`: the element to put names in. `bodies`: the Sun and planets (moons are left out: from
 * out here they sit on top of their planet). `places`: names on the sky, as { name, lightYears,
 * direction, distance, hole }.
 */
export function createLabels({ box, bodies, places }) {
  const names = [];
  for (const body of bodies) {
    if (body.kind === "moon") continue;
    const el = document.createElement("div");
    el.className = `label ${body.kind}`;
    el.textContent = body.def.name;
    box.append(el);
    names.push({ body, el, shown: null, x: 0, y: 0, width: body.def.name.length * 7.5 + 6 });
  }
  // Bigger things get their names first; one that would land on a name already placed is skipped.
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
    return { place, el, shown: null, x: 0, y: 0, width: place.name.length * 7 + 6 };
  });

  const v = new Vector3();
  const camDir = new Vector3();
  const placed = [];

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
    /** Moves every name to where its thing is on the screen (or hides it). */
    update(camera, width, height) {
      camera.getWorldDirection(camDir);
      const scale = (camera.projectionMatrix.elements[5] * height) / 2;
      placed.length = 0;
      // The round bodies on screen, so a name behind one is hidden.
      const discs = [];
      for (const l of names) {
        v.copy(l.body.group.position);
        const depth = v.clone().sub(camera.position).dot(camDir);
        l.depth = depth;
        l.r = (l.body.radius * l.body.group.scale.x * scale) / Math.max(depth, 0.01);
        if (depth <= 0.01) continue;
        v.project(camera);
        l.px = ((v.x + 1) / 2) * width;
        l.py = ((1 - v.y) / 2) * height;
        if (l.r >= 3) discs.push({ l, x: l.px, y: l.py, r: l.r });
      }
      for (const l of names) {
        let on = l.depth > 0.01;
        let x = 0;
        let y = 0;
        if (on) {
          x = Math.round(l.px + Math.max(l.r * 0.7, 4) + 4);
          y = Math.round(l.py + Math.max(l.r * 0.7, 4) - 4);
          on = x > -100 && x < width + 20 && y > -20 && y < height + 20;
          on &&= !discs.some((d) => d.l !== l && d.l.depth < l.depth && Math.hypot(l.px - d.x, l.py - d.y) < d.r);
          on &&= !overlaps(placed, x, y, l.width, 13);
          if (on) placed.push({ x, y, w: l.width, h: 13 });
        }
        show(l, on, x, y);
      }
      // The sky's names are as good as infinitely far away: in the same direction from wherever the camera is.
      for (const l of far) {
        const { direction, distance } = l.place;
        let on = direction.dot(camDir) > 0.05;
        let x = 0;
        let y = 0;
        if (on) {
          v.copy(camera.position).addScaledVector(direction, distance).project(camera);
          const px = ((v.x + 1) / 2) * width;
          const py = ((1 - v.y) / 2) * height;
          x = Math.round(px + 8);
          y = Math.round(py + 4);
          on = x > -100 && x < width + 20 && y > -30 && y < height + 20;
          on &&= !discs.some((d) => Math.hypot(px - d.x, py - d.y) < d.r);
          on &&= !overlaps(placed, x, y, l.width, 26);
          if (on) placed.push({ x, y, w: l.width, h: 26 });
        }
        show(l, on, x, y);
      }
    },
  };
}
