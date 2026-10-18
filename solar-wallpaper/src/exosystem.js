// A visit to a planetary system round another star.
//
// What's real: the star's heat and size, each planet's year and how far out
// it is (in the right order), from the Open Exoplanet Catalogue; its size and
// heat too where the catalogue has them, and worked out from its weight, or
// from its star and its distance, where it doesn't (those say "about").
// What's made up: how each one looks (nobody has seen them) and exactly where
// it is on its orbit. Distances are squashed so a whole system fits on screen:
// the log of the distance, not the distance. The sizes of planets are squashed
// too, and so are the speeds: inner planets go round faster than outer ones,
// but not by the real amount, so the far ones still visibly move.
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Ray,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { exoGlow, exoPlanet, exoStar } from "./exoshaders.js";
import { createSky } from "./sky.js";

/** The colour of a glowing thing at a temperature (kelvin), as linear light, brightest channel 1. */
export function blackbody(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 1 : Math.min(1, Math.max(0, 1.2929362 * Math.pow(t - 60, -0.1332048)));
  const g = t <= 66 ? Math.min(1, Math.max(0, 0.3900816 * Math.log(t) - 0.6318414)) : Math.min(1, Math.max(0, 1.1298909 * Math.pow(t - 60, -0.0755148)));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.min(1, Math.max(0, 0.5432068 * Math.log(t - 10) - 1.1962541));
  return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
}

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

/**
 * What kind of world this is, and so how to draw it. Sizes are in Earth
 * radii, temperatures in kelvin. Returns the shader settings and a short
 * plain description.
 */
export function look(p) {
  const seed = hash(p.name) * 40;
  const base = { seed, ocean: 0.6, ice: 0.12, glow: [0, 0, 0], glowPower: 0, rim: [0.4, 0.55, 0.9, 0] };
  if (p.r >= 8) {
    if (/HD 189733/.test(p.name)) return { ...base, kind: "hot gas giant (deep blue)", mode: 1, a: [0.1, 0.2, 0.6], b: [0.18, 0.32, 0.8], c: [0.5, 0.68, 1.0], rim: [0.3, 0.5, 1.0, 0.6] };
    if (p.t >= 2200) return { ...base, kind: "ultra-hot gas giant", mode: 1, a: [0.1, 0.05, 0.04], b: [0.32, 0.12, 0.05], c: [0.95, 0.5, 0.15], glow: [1.0, 0.35, 0.08], glowPower: 0.9, rim: [1.0, 0.4, 0.1, 0.5] };
    if (p.t >= 1000) return { ...base, kind: "hot gas giant", mode: 1, a: [0.25, 0.13, 0.1], b: [0.5, 0.26, 0.15], c: [0.85, 0.5, 0.25], glow: [1.0, 0.25, 0.05], glowPower: 0.35, rim: [1.0, 0.5, 0.2, 0.35] };
    if (p.t >= 400) return { ...base, kind: "warm gas giant", mode: 1, a: [0.75, 0.62, 0.45], b: [0.52, 0.38, 0.26], c: [0.92, 0.82, 0.66], rim: [0.9, 0.75, 0.55, 0.3] };
    if (p.t >= 150) return { ...base, kind: "gas giant", mode: 1, a: [0.86, 0.76, 0.6], b: [0.6, 0.42, 0.3], c: [0.86, 0.5, 0.35], rim: [0.9, 0.8, 0.65, 0.3] };
    return { ...base, kind: "cold gas giant", mode: 1, a: [0.72, 0.78, 0.9], b: [0.5, 0.58, 0.75], c: [0.9, 0.92, 1.0], rim: [0.7, 0.8, 1.0, 0.3] };
  }
  if (p.r >= 3.5) return { ...base, kind: "ice giant", mode: 2, a: [0.16, 0.33, 0.78], b: [0.3, 0.55, 0.92], c: [0.8, 0.92, 1.0], rim: [0.4, 0.65, 1.0, 0.6], glow: p.t > 1000 ? [1.0, 0.4, 0.1] : [0, 0, 0], glowPower: p.t > 1000 ? 0.2 : 0 };
  if (p.r >= 1.8) return { ...base, kind: "small gas or water world", mode: 2, a: [0.42, 0.62, 0.7], b: [0.66, 0.8, 0.82], c: [0.92, 0.95, 0.95], rim: [0.6, 0.8, 0.9, 0.6] };
  if (p.t >= 1300) return { ...base, kind: "lava world", mode: 3, a: [1.0, 0.33, 0.05], b: [0.06, 0.045, 0.045], c: [1.0, 0.8, 0.3], glow: [1.0, 0.3, 0.05], glowPower: 0.8, rim: [1.0, 0.35, 0.1, 0.25] };
  if (p.t >= 800) return { ...base, kind: "scorched rock", mode: 4, a: [0.22, 0.13, 0.1], b: [0.42, 0.28, 0.2], c: [0.7, 0.18, 0.06], glow: [0.8, 0.15, 0.05], glowPower: 0.25, rim: [0.9, 0.4, 0.2, 0.15] };
  if (p.t >= 330) return { ...base, kind: "hot dry rock", mode: 4, a: [0.68, 0.43, 0.25], b: [0.5, 0.3, 0.2], c: [0.35, 0.22, 0.15], rim: [0.9, 0.55, 0.3, 0.2] };
  if (p.t >= 180) return { ...base, kind: "rocky world, maybe with seas", mode: 0, a: [0.04, 0.16, 0.4], b: [0.17, 0.33, 0.14], c: [0.55, 0.45, 0.28], ocean: 0.45 + 0.35 * hash(p.name + "o"), ice: p.t < 250 ? 0.3 : 0.12, rim: [0.35, 0.55, 1.0, 0.7] };
  return { ...base, kind: "frozen world", mode: 4, a: [0.82, 0.9, 0.96], b: [0.62, 0.74, 0.86], c: [0.5, 0.6, 0.72], rim: [0.6, 0.75, 1.0, 0.2] };
}

