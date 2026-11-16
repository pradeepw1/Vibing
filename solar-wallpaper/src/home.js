// "Your sky": the view from where you live. Where that is comes from the `place` setting ("latitude, longitude"), or
// else from the computer's time zone (its main city, from the tz database: see zones-data.js), so nothing has to be
// asked. Which way is up there right now, and which way is towards the equator, as scene directions.
import * as A from "astronomy-engine";
import { Vector3 } from "three";
import { eqjToScene } from "./ephemeris.js";
import { ZONES } from "./zones-data.js";

/** "41.85, -87.65" (or with spaces, or with a name after: "41.85, -87.65, Chicago") to [lat, lon, name?], or undefined. */
export function parsePlace(value) {
  const parts = String(value).split(",").map((s) => s.trim());
  const [lat, lon] = parts.slice(0, 2).map(Number);
  if (!(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return undefined;
  return parts[2] ? [lat, lon, parts.slice(2).join(", ")] : [lat, lon];
}

/** The time zone's city, as a person would write it: "America/Argentina/Buenos_Aires" to "Buenos Aires". */
const cityOf = (zone) => zone.split("/").pop().replace(/_/g, " ");

/** Where "your sky" is seen from: { lat, lon, name, guessed } (guessed: from the time zone, not set). */
export function homePlace(place, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (place) return { lat: place[0], lon: place[1], name: place[2] ?? `${place[0].toFixed(2)}, ${place[1].toFixed(2)}`, guessed: false };
  const known = zone && ZONES[zone];
  if (known) return { lat: known[0], lon: known[1], name: cityOf(zone), guessed: true };
  return { lat: 51.48, lon: 0, name: "Greenwich", guessed: true }; // (a time zone we don't know: somewhere, at least)
}

/** Straight up from that place at `date`, as a scene direction (the Earth turns, so this moves through the day). */
export function homeUp(date, home, out = new Vector3()) {
  const v = A.ObserverVector(date, new A.Observer(home.lat, home.lon, 0), false);
  return eqjToScene(v.x, v.y, v.z, out).normalize();
}

/** Level, towards the equator (south in the northern half of the world): where the Sun, Moon and planets go across. */
export function homeFacing(up, home, out = new Vector3()) {
  const pole = eqjToScene(0, 0, 1);
  const north = pole.addScaledVector(up, -pole.dot(up));
  if (north.lengthSq() < 1e-10) return out.set(1, 0, 0).addScaledVector(up, -up.x).normalize(); // (at a pole: any way)
  north.normalize();
  return out.copy(north).multiplyScalar(home.lat >= 0 ? -1 : 1);
}

/** Today's sunrise and sunset there, and the Moon: the note for "your sky". */
export function homeNote(date, home) {
  const observer = new A.Observer(home.lat, home.lon, 0);
  const dayStart = new Date(date.getTime() - 12 * 3600000);
  const rise = A.SearchRiseSet(A.Body.Sun, observer, +1, dayStart, 1);
  const set = A.SearchRiseSet(A.Body.Sun, observer, -1, dayStart, 1);
  const time = (t) => (t ? t.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "none");
  const sun = A.Horizon(date, observer, ...(() => {
    const e = A.Equator(A.Body.Sun, date, observer, true, true);
    return [e.ra, e.dec];
  })(), "normal");
  const moon = A.Illumination(A.Body.Moon, date);
  const waxing = A.MoonPhase(date) < 180;
  const lit = Math.round(moon.phase_fraction * 100);
  const day = sun.altitude > 0 ? `The Sun is ${Math.round(sun.altitude)}° up.` : sun.altitude > -18 ? "Twilight." : "Night.";
  return {
    title: `Your sky over ${home.name}${home.guessed ? " (from your time zone)" : ""}`,
    lines: [`${day} Sunrise ${time(rise)}, sunset ${time(set)}.`, `The Moon is ${lit}% lit, ${waxing ? "growing" : "shrinking"}.`],
  };
}
