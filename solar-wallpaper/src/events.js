// What's on in the sky: eclipses, full moons, planets opposite the Sun, Mercury and Venus at their furthest from it, and
// planets close together, worked out (by astronomy-engine, as the planets' places are) for whatever date the clock says.
import * as A from "astronomy-engine";
import { COMETS } from "./visitors-data.js";
import { cometPosition, nextPerihelion, SHOWERS } from "./visitors.js";

const DAY = 86400000;
const OUTER = ["Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const PAIRS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const CLOSE = 2.5; // degrees: planets this close together count (the Moon is half a degree across)

const millionKm = (au) => `${Math.round((au * A.KM_PER_AU) / 1e6).toLocaleString("en-US")} million km`;

function lunarEclipses(from, until, add) {
  for (let e = A.SearchLunarEclipse(from); e && e.peak.date <= until; e = A.NextLunarEclipse(e.peak)) {
    const kind = e.kind; // "penumbral", "partial" or "total"
    const about =
      kind === "total"
        ? `The Moon goes right into Earth's shadow and turns red, for ${Math.round(2 * e.sd_total)} minutes. Seen from anywhere the Moon is up.`
        : kind === "partial"
          ? `Part of the Moon goes into Earth's shadow, for ${Math.round(2 * e.sd_partial)} minutes. Seen from anywhere the Moon is up.`
          : "The Moon passes through the edge of Earth's shadow, and dims a little. Hard to notice.";
    add(e.peak.date, { kind: "lunar-eclipse", title: `${kind[0].toUpperCase()}${kind.slice(1)} lunar eclipse`, about, view: "earth" });
  }
}

function solarEclipses(from, until, add) {
  for (let e = A.SearchGlobalSolarEclipse(from); e && e.peak.date <= until; e = A.NextGlobalSolarEclipse(e.peak)) {
    const kind = e.kind; // "partial", "annular", "total" or "hybrid"
    const where =
      e.latitude !== undefined && Number.isFinite(e.latitude)
        ? ` Its middle is at ${Math.abs(e.latitude).toFixed(0)}°${e.latitude >= 0 ? "N" : "S"} ${Math.abs(e.longitude).toFixed(0)}°${e.longitude >= 0 ? "E" : "W"}.`
        : "";
    const about =
      kind === "total"
        ? `The Moon covers the whole Sun, along a narrow path.${where}`
        : kind === "annular"
          ? `The Moon covers the middle of the Sun and leaves a ring of fire round it, along a narrow path.${where}`
          : kind === "hybrid"
            ? `Total in some places, a ring of fire in others.${where}`
            : "The Moon covers part of the Sun, seen from near one of the poles.";
    add(e.peak.date, { kind: "solar-eclipse", title: `${kind[0].toUpperCase()}${kind.slice(1)} solar eclipse`, about, view: "earth" });
  }
}

function fullMoons(from, until, add) {
  for (let t = from; ; ) {
    const f = A.SearchMoonPhase(180, t, 40);
    if (!f || f.date > until) return;
    add(f.date, { kind: "full-moon", title: "Full Moon", about: `${Math.round(A.GeoMoon(f.date).Length() * A.KM_PER_AU).toLocaleString("en-US")} km away.`, view: "earth" });
    t = new Date(f.date.getTime() + DAY);
  }
}

function oppositions(from, until, add) {
  for (const name of OUTER) {
    const when = A.SearchRelativeLongitude(A.Body[name], 0, from).date;
    if (when > until) continue;
    const au = A.GeoVector(A.Body[name], when, true).Length();
    add(when, { kind: "opposition", title: `${name} opposite the Sun`, about: `Up all night, and as close and bright as it gets this year: ${millionKm(au)} away.`, view: name.toLowerCase() });
  }
}

function elongations(from, until, add) {
  for (const name of ["Mercury", "Venus"]) {
    const e = A.SearchMaxElongation(A.Body[name], from);
    if (!e || e.time.date > until) continue;
    const when = e.visibility === "morning" ? "in the morning sky before sunrise" : "in the evening sky after sunset";
    add(e.time.date, { kind: "elongation", title: `${name} furthest from the Sun`, about: `${e.elongation.toFixed(0)}° from it in our sky: easiest to see, low ${when}.`, view: "inner" });
  }
}

const apart = (a, b, date) => A.AngleBetween(A.GeoVector(A.Body[a], date, true), A.GeoVector(A.Body[b], date, true));

function closePairs(from, until, add) {
  for (let i = 0; i < PAIRS.length; i++) {
    for (let j = i + 1; j < PAIRS.length; j++) {
      const [a, b] = [PAIRS[i], PAIRS[j]];
      // Day by day, then to the hour round each closest day.
      let prev = apart(a, b, new Date(from.getTime() - DAY));
      let now = apart(a, b, from);
      for (let t = from.getTime(); t <= until.getTime(); t += DAY) {
        const next = apart(a, b, new Date(t + DAY));
        if (now < CLOSE && now <= prev && now <= next) {
          let best = { t, sep: now };
          for (let h = -24; h <= 24; h++) {
            const sep = apart(a, b, new Date(t + h * 3600000));
            if (sep < best.sep) best = { t: t + h * 3600000, sep };
          }
          const moons = best.sep / 0.52;
          const close = moons < 1.5 ? "less than the Moon's width apart" : `${best.sep.toFixed(1)}° apart (${Math.round(moons)} Moons side by side)`;
          add(new Date(best.t), { kind: "pair", title: `${a} and ${b} close together`, about: `${close[0].toUpperCase()}${close.slice(1)} in our sky, though really far apart.`, view: "from-earth" });
        }
        prev = now;
        now = next;
      }
    }
  }
}

function meteorShowers(from, until, add) {
  for (const s of SHOWERS) {
    const peak = A.SearchSunLongitude(s.sun, from, 370);
    if (!peak || peak.date > until) continue;
    add(peak.date, {
      kind: "meteors",
      title: `${s.name} meteor shower at its best`,
      about: `Up to ${s.zhr} meteors an hour from somewhere dark, best after midnight: dust from ${s.from}, burning up as Earth runs through it.`,
      view: "from-home",
    });
  }
}

function comets(from, until, add) {
  for (const c of COMETS) {
    const when = nextPerihelion(c, from);
    if (when > until) continue;
    const km = cometPosition(c, when).length() * A.KM_PER_AU;
    add(when, { kind: "comet", title: `${c.name} nearest the Sun`, about: `${Math.round(km / 1e6)} million km from it, its tail at its longest.`, view: "inner" });
  }
}

/**
 * Everything on in the sky from `from` for `days` days, soonest first: { when, kind, title, about, view, id }.
 * `view` is what to look at to see it.
 */
export function upcomingEvents(from, days = 60) {
  const start = new Date(from);
  const until = new Date(start.getTime() + days * DAY);
  const out = [];
  const add = (when, e) => {
    if (when >= start && when <= until) out.push({ ...e, when, id: `${e.kind}:${e.title}:${Math.round(when.getTime() / 3600000)}` });
  };
  lunarEclipses(start, until, add);
  solarEclipses(start, until, add);
  fullMoons(start, until, add);
  oppositions(start, until, add);
  elongations(start, until, add);
  closePairs(start, until, add);
  meteorShowers(start, until, add);
  comets(start, until, add);
  // (A full moon on the night of a lunar eclipse is the same thing: the eclipse says it.)
  const eclipses = out.filter((e) => e.kind === "lunar-eclipse");
  return out.filter((e) => e.kind !== "full-moon" || !eclipses.some((x) => Math.abs(x.when - e.when) < DAY)).sort((x, y) => x.when - y.when);
}

/** Something happening within half a day either side of `date` (an eclipse or a planet first, then a full moon), or null. */
export function tonight(date, events = upcomingEvents(new Date(date.getTime() - DAY / 2), 1)) {
  const near = events.filter((e) => Math.abs(e.when - date) <= DAY / 2);
  return near.find((e) => e.kind !== "full-moon") ?? near[0] ?? null;
}

/** A date as a person would say it, in their own way and local time ("Tue, Nov 24, 8:54 AM"), with the year if it isn't this one's. */
export function whenText(date, now = new Date()) {
  const opts = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleString(undefined, opts);
}
