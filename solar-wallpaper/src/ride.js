// Ride a beam of light: from the Sun's surface out past every planet in turn, with everything at its true size and true
// distance (everywhere else the distances are squashed so it all fits on a screen). At the speed of light a planet goes
// by in a blink, so near each one the ride slows down to look, and says so; what it tells you is how long light from
// the Sun really takes to get as far out as you are.
import * as A from "astronomy-engine";
import { BufferGeometry, Color, Float32BufferAttribute, MathUtils, Matrix4, Mesh, PerspectiveCamera, Points, PointsMaterial, Quaternion, Scene, ShaderMaterial, Sprite, Vector2, Vector3 } from "three";
import { AU_KM, MOONS, PLANETS, SATURN_RINGS, SUN } from "./bodies.js";
import { eqjToScene } from "./ephemeris.js";
import * as shaders from "./shaders.js";

export const LIGHT_KM_S = 299792.458;
const UNIT = 1000; // km in a scene unit
const PASS = 5; // planets are passed this many of their radii off

/**
 * The way out at `date`: the Sun's surface, then a point beside each planet in order. { stops: [{ id, name, radiusKm,
 * at (km), pass (km) }], start (km), legs: [{ from, to, length }], length (km in all) }.
 */
export function ridePlan(date) {
  const stops = PLANETS.map((p) => {
    const v = A.HelioVector(A.Body[p.body], date);
    return { id: p.id, name: p.name, radiusKm: p.radiusKm, at: eqjToScene(v.x, v.y, v.z).multiplyScalar(AU_KM) };
  });
  const start = stops[0].at.clone().normalize().multiplyScalar(SUN.radiusKm * 1.02);
  let from = start;
  const legs = [];
  const into = new Vector3();
  const onward = new Vector3();
  const toSun = new Vector3();
  let round = null; // the point to go by on the way to this planet, if any
  for (const [i, s] of stops.entries()) {
    // Beside it, square to the way in and the way on (so neither cuts across it), on the side more towards the Sun.
    // When the two ways are nearly in line (straight on, or straight back), square to the line, on the sunny side.
    // (When the next planet is on the far side of the Sun, the straight way would go through it: it goes round instead.)
    const next = stops[i + 1];
    const roundNext = next ? roundTheSun(s.at, next.at) : null;
    into.copy(s.at).sub(round ?? from).normalize();
    toSun.copy(s.at).negate().normalize();
    onward.copy(roundNext ?? next?.at ?? s.at.clone().multiplyScalar(2)).sub(s.at).normalize();
    const side = new Vector3().crossVectors(into, onward);
    if (side.length() > 0.25) {
      side.normalize();
      if (side.dot(toSun) < 0) side.negate();
    } else {
      const line = into.dot(onward) > 0 ? into.clone().add(onward) : into.clone().sub(onward);
      line.normalize();
      side.copy(toSun).addScaledVector(line, -toSun.dot(line));
      if (side.lengthSq() < 1e-9) side.set(0, 1, 0).addScaledVector(line, -line.y);
      side.normalize();
    }
    s.pass = s.at.clone().addScaledVector(side, s.radiusKm * PASS);
    if (round) {
      legs.push({ from, to: round, length: from.distanceTo(round), stop: i, round: true });
      from = round;
    }
    legs.push({ from, to: s.pass, length: from.distanceTo(s.pass), stop: i });
    from = s.pass;
    round = roundNext;
  }
  return { stops, start, legs, length: legs.reduce((n, l) => n + l.length, 0) };
}

/** A point to go by on the way from `a` to `b` (km, the Sun at the origin) if the straight way comes too near the Sun. */
function roundTheSun(a, b) {
  const ab = b.clone().sub(a);
  const t = MathUtils.clamp(-a.dot(ab) / ab.lengthSq(), 0, 1);
  const foot = a.clone().addScaledVector(ab, t);
  const keep = Math.min(a.length(), b.length()) / 2;
  if (foot.length() > keep / 2) return null;
  // Out from the Sun past the nearest point (or, straight through, square to the way, in the planets' plane).
  if (foot.length() < 1) foot.crossVectors(ab, new Vector3(0, 1, 0));
  return foot.normalize().multiplyScalar(keep);
}

