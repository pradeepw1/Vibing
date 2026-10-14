// The sky as seen from one body (the "observer").
//
// The overview squashes distances outward from the Sun. That keeps directions
// right as seen from the Sun, but not as seen from anywhere else. So when you
// look from a body, everything else is laid out again around it, in its real
// direction from there. Discs are drawn much bigger than real so you can see
// them (see shownAngle), and that would make things
// overlap far too often (an eclipse at every new moon). So wherever two discs
// come close, the gap between them is stretched so that they touch exactly
// when the real ones do, as seen from somewhere on the observer. Eclipses,
// transits and occultations then happen on their real dates and only then.
//
// Each close pair pushes its two bodies apart to the stretched gap (and pulls
// together only discs that really touch), keeping the side one is on of the
// other, and small discs give way to big ones (the Sun never moves). A body
// near several others (a planet near both the Sun and the Moon) gets nudged
// by each in turn, a few rounds over, until they all agree; a last pass makes
// sure nothing is left touching that doesn't really. Every push fades in
// smoothly as two bodies near each other, so nothing jumps.
//
// Moons of other planets are spread out from their planet, so they cross its
// disc exactly when they really do. Depth only decides what covers what:
// nearer things are drawn in front, and a disc never cuts into one it overlaps.
import { Quaternion, Vector3 } from "three";
import { AU_KM, MOONS, PLANETS, SUN } from "./bodies.js";

const DEG = Math.PI / 180;
const SIZE_GAIN = 0.733; // small discs: shown angle = SIZE_GAIN * sqrt(real angle), in radians
const BIG = 8 * DEG; // discs grow less as they near this size, and ones already bigger aren't grown at all
const WARP_REACH = 12 * DEG; // stretching near a disc fades out by this far from it
const ROUNDS = 8; // times every close pair gets nudged
const SIDE = 0.1; // how strongly a body is drawn round to its real side of another, each round
const PULL = 0.3; // pairs stop pulling together once their target gap is this much (times touching) wider than touching
const MAX_DEPTH = 700; // nearer than the star and Milky Way shells round the camera (850-1000)

const RADIUS_KM = new Map([[SUN.id, SUN.radiusKm], ...PLANETS.map((p) => [p.id, p.radiusKm]), ...MOONS.map((m) => [m.id, m.radiusKm])]);
const PARENT = new Map(MOONS.map((m) => [m.id, m.parent]));
const REACH = new Map([["saturn", 2.27]]); // how far a body's rings stick out, in its radii

/** Which planet's family a body belongs to (a planet is its own). The Sun has none. */
export const familyOf = (id) => PARENT.get(id) ?? (id === SUN.id ? null : id);

/** How far away (scene units) a body at `au` from the observer is drawn, at least. Grows with distance, so nearer things cover farther ones. */
export const skyDistance = (au) => 30 * (1 + Math.sqrt(au));

/**
 * The angle (radians) a disc is drawn at, given its real angle (both are
 * radii). Small discs are blown up a lot (the Sun from Earth comes out 2.7
 * degrees), big ones less and less, and ones that are big anyway (Jupiter
 * from Io) not at all. Always growing with the real size, so a disc that
 * really covers another still can.
 */
export const shownAngle = (realAngle) => Math.max(realAngle, BIG * Math.tanh((SIZE_GAIN * Math.sqrt(realAngle)) / BIG));

/** Sets `out` to `from` turned towards `toward` by `angle` radians. */
function turn(from, toward, angle, out) {
  const perp = _perp.copy(toward).addScaledVector(from, -from.dot(toward));
  if (perp.lengthSq() < 1e-20) perp.set(1, 0, 0).addScaledVector(from, -from.x);
  if (perp.lengthSq() < 1e-20) perp.set(0, 0, 1);
  perp.normalize();
  return out.copy(from).multiplyScalar(Math.cos(angle)).addScaledVector(perp, Math.sin(angle));
}
const _perp = new Vector3();

/**
 * Maps a real separation between two discs to a shown one.
 *   touch:      real angle at which the two real discs touch (sum of radii)
 *   parallax:   how far moving about on the observer can shift them
 *   touchShown: shown angle at which the shown discs touch
 *   far:        beyond this nothing changes
 * Somewhere on the observer the separation is `angle - parallax` smaller, so
 * that's what's compared with `touch`: the shown discs overlap exactly when
 * the real ones do as seen from somewhere on the observer, and are centred on
 * each other when someone there sees them centred. Continuous and never
 * decreasing.
 */
