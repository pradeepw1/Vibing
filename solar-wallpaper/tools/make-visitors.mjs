// Makes src/visitors-data.js: comets' orbits from NASA JPL's Small-Body Database, and where three spacecraft far out
// were and how fast they were going, from JPL's Horizons. Both are public (NASA). Run it with `npm run visitors`.
//
// Comets: their osculating elements (heliocentric, ecliptic and equinox J2000). Followed round with Kepler's laws
// alone, so a comet drifts from its true place over the decades as the planets pull it about.
// Spacecraft: position and velocity on 1 January 2026 (heliocentric, ecliptic J2000). Far out they coast in a straight
// line, so that holds for years either side.
import { writeFileSync } from "node:fs";

const COMETS = [
  ["1P", "halley", "Halley's Comet"],
  ["2P", "encke", "Comet Encke"],
  ["67P", "67p", "Comet 67P (Rosetta's)"],
  ["109P", "swift-tuttle", "Comet Swift-Tuttle"],
  ["55P", "tempel-tuttle", "Comet Tempel-Tuttle"],
  ["C/1995 O1", "hale-bopp", "Comet Hale-Bopp"],
  ["12P", "pons-brooks", "Comet Pons-Brooks"],
  ["21P", "giacobini-zinner", "Comet Giacobini-Zinner"],
];
const CRAFT = [
  ["-31", "voyager1", "Voyager 1", "Launched 1977. The furthest thing people have made, out past the Sun's wind since 2012."],
  ["-32", "voyager2", "Voyager 2", "Launched 1977. The only craft to have passed Uranus and Neptune; out past the Sun's wind since 2018."],
  ["-98", "newhorizons", "New Horizons", "Flew past Pluto in 2015, and Arrokoth, the furthest world yet visited, in 2019."],
];
const EPOCH = "2026-01-01";

const comets = [];
for (const [designation, id, name] of COMETS) {
  const url = `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(designation)}&full-prec=true`;
  const d = await (await fetch(url)).json();
  const el = Object.fromEntries(d.orbit.elements.map((e) => [e.name, Number(e.value)]));
  if (d.orbit.equinox !== "J2000") throw new Error(`${designation}: not J2000`);
  comets.push({ id, name, designation: d.object.fullname, e: el.e, q: el.q, i: el.i, node: el.om, peri: el.w, tp: el.tp });
}

const craft = [];
for (const [command, id, name, about] of CRAFT) {
  const q = new URLSearchParams({
    format: "json", COMMAND: `'${command}'`, EPHEM_TYPE: "VECTORS", CENTER: "'500@10'", START_TIME: `'${EPOCH}'`, STOP_TIME: "'2026-01-02'",
    STEP_SIZE: "'1 d'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", VEC_TABLE: "'2'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'",
  });
  const r = (await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`)).json()).result;
  const row = r.slice(r.indexOf("$$SOE") + 5, r.indexOf("$$EOE")).trim().split("\n")[0].split(",").map((s) => s.trim());
  const [jd, , x, y, z, vx, vy, vz] = row;
  craft.push({ id, name, about, jd: Number(jd), r: [x, y, z].map(Number), v: [vx, vy, vz].map(Number) });
}

const out = `// Made by tools/make-visitors.mjs (\`npm run visitors\`): don't change it by hand.
// Comets: orbits from NASA JPL's Small-Body Database. Spacecraft: from NASA JPL's Horizons, on ${EPOCH}.
// Heliocentric, ecliptic and equinox J2000; AU, days and degrees. See src/visitors.js.

/** { id, name, designation, e, q (AU), i, node, peri (degrees), tp (perihelion, Julian day) } */
export const COMETS = ${JSON.stringify(comets, null, 0)};
/** { id, name, about, jd (Julian day), r (AU), v (AU a day) } */
export const CRAFT = ${JSON.stringify(craft, null, 0)};
`;
writeFileSync(new URL("../src/visitors-data.js", import.meta.url), out);
console.log(`  src/visitors-data.js  ${(out.length / 1024).toFixed(1)}kb: ${comets.length} comets, ${craft.length} craft`);
