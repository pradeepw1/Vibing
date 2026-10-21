// Builds the Sun, planets, moons and orbit lines, and moves them every frame.
import * as A from "astronomy-engine";
import {
  AdditiveBlending,
  Quaternion,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LineLoop,
  Mesh,
  NoColorSpace,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { AU_KM, MOONS, PLANETS, SATURN_RINGS, SUN } from "./bodies.js";
import {
  bodyQuaternion,
  displayRadius,
  lockedQuaternion,
  moonOffset,
  moonOrbit,
  planetOrbit,
  planetPosition,
  realPositions,
  SCALE,
  sceneLongitude,
} from "./ephemeris.js";
import { skyLayout, sunlight } from "./pov.js";
import * as shaders from "./shaders.js";
import { ringStrip } from "./surfaces.js";

const SPIN_CAP = 240;
const GROUND_SPIN_CAP = 15; // degrees per real second, for the body you stand on // degrees per real second; faster spins are slowed down so they don't flicker
const YEAR_MS = 365.25 * 86400e3;
const DAY_MS = 86400e3;
const GAS_GIANTS = new Set(["jupiter", "saturn", "uranus", "neptune", "venus"]);

const sphere = new SphereGeometry(1, 96, 48);
// Moons and glows are small on screen, but their edge still shows corners if there are too few sides.
const smallSphere = new SphereGeometry(1, 64, 32);
// The body you stand on fills half the screen, so it gets a much finer sphere.
let groundSphere = null; // the very fine sphere for standing on a body: built the first time it's needed, so the Wallpaper never pays for it

let anisotropy = 4;
/** How well textures hold up when seen at a slant (the edges of a planet): as much as the graphics chip allows. */
export function setAnisotropy(n) {
  anisotropy = Math.max(1, Math.min(16, n));
}
export const getAnisotropy = () => anisotropy;

/**
 * A texture from painted ImageData. Colour maps are sRGB; maps that hold plain
 * numbers (cloud cover, city lights, water) are `data` and are read as they are.
 */
export function texture(image, data = false) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(image, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = data ? NoColorSpace : SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    grad.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.6).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

function planetMaterial(def, isMoon) {
  const atmo = def.atmosphere ?? [0, 0, 0, 0];
  return new ShaderMaterial({
    ...shaders.planet,
    uniforms: {
      map: { value: null },
      hasMap: { value: 0 },
      mapB: { value: null }, // a new map fading in over `map`
      mapMix: { value: 0 }, // 0..1: how far it has got
      baseColor: { value: new Color(def.color ?? "#9a958e") },
      sunDir: { value: new Vector3(1, 0, 0) },
      sunlight: { value: 1 }, // 0..1: how much of the Sun isn't hidden by its planet (eclipses)
      eclipseTint: { value: new Color(def.id === "moon" ? "#7a2a12" : "#000000") }, // Earth's sunsets light the eclipsed Moon red
      ambient: { value: 0.006 }, // night sides stay almost black
      wrap: { value: GAS_GIANTS.has(def.id) ? 0.12 : 0.02 },
      atmosphere: { value: new Vector4(...atmo) },
      opacity: { value: 1 },
      hasExtra: { value: 0 },
      extraMap: { value: null },
      hasExtraB: { value: 0 },
      extraMapB: { value: null },
      hasRings: { value: 0 },
      ringNormal: { value: new Vector3() },
      center: { value: new Vector3() },
      ringRadii: { value: new Vector2() },
      ringMap: { value: null },
      ringMapB: { value: null }, // a real strip fading in over it
      ringMix: { value: 0 },
    },
    transparent: isMoon,
  });
}

function haloFor(def, radius) {
  const [r, g, b, strength] = def.atmosphere;
  const scale = def.id === "earth" ? 1.06 : 1.035;
  const mat = new ShaderMaterial({
    ...shaders.halo,
    uniforms: {
      color: { value: new Color(r, g, b) },
      center: { value: new Vector3() },
      sunDir: { value: new Vector3(1, 0, 0) },
      strength: { value: strength * 0.9 },
      edge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(smallSphere, mat); // the glow ends at this shell's edge, so it needs a round one
  mesh.scale.setScalar(radius * scale);
  mesh.userData = { strength: strength * 0.9, scale };
  return mesh;
}

function orbitMaterial(color, trail) {
  return new ShaderMaterial({
    ...shaders.orbit,
    uniforms: {
      color: { value: new Color(color) },
      opacity: { value: 0.5 },
      planetLon: { value: 0 },
      trail: { value: trail ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}

export function createSystem(scene, pixelRatio) {
  const bodies = new Map();
  const root = new Group();
  const orbitGroup = new Group();
  scene.add(root, orbitGroup);

  // --- Sun ---
  const sunMat = new ShaderMaterial({ ...shaders.sun, uniforms: { time: { value: 0 } } });
  const sunMesh = new Mesh(sphere, sunMat);
  sunMesh.scale.setScalar(SCALE.sunRadius);
  const sunGroup = new Group();
  sunGroup.add(sunMesh);
  const glow = glowTexture();
  const glows = [];
  for (const [size, opacity, color] of [[5, 0.85, "#ffd9a0"], [12, 0.28, "#ff9d4d"]]) {
    const s = new Sprite(new SpriteMaterial({ map: glow, color, opacity, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(SCALE.sunRadius * size);
    sunGroup.add(s);
    glows.push({ sprite: s, size: SCALE.sunRadius * size });
  }
  /** Keeps the Sun's glare from washing over the whole sky when the camera is close. */
  function fitGlow(camera) {
    const s = sunGroup.scale.x;
    const dist = camera.position.distanceTo(sunGroup.position) / s; // in the Sun's own units
    for (const g of glows) g.sprite.scale.setScalar(Math.min(g.size, Math.max(dist * 0.9, SCALE.sunRadius * 2.5)));
  }
  root.add(sunGroup);
  bodies.set("sun", { id: "sun", def: SUN, kind: "sun", radius: SCALE.sunRadius, group: sunGroup, mesh: sunMesh, spinOffset: 0, lastSpin: null });

  // --- Planets ---
  for (const def of PLANETS) {
    const radius = displayRadius(def.radiusKm);
    const group = new Group();
    const material = planetMaterial(def, false);
    const mesh = new Mesh(sphere, material);
    mesh.scale.setScalar(radius);
    group.add(mesh);
    const body = { id: def.id, def, kind: "planet", radius, group, mesh, material, spinOffset: 0, lastSpin: null, moons: [] };

    if (def.atmosphere) {
      body.halo = haloFor(def, radius);
      group.add(body.halo);
    }
    if (def.rings) {
      const strip = ringStrip();
      const tex = new DataTexture(strip.data, strip.width, 1);
      tex.colorSpace = SRGBColorSpace;
      tex.magFilter = tex.minFilter = LinearFilter;
      tex.needsUpdate = true;
      const ringMat = new ShaderMaterial({
        ...shaders.rings,
        uniforms: {
          map: { value: tex },
          mapB: { value: null }, // a real strip fading in over the painted one
          mapMix: { value: 0 },
          radii: { value: new Vector2(SATURN_RINGS.inner, SATURN_RINGS.outer) },
          center: { value: new Vector3() },
          planetRadius: { value: radius },
          normal: { value: new Vector3() },
          sunDir: { value: new Vector3(1, 0, 0) },
          ambient: { value: 0.01 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const ring = new Mesh(new RingGeometry(SATURN_RINGS.inner, SATURN_RINGS.outer, 256, 1), ringMat);
      ring.rotation.x = -Math.PI / 2; // into the equator plane (local +Y is the pole)
      mesh.add(ring);
      body.ring = ring;
      material.uniforms.hasRings.value = 1;
      material.uniforms.ringMap.value = tex;
      body.ringPainted = tex;
      material.uniforms.ringRadii.value.set(SATURN_RINGS.inner * radius, SATURN_RINGS.outer * radius);
    }
    if (def.id === "earth") {
      const cloudMat = new ShaderMaterial({
        ...shaders.clouds,
        uniforms: { map: { value: null }, mapB: { value: null }, mapMix: { value: 0 }, sunDir: { value: new Vector3(1, 0, 0) }, ambient: { value: 0.004 } },
        transparent: true,
        depthWrite: false,
      });
      body.clouds = new Mesh(sphere, cloudMat);
      body.clouds.scale.setScalar(1.008);
      body.clouds.visible = false;
      mesh.add(body.clouds);
    }

    const orbitMat = orbitMaterial(def.orbitColor, true);
    body.orbit = new LineLoop(new BufferGeometry(), orbitMat);
    body.orbit.frustumCulled = false;
    body.orbitSampledAt = null;
    orbitGroup.add(body.orbit);

    root.add(group);
    bodies.set(def.id, body);
  }

  // --- Moons ---
  for (const def of MOONS) {
    const parent = bodies.get(def.parent);
    const radius = displayRadius(def.radiusKm);
    const group = new Group();
    const material = planetMaterial(def, true);
    const mesh = new Mesh(smallSphere, material);
    mesh.scale.setScalar(radius);
    group.add(mesh);
    const orbitMat = orbitMaterial("#8fa3bf", false);
    const orbit = new LineLoop(new BufferGeometry(), orbitMat);
    orbit.frustumCulled = false;
    parent.group.add(orbit);
    const body = { id: def.id, def, kind: "moon", radius, group, mesh, material, parent, orbit, orbitSampledAt: null, spinOffset: 0, lastSpin: null, fade: 1 };
    parent.moons.push(body);
    root.add(group);
    bodies.set(def.id, body);
  }

  // --- Dots that keep tiny, far planets visible ---
  const markerGeo = new BufferGeometry();
  const planetsOnly = PLANETS.map((p) => bodies.get(p.id));
  markerGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(planetsOnly.length * 3), 3));
  markerGeo.setAttribute("radius", new Float32BufferAttribute(planetsOnly.map((b) => b.radius), 1));
  markerGeo.setAttribute("tint", new Float32BufferAttribute(planetsOnly.flatMap((b) => new Color(b.def.color).toArray()), 3));
  markerGeo.setAttribute("alpha", new Float32BufferAttribute(planetsOnly.map(() => 0.9), 1));
  const markerMat = new ShaderMaterial({
    ...shaders.markers,
    uniforms: { pixelRatio: { value: pixelRatio }, viewHeight: { value: 1000 } },
    transparent: true,
    depthWrite: false,
  });
  const markers = new Points(markerGeo, markerMat);
  markers.frustumCulled = false;
  scene.add(markers);

  // --- Every frame ---
  const tmp = new Vector3();
  const pole = new Vector3();

  function displaySpin(body, spin, dtReal, capPerSecond = SPIN_CAP) {
    if (body.lastSpin === null) {
      body.lastSpin = spin;
      return spin;
    }
    const dW = spin - body.lastSpin;
    body.lastSpin = spin;
    const cap = capPerSecond * Math.max(dtReal, 1 / 240);
    if (Math.abs(dW) > cap) body.spinOffset += Math.sign(dW) * cap - dW;
    else body.spinOffset -= Math.sign(body.spinOffset) * Math.min(Math.abs(body.spinOffset), cap - Math.abs(dW));
    body.spinOffset = ((((body.spinOffset + 180) % 360) + 360) % 360) - 180;
    return spin + body.spinOffset;
  }

  const grounds = new Set();
  function orient(body, bodyName, time, dtReal) {
    const axis = A.RotationAxis(A.Body[bodyName], time);
    // The ground you stand on fills the screen, so it may only turn slowly.
    const cap = grounds.has(body.id) ? GROUND_SPIN_CAP : SPIN_CAP;
    bodyQuaternion(axis.north, displaySpin(body, axis.spin, dtReal, cap), body.mesh.quaternion);
    return axis;
  }

  function resampleOrbits(body, timeMs, time) {
    if (body.kind === "planet") {
      if (body.orbitSampledAt !== null && Math.abs(timeMs - body.orbitSampledAt) < 20 * YEAR_MS) return false;
      const { positions } = planetOrbit(body.def, time);
      body.orbit.geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    } else {
      const every = body.def.orbit === "moon" ? 5 * DAY_MS : 60 * DAY_MS;
      if (body.orbitSampledAt !== null && Math.abs(timeMs - body.orbitSampledAt) < every) return false;
      body.orbit.geometry.setAttribute("position", new Float32BufferAttribute(moonOrbit(body.def, time, axes), 3));
    }
    body.orbitSampledAt = timeMs;
    return true;
  }

  const axes = {}; // planet poles and prime meridians as drawn
  const trueAxes = {}; // the same with the true spin
  const trueTurn = new Quaternion();
  const real = new Map(); // id -> real position in AU (scene axes), Sun at the origin
  const seen = new Map(); // the same as seen from the body we stand on (light-time for Jupiter's moons)
  const seenBefore = new Map(); // and from the body we're coming from
  const sky = new Map(); // layout of the view from a body
  const skyBefore = new Map(); // the previous body's sky, while hopping between them
  const shown = new Vector3();
  const overviewSpot = new Vector3();
  const overviews = new Map(); // where each body sits in the overview this frame
  const overview = (id) => overviews.get(id) ?? overviewSpot.set(0, 0, 0);
  const skyAnchor = new Vector3(); // where the view from a body is centred
  const beforeAnchor = new Vector3(); // where the sky we are leaving is centred
  const ZERO = new Vector3();
  let overviewShare = 1;
  const _target = { position: new Vector3(), scale: 1 };
  const _start = { position: new Vector3(), scale: 1 };
  const place = (position, scale, out = _target) => {
    out.position.copy(position);
    out.scale = scale;
    return out;
  };

  /** Where everything is drawn right now, to start a change of view from. */
  function snapshot() {
    const map = new Map();
    for (const b of bodies.values()) map.set(b.id, { position: b.group.position.clone(), scale: b.group.scale.x });
    return map;
  }

  /**
   * Moves everything to `date`.
   * dtReal: real seconds since the last frame. simRate: simulated ms per real ms.
   * pov: null for the overview, or { id, leaving, from, blend, camOffset }:
   *   id        the body we stand on (or are leaving)
   *   leaving   heading back to the overview
   *   from      where the current change of view started: { kind: "overview" },
   *             { kind: "sky", id, offset } (offset: the sky's centre relative to
   *             the body) or { kind: "snapshot", map, share, ground }; null once
   *             settled. `ground` is the body the camera started next to, if any
   *   blend     0..1, how far the change of view has got
   *   camOffset where to centre the sky, relative to the body
   */
  function update(date, dtReal, simRate, camera, viewHeight, showOrbits, realSeconds, pov = null) {
    const time = A.MakeTime(date);
    const timeMs = date.getTime();
    fadeSurfaces(dtReal);
    // The body we stand on, and while moving away the one we're leaving: both
    // are "ground" close to the camera.
    grounds.clear();
    if (pov) grounds.add(pov.id);
    if (pov?.from?.kind === "sky") grounds.add(pov.from.id);
    if (pov?.from?.ground) grounds.add(pov.from.ground);
    sunMat.uniforms.time.value = realSeconds;
    sunGroup.position.set(0, 0, 0); // the view from a body may have moved it
    orient(bodies.get("sun"), "Sun", time, dtReal);

    for (const def of PLANETS) {
      const b = bodies.get(def.id);
      planetPosition(def, time, b.group.position);
      const axis = orient(b, def.body, time, dtReal);
      pole.set(0, 1, 0).applyQuaternion(b.mesh.quaternion);
      const a = axes[def.id] ?? (axes[def.id] = { pole: new Vector3(), primeMeridian: new Vector3() });
      a.pole.copy(pole);
      a.primeMeridian.set(1, 0, 0).applyQuaternion(b.mesh.quaternion);
      // The same without the slowed-down spin, for real positions (Charon).
      bodyQuaternion(axis.north, axis.spin, trueTurn);
      const t = trueAxes[def.id] ?? (trueAxes[def.id] = { pole: new Vector3(), primeMeridian: new Vector3() });
      t.pole.set(0, 1, 0).applyQuaternion(trueTurn);
      t.primeMeridian.set(1, 0, 0).applyQuaternion(trueTurn);
      if (b.ring) {
        b.material.uniforms.ringNormal.value.copy(pole);
        b.ring.material.uniforms.normal.value.copy(pole);
      }
      if (b.clouds) b.clouds.rotation.y = ((timeMs / DAY_MS) * 0.05) % (2 * Math.PI); // slow drift on the winds
      b.orbit.material.uniforms.planetLon.value = sceneLongitude(b.group.position);
      b.orbit.visible = showOrbits;
    }

    const galilean = A.JupiterMoons(time);
    const msPerFrame = Math.abs(simRate) * Math.max(dtReal, 1 / 60) * 1000;
    for (const def of MOONS) {
      const b = bodies.get(def.id);
      if (!b.group.visible) continue; // left out altogether (the Wallpaper): nothing to move
      moonOffset(def, time, axes, tmp, galilean);
      b.group.position.copy(b.parent.group.position).add(tmp);
      if (def.orbit === "moon") orient(b, "Moon", time, dtReal);
      else lockedQuaternion(tmp.negate(), axes[def.parent].pole, b.mesh.quaternion);

      // Moons that would whizz round in a few frames are just a blur; fade them
      // out (but never the one you're standing on, or just leaving). Eased, so
      // one doesn't pop in or out as you arrive or leave.
      const stepsPerOrbit = (def.periodDays * DAY_MS) / Math.max(msPerFrame, 1);
      const fade = grounds.has(def.id) ? 1 : Math.min(1, Math.max(0, (stepsPerOrbit - 6) / 10));
      b.fade = b.fade === undefined || dtReal === 0 ? fade : b.fade + (fade - b.fade) * Math.min(1, dtReal / 0.3);
      b.material.uniforms.opacity.value = b.fade;
      b.material.transparent = b.fade < 1; // solid moons draw with the solid things, so rings sort right
      b.mesh.visible = b.fade > 0.01;

      // Moon orbits show up when you're close to the planet.
      const near = camera.position.distanceTo(b.parent.group.position) / b.parent.radius;
      const show = Math.min(1, Math.max(0, (32 - near) / 12)) * b.fade;
      b.orbit.material.uniforms.opacity.value = 0.22 * show;
      // In the view from a body they'd be stretched along with their planet;
      // on the way back out they fade in once the planet is its usual size.
      const settled = !pov || (pov.leaving && Math.abs(b.parent.group.scale.x - 1) < 0.05);
      b.orbit.visible = showOrbits && show > 0.01 && settled;
    }

    // At most one orbit resample per frame keeps frames smooth.
    for (const b of bodies.values()) if (b.orbit && (b.kind !== "moon" || b.group.visible) && resampleOrbits(b, timeMs, time)) break;

    for (const b of bodies.values()) (overviews.get(b.id) ?? overviews.set(b.id, new Vector3()).get(b.id)).copy(b.group.position);

    // Real positions. Looking from a body, use the true spin (not the slowed-down
    // one used for drawing fast spins), so Charon is where it really is, and
    // see Jupiter's moons as they were when their light left.
    realPositions(time, axes, galilean, real);
    if (pov) realPositions(time, trueAxes, galilean, seen, pov.id);
    if (pov?.from?.kind === "sky") realPositions(time, trueAxes, galilean, seenBefore, pov.from.id);
    const shownPositions = pov ? seen : real;

    // Each body is lit from the real direction of the Sun, wherever it's drawn,
    // and moons go dark in their planet's shadow.
    for (const def of MOONS) {
      const b = bodies.get(def.id);
      if (!b.group.visible) continue;
      b.material.uniforms.sunlight.value = sunlight(shownPositions.get(def.id), shownPositions.get(def.parent), b.parent.def.radiusKm);
    }
    for (const b of bodies.values()) {
      if (b.kind === "sun") continue;
      const dir = tmp.copy(real.get(b.id)).negate().normalize();
      b.material.uniforms.sunDir.value.copy(dir);
      if (b.halo) b.halo.material.uniforms.sunDir.value.copy(dir);
      if (b.ring) b.ring.material.uniforms.sunDir.value.copy(dir);
      if (b.clouds) b.clouds.material.uniforms.sunDir.value.copy(dir);
    }

    // Looking from a body: lay everything else out again around it. A change
    // of view blends from where things were when it started (pov.from) to
    // where they're going: the overview when leaving, else the body's sky.
    const toSky = pov && !pov.leaving;
    const from = pov?.from ?? null;
    const blend = from ? pov.blend : 1;
    if (pov) skyAnchor.copy(overview(pov.id)).add(pov.camOffset ?? ZERO);
    if (toSky) skyLayout(pov.id, seen, skyAnchor, sky);
    // The sky we're leaving stays centred on its body, which carries on along its orbit.
    if (from?.kind === "sky") skyLayout(from.id, seenBefore, beforeAnchor.copy(overview(from.id)).add(from.offset), skyBefore);
    const target = (b) => {
      if (!toSky || b.id === pov.id) return place(overview(b.id), 1);
      const s = sky.get(b.id);
      return place(s.position, s.radius / b.radius);
    };
    const start = (b) => {
      if (from.kind === "snapshot") {
        const s = from.map.get(b.id);
        return place(s.position, s.scale, _start);
      }
      if (from.kind === "sky" && b.id !== from.id) {
        const s = skyBefore.get(b.id);
        return place(s.position, s.radius / b.radius, _start);
      }
      return place(overview(b.id), 1, _start);
    };
    for (const b of bodies.values()) {
      let scale = 1;
      if (pov) {
        const to = target(b);
        if (from) {
          const a = start(b);
          b.group.position.copy(a.position).lerp(to.position, blend);
          scale = Math.exp(Math.log(a.scale) + (Math.log(to.scale) - Math.log(a.scale)) * blend);
        } else {
          b.group.position.copy(to.position);
          scale = to.scale;
        }
      }
      b.group.scale.setScalar(scale);
      if (b.ring) {
        b.material.uniforms.ringRadii.value.set(SATURN_RINGS.inner, SATURN_RINGS.outer).multiplyScalar(b.radius * scale);
        b.ring.material.uniforms.planetRadius.value = b.radius * scale;
      }
      if (b.kind !== "sun") {
        b.material.uniforms.center.value.copy(b.group.position);
        if (b.halo) b.halo.material.uniforms.center.value.copy(b.group.position);
        if (b.ring) b.ring.material.uniforms.center.value.copy(b.group.position);
      }
    }
    // How much of the overview is on screen (1 = all of it), for orbit lines and the ecliptic.
    const fromOverview = from ? (from.kind === "overview" ? 1 : from.kind === "snapshot" ? from.share : 0) : toSky ? 0 : 1;
    overviewShare = pov ? fromOverview * (1 - blend) + (toSky ? 0 : 1) * blend : 1;
    // The glow round the body you stand on would fill the whole sky once the
    // camera is inside it, so fade it out as the camera gets close.
    for (const b of bodies.values()) {
      if (!b.halo) continue;
      let k = 1;
      if (grounds.has(b.id)) {
        const r = b.radius * b.group.scale.x * b.halo.userData.scale;
        const d = camera.position.distanceTo(b.group.position);
        k = Math.min(1, Math.max(0, (d - r) / (r * 0.15)));
      }
      b.halo.material.uniforms.strength.value = b.halo.userData.strength * k;
      b.halo.visible = k > 0.001;
    }

    // Orbit lines belong to the overview; they fade out in the view from a body.
    for (const b of bodies.values()) {
      if (!b.orbit) continue;
      const u = b.orbit.material.uniforms.opacity;
      if (b.kind === "planet") u.value = 0.5 * overviewShare;
      else u.value *= overviewShare * overviewShare;
      b.orbit.visible &&= u.value > 0.01;
    }

    const mp = markers.geometry.attributes.position;
    const mr = markers.geometry.attributes.radius;
    const ma = markers.geometry.attributes.alpha;
    planetsOnly.forEach((b, i) => {
      mp.setXYZ(i, b.group.position.x, b.group.position.y, b.group.position.z);
      mr.setX(i, b.radius * b.group.scale.x);
      ma.setX(i, toSky && b.id === pov.id ? 0 : 0.9);
    });
    mp.needsUpdate = mr.needsUpdate = ma.needsUpdate = true;
    markerMat.uniforms.viewHeight.value = viewHeight;
  }

  let ground = null;
  /**
   * The body you stand on: swaps in the fine sphere, and moves it (with its
   * clouds, glow and rings) onto layer 1, which is drawn in its own pass so its
   * close-up depth doesn't fight with the far-off sky. null puts things back.
   */
  function setGround(id, alsoFine = null) {
    for (const part of ground?.parts ?? []) {
      part.mesh.geometry = part.geometry;
      part.mesh.layers.set(0);
    }
    if (ground?.ring) ground.ring.layers.set(0);
    ground = null;
    const b = id && bodies.get(id);
    if (!b) return;
    const parts = [b.mesh, b.clouds, b.halo].filter(Boolean).map((mesh) => ({ mesh, geometry: mesh.geometry }));
    for (const part of parts) {
      part.mesh.geometry = (groundSphere ??= new SphereGeometry(1, 384, 192));
      part.mesh.layers.set(1);
    }
    if (b.ring) b.ring.layers.set(1);
    // While hopping away, the body we're leaving keeps its fine sphere too.
    const old = alsoFine && bodies.get(alsoFine);
    for (const mesh of old ? [old.mesh, old.clouds, old.halo].filter(Boolean) : []) {
      parts.push({ mesh, geometry: mesh.geometry });
      mesh.geometry = (groundSphere ??= new SphereGeometry(1, 384, 192));
    }
    ground = { id, parts, ring: b.ring };
  }

  // --- What each surface shows ---
  // A surface is a body's skin, Earth's cloud layer, or Saturn's ring strip. It
  // can have a painted look (made in code, see surfaces.js) and a photo look (a
  // real map, see maps.js). The photo is shown when there is one and real maps
  // are on. A new look fades in over the old one instead of popping in.
  const FADE_SECONDS = 0.8;
  const slots = new Map();
  let photosOn = true;

  const look = (map, extra) => ({ map, extra, textures: [map, extra].filter(Boolean) });

  function slotFor(id) {
    let s = slots.get(id);
    if (!s) {
      const kind = id === "clouds" ? "clouds" : id === "saturn-rings" ? "rings" : "body";
      const owner = bodies.get(kind === "clouds" ? "earth" : kind === "rings" ? "saturn" : id);
      const part = kind === "clouds" ? owner.clouds : kind === "rings" ? owner.ring : owner;
      s = { id, kind, u: part.material.uniforms, planet: owner.material.uniforms, painted: null, photo: null, shown: null, fade: null, afterwards: [] };
      if (kind === "rings") s.painted = s.shown = look(owner.ringPainted); // the strip made in code is on from the start
      slots.set(id, s);
    }
    return s;
  }

  const inUse = (s, textures) => textures.some((t) => s.shown?.textures.includes(t) || s.fade?.look.textures.includes(t));

  /** Runs the things waiting for some textures to be off the screen (to free them), for those that are. */
  function runWhenUnused(s) {
    const waiting = s.afterwards;
    s.afterwards = waiting.filter(({ textures }) => inUse(s, textures));
    for (const w of waiting) if (!s.afterwards.includes(w)) w.fn();
  }

  /** Sets what a surface draws: `l` is the look on show, `over` one fading in on top of it by `mix` (0..1). */
  function setLooks(s, l, over, mix) {
    const { u } = s;
    u.map.value = l?.map ?? null;
    u.mapB.value = over?.map ?? null;
    u.mapMix.value = mix;
    if (s.kind === "rings") {
      // the strip is used twice: by the rings, and for their shadow on the planet
      s.planet.ringMap.value = l?.map ?? null;
      s.planet.ringMapB.value = over?.map ?? null;
      s.planet.ringMix.value = mix;
    } else if (s.kind === "body") {
      u.hasMap.value = l?.map ? 1 : 0;
      u.extraMap.value = l?.extra ?? null;
      u.hasExtra.value = l?.extra ? 1 : 0;
      u.extraMapB.value = over?.extra ?? null;
      u.hasExtraB.value = over?.extra ? 1 : 0;
    } else if (l || over) bodies.get("earth").clouds.visible = true;
  }

  /** Puts a look on a surface at once. */
  function setNow(s, l) {
    setLooks(s, l, null, 0);
    s.shown = l;
    s.fade = null;
    runWhenUnused(s);
  }

  /** Makes a surface show what it should: the photo if there is one and they're on, else the painted look. */
  function refresh(s) {
    const want = (photosOn && s.photo) || s.painted;
    if (want === (s.fade ? s.fade.look : s.shown)) return;
    if (s.fade) setNow(s, s.fade.look); // a fade still going is brought to its end first
    if (want === s.shown) return;
    if (!want) return setNow(s, null);
    setLooks(s, s.shown, want, 0);
    s.fade = { look: want, t: 0 };
  }

  /** Moves the fades on. */
  function fadeSurfaces(dtReal) {
    for (const s of slots.values()) {
      if (!s.fade) continue;
      s.fade.t += dtReal / FADE_SECONDS;
      if (s.fade.t >= 1) setNow(s, s.fade.look);
      else setLooks(s, s.shown, s.fade.look, s.fade.t * s.fade.t * (3 - 2 * s.fade.t));
    }
  }

  /** Puts a freshly painted surface on its body. `images` holds ImageData. */
  function applySurface(job, images) {
    const s = slotFor(job);
    const old = s.painted;
    const map = texture(images.map, job === "clouds");
    s.painted = look(map, images.extra ? texture(images.extra, true) : null);
    refresh(s);
    if (old) s.afterwards.push({ textures: old.textures, fn: () => old.textures.forEach((t) => t.dispose()) }); // free the old one's GPU memory
    runWhenUnused(s);
  }

  /** Shows the textures of a real map (see maps.js) on a surface. They are marked with the layer they come from. */
  function applyPhoto(id, textures) {
    const s = slotFor(id);
    const map = textures.find((t) => t.userData.layer === id) ?? null;
    const extra = textures.find((t) => t.userData.layer === "earth-extra") ?? null;
    s.photo = look(map, extra);
    refresh(s);
  }

  /** Calls `fn` once none of `textures` is on screen (at once if they aren't). */
  function whenUnused(id, textures, fn) {
    const s = slotFor(id);
    s.afterwards.push({ textures, fn });
    runWhenUnused(s);
  }

  /** Real maps on or off. Off, every surface goes back to its painted look. */
  function setPhotosEnabled(on) {
    photosOn = on;
    for (const s of slots.values()) {
      if (!on) s.photo = null; // their textures are freed by whoever made them
      refresh(s);
    }
  }

  return {
    bodies,
    update,
    applySurface,
    applyPhoto,
    whenUnused,
    setPhotosEnabled,
    fitGlow,
    setGround,
    snapshot,
    orbitGroup,
    markers,
    real,
    overviews,
    skyAnchor,
    get overviewShare() {
      return overviewShare;
    },
    /** Is a real map or a painted surface fading in now? (Then the planets should be drawn every frame, so the fade is smooth.) */
    get fading() {
      for (const slot of slots.values()) if (slot.fade) return true;
      return false;
    },
  };
}
