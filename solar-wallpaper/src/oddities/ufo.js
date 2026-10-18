// Three unidentified craft. All of it is made up, and the app says so.
//
// Each one is a slow scene of about a minute: it arrives, there is a long still
// moment, it notices the camera, it does the one thing that is wrong, and it
// leaves without a trace. Nothing is bright or quick until it has to be. Most
// of the fear is in the waiting and in how exactly regular everything is.
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import { clamp } from "../noise.js";

const DEG = Math.PI / 180;

/** 0 before a, 1 after b, a straight line between. */
const ramp = (t, a, b) => clamp((t - a) / (b - a));
/** Eases a 0..1 number in and out. */
const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);

// The light on all three is the same: cold, a little green, never warm.
const GLSL_COMMON = /* glsl */ `
  const vec3 COLD = vec3(0.55, 0.9, 0.95);
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
`;
const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** A number that chases a target and overshoots a little, like something that is aiming. */
function spring(w = 1.6, z = 0.55) {
  return {
    x: 0,
    v: 0,
    reset() {
      this.x = this.v = 0;
    },
    step(target, dt) {
      const n = Math.ceil(dt / 0.02);
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (w * w * (target - this.x) - 2 * z * w * this.v) * h;
        this.x += this.v * h;
      }
      return this.x;
    },
  };
}

// None of the three is further out than this from the camera, so none can run
// into the star sphere (900 out) however far from the Sun the camera is.
const MAX_REACH = 380;

const IDENTITY = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);
const origin = new Vector3(); // the middle of a sighting's holder, which is where it rests

/**
 * The camera, and where a sighting sits in relation to it, all in the
 * sighting's own units (one unit is about the size of the thing), which the
 * stage's scale doesn't touch.
 *
 * A sighting is far off, like a star: its holder is carried along with the
 * camera's movement, so it doesn't slide past the stars when the camera moves.
 * The wallpaper's camera is always turning, slowly, and a minute is long enough
 * for that to carry a sighting off the side of the screen, so the sighting keeps
 * a `frame`, a view of its own, which goes along with the camera's turning
 * (all of it when the sighting asks, follow(1), and none of it, follow(0)).
 * hold() notes where a point sits in that frame and release() puts it back.
 * gate() says how much to follow if nothing special is going on: all of it
 * while the camera drifts slowly, none while someone is swinging it round by hand.
 */
function createEye(group, holder) {
  const inverse = new Matrix4();
  const axes = new Matrix4();
  const world = new Vector3();
  const start = new Vector3(); // the camera when the sighting began, in the group's space
  const home = new Vector3();
  const seen = new Quaternion(); // the camera's turn now, and the last time
  const lastSeen = new Quaternion();
  const turned = new Quaternion(); // how far it has turned since
  const share = new Quaternion();
  const frameInverse = new Quaternion();
  const eye = {
    pos: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    back: new Vector3(),
    frame: new Quaternion(),
    // The same axes for the frame: where the sighting's right, up and back are.
    fRight: new Vector3(1, 0, 0),
    fUp: new Vector3(0, 1, 0),
    fBack: new Vector3(0, 0, 1),
    rate: 0, // how fast the camera is turning, degrees a second, smoothed
    /**
     * Sizes the holder so that a thing one unit across looks `angle` degrees wide
     * from the camera, whatever scale the stage chose, and pulls everything in
     * towards the camera if it would reach further than `reach` camera-distances.
     * Returns how far the camera is, in units.
     */
    fit(ctx, angle, reach) {
      ctx.camera.getWorldPosition(world);
      const dist = world.distanceTo(ctx.anchor);
      const k = Math.min(1, MAX_REACH / (reach * dist));
      group.updateWorldMatrix(true, false);
      start.copy(group.worldToLocal(world));
      home.copy(start).multiplyScalar(1 - k);
      holder.position.copy(home);
      holder.scale.setScalar((k * 2 * dist * Math.tan((angle * DEG) / 2)) / ctx.scale);
      return 0.5 / Math.tan((angle * DEG) / 2);
    },
    /** Once a frame, with the seconds since the last one. */
    update(camera, dt) {
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      group.updateWorldMatrix(true, false);
      holder.position.copy(home).add(group.worldToLocal(world.set(e[12], e[13], e[14]))).sub(start);
      holder.updateWorldMatrix(true, false);
      inverse.copy(holder.matrixWorld).invert();
      eye.pos.set(e[12], e[13], e[14]).applyMatrix4(inverse);
      eye.right.set(e[0], e[1], e[2]).transformDirection(inverse);
      eye.up.set(e[4], e[5], e[6]).transformDirection(inverse);
      eye.back.set(e[8], e[9], e[10]).transformDirection(inverse);
      seen.setFromRotationMatrix(axes.makeBasis(eye.right, eye.up, eye.back));
      if (dt > 0) {
        turned.copy(seen).multiply(lastSeen.invert());
        const angle = 2 * Math.acos(Math.min(1, Math.abs(turned.w)));
        eye.rate += (angle / DEG / dt - eye.rate) * Math.min(1, dt / 0.4);
      } else {
        turned.identity();
      }
      lastSeen.copy(seen);
      eye.follow(0);
    },
    /** Starts the frame off as the camera's view, as it is now. */
    reset() {
      eye.frame.copy(seen);
      eye.rate = 0;
      eye.follow(0);
    },
    /** How much of the camera's turning to go along with just now: all of it while it drifts, none while it is swung round. */
    gate() {
      return 1 - ease(ramp(eye.rate, 2.5, 7));
    },
    /** Turns the frame with the camera by this much of what it turned since the last frame, 0 to 1. */
    follow(amount) {
      share.copy(IDENTITY).slerp(turned, amount);
      eye.frame.premultiply(share).normalize();
      eye.fRight.set(1, 0, 0).applyQuaternion(eye.frame);
      eye.fUp.set(0, 1, 0).applyQuaternion(eye.frame);
      eye.fBack.set(0, 0, 1).applyQuaternion(eye.frame);
    },
    /** Where a point sits in the frame. */
    hold(p, out = new Vector3()) {
      return out.copy(p).sub(eye.pos).applyQuaternion(frameInverse.copy(eye.frame).invert());
    },
    /** The point that sits there now. */
    release(h, out = new Vector3()) {
      return out.copy(h).applyQuaternion(eye.frame).add(eye.pos);
    },
    /** A direction in the frame's terms, and back again. */
    holdDirection(d, out = new Vector3()) {
      return out.copy(d).applyQuaternion(frameInverse.copy(eye.frame).invert());
    },
    releaseDirection(h, out = new Vector3()) {
      return out.copy(h).applyQuaternion(eye.frame);
    },
  };
  return eye;
}

