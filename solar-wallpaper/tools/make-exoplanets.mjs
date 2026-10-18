// Rebuilds src/exoplanet-data.js from the Open Exoplanet Catalogue.
//
//   node tools/make-exoplanets.mjs path/to/open_exoplanet_catalogue.txt
//
// The table is at
//   https://github.com/OpenExoplanetCatalogue/oec_tables
//   (comma_separated/open_exoplanet_catalogue.txt)
// and is MIT licensed. It collects what NASA's Exoplanet Archive, exoplanet.eu
// and the papers report. We keep a few dozen well-known systems, with the
// plain-words lines below, and work out what the table leaves blank (a planet's
// size from its mass, its temperature from its star and its distance).
import { readFileSync, writeFileSync } from "node:fs";

const [, , tablePath] = process.argv;
if (!tablePath) {
  console.error("usage: node tools/make-exoplanets.mjs <open_exoplanet_catalogue.txt>");
  process.exit(1);
}

// id, the name of one planet in the table (to find the system), the name shown, and a line about it.
const SYSTEMS = [
  ["proxima", "Proxima Centauri b", "Proxima Centauri", "The nearest star to the Sun. Planet b circles in its habitable zone.", true],
  ["trappist1", "TRAPPIST-1 b", "TRAPPIST-1", "Seven Earth-sized planets round a small red star. Three are in its habitable zone.", true],
  ["epseri", "eps Eridani b", "Epsilon Eridani", "A young Sun-like star with a giant planet and belts of rubble, 10 light-years away.", true],
  ["taucet", "tau Ceti b", "Tau Ceti", "A Sun-like star 12 light-years away, with several possible planets.", true],
  ["yzcet", "YZ Cet b", "YZ Ceti", "Three small planets whirling round a red dwarf, each year over in days.", false],
  ["teegarden", "GAT 1370 b", "Teegarden's Star", "A small red star with two Earth-sized planets.", false],
  ["wolf1061", "Wolf 1061 b", "Wolf 1061", "Three planets round a red dwarf, one in the habitable zone.", false],
  ["gj667c", "Gliese 667 C b", "Gliese 667 C", "A red dwarf in a triple star system, with up to seven planets.", false],
  ["fomalhaut", "Fomalhaut b", "Fomalhaut", "A bright star inside a huge ring of dust. Hubble photographed a planet beside the ring.", true],
  ["l9859", "L 98-59 b", "L 98-59", "Four small planets close round a red dwarf.", false],
  ["lhs1140", "LHS 1140 b", "LHS 1140", "A rocky super-Earth in the habitable zone of a red dwarf.", false],
  ["hd40307", "HD 40307 b", "HD 40307", "A star with six planets, some of them rocky.", false],
  ["lhs3844", "LHS 3844 b", "LHS 3844", "A rocky planet with an 11-hour year and a bare-rock surface.", false],
  ["gl581", "Gliese 581 b", "Gliese 581", "A red dwarf with several claimed planets, some of them disputed.", false],
  ["hd209458", "HD 209458 b", "HD 209458", "The first planet seen crossing in front of its star (1999).", true],
  ["psr1257", "PSR 1257+12 A", "PSR B1257+12", "The first planets ever found outside our solar system (1992), round a pulsar, the leftover of an exploded star.", false],
  ["pegasi51", "51 Peg b", "51 Pegasi", "The first planet found round a Sun-like star (1995): a hot giant with a 4-day year.", true],
  ["cancri55", "55 Cancri b", "55 Cancri", "Five planets. The closest, 55 Cnc e, is a rocky world with a year under a day, its sunny side molten.", true],
  ["betapic", "beta Pic b", "Beta Pictoris", "A young star in a disc of dust, with two giant planets photographed directly.", true],
  ["hd189733", "HD 189733 A b", "HD 189733", "A hot giant that Hubble found to be a deep blue.", false],
  ["gj436", "Gliese 436 b", "Gliese 436", "A hot Neptune-sized planet with a comet-like tail of gas.", false],
  ["gj1214", "Gliese 1214 b", "Gliese 1214", "A planet with a thick hazy air, perhaps a water world.", false],
  ["hr8799", "HR 8799 b", "HR 8799", "Four giant planets, photographed directly, still glowing from their birth.", true],
  ["toi700", "TOI-700 b", "TOI-700", "Three planets found by TESS. TOI-700 d is Earth-sized, in the habitable zone.", false],
  ["toi1452", "TOI-1452 b", "TOI-1452", "A planet that may be a world of water, round a red dwarf.", false],
  ["hd10180", "HD 10180 b", "HD 10180", "A Sun-like star with as many as nine planets.", false],
  ["wasp12", "WASP-12 b", "WASP-12", "A giant stretched into an egg shape by its star, and slowly falling into it.", false],
  ["wasp39", "WASP-39 b", "WASP-39", "In 2022 the Webb telescope found carbon dioxide in its air, the first time for any planet.", false],
  ["wasp76", "WASP-76 b", "WASP-76", "A scorching giant where it may rain iron on the night side.", false],
  ["wasp121", "WASP-121 b", "WASP-121", "An ultra-hot giant that goes round its star in a day and a half.", false],
  ["kelt9", "HD 195689 b", "KELT-9", "The hottest giant planet known, round a star twice as hot as the Sun.", false],
  ["corot7", "CoRoT-7 b", "CoRoT-7", "One of the first rocky planets found outside our system (2009), baked by its star.", false],
  ["kepler16", "Kepler-16 (AB) b", "Kepler-16", "A planet that circles two stars at once.", true],
  ["kepler22", "Kepler-22 b", "Kepler-22", "The first planet found in the habitable zone of a Sun-like star (2011).", false],
  ["kepler186", "Kepler-186 f", "Kepler-186", "Five planets. Kepler-186 f was the first Earth-sized planet found in a habitable zone (2014).", false],
  ["kepler442", "Kepler-442 b", "Kepler-442", "A super-Earth in the habitable zone of an orange star.", false],
  ["kepler452", "Kepler-452 b", "Kepler-452", "A planet with a year of 385 days, round a star much like our Sun.", true],
  ["kepler1649", "Kepler-1649 c", "Kepler-1649", "A planet almost exactly Earth's size, in its star's habitable zone.", false],
  ["k218", "K2-18 c", "K2-18", "Water vapour was found in the air of its planet b in 2019.", false],
];

