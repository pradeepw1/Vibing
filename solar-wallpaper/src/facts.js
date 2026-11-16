// What the Mac app's menu says about the sky: the Moon's phase tonight, the next eclipses, and what else is coming up.
// Built on its own into dist/facts.js, which the app runs in JavaScriptCore (no web page needed), by calling
// solarFacts.skyFacts(milliseconds) and reading the JSON it gives back.
import "./jsc-shim.js"; // (first: see there)
import * as A from "astronomy-engine";
import { upcomingEvents } from "./events.js";

const DAY = 86400000;

/** The phases by the Moon's angle from the Sun (degrees), with the symbol macOS has for each. */
const PHASES = [
  [11.25, "New moon", "moonphase.new.moon"],
  [78.75, "Waxing crescent", "moonphase.waxing.crescent"],
  [101.25, "First quarter", "moonphase.first.quarter"],
  [168.75, "Waxing gibbous", "moonphase.waxing.gibbous"],
  [191.25, "Full moon", "moonphase.full.moon"],
  [258.75, "Waning gibbous", "moonphase.waning.gibbous"],
  [281.25, "Last quarter", "moonphase.last.quarter"],
  [348.75, "Waning crescent", "moonphase.waning.crescent"],
  [360, "New moon", "moonphase.new.moon"],
];

/** The Moon at `date`: { name, symbol, lit (0..1), nextFull, nextNew (ms) }. */
export function moonNow(date) {
  const angle = A.MoonPhase(date);
  const [, name, symbol] = PHASES.find(([upTo]) => angle < upTo);
  return {
    name,
    symbol,
    lit: A.Illumination(A.Body.Moon, date).phase_fraction,
    nextFull: A.SearchMoonPhase(180, date, 40).date.getTime(),
    nextNew: A.SearchMoonPhase(0, date, 40).date.getTime(),
  };
}

const KIND = { penumbral: "faint (penumbral)", partial: "partial", total: "total", annular: "ring of fire (annular)" };

/** The next eclipse of the Sun and of the Moon anywhere on Earth after `date`: [{ title, when (ms) }], soonest first. */
export function nextEclipses(date) {
  const sun = A.SearchGlobalSolarEclipse(date);
  const moon = A.SearchLunarEclipse(date);
  return [
    { title: `${cap(KIND[sun.kind] ?? sun.kind)} eclipse of the Sun`, when: sun.peak.date.getTime() },
    { title: `${cap(KIND[moon.kind] ?? moon.kind)} eclipse of the Moon`, when: moon.peak.date.getTime() },
  ].sort((a, b) => a.when - b.when);
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Everything the menu shows, at `ms`: { moon, eclipses, coming: the next few events of the next month }. */
export function skyFacts(ms = Date.now()) {
  const date = new Date(ms);
  return {
    moon: moonNow(date),
    eclipses: nextEclipses(date),
    coming: upcomingEvents(date, 30)
      .filter((e) => !/eclipse/.test(e.kind))
      .slice(0, 4)
      .map((e) => ({ title: e.title, when: e.when.getTime() })),
  };
}

globalThis.solarFacts = { skyFacts: (ms) => JSON.stringify(skyFacts(ms)), DAY };