/** How wide a thing can be and still fit the view: a tall narrow screen shows less width than a wide one. `shape` is its height over its width. */
function fitAngle(camera, angle, shape = 1) {
  const v = camera.fov * DEG;
  const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  return Math.min(angle, (0.75 * Math.min(h, v / shape)) / DEG);
}

/** Half the width of the view, one unit-distance out. */
function halfView(camera) {
  return Math.tan((camera.fov * DEG) / 2) * camera.aspect;
}

/** Turns `axis` (a unit vector) into a rotation that keeps `up` as near to the top as it can. */
const basis = new Matrix4();
const bx = new Vector3();
const bz = new Vector3();
function faceTo(quaternion, axis, up) {
  bx.copy(up).addScaledVector(axis, -up.dot(axis)).normalize();
  bz.crossVectors(bx, axis);
  quaternion.setFromRotationMatrix(basis.makeBasis(bx, axis, bz));
}

// --- 1. The Count -----------------------------------------------------------------
// A ring far bigger than anything we build, black against the stars. At first
// it is only the stars it hides. Then, one at a time and exactly as far apart,
// the seams between its plates light up, as though it were counting. It turns
// to face the camera, the lights stop all at once, and the inside of the ring
// fills in with dark from the rim to the middle, until one small light is left.

const SEAMS = 36;
const R_OUT = 0.5;
const R_IN = 0.33;
const HALF_THICK = 0.014;
const CORNER = 0.012;

