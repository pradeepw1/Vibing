// The Wallpaper's camera. Four zoom levels, from the whole solar system down to planets up close,
// and at every level the camera keeps moving on its own, slowly and for ever:
//
//   1  Whole system   all nine planets
//   2  Out to Saturn  the Sun, Mercury to Saturn: bigger planets, Jupiter's and Saturn's moons
//   3  Inner planets  Mercury to Mars and the asteroid belt, with the Moon
//   4  Up close       one planet at a time with its moons, then a slow glide to the next
//
// Levels 1 to 3 go round the Sun: all the way round, up and down (level 1 from below the planets' plane to
// nearly straight above them, so the whole sky comes into view; levels 2 and 3 stay at gentler angles, where
// a wide screen is filled), and in and out a little. Each of the three moves has its own length, so the
// picture takes a long time to repeat. The path says how far out to fit, not how far to stand, so the
// same path suits any window shape (see `distanceFor`). Level 4 swings back and forth round the sunny
// side of each planet, so it is mostly lit rather than a dark disc.
//
// Everything here is plain arithmetic, so it can be tested without a browser.
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

export const PATH = {
  lap: 600, // seconds for one trip all the way round
  bob: 840, // seconds for one rise and fall
  breath: 540, // seconds for one move in and out
  start: -35, // where the camera starts, in degrees round the Sun
  // Degrees above the planets' plane (below it when negative). `sharp` makes it hang about near the
  // two ends and pass quickly through the flat edge-on view in between, which is the dullest one.
  elevation: { low: -42, high: 68, sharp: 2.2 },
};

const INNER = ["mercury", "venus", "earth", "mars"];
export const ZOOMS = [
  // `reach` is how far out from the Sun to fit across the screen, in scene units (Neptune's orbit is about 55,
  // Pluto's 63, up to 70; Saturn's 31; the asteroid belt 15 to 18; Mars's 12). `fit` are the planets that must
  // stay on screen whatever happens (null: all of them); the rest may drift off the edge.
  { id: 1, name: "Whole system", note: "All nine planets, small and far apart.", reach: { mid: 63.5, ratio: 1.16 }, fit: null },
  { id: 2, name: "Out to Saturn", note: "The Sun, the inner planets, Jupiter and Saturn, with the moons that are big enough to see.", reach: { mid: 34, ratio: 1.12 }, fit: [...INNER, "jupiter", "saturn"], elevation: { low: -26, high: 44, sharp: 2.2 } },
  { id: 3, name: "Inner planets", note: "Mercury to Mars, the asteroid belt and our Moon, big and close.", reach: { mid: 15, ratio: 1.1 }, fit: INNER, elevation: { low: -22, high: 40, sharp: 2.2 } },
  { id: 4, name: "Up close", note: "One planet at a time, with its moons and its names, then a slow glide to the next.", tour: true },
];
export const zoomOf = (id) => ZOOMS.find((z) => z.id === id) ?? ZOOMS[0];

// --- Levels 1 to 3: round the Sun ---

/** Degrees above the plane after `seconds`: a smooth up and down that lingers at both ends. */
function elevationAt(seconds, { low, high, sharp }, period) {
  const swing = Math.tanh(sharp * Math.sin((TAU * seconds) / period)) / Math.tanh(sharp); // -1 .. 1
  return low + ((high - low) * (1 + swing)) / 2;
}

/** Where the camera is after `seconds` of going round: { azimuth, elevation (radians), reach (scene units) }. */
export function pathAt(seconds, zoom = ZOOMS[0], path = PATH) {
  const { mid, ratio } = zoom.reach;
  return {
    azimuth: (path.start + (360 * seconds) / path.lap) * DEG,
    elevation: elevationAt(seconds, zoom.elevation ?? path.elevation, path.bob) * DEG,
    reach: mid * Math.pow(ratio, Math.sin((TAU * seconds) / path.breath + 1.1)),
  };
}

const RIM = 48; // points round the edge of the disc that are checked
/**
 * How far from the Sun to stand so a flat disc of the given `reach` (the planets' orbits, level
 * with the ground) just fits the screen, whichever way we are turned round it. The disc is
 * looked at from `elevation` above its plane, so the near edge looks bigger than the far one;
 * that's worked out for real, not guessed. `margin` is the share of the screen's half-width
 * and half-height the rim may reach.
 */