function stretch(angle, touch, parallax, touchShown, far) {
  if (angle >= far) return angle;
  const seen = Math.max(0, angle - parallax);
  if (seen <= touch) return (touchShown * seen) / touch;
  const edge = touch + parallax;
  return touchShown + ((angle - edge) * (far - touchShown)) / (far - edge);
}
const reach = (edge, touchShown) => Math.max(WARP_REACH, touchShown * 1.5, edge * 1.5);

/** How far out a moon of another planet is drawn, in units of "just touching" its planet. */
const spread = (u) => (u <= 1 ? u : 1 + 0.9 * Math.log(u));

/**
 * Parallax counts for "seen from somewhere on the observer", but only up to
 * a degree or so (or a couple of disc sizes): for a close moon like Phobos
 * it's 21 degrees, which would pin Phobos onto the Sun for a good part of
 * every orbit. The Moon's, under a degree from Earth, counts in full, so it
 * covers planets when it really does for someone on Earth.
 */
const parallaxFor = (c, r) => Math.min(Math.max(c.parallax, r.parallax), Math.max(2 * (c.realAngle + r.realAngle), 1.2 * DEG));

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Lays out the sky around `observerId`.
 *   real:    Map id -> real position (AU, scene axes), from realPositions()
 *   anchor:  where the sky is centred in the scene (the camera, or the observer)
 * Returns Map id -> { position, radius (scene units), angle (shown radius,
 * radians), distanceAu }. The observer itself is not included.
 */
