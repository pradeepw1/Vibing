// Makes src/stars-data.js: the real stars to magnitude 6 (as faint as eyes can see), the constellations' lines and
// names, and the names of the brightest stars, from d3-celestial's data (BSD-3-Clause, Olaf Frohn; the stars are from
// the Hipparcos catalogue). Run it with `npm run stars` (it fetches the files, pinned to one version), or give it a
// folder holding stars.6.json, constellations.lines.json, constellations.json and starnames.json.
//
// Packed small: each star is four 16-bit numbers (right ascension, declination, magnitude and colour), each line two
// ends of two numbers, written out as base64.
import { readFileSync, writeFileSync } from "node:fs";

const VERSION = "0.7.35";
const FILES = ["stars.6.json", "constellations.lines.json", "constellations.json", "starnames.json"];
const NAMED = 1.6; // stars this bright or brighter get their name shown (about 30 of them)

const folder = process.argv[2];
const data = {};
for (const file of FILES) {
  const text = folder
    ? readFileSync(`${folder}/${file}`, "utf8")
    : await (await fetch(`https://cdn.jsdelivr.net/npm/d3-celestial@${VERSION}/data/${file}`)).text();
  data[file] = JSON.parse(text);
}

const ra16 = (ra) => Math.round(((((ra % 360) + 360) % 360) / 360) * 65535); // 0..360 degrees to 0..65535
const dec16 = (dec) => Math.round((dec / 90) * 32767) + 32768; // -90..90 degrees to 1..65535
const pack = (numbers) => Buffer.from(Uint16Array.from(numbers).buffer).toString("base64");

const stars = [];
const named = [];
for (const f of data["stars.6.json"].features) {
  const [ra, dec] = f.geometry.coordinates;
  const mag = Number(f.properties.mag);
  const bv = f.properties.bv === "" || f.properties.bv === undefined ? NaN : Number(f.properties.bv);
  if (!Number.isFinite(mag)) continue;
  // Magnitude and colour in thousandths, shifted to be positive. A colour not measured: 65535.
  stars.push(ra16(ra), dec16(dec), Math.round(mag * 1000) + 32768, Number.isFinite(bv) ? Math.round(bv * 1000) + 32768 : 65535);
  const name = data["starnames.json"][String(f.id)]?.name;
  if (name && mag <= NAMED) named.push([name, +((ra + 360) % 360).toFixed(3), +dec.toFixed(3), mag]);
}
named.sort((a, b) => a[3] - b[3]);

const lines = [];
for (const f of data["constellations.lines.json"].features) {
  for (const run of f.geometry.coordinates) {
    for (let i = 1; i < run.length; i++) lines.push(ra16(run[i - 1][0]), dec16(run[i - 1][1]), ra16(run[i][0]), dec16(run[i][1]));
  }
}

// Names, where each one goes on the sky (d3-celestial's own label spots). Serpens comes in two halves, each named.
const names = data["constellations.json"].features.map((f) => {
  const [ra, dec] = f.geometry.coordinates;
  return [f.id, f.properties.name, +((ra + 360) % 360).toFixed(2), +dec.toFixed(2)];
});

const out = `// Made by tools/make-stars.mjs (\`npm run stars\`): don't change it by hand.
// From d3-celestial ${VERSION}'s data (BSD-3-Clause, Copyright (c) 2015 Olaf Frohn); the stars are from the Hipparcos catalogue.
// See src/stars.js for how it is read.

/** ${stars.length / 4} stars to magnitude 6: right ascension, declination, magnitude and B-V colour, four 16-bit numbers each. */
export const STARS = "${pack(stars)}";
/** The constellations' lines (${lines.length / 4} of them): each two ends of right ascension and declination. */
export const LINES = "${pack(lines)}";
/** [abbreviation, name, right ascension, declination] for each constellation's name. */
export const CONSTELLATIONS = ${JSON.stringify(names)};
/** [name, right ascension, declination, magnitude] for the brightest named stars. */
export const NAMED_STARS = ${JSON.stringify(named)};
`;
writeFileSync(new URL("../src/stars-data.js", import.meta.url), out);
console.log(`  src/stars-data.js  ${(out.length / 1024).toFixed(1)}kb: ${stars.length / 4} stars, ${lines.length / 4} lines, ${names.length} names, ${named.length} named stars`);
