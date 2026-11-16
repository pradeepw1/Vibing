// Makes src/zones-data.js: where each time zone's main city is, from the tz database's zone.tab (public domain), so
// "Your sky" can start out over the city your computer's clock is set for, without asking where you are.
// Run it with `npm run zones` (it reads /usr/share/zoneinfo/zone.tab), or give it the path to a zone.tab.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "/usr/share/zoneinfo/zone.tab";
const text = readFileSync(file, "utf8");

/** "+415100" or "-0873900" (degrees, minutes and maybe seconds) to degrees. */
function degrees(s, degDigits) {
  const sign = s[0] === "-" ? -1 : 1;
  const d = Number(s.slice(1, 1 + degDigits));
  const m = Number(s.slice(1 + degDigits, 3 + degDigits));
  const sec = s.length > 3 + degDigits ? Number(s.slice(3 + degDigits, 5 + degDigits)) : 0;
  return sign * (d + m / 60 + sec / 3600);
}

const zones = {};
for (const line of text.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [, coords, zone] = line.split("\t");
  const m = /^([+-]\d+)([+-]\d+)$/.exec(coords);
  if (!m) continue;
  const lat = degrees(m[1], 2);
  const lon = degrees(m[2], 3);
  zones[zone] = [+lat.toFixed(3), +lon.toFixed(3)];
}

const out = `// Made by tools/make-zones.mjs (\`npm run zones\`): don't change it by hand.
// From the tz database's zone.tab (public domain): each time zone's main city, as [latitude, longitude].
export const ZONES = ${JSON.stringify(zones)};
`;
writeFileSync(new URL("../src/zones-data.js", import.meta.url), out);
console.log(`  src/zones-data.js  ${(out.length / 1024).toFixed(1)}kb: ${Object.keys(zones).length} zones`);