/**
 * Where along the way `km` in is, which leg that is, and which planet it leads to: { at (km), leg, stop }. Past the last
 * planet the way goes on, straight out from the Sun, towards the stars (leg and stop are then the numbers of each).
 */
export function rideAt(plan, km, out = new Vector3()) {
  let left = Math.max(0, km);
  for (let i = 0; i < plan.legs.length; i++) {
    const l = plan.legs[i];
    if (left <= l.length) return { at: out.lerpVectors(l.from, l.to, left / l.length), leg: i, stop: l.stop };
    left -= l.length;
  }
  const last = plan.legs.at(-1).to;
  return { at: out.copy(last).normalize().multiplyScalar(left).add(last), leg: plan.legs.length, stop: plan.stops.length };
}

/** How far it is from `km` in to where the way passes the next planet (km along the way, detours and all). */
export function rideToNext(plan, km) {
  let end = 0;
  for (const l of plan.legs) {
    end += l.length;
    if (end >= km && !l.round) return end - km;
  }
  return Infinity;
}

/** How long light takes to come `km`, in words: "8 min 19 s", "4 h 9 min", "2 d 5 h". */
export function lightTimeText(km) {
  const s = Math.round(km / LIGHT_KM_S);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

/**
 * The ride's own scene: the Sun, planets and moons as drawn in the solar system (the same shapes, maps and light), at
 * true size and true distance, from `real` (the solar system's real positions: AU, scene axes). Drawn round the camera,
 * which stays at the origin (far out, the numbers would otherwise be too big to place things finely). Far off, a planet
 * is smaller than a pixel, so each also has a dot, as it would be a bright star.
 */
export function createRide(bodies, real) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 2e7);
  // The stars go in a scene of their own, drawn first, behind everything (the sky is a ball 1,000 across: at true
  // distances the Sun and planets are further off than that, and would be hidden behind it).
  const skyScene = new Scene();
  const skyCamera = new PerspectiveCamera(50, innerWidth / innerHeight, 1, 3000);
  const things = []; // { id, mesh, radius (units) }
  const rings = [];
  const sun = bodies.get("sun");
  const sunMesh = new Mesh(sun.mesh.geometry, sun.mesh.material);
  sunMesh.scale.setScalar(SUN.radiusKm / UNIT);
  scene.add(sunMesh);
  things.push({ id: "sun", mesh: sunMesh, radius: SUN.radiusKm / UNIT });
  // Its glow (the same as in the solar system), never smaller than a bright star's.
  const glows = sun.group.children.filter((c) => c.isSprite).map((s) => {
    const g = new Sprite(s.material);
    scene.add(g);
    return { sprite: g, size: s.scale.x / sun.radius };
  });
  const dots = [];
  for (const def of [...PLANETS, ...MOONS]) {
    const b = bodies.get(def.id);
    if (!b) continue;
    const radius = def.radiusKm / UNIT;
    // The same material, but for Saturn: its rings' shadow is worked out in scene units, which here are different.
    const material = b.ring
      ? new ShaderMaterial({ ...shaders.planet, uniforms: { ...b.material.uniforms, center: { value: new Vector3() }, ringRadii: { value: new Vector2(SATURN_RINGS.inner * radius, SATURN_RINGS.outer * radius) } } })
      : b.material;
    const mesh = new Mesh(b.mesh.geometry, material);
    mesh.scale.setScalar(radius);
    if (b.clouds) {
      const clouds = new Mesh(b.clouds.geometry, b.clouds.material);
      clouds.scale.setScalar(b.clouds.scale.x);
      mesh.add(clouds);
    }
    if (b.ring) {
      const ringMat = new ShaderMaterial({
        ...shaders.rings,
        uniforms: { ...b.ring.material.uniforms, center: { value: new Vector3() }, planetRadius: { value: radius } },
        transparent: true,
        depthWrite: false,
        side: b.ring.material.side,
      });
      const ring = new Mesh(b.ring.geometry, ringMat);
      ring.rotation.copy(b.ring.rotation);
      mesh.add(ring);
      rings.push({ mesh, uniforms: [material.uniforms.center, ringMat.uniforms.center] });
    }
    scene.add(mesh);
    const thing = { id: def.id, mesh, body: b, radius };
    things.push(thing);
    if (!def.parent) {
      const dot = new Points(new BufferGeometry().setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3)), new PointsMaterial({ color: new Color(def.color), size: 3, sizeAttenuation: false, depthWrite: false }));
      dot.frustumCulled = false;
      scene.add(dot);
      dots.push({ dot, thing });
    }
  }
  const look = new Quaternion();
  const watch = new Quaternion();
  const m = new Matrix4();
  const ahead = new Vector3();
  const toward = new Vector3();
  const up = new Vector3(0, 1, 0);
  const origin = new Vector3();

  return {
    scene,
    camera,
    skyScene,
    /** Draws the ride: the stars, then everything else in front. */
    render(renderer) {
      skyCamera.quaternion.copy(camera.quaternion);
      renderer.autoClear = true;
      renderer.render(skyScene, skyCamera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
    /**
     * Puts everything round the camera at `eye` (km), looking along the way (towards `next`, km) or, near a planet,
     * partly at it (`near`: { at (km), radiusKm }), or back at the Sun (`back`); turning smoothly (`dt` seconds since last
     * time, or null to turn at once).
     */
    place(eye, next, { near = null, back = false, dt = null } = {}) {
      let closest = Infinity;
      for (const t of things) {
        const at = real.get(t.id);
        if (!at) continue;
        t.mesh.position.copy(at).multiplyScalar(AU_KM).sub(eye).divideScalar(UNIT);
        if (t.body) t.body.mesh.getWorldQuaternion(t.mesh.quaternion); // (turned and spinning as it really is)
        closest = Math.min(closest, t.mesh.position.length() - t.radius);
      }
      for (const r of rings) for (const u of r.uniforms) u.value.copy(r.mesh.position);
      for (const d of dots) d.dot.position.copy(d.thing.mesh.position);
      const sunFar = sunMesh.position.length();
      for (const g of glows) g.sprite.position.copy(sunMesh.position), g.sprite.scale.setScalar(Math.max(g.size * SUN.radiusKm / UNIT, sunFar * g.size * 0.004));
      sun.mesh.material.uniforms.time.value += dt ?? 0;
      // Close up, the near plane comes in (or a planet you pass would be cut open); far out, it goes back, and the far
      // one goes out to keep the Sun in.
      const near0 = MathUtils.clamp(closest * 0.2, 0.01, 1000);
      const far0 = Math.max(2e7, sunFar * 2);
      if (Math.abs(near0 / camera.near - 1) > 0.25 || far0 > camera.far) {
        camera.near = near0;
        camera.far = far0;
        camera.updateProjectionMatrix();
      }
      if (back) ahead.copy(eye).negate();
      else ahead.copy(next).sub(eye);
      look.setFromRotationMatrix(m.lookAt(origin, ahead, up));
      if (near && !back) {
        // Near a planet, watch it (from 60 of its radii in, coming and going), so it doesn't just slide off the side.
        // (Turning, not mixing directions: going away, it is behind you, and the mix of the two would be nothing.)
        toward.copy(near.at).sub(eye);
        const w = 1 - MathUtils.smoothstep(toward.length() / near.radiusKm, 20, 60);
        if (w > 0) look.slerp(watch.setFromRotationMatrix(m.lookAt(origin, toward, up)), w * 0.95);
      }
      if (dt === null) camera.quaternion.copy(look);
      else camera.quaternion.slerp(look, 1 - Math.exp(-dt * 3));
      camera.position.set(0, 0, 0);
    },
    resize() {
      for (const c of [camera, skyCamera]) {
        c.aspect = innerWidth / innerHeight;
        c.updateProjectionMatrix();
      }
    },
  };
}
