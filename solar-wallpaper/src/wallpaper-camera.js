// The Wallpaper's camera: Saturn in the middle. The camera swings slowly to and fro round
// Saturn's sunny side (so Saturn is lit, not a dark disc), at one fixed angle a little above
// the planets' plane, looking at Saturn. How close it is, the zoom, is set in the menu: from
// 1x (Saturn small, out past its moons) to 6x (its rings filling the screen). A change of zoom
// eases in and out (`stepZoom`), never jumps. (It goes no further out because the camera is on
// Saturn's sunny side: much further back and it would be behind the Sun.)
//
// The zoom says how far out from Saturn to fit across the screen, not how far to stand, so
// the same zoom suits any window shape (see `distanceFor`).
//
// Everything here is plain arithmetic, so it can be tested without a browser.
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

export const PATH = {
  swing: 100, // degrees either side of the sunny side the camera swings to
  period: 600, // seconds for one swing there and back
  elevation: 9, // degrees above the planets' plane: the angle that was picked
};

export const ZOOM = {
  min: 1,
  max: 6,
  default: 2, // Saturn, its rings and its three big moons
  whole: 14.4, // how far out from Saturn fits across the screen at 1x, in scene units (the camera is then about 25 from Saturn; the Sun is about 31)
};

/** A zoom (1 to 6) kept inside its limits. */
export const clampZoom = (zoom) => Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));

/** How far out from Saturn fits across the screen at this zoom, in scene units. */
export const reachFor = (zoom) => ZOOM.whole / clampZoom(zoom);

// What a zoom takes in, by how far out it reaches (scene units). Saturn's rings reach 2.75 from its middle;
// Rhea's orbit is about 3.6, Titan's 4.5 and Iapetus's 5.7; the Sun is about 31 away.
const TAKES_IN = [
  [3.4, "Saturn's rings, up close"],
  [6, "Saturn and its rings"],
  [9, "Saturn and its moons"],
  [Infinity, "Saturn, out past its moons"],
];

/** What a zoom shows, in words. */
export const zoomLabel = (zoom) => TAKES_IN.find(([reach]) => reachFor(zoom) <= reach)[1];

/** The direction (round the planets' plane) from `center` towards the Sun, in radians. */
export const sunwardOf = (center) => Math.atan2(-center.z, -center.x);

/** Where the camera is round Saturn after `seconds`: { azimuth, elevation } in radians. `sunward`: see sunwardOf. */
export function pathAt(seconds, sunward = 0, path = PATH) {
  return {
    azimuth: sunward + path.swing * DEG * Math.sin((TAU * seconds) / path.period),
    elevation: path.elevation * DEG,
  };
}

const RIM = 48; // points round the edge of the disc that are checked
/**
 * How far from the middle to stand so a flat disc of the given `reach` (level with the planets' plane) just fits the
 * screen, whichever way we are turned round it. The disc is looked at from `elevation` above its plane, so the near
 * edge looks bigger than the far one; that's worked out for real, not guessed. `margin` is the share of the screen's
 * half-width and half-height the rim may reach.
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
 * Where the camera stands after `seconds`, fitting `reach` round `center` (Saturn's place) on a screen of this shape,
 * and what it looks at (Saturn). `points` are the places of things that should stay on screen (Saturn's moons): the
 * camera stands back far enough that each one inside the reach is in the picture, worked out exactly (their orbits are
 * tipped with Saturn, 27 degrees to the planets' plane, so at this low angle they reach above and below the flat
 * disc). One outside the reach counts as the point where its direction meets the edge of the reach, so nothing jumps
 * as it comes inside while zooming. `maxDistance`: never stand further back than this, even if then not all of it fits
 * (on a tall screen, fitting the width would put the camera behind the Sun).
 */
export function orbitView({ seconds, fov, aspect, reach, center = { x: 0, y: 0, z: 0 }, points = [], maxDistance = Infinity, path = PATH, margin = 0.94 }) {
  const { azimuth, elevation } = pathAt(seconds, sunwardOf(center), path);
  let d = distanceFor(reach, fov, aspect, elevation, margin);
  const sinE = Math.sin(elevation);
  const cosE = Math.cos(elevation);
  const sinA = Math.sin(azimuth);
  const cosA = Math.cos(azimuth);
  const tv = Math.tan((fov * DEG) / 2);
  const th = tv * aspect;
  for (const q of points) {
    const p = { x: q.x - center.x, y: q.y - center.y, z: q.z - center.z };
    const k = Math.min(1, reach / Math.max(Math.hypot(p.x, p.y, p.z), 1e-9));
    // The point's place across the picture (x), up it (y) and towards the camera (along), in the camera's own directions.
    const x = k * (p.x * sinA - p.z * cosA);
    const y = k * (-p.x * sinE * cosA + p.y * cosE - p.z * sinE * sinA);
    const along = k * (p.x * cosE * cosA + p.y * sinE + p.z * cosE * sinA);
    d = Math.max(d, Math.max(Math.abs(x) / (margin * th), Math.abs(y) / (margin * tv)) + along);
  }
  d = Math.min(d, maxDistance);
  const { x, y, z } = center;
  return { position: [x + cosE * cosA * d, y + sinE * d, z + cosE * sinA * d], target: [x, y, z] };
}

/**
 * Eases the zoom towards `zoom` (the one picked) by `dt` seconds: like a weight on a spring that is damped just
 * enough not to overshoot, so it starts gently, never bounces, and is all but there in about two seconds. Works on
 * the logarithm of the reach, so zooming from 1x to 2x feels the same as from 5x to 10x. `state` is { value, speed };
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
  if (Math.abs(state.value - target) < 5e-4 && Math.abs(state.speed) < 5e-4) {
    // (a twentieth of a percent: too little to see)
    state.value = target;
    state.speed = 0;
    return false;
  }
  return true;
}

/** A spring at rest at this zoom. */
export const zoomState = (zoom) => ({ value: Math.log(reachFor(zoom)), speed: 0 });
