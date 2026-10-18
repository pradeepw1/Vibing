// Where and when the strange sightings happen.
//
// Each sighting (see ufo.js, ships.js, phenomena.js) is a short scene that
// builds its own picture. This file only decides when one starts, puts it in
// front of the camera, and tells it to stop if the view changes under it.
//
// All of the made-up ones say so: when one ends, a note says what it was.
import { Vector3 } from "three";

const DEG = Math.PI / 180;

/** Seconds of watching before the first one, then between them. */
const FIRST_WAIT = [75, 150];
const BETWEEN = [240, 540];
/** How far in front of the camera a sighting is put, in scene units. */
const REACH = [30, 220];
/** Keep this much clear of any planet or moon, as a share of its size. */
const CLEAR = 1.6;
/**
 * How far off the middle of the view the sighting is put, in degrees: enough not to sit right on the Sun,
 * but never more than this share of the way to the side of the view (a tall, narrow window is only about 13 degrees wide each way).
 */
const OFF_SIDE = [5, 14];
const OFF_SHARE = 0.4;
/** A request for one by hand lapses after this long without room for it, in milliseconds. */
const REQUEST_MS = 4000;
const OFF_UP = [-4, 6];
/** The most it tips the line of sight to bring a sighting up over the ground, in steps of degrees. */
const MAX_TIP = 15;
const TIP_STEP = 3;

const between = (rand, [a, b]) => a + (b - a) * rand();

/**
 * @param {object} options
 * @param {import("three").Scene} options.scene  The solar system's scene.
 * @param {Array<(pixelRatio:number)=>object>} options.builders  Functions that make sightings.
 * @param {number} options.pixelRatio
 * @param {() => number} [options.random]  Anything that gives numbers from 0 up to 1.
 * @param {() => number} [options.now]  The time in milliseconds (a request for one now lapses after a few seconds).
 */
