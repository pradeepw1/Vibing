import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { pageAddress, scopeAddress, wantsScope, wantsWallpaper } from "../src/modes.js";

const dist = (name) => new URL(`../dist/${name}`, import.meta.url);
const read = (name) => readFileSync(dist(name), "utf8");

test("old full-app addresses are sent on to Space Scope, with everything after the ?", () => {
  assert.equal(scopeAddress("?view=galaxy-sgra"), "scope.html?view=galaxy-sgra");
  assert.equal(scopeAddress("?speed=day&view=earth&date=2033-05-01"), "scope.html?speed=day&view=earth&date=2033-05-01");
  assert.equal(scopeAddress("?mode=scope"), "scope.html");
  assert.equal(scopeAddress("?mode=scope&view=mars"), "scope.html?view=mars");
  for (const key of ["speed", "date", "reverse", "paused", "labels", "orbits", "belts", "clock", "drift", "strange", "photos", "fps"]) assert.equal(scopeAddress(`?${key}=0`), `scope.html?${key}=0`, key);
});

test("the plain wallpaper addresses stay on the wallpaper", () => {
  for (const search of ["", "?", "?wallpaper", "?ui=0", "?wallpaper&ui=0", "?mode=wallpaper", "?something=else"]) assert.equal(scopeAddress(search), null, search);
});

test("a wallpaper app's Mode setting is read from a dropdown position or from its name", () => {
  assert.ok(wantsScope(1) && wantsScope("Space Scope (everything)") && wantsScope("scope"));
  assert.ok(!wantsScope(0) && !wantsScope("Wallpaper (a still picture, lowest battery)"));
  assert.ok(wantsWallpaper(0) && wantsWallpaper("Wallpaper (a still picture, lowest battery)"));
  assert.ok(!wantsWallpaper(1) && !wantsWallpaper("Space Scope (everything)"));
});

test("the Wallpaper page is a still picture: no canvas, no 3D script, only its small menu script", () => {
  const html = read("index.html");
  assert.ok(!/<canvas/i.test(html));
  const scripts = [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(scripts, ['<script src="wallpaper.js">']);
  assert.ok(!html.includes("solar.js"));
  assert.ok(!/requestAnimationFrame|setInterval|@keyframes|animation:/.test(html + read("wallpaper.js")), "nothing that keeps running");
  assert.ok(statSync(dist("wallpaper.js")).size < 10_000, "a few KB of script");
});

test("the pictures the Wallpaper page uses are there, and light", () => {
  const html = read("index.html");
  for (const name of ["milkyway.webp", "milkyway-tall.webp"]) {
    assert.ok(html.includes(`url("${name}")`), `${name} is used`);
    const size = statSync(dist(name)).size;
    assert.ok(size > 100_000 && size < 1_500_000, `${name} is ${size} bytes`);
  }
});

test("both pages have the Mode chips, and Space Scope has the full script", () => {
  const wallpaper = read("index.html");
  const scope = read("scope.html");
  for (const html of [wallpaper, scope]) {
    assert.ok(html.includes('id="mode-wallpaper"') && html.includes('id="mode-scope"'));
    assert.match(html, /almost no battery/);
  }
  assert.match(wallpaper, /id="mode-wallpaper"[^>]*aria-pressed="true"/);
  assert.match(scope, /id="mode-scope"[^>]*aria-pressed="true"/);
  assert.ok(scope.includes('<script src="solar.js">'));
  assert.match(scope, /<title>Space Scope<\/title>/);
});

test("switching pages keeps a hidden menu hidden, and nothing else", () => {
  assert.equal(pageAddress("index.html", ""), "index.html");
  assert.equal(pageAddress("index.html", "?wallpaper&view=mars&speed=day"), "index.html?wallpaper=");
  assert.equal(pageAddress("scope.html", "?ui=0"), "scope.html?ui=0");
  assert.equal(pageAddress("index.html", "?view=galaxy-sgra"), "index.html", "a Space Scope setting never goes back to the Wallpaper (it would bounce straight back)");
});

// Runs wallpaper.js against a stand-in page, to see what it does.
function openWallpaper(search) {
  const calls = { replace: [], assign: [] };
  const element = () => ({ hidden: false, checked: true, addEventListener() {}, setAttribute() {} });
  const ctx = {
    location: { search, replace: (u) => calls.replace.push(u), assign: (u) => calls.assign.push(u) },
    document: { querySelector: element, body: { classList: { toggle() {} } } },
    addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams,
  };
  ctx.window = ctx;
  vm.runInNewContext(read("wallpaper.js"), ctx);
  return { ctx, calls };
}

test("wallpaper.js forwards old addresses and does nothing else in that case", () => {
  const { ctx, calls } = openWallpaper("?view=galaxy-gate");
  assert.deepEqual(calls.replace, ["scope.html?view=galaxy-gate"]);
  assert.equal(ctx.livelyPropertyListener, undefined, "no menu set up on a page that is leaving");
});

test("wallpaper.js on a plain address sets up the menu, and a wallpaper app can switch it to Space Scope", () => {
  const { ctx, calls } = openWallpaper("");
  assert.deepEqual(calls.replace, []);
  ctx.livelyPropertyListener("speed", 3);
  ctx.livelyPropertyListener("mode", 0);
  assert.deepEqual(calls.assign, [], "other settings and the Wallpaper choice change nothing");
  ctx.livelyPropertyListener("mode", 1);
  assert.deepEqual(calls.assign, ["scope.html"]);
  ctx.wallpaperPropertyListener.applyUserProperties({ mode: { value: "Space Scope (everything)" } });
  assert.equal(calls.assign.length, 2);
});

test("wallpaper.js with the menu hidden goes to Space Scope with it still hidden", () => {
  const { ctx, calls } = openWallpaper("?wallpaper");
  ctx.livelyPropertyListener("mode", 1);
  assert.deepEqual(calls.assign, ["scope.html?wallpaper="]);
});
