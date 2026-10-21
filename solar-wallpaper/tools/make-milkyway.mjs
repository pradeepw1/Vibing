// Makes the two pictures the Wallpaper page shows: dist/milkyway.webp (wide) and
// dist/milkyway-tall.webp (for a screen held upright).
//
// It opens Space Scope in a browser, hides everything except the Milky Way and the
// stars behind it, puts the camera above the disc and takes a picture at 4K. The
// stars are the app's own, so the picture matches what Space Scope draws.
//
//   node tools/make-milkyway.mjs [outDir]       (outDir defaults to dist)
//
// Needs Playwright with Chromium (`npm i -g playwright`) and Python with Pillow
// (to save as WebP). Neither is part of the app; only this tool uses them. It takes
// a few minutes with software graphics. It prints where the Sun lands on each
// picture; those numbers are in dist/index.html (the `.sun` boxes).
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "dist"));
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "milkyway-"));

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const where of [undefined, join(process.execPath, "../../lib/node_modules")]) {
    try {
      return require(where ? join(where, "playwright") : "playwright");
    } catch {
      // try the next place
    }
  }
  throw new Error("Playwright isn't installed: npm i -g playwright");
}
const { chromium } = loadPlaywright();

// [name, width, height, how far above the disc (thousand light-years)]. Picked by eye.
const SHOTS = [
  ["milkyway", 1920, 1080, 108],
  ["milkyway-tall", 1080, 1920, 160],
];
const FOV = 38;
const PILLOW_SAVE = "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'WEBP', quality=86, method=6)";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const [name, width, height, height_kly] of SHOTS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
    const address = pathToFileURL(join(root, "dist/scope.html"));
    address.search = "?fps=30&drift=0&ui=0&labels=0&orbits=0&belts=0&clock=0&view=galaxy-m31&date=2026-10-14T19:00Z";
    await page.goto(address.href);
    await page.waitForSelector("#loading.done", { timeout: 300000 });
    await page.waitForTimeout(2500);
    await page.evaluate(([up_kly, fov]) => {
      const lg = window.solarSystem.lg;
      for (const child of lg.scene.children) child.visible = child.name === "milkyway" || child.name === "background";
      const place = lg.places.get("milkyway");
      const up = place.up.clone().normalize();
      const side = new up.constructor(1, 0, 0).cross(up).normalize();
      lg.camera.fov = fov;
      lg.camera.updateProjectionMatrix();
      lg.controls.target.copy(place.position);
      // straight above the disc, nudged sideways so the spiral isn't seen perfectly flat-on
      lg.camera.position.copy(place.position).addScaledVector(up, up_kly).addScaledVector(side, up_kly * 0.36);
      lg.camera.up.set(0, 1, 0);
      lg.controls.update();
      document.querySelectorAll("#labels, #caption, #hint, #menu-btn, #clock, #pov, .label").forEach((e) => (e.style.display = "none"));
    }, [height_kly, FOV]);
    await page.waitForTimeout(5000);
    // Where the Sun (the app's origin) lands, as a share of the picture's width and height.
    const sun = await page.evaluate(() => {
      const lg = window.solarSystem.lg;
      const v = new lg.camera.position.constructor(0, 0, 0).project(lg.camera);
      return { left: ((v.x + 1) / 2) * 100, top: ((1 - v.y) / 2) * 100 };
    });
    console.log(`${name}: Sun at left ${sun.left.toFixed(1)}%, top ${sun.top.toFixed(1)}%`);
    await page.screenshot({ path: join(work, `${name}.png`) });
    await context.close();
  }
} finally {
  await browser.close();
}

for (const [name] of SHOTS) {
  const r = spawnSync(
    "python3",
    ["-I", "-c", PILLOW_SAVE, join(work, `${name}.png`), join(outDir, `${name}.webp`)],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`Saving ${name}.webp failed (is Pillow installed?): ${r.stderr}`);
  console.log(`wrote ${join(outDir, `${name}.webp`)}`);
}
rmSync(work, { recursive: true, force: true });