export function skyLayout(observerId, real, anchor, out = new Map()) {
  const o = real.get(observerId);
  const family = familyOf(observerId);
  const observerKm = RADIUS_KM.get(observerId);
  // Everything here is reused from call to call: this runs every frame.
  bodies.length = 0;
  for (const r of records.values()) r.used = false;
  for (const [id, p] of real) {
    if (id === observerId) continue;
    const r = records.get(id) ?? records.set(id, { id, realDir: new Vector3(), dir: new Vector3() }).get(id);
    r.realDir.subVectors(p, o);
    r.au = r.realDir.length();
    r.realDir.divideScalar(r.au);
    r.dir.copy(r.realDir);
    const km = r.au * AU_KM;
    r.realAngle = Math.asin(Math.min(1, RADIUS_KM.get(id) / km));
    r.angle = shownAngle(r.realAngle);
    r.give = id === SUN.id ? 0 : 1 / (r.angle * r.angle); // how easily it's pushed about: small discs give way
    // How much being somewhere else on the observer can shift it (parallax).
    r.parallax = Math.asin(Math.min(1, observerKm / km));
    r.family = familyOf(id);
    r.foreignMoon = PARENT.has(id) && r.family !== family;
    r.moons = r.moons ?? [];
    r.moons.length = 0;
    r.used = true;
    bodies.push(r);
  }
  // A far planet's moons ride along with it whenever it's moved.
  for (const r of bodies) if (r.foreignMoon) records.get(PARENT.get(r.id)).moons.push(r);

  // Find the pairs close enough to need stretching, and what gap each wants.
  pairs.length = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      let c = bodies[i];
      let r = bodies[j];
      // Moons of one far planet are spread out together from it (below), not from each other.
      if (c.foreignMoon && r.foreignMoon && c.family === r.family) continue;
      // c is the one the other is placed round: the Sun, a far moon's own
      // planet, anything rather than a far moon, or else the bigger disc.
      if (r.id === SUN.id || PARENT.get(c.id) === r.id) [c, r] = [r, c];
      else if (c.id !== SUN.id && PARENT.get(r.id) !== c.id && (c.foreignMoon || (!r.foreignMoon && r.angle > c.angle))) [c, r] = [r, c];
      const realSep = c.realDir.angleTo(r.realDir);
      const touch = c.realAngle + r.realAngle;
      const touchShown = c.angle + r.angle;
      const pair = pairs.length < pairPool.length ? pairPool[pairs.length] : pairPool[pairPool.push({}) - 1];
      pair.c = c;
      pair.r = r;
      if (r.foreignMoon && PARENT.get(r.id) === c.id) {
        // A moon of a far planet: spread out from its planet, which doesn't budge.
        pair.target = touchShown * spread(realSep / touch);
        pair.weight = 1;
        pair.order = 0;
        pair.shareC = 0;
        pair.shareR = 1;
        pair.clearOnly = false;
        pair.pull = 1;
        pair.touchShown = 0;
        pairs.push(pair);
        continue;
      }
      const parallax = parallaxFor(c, r);
      const far = reach(touch + parallax, touchShown);
      if (realSep >= far) continue;
      pair.target = stretch(realSep, touch, parallax, touchShown, far);
      pair.touchShown = touchShown;
      // A pair works hardest when its discs are near touching, and lets go
      // smoothly as they get farther apart: then nothing jumps, and a pair
      // that's about to touch wins over one that isn't.
      const spare = (pair.target - touchShown) / touchShown;
      const weight = (1 - smoothstep((realSep - 0.6 * far) / (0.4 * far))) * (1 - smoothstep((spare - 1) / 2));
      pair.weight = 1 - Math.pow(1 - weight, 1 / ROUNDS); // per round, so the rounds add up to `weight`
      // Only discs that really touch (or nearly) pull each other in. Pulling
      // together two that don't can drag one round to the wrong side of a
      // third, or onto it.
      pair.pull = 1 - smoothstep(spare / PULL);
      pair.order = c.id === SUN.id ? 2 : 1; // the Sun's pairs go last, so its eclipses come out right
      const give = c.give + r.give;
      pair.shareC = c.give / give;
      pair.shareR = r.give / give;
      pair.clearOnly = r.foreignMoon;
      if (r.foreignMoon) {
        // A far planet's moon stays where its planet puts it, unless that's
        // nearer this disc than it really is: then it's pushed out that far.
        // (So it may miss going behind the Sun, which no one could see
        // anyway, but it never fakes it.)
        pair.target = Math.min(pair.target, touchShown * 1.02);
        pair.order = 3;
        pair.shareC = 0;
        pair.shareR = 1;
      }
      pairs.push(pair);
    }
  }
  pairs.sort((a, b) => a.order - b.order); // stable, so the order is the same frame to frame

  for (let round = 0; round < ROUNDS; round++) for (const pair of pairs) nudge(pair);
  // Last, make sure no two discs touch that don't really: push any such pair
  // just clear of each other.
  for (const pair of pairs) if (pair.touchShown && pair.target >= pair.touchShown) clear(pair);

  // Depth: nearer is nearer, at least skyDistance() away. Where a disc
  // overlaps (or nearly) one that's nearer, it's pushed back far enough that
  // its sphere stays wholly behind that one, so the nearer one always covers it.
  bodies.sort((a, b) => a.au - b.au);
  let deepest = 0;
  for (let i = 0; i < bodies.length; i++) {
    const r = bodies[i];
    const rReach = REACH.get(r.id) ?? 1;
    r.depth = skyDistance(r.au);
    for (let j = 0; j < i; j++) {
      const n = bodies[j];
      const nReach = REACH.get(n.id) ?? 1;
      if (n.dir.angleTo(r.dir) > (n.angle * nReach + r.angle * rReach) * 1.1 + 0.2 * DEG) continue;
      const behind = (n.depth * (1 + Math.sin(n.angle) * nReach) * 1.01) / Math.max(0.05, 1 - Math.sin(r.angle) * rReach);
      if (behind > r.depth) r.depth = behind;
    }
    deepest = Math.max(deepest, r.depth);
  }
  // Pull it all in if needed to stay inside the stars (same scale for all, so nothing starts to cut into anything).
  const squeeze = deepest > MAX_DEPTH ? MAX_DEPTH / deepest : 1;

  for (const r of bodies) {
    const entry = out.get(r.id) ?? { position: new Vector3(), radius: 0, angle: 0, distanceAu: 0 };
    const depth = r.depth * squeeze;
    entry.position.copy(anchor).addScaledVector(r.dir, depth);
    entry.radius = depth * Math.sin(r.angle);
    entry.angle = r.angle;
    entry.distanceAu = r.au;
    out.set(r.id, entry);
  }
  return out;
}
const records = new Map();
const bodies = [];
const pairs = [];
const pairPool = [];

