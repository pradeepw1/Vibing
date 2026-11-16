// Moons' shadows on their planets: the Moon's on Earth during an eclipse of the Sun, Io's and the other big moons' on
// Jupiter as they cross it. Worked out from the real sizes and distances (the scene squashes distances, so a shadow cast
// by what is drawn would be the wrong size in the wrong place), then drawn onto the planet as a spot.
import { Vector3 } from "three";
import { AU_KM, SUN } from "./bodies.js";

/** Which moons can cast a shadow onto which planet (the others are too small or too far off to show). */
export const CASTERS = { earth: ["moon"], mars: ["phobos", "deimos"], jupiter: ["io", "europa", "ganymede", "callisto"], saturn: ["titan"] };

const w = new Vector3();
const u = new Vector3();
const s = new Vector3();

/**
 * A moon's shadow on its planet, or null if it misses. Positions are real (AU, scene axes, the Sun at the origin), sizes
 * in km. Returns { dir: where the middle of the shadow is, from the planet's centre (unit); umbra: radius of the
 * full shadow, as an angle on the planet (negative when the Moon is too far to cover the whole Sun: a ring of fire);
 * penumbra: radius of the part shadow, as an angle }.
 */
export function moonShadow(planetPos, moonPos, planetKm, moonKm, out = { dir: new Vector3(), umbra: 0, penumbra: 0 }) {
  const moonFromSun = moonPos.length();
  u.copy(moonPos).divideScalar(moonFromSun); // the shadow's axis: from the Sun, through the moon
  w.subVectors(planetPos, moonPos);
  const t = w.dot(u); // how far beyond the moon, along the axis, the planet is (AU)
  if (t <= 0) return null; // the planet is on the Sun's side of the moon
  s.copy(w).addScaledVector(u, -t); // the planet's centre, off the axis
  const offKm = s.length() * AU_KM;
  const k = t / moonFromSun;
  const penumbraKm = moonKm + (SUN.radiusKm + moonKm) * k;
  const umbraKm = moonKm - (SUN.radiusKm - moonKm) * k;
  if (offKm >= planetKm + penumbraKm) return null;
  // Where the axis comes through the sunny side (or, missing the planet, the edge nearest it).
  const along = offKm < planetKm ? -Math.sqrt(planetKm * planetKm - offKm * offKm) : 0;
  out.dir.copy(s).multiplyScalar(-AU_KM).addScaledVector(u, along).normalize();
  out.umbra = umbraKm / planetKm;
  out.penumbra = Math.min(Math.PI / 2, penumbraKm / planetKm);
  return out;
}
