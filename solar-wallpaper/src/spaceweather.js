// Live space weather, if asked for (it uses the internet, so it's off unless switched on): today's sunspots on the
// Sun, where they really are on it, and the aurora round Earth's poles as NOAA forecasts it for the next half hour,
// with the Kp index (how stirred up Earth's magnetic field is). All from NOAA's Space Weather Prediction Center, which
// publishes it free for anyone to use.
import { AdditiveBlending, DataTexture, LinearFilter, Mesh, RedFormat, RepeatWrapping, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from "three";
import * as shaders from "./shaders.js";

export const SOURCES = {
  regions: "https://services.swpc.noaa.gov/json/solar_regions.json",
  aurora: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
};
const EVERY = { regions: 3 * 3600000, aurora: 1800000, kp: 1800000 }; // how often each is fetched again
export const MAX_SPOTS = 24;
const DAY = 86400000;
const DEG = Math.PI / 180;

/** A place on the Sun (Carrington longitude, east-positive as the Sun is drawn; latitude) as a unit vector in its frame. */
export function sunPoint(lonDeg, latDeg, out = new Vector3()) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

/**
 * The latest day's sunspot groups as spots to draw: { at (ms: when they were seen), groups, spots: [{ dir (on the Sun,
 * in its own turning frame), radius (radians) }] }. NOAA's list for a day gives the groups as they were at the end of
 * it. A group's area is in millionths of the Sun's visible half; its main spot gets that, and a few smaller ones are
 * strung along its length.
 */
export function readRegions(list) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => r && r.observed_date && Number.isFinite(r.carrington_longitude) && Number.isFinite(r.latitude));
  if (!rows.length) return null;
  const day = rows.map((r) => r.observed_date).sort().at(-1);
  const groups = rows.filter((r) => r.observed_date === day && (r.number_spots ?? 0) > 0 && (r.area ?? 0) > 0);
  const spots = [];
  for (const g of groups) {
    const main = Math.sqrt(2 * g.area * 1e-6) * 1.3; // (the dark middle and its paler edge)
    spots.push({ dir: sunPoint(g.carrington_longitude, g.latitude), radius: main });
    const more = Math.min((g.number_spots ?? 1) - 1, 4);
    const length = Math.max(2, g.extent ?? 4);
    for (let k = 1; k <= more && spots.length < MAX_SPOTS; k++) {
      // (Where they sit along the group is made up, but the same every time for the same group.)
      const h = Math.sin(g.region * 12.9898 + k * 78.233) * 43758.5453;
      const f = h - Math.floor(h);
      const along = ((k % 2 ? 1 : -1) * (0.25 + 0.5 * f) * length) / 2;
      spots.push({ dir: sunPoint(g.carrington_longitude + along, g.latitude + (f - 0.5) * 1.5), radius: main * (0.25 + 0.2 * f) });
    }
    if (spots.length >= MAX_SPOTS) break;
  }
  return { at: Date.parse(`${day}T00:00:00Z`) + DAY, groups: groups.length, spots: spots.slice(0, MAX_SPOTS) };
}

/** NOAA's aurora forecast (a chance in % for each degree of longitude and latitude) as 360 × 181 bytes, and when. */
export function readAurora(json) {
  const cells = json?.coordinates;
  if (!Array.isArray(cells)) return null;
  const data = new Uint8Array(360 * 181);
  let peak = 0;
  for (const [lon, lat, chance] of cells) {
    const x = ((Math.round(lon) % 360) + 360) % 360;
    const y = Math.round(lat) + 90;
    if (y < 0 || y > 180 || !Number.isFinite(chance)) continue;
    data[y * 360 + x] = Math.max(0, Math.min(255, Math.round(chance * 2.55)));
    peak = Math.max(peak, chance);
  }
  return { data, peak, at: Date.parse(json["Forecast Time"]) || null };
}

/** The latest Kp index (0 to 9), and when. */
export function readKp(rows) {
  const last = Array.isArray(rows) ? rows.filter((r) => r && Number.isFinite(Number(r.Kp))).at(-1) : null;
  return last ? { kp: Number(last.Kp), at: Date.parse(`${last.time_tag}Z`) } : null;
}