const _toward = new Vector3();
const _want = new Vector3();
const _side = new Vector3();
const _move = new Vector3();
const _carry = new Quaternion();

/**
 * Moves a pair towards its stretched gap: `r` should sit `target` from `c`.
 * The gap is put right in full (times the pair's weight; pulling together
 * only for discs that really touch), and `r` is leaned a little round `c`
 * towards the side it's really on (carried along with wherever `c` has been
 * moved to), so a body near several others can slide round to where all
 * the gaps work out. A `clearOnly` pair is only ever pushed apart, straight
 * out.
 */
function nudge(pair) {
  const gap = pair.c.dir.angleTo(pair.r.dir);
  let out;
  if (gap < pair.target) out = pair.clearOnly ? 1 : pair.weight;
  else out = pair.clearOnly ? 0 : pair.weight * pair.pull;
  move(pair, pair.target, gap, out, pair.clearOnly ? 0 : pair.weight * SIDE);
}

/** Pushes a pair of discs that don't really touch just clear of each other, if they're drawn touching. */
function clear(pair) {
  const goal = Math.min(pair.target, pair.touchShown * 1.02);
  const gap = pair.c.dir.angleTo(pair.r.dir);
  if (gap < goal) move(pair, goal, gap, 1, 0);
}

/**
 * Moves r (and c, by their shares): `out` of the way to sitting `goal` from
 * c, and `round` of the way round c to its real side. Pushed out from near
 * c's middle, it goes the way its real side is, so it can't flip from one
 * side to the other as it passes the middle.
 */
function move(pair, goal, gap, out, round) {
  const { c, r } = pair;
  if (out <= 0 && round <= 0) return;
  _side.copy(r.realDir).addScaledVector(c.realDir, -c.realDir.dot(r.realDir));
  _side.applyQuaternion(_carry.setFromUnitVectors(c.realDir, c.dir)).normalize();
  _toward.copy(r.dir).addScaledVector(c.dir, -c.dir.dot(r.dir));
  if (_toward.lengthSq() < 1e-20) _toward.copy(_side);
  else _toward.normalize().lerp(_side, 1 - smoothstep((2 * gap) / Math.max(goal, 1e-9))).normalize();
  _move.set(0, 0, 0);
  if (out > 0) _move.add(turn(c.dir, _want.copy(c.dir).add(_toward), goal, _want).sub(r.dir).multiplyScalar(out));
  if (round > 0) _move.add(turn(c.dir, _want.copy(c.dir).add(_side), gap, _want).sub(r.dir).multiplyScalar(round));
  if (pair.shareR) shift(r, pair.shareR);
  if (pair.shareC) shift(c, -pair.shareC);
}

/** Moves a body by `share` of _move, taking its moons (if it's a far planet) along. */
function shift(body, share) {
  if (!body.moons.length) {
    body.dir.addScaledVector(_move, share).normalize();
    return;
  }
  _was.copy(body.dir);
  body.dir.addScaledVector(_move, share).normalize();
  _carry.setFromUnitVectors(_was, body.dir);
  for (const m of body.moons) m.dir.applyQuaternion(_carry);
}
const _was = new Vector3();

/**
 * How much of the Sun a body sees, 0..1, with `blocker` (its planet, or the
 * Moon for Earth) possibly in the way. Positions are real, in AU.
 */
export function sunlight(bodyPos, blockerPos, blockerKm) {
  const toSun = _a.copy(bodyPos).negate();
  const toBlocker = _b.copy(blockerPos).sub(bodyPos);
  const ds = toSun.length();
  const db = toBlocker.length();
  if (db >= ds) return 1; // the blocker is farther away than the Sun
  const r1 = Math.asin(Math.min(1, SUN.radiusKm / (ds * AU_KM)));
  const r2 = Math.asin(Math.min(1, blockerKm / (db * AU_KM)));
  const d = toSun.angleTo(toBlocker);
  return 1 - coveredFraction(r1, r2, d);
}
const _a = new Vector3();
const _b = new Vector3();

/** Fraction of a disc of radius r1 covered by a disc of radius r2 whose centre is d away. */
export function coveredFraction(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return (a1 + a2 - k) / (Math.PI * r1 * r1);
}