// Where the table has a gap for a famous world, what the papers say.
const FIX = {
  "HD 195689 b": { r: 21.2, m: 915, t: 4050 }, // KELT-9 b: the hottest giant known
  "beta Pic b": { r: 18.5, m: 3500, t: 1700 },
  "Fomalhaut b": { r: 11, t: 40 },
};
// Where the table has the wrong place for a star: Proxima's planets are filed under Alpha Centauri's spot,
// two degrees away, and L 98-59's right ascension is off by eight minutes. (J2000 degrees.)
const PLACE = { proxima: [217.4289, -62.6795], l9859: [124.5317, -68.313] };
// A pulsar is not an ordinary star: a spinning city-sized ember, which the star-from-mass guess would get wrong.
const PULSAR = { temp: 28000, radius: 0.00002, mass: 1.4, class: "P" };

/** Reads comma-separated text, where a cell in quotes can hold commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') cell += text[i++];
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") [row, cell] = [[...row, cell], ""];
    else if (ch === "\n") {
      rows.push([...row, cell]);
      [row, cell] = [[], ""];
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
const table = parseCsv(readFileSync(tablePath, "utf8"));
const cols = table[0];
const rows = table.slice(1).map((cells) => Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])));
const num = (v) => (v === "" || v === undefined ? null : Number(v));

const JUPITER_RADII_IN_EARTH = 11.209;
const JUPITER_MASSES_IN_EARTH = 317.83;
const PARSEC_IN_LY = 3.26156;
const SUN_RADIUS_AU = 0.00465;

const hms = (s) => {
  const [h, m, sec] = s.trim().split(/\s+/).map(Number);
  return (h + m / 60 + sec / 3600) * 15;
};
const dms = (s) => {
  const sign = s.trim().startsWith("-") ? -1 : 1;
  const [d, m, sec] = s.replace(/[+-]/, "").trim().split(/\s+/).map(Number);
  return sign * (d + m / 60 + sec / 3600);
};

/** A made-up but sensible size when only the mass is known (rough mass-radius rule), in Earth radii. */
function radiusFromMass(mE) {
  if (mE < 2) return Math.pow(mE, 0.28);
  if (mE < 130) return 0.95 * Math.pow(mE, 0.55);
  return 11.2 * Math.pow(mE / 318, 0.0);
}

function spectral(t) {
  return t >= 30000 ? "O" : t >= 10000 ? "B" : t >= 7500 ? "A" : t >= 6000 ? "F" : t >= 5200 ? "G" : t >= 3700 ? "K" : "M";
}