/** How long a trip round its star takes, in everyday words. */
function yearText(days) {
  if (days < 100) return `goes round in ${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
  const years = days / 365.25;
  return `goes round in ${years < 10 ? years.toFixed(1) : Math.round(years).toLocaleString("en-US")} years`;
}

export function createExoSystem(canvas, pixelRatio) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 6000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.rotateSpeed = 0.6;
  controls.autoRotateSpeed = 0.35;
  controls.enabled = false;

  const sky = createSky(pixelRatio);
  scene.add(sky.group);

  const places = new Map();
  let current = null; // { system, group, star, bodies: [{ place, mesh, r, omega, phase, spin }], pulsar }
  let info = null;
  let following = null; // a body we're heading for, or null (the star)
  let followSince = 0; // when we set off for it
  let fromTarget = new Vector3(); // where the camera was looking when we set off
  let offsetGoal = null; // which side of the planet to arrive on (the side the star lights), or null
  let wantDistance = 0;
  let home = 0; // how far out to see the whole system

  const toLine = (radius, count = 160) => {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI;
      pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  };

  function clear() {
    if (!current) return;
    scene.remove(current.group);
    current.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    current = null;
    places.clear();
  }

  /** Sets up a system (one entry of EXOPLANET_SYSTEMS) and puts the camera where the whole of it can be seen. */
  function show(system) {
    clear();
    const group = new Group();
    scene.add(group);
    const { star, planets } = system;
    const pulsar = star.class === "P";
    const tint = blackbody(star.temp);
    const starR = pulsar ? 0.35 : MathUtils.clamp(0.9 + 1.2 * Math.sqrt(star.radius), 1.2, 4.6);

    // The star.
    const starMat = new ShaderMaterial({ ...exoStar, uniforms: { tint: { value: tint }, time: { value: 0 }, seed: { value: hash(system.id) * 30 } } });
    const starMesh = new Mesh(new SphereGeometry(starR, 64, 32), starMat);
    group.add(starMesh);
    const glows = [];
    for (const [size, power, falloff] of [[12, 0.3, 3.2], [4.2, 0.9, 5.5]]) {
      const g = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({ ...exoGlow, uniforms: { tint: { value: tint }, power: { value: power }, falloff: { value: falloff } }, blending: AdditiveBlending, transparent: true, depthWrite: false }));
      g.scale.setScalar(starR * size);
      g.renderOrder = 5;
      group.add(g);
      glows.push(g);
    }
    let beams = null;
    if (pulsar) {
      // A pulsar sweeps two thin beams round like a lighthouse.
      beams = new Group();
      const tilt = new Group();
      tilt.rotation.x = 1.0;
      beams.add(tilt);
      for (const turn of [0, Math.PI / 2]) {
        const b = new Mesh(new PlaneGeometry(90, 1.6), new ShaderMaterial({ ...exoGlow, uniforms: { tint: { value: [0.6, 0.75, 1.0] }, power: { value: 1.4 }, falloff: { value: 2.2 } }, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide }));
        b.rotation.set(turn, 0, 0);
        b.rotateZ(Math.PI / 2);
        b.renderOrder = 4;
        tilt.add(b);
      }
      group.add(beams);
    }

    // How far out each orbit is drawn: by the log of its real distance.
    const heat = star.radius * star.radius * Math.pow(star.temp / 5772, 4);
    const zone = pulsar ? null : [Math.sqrt(heat / 1.1), Math.sqrt(heat / 0.53)];
    const dists = planets.map((p) => p.a).concat(zone ?? []);
    const lo = Math.min(...dists) * 0.85;
    const hi = Math.max(...dists) * 1.15;
    const inner = starR * 2.4 + 3;
    const outer = planets.length > 1 || zone ? 60 : inner + 16;
    const place = (a) => inner + ((outer - inner) * Math.log(a / lo)) / Math.max(Math.log(hi / lo), 1e-3);

    if (zone) {
      const ring = new Mesh(new RingGeometry(place(zone[0]), place(zone[1]), 160, 1), new MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.1, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 1;
      group.add(ring);
    }

    const bodies = [];
    const minPeriod = Math.min(...planets.map((p) => p.p));
    planets.forEach((p, i) => {
      const r = place(p.a);
      const radius = 0.16 + 0.1 * Math.pow(p.r, 0.75);
      const orbit = new LineLoop(toLine(r), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
      group.add(orbit);
      const lk = look(p);
      const mat = new ShaderMaterial({
        ...exoPlanet,
        uniforms: {
          sunDir: { value: new Vector3(1, 0, 0) },
          starColor: { value: tint },
          starPower: { value: 1.5 },
          mode: { value: lk.mode },
          colA: { value: lk.a },
          colB: { value: lk.b },
          colC: { value: lk.c },
          seed: { value: lk.seed },
          ocean: { value: lk.ocean },
          ice: { value: lk.ice },
          glowColor: { value: lk.glow },
          glowPower: { value: lk.glowPower },
          rim: { value: lk.rim },
          time: { value: 0 },
        },
      });
      const mesh = new Mesh(new SphereGeometry(radius, 96, 48), mat);
      group.add(mesh);
      const id = `p${i}`;
      const label = {
        id,
        onClick: () => flyTo(id),
        name: p.name,
        sub: `${lk.kind} · ${p.est ? "about " : ""}${p.r < 10 ? p.r.toFixed(1) : Math.round(p.r)}× Earth's width · ${yearText(p.p)} · ${p.tEst ? "about " : ""}${p.t} K${p.disputed ? " · disputed" : ""}`,
        position: mesh.position,
        radius,
        fixedSub: true,
      };
      places.set(label.id, label);
      bodies.push({ place: label, mesh, r, radius, omega: Math.max((2 * Math.PI) / 26 * Math.pow(minPeriod / p.p, 0.55), (2 * Math.PI) / 400), phase: hash(p.name + "ph") * 2 * Math.PI, spin: 0.2 + 0.4 * hash(p.name + "s"), mat });
    });
    places.set("star", {
      id: "star",
      onClick: () => flyTo("star"),
      name: system.name,
      sub: `${system.ly < 100 ? system.ly.toFixed(1) : Math.round(system.ly).toLocaleString("en-US")} light-years · ${planets.length} planet${planets.length === 1 ? "" : "s"}`,
      position: new Vector3(),
      radius: starR,
      fixedSub: true,
    });
    current = { system, group, star: starMesh, glows, starMat, bodies, beams, starR, tint };
    info = {
      name: system.name,
      about: system.about,
      ly: system.ly,
      zone: Boolean(zone),
      dim: planets.some((p) => p.est || p.tEst) ? "Where a size or a heat says 'about', it is worked out (from the planet's weight, or from its star and its distance), not measured." : "",
    };
    // Where to see the lot from.
    home = outer * 2.1;
    following = null;
    wantDistance = 0;
    camera.position.set(0, home * 0.52, home * 0.86);
    controls.target.set(0, 0, 0);
    controls.minDistance = starR * 1.6;
    controls.maxDistance = home * 3;
    controls.update();
  }

  const aim = new Vector3();
  /** Moves the planets round and the camera along. dt: seconds since the last frame. */
  function update(dt, now, drift) {
    if (!current) return;
    const t = now / 1000;
    current.starMat.uniforms.time.value = t;
    sky.group.position.copy(camera.position);
    for (const g of current.glows) g.quaternion.copy(camera.quaternion);
    if (current.beams) current.beams.rotation.y = t * 5.2;
    for (const b of current.bodies) {
      const a = b.phase + b.omega * t;
      b.mesh.position.set(Math.cos(a) * b.r, 0, Math.sin(a) * b.r);
      b.mesh.rotation.y = b.spin * t;
      b.mat.uniforms.sunDir.value.copy(b.mesh.position).negate().normalize();
      b.mat.uniforms.time.value = t;
    }
    // Heading for a planet: the camera's centre slides to it over a moment, then stays exactly with it; the distance eases in.
    const goal = following ? following.mesh.position : aim.set(0, 0, 0);
    const k = 1 - Math.exp(-dt * 3.2);
    const offset = camera.position.clone().sub(controls.target);
    const arrive = MathUtils.smootherstep((now - followSince) / 1400, 0, 1);
    if (following || arrive < 1) controls.target.lerpVectors(fromTarget, goal, arrive);
    if (offsetGoal) {
      // Swing round to the lit side while setting off, then leave the view to the mouse.
      offset.normalize().lerp(offsetGoal, Math.min(1, k * 1.2)).normalize().multiplyScalar(camera.position.distanceTo(controls.target) || 1);
      if (arrive >= 1) offsetGoal = null;
    }
    if (wantDistance > 0) {
      const d = offset.length();
      const nd = d + (wantDistance - d) * k;
      offset.setLength(nd);
      if (Math.abs(nd - wantDistance) < wantDistance * 0.02) wantDistance = 0; // there: leave the zoom to the mouse
    }
    camera.position.copy(controls.target).add(offset);
    controls.autoRotate = drift && !following;
    controls.update();
  }

  const ray = new Ray();
  const hit = new Sphere();
  const at = new Vector3();
  /** The planet or star under a screen point, if any. */
  function pick(x, y) {
    if (!current) return null;
    ray.origin.copy(camera.position);
    ray.direction.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    let best = null;
    let bestDistance = Infinity;
    const candidates = [...current.bodies.map((b) => b.place), places.get("star")];
    for (const p of candidates) {
      hit.set(p.position, Math.max(p.radius * 1.6, camera.position.distanceTo(p.position) * 0.02));
      if (ray.intersectSphere(hit, at)) {
        const d = at.distanceTo(camera.position);
        if (d < bestDistance) [best, bestDistance] = [p, d];
      }
    }
    return best;
  }

  /** Goes to a planet (close, and stays with it), or "star" for the whole system again. */
  function flyTo(id) {
    if (!current) return;
    const body = current.bodies.find((b) => b.place.id === id);
    following = body ?? null;
    followSince = performance.now();
    fromTarget.copy(controls.target);
    offsetGoal = null;
    if (body) {
      // Where it will be in a moment, and which way its star then lies: arrive a little off that, and above.
      const t = performance.now() / 1000 + 1.4;
      const a = body.phase + body.omega * t;
      const toStar = new Vector3(-Math.cos(a), 0, -Math.sin(a));
      offsetGoal = toStar.multiplyScalar(0.8).addScaledVector(new Vector3(-toStar.z, 0, toStar.x), 0.5).add(new Vector3(0, 0.3, 0)).normalize();
    }
    wantDistance = body ? Math.max(body.radius * 7, 2) : home;
    controls.minDistance = body ? body.radius * 1.8 : current.starR * 1.6;
  }

  return {
    scene,
    camera,
    controls,
    places,
    show,
    update,
    pick,
    flyTo,
    get info() {
      return info;
    },
    get system() {
      return current?.system ?? null;
    },
    get following() {
      return following?.place.id ?? null;
    },
    setMilkyWay: (texture) => sky.setMilkyWay(texture),
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
  };
}