/** The ring: a flat band with its corners cut, turned round the axis. */
function ringGeometry() {
  const profile = [
    [R_IN + CORNER, -HALF_THICK], [R_OUT - CORNER, -HALF_THICK], [R_OUT, -HALF_THICK + CORNER], [R_OUT, HALF_THICK - CORNER],
    [R_OUT - CORNER, HALF_THICK], [R_IN + CORNER, HALF_THICK], [R_IN, HALF_THICK - CORNER], [R_IN, -HALF_THICK + CORNER],
  ];
  const steps = SEAMS * 8;
  const position = [];
  const normal = [];
  const face = [];
  const around = [];
  const index = [];
  for (let f = 0; f < profile.length; f++) {
    const [r0, y0] = profile[f];
    const [r1, y1] = profile[(f + 1) % profile.length];
    const len = Math.hypot(r1 - r0, y1 - y0);
    const nr = (y1 - y0) / len;
    const ny = -(r1 - r0) / len;
    const first = position.length / 3;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const r = k ? r1 : r0;
        position.push(r * c, k ? y1 : y0, r * s);
        normal.push(nr * c, ny, nr * s);
        face.push(f % 2, k); // a flat face (0) or a cut corner (1), and how far along it
        around.push(i / steps);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = first + i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setAttribute("face", new Float32BufferAttribute(face, 2));
  g.setAttribute("around", new Float32BufferAttribute(around, 1));
  g.setIndex(index);
  return g;
}

const ringShader = {
  vertexShader: /* glsl */ `
    attribute vec2 face;
    attribute float around;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vFace;
    varying float vAround;
    void main() {
      vFace = face;
      vAround = around;
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;      // seconds since the first seam
    uniform float uGap;       // seconds between seams
    uniform float uFirst;     // the seam that lights first
    uniform float uLights;    // 1, or 0 once the lights have been cut
    uniform float uWake;      // how many of the seams are lit, 0..1
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vFace;
    varying float vAround;
    const float SEAMS = ${SEAMS}.0;
    ${GLSL_COMMON}
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      float x = vAround * SEAMS;
      // The plates are almost black, and not quite the same as each other.
      vec3 col = vec3(0.0006, 0.0009, 0.0012) * (0.7 + 0.6 * hash(floor(x)));
      // Only the edges catch any light: the cut corners as a fine outline, which
      // brightens a little as the seams come on.
      col += COLD * pow(1.0 - abs(dot(N, V)), 4.0) * 0.01;
      col += COLD * vFace.x * (0.012 + 0.05 * uWake * uLights);

      // The seam nearest here, and how long ago it came on.
      float k = floor(x + 0.5);
      float order = mod(k - uFirst + SEAMS, SEAMS);
      float age = uTime - order * uGap;
      float level = smoothstep(0.0, 0.1, age) * (1.0 + 1.5 * exp(-max(age, 0.0) * 3.0)) * uLights;
      // A slit in a flat face; the cut corners only leak a little.
      level *= vFace.x < 0.5 ? 1.0 : 0.35;
      float along = smoothstep(0.0, 0.2, vFace.y) * smoothstep(1.0, 0.8, vFace.y);
      float d = abs(x - k);
      float w = max(0.012, fwidth(x) * 1.0); // never thinner than a pixel
      float line = smoothstep(w, 0.0, d) * (0.012 / w);
      float wash = exp(-d * d * 40.0) * 0.03;
      col += COLD * (line * (0.3 + 0.7 * along) + wash * along) * level * 1.1;
      gl_FragColor = vec4(col, 1.0);
      ${OUTPUT}
    }
  `,
};

// The dark that fills the hole. Everything inside `uClose` is still open.
const holeShader = {
  vertexShader: /* glsl */ `
    varying vec2 vPlane;
    void main() {
      vPlane = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uClose;   // the dark has come in to this radius
    uniform float uHair;    // a faint line of light on the edge of the dark
    uniform float uDot;     // the one light left in the middle
    uniform float uDotSize; // how big it is: it shrinks less than the ring does
    varying vec2 vPlane;
    ${GLSL_COMMON}
    void main() {
      float r = length(vPlane);
      if (r < uClose) discard;
      vec3 col = vec3(0.0006, 0.0009, 0.0012);
      col += COLD * smoothstep(0.004, 0.0, r - uClose) * uHair * 0.4;
      float rd = r / uDotSize;
      float core = exp(-rd * rd / (2.0 * 0.0045 * 0.0045));
      float glow = exp(-rd * rd / (2.0 * 0.025 * 0.025)) * 0.1;
      vec3 light = COLD * (core * 2.2 + glow);
      light = mix(light, vec3(1.0), smoothstep(1.0, 2.2, core * 2.2) * 0.8);
      col += light * uDot;
      gl_FragColor = vec4(col, 1.0);
      ${OUTPUT}
    }
  `,
};

const COUNT_TIMES = {
  enter: 20, // the ring slides in from the edge and stops
  seams: 21, // the first seam lights
  gap: 0.55, // seconds between seams
  turn: 49, // it starts to turn towards the camera
  turned: 57, // and has finished turning
  cut: 58.2, // every light goes out at once
  close: 60.5, // the dark starts to fill the hole...
  closed: 68.5, // ...and has filled it
  dot: 69, // the one light comes on
  leave: 74, // it goes, quickly
  gone: 79,
};

export function createCount() {
  const T = COUNT_TIMES;
  const ANGLE = 28;
  const REACH = 1.6; // the furthest it gets from the camera, in camera-distances
  const group = new Group();
  group.visible = false;
  const holder = new Group(); // one unit here is the ring's width
  group.add(holder);
  const craft = new Group(); // the ring and its hole, moved and turned as one
  holder.add(craft);

  const ringMat = new ShaderMaterial({ ...ringShader, uniforms: { uTime: { value: -1 }, uGap: { value: T.gap }, uFirst: { value: 0 }, uLights: { value: 1 }, uWake: { value: 0 } } });
  const ring = new Mesh(ringGeometry(), ringMat);
  const holeMat = new ShaderMaterial({
    ...holeShader,
    uniforms: { uClose: { value: 1 }, uHair: { value: 0 }, uDot: { value: 0 }, uDotSize: { value: 1 } },
    side: DoubleSide,
  });
  const hole = new Mesh(new CircleGeometry(R_IN * 1.002, 96).rotateX(-Math.PI / 2), holeMat);
  ring.frustumCulled = hole.frustumCulled = false;
  craft.add(ring, hole);

  const eye = createEye(group, holder);
  const aim = spring(1.5, 0.6);
  let t = 0;
  let started = false;
  const spot = new Vector3(); // where, in the frame, the ring comes to rest
  const place = new Vector3(); // and where that is now
  const pos = new Vector3();
  const slantTo = new Vector3();
  const normal = new Vector3();
  const toEye = new Vector3();
  const tilt = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const away = new Vector3();
  let startX = 0;
  let roll = 0;

  const sighting = {
    id: "count",
    name: "The Count",
    about: "A black ring far bigger than any ship, seen mostly by the stars it hides, whose seams light one by one as it turns to face you.",
    group,
    angle: ANGLE,
    seconds: 79,
    start(ctx) {
      const rand = ctx.random;
      eye.fit(ctx, fitAngle(ctx.camera, ANGLE), REACH);
      eye.update(ctx.camera, 0);
      eye.reset();
      eye.hold(origin, spot);
      const side = rand() < 0.5 ? -1 : 1;
      const dist = eye.pos.length();
      startX = side * (dist * halfView(ctx.camera) + Math.abs(spot.x) + R_OUT * 1.05);
      roll = (rand() - 0.5) * 0.9;
      ringMat.uniforms.uFirst.value = Math.floor(rand() * SEAMS);
      ringMat.uniforms.uLights.value = 1;
      ringMat.uniforms.uTime.value = -1;
      ringMat.uniforms.uWake.value = 0;
      holeMat.uniforms.uClose.value = R_IN * 1.01;
      holeMat.uniforms.uHair.value = 0;
      holeMat.uniforms.uDot.value = 0;
      holeMat.uniforms.uDotSize.value = 1;
      aim.reset();
      t = 0;
      started = true;
      group.visible = true;
      sighting.update(0, ctx);
    },
    update(dt, ctx) {
      if (!started) return false;
      t += Math.min(dt, 0.25);
      eye.update(ctx.camera, dt);
      // It goes along with the camera while that drifts, so it can't wander off the screen.
      // From the moment it turns it goes along with every movement.
      eye.follow(Math.max(eye.gate(), ease(ramp(t, T.turn - 2, T.turn + 2))));
      eye.release(spot, place);
      away.copy(place).sub(eye.pos).normalize(); // from the camera to the ring
      right.copy(eye.fRight).addScaledVector(away, -eye.fRight.dot(away)).normalize();
      up.crossVectors(right, away);

      // In from the side, slowing to a stop.
      const u = ramp(t, 0, T.enter);
      const slide = 1 - (1 - u) * (1 - u);
      pos.copy(place).addScaledVector(eye.fRight, startX * (1 - slide)).addScaledVector(up, 0.03).addScaledVector(away, 0.3 * (1 - slide));
      // Seen slantwise, and turning very slowly.
      const slant = (66 + 4 * Math.sin(t * 0.17)) * DEG;
      const turn = roll + 0.012 * t;
      tilt.copy(right).multiplyScalar(Math.cos(turn)).addScaledVector(up, Math.sin(turn));
      slantTo.copy(away).multiplyScalar(-Math.cos(slant)).addScaledVector(tilt, Math.sin(slant)).normalize();

      // And it turns to look straight at us, settling a little too far and coming back.
      const g = aim.step(ease(ramp(t, T.turn, T.turned)), dt);
      toEye.copy(eye.pos).sub(pos).normalize();
      normal.copy(slantTo).multiplyScalar(1 - g).addScaledVector(toEye, g).normalize();
      faceTo(craft.quaternion, normal, eye.up);
      craft.position.copy(pos);

      // The seams, then the dark.
      ringMat.uniforms.uTime.value = t - T.seams;
      ringMat.uniforms.uWake.value = ramp(t - T.seams, 0, SEAMS * T.gap);
      ringMat.uniforms.uLights.value = t < T.cut ? 1 : 0;
      const fill = ease(ramp(t, T.close, T.closed));
      holeMat.uniforms.uClose.value = R_IN * 1.01 * (1 - fill);
      holeMat.uniforms.uHair.value = t > T.close && t < T.closed + 1 ? 1 : 0;
      holeMat.uniforms.uDot.value = ramp(t, T.dot, T.dot + 0.5);

      // It leaves by going away in a straight line, faster and faster.
      const go = ramp(t, T.leave, T.gone);
      const shrink = 1 / (1 + 240 * go * go * go);
      craft.scale.setScalar(shrink);
      holeMat.uniforms.uDotSize.value = Math.max(1, 0.35 / shrink); // the light stays a pinprick after the ring is too small to see
      holeMat.uniforms.uDot.value *= 1 - ramp(go, 0.93, 1);
      if (t >= T.gone) {
        group.visible = false;
        started = false;
        return false;
      }
      return true;
    },
    dispose() {
      ring.geometry.dispose();
      hole.geometry.dispose();
      ringMat.dispose();
      holeMat.dispose();
    },
  };
  return sighting;
}

// --- 2. The Assembly -----------------------------------------------------------------
// Eighty-nine small cold lights, drifting across the sky in a lattice that
// is a little too even to be a flock. Each is a flat lamp that shines only
// straight out of its face, so while they drift edge-on they are thin dim
// dashes. They all stop in the same instant, with no slowing down. A long
// silence. Then every one of them turns to face the camera at once, and the
// dashes are round white lights: a field of them, looking at you. They hold
// still while you move, spread a little wider round you, and go out together,
// all but the one in the middle, which goes out last.

/**
 * A flat slab of points in a perfect triangular lattice, dealt out over three
 * layers so that each one's neighbours are all in the other two layers. Seen
 * square on, the layers add up to one exact grid. Seen from the side they don't.
 */
function latticePoints() {
  const points = [];
  const step = 0.075;
  for (let j = -6; j <= 6; j++) {
    for (let i = -9; i <= 9; i++) {
      const x = (i + (j & 1 ? 0.5 : 0)) * step;
      const y = j * step * 0.866;
      if ((x / 0.5) ** 2 + (y / 0.28) ** 2 > 1) continue;
      const q = i - (j - (j & 1)) / 2;
      const layer = (((q - j) % 3) + 3) % 3;
      points.push([x, y, (layer - 1) * 0.07]);
    }
  }
  return points;
}

const lampShader = {
  vertexShader: /* glsl */ `
    attribute vec3 spot;      // where the lamp is
    attribute vec3 aim;       // which way its face points; how long this is says how big it is, 1 being usual
    attribute float level;    // switched on, 0..1
    uniform float uSize;
    varying vec2 vC;
    varying float vFace;
    varying float vLevel;
    const float EXTENT = 2.6; // the square runs past the lamp, for its faint glow
    void main() {
      float grow = length(aim);
      vec3 n = aim / grow;
      vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 b = cross(n, t);
      vec3 p = spot + (t * position.x + b * position.y) * uSize * grow * EXTENT;
      vec3 world = (modelMatrix * vec4(p, 1.0)).xyz;
      vFace = dot(normalize(mat3(modelMatrix) * n), normalize(cameraPosition - world));
      vC = position.xy * EXTENT;
      vLevel = level;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vC;
    varying float vFace;
    varying float vLevel;
    ${GLSL_COMMON}
    void main() {
      float r = length(vC);                 // 1 is the lamp's edge
      float f = abs(vFace);                 // 1 facing us, 0 side-on
      float body = 1.0 - smoothstep(0.9, 1.0, r);
      // The face shines in a narrow beam, so it only shows when it points at us.
      float beam = pow(f, 6.0);
      // A lens: brighter at the rim than in the middle.
      float face = 0.6 + 0.6 * smoothstep(0.3, 0.9, r);
      // Turned away, you only see its edge, faint.
      float edge = 0.55 * smoothstep(0.65, 0.95, r);
      float halo = r > 1.0 ? exp(-pow((r - 1.0) * 1.7, 2.0)) * 0.1 * beam : 0.0;
      float light = (body * (beam * face * 1.3 + edge) + halo) * vLevel;
      vec3 col = COLD * light;
      col = mix(col, vec3(light), smoothstep(1.0, 1.8, light) * 0.6);
      gl_FragColor = vec4(col, 1.0);
      ${OUTPUT}
    }
  `,
};

const ASSEMBLY_TIMES = {
  stop: 38, // they all stop, dead
  notice: 45, // and all turn to face the camera
  spread: 50, // they begin to open out round you
  cut: 58, // they go out, all but one
  last: 61.5, // and that one goes out
  gone: 63,
};

export function createAssembly() {
  const T = ASSEMBLY_TIMES;
  const ANGLE = 36;
  const REACH = 1.4;
  const spots = latticePoints();
  const count = spots.length;
  const group = new Group();
  group.visible = false;
  const holder = new Group();
  group.add(holder);

  // One square for every lamp; where each is and which way it faces is set every frame.
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const spot = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const aim = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const level = new InstancedBufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute("spot", spot);
  geometry.setAttribute("aim", aim);
  geometry.setAttribute("level", level);
  geometry.instanceCount = count;
  const material = new ShaderMaterial({
    ...lampShader,
    uniforms: { uSize: { value: 0.0085 } },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const lamps = new Mesh(geometry, material);
  lamps.frustumCulled = false;
  holder.add(lamps);

  // The one in the middle, which lasts longest.
  let middle = 0;
  spots.forEach((p, i) => {
    if (Math.hypot(p[0], p[1]) + Math.abs(p[2]) < Math.hypot(spots[middle][0], spots[middle][1]) + Math.abs(spots[middle][2])) middle = i;
  });

  // Each lamp wobbles a little, differently, at first; the wobble dies away as they settle into the lattice.
  const wobble = new Float32Array(count * 6);

  const eye = createEye(group, holder);
  const resting = new Vector3(); // where, in the frame, the lattice comes to rest
  const place = new Vector3(); // and where that is now
  const right = new Vector3();
  const up = new Vector3();
  const away = new Vector3();
  const travel = new Vector3();
  const centre = new Vector3();
  const p = new Vector3();
  const n = new Vector3();
  const toEye = new Vector3();
  const idle = new Vector3();
  let side = 1;
  let startX = 0;
  let t = 0;
  let started = false;

  const sighting = {
    id: "assembly",
    name: "The Assembly",
    about: "Eighty-nine cold lights crossing the sky in a lattice too exact to be a flock, which stop together and all turn to look at you.",
    group,
    angle: ANGLE,
    seconds: 63,
    start(ctx) {
      const rand = ctx.random;
      eye.fit(ctx, fitAngle(ctx.camera, ANGLE, 0.56), REACH);
      eye.update(ctx.camera, 0);
      eye.reset();
      eye.hold(origin, resting);
      side = rand() < 0.5 ? -1 : 1;
      const dist = eye.pos.length();
      startX = side * (dist * halfView(ctx.camera) + Math.abs(resting.x) + 0.55);
      for (let i = 0; i < wobble.length; i++) wobble[i] = rand();
      t = 0;
      started = true;
      group.visible = true;
      sighting.update(0, ctx);
    },
    update(dt, ctx) {
      if (!started) return false;
      t += Math.min(dt, 0.25);
      eye.update(ctx.camera, dt);
      // It goes along with the camera while that drifts, so it can't wander off the screen.
      // From the moment they stop, it goes along with every movement, whatever the camera does.
      eye.follow(Math.max(eye.gate(), ease(ramp(t, T.stop - 1, T.stop + 1))));
      eye.release(resting, place);
      away.copy(place).sub(eye.pos).normalize(); // from the camera to the lattice
      right.copy(eye.fRight).addScaledVector(away, -eye.fRight.dot(away)).normalize();
      up.crossVectors(right, away);
      travel.copy(right).multiplyScalar(-side); // the way they go

      // The whole lattice crosses the view at one steady speed and then, with no slowing, stops.
      const run = Math.min(t, T.stop) / T.stop;
      centre.copy(place).addScaledVector(eye.fRight, startX * (1 - run)).addScaledVector(up, 0.04 * Math.sin(Math.min(t, T.stop) * 0.35));

      const settle = 1 - ramp(Math.min(t, T.stop), 4, T.stop - 3); // how loose the formation still is
      const wobbleSize = 0.02 * settle + 0.0006;
      const yaw = (22 * (1 - ease(run))) * DEG; // the slab turns square to us as it comes to rest
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const clock = Math.min(t, T.stop);
      const turned = ease(ramp(t, T.notice, T.notice + 0.4));
      const open = ramp(t, T.spread, T.cut);
      const spread = 1 + 1.4 * open * open;
      material.uniforms.uSize.value = 0.0085 * (1 + 0.6 * open * open);
      const cutting = t >= T.cut;
      const arriving = ramp(t, 0, 2.5);

      for (let i = 0; i < count; i++) {
        const s = spots[i];
        const w = i * 6;
        // The slab: its own axes are right, up and away; turned about the up axis.
        const x = s[0] * spread;
        const y = s[1] * spread;
        const z = s[2] * spread;
        const jx = Math.sin(clock * (0.3 + 0.6 * wobble[w]) + 6.283 * wobble[w + 3]) * wobbleSize;
        const jy = Math.sin(clock * (0.3 + 0.6 * wobble[w + 1]) + 6.283 * wobble[w + 4]) * wobbleSize;
        const jz = Math.sin(clock * (0.3 + 0.6 * wobble[w + 2]) + 6.283 * wobble[w + 5]) * wobbleSize;
        const rx = (x + jx) * cy + (z + jz) * sy;
        const rz = -(x + jx) * sy + (z + jz) * cy;
        // The depth goes along each lamp's own line of sight, so that the three layers still add up
        // to one exact grid when the lattice is off to one side, instead of coming apart in pairs.
        p.copy(centre).addScaledVector(right, rx).addScaledVector(up, y + jy).sub(eye.pos);
        p.multiplyScalar(1 + rz / p.length()).add(eye.pos);
        spot.setXYZ(i, p.x, p.y, p.z);

        // Side-on to us, face forward in the way they are going; then square on to us.
        const tipTo = (12 + 6 * (s[0] / 0.5)) * DEG;
        idle.copy(travel).multiplyScalar(Math.cos(tipTo)).addScaledVector(away, -Math.sin(tipTo));
        toEye.copy(eye.pos).sub(p).normalize();
        n.copy(idle).multiplyScalar(1 - turned).addScaledVector(toEye, turned).normalize();
        // The last one slowly gets bigger, as if it were coming closer.
        const nearer = i === middle ? 1 + 0.9 * ease(ramp(t, T.cut, T.last)) : 1;
        aim.setXYZ(i, n.x * nearer, n.y * nearer, n.z * nearer);

        level.setX(i, (cutting ? (i === middle && t < T.last ? 1 : 0) : 1) * arriving);
      }
      spot.needsUpdate = aim.needsUpdate = level.needsUpdate = true;

      if (t >= T.gone) {
        group.visible = false;
        started = false;
        return false;
      }
      return true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return sighting;
}

// --- 3. The Needle -----------------------------------------------------------------
// A shaft so long and thin that it crosses the whole sky as a line you can only
// just see, and see best by what runs along it: every few seconds, exactly, a
// short pulse of light. Very slowly it swings round. Its near end is a horn,
// and as that comes round to point straight at the camera the shaft is seen
// end-on: a bore, with its rings running away to a point. The pulses stop.
// Where the next one should be, the bore lights up instead, ring after ring,
// coming towards you, until it is lit all the way to its mouth. Then it is dark.

/** The shaft as a thin shell along +z: a horn at the near end (z = 0), then a long thin tube. */
function needleGeometry(length, radius, mouth, flare) {
  const steps = [];
  for (let i = 0; i <= 48; i++) steps.push((i / 48) * flare);
  for (let i = 1; i <= 14; i++) steps.push(flare * Math.pow(length / flare, i / 14));
  const radial = 28;
  const position = [];
  const normal = [];
  const index = [];
  for (const z of steps) {
    const horn = Math.pow(Math.max(0, 1 - z / flare), 3);
    const r = radius + (mouth - radius) * horn;
    for (let a = 0; a <= radial; a++) {
      const th = (a / radial) * 2 * Math.PI;
      position.push(r * Math.cos(th), r * Math.sin(th), z);
      normal.push(Math.cos(th), Math.sin(th), 0);
    }
  }
  for (let i = 0; i < steps.length - 1; i++) {
    for (let a = 0; a < radial; a++) {
      const k = i * (radial + 1) + a;
      index.push(k, k + 1, k + radial + 1, k + 1, k + radial + 2, k + radial + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

/** A flat strip along the axis, turned by the vertex shader to face the camera. Carries the soft glow round the pulses. */
function needleGlowGeometry(length) {
  const position = [];
  const index = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const s = length * Math.pow(i / n, 3); // close together near the horn, where the view changes fastest
    position.push(0, 0, s, 1, 0, s);
  }
  for (let i = 0; i < n; i++) {
    const k = i * 2;
    index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3)); // x is which side of the axis (0 or 1)
  g.setIndex(index);
  return g;
}

// How the light travels. A pulse leaves the far end and runs to the near end,
// and the shaft stays faintly lit behind it for a few seconds.
const PULSES = /* glsl */ `
  uniform vec3 uAges;     // seconds since each of the last three pulses left the far end (below 0: none)
  uniform float uSpeed;   // how fast a pulse runs, units a second
  uniform float uLength;
  uniform float uWidth;   // how long a pulse is
  vec2 pulseAt(float s) {
    vec2 sum = vec2(0.0);  // x: the bright head, y: the glow left behind
    for (int i = 0; i < 3; i++) {
      float age = uAges[i];
      if (age < 0.0) continue;
      float d = s - (uLength - uSpeed * age);   // above 0: the pulse has gone by
      sum.x += exp(-d * d / (uWidth * uWidth));
      float behind = smoothstep(-uWidth, uWidth * 2.0, d);
      sum.y += behind * (exp(-d / (uWidth * 26.0)) * 0.5 + 0.35) * exp(-age / 2.2);
    }
    return sum;
  }
`;

const needleShader = {
  vertexShader: /* glsl */ `
    varying float vS;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vS = position.z;
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uRib;     // distance between rings
    uniform float uFlare;   // how long the horn is
    uniform float uFront;   // the rings are lit from the far end down to here
    uniform float uLight;   // overall, 0 to 1
    varying float vS;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    ${GLSL_COMMON}
    ${PULSES}
    void main() {
      float s = vS;
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      bool inside = !gl_FrontFacing;
      vec3 col = vec3(0.0004, 0.0006, 0.0009);

      vec2 pulse = pulseAt(s);

      // Rings round the bore. They are always there, very faint; light runs along them.
      float cell = s / uRib;
      float dr = min(fract(cell), 1.0 - fract(cell));
      float blur = smoothstep(0.12, 0.45, fwidth(cell));   // too fine to tell apart
      float ring = mix(smoothstep(0.12, 0.0, dr), 0.08, blur);
      float behind = smoothstep(uFront, uFront + uWidth * 0.5, s);
      float bore = smoothstep(uFlare * 0.85, uFlare * 1.15, s);   // the long thin part, which glows right down its length
      // Inside, light shows up on the rings; outside, it just lights the shaft.
      float onRings = inside ? 0.04 + 0.96 * ring : 1.0;
      float lit = pulse.x * (inside ? 0.15 + 0.85 * ring : 1.0) + pulse.y * onRings * 0.5;
      if (inside) {
        lit += 0.03 * ring;
        lit += behind * (ring * 0.9 + bore * 0.5 + 0.015);
        lit += behind * exp(-s * s / (uRib * uRib * 0.4)) * 1.2; // the lip of the mouth
      }

      // The edges and the inside of the bore take the light; the middle of the outside barely does.
      float rim = pow(1.0 - abs(dot(N, V)), 2.0);
      float surface = inside ? 1.0 : 0.2 + 0.8 * rim;
      col += COLD * lit * surface * 1.3 * uLight;
      gl_FragColor = vec4(col, 1.0);
      ${OUTPUT}
    }
  `,
};

const needleGlowShader = {
  vertexShader: /* glsl */ `
    uniform vec3 uCam;      // the camera, in the shaft's own space
    uniform float uHalf;    // how wide the glow runs either side of the axis
    varying float vSide;
    varying float vS;
    varying float vFade;
    void main() {
      vec3 p = vec3(0.0, 0.0, position.z);
      vec3 across = cross(vec3(0.0, 0.0, 1.0), normalize(uCam - p));
      float len = length(across);
      across = len > 1e-4 ? across / len : vec3(1.0, 0.0, 0.0);
      float side = position.x * 2.0 - 1.0;
      vFade = smoothstep(0.03, 0.3, len); // seen end-on there is nothing to spread
      vSide = side;
      vS = position.z;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p + across * side * uHalf, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uLight;
    varying float vSide;
    varying float vS;
    varying float vFade;
    ${GLSL_COMMON}
    ${PULSES}
    void main() {
      vec2 pulse = pulseAt(vS);
      float soft = exp(-vSide * vSide * 5.0);
      float light = (pulse.x * 1.1 + pulse.y * 0.22) * soft * soft * vFade * uLight;
      vec3 col = COLD * light;
      col = mix(col, vec3(light), smoothstep(0.8, 1.6, light) * 0.6);
      gl_FragColor = vec4(col, 1.0);
      ${OUTPUT}
    }
  `,
};

const NEEDLE_TIMES = {
  first: 2.5, // the first pulse
  every: 4.4, // and then, to the hundredth of a second, one every this long
  lastPulse: 60, // none after this
  aligned: 58, // it points at the camera
  charge: 64.1, // where the next pulse should be, the rings light up
  hold: 73.8, // lit to the mouth
  cut: 77.2, // dark
  leave: 79.5, // it goes away down its own length
  gone: 82,
};

export function createNeedle() {
  const T = NEEDLE_TIMES;
  const ANGLE = 70;
  const REACH = 7.6;
  const D = 0.5 / Math.tan((ANGLE * DEG) / 2); // how far away the camera is, in this one's units
  const LENGTH = 6 * D;
  const NEAR = 0.2 * D; // how close the mouth comes to the camera
  const PIVOT = 1.5 * D; // the shaft swings about a point this far from the camera...
  const ARM = PIVOT - NEAR; // ...and this far from its mouth
  const RIB = 0.02 * D;
  const FLARE = 0.4 * D; // how long the horn is
  const SPEED = LENGTH / 1.8;
  const SIDE_ON = 88; // degrees from pointing at us, at the start

  const group = new Group();
  group.visible = false;
  const holder = new Group();
  group.add(holder);
  const ages = new Vector3(-1, -1, -1);
  const shared = {
    uAges: { value: ages },
    uSpeed: { value: SPEED },
    uLength: { value: LENGTH },
    uWidth: { value: 0.02 * D },
    uLight: { value: 1 },
  };
  const material = new ShaderMaterial({
    ...needleShader,
    uniforms: { ...shared, uRib: { value: RIB }, uFlare: { value: FLARE }, uFront: { value: LENGTH * 2 } },
    side: DoubleSide,
  });
  const camInShaft = new Vector3();
  const glowMaterial = new ShaderMaterial({
    ...needleGlowShader,
    uniforms: { ...shared, uCam: { value: camInShaft }, uHalf: { value: 0.032 * D } },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: DoubleSide,
  });
  const body = new Mesh(needleGeometry(LENGTH, 0.0045 * D, 0.03 * D, FLARE), material);
  const glow = new Mesh(needleGlowGeometry(LENGTH), glowMaterial);
  const shaft = new Group(); // runs along its own +z, starting at the mouth
  body.frustumCulled = glow.frustumCulled = false;
  shaft.add(body, glow);
  holder.add(shaft);

  const eye = createEye(group, holder);
  const swing = spring(2.2, 0.5);
  const pivotAt = new Vector3(); // the point it swings about, and the way it swings, in the frame
  const sideAt = new Vector3();
  const pivot = new Vector3();
  const away = new Vector3();
  const side = new Vector3();
  const dir = new Vector3();
  const near = new Vector3();
  const inverse = new Matrix4();
  let t = 0;
  let started = false;

  const sighting = {
    id: "needle",
    name: "The Needle",
    about: "A shaft hundreds of times longer than it is wide, seen by the pulse of light that runs along it every few seconds, swinging slowly round until it points at you.",
    group,
    angle: ANGLE,
    seconds: 82,
    start(ctx) {
      const rand = ctx.random;
      eye.fit(ctx, ANGLE, REACH);
      eye.update(ctx.camera, 0);
      eye.reset();
      away.copy(eye.pos).negate().normalize();
      const flip = rand() < 0.5 ? -1 : 1;
      const roll = (0.2 + 0.3 * rand()) * flip;
      side.copy(eye.right).multiplyScalar(Math.cos(roll) * flip).addScaledVector(eye.up, Math.sin(roll)).normalize();
      eye.hold(pivot.copy(eye.pos).addScaledVector(away, PIVOT), pivotAt);
      eye.holdDirection(side, sideAt);
      swing.reset();
      swing.x = SIDE_ON * DEG;
      t = 0;
      started = true;
      group.visible = true;
      sighting.update(0, ctx);
    },
    update(dt, ctx) {
      if (!started) return false;
      t += Math.min(dt, 0.25);
      eye.update(ctx.camera, dt);

      // How far round it is: 90 degrees is side-on, 0 is pointing at us. It starts so slowly you can't tell.
      const after = Math.max(0, t - T.aligned);
      const landing = 0.45 * Math.exp(-1.1 * after) * Math.sin(2 * Math.PI * 0.7 * after); // lands a little off, then corrects
      const psi = swing.step((SIDE_ON * (1 - ease(ramp(t, 0, T.aligned))) + landing) * DEG, dt);

      // It goes along with the camera while that drifts, so it can't wander off the screen,
      // and with every movement once it is nearly pointing at us.
      eye.follow(Math.max(eye.gate(), 1 - ease(ramp(Math.abs(psi) / DEG, 3, 24))));
      eye.release(pivotAt, pivot);
      away.copy(pivot).sub(eye.pos).normalize();
      eye.releaseDirection(sideAt, side);
      dir.copy(away).multiplyScalar(Math.cos(psi)).addScaledVector(side, Math.sin(psi)).normalize();
      near.copy(pivot).addScaledVector(dir, -ARM);

      // At the end it goes away down its own length, faster and faster.
      const go = ramp(t, T.leave, T.gone);
      near.addScaledVector(dir, 5.8 * D * go * go * go);
      shaft.position.copy(near);
      shaft.quaternion.setFromUnitVectors(Z_AXIS, dir);
      shaft.updateMatrix();
      camInShaft.copy(eye.pos).applyMatrix4(inverse.copy(shaft.matrix).invert());

      // Pulses, then the rings.
      ages.set(-1, -1, -1);
      const newest = Math.min(Math.floor((t - T.first) / T.every), Math.floor((T.lastPulse - T.first) / T.every));
      for (let k = 0; k < 3; k++) {
        if (newest - k < 0) break;
        const age = t - (T.first + (newest - k) * T.every);
        if (age > 0) ages.setComponent(k, age);
      }
      // The rings light from the far end towards us, quickly while they are too small to see, then at a steady rate
      // for the camera's distance, so their size on the screen grows evenly.
      const quick = ramp(t, T.charge, T.charge + 1.4);
      const steady = ramp(t, T.charge + 1.4, T.hold);
      const farthest = LENGTH + NEAR;
      const handover = 1.4 * D;
      let reach = farthest * 2;
      if (t >= T.charge) {
        reach = Math.exp(Math.log(farthest) + (Math.log(handover) - Math.log(farthest)) * ease(quick));
        if (quick >= 1) reach = Math.exp(Math.log(handover) + (Math.log(NEAR * 0.97) - Math.log(handover)) * steady);
      }
      material.uniforms.uFront.value = reach - NEAR; // as a distance along the shaft from its mouth
      shared.uLight.value = t < T.cut ? 1 : 0;

      if (t >= T.gone) {
        group.visible = false;
        started = false;
        return false;
      }
      return true;
    },
    dispose() {
      body.geometry.dispose();
      glow.geometry.dispose();
      material.dispose();
      glowMaterial.dispose();
    },
  };
  return sighting;
}

export const SIGHTINGS = [createCount, createAssembly, createNeedle];
