// Elsewhere: the place on the other side of the Gate. Made up, all of it.
//
// You drift down an endless hall of folded light. Every so often a doorway
// comes up out of the dark; pass through and the whole place changes: its
// shape, its colours. There is no end and no way to get lost: Esc flies you
// home.
//
// The picture is drawn on one flat screen-sized shape by a shader. For each
// pixel it finds where the line of sight meets the wall of a long round hall
// (and a thinner veil inside it) and works out what the wall gives off there:
// streaks of light, a glowing grid, rings, pulses running towards you. Each
// place has its own mix of those, its own number of sides and its own colours.
// The doorways are the same Gate you flew up to.
import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { createGateMesh } from "./gate.js";
import * as shaders from "./shaders.js";

const DEG = Math.PI / 180;
const DOOR_GAP = 28; // between doorways, along the way
const SPEED = 1.7; // how fast you drift, units a second
const CALM = 0.35; // and this share of that when slow drift is off
const MORPH = 6; // seconds for a new place to settle in after a door
const DOOR_RING = 1.7; // radius of a doorway
const EXPOSURE = 1.0;
const FOV = 78;

/** A number between 0 and 1 that's the same every time for the same `k` and `n`. */
function rand(k, n) {
  const x = Math.sin(k * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The look of the k-th place: how many sides, which kinds of light, which colours.
 * The first, and every third after it, is a rush of streaks; the second kind is a
 * dark hall with a neon lattice and pulses running down it; the third kind turns.
 */
export function dimensionOf(k) {
  const kind = ((k % 3) + 3) % 3;
  const sides = [5, 6, 7, 8, 10, 12][Math.floor(rand(k, 4) * 6)];
  const mixes = [
    [0.85 + 0.15 * rand(k, 6), 0.1, 0.4 + 0.3 * rand(k, 8), 0.35 + 0.3 * rand(k, 9)],
    [0.12, 1.0, 0.45, 0.9],
    [0.8, 0.0, 0.2 + 0.2 * rand(k, 8), 0.5],
  ];
  return {
    // Steps round the colour wheel by the golden ratio, so no two neighbours look alike.
    hue: (0.62 + k * 0.381966 + 0.06 * rand(k, 5)) % 1,
    sides,
    freq: 5 + 9 * rand(k, 1), // how fine the streaks are, round the hall
    rings: 5 + 9 * rand(k, 2), // how far apart the rings are
    mix: mixes[kind], // streaks, grid, rings, pulses
    twist: kind === 2 ? (rand(k, 10) < 0.5 ? -1 : 1) * (0.07 + 0.08 * rand(k, 11)) : 0,
    glow: kind === 1 ? 1.0 : 0.7 + 0.2 * rand(k, 3),
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** The same palette the shader uses, for colouring the doorways to match. */
export function palette(t, hue) {
  return [0, 1 / 3, 2 / 3].map((d) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + hue + d)));
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 2.0;
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uCam;
  uniform mat3 uRot;
  uniform vec2 uTan;
  uniform float uTime;
  uniform float uMorph;
  uniform vec4 uA0;   // place we're leaving: hue, sides, streak frequency, ring spacing
  uniform vec4 uA1;   // its mix: streaks, grid, rings, pulses
  uniform vec4 uB0;   // and the place we're in
  uniform vec4 uB1;
  uniform vec2 uTw;   // how much the streaks turn along the hall, in each
  uniform float uGlow;
  uniform float uFlash;
  varying vec2 vUv;
  ${shaders.snoise}

  const float WALL = 4.6;
  const float VEIL = 2.5;
  const float TAU = 6.28318;

  vec3 pal(float t, float hue) {
    return 0.5 + 0.5 * cos(TAU * (t + hue + vec3(0.0, 0.3333, 0.6667)));
  }

  // What a bit of wall gives off. h is where the line of sight meets it.
  vec3 wall(vec3 h, vec4 p0, vec4 p1, float tw, float veil) {
    float ang = atan(h.y, h.x);
    float z = h.z;
    float hue = p0.x;
    float turned = ang + z * tw;
    vec2 ring = vec2(cos(turned), sin(turned));
    // Streaks: long along the hall, fine round it.
    float f = p0.z * (veil > 0.5 ? 0.6 : 1.0);
    float n1 = snoise(vec3(ring * f, z * 0.07 + uTime * (veil > 0.5 ? 0.9 : 0.4)));
    float n2 = snoise(vec3(ring * f * 2.3, z * 0.13 - uTime * 0.7));
    float streak = pow(max(0.5 + 0.5 * (n1 * 0.7 + n2 * 0.5), 0.0), 3.2);
    // Grid: glowing lines between the sides of the hall and across it.
    float sides = p0.y;
    float a = ang / TAU * sides;
    float edge = abs(fract(a) - 0.5);
    float across = abs(fract(z / 2.4) - 0.5);
    float grid = smoothstep(0.03, 0.0, 0.5 - edge) + smoothstep(0.03, 0.0, 0.5 - across);
    // Rings round the hall, every so often.
    float rz = z / p0.w;
    float ringBand = pow(max(1.0 - abs(fract(rz) - 0.5) * 2.0, 0.0), 24.0);
    // Pulses: bright bands running towards you.
    float pz = z * 0.06 - uTime * 0.5;
    float pulse = pow(max(sin(pz * TAU + ang * 2.0) * 0.5 + 0.5, 0.0), 10.0);
    vec3 c = pal(0.05 + 0.2 * n1 + z * 0.004, hue) * streak * p1.x * 1.4;
    c += pal(0.45, hue) * grid * p1.y * (0.2 + 1.6 * pulse + 0.5 * streak) * 0.9 * (veil > 0.5 ? 0.5 : 1.0);
    c += pal(0.2, hue) * ringBand * p1.z * 1.6;
    c += pal(0.7, hue) * pulse * (0.25 + streak) * p1.w * 1.3;
    return c;
  }

  // Where a line from ro along rd meets the inside of a tube of radius r round the hall's axis.
  float tubeHit(vec3 ro, vec3 rd, float r) {
    float a = dot(rd.xy, rd.xy);
    float b = dot(ro.xy, rd.xy);
    float c = dot(ro.xy, ro.xy) - r * r;
    if (a < 1e-6) return 400.0;
    return min((-b + sqrt(max(b * b - a * c, 0.0))) / a, 400.0);
  }

  vec3 scene(vec3 ro, vec3 rd, vec4 p0, vec4 p1, float tw) {
    float t = tubeHit(ro, rd, WALL);
    vec3 col = wall(ro + rd * t, p0, p1, tw, 0.0) * exp(-t * 0.028);
    float tv = tubeHit(ro, rd, VEIL);
    col += wall(ro + rd * tv, p0, p1, tw, 1.0) * exp(-tv * 0.05) * 0.6;
    // The far end of the hall: a glow where it all meets.
    float axis = max(-rd.z, 0.0);
    col += pal(0.1, p0.x) * pow(axis, 220.0) * 1.2 + pal(0.55, p0.x) * pow(axis, 40.0) * 0.18;
    return col;
  }

  void main() {
    vec3 rd = normalize(uRot * vec3(vUv.x * uTan.x, vUv.y * uTan.y, -1.0));
    vec3 ro = uCam;
    vec3 col = scene(ro, rd, uB0, uB1, uTw.y);
    if (uMorph < 0.999) col = mix(scene(ro, rd, uA0, uA1, uTw.x), col, uMorph);
    col = pow(max(col, 0.0), vec3(1.12)) * uGlow * (1.0 + uFlash * 2.5);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas  The page's canvas, for dragging to look round.
 */
export function createElsewhere(canvas) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 400);
  const controls = { enabled: false };

  const backdrop = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uCam: { value: new Vector3() },
        uRot: { value: new Matrix3() },
        uTan: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uMorph: { value: 1 },
        uA0: { value: new Vector4() },
        uA1: { value: new Vector4() },
        uB0: { value: new Vector4() },
        uB1: { value: new Vector4() },
        uTw: { value: new Vector2() },
        uGlow: { value: 1 },
        uFlash: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  // Three doorways at a time, each moved on to the front once it's behind you.
  const doors = [0, 1, 2].map(() => {
    const door = createGateMesh({ billboard: false, size: DOOR_RING });
    scene.add(door);
    return door;
  });
  const doorNumber = [0, 1, 2]; // which doorway along the way each one is

  // --- Where we are ---
  const u = backdrop.material.uniforms;
  let z = 0; // how far along
  let dimension = 0; // how many doorways passed
  let since = MORPH; // seconds since the last one
  let speedScale = 1;
  let flash = 0;
  const look = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
  let onDimension = null;

  const pathAt = (zz, out) => out.set(Math.sin(zz * 0.07) * 0.55, Math.cos(zz * 0.05) * 0.45, -zz);
  const here = new Vector3();
  const ahead = new Vector3();
  const rot = new Matrix4();

  function colourDoor(i, k) {
    // A door shows the colours of the place it leads to.
    const next = dimensionOf(k);
    const mesh = doors[i];
    const m = mesh.material.uniforms;
    const rim = palette(0.12, next.hue);
    const deep = palette(0.62, next.hue);
    const light = palette(0.38, next.hue);
    m.uRim.value.set(rim[0], rim[1], rim[2]).multiplyScalar(0.9).addScalar(0.1);
    m.uDeep.value.set(deep[0] * 0.5, deep[1] * 0.5, deep[2] * 0.5);
    m.uLight.value.set(light[0], light[1], light[2]);
  }
  function placeDoor(i, n) {
    doorNumber[i] = n;
    const zz = (n + 1) * DOOR_GAP;
    pathAt(zz, doors[i].position);
    colourDoor(i, n + 1);
  }

  /** Starts a fresh visit: at the beginning of the way, looking down it. */
  function show() {
    z = 0;
    dimension = 0;
    since = MORPH;
    flash = 0;
    look.yaw = look.pitch = look.vyaw = look.vpitch = 0;
    speedScale = 1;
    doors.forEach((_, i) => placeDoor(i, i));
    u.uTime.value = 0;
    applyDimension();
  }

  function applyDimension() {
    const to = dimensionOf(dimension);
    const from = dimensionOf(dimension - 1);
    const m = since >= MORPH ? 1 : 1 - Math.pow(1 - since / MORPH, 3);
    u.uA0.value.set(from.hue, from.sides, from.freq, from.rings);
    u.uA1.value.set(...from.mix);
    u.uB0.value.set(to.hue, to.sides, to.freq, to.rings);
    u.uB1.value.set(...to.mix);
    u.uTw.value.set(from.twist, to.twist);
    u.uMorph.value = m;
    u.uGlow.value = lerp(from.glow, to.glow, m);
  }

  // --- Looking round ---
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (!controls.enabled || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    look.vyaw = look.vpitch = 0;
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    look.yaw -= dx * 0.0042;
    look.pitch = Math.max(-1.35, Math.min(1.35, look.pitch - dy * 0.0042));
    look.vyaw = -dx * 0.0042 * 60;
    look.vpitch = -dy * 0.0042 * 60;
  });
  addEventListener("pointerup", () => (drag = null));
  addEventListener("pointercancel", () => (drag = null));
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!controls.enabled) return;
      speedScale = Math.max(0.25, Math.min(4, speedScale * Math.exp(-e.deltaY * 0.0012)));
      e.preventDefault();
    },
    { passive: false },
  );

  /** Moves things on. `dt` seconds; `drift` lets the view sway a little by itself. */
  function update(dt, now, drift) {
    clockNow = now;
    dt = Math.min(dt, 0.1);
    const before = z;
    // With the slow drift switched off (or the system asking for less motion), keep it calm.
    z += SPEED * speedScale * (drift ? 1 : CALM) * dt;
    since += dt;
    flash = Math.max(0, flash - dt * 1.4);
    // The look keeps turning a little after you let go, then eases to rest.
    if (!drag) {
      look.yaw += look.vyaw * dt;
      look.pitch = Math.max(-1.35, Math.min(1.35, look.pitch + look.vpitch * dt));
      const k = Math.exp(-3 * dt);
      look.vyaw *= k;
      look.vpitch *= k;
    }
    // Through a doorway?
    for (let i = 0; i < doors.length; i++) {
      const dz = (doorNumber[i] + 1) * DOOR_GAP;
      if (before < dz && z >= dz) {
        dimension = doorNumber[i] + 1;
        since = 0;
        flash = 1;
        onDimension?.(dimension);
      }
    }
    // Doors far behind are moved up to the front.
    for (let i = 0; i < doors.length; i++) {
      if ((doorNumber[i] + 1) * DOOR_GAP < z - DOOR_GAP * 0.5) placeDoor(i, Math.max(...doorNumber) + 1);
    }
    applyDimension();

    const sway = drift ? 1 : 0;
    pathAt(z, here);
    pathAt(z + 4, ahead);
    camera.position.copy(here);
    rot.lookAt(here, ahead, new Vector3(0, 1, 0));
    camera.quaternion.setFromRotationMatrix(rot);
    // Yaw about the way's own up, then pitch.
    camera.rotateY(look.yaw + sway * Math.sin(now / 6000) * 0.05);
    camera.rotateX(look.pitch + sway * Math.sin(now / 8000 + 1) * 0.03);
    camera.updateMatrixWorld(true);
    for (const d of doors) {
      d.material.uniforms.uTime.value = now / 1000;
      // Brighter as it comes near, so it seems to rise out of the dark.
      d.material.uniforms.uBright.value = 0.9;
    }
    u.uTime.value = now / 1000;
    u.uFlash.value = flash * flash;
    u.uCam.value.copy(camera.position);
    u.uRot.value.setFromMatrix4(camera.matrixWorld);
  }

  // --- Drawing ---
  // The picture is made smaller than the screen if the graphics chip is struggling, then stretched.
  const hasFloat = (r) => r.extensions.has("EXT_color_buffer_float") || r.extensions.has("EXT_color_buffer_half_float");
  let target = null;
  let screen = null;
  let show_ = null;
  const flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bufferSize = new Vector2();
  let scale = 0.6;
  let slow = 0;
  let fast = 0;
  let lastRender = 0;
  let clockNow = 0;
  let scaleLocked = false;

  function build(renderer) {
    const float = hasFloat(renderer);
    target = new WebGLRenderTarget(2, 2, {
      type: float ? HalfFloatType : UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    screen = new Scene();
    show_ = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        ...shaders.rollOff,
        uniforms: {
          map: { value: target.texture },
          exposure: { value: float ? EXPOSURE : 0.8 },
          bloom: { value: 0 },
          saturation: { value: 1.25 },
          texel: { value: new Vector2(1, 1) },
        },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    show_.frustumCulled = false;
    screen.add(show_);
  }

  function render(renderer, budgetMs = 1000 / 60) {
    if (!target) build(renderer);
    renderer.getDrawingBufferSize(bufferSize);
    if (lastRender && !scaleLocked) {
      const gap = clockNow - lastRender;
      if (gap > budgetMs * 1.6) [slow, fast] = [slow + 1, 0];
      else if (gap < budgetMs * 1.2) [slow, fast] = [Math.max(0, slow - 1), fast + 1];
      if (slow > 6 && scale > 0.3) [scale, slow] = [Math.max(0.3, scale * 0.85), 0];
      if (fast > 240 && scale < 1) [scale, fast] = [Math.min(1, scale * 1.2), 0];
    }
    lastRender = clockNow;
    const w = Math.max(2, Math.round(bufferSize.x * scale));
    const h = Math.max(2, Math.round(bufferSize.y * scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    const tanV = Math.tan((camera.fov * DEG) / 2);
    u.uTan.value.set(tanV * camera.aspect, tanV);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    show_.material.uniforms.texel.value.set(1 / w, 1 / h);
    renderer.render(screen, flat);
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    controls,
    show,
    update,
    render,
    resize,
    info: {
      name: "Elsewhere",
      about: "A made-up place on the other side of the Gate. Nothing here exists: the light, the halls and the doorways are all drawn by the computer. Drag to look round, scroll to go faster or slower, Esc to go home.",
    },
    /** How many doorways you've been through. */
    get dimension() {
      return dimension;
    },
    /** Called with the new number when you go through a doorway. */
    set onDimension(fn) {
      onDimension = fn;
    },
    /** (for testing) keep the picture at full sharpness, and optionally jump along the way. */
    set locked(v) {
      scaleLocked = v;
      if (v) scale = 1;
    },
    jumpTo(zz) {
      z = zz;
      dimension = Math.floor(zz / DOOR_GAP);
      since = MORPH;
      doors.forEach((_, i) => placeDoor(i, dimension + i));
    },
    /** (for testing) let the current place finish settling in. */
    settle() {
      since = MORPH;
    },
  };
}
