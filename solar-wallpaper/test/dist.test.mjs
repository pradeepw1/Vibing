// The built files in dist/ are what ships, and what the wallpaper apps load. Make them again from src/
// (in memory) and check the committed ones are the same, so a change to src/ is never left unbuilt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeBundles } from "../tools/bundles.mjs";

test("dist/solar.js, dist/wallpaper.js and dist/LivelyProperties.json are up to date with src/ (run npm run build)", async () => {
  const made = await makeBundles();
  for (const [path, text] of Object.entries(made)) {
    const committed = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.equal(committed === text, true, `${path} is out of date: run npm run build`);
  }
});

test("Lively's settings: the frame rate is one setting for each page, and every name is one the pages read", () => {
  const lively = JSON.parse(readFileSync(new URL("../dist/LivelyProperties.json", import.meta.url), "utf8"));
  assert.equal(lively.fps.value, 30, "Space Scope's own");
  assert.equal(lively.wallpaperFps.value, 20, "the Wallpaper's own, low on purpose");
  assert.equal(lively.mode.items.length, 2);
  assert.match(lively.mode.items[0], /^Wallpaper/);
  assert.match(lively.mode.items[1], /^Space Scope/);
  for (const [name, p] of Object.entries(lively)) {
    assert.ok(["dropdown", "checkbox", "slider", "label"].includes(p.type), `${name} has a known type`);
    if (p.type === "slider") assert.ok(p.value >= p.min && p.value <= p.max, `${name}'s default is on its slider`);
    if (p.type === "dropdown") assert.ok(p.value >= 0 && p.value < p.items.length, `${name}'s default is in its list`);
  }
});

test("each bundle's banner names only what is inside it", () => {
  const wallpaper = readFileSync(new URL("../dist/wallpaper.js", import.meta.url), "utf8").slice(0, 1200);
  const scope = readFileSync(new URL("../dist/solar.js", import.meta.url), "utf8").slice(0, 1200);
  assert.ok(scope.includes("Open Exoplanet Catalogue"));
  assert.ok(!wallpaper.includes("Open Exoplanet Catalogue"));
});
