// Paints each body's surface into a canvas, in the browser, so the wallpaper
// needs no image files. The maps are ordinary longitude/latitude maps:
// longitude -180 on the left edge, 0 in the middle, north at the top.
//
// Big real features are placed where they really are (coastlines, the Moon's
// dark seas, Mars's polar caps, Pluto's heart, Jupiter's belts). The fine
// detail is made-up noise.
import { LAND } from "./land.js";
import { clamp, craters, fbm, mix, mix3, simplex, smooth } from "./noise.js";

const DEG = Math.PI / 180;

/** Unit vector for a latitude/longitude, in the same layout as the sphere point we pass to painters. */
function dir(lat, lon) {
  const c = Math.cos(lat * DEG);
  return [c * Math.cos(lon * DEG), Math.sin(lat * DEG), -c * Math.sin(lon * DEG)];
}

/** Angle in degrees between a point and a fixed spot. */
function spot(lat, lon) {
  const [a, b, c] = dir(lat, lon);
  return (x, y, z) => Math.acos(clamp(a * x + b * y + c * z, -1, 1)) / DEG;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// ---------------------------------------------------------------------------------
// Painters. Each gets (x, y, z, lat, lon) for one pixel and returns [r, g, b] (0..1).
// Earth also fills extra layers.

function rocky({ seed, base, dark, craterScale = 6, craterDepth = 0.35, noiseScale = 2.5, patchiness = 0.25 }) {
  const n = simplex(seed);
  const cr = craters(seed + 1, 0.55);
  const cr2 = craters(seed + 2, 0.6);
  return (x, y, z) => {
    const f = fbm(n, x * noiseScale, y * noiseScale, z * noiseScale, 5);
    const h = cr(x * craterScale, y * craterScale, z * craterScale) + 0.5 * cr2(x * craterScale * 3, y * craterScale * 3, z * craterScale * 3);
    const c = mix3(base, dark, clamp(0.5 + f * patchiness * 2));
    const shade = 1 + craterDepth * h + 0.12 * f;
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  };
}

function moon() {
  const n = simplex(11);
  const highland = rgb("#a19d96");
  const mare = rgb("#4a4a4c");
  // Dark seas: [lat, lon, radius in degrees]. All on the side that faces Earth.
  const seas = [
    [20, -57, 21], [0, -45, 14], [-5, -60, 10], [33, -16, 11], [28, 17, 7.5], [8.5, 31, 8.5],
    [17, 59, 5], [-8, 51, 7], [-15, 35, 4], [-21, -17, 7.5], [-24, -39, 4], [13, 4, 3],
    [-10, -23, 4.5], [27, 148, 3], [-20, 160, 3],
  ].map(([lat, lon, r]) => ({ v: dir(lat, lon), r, cutoff: Math.cos((r + 9) * DEG) }));
  const tycho = spot(-43.3, -11.2);
  const copernicus = spot(9.6, -20.1);
  // Tycho's rays: straight bright streaks thrown out in all directions.
  const t = dir(-43.3, -11.2);
  const e1 = [-t[0] * t[1], 1 - t[1] * t[1], -t[2] * t[1]];
  const l1 = Math.hypot(...e1);
  e1.forEach((_, i) => (e1[i] /= l1));
  const e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const rays = Array.from({ length: 18 }, (_, i) => ({
    angle: (i / 18) * 2 * Math.PI + 0.3 * Math.sin(i * 12.9898),
    width: 0.7 + 0.8 * Math.abs(Math.sin(i * 78.233)),
    length: 25 + 45 * Math.abs(Math.sin(i * 37.719)),
  }));
  const cr = craters(12, 0.65);
  const cr2 = craters(13, 0.7);
  return (x, y, z, lat, lon) => {
    const warp = 5 * fbm(n, x * 3, y * 3, z * 3, 4);
    let m = 0;
    for (const { v, r, cutoff } of seas) {
      const dot = v[0] * x + v[1] * y + v[2] * z;
      if (dot > cutoff) m = Math.max(m, smooth(r + 3, r - 2, Math.acos(Math.min(1, dot)) / DEG + warp));
    }
    // Mare Frigoris: a thin band across the north.
    m = Math.max(m, smooth(5, 1, Math.abs(lat - 56 + warp * 0.6)) * smooth(45, 30, Math.abs(lon)));
    const farside = smooth(70, 110, Math.abs(lon)); // the far side is mostly bright, battered highland
    const h = cr(x * 7, y * 7, z * 7) * (0.6 + farside) + 0.6 * cr2(x * 22, y * 22, z * 22);
    let c = mix3(highland, mare, m * 0.9);
    let shade = 1 + 0.28 * h * (1 - m * 0.7) + 0.1 * fbm(n, x * 12, y * 12, z * 12, 3);
    // Bright young craters and Tycho's rays.
    const dt = tycho(x, y, z);
    if (dt < 70) {
      const bearing = Math.atan2(x * e2[0] + y * e2[1] + z * e2[2], x * e1[0] + y * e1[1] + z * e1[2]);
      let ray = 0;
      for (const r of rays) {
        if (dt > r.length) continue;
        const off = Math.abs(((bearing - r.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * dt; // degrees sideways
        ray += Math.exp(-((off / r.width) ** 2)) * (1 - dt / r.length);
      }
      shade += Math.min(ray, 1) * 0.35 * smooth(1.5, 4, dt) + smooth(3, 0.5, dt) * 0.8;
    }
    shade += smooth(2, 0.3, copernicus(x, y, z)) * 0.5;
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  };
}

function mars() {
  const n = simplex(21);
  const base = rgb("#c2693a");
  const dark = rgb("#6b3a24");
  const cr = craters(22, 0.5);
  const syrtis = spot(9, 69);
  const hellas = spot(-42, 70);
  const olympus = spot(18.6, -134);
  const valles = (lat, lon) => smooth(3.5, 0.5, Math.abs(lat + 10 + 0.04 * (lon + 60))) * smooth(40, 20, Math.abs(lon + 65));
  return (x, y, z, lat, lon) => {
    const f = fbm(n, x * 2.2, y * 2.2, z * 2.2, 6);
    let d = smooth(0.05, 0.35, f + 0.15 * Math.sin(lat * DEG * 3));
    d = Math.max(d, smooth(18, 6, syrtis(x, y, z) + f * 10) * 0.9);
    d = Math.max(d, valles(lat, lon) * 0.8);
    d *= 1 - smooth(25, 8, hellas(x, y, z) + f * 6) * 0.8; // Hellas basin is bright
    let c = mix3(base, dark, d * 0.85);
    const shade = 1 + 0.18 * cr(x * 8, y * 8, z * 8) + 0.1 * f;
    c = c.map((v) => v * shade);
    c = mix3(c, [0.85, 0.65, 0.5], smooth(3, 0.5, olympus(x, y, z)) * 0.5);
    // Ice caps.
    const ice = Math.max(smooth(76, 82, lat + f * 6), smooth(-80, -85, lat + f * 4));
    return mix3(c, [0.96, 0.94, 0.92], ice);
  };
}

function venus() {
  const n = simplex(31);
  const a = rgb("#e9d7a8");
  const b = rgb("#c7a46c");
  return (x, y, z, lat) => {
    const w = fbm(n, x * 1.5, y * 1.5, z * 1.5, 3);
    const band = fbm(n, x * 2 + w, y * 7, z * 2 + w, 5);
    const v = clamp(0.5 + band * 0.8 + 0.1 * Math.cos(lat * DEG * 4));
    return mix3(b, a, 0.35 + 0.65 * v);
  };
}

// Bands from south to north: [latitude where it ends, colour].
const JUPITER_BANDS = [
  [-75, "#8a8378"], [-60, "#9d9282"], [-48, "#b8a58b"], [-40, "#d9cdb7"], [-33, "#c7ad8c"],
  [-27, "#a98364"], [-20, "#e6dccb"], [-7, "#b07d57"], [7, "#eadfc8"], [18, "#a47152"],
  [24, "#e2d6bf"], [31, "#b99573"], [36, "#ddd0b7"], [42, "#b09a7f"], [52, "#cbbda5"],
  [64, "#a39784"], [90, "#8c8478"],
].map(([lat, c]) => [lat, rgb(c)]);

function bandColor(bands, lat) {
  for (let i = 0; i < bands.length; i++) {
    if (lat <= bands[i][0]) {
      const prev = i > 0 ? bands[i - 1] : bands[0];
      const t = smooth(-2.5, 2.5, lat - prev[0]); // soft edge with the band below
      return mix3(prev[1], bands[i][1], i > 0 ? t : 1);
    }
  }
  return bands[bands.length - 1][1];
}

function jupiter() {
  const n = simplex(41);
  const grs = rgb("#c06a45");
  const m = simplex(42);
  return (x, y, z, lat, lon) => {
    // Swirl the latitude so band edges curl, more in some places than others.
    const wx = 0.4 * fbm(m, x * 3, y * 8, z * 3, 3);
    const turb = fbm(n, x * 3 + wx, y * 14, z * 3 - wx, 5);
    const fine = fbm(n, x * 9, y * 60, z * 9, 3);
    let c = bandColor(JUPITER_BANDS, lat + turb * 4.5 + fine * 1.2);
    const avg = [0.8, 0.7, 0.58];
    c = mix3(c, avg, 0.22); // calmer colours
    c = c.map((v) => v * (1 + 0.12 * fine + 0.06 * fbm(m, x * 6, y * 20, z * 6, 2)));
    // The Great Red Spot. Its longitude drifts; this one is made up.
    const dLon = ((lon - 60 + 540) % 360) - 180;
    const dx = (dLon * Math.cos(lat * DEG)) / 11;
    const dy = (lat + 22.5) / 5.5;
    const d = Math.hypot(dx, dy);
    if (d < 1.6) {
      const swirl = n(dx * 2 + d, dy * 2, d * 3) * 0.15;
      c = mix3(c, grs.map((v) => v * (0.9 + swirl)), smooth(1.05, 0.7, d));
      c = mix3(c, [0.93, 0.88, 0.8], smooth(1.0, 1.25, d) * smooth(1.6, 1.25, d) * 0.6);
    }
    // Small white storms in the south.
    for (const [olat, olon] of [[-33, -40], [-41, 100], [-41, 150], [-33, 170]]) {
      const ox = ((((lon - olon + 540) % 360) - 180) * Math.cos(lat * DEG)) / 3.5;
      const od = Math.hypot(ox, (lat - olat) / 2.2);
      c = mix3(c, [0.96, 0.94, 0.9], smooth(1, 0.5, od) * 0.85);
    }
    return c;
  };
}

function saturn() {
  const n = simplex(51);
  const bands = [
    [-70, "#a8997a"], [-50, "#c9b58c"], [-35, "#dcc89a"], [-20, "#e5d3a6"], [-8, "#d9c08e"],
    [8, "#efe0b8"], [20, "#d8bf8b"], [35, "#e3cfa0"], [55, "#cbb489"], [70, "#b6a17c"], [90, "#9f9273"],
  ].map(([lat, c]) => [lat, rgb(c)]);
  return (x, y, z, lat, lon) => {
    const turb = fbm(n, x * 2, y * 12, z * 2, 4);
    let c = bandColor(bands, lat + turb * 2);
    c = c.map((v) => v * (1 + 0.05 * fbm(n, x * 6, y * 50, z * 6, 3)));
    // The hexagon around the north pole.
    if (lat > 70) {
      const colat = 90 - lat;
      const a = (((lon * DEG) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
      const hexR = 13.5 * Math.cos(Math.PI / 6) / Math.cos(a - Math.PI / 6);
      c = mix3(c, rgb("#8f8c78"), smooth(hexR + 0.6, hexR - 0.6, colat) * 0.7);
    }
    return c;
  };
}

function iceGiant({ seed, base, band, spotAt }) {
  const n = simplex(seed);
  const spotD = spotAt ? spot(...spotAt) : null;
  return (x, y, z, lat) => {
    const turb = fbm(n, x * 2, y * 10, z * 2, 4);
    const v = 0.5 + 0.5 * Math.sin((lat + turb * 4) * DEG * 9);
    let c = mix3(base, band, v * 0.35);
    if (spotD) {
      const d = spotD(x, y, z);
      c = mix3(c, base.map((q) => q * 0.45), smooth(7, 3.5, d * (1 + 0.3 * turb)));
      c = mix3(c, [0.95, 0.97, 1], smooth(2.5, 0, Math.abs(d - 9 + 6 * turb)) * smooth(30, 0, Math.abs(lat + 18)) * 0.6);
    }
    return c;
  };
}

function pluto() {
  const n = simplex(61);
  const base = rgb("#bfa58a");
  const dark = rgb("#5b3326");
  const cr = craters(62, 0.4);
  // Tombaugh Regio, the bright "heart", faces away from Charon (longitude 180).
  const lobes = [[spot(24, 178), 19], [spot(10, -154), 17], [spot(-6, 174), 12]];
  return (x, y, z, lat, lon) => {
    const f = fbm(n, x * 2.5, y * 2.5, z * 2.5, 5);
    let c = mix3(base, rgb("#d9c7b0"), clamp(0.5 + f));
    // Cthulhu: a dark band along the equator, west of the heart.
    const cthulhu = smooth(14, 4, Math.abs(lat + 8 - f * 8)) * smooth(55, 35, Math.abs(lon - 110 + f * 20));
    c = mix3(c, dark, cthulhu * 0.85);
    let heart = 0;
    for (const [d, r] of lobes) heart = Math.max(heart, smooth(r + 2, r - 2, d(x, y, z) + f * 4));
    c = mix3(c, rgb("#f3eee6"), heart * 0.9);
    const shade = 1 + 0.12 * cr(x * 6, y * 6, z * 6);
    return c.map((v) => v * shade);
  };
}

function io() {
  const n = simplex(71);
  return (x, y, z) => {
    const f = fbm(n, x * 3, y * 3, z * 3, 5);
    const g = fbm(n, x * 9 + 5, y * 9, z * 9, 3);
    let c = mix3(rgb("#e8d26a"), rgb("#c9893e"), smooth(-0.1, 0.4, f));
    c = mix3(c, rgb("#f4efd0"), smooth(0.25, 0.5, -f) * 0.7);
    c = mix3(c, rgb("#2a1c12"), smooth(0.55, 0.7, g)); // volcanoes
    return c;
  };
}

function europa() {
  const n = simplex(81);
  return (x, y, z) => {
    const f = fbm(n, x * 3, y * 3, z * 3, 4);
    let c = mix3(rgb("#e6dccb"), rgb("#b89a7a"), smooth(0, 0.5, f));
    for (let k = 0; k < 3; k++) {
      const s = 2 + k * 2.3;
      const r = Math.abs(n(x * s + k * 7, y * s, z * s));
      c = mix3(c, rgb("#8a5a3c"), smooth(0.04, 0.0, r) * 0.7);
    }
    return c;
  };
}

function iapetus() {
  const n = simplex(91);
  const leading = spot(0, -90); // the side facing the way it travels is dark
  const cr = craters(92, 0.6);
  return (x, y, z) => {
    const f = fbm(n, x * 3, y * 3, z * 3, 4);
    const d = leading(x, y, z) + f * 25;
    const c = mix3(rgb("#2a2018"), rgb("#d8d1c2"), smooth(70, 90, d));
    const shade = 1 + 0.25 * cr(x * 6, y * 6, z * 6);
    return c.map((v) => v * shade);
  };
}

function titan() {
  const n = simplex(101);
  return (x, y, z, lat) => {
    const f = fbm(n, x * 2, y * 6, z * 2, 3);
    const c = mix3(rgb("#d9a35a"), rgb("#b8803f"), clamp(0.5 + f * 0.6));
    return mix3(c, rgb("#8f6a45"), smooth(55, 75, lat) * 0.5);
  };
}

function charon() {
  const base = rocky({ seed: 111, base: rgb("#a7a49f"), dark: rgb("#77736d"), craterScale: 5, craterDepth: 0.25 });
  const n = simplex(112);
  return (x, y, z, lat, lon) => {
    const c = base(x, y, z, lat, lon);
    return mix3(c, rgb("#6e3d2b"), smooth(62, 78, lat + 6 * n(x * 3, y * 3, z * 3)) * 0.8); // Mordor Macula
  };
}

function triton() {
  const n = simplex(121);
  return (x, y, z, lat) => {
    const f = fbm(n, x * 8, y * 8, z * 8, 4);
    const c = mix3(rgb("#c9b3a8"), rgb("#9c8a85"), clamp(0.5 + f));
    return mix3(c, rgb("#efe6df"), smooth(-10, -35, lat + f * 10));
  };
}

// ---------------------------------------------------------------------------------
// Earth: real coastlines, land coloured by rough climate zones.

// Rough desert areas: [lat min, lat max, lon min, lon max].
const DESERTS = [
  [14, 33, -17, 34], [13, 32, 34, 60], [24, 40, 52, 72], [36, 47, 88, 118], [-32, -18, 116, 145],
  [-29, -17, 13, 26], [28, 40, -118, -104], [-30, -15, -71, -66], [-50, -38, -71, -64], [36, 46, 55, 70],
];

function desertness(lat, lon, wobble) {
  let d = 0;
  for (const [a, b, c, e] of DESERTS) {
    const la = lat + wobble;
    const lo = lon - wobble * 1.3;
    const inLat = smooth(a - 6, a + 4, la) * smooth(b + 6, b - 4, la);
    const inLon = smooth(c - 7, c + 5, lo) * smooth(e + 7, e - 5, lo);
    d = Math.max(d, inLat * inLon);
  }
  return d;
}

// Where people live, for city lights at night: [lat, lon, radius in degrees, how busy].
const CITIES = [
  [50, 8, 13, 1], [44, 20, 9, 0.7], [56, 38, 9, 0.6], [53, -2, 4, 1], [40, -4, 6, 0.7], [42, 13, 5, 0.9],
  [24, 79, 11, 1], [13, 78, 6, 0.9], [23, 90, 4, 1], [31, 116, 9, 1], [24, 112, 5, 1], [37, 127, 3, 1], [36, 138, 4, 1],
  [40, -78, 9, 1], [36, -86, 8, 0.8], [30, -95, 5, 0.7], [42, -88, 5, 0.8], [36, -119, 5, 0.8], [47, -122, 2.5, 0.6],
  [20, -100, 5, 0.8], [-23, -46, 5, 0.9], [-12, -40, 4, 0.5], [-34.6, -58.4, 2.5, 0.8], [6.5, 3.4, 4, 0.6],
  [30, 31, 2.5, 0.9], [26, 50, 3, 0.8], [33, 44, 3, 0.6], [35, 51, 3, 0.6], [-6.5, 108, 4, 0.9], [14, 101, 4, 0.6],
  [10.8, 106.7, 2, 0.7], [-26, 28, 2.5, 0.6], [-34, 151, 2.5, 0.7], [-37.8, 145, 2, 0.6], [14.5, 121, 2.5, 0.8],
  [39, 35, 6, 0.6], [4.7, -74, 2.5, 0.5], [-1.3, 36.8, 2, 0.4], [33.6, 73, 4, 0.7], [56, 60, 4, 0.4],
];

const CITY_SPOTS = CITIES.map(([lat, lon, r, w]) => ({ v: dir(lat, lon), r, w, cutoff: Math.cos(2 * r * DEG) }));

function busyness(x, y, z) {
  let b = 0;
  for (const c of CITY_SPOTS) {
    const dot = c.v[0] * x + c.v[1] * y + c.v[2] * z;
    if (dot < c.cutoff) continue; // too far away to matter
    const d = Math.acos(Math.min(1, dot)) / DEG;
    b += c.w * Math.exp(-((d / c.r) ** 2));
  }
  return Math.min(1, b);
}

function landMask(width, height) {
  const canvas = typeof document === "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  // Rings that cross the 180 degree line run past the edge, so draw each one
  // a full turn left and right too.
  for (const shift of [-360, 0, 360]) {
    for (const ring of LAND) {
      for (let i = 0; i < ring.length; i += 2) {
        const px = ((ring[i] + shift + 180) / 360) * width;
        const py = ((90 - ring[i + 1]) / 180) * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
  ctx.fill("evenodd");
  const data = ctx.getImageData(0, 0, width, height).data;
  const land = new Float32Array(width * height);
  for (let i = 0; i < land.length; i++) land[i] = data[i * 4] / 255;
  return { land, near: blur(land, width, height, Math.max(2, width / 256)) };
}

// Box blur, twice, so the shallow sea fades out smoothly from the coast.
function blur(src, w, h, radius) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const r = Math.round(radius);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + ((x + w) % w)];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = sum / (2 * r + 1);
        sum += a[y * w + ((x + r + 1) % w)] - a[y * w + ((x - r + w) % w)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / (2 * r + 1);
        sum += b[Math.min(y + r + 1, h - 1) * w + x] - b[Math.max(y - r, 0) * w + x];
      }
    }
  }
  return a;
}

function earth(width, height) {
  const n = simplex(1);
  const n2 = simplex(2);
  const { land, near } = landMask(width, height);
  const deep = rgb("#061a3d");
  const shallow = rgb("#0f4a6e");
  const forest = rgb("#1f3d1a");
  const jungle = rgb("#163a12");
  const grass = rgb("#58602e");
  const desert = rgb("#c4a574");
  const tundra = rgb("#6b6556");
  const ice = rgb("#eef2f6");
  return (x, y, z, lat, lon, px, py, extra) => {
    const i = py * width + px;
    const isLand = land[i];
    const f = fbm(n, x * 4, y * 4, z * 4, 5);
    const absLat = Math.abs(lat);
    let c;
    if (isLand > 0.01) {
      const wobble = 9 * fbm(n2, x * 2, y * 2, z * 2, 3);
      const dry = desertness(lat, lon, wobble);
      let veg = mix3(grass, forest, clamp(0.5 + f * 1.5));
      veg = mix3(veg, jungle, smooth(17, 7, absLat + wobble));
      veg = mix3(veg, tundra, smooth(55, 70, absLat + f * 8));
      c = mix3(veg, desert, dry);
      c = c.map((v) => v * (0.85 + 0.3 * fbm(n2, x * 16, y * 16, z * 16, 3)));
      const greenland = lon < -12 && ((lat > 59 && lon > -56) || (lat > 74 && lon > -74));
      const iceAmount = lat < -60 || greenland ? 1 : smooth(74, 80, absLat + f * 6);
      const iced = iceAmount > 0.5;
      c = mix3(c, ice.map((v) => v * (0.92 + 0.08 * f)), iceAmount);
      const sea = mix3(deep, shallow, smooth(0.0, 0.6, near[i]));
      c = mix3(sea, c, isLand);
      // City lights: clusters where people really live, plus a faint scatter elsewhere.
      const busy = iced ? 0 : busyness(x, y, z) + 0.12 * smooth(60, 35, absLat) * (1 - dry);
      const sparkle = smooth(0.0, 0.55, n2(x * 70, y * 70, z * 70)) * (0.5 + 0.5 * smooth(-0.2, 0.3, fbm(n2, x * 12 + 3, y * 12, z * 12, 3)));
      extra[0] = clamp(busy * sparkle * 1.8) * isLand;
    } else {
      c = mix3(deep, shallow, smooth(0.0, 0.6, near[i]) * 0.9);
      c = c.map((v) => v * (0.9 + 0.15 * f));
      // Sea ice near the poles.
      const seaIce = Math.max(smooth(78, 84, lat + f * 6), smooth(-68, -74, lat + f * 5));
      c = mix3(c, ice, seaIce * 0.9);
      extra[0] = 0;
    }
    extra[1] = 1 - isLand; // water shines
    return c;
  };
}

function earthClouds() {
  const n = simplex(3);
  const m = simplex(4);
  return (x, y, z, lat) => {
    const absLat = Math.abs(lat);
    // More cloud at the equator and in the stormy mid latitudes, less in the subtropics.
    const climate = 0.18 * smooth(14, 0, absLat) - 0.22 * smooth(8, 22, absLat) * smooth(40, 26, absLat) + 0.16 * smooth(38, 60, absLat);
    // Bend the noise a little so it swirls, and stretch it east-west like weather does.
    const wx = 0.35 * fbm(m, x * 2, y * 2, z * 2, 3);
    const wz = 0.35 * fbm(m, x * 2 + 9, y * 2, z * 2, 3);
    const v = fbm(n, x * 1.8 + wx, y * 3, z * 1.8 + wz, 8);
    let c = smooth(-0.16, 0.45, v + climate);
    c *= 0.8 + 0.2 * smooth(-0.3, 0.3, fbm(m, x * 10, y * 16, z * 10, 3)); // fine texture
    return [c, c, c];
  };
}

// ---------------------------------------------------------------------------------

const PAINTERS = {
  mercury: () => rocky({ seed: 1001, base: rgb("#9a938a"), dark: rgb("#6e675f"), craterScale: 7, craterDepth: 0.45 }),
  venus,
  earth: (w, h) => earth(w, h),
  mars,
  jupiter,
  saturn,
  uranus: () => iceGiant({ seed: 1201, base: rgb("#a6dbe0"), band: rgb("#c4ecef") }),
  neptune: () => iceGiant({ seed: 1301, base: rgb("#3e64cf"), band: rgb("#5d82e3"), spotAt: [-20, 120] }),
  pluto,
  moon,
  phobos: () => rocky({ seed: 1401, base: rgb("#6b5f55"), dark: rgb("#4d443d"), craterScale: 4, craterDepth: 0.5 }),
  deimos: () => rocky({ seed: 1402, base: rgb("#7a6e63"), dark: rgb("#5b5249"), craterScale: 4, craterDepth: 0.4 }),
  io,
  europa,
  ganymede: () => rocky({ seed: 1501, base: rgb("#a39a8c"), dark: rgb("#5d544a"), craterScale: 6, craterDepth: 0.3, noiseScale: 1.8, patchiness: 0.6 }),
  callisto: () => rocky({ seed: 1502, base: rgb("#6a5e52"), dark: rgb("#3e352d"), craterScale: 9, craterDepth: 0.6 }),
  rhea: () => rocky({ seed: 1601, base: rgb("#cfcbc4"), dark: rgb("#9e9a93"), craterScale: 8, craterDepth: 0.35 }),
  titan,
  iapetus,
  miranda: () => rocky({ seed: 1701, base: rgb("#b9b6b0"), dark: rgb("#7d7a75"), craterScale: 4, craterDepth: 0.3, patchiness: 0.7 }),
  ariel: () => rocky({ seed: 1702, base: rgb("#bdb9b2"), dark: rgb("#8a8680"), craterScale: 6, craterDepth: 0.3 }),
  umbriel: () => rocky({ seed: 1703, base: rgb("#77736d"), dark: rgb("#5a5752"), craterScale: 7, craterDepth: 0.35 }),
  titania: () => rocky({ seed: 1704, base: rgb("#aaa49b"), dark: rgb("#7f7a73"), craterScale: 6, craterDepth: 0.35 }),
  oberon: () => rocky({ seed: 1705, base: rgb("#9b9188"), dark: rgb("#6e655d"), craterScale: 7, craterDepth: 0.4 }),
  triton,
  charon,
};

export const SIZES = { earth: 1536, jupiter: 1024, saturn: 1024, moon: 1024, mars: 1024, venus: 512, mercury: 512, uranus: 512, neptune: 512, pluto: 512 };

/**
 * Paints a body's maps a row at a time. A generator, so it can be spread
 * across frames if it has to run on the page's main thread. Returns
 * { map, extra } as ImageData (extra is only for Earth: lights and water).
 */
export function* paint(id, width = SIZES[id] ?? 256) {
  const height = width / 2;
  const isEarth = id === "earth";
  const painter = PAINTERS[id](width, height);
  const map = new ImageData(width, height);
  const extraImg = isEarth ? new ImageData(width, height) : null;
  const extra = [0, 0, 0];
  yield;
  for (let py = 0; py < height; py++) {
    const lat = 90 - ((py + 0.5) / height) * 180;
    const cl = Math.cos(lat * DEG);
    const y = Math.sin(lat * DEG);
    for (let px = 0; px < width; px++) {
      const lon = ((px + 0.5) / width) * 360 - 180;
      const x = cl * Math.cos(lon * DEG);
      const z = -cl * Math.sin(lon * DEG);
      const c = painter(x, y, z, lat, lon, px, py, extra);
      const o = (py * width + px) * 4;
      map.data[o] = c[0] * 255;
      map.data[o + 1] = c[1] * 255;
      map.data[o + 2] = c[2] * 255;
      map.data[o + 3] = 255;
      if (extraImg) {
        extraImg.data[o] = extra[0] * 255;
        extraImg.data[o + 1] = extra[1] * 255;
        extraImg.data[o + 3] = 255;
      }
    }
    yield;
  }
  return { map, extra: extraImg };
}

/** Earth's cloud layer (brightness = cloud cover). */
export function* paintClouds(width = 1024) {
  const it = paintWith(earthClouds(), width);
  return yield* it;
}

function* paintWith(painter, width) {
  const height = width / 2;
  const img = new ImageData(width, height);
  for (let py = 0; py < height; py++) {
    const lat = 90 - ((py + 0.5) / height) * 180;
    const cl = Math.cos(lat * DEG);
    const y = Math.sin(lat * DEG);
    for (let px = 0; px < width; px++) {
      const lon = ((px + 0.5) / width) * 360 - 180;
      const c = painter(cl * Math.cos(lon * DEG), y, -cl * Math.sin(lon * DEG), lat, lon);
      const o = (py * width + px) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = c[0] * 255;
      img.data[o + 3] = 255;
    }
    yield;
  }
  return img;
}

/** Paints the Milky Way as a galactic longitude/latitude map. A generator, like the planet painters. */
export function* paintMilkyWay(width = 1024) {
  const height = width / 2;
  const n = simplex(9001);
  const img = new ImageData(width, height);
  for (let py = 0; py < height; py++) {
    const b = 90 - ((py + 0.5) / height) * 180;
    for (let px = 0; px < width; px++) {
      let l = ((px + 0.5) / width) * 360 - 180; // 0 in the middle = the galactic centre
      const cb = Math.cos(b * DEG);
      const x = cb * Math.cos(l * DEG), y = Math.sin(b * DEG), z = -cb * Math.sin(l * DEG);
      const toCenter = Math.exp(-((l / 50) ** 2));
      const width_ = 5 + 7 * toCenter + 2 * fbm(n, x * 2, y * 2, z * 2, 3);
      const clump = 0.55 + 0.45 * fbm(n, x * 5 + 10, y * 5, z * 5, 5);
      let v = Math.exp(-((b / width_) ** 2)) * (0.35 + 0.65 * toCenter) * clump;
      // The dark dust lane down the middle (the Great Rift).
      const lane = Math.exp(-(((b - 1.2 * fbm(n, x * 3, y * 3, z * 3 + 5, 4) * 3) / 2.2) ** 2));
      v *= 1 - 0.7 * lane * smooth(100, 20, Math.abs(l));
      // (The Magellanic Clouds and Andromeda are drawn on their own: see galaxies.js.)
      const c = mix3([0.75, 0.82, 1.0], [1.0, 0.9, 0.78], toCenter);
      const k = clamp(v) * 0.28 * 255;
      const o = (py * width + px) * 4;
      img.data[o] = c[0] * k;
      img.data[o + 1] = c[1] * k;
      img.data[o + 2] = c[2] * k;
      img.data[o + 3] = 255;
    }
    if (py % 8 === 7) yield;
  }
  return img;
}

/**
 * The painter for a job name: a body id, "clouds" or "milkyway", optionally
 * with a size, like "moon@2048".
 */
export function painterFor(job) {
  const [name, size] = job.split("@");
  const width = size ? Number(size) : undefined;
  if (name === "clouds") return paintClouds(width);
  if (name === "milkyway") return paintMilkyWay(width);
  return paint(name, width);
}

/** Runs a painter generator to the end and returns what it made. */
export function finish(gen) {
  let r;
  do r = gen.next();
  while (!r.done);
  return r.value;
}

/**
 * Saturn's rings as a strip: x runs from the inner edge of the C ring to the
 * outer edge of the A ring. Alpha is how much light the rings block.
 */
export function ringStrip(width = 1024) {
  const n = simplex(501);
  const img = new ImageData(width, 1);
  const inner = 1.239;
  const outer = 2.27;
  for (let i = 0; i < width; i++) {
    const r = inner + ((i + 0.5) / width) * (outer - inner);
    const grain = 0.85 + 0.3 * (0.5 + 0.5 * n(r * 80, 0.5, 0.5)) * (0.5 + 0.5 * n(r * 300, 1.5, 0.5));
    let a, c;
    if (r < 1.527) { // C ring: faint and grey
      a = mix(0.08, 0.22, (r - inner) / (1.527 - inner));
      c = rgb("#8d8478");
    } else if (r < 1.951) { // B ring: the bright, solid one
      a = 0.75 + 0.2 * smooth(1.53, 1.65, r);
      c = rgb("#e0d0ad");
    } else if (r < 2.025) { // Cassini Division
      a = 0.06;
      c = rgb("#6e665c");
    } else { // A ring
      a = 0.55;
      c = rgb("#c9b896");
      if (Math.abs(r - 2.214) < 0.004) a = 0.05; // Encke Gap
      if (Math.abs(r - 2.2655) < 0.0015) a = 0.1; // Keeler Gap
    }
    a = clamp(a * grain);
    const o = i * 4;
    img.data[o] = c[0] * 255 * grain;
    img.data[o + 1] = c[1] * 255 * grain;
    img.data[o + 2] = c[2] * 255 * grain;
    img.data[o + 3] = a * 255;
  }
  return img;
}
