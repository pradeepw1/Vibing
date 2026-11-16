// Fly it yourself: the camera becomes a ship you steer through the solar system (as drawn: distances squashed, the
// planets going round as usual). Keys push it, dragging (or the arrow keys) turns it. It goes slower the nearer it is to
// something, so you can come in close to a planet and still cross the gaps between them quickly, and it never goes
// inside a planet, moon or the Sun.
import { MathUtils, Quaternion, Vector3 } from "three";

/** Which key does what (by position on the keyboard, so the same on every layout). */
export const SHIP_KEYS = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  KeyR: "up",
  KeyF: "down",
  KeyQ: "rollLeft",
  KeyE: "rollRight",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  ArrowUp: "turnUp",
  ArrowDown: "turnDown",
  ShiftLeft: "faster",
  ShiftRight: "faster",
  Space: "stop",
};

const TURN = 1.2; // radians a second, with the arrow keys
const ROLL = 1.5;
const DRAG = 0.004; // radians a pixel dragged
const NEAREST = 0.01; // never slower than this (scene units a second) at full push...
const FASTEST = 40; // ...nor faster than this
const HOLD = 1.05; // keep at least this many of a body's radii from its middle

const tmp = new Vector3();
const push = new Vector3();
const q = new Quaternion();
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/**
 * The ship, flying `camera`. step(dt, bodies) moves it, where bodies are [{ position, radius, name }] (scene units);
 * it returns { nearest: that body's name, gap: how far off its surface, speed } (scene units, a second).
 */
export function createShip(camera) {
  const held = new Set(); // what the keys held down are doing
  const velocity = new Vector3();
  let dragX = 0;
  let dragY = 0;

  /** Turns the ship about one of its own axes. */
  function turn(axis, angle) {
    if (angle) camera.quaternion.multiply(q.setFromAxisAngle(axis, angle)).normalize();
  }

  return {
    velocity,
    held,
    /** A key went down (true) or up (false). Returns whether it is one of the ship's. */
    key(code, down) {
      const what = SHIP_KEYS[code];
      if (!what) return false;
      if (down) held.add(what);
      else held.delete(what);
      return true;
    },
    /** Dragged by (dx, dy) pixels: turn that way. */
    drag(dx, dy) {
      dragX += dx;
      dragY += dy;
    },
    /** Lets go of everything (a new flight, or the window lost focus). */
    reset() {
      held.clear();
      velocity.set(0, 0, 0);
      dragX = dragY = 0;
    },
    step(dt, bodies) {
      const on = (what) => (held.has(what) ? 1 : 0);
      // Turning: the arrow keys turn at a steady rate, dragging by as much as you drag, the way you drag.
      turn(AXIS_Y, (on("turnLeft") - on("turnRight")) * TURN * dt - dragX * DRAG);
      turn(AXIS_X, (on("turnUp") - on("turnDown")) * TURN * dt - dragY * DRAG);
      turn(AXIS_Z, (on("rollLeft") - on("rollRight")) * ROLL * dt);
      dragX = dragY = 0;

      // How near the nearest thing is, which sets how fast you can go.
      let nearest = null;
      let gap = Infinity;
      for (const b of bodies) {
        const g = camera.position.distanceTo(b.position) - b.radius;
        if (g < gap) (gap = g), (nearest = b);
      }
      const top = MathUtils.clamp(gap, NEAREST, FASTEST) * (held.has("faster") ? 4 : 1);
      push.set(on("right") - on("left"), on("up") - on("down"), on("back") - on("forward"));
      if (push.lengthSq()) push.normalize().applyQuaternion(camera.quaternion).multiplyScalar(top);
      if (held.has("stop")) velocity.set(0, 0, 0);
      // Speed up towards it, and coast to a stop when you let go (quicker near things).
      else velocity.lerp(push, 1 - Math.exp(-dt * 2.5));
      if (velocity.length() > top) velocity.setLength(top); // (coming in fast to something near: slow down)
      camera.position.addScaledVector(velocity, dt);

      // Never inside anything: back out to its surface, and stop going in.
      for (const b of bodies) {
        tmp.subVectors(camera.position, b.position);
        const d = tmp.length();
        const keep = b.radius * HOLD;
        if (d < keep) {
          tmp.divideScalar(d || 1);
          camera.position.copy(b.position).addScaledVector(tmp, keep);
          const inward = velocity.dot(tmp);
          if (inward < 0) velocity.addScaledVector(tmp, -inward);
        }
      }
      return { nearest: nearest?.name ?? null, gap, speed: velocity.length() };
    },
  };
}