const out = [];
for (const [id, probe, title, about, famous] of SYSTEMS) {
  const first = rows.find((r) => r.name === probe);
  if (!first) {
    console.error(`not found: ${probe}`);
    continue;
  }
  const key = `${first.system_rightascension}|${first.system_declination}`;
  const seen = new Set();
  const planets = rows.filter((r) => {
    // (Alpha Centauri B b shares Proxima's spot in the table: a planet that was later shown not to be there.)
    if (`${r.system_rightascension}|${r.system_declination}` !== key || seen.has(r.name) || r.name === "Alpha Centauri B b") return false;
    seen.add(r.name);
    return true;
  });
  const mass = num(first.hoststar_mass) ?? num(planets.find((p) => p.hoststar_mass)?.hoststar_mass);
  const temp = num(first.hoststar_temperature) ?? num(planets.find((p) => p.hoststar_temperature)?.hoststar_temperature) ?? (mass ? Math.round(5772 * Math.pow(mass, 0.55)) : 5000);
  const radius = num(first.hoststar_radius) ?? num(planets.find((p) => p.hoststar_radius)?.hoststar_radius) ?? (mass ? Math.pow(mass, 0.8) : 1);
  const starMass = mass ?? Math.pow(radius, 1.25);
  let star = { temp: Math.round(temp), radius: +radius.toFixed(3), mass: +starMass.toFixed(3), class: spectral(temp) };
  if (id === "psr1257") star = PULSAR;
  if (id === "kelt9") star = { temp: 10170, radius: 2.36, mass: 2.32, class: "B" };
  const list = planets
    .map((p) => {
      const period = num(p.period);
      let a = num(p.semimajoraxis);
      // Kepler's third law gives the orbit from the year and the star's weight, when the table doesn't have it.
      if (a === null && period) a = Math.cbrt(starMass * Math.pow(period / 365.25, 2));
      if (a === null) return null;
      const fix = FIX[p.name] ?? {};
      const mE = fix.m ?? (num(p.mass) === null ? null : num(p.mass) * JUPITER_MASSES_IN_EARTH);
      let rE = fix.r ?? (num(p.radius) === null ? null : num(p.radius) * JUPITER_RADII_IN_EARTH);
      const estimated = rE === null || fix.r !== undefined;
      if (rE === null) rE = mE === null ? 2.2 : radiusFromMass(mE);
      let t = fix.t ?? num(p.temperature);
      // Rough temperature from the star's heat at this distance, if the table has none (a quarter of the light bounces away).
      if (t === null && id === "psr1257") t = 150;
      if (t === null) t = temp * Math.sqrt((radius * SUN_RADIUS_AU) / (2 * a)) * Math.pow(0.7, 0.25);
      const periodDays = period ?? Math.sqrt(Math.pow(a, 3) / starMass) * 365.25;
      return {
        name: p.name.replace(/ \(AB\)/, "").replace(/ A b$/, " b"),
        r: +rE.toFixed(2),
        m: mE === null ? null : +mE.toFixed(1),
        a: +a.toPrecision(4),
        p: +periodDays.toPrecision(5),
        e: num(p.eccentricity) ?? 0,
        t: Math.round(t),
        how: p.discoverymethod || "",
        year: num(p.discoveryyear),
        est: estimated,
        ...(p.list.includes("Controversial") ? { disputed: true } : {}),
      };
    })
    .filter(Boolean)
    .sort((x, y) => x.a - y.a);
  out.push({
    id,
    name: title,
    about,
    famous,
    ra: PLACE[id] ? PLACE[id][0] : +hms(first.system_rightascension).toFixed(4),
    dec: PLACE[id] ? PLACE[id][1] : +dms(first.system_declination).toFixed(4),
    ly: +(num(first.system_distance) * PARSEC_IN_LY).toFixed(1),
    star,
    planets: list,
  });
}
out.sort((a, b) => a.ly - b.ly);

const text = `// Planets round other stars, from the Open Exoplanet Catalogue (MIT licence,
// https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue), which
// gathers what NASA's Exoplanet Archive, exoplanet.eu and the papers report.
// Made by tools/make-exoplanets.mjs; don't edit by hand.
//
// ra, dec: J2000 degrees. ly: light-years from the Sun.
// star: temp (kelvin), radius and mass (suns), class (spectral letter).
// planets: r (Earth radii), m (Earth masses, or null), a (AU), p (days),
// e (eccentricity), t (kelvin, rough), how it was found, year; est: the size
// was worked out from the mass or taken from a paper, not measured in the
// table; disputed: not everyone agrees it's there.
export const EXOPLANET_SYSTEMS = ${JSON.stringify(out, null, 1).replace(/\n\s+/g, "\n ").replace(/\n \{/g, "\n {")};
`;
writeFileSync(new URL("../src/exoplanet-data.js", import.meta.url), text);
console.log(`${out.length} systems, ${out.reduce((n, s) => n + s.planets.length, 0)} planets`);
