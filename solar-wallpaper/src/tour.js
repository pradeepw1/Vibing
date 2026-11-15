// The tour: with it on, the camera goes off somewhere by itself now and then, and stays a while. In the solar system and
// out among the galaxies in turn, so every other trip is a flight out and every other one a flight home. Anything you do
// (a click, a drag, a key) makes it wait a full stay again before it moves on.
import * as A from "astronomy-engine";

/** How long it stays at each place, in ms, once the camera has got there. */
export const TOUR_STAY = 45000;
/** Switched on, the first trip comes this soon (ms), so you can see it working. */
export const TOUR_FIRST = 6000;

/** Places in the solar system, in the order they come. */
export const TOUR_HOME = ["saturn", "middle", "jupiter", "earth", "mars", "system", "neptune", "inner", "uranus", "sun", "venus", "pluto", "mercury"];
/** Places out among the galaxies: galaxies, black holes and stars with planets (and the made-up Gate, once). */
export const TOUR_AWAY = [
  "galaxy-m31",
  "galaxy-sgra",
  "galaxy-lmc",
  "galaxy-trappist1",
  "galaxy-m104",
  "galaxy-cygx1",
  "galaxy-m51",
  "galaxy-proxima",
  "galaxy-m87bh",
  "galaxy-m33",
  "galaxy-hr8799",
  "galaxy-gate",
  "galaxy-cena",
  "galaxy-pegasi51",
];

/** The `n`th stop of the tour: the solar system and away in turn, going round each list. */
export function tourStop(n) {
  const i = Math.floor(Math.max(0, n) / 2);
  return n % 2 === 0 ? TOUR_HOME[i % TOUR_HOME.length] : TOUR_AWAY[i % TOUR_AWAY.length];
}

const NAMES = { sun: "Sun", mercury: "Mercury", venus: "Venus", earth: "Earth", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto" };

/** How long light takes to cover `km`, in words. */
export function lightTime(km) {
  const s = km / 299792.458;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (s < 90) return plural(Math.round(s), "second");
  const minutes = Math.round(s / 60);
  if (minutes < 90) return plural(minutes, "minute");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minutes` : ""}`;
}

const millions = (km) => `${Math.round(km / 1e6).toLocaleString("en-US")} million km`;

/**
 * What the tour says on getting to the Sun or a planet: how far it really is from Earth at `date`, and how long its light
 * takes to reach us. Null for anything else (the galaxies say their own).
 */
export function placeNote(id, date) {
  const name = NAMES[id];
  if (!name) return null;
  if (id === "earth") {
    const moonKm = A.GeoMoon(date).Length() * A.KM_PER_AU;
    return { title: "Earth", lines: [`Home. The Moon is ${Math.round(moonKm).toLocaleString("en-US")} km away right now: light crosses that in ${(moonKm / 299792.458).toFixed(1)} seconds.`] };
  }
  const km = A.GeoVector(A.Body[name], date, true).Length() * A.KM_PER_AU;
  return { title: name, lines: [`${millions(km)} from Earth right now.`, `Its light takes ${lightTime(km)} to reach us.`] };
}
