// Visitors: comets on their real orbits (from NASA JPL), three spacecraft far out where they really are, and meteor
// showers streaking from the right part of the sky on the right nights.
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { auToScene } from "./ephemeris.js";
import { skyDirection } from "./galaxies.js";
import { COMETS, CRAFT } from "./visitors-data.js";

const DEG = Math.PI / 180;
const GAUSS = 0.01720209895; // radians a day: the Sun's pull, as Kepler's third law needs it (AU, days)
const julian = (date) => date.getTime() / 86400000 + 2440587.5;

/** A comet's place (heliocentric, ecliptic J2000, AU) at `date`, by Kepler's laws from its elements. */
export function cometPosition(c, date, out = new Vector3()) {
  const a = c.q / (1 - c.e);
  const n = GAUSS / Math.pow(a, 1.5);
  let M = (n * (julian(date) - c.tp)) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  // E - e sin E = M, by Newton's method (from a start that holds even very near the Sun on a long, thin orbit).
  let E = c.e > 0.8 ? Math.sign(M) * Math.cbrt(6 * Math.abs(M)) : M;
  for (let k = 0; k < 50; k++) {
    const d = (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const x = a * (Math.cos(E) - c.e);
  const y = a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  // Round from the orbit's own plane to the ecliptic: by the argument of perihelion, the tilt, then the node.
  const [w, i, O] = [c.peri * DEG, c.i * DEG, c.node * DEG];
  const xw = x * Math.cos(w) - y * Math.sin(w);
  const yw = x * Math.sin(w) + y * Math.cos(w);
  return out.set(xw * Math.cos(O) - yw * Math.cos(i) * Math.sin(O), xw * Math.sin(O) + yw * Math.cos(i) * Math.cos(O), yw * Math.sin(i));
}

/** When a comet is next nearest the Sun, after `from`. */
export function nextPerihelion(c, from) {
  const a = c.q / (1 - c.e);
  const period = (2 * Math.PI) / (GAUSS / Math.pow(a, 1.5)); // days
  const jd = julian(from);
  const k = Math.ceil((jd - c.tp) / period);
  return new Date((c.tp + k * period - 2440587.5) * 86400000);
}

/** A spacecraft's place (heliocentric, ecliptic J2000, AU) at `date`: coasting on from where Horizons had it. */
export function craftPosition(c, date, out = new Vector3()) {
  const days = julian(date) - c.jd;
  return out.set(c.r[0] + c.v[0] * days, c.r[1] + c.v[1] * days, c.r[2] + c.v[2] * days);
}

/** From ecliptic J2000 (AU) to the scene: the same turn as the planets, and distances squashed the same way. */
export function eclipticToScene(v, out = new Vector3()) {
  out.set(v.x, v.z, -v.y);
  const r = out.length();
  return r > 0 ? out.multiplyScalar(auToScene(r) / r) : out;
}

// The yearly meteor showers: when the Sun is at `sun` degrees along the ecliptic (the peak), the radiant (right
// ascension, declination), how many an hour at best from a dark place, and the comet (or rock) whose dust it is.
// From the International Meteor Organization's calendar.
export const SHOWERS = [
  { id: "quadrantids", name: "Quadrantids", sun: 283.15, ra: 230, dec: 49, zhr: 110, from: "a lost comet, now the rock 2003 EH1" },
  { id: "lyrids", name: "Lyrids", sun: 32.32, ra: 271, dec: 34, zhr: 18, from: "Comet Thatcher" },
  { id: "eta-aquariids", name: "Eta Aquariids", sun: 45.5, ra: 338, dec: -1, zhr: 50, from: "Halley's Comet" },
  { id: "perseids", name: "Perseids", sun: 140.0, ra: 48, dec: 58, zhr: 100, from: "Comet Swift-Tuttle" },
  { id: "draconids", name: "Draconids", sun: 195.4, ra: 262, dec: 54, zhr: 10, from: "Comet Giacobini-Zinner" },
  { id: "orionids", name: "Orionids", sun: 208, ra: 95, dec: 16, zhr: 20, from: "Halley's Comet" },
  { id: "leonids", name: "Leonids", sun: 235.27, ra: 152, dec: 22, zhr: 15, from: "Comet Tempel-Tuttle" },
  { id: "geminids", name: "Geminids", sun: 262.2, ra: 112, dec: 33, zhr: 150, from: "the rock 3200 Phaethon" },
];

/** How strong a shower is when the Sun is at `sunLon` degrees: 1 at its peak, falling away over a few days either side. */
export function showerStrength(shower, sunLon) {
  const d = ((sunLon - shower.sun + 540) % 360) - 180;
  return Math.exp(-0.5 * (d / 1.2) ** 2);
}

const pointShader = {
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    attribute float size;
    attribute float alpha;
    attribute vec3 tint;
    varying float vAlpha;
    varying vec3 vTint;
    void main() {
      vAlpha = alpha;
      vTint = tint;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * pixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    varying vec3 vTint;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float glow = smoothstep(1.0, 0.0, d);
      gl_FragColor = vec4(vTint * glow * glow * vAlpha, 1.0);
    }
  `,
};

const TAIL = 48; // points along a comet's tail

/** The comets and spacecraft in the solar system: their dots, the comets' tails, and where to put their names. */
export function createVisitors(scene, pixelRatio) {
  const group = new Group();
  scene.add(group);
  const count = COMETS.length * (TAIL + 1) + CRAFT.length;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("size", new Float32BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute("alpha", new Float32BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute("tint", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new ShaderMaterial({ ...pointShader, uniforms: { pixelRatio: { value: pixelRatio } }, blending: AdditiveBlending, depthWrite: false, transparent: true });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  group.add(points);

  const things = [
    ...COMETS.map((c) => ({ id: c.id, name: c.name, comet: c, position: new Vector3(), shown: false })),
    ...CRAFT.map((c) => ({ id: c.id, name: c.name, craft: c, position: new Vector3(), shown: true })),
  ];
  const real = new Vector3();
  const away = new Vector3();
  const at = new Vector3();
  const ice = new Color(0.75, 0.88, 1);
  const metal = new Color(0.85, 0.85, 0.8);

  return {
    group,
    /** For names: { id, name, position (scene), shown } */
    things,
    /** Moves everything to `date`. */
    update(date) {
      const pos = geo.attributes.position;
      const size = geo.attributes.size;
      const alpha = geo.attributes.alpha;
      const tint = geo.attributes.tint;
      let k = 0;
      const put = (p, s, a, c) => {
        pos.setXYZ(k, p.x, p.y, p.z);
        size.setX(k, s);
        alpha.setX(k, a);
        tint.setXYZ(k, c.r, c.g, c.b);
        k++;
      };
      for (const t of things) {
        if (t.comet) {
          cometPosition(t.comet, date, real);
          const r = real.length();
          eclipticToScene(real, t.position);
          // Bright and tailed only near the Sun: a comet far out is a dark lump of ice, too small to see.
          const near = Math.min(1, Math.max(0, (6 - r) / 4));
          t.shown = near > 0.05;
          put(t.position, 2 + 3 * near, 0.25 + 0.75 * near, ice);
          // The tail points straight away from the Sun, longer the nearer it is (up to about an AU).
          away.copy(real).normalize();
          const length = Math.min(1.2, 0.5 / Math.max(r, 0.3)) * near;
          for (let j = 1; j <= TAIL; j++) {
            const f = j / TAIL;
            at.copy(real).addScaledVector(away, length * f);
            eclipticToScene(at, at);
            put(at, (6 - 4 * f) * near + 0.5, (1 - f) * (1 - f) * 0.5 * near, ice);
          }
        } else {
          craftPosition(t.craft, date, real);
          eclipticToScene(real, t.position);
          put(t.position, 2.5, 0.9, metal);
        }
      }
      pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = tint.needsUpdate = true;
    },
  };
}

/**
 * Meteors: on the nights of a shower, now and then a streak in the sky, starting some way off the shower's radiant and
 * heading away from it, as real ones do. Shown only standing on Earth (from the ground there is a sky to fall through).
 * About three times as often as you'd see them from a dark place, so there is something to see on a screen.
 */
export function createMeteors(skyGroup) {
  const SLOTS = 8;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(SLOTS * 6), 3));
  geo.setAttribute("color", new Float32BufferAttribute(new Float32Array(SLOTS * 6), 3));
  const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = -1;
  skyGroup.add(lines);
  const live = Array.from({ length: SLOTS }, () => ({ until: 0, born: 0, from: new Vector3(), to: new Vector3() }));
  const radiant = new Vector3();
  const side = new Vector3();
  const tmp = new Vector3();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  return {
    /** `sunLon`: where the Sun is along the ecliptic (degrees), for which showers are on. `on`: standing on Earth. */
    update(now, dt, sunLon, on) {
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      lines.visible = on;
      if (!on) return;
      for (const s of SHOWERS) {
        const perSecond = ((s.zhr * showerStrength(s, sunLon)) / 3600) * 3;
        if (perSecond < 1e-5 || rand() > perSecond * dt) continue;
        const slot = live.find((m) => m.until < now);
        if (!slot) break;
        skyDirection(s.ra, s.dec, radiant);
        // Off the radiant by 10 to 60 degrees, in any direction, and on away from it by 4 to 12.
        side.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(radiant).normalize();
        const off = (10 + 50 * rand()) * DEG;
        const run = (4 + 8 * rand()) * DEG;
        slot.from.copy(radiant).applyAxisAngle(side, off).multiplyScalar(870);
        slot.to.copy(radiant).applyAxisAngle(side, off + run).multiplyScalar(870);
        slot.born = now;
        slot.until = now + 350 + 500 * rand();
      }
      live.forEach((m, i) => {
        // A bright head running along the streak, its trail fading behind it.
        const t = m.until > now ? (now - m.born) / (m.until - m.born) : 1;
        const head = Math.min(1, t * 1.3);
        tmp.lerpVectors(m.from, m.to, head);
        const tail = tmp.clone().lerp(m.from, Math.min(1, 0.6 + t));
        const glow = m.until > now ? Math.sin(Math.PI * t) : 0;
        pos.setXYZ(i * 2, tail.x, tail.y, tail.z);
        pos.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z);
        col.setXYZ(i * 2, 0, 0, 0);
        col.setXYZ(i * 2 + 1, glow, glow * 0.95, glow * 0.85);
      });
      pos.needsUpdate = col.needsUpdate = true;
    },
  };
}