export function distanceFor(reach, fovDeg, aspect, elevation, margin = 0.94) {
  const tv = Math.tan((fovDeg * DEG) / 2);
  const th = tv * aspect;
  const sinE = Math.sin(elevation);
  const cosE = Math.cos(elevation);
  const fits = (d) => {
    for (let i = 0; i < RIM; i++) {
      const phi = (i / RIM) * TAU;
      const depth = d - reach * cosE * Math.cos(phi);
      if (depth <= 0.01) return false;
      const across = Math.abs((reach * Math.sin(phi)) / (depth * th));
      const up = Math.abs((reach * sinE * Math.cos(phi)) / (depth * tv));
      if (across > margin || up > margin) return false;
    }
    return true;
  };
  let lo = reach * cosE; // too close: the near edge is behind the camera
  let hi = reach * 40;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Where the camera goes at a level that goes round the Sun, and what it looks at (the Sun, the middle of the scene).
 * `points` are the places of the planets that must stay on screen right now: the camera also stands back far
 * enough that every one of them is in the picture, worked out exactly (Pluto's orbit is lopsided and tilted
 * 17 degrees, so a flat disc alone could clip it).
 */
export function orbitView({ seconds, fov, aspect, zoom = ZOOMS[0], points = [], path = PATH, margin = 0.94 }) {
  const { azimuth, elevation, reach } = pathAt(seconds, zoom, path);
  let d = distanceFor(reach, fov, aspect, elevation, margin);
  const sinE = Math.sin(elevation);
  const cosE = Math.cos(elevation);
  const sinA = Math.sin(azimuth);
  const cosA = Math.cos(azimuth);
  const tv = Math.tan((fov * DEG) / 2);
  const th = tv * aspect;
  for (const p of points) {
    // The point's place across the picture (x), up it (y) and towards the camera (along), in the camera's own directions.
    const x = p.x * sinA - p.z * cosA;
    const y = -p.x * sinE * cosA + p.y * cosE - p.z * sinE * sinA;
    const along = p.x * cosE * cosA + p.y * sinE + p.z * cosE * sinA;
    d = Math.max(d, Math.max(Math.abs(x) / (margin * th), Math.abs(y) / (margin * tv)) + along);
  }
  return { position: [cosE * cosA * d, sinE * d, cosE * sinA * d], target: [0, 0, 0] };
}

// --- Level 4: planets up close ---

/** The planets visited, in order. */
export const TOUR = ["earth", "jupiter", "saturn", "mars", "venus", "uranus", "neptune", "mercury", "pluto"];
export const TOUR_STOP = 90; // seconds at each planet, counting the glide to the next
export const TOUR_GLIDE = 16; // seconds of that spent gliding

const smooth = (t) => t * t * (3 - 2 * t);

/** Which planet the tour is at after `seconds`, and (during a glide) the next one and how far along: { from, to, blend }. */
export function tourAt(seconds, stops = TOUR) {
  const n = stops.length;
  const at = Math.floor(seconds / TOUR_STOP);
  const local = seconds - at * TOUR_STOP;
  const k = ((at % n) + n) % n;
  const glide = Math.max(0, (local - (TOUR_STOP - TOUR_GLIDE)) / TOUR_GLIDE);
  return { from: stops[k], to: stops[(k + 1) % n], blend: smooth(Math.min(1, glide)) };
}

/** How far to stand to fit a sphere of this radius in the picture, on a screen of this shape. */
export function distanceForSphere(radius, fovDeg, aspect) {
  const vfov = fovDeg * DEG;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  return radius / Math.sin(Math.min(vfov, hfov) / 2);
}

/** Round one planet: the camera swings to and fro over its sunny side and rises and sinks. { azimuth, elevation } in radians, `sunward` the way to the Sun. */
export function closeAngles(seconds, sunward) {
  return {
    azimuth: sunward + 96 * DEG * Math.sin((TAU * seconds) / 230),
    elevation: (12 + 34 * Math.sin((TAU * seconds) / 160 + 0.6)) * DEG,
  };
}

/** The camera's place if it were looking at one planet: `body` is { position: {x,y,z}, radius: how much to fit }. */
function closeAt(seconds, body, fov, aspect) {
  const { position: p, radius } = body;
  const { azimuth, elevation } = closeAngles(seconds, Math.atan2(-p.z, -p.x));
  const d = distanceForSphere(radius, fov, aspect);
  const target = [p.x, p.y, p.z];
  const position = [p.x + Math.cos(elevation) * Math.cos(azimuth) * d, p.y + Math.sin(elevation) * d, p.z + Math.cos(elevation) * Math.sin(azimuth) * d];
  return { position, target };
}

/**
 * Where the camera goes at the close-up level. `info(id)` gives { position, radius } for a planet (radius: how
 * much of its surroundings to fit: the planet, its rings, its moons' orbits).
 */
export function closeView({ seconds, fov, aspect, info, stops = TOUR }) {
  const { from, to, blend } = tourAt(seconds, stops);
  const a = closeAt(seconds, info(from), fov, aspect);
  if (blend <= 0) return a;
  const b = closeAt(seconds, info(to), fov, aspect);
  const mix = (u, v) => u.map((x, i) => x + (v[i] - x) * blend);
  return { position: mix(a.position, b.position), target: mix(a.target, b.target) };
}

/**
 * The camera at any level. `planets` is { id: {x,y,z} } for every planet; `info(id)` as in closeView.
 */
export function viewAt({ seconds, fov, aspect, zoom, planets, info }) {
  if (zoom.tour) return closeView({ seconds, fov, aspect, info });
  const ids = zoom.fit ?? Object.keys(planets);
  return orbitView({ seconds, fov, aspect, zoom, points: ids.map((id) => planets[id]).filter(Boolean) });
}
