// The Gate: a made-up doorway, and the strangest place in the app.
//
// It is not real. It sits in the direction the 1977 "Wow!" radio signal came
// from, because that's the best-known thing nobody has explained; its distance
// is chosen, not measured. Fly up to it and go through, and you are somewhere
// else (see elsewhere.js).
import { AdditiveBlending, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { snoise } from "./shaders.js";

export const GATE = {
  id: "gate",
  name: "The Gate",
  // Where the "Wow!" signal was heard (J2000), in Sagittarius.
  ra: 291.38,
  dec: -26.95,
  // How far away, in thousands of light-years. Made up.
  kly: 1.0,
  sub: "Made up",
  lightYears: "Distance unknown",
  about: "A made-up doorway, put where the 1977 “Wow!” radio signal came from. Nobody knows what sent it, and nobody knows how far away it was, so the distance here is only a guess. Fly through.",
};

/** Where the gate's colours sit (cold to warm), for the doorway and the place beyond. */
export const GATE_COLOURS = {
  rim: [0.45, 0.75, 1.0],
  deep: [0.22, 0.04, 0.7],
  light: [0.25, 0.9, 1.0],
};

const vertex = /* glsl */ `
  uniform float uSize;     // radius of the ring, in world units
  uniform float uMinPx;    // never drawn smaller than this, in pixels (radius)
  uniform float uViewHeight;
  varying vec2 vUv;
  void main() {
    // The quad reaches twice the ring's radius, to hold the glow round it.
    vUv = position.xy * 2.0;
    #ifdef BILLBOARD
      vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float pxPerUnit = projectionMatrix[1][1] * uViewHeight * 0.5 / max(-c.z, 1e-9);
      float radius = max(uSize, uMinPx / pxPerUnit);
      c.xy += position.xy * 4.0 * radius;
      gl_Position = projectionMatrix * c;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * 4.0 * uSize, 0.0, 1.0);
    #endif
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uRim;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform float uBright;
  uniform float uOpen;     // 0 shut .. 1 open: lets the doorway light up as you arrive
  varying vec2 vUv;
  ${snoise}
  void main() {
    float r = length(vUv);
    if (r >= 1.0) discard;
    float a = atan(vUv.y, vUv.x);
    // The ring is at r = 0.5: a thin bright rim, and a soft light just outside it.
    float rim = exp(-pow((r - 0.5) / 0.014, 2.0));
    float halo = r > 0.5 ? exp(-(r - 0.5) * 16.0) * 0.22 : exp(-(0.5 - r) * 10.0) * 0.1;
    float edge = smoothstep(1.0, 0.6, r);
    // The doorway itself: a tunnel that turns faster towards the middle and goes dark at the edge.
    float inside = smoothstep(0.51, 0.485, r);
    vec2 p = vUv * 2.0;
    float twist = (1.0 - r * 2.0) * 5.0 - uTime * 0.5;
    float c = cos(twist);
    float s = sin(twist);
    vec2 q = mat2(c, -s, s, c) * p;
    float n = snoise(vec3(q * 2.2, uTime * 0.1)) * 0.5 + 0.5;
    float arms = 0.5 + 0.5 * sin(a * 3.0 + log(max(r, 0.02)) * 8.0 - uTime * 1.2);
    float swirl = pow(mix(n, arms, 0.4), 1.6);
    float depth = smoothstep(0.5, 0.0, r);          // 0 at the rim, 1 in the middle
    vec3 tunnel = mix(uDeep, uLight, swirl) * (0.05 + 0.5 * swirl) * (0.25 + 1.4 * depth);
    tunnel += vec3(0.9, 0.12, 0.55) * pow(arms, 4.0) * 0.18 * (0.3 + depth); // a thread of colour that isn't cold
    vec3 col = tunnel * inside * uOpen;
    col += vec3(1.0, 0.95, 1.0) * exp(-r * 18.0) * 1.1 * inside * uOpen;     // the light at the far end
    col += uRim * (rim * 1.6 + halo);
    // Bright beads of light travelling round the rim.
    float ripple = pow(max(0.0, sin(a * 14.0 - uTime * 1.2)), 24.0) * rim * 1.2;
    col += vec3(1.0) * ripple;
    gl_FragColor = vec4(col * edge * uBright, 1.0);
  }
`;

/**
 * A mesh of the doorway. `billboard`: always faces the camera and keeps a
 * minimum size on screen (for the view out among the stars). Otherwise it's a
 * flat disc in its own plane that you can fly through.
 */
export function createGateMesh({ billboard, size, minPx = 7, viewHeight = 1000, colours = GATE_COLOURS }) {
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: billboard ? { BILLBOARD: 1 } : {},
    uniforms: {
      uSize: { value: size },
      uMinPx: { value: minPx },
      uViewHeight: { value: viewHeight },
      uTime: { value: 0 },
      uRim: { value: new Vector3(...colours.rim) },
      uDeep: { value: new Vector3(...colours.deep) },
      uLight: { value: new Vector3(...colours.light) },
      uBright: { value: 1 },
      uOpen: { value: 1 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: !billboard,
    side: DoubleSide,
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
