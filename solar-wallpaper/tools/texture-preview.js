// Dev tool: paints every surface map flat on one page, with timings, so you
// can tweak src/surfaces.js without waiting for the 3D scene.
//   npm run textures   then open tools/textures.html
import { finish, paint, paintClouds, paintMilkyWay, ringStrip } from "../src/surfaces.js";

const ids = ["earth", "moon", "mars", "jupiter", "saturn", "venus", "mercury", "uranus", "neptune", "pluto",
  "io", "europa", "ganymede", "callisto", "titan", "iapetus", "triton", "charon", "rhea"];

const run = finish;

function show(name, image, ms) {
  let canvas = image;
  if (image instanceof ImageData) {
    canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(image, 0, 0);
  }
  const fig = document.createElement("figure");
  fig.innerHTML = `<figcaption>${name} · ${canvas.width}×${canvas.height} · ${ms.toFixed(0)} ms</figcaption>`;
  canvas.style.width = canvas.width >= 1024 ? "100%" : "50%";
  fig.append(canvas);
  document.body.append(fig);
}

const only = new URLSearchParams(location.search).get("only");
let total = 0;
for (const id of only ? only.split(",").filter((i) => i !== "milkyway") : ids) {
  const t0 = performance.now();
  const out = run(paint(id));
  const ms = performance.now() - t0;
  total += ms;
  show(id, out.map, ms);
  if (out.extra) show(`${id} (lights in red, water in green)`, out.extra, 0);
  if (id === "earth") {
    const t1 = performance.now();
    const clouds = run(paintClouds());
    const cm = performance.now() - t1;
    total += cm;
    show("earth clouds", clouds, cm);
  }
}
if (!only || only.includes("milkyway")) {
  const t2 = performance.now();
  const mw = run(paintMilkyWay());
  const mm = performance.now() - t2;
  total += mm;
  show("milky way (galactic coordinates, centre in the middle)", mw, mm);
}
const strip = ringStrip();
const c = document.createElement("canvas");
c.width = strip.width;
c.height = 40;
const g = c.getContext("2d");
g.fillStyle = "#333";
g.fillRect(0, 0, c.width, 40);
for (let y = 0; y < 40; y++) g.putImageData(strip, 0, y);
show("saturn rings", c, 0);
document.title = `done ${total.toFixed(0)} ms`;
console.log(`total ${total.toFixed(0)} ms`);
