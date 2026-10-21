import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { pageAddress, scopeAddress, wantsScope, wantsWallpaper } from "../src/modes.js";

const dist = (name) => new URL(`../dist/${name}`, import.meta.url);
const read = (name) => readFileSync(dist(name), "utf8");
const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("old full-app addresses are sent on to Space Scope, with everything after the ?", () => {
  assert.equal(scopeAddress("?view=galaxy-sgra"), "scope.html?view=galaxy-sgra");
  assert.equal(scopeAddress("?speed=day&view=earth&date=2033-05-01"), "scope.html?speed=day&view=earth&date=2033-05-01");
  assert.equal(scopeAddress("?mode=scope"), "scope.html");
  assert.equal(scopeAddress("?mode=scope&view=mars"), "scope.html?view=mars");
  for (const key of ["view", "strange", "reverse", "paused"]) assert.equal(scopeAddress(`?${key}=0`), `scope.html?${key}=0`, key);
});

test("addresses the Wallpaper understands stay on the Wallpaper", () => {
  for (const search of ["", "?", "?wallpaper", "?ui=0", "?wallpaper&ui=0", "?mode=wallpaper", "?something=else"]) assert.equal(scopeAddress(search), null, search);
  for (const key of ["speed", "date", "labels", "orbits", "belts", "clock", "drift", "photos", "fps"]) assert.equal(scopeAddress(`?${key}=0`), null, `${key} is the Wallpaper's too`);
});

test("a wallpaper app's Mode setting is read from a dropdown position or from its name", () => {
  assert.ok(wantsScope(1) && wantsScope("Space Scope (fly anywhere)") && wantsScope("scope"));
  assert.ok(!wantsScope(0) && !wantsScope("Wallpaper (the planets, easy on battery)"));
  assert.ok(wantsWallpaper(0) && wantsWallpaper("Wallpaper (the planets, easy on battery)"));
  assert.ok(!wantsWallpaper(1) && !wantsWallpaper("Space Scope (fly anywhere)"));
});

test("switching pages keeps a hidden menu hidden, and nothing else", () => {
  assert.equal(pageAddress("index.html", ""), "index.html");
  assert.equal(pageAddress("index.html", "?wallpaper&view=mars&speed=day"), "index.html?wallpaper=");
  assert.equal(pageAddress("scope.html", "?ui=0"), "scope.html?ui=0");
  assert.equal(pageAddress("index.html", "?view=galaxy-sgra"), "index.html", "a Space Scope setting never goes back to the Wallpaper (it would bounce straight back)");
});

test("the Wallpaper page loads only its own script, and does nothing by itself that costs battery", () => {
  const html = read("index.html");
  assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="wallpaper.js">']);
  assert.ok(!html.includes("solar.js"));
  assert.ok(!/backdrop-filter|@keyframes|animation:|transition:/.test(html), "no blur, pulse or fade running on top of the picture");
  assert.ok(statSync(dist("wallpaper.js")).size < 1_000_000);
});

test("the Wallpaper is clean of everything that lets you click about", () => {
  const html = read("index.html");
  assert.match(html, /canvas \{[^}]*pointer-events: none/, "the picture ignores the pointer");
  assert.match(html, /\.label \{[^}]*pointer-events: none/, "so do the names");
  assert.ok(!/cursor: pointer/.test(html.replace(/\.chip[^}]*\}|#menu-btn[^}]*\}|\.toggles label[^}]*\}/g, "")), "nothing but the menu looks clickable");
  for (const file of ["wallpaper.js", "wallpaper-labels.js", "wallpaper-camera.js", "wallpaper-settings.js"]) {
    assert.ok(!/pointer(down|up|move|enter|leave|over)|mouse(down|up|move|over)|wheel|touch(start|move|end)|dblclick|contextmenu|Raycaster|OrbitControls/.test(src(file)), `${file} has no pointer code`);
  }
  // The only things listened to on the page are the menu's own controls, Esc, the page being hidden and the window's size.
  const listeners = [...src("wallpaper.js").matchAll(/addEventListener\(\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(listeners)].sort(), ["change", "click", "keydown", "resize", "visibilitychange"]);
});

test("the Wallpaper script leaves out the parts only Space Scope needs", () => {
  const lean = read("wallpaper.js");
  const full = read("solar.js");
  for (const word of ["TRAPPIST", "Elsewhere", "Wow!"]) {
    assert.ok(full.includes(word), `solar.js has ${word}`);
    assert.ok(!lean.includes(word), `wallpaper.js leaves out ${word}`);
  }
  for (const word of ["Sagittarius A*", "Andromeda"]) assert.ok(lean.includes(word), `wallpaper.js keeps ${word} (they are on the sky)`);
});

test("both pages have the Mode chips, and Space Scope has the full script", () => {
  const wallpaper = read("index.html");
  const scope = read("scope.html");
  for (const html of [wallpaper, scope]) {
    assert.ok(html.includes('id="mode-wallpaper"') && html.includes('id="mode-scope"'));
    assert.match(html, /battery/);
  }
  assert.match(wallpaper, /id="mode-wallpaper"[^>]*aria-pressed="true"/);
  assert.match(scope, /id="mode-scope"[^>]*aria-pressed="true"/);
  assert.ok(scope.includes('<script src="solar.js">'));
  assert.match(scope, /<title>Space Scope<\/title>/);
});
