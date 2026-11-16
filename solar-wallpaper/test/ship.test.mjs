// Fly it yourself (src/ship.js): pushing, turning, slowing near things, and never going inside one.
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { createShip } from "../src/ship.js";

function fly(ship, bodies, seconds, dt = 1 / 60) {
  let info = null;
  for (let t = 0; t < seconds; t += dt) info = ship.step(dt, bodies);
  return info;
}

test("W pushes it the way it faces, and letting go it coasts to a stop", () => {
  const camera = new PerspectiveCamera();
  const ship = createShip(camera);
  const far = [{ position: new Vector3(0, 0, 1e6), radius: 1, name: "far" }];
  ship.key("KeyW", true);
  fly(ship, far, 2);
  assert.ok(camera.position.z < -1, `forward is -z: ${camera.position.z}`);
  assert.ok(Math.abs(camera.position.x) < 1e-9 && Math.abs(camera.position.y) < 1e-9);
  ship.key("KeyW", false);
  fly(ship, far, 5);
  assert.ok(ship.velocity.length() < 0.01 * 40, "slowing down");
  ship.key("Space", true);
  fly(ship, far, 0.1);
  assert.equal(ship.velocity.length(), 0, "Space stops it dead");
  assert.equal(ship.key("KeyZ", true), false, "not one of its keys");
});

test("turning: the arrow keys and dragging", () => {
  const camera = new PerspectiveCamera();
  const ship = createShip(camera);
  const forward = () => new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  ship.key("ArrowLeft", true);
  fly(ship, [], 0.5);
  ship.key("ArrowLeft", false);
  assert.ok(forward().x < -0.4, `turned left: ${forward().x}`);
  const before = forward();
  ship.drag(0, -100); // dragging up looks up
  fly(ship, [], 1 / 60);
  assert.ok(forward().y > before.y + 0.3, "looked up");
});

test("slower near a planet, and never inside it", () => {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 50);
  const ship = createShip(camera);
  const planet = { position: new Vector3(0, 0, 0), radius: 1, name: "Earth" };
  ship.key("KeyW", true); // straight at it
  let info = fly(ship, [planet], 0.5);
  const farSpeed = info.speed;
  info = fly(ship, [planet], 20);
  assert.equal(info.nearest, "Earth");
  assert.ok(camera.position.length() >= 1.05 - 1e-9, `outside it: ${camera.position.length()}`);
  assert.ok(info.speed < farSpeed / 20, `slowed right down: ${info.speed} vs ${farSpeed}`);
  // Shift is faster.
  ship.key("KeyW", false);
  ship.reset();
  camera.position.set(0, 0, 50);
  camera.quaternion.identity();
  ship.key("KeyS", true);
  const slow = fly(ship, [planet], 1).speed;
  ship.key("ShiftLeft", true);
  const fast = fly(ship, [planet], 1).speed;
  assert.ok(fast > slow * 2, `${fast} > ${slow} × 2`);
});