/** Kp in words, as NOAA puts it (G1 to G5 are its storm levels). */
export function kpWords(kp) {
  if (kp >= 9) return "an extreme storm (G5)";
  if (kp >= 8) return "a severe storm (G4)";
  if (kp >= 7) return "a strong storm (G3)";
  if (kp >= 6) return "a moderate storm (G2)";
  if (kp >= 5) return "a minor storm (G1)";
  if (kp >= 4) return "active";
  if (kp >= 3) return "unsettled";
  return "quiet";
}

/**
 * Hooks it up: the spots go into the Sun's material, the aurora onto a thin shell round Earth (turning with it).
 * update(now, clockMs) once a frame fetches whatever is due and fades the spots out when the clock is days away from
 * when they were seen. `onStatus(text)` hears how it's going.
 */
export function createSpaceWeather({ sun, earth, onStatus = () => {}, fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))) }) {
  const u = sun.mesh.material.uniforms;
  const tex = new DataTexture(new Uint8Array(360 * 181), 360, 181, RedFormat);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.needsUpdate = true;
  const shell = new Mesh(
    new SphereGeometry(1.015, 96, 48),
    new ShaderMaterial({ ...shaders.aurora, uniforms: { map: { value: tex }, sunDir: earth.material.uniforms.sunDir, strength: { value: 0 } }, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  );
  shell.visible = false;
  earth.mesh.add(shell);

  let on = false;
  const due = { regions: 0, aurora: 0, kp: 0 };
  const have = { regions: null, aurora: null, kp: null };
  let trouble = false;

  function say() {
    if (!on) return onStatus("");
    const parts = [];
    if (have.regions) parts.push(`${have.regions.groups} sunspot group${have.regions.groups === 1 ? "" : "s"} today`);
    if (have.kp) parts.push(`Kp ${have.kp.kp.toFixed(1)}, ${kpWords(have.kp.kp)}`);
    if (have.aurora) parts.push(`aurora up to ${Math.round(have.aurora.peak)}% likely`);
    onStatus(parts.length ? `From NOAA: ${parts.join("; ")}.` : trouble ? "Couldn't reach NOAA: it will try again." : "Asking NOAA…");
  }

  function load(what, now) {
    due[what] = now + EVERY[what];
    fetcher(SOURCES[what])
      .then((json) => {
        const got = what === "regions" ? readRegions(json) : what === "aurora" ? readAurora(json) : readKp(json);
        if (!got) throw new Error("nothing usable");
        have[what] = got;
        trouble = false;
        if (what === "regions") {
          for (let i = 0; i < MAX_SPOTS; i++) {
            const s = got.spots[i];
            u.spots.value[i].set(s ? s.dir.x : 0, s ? s.dir.y : 0, s ? s.dir.z : 0, s ? s.radius : 0);
          }
          u.spotCount.value = got.spots.length;
        }
        if (what === "aurora") {
          tex.image.data.set(got.data);
          tex.needsUpdate = true;
        }
        say();
      })
      .catch(() => {
        trouble = true;
        due[what] = now + 5 * 60000; // (try again in a few minutes)
        say();
      });
  }

  return {
    setOn(value) {
      on = value;
      if (!on) {
        u.spotFade.value = 0;
        shell.visible = false;
      }
      say();
    },
    update(now, clockMs) {
      if (!on) return;
      if (typeof document === "undefined" || !document.hidden) for (const what of Object.keys(due)) if (now >= due[what]) load(what, now);
      // The spots and the aurora are for now: a clock days off (the time machine, or sped up) fades them out.
      const off = (at) => (at === null || at === undefined ? Infinity : Math.abs(clockMs - at) / DAY);
      const spotDays = off(have.regions?.at);
      u.spotFade.value = have.regions ? 1 - Math.min(1, Math.max(0, (spotDays - 3) / 3)) : 0;
      const auroraHours = off(have.aurora?.at) * 24;
      shell.material.uniforms.strength.value = have.aurora ? 1 - Math.min(1, Math.max(0, (auroraHours - 3) / 3)) : 0;
      shell.visible = shell.material.uniforms.strength.value > 0;
    },
    get status() {
      return have;
    },
    shell,
  };
}

/** For the Sun's material: room for the spots, none showing. */
export function spotUniforms() {
  return { spots: { value: Array.from({ length: MAX_SPOTS }, () => new Vector4()) }, spotCount: { value: 0 }, spotFade: { value: 0 } };
}
