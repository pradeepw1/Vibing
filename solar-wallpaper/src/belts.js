// The asteroid belt, Jupiter's Trojans and the Kuiper belt.
//
// These aren't real catalogued objects, but every particle has a proper
// orbit and moves by Kepler's laws, so the belt shears and flows the way the
// real one does. The main belt has the real Kirkwood gaps (where Jupiter's pull
// clears orbits out), and the Trojans ride 60 degrees ahead of and behind Jupiter.
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, Vector3 } from "three";
import { SCALE } from "./ephemeris.js";
import { random } from "./noise.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;
const GAUSS_K = 0.01720209895; // mean motion at 1 AU, radians per day
const meanMotion = (a) => GAUSS_K / Math.pow(a, 1.5);

// Jupiter's mean longitude at J2000 and its mean motion (JPL approximate elements).
const JUPITER_L0 = 34.39644051 * DEG;
const JUPITER_N = (3034.74612775 / 36525) * DEG;

// Orbits that Jupiter clears out: [a in AU, half-width].
const KIRKWOOD = [[2.502, 0.03], [2.825, 0.022], [2.958, 0.014], [3.279, 0.04], [2.065, 0.02]];

function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

function build(count, make) {
  const shape = new Float32Array(count * 3);
  const angles = new Float32Array(count * 4);
  const bright = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = make(i);
    shape.set([o.a, o.e, o.i], i * 3);
    angles.set([o.node, o.peri, o.M0, o.n ?? meanMotion(o.a)], i * 4);
    bright[i] = o.bright;
  }
  const g = new BufferGeometry();
  // Position is unused (the shader works it out) but three.js wants one.
  g.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("shape", new Float32BufferAttribute(shape, 3));
  g.setAttribute("angles", new Float32BufferAttribute(angles, 4));
  g.setAttribute("bright", new Float32BufferAttribute(bright, 1));
  return g;
}

function mainBelt(count, rand) {
  return build(count, () => {
    let a;
    do {
      a = 2.15 + Math.pow(rand(), 0.9) * 1.2 + gaussian(rand) * 0.05;
    } while (KIRKWOOD.some(([at, w]) => Math.abs(a - at) < w) || a < 2.1);
    return {
      a,
      e: Math.min(0.3, Math.abs(gaussian(rand)) * 0.09),
      i: Math.abs(gaussian(rand)) * 7 * DEG,
      node: rand() * 2 * Math.PI,
      peri: rand() * 2 * Math.PI,
      M0: rand() * 2 * Math.PI,
      bright: 0.35 + 0.65 * Math.pow(rand(), 3),
    };
  });
}

function hildas(count, rand) {
  return build(count, () => ({
    a: 3.97 + gaussian(rand) * 0.03,
    e: 0.08 + rand() * 0.15,
    i: Math.abs(gaussian(rand)) * 6 * DEG,
    node: rand() * 2 * Math.PI,
    peri: rand() * 2 * Math.PI,
    M0: rand() * 2 * Math.PI,
    bright: 0.3 + 0.4 * rand(),
  }));
}

function trojans(count, rand) {
  return build(count, (k) => {
    const node = rand() * 2 * Math.PI;
    const peri = rand() * 2 * Math.PI;
    const lead = k % 2 === 0 ? 60 : -60; // L4 ahead of Jupiter, L5 behind
    const lambda = JUPITER_L0 + (lead + gaussian(rand) * 12) * DEG;
    return {
      a: 5.2026 + gaussian(rand) * 0.02,
      e: Math.abs(gaussian(rand)) * 0.05,
      i: Math.abs(gaussian(rand)) * 11 * DEG,
      node,
      peri,
      M0: lambda - node - peri,
      n: JUPITER_N, // same period as Jupiter, so they keep pace with it
      bright: 0.3 + 0.5 * rand(),
    };
  });
}

function kuiper(count, rand) {
  return build(count, () => {
    const plutino = rand() < 0.25;
    return {
      a: plutino ? 39.4 + gaussian(rand) * 0.2 : 42 + rand() * 5.5,
      e: plutino ? 0.1 + rand() * 0.2 : Math.abs(gaussian(rand)) * 0.05,
      i: Math.abs(gaussian(rand)) * (plutino ? 10 : 4) * DEG,
      node: rand() * 2 * Math.PI,
      peri: rand() * 2 * Math.PI,
      M0: rand() * 2 * Math.PI,
      bright: 0.25 + 0.5 * rand(),
    };
  });
}

function material(color, opacity, pixelRatio, sizeScale) {
  return new ShaderMaterial({
    ...shaders.belt,
    uniforms: {
      days: { value: 0 },
      orbitScale: { value: SCALE.orbit },
      orbitPower: { value: SCALE.orbitPower },
      pixelRatio: { value: pixelRatio },
      sizeScale: { value: sizeScale },
      color: { value: new Color(color) },
      opacity: { value: opacity },
      povBlend: { value: 0 },
      toSky: { value: 0 },
      observerReal: { value: new Vector3() },
      observerShown: { value: new Vector3() },
      fromSky: { value: 0 },
      fromReal: { value: new Vector3() },
      fromShown: { value: new Vector3() },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

export function createBelts(pixelRatio) {
  const rand = random(777);
  const parts = [
    new Points(mainBelt(5000, rand), material("#c9b8a0", 0.75, pixelRatio, 30)),
    new Points(hildas(400, rand), material("#b9a890", 0.6, pixelRatio, 30)),
    new Points(trojans(1100, rand), material("#c2b29a", 0.65, pixelRatio, 30)),
    new Points(kuiper(2600, rand), material("#9fb2c9", 0.5, pixelRatio, 45)),
  ];
  for (const p of parts) p.frustumCulled = false;
  return {
    parts,
    /**
     * `days` = days since J2000 (2000-01-01 12:00 TT).
     * `view` = null for the overview, or { blend, to, from } where `to` and
     * `from` are each null (the overview) or { real, shown }: the sky seen
     * from a body at real position `real`, centred at `shown` (see pov.js).
     */
    update(days, view = null) {
      for (const p of parts) {
        const u = p.material.uniforms;
        u.days.value = days;
        u.povBlend.value = view ? view.blend : 0;
        u.toSky.value = view?.to ? 1 : 0;
        u.fromSky.value = view?.from ? 1 : 0;
        if (view?.to) {
          u.observerReal.value.copy(view.to.real);
          u.observerShown.value.copy(view.to.shown);
        }
        if (view?.from) {
          u.fromReal.value.copy(view.from.real);
          u.fromShown.value.copy(view.from.shown);
        }
      }
    },
  };
}
