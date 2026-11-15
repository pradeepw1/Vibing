// The real stars and constellations (packed in stars-data.js, see tools/make-stars.mjs), as the sky draws them.
import { blackbody } from "./exosystem.js";
import { skyDirection } from "./galaxies.js";
import { CONSTELLATIONS, LINES, NAMED_STARS, STARS } from "./stars-data.js";

/** base64 to 16-bit numbers (in a browser or in node). */
function unpack(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

const ra = (n) => (n / 65535) * 360;
const dec = (n) => ((n - 32768) / 32767) * 90;

/** Every star: { ra, dec, mag, bv } (degrees; bv is NaN where it wasn't measured). */
export function realStars() {
  const n = unpack(STARS);
  const out = [];
  for (let i = 0; i < n.length; i += 4) {
    out.push({ ra: ra(n[i]), dec: dec(n[i + 1]), mag: (n[i + 2] - 32768) / 1000, bv: n[i + 3] === 65535 ? NaN : (n[i + 3] - 32768) / 1000 });
  }
  return out;
}

/** The constellations' lines, each as [ra1, dec1, ra2, dec2] in degrees. */
export function constellationLines() {
  const n = unpack(LINES);
  const out = [];
  for (let i = 0; i < n.length; i += 4) out.push([ra(n[i]), dec(n[i + 1]), ra(n[i + 2]), dec(n[i + 3])]);
  return out;
}

/** Names on the sky: the constellations', and the brightest stars'. { id, name, direction, star } */
export function skyNames() {
  return [
    ...CONSTELLATIONS.map(([id, name, r, d]) => ({ id: `con-${id}`, name, direction: skyDirection(r, d), star: false })),
    ...NAMED_STARS.map(([name, r, d]) => ({ id: `star-${name}`, name, direction: skyDirection(r, d), star: true })),
  ];
}

/** A star's colour from its B-V index (a star whose colour wasn't measured: a little warmer than white). */
export function starColour(bv) {
  if (!Number.isFinite(bv)) return blackbody(6500);
  const b = Math.min(2, Math.max(-0.4, bv));
  // Ballesteros (2012): B-V to the temperature of the star's surface.
  return blackbody(4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)));
}

/** How big (CSS pixels) and how bright (0..1) to draw a star of this magnitude: Sirius biggest, the faintest still a dot. */
export function starLook(mag) {
  const light = Math.min(1, Math.max(0, Math.pow(10, -0.4 * (mag - 1)))); // its light, compared with a first-magnitude star
  const share = Math.min(1, Math.max(0, (6.2 - mag) / 7.7)); // where it sits between the faintest and Sirius
  return { size: 1.1 + 2.8 * share * share, bright: Math.min(1, 0.3 + 0.7 * Math.sqrt(light)) };
}
