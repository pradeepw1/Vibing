// The camera for the view from a planet or moon. On a planet it hovers just
// above the surface on the evening side, so the Sun sits low over the horizon
// and the other planets string out along the sky. On a moon it faces the
// planet the moon goes round instead, rising over the horizon. Drag to look
// around, scroll to go higher or lower.
import { MathUtils, Matrix4, Quaternion, Vector3 } from "three";

const DEG = Math.PI / 180;
const ECLIPTIC_NORTH = new Vector3(0, 1, 0);

/** Vertical field of view for a screen shape: 46 degrees, wider on tall screens so at least 60 degrees fit across. */
export function povFov(aspect) {
  const forWidth = (2 * Math.atan(Math.tan(30 * DEG) / aspect)) / DEG;
  return MathUtils.clamp(forWidth, 46, 95);
}

export function createPovCamera(dom) {
  const state = {
    altitude: 0.15, // height above the ground, in the body's radii
    yaw: 0, // degrees round the horizon from the Sun
    pitch: 0, // degrees up from the default tilt (which keeps the horizon low on screen at any height)
    sway: 0, // phase of the slow drift
    lastInput: 0, // when the user last moved the view (ms)
    dragging: null,
    enabled: false,
  };

  const up = new Vector3();
  const forward = new Vector3();
  const side = new Vector3();
  const look = new Vector3();
  const m = new Matrix4();

  /**
   * Works out where the camera sits and which way it faces.
   *   center, radius: the body as drawn
   *   aim: direction from the body to what the view is built around (the Sun,
   *        or for a moon its planet)
   * Writes into `out` = { position: Vector3, quaternion: Quaternion, up, near }.
   */
  function pose(center, radius, aim, fov, out, aimHeight = 14, ringPole = null) {
    // Stand round from the point right under `aim`, towards ecliptic north, far
    // enough that `aim` sits `aimHeight` degrees above the visible horizon. The
    // ecliptic, where the planets are, then runs along the horizon.
    const round = (90 + dip() - aimHeight) * DEG;
    side.copy(ECLIPTIC_NORTH).addScaledVector(aim, -ECLIPTIC_NORTH.dot(aim));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(aim, -aim.x);
    side.normalize();
    if (ringPole) ringSide(aim, ringPole, round);
    up.copy(aim).multiplyScalar(Math.cos(round)).addScaledVector(side, Math.sin(round)).normalize();
    out.position.copy(center).addScaledVector(up, radius * (1 + state.altitude));

    // Level direction towards `aim`, then turn and tilt by yaw and pitch.
    forward.copy(aim).addScaledVector(up, -aim.dot(up)).normalize();
    const pitch = MathUtils.clamp(defaultPitch(fov) + state.pitch, -89, 89) * DEG;
    forward.applyAxisAngle(up, -state.yaw * DEG);
    side.crossVectors(forward, up).normalize();
    forward.applyAxisAngle(side, pitch);
    look.copy(out.position).add(forward);
    out.quaternion.setFromRotationMatrix(m.lookAt(out.position, look, up));
    out.up.copy(up);
    out.near = MathUtils.clamp(radius * state.altitude * 0.3, 0.0004, 0.01);
    return out;
  }

  /**
   * On a ringed planet, near the pole the rings are below the horizon. Lean
   * the way we step round (`side`) so we end up about 25 degrees from the
   * equator, on the side the Sun lights, where the rings arch across the sky.
   */
  const east = new Vector3();
  const towardPole = new Vector3();
  function ringSide(aim, pole, round) {
    east.crossVectors(pole, aim);
    towardPole.copy(pole).addScaledVector(aim, -pole.dot(aim));
    const poleness = towardPole.length();
    if (east.lengthSq() < 1e-8 || poleness < 1e-4) return;
    east.normalize();
    towardPole.divideScalar(poleness);
    const lat = 25 * DEG * (pole.dot(aim) < 0 ? -1 : 1);
    const lean = (Math.sin(lat) - pole.dot(aim) * Math.cos(round)) / (poleness * Math.sin(round));
    const phi = Math.asin(MathUtils.clamp(lean, -1, 1));
    side.copy(east).multiplyScalar(Math.cos(phi)).addScaledVector(towardPole, Math.sin(phi)).normalize();
  }

  /** How far below level the horizon is, in degrees, from the camera's height. */
  const dip = () => Math.acos(1 / (1 + state.altitude)) / DEG;

  /** Tilt so the horizon sits near the bottom of the screen. */
  function defaultPitch(fov) {
    return MathUtils.clamp(-(dip() - 0.56 * (fov / 2)), -70, 10);
  }

  // --- Looking around: drag with one pointer, pinch with two fingers ---
  const touches = new Map();
  let pinchGap = 0;
  const gap = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  dom.addEventListener("pointerdown", (e) => {
    if (!state.enabled || (!e.isPrimary && e.pointerType !== "touch")) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinchGap = gap();
        state.dragging = null; // two fingers: pinch, not look
        return;
      }
    }
    if (e.button === 0 && touches.size < 2) state.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  addEventListener("pointermove", (e) => {
    if (!state.enabled) return;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const now = gap();
      if (pinchGap > 0 && now > 0) state.altitude = MathUtils.clamp(state.altitude * (pinchGap / now) ** 1.5, 0.02, 12);
      pinchGap = now;
      state.lastInput = performance.now();
      return;
    }
    const d = state.dragging;
    if (!d || d.id !== e.pointerId) return;
    state.lastInput = performance.now();
    const scale = povFov(innerWidth / Math.max(innerHeight, 1)) / Math.max(innerHeight, 1); // degrees per pixel
    state.yaw -= (e.clientX - d.x) * scale; // drag the sky along with the pointer
    state.pitch = MathUtils.clamp(state.pitch + (e.clientY - d.y) * scale, -80, 80);
    d.x = e.clientX;
    d.y = e.clientY;
  });
  const stop = (e) => {
    touches.delete(e.pointerId);
    if (state.dragging?.id === e.pointerId) state.dragging = null;
  };
  addEventListener("pointerup", stop);
  addEventListener("pointercancel", stop);
  dom.addEventListener(
    "wheel",
    (e) => {
      if (!state.enabled) return;
      e.preventDefault();
      state.altitude = MathUtils.clamp(state.altitude * Math.exp(e.deltaY * 0.0015), 0.02, 12);
      state.lastInput = performance.now();
    },
    { passive: false },
  );

  return {
    state,
    pose,
    /**
     * Start fresh when arriving at a new body. On a moon, look straight at its
     * planet; on a planet, put the Sun a little left of centre.
     */
    reset(onMoon, fov, aspect) {
      const across = (2 * Math.atan(Math.tan((fov / 2) * DEG) * aspect)) / DEG;
      state.altitude = 0.15;
      state.yaw = onMoon ? 0 : 0.22 * across;
      state.pitch = 0;
      state.sway = 0;
    },
    /** A slow sway left and right, so the Sun (or planet) stays in the picture. */
    drift(dt) {
      if (state.dragging) return;
      const before = Math.sin(state.sway);
      state.sway += (dt * 2 * Math.PI) / 360; // once every six minutes
      state.yaw += 22 * (Math.sin(state.sway) - before);
    },
    newPose: () => ({ position: new Vector3(), quaternion: new Quaternion(), up: new Vector3(0, 1, 0), near: 0.01 }),
  };
}
