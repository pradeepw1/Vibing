// The Wallpaper's camera. It goes slowly round the Sun, for ever, at one fixed angle a little
// above the planets' plane, looking at the Sun. How close it is, the zoom, is set in the menu:
// from 1x (all nine planets) to 10x (the Sun and Mercury). A change of zoom eases in and out
// (`stepZoom`), never jumps.
//
// The zoom says how far out from the Sun to fit across the screen, not how far to stand, so the
// same zoom suits any window shape (see `distanceFor`).
//
// Everything here is plain arithmetic, so it can be tested without a browser.
import { auToScene } from "./ephemeris.js";

const DEG = Math.PI / 180;

export const PATH = {
  lap: 600, // seconds for one trip all the way round
  start: -35, // where the camera starts, in degrees round the Sun
  elevation: 9, // degrees above the planets' plane: low, so the orbits are wide ovals that fill a wide screen
};

export const ZOOM = {
  min: 1,
  max: 10,
  default: 1, // the whole system: the Sun and all nine planets
  whole: 72, // how far out the whole system reaches, in scene units (Pluto is up to 70 from the Sun)
};

/** A zoom (1 to 10) kept inside its limits. */
export const clampZoom = (zoom) => Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));

/** How far out from the Sun fits across the screen at this zoom, in scene units. */
export const reachFor = (zoom) => ZOOM.whole / clampZoom(zoom);

// The planets' orbits (mean distance from the Sun), for saying what a zoom shows.
const ORBITS = [
  ["Mercury", 0.387],
  ["Venus", 0.723],
  ["Earth", 1],
  ["Mars", 1.524],
  ["Jupiter", 5.203],
  ["Saturn", 9.537],
  ["Uranus", 19.19],
  ["Neptune", 30.07],
  ["Pluto", 39.48],
].map(([name, au]) => ({ name, reach: auToScene(au) }));

/** What a zoom shows, in words: "Out to Saturn", "The whole system", "The Sun". */
export function zoomLabel(zoom) {
  const reach = reachFor(zoom);
  const last = ORBITS.filter((o) => o.reach <= reach).pop();
  if (!last) return "The Sun";
  return last.name === "Pluto" ? "The whole system" : `Out to ${last.name}`;
}

/** Where the camera is round the Sun after `seconds`: { azimuth, elevation } in radians. */
export function pathAt(seconds, path = PATH) {
  return {
    azimuth: (path.start + (360 * seconds) / path.lap) * DEG,
    elevation: path.elevation * DEG,
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
      const phi = (i / RIM) * 2 * Math.PI;
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
 * Where the camera stands after `seconds`, fitting `reach` on a screen of this shape, and what it looks at (the Sun).
 * `points` are the planets' places right now: the camera also stands back far enough that each one inside the reach
 * is on screen, worked out exactly (Pluto's orbit is tilted 17 degrees, so at this low angle it can sit below the
 * flat disc). A planet outside the reach counts as the point where its direction meets the edge of the reach, so
 * nothing jumps as a planet comes inside it while zooming.
 */
export function orbitView({ seconds, fov, aspect, reach, points = [], path = PATH, margin = 0.94 }) {
  const { azimuth, elevation } = pathAt(seconds, path);
  let d = distanceFor(reach, fov, aspect, elevation, margin);
  const sinE = Math.sin(elevation);
  const cosE = Math.cos(elevation);
  const sinA = Math.sin(azimuth);
  const cosA = Math.cos(azimuth);
  const tv = Math.tan((fov * DEG) / 2);
  const th = tv * aspect;
  for (const p of points) {
    const k = Math.min(1, reach / Math.max(Math.hypot(p.x, p.y, p.z), 1e-9));
    // The point's place across the picture (x), up it (y) and towards the camera (along), in the camera's own directions.
    const x = k * (p.x * sinA - p.z * cosA);
    const y = k * (-p.x * sinE * cosA + p.y * cosE - p.z * sinE * sinA);
    const along = k * (p.x * cosE * cosA + p.y * sinE + p.z * cosE * sinA);
    d = Math.max(d, Math.max(Math.abs(x) / (margin * th), Math.abs(y) / (margin * tv)) + along);
  }
  return { position: [cosE * cosA * d, sinE * d, cosE * sinA * d], target: [0, 0, 0] };
}

/**
 * Eases the zoom towards `zoom` (the one picked) by `dt` seconds: like a weight on a spring that is damped just
 * enough not to overshoot, so it starts gently, never bounces, and is all but there in about two seconds. Works on the
 * logarithm of the reach, so zooming from 1x to 2x feels the same as from 5x to 10x. `state` is { value, speed };
 * returns true while it is still moving.
 */
export function stepZoom(state, zoom, dt) {
  const target = Math.log(reachFor(zoom));
  const w = 3.5; // how stiff the spring is
  for (let left = dt; left > 0; left -= 1 / 60) {
    const h = Math.min(left, 1 / 60); // small steps, so a slow frame doesn't throw it off
    state.speed += (-2 * w * state.speed - w * w * (state.value - target)) * h;
    state.value += state.speed * h;
  }
  if (Math.abs(state.value - target) < 5e-4 && Math.abs(state.speed) < 5e-4) { // (a twentieth of a percent: too little to see)
    state.value = target;
    state.speed = 0;
    return false;
  }
  return true;
}

/** A spring at rest at this zoom. */
export const zoomState = (zoom) => ({ value: Math.log(reachFor(zoom)), speed: 0 });
