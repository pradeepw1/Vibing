// The Wallpaper's camera: one slow, endless path round the Sun. It turns all the way
// round, slowly rises from below the planets' plane to nearly straight above them and
// sinks again (so over time every part of the sky, with its galaxies and black holes,
// comes into view), and breathes in and out so the inner planets come closer and then
// the outer ones all fit again. Each of the three moves has its own length, so the
// picture takes a long time to repeat. The path says how far out to fit, not how far
// to stand, so the same path suits any window shape (see `distanceFor`).
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
  // How far out from the Sun to fit across the screen, in scene units. Neptune's orbit is about 55 and
  // Pluto's about 63 (up to 70), so this goes from "out past Neptune" to "all of Pluto's orbit".
  reach: { mid: 63.5, ratio: 1.16 },
};

/** Degrees above the plane after `seconds`: a smooth up and down that lingers at both ends. */
function elevationAt(seconds, { low, high, sharp }, period) {
  const swing = Math.tanh(sharp * Math.sin((TAU * seconds) / period)) / Math.tanh(sharp); // -1 .. 1
  return low + ((high - low) * (1 + swing)) / 2;
}

/** Where the camera is after `seconds` of going round: { azimuth, elevation (radians), reach (scene units) }. */
export function pathAt(seconds, path = PATH) {
  return {
    azimuth: (path.start + (360 * seconds) / path.lap) * DEG,
    elevation: elevationAt(seconds, path.elevation, path.bob) * DEG,
    reach: path.reach.mid * Math.pow(path.reach.ratio, Math.sin((TAU * seconds) / path.breath + 1.1)),
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

/** Puts `camera` on the path and looks at the Sun (the middle of the scene). */
export function placeCamera(camera, seconds, path = PATH) {
  const { azimuth, elevation, reach } = pathAt(seconds, path);
  const d = distanceFor(reach, camera.fov, camera.aspect, elevation);
  camera.position.set(Math.cos(elevation) * Math.cos(azimuth) * d, Math.sin(elevation) * d, Math.cos(elevation) * Math.sin(azimuth) * d);
  camera.lookAt(0, 0, 0);
}
