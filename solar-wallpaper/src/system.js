// Builds the Sun, planets, moons and orbit lines, and moves them every frame.
import * as A from "astronomy-engine";
import {
  AdditiveBlending,
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
import { MOONS, PLANETS, SATURN_RINGS, SUN } from "./bodies.js";
import {
  bodyQuaternion,
  displayRadius,
  lockedQuaternion,
  moonOffset,
  moonOrbit,
  planetOrbit,
  planetPosition,
  SCALE,
  sceneLongitude,
} from "./ephemeris.js";
import * as shaders from "./shaders.js";
import { ringStrip } from "./surfaces.js";

const SPIN_CAP = 240; // degrees per real second; faster spins are slowed down so they don't flicker
const YEAR_MS = 365.25 * 86400e3;
const DAY_MS = 86400e3;
const GAS_GIANTS = new Set(["jupiter", "saturn", "uranus", "neptune", "venus"]);

const sphere = new SphereGeometry(1, 96, 48);
const smallSphere = new SphereGeometry(1, 40, 20);

export function texture(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(image, 0, 0);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
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
      baseColor: { value: new Color(def.color ?? "#9a958e") },
      ambient: { value: 0.006 }, // night sides stay almost black
      wrap: { value: GAS_GIANTS.has(def.id) ? 0.12 : 0.02 },
      atmosphere: { value: new Vector4(...atmo) },
      opacity: { value: 1 },
      hasExtra: { value: 0 },
      extraMap: { value: null },
      hasRings: { value: 0 },
      ringNormal: { value: new Vector3() },
      center: { value: new Vector3() },
      ringRadii: { value: new Vector2() },
      ringMap: { value: null },
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
      strength: { value: strength * 0.9 },
      edge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(smallSphere, mat);
  mesh.scale.setScalar(radius * scale);
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
  function fitGlow(cameraDistance) {
    for (const g of glows) g.sprite.scale.setScalar(Math.min(g.size, Math.max(cameraDistance * 0.9, SCALE.sunRadius * 2.5)));
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
          radii: { value: new Vector2(SATURN_RINGS.inner, SATURN_RINGS.outer) },
          center: { value: new Vector3() },
          planetRadius: { value: radius },
          normal: { value: new Vector3() },
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
      material.uniforms.ringRadii.value.set(SATURN_RINGS.inner * radius, SATURN_RINGS.outer * radius);
    }
    if (def.id === "earth") {
      const cloudMat = new ShaderMaterial({
        ...shaders.clouds,
        uniforms: { map: { value: null }, ambient: { value: 0.004 } },
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

  function displaySpin(body, spin, dtReal) {
    if (body.lastSpin === null) {
      body.lastSpin = spin;
      return spin;
    }
    const dW = spin - body.lastSpin;
    body.lastSpin = spin;
    const cap = SPIN_CAP * Math.max(dtReal, 1 / 240);
    if (Math.abs(dW) > cap) body.spinOffset += Math.sign(dW) * cap - dW;
    else body.spinOffset -= Math.sign(body.spinOffset) * Math.min(Math.abs(body.spinOffset), cap - Math.abs(dW));
    body.spinOffset = ((((body.spinOffset + 180) % 360) + 360) % 360) - 180;
    return spin + body.spinOffset;
  }

  function orient(body, bodyName, time, dtReal) {
    const axis = A.RotationAxis(A.Body[bodyName], time);
    bodyQuaternion(axis.north, displaySpin(body, axis.spin, dtReal), body.mesh.quaternion);
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

  const axes = {};

  /**
   * Moves everything to `date`.
   * dtReal: real seconds since the last frame. simRate: simulated ms per real ms.
   */
  function update(date, dtReal, simRate, camera, viewHeight, showOrbits, realSeconds) {
    const time = A.MakeTime(date);
    const timeMs = date.getTime();
    sunMat.uniforms.time.value = realSeconds;
    orient(bodies.get("sun"), "Sun", time, dtReal);

    for (const def of PLANETS) {
      const b = bodies.get(def.id);
      planetPosition(def, time, b.group.position);
      orient(b, def.body, time, dtReal);
      pole.set(0, 1, 0).applyQuaternion(b.mesh.quaternion);
      axes[def.id] = {
        pole: pole.clone(),
        primeMeridian: new Vector3(1, 0, 0).applyQuaternion(b.mesh.quaternion),
      };
      b.material.uniforms.center.value.copy(b.group.position);
      if (b.halo) b.halo.material.uniforms.center.value.copy(b.group.position);
      if (b.ring) {
        b.material.uniforms.ringNormal.value.copy(pole);
        b.ring.material.uniforms.center.value.copy(b.group.position);
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
      moonOffset(def, time, axes, tmp, galilean);
      b.group.position.copy(b.parent.group.position).add(tmp);
      if (def.orbit === "moon") orient(b, "Moon", time, dtReal);
      else lockedQuaternion(tmp.negate(), axes[def.parent].pole, b.mesh.quaternion);

      // Moons that would whizz round in a few frames are just a blur; fade them out.
      const stepsPerOrbit = (def.periodDays * DAY_MS) / Math.max(msPerFrame, 1);
      b.fade = Math.min(1, Math.max(0, (stepsPerOrbit - 6) / 10));
      b.material.uniforms.opacity.value = b.fade;
      b.mesh.visible = b.fade > 0.01;

      // Moon orbits show up when you're close to the planet.
      const near = camera.position.distanceTo(b.parent.group.position) / b.parent.radius;
      const show = Math.min(1, Math.max(0, (32 - near) / 12)) * b.fade;
      b.orbit.material.uniforms.opacity.value = 0.22 * show;
      b.orbit.visible = showOrbits && show > 0.01;
    }

    // At most one orbit resample per frame keeps frames smooth.
    for (const b of bodies.values()) if (b.orbit && resampleOrbits(b, timeMs, time)) break;

    const mp = markers.geometry.attributes.position;
    planetsOnly.forEach((b, i) => mp.setXYZ(i, b.group.position.x, b.group.position.y, b.group.position.z));
    mp.needsUpdate = true;
    markerMat.uniforms.viewHeight.value = viewHeight;
  }

  /** Puts a freshly painted surface on its body. `images` holds ImageData. */
  function applySurface(job, images) {
    if (job === "clouds") {
      const earth = bodies.get("earth");
      earth.clouds.material.uniforms.map.value = texture(images.map);
      earth.clouds.visible = true;
      return;
    }
    const b = bodies.get(job);
    b.material.uniforms.map.value = texture(images.map);
    b.material.uniforms.hasMap.value = 1;
    if (images.extra) {
      b.material.uniforms.extraMap.value = texture(images.extra);
      b.material.uniforms.hasExtra.value = 1;
    }
  }

  return { bodies, update, applySurface, fitGlow, orbitGroup, markers };
}