export function createStage({ scene, builders, pixelRatio, random = Math.random, now = () => performance.now() }) {
  const made = new Map(); // builder -> the sighting it made (built the first time it's needed)
  let bag = []; // builders not yet shown in this round, so every one gets a turn
  let current = null; // { sighting, ctx, holder, ended }
  let wait = between(random, FIRST_WAIT);
  let enabled = true;
  let last = null; // the one that just ended, for the note
  let wanted = null; // "show me one now" waiting for a good moment: { id (true, or the id asked for), until }
  let onEnd = null;
  const ahead = new Vector3();
  const anchor = new Vector3();
  const eye = new Vector3();
  const side = new Vector3();
  const side2 = new Vector3();
  const right = new Vector3();
  const upAxis = new Vector3();
  const back = new Vector3();

  /** A particular sighting by its id, building the others to find it if need be. */
  function byId(id) {
    for (const builder of builders) if (build(builder).id === id) return builder;
    return null;
  }

  function pick(id) {
    if (typeof id === "string") {
      const found = byId(id);
      if (found) return found;
    }
    if (!bag.length) bag = shuffle(builders.slice(), random);
    // Never the same one twice in a row, even across rounds.
    let i = bag.length - 1;
    if (bag.length > 1 && made.get(bag[i]) === last) i--;
    return bag.splice(i, 1)[0];
  }

  function build(builder) {
    if (!made.has(builder)) made.set(builder, builder(pixelRatio));
    return made.get(builder);
  }

  /** How far in front of the camera `ahead` can go before it meets a body, or 0 if it can't be used. */
  function clearReach(view) {
    let reach = between(random, REACH);
    for (const s of view.spheres) {
      // How far along the line of sight does it start to block the way?
      side.copy(s.center).sub(eye);
      const along = side.dot(ahead);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, side.lengthSq() - along * along));
      const r = s.radius * (s.clear ?? CLEAR);
      if (off < r) {
        const front = along - Math.sqrt(r * r - off * off);
        if (front <= 0) return 0; // inside the keep-clear zone of a body: no good here
        reach = Math.min(reach, front * 0.6);
      }
    }
    return reach > 1 ? reach : 0;
  }

  /**
   * Finds a place in front of the camera that's clear of the bodies in `view.spheres`.
   * Returns the distance (with the way in `ahead` and the camera's place in `eye`), or 0
   * if there's nowhere good. When asked for by hand and standing on a planet, the line
   * of sight is tipped up a little at a time if the ground is in the way.
   */
  function place(camera, view, forced) {
    camera.getWorldDirection(ahead);
    eye.copy(camera.position);
    // A little off the middle of the view, so it isn't always in front of whatever is there.
    camera.matrixWorld.extractBasis(right, upAxis, back);
    const half = Math.atan(Math.tan((camera.fov * DEG) / 2) * camera.aspect); // from the middle to the side of the view
    ahead.applyAxisAngle(upAxis, (random() < 0.5 ? -1 : 1) * Math.min(between(random, OFF_SIDE) * DEG, OFF_SHARE * half));
    ahead.applyAxisAngle(right, between(random, OFF_UP) * DEG).normalize();
    const reach = clearReach(view);
    if (reach || !forced || !view.up) return reach;
    // Turning about (ahead x up) tips ahead towards up. Not so far that it leaves the screen.
    side2.crossVectors(ahead, view.up);
    if (side2.lengthSq() < 1e-6) return 0;
    side2.normalize();
    for (let tip = TIP_STEP; tip <= MAX_TIP; tip += TIP_STEP) {
      ahead.applyAxisAngle(side2, TIP_STEP * DEG).normalize();
      const r = clearReach(view);
      if (r) return r;
    }
    return 0;
  }

  function begin(camera, view, forced, id) {
    const reach = place(camera, view, forced);
    if (!reach) return false;
    const builder = pick(id);
    const sighting = build(builder);
    anchor.copy(eye).addScaledVector(ahead, reach);
    const holder = sighting.group;
    const scale = 2 * reach * Math.tan((sighting.angle * DEG) / 2);
    holder.position.copy(anchor);
    holder.scale.setScalar(scale);
    holder.quaternion.identity();
    if (!holder.parent) scene.add(holder);
    const ctx = { camera, random, anchor: holder.position, scale };
    sighting.start(ctx);
    current = { sighting, ctx, started: camera.position.clone(), reach };
    return true;
  }

  function finish(note = true) {
    if (!current) return;
    const { sighting } = current;
    sighting.group.visible = false;
    last = sighting;
    current = null;
    wait = between(random, BETWEEN);
    if (note) onEnd?.(sighting);
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(on) {
      enabled = !!on;
      if (!enabled) {
        wanted = null;
        finish(false);
      }
    },
    /** Is there one on screen right now? */
    get running() {
      return !!current;
    },
    get current() {
      return current?.sighting ?? null;
    },
    /** Called with the sighting when one ends. */
    set onEnd(fn) {
      onEnd = fn;
    },
    /**
     * Starts the next one (or the one with this id) as soon as there's a good place for it,
     * if that comes within a few seconds. True if one is, or is about to be, showing.
     */
    showOne(id) {
      if (current) return true;
      wanted = { id: id ?? true, until: now() + REQUEST_MS };
      return true;
    },
    /**
     * Builds one more sighting (and compiles its shaders) ahead of time, so that the first time it
     * shows doesn't stutter. Call now and then while nothing is happening. False once all are built.
     */
    prepare(renderer, camera) {
      const next = builders.find((b) => !made.has(b));
      if (!next) return false;
      const holder = build(next).group;
      holder.visible = false;
      if (!holder.parent) scene.add(holder);
      (renderer.compileAsync ?? renderer.compile).call(renderer, scene, camera);
      return true;
    },
    /** Every sighting made so far (the ones shown), for tests and clean-up. */
    get built() {
      return [...made.values()];
    },
    /**
     * Once a frame, with the seconds since the last one.
     * `view`: { allowed, up, spheres } where `allowed` is false while the camera is
     * between views, `up` is the way up when standing on a body (or null), and
     * `spheres` the planets and moons as { center, radius }.
     */
    update(dt, camera, view) {
      if (current) {
        if (!view.allowed) return finish(false);
        const alive = current.sighting.update(dt, current.ctx);
        if (!alive) finish(true);
        return;
      }
      if (wanted && now() > wanted.until) wanted = null; // no room came, or we were away
      if (!view.allowed) return;
      if (wanted) {
        // Asked for: go on the first frame there is room for it.
        if (begin(camera, view, true, wanted.id)) wanted = null;
        return;
      }
      if (!enabled) return;
      wait -= dt;
      if (wait > 0) return;
      if (!begin(camera, view, false)) wait = 2; // try again in a moment
    },
    /** Lets go of everything. */
    dispose() {
      finish(false);
      for (const s of made.values()) {
        scene.remove(s.group);
        s.dispose();
      }
      made.clear();
    },
  };
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
