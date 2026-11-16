// One picture across all the screens (src/span.js), and pictures for saving drawn in pieces (src/snapshot.js).
import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { parse } from "../src/settings.js";
import { parse as parseWallpaper } from "../src/wallpaper-settings.js";
import { snapshotSize, snapshotTiles } from "../src/snapshot.js";
import { fitSpan, parseSpan, spanTime } from "../src/span.js";

test("a screen's part: read from the address, and nonsense refused", () => {
  assert.deepEqual(parseSpan("1440,0,2560,1440,4000,1440,1795000000000"), { x: 1440, y: 0, w: 2560, h: 1440, W: 4000, H: 1440, epoch: 1795000000000 });
  for (const bad of ["", null, "1,2,3", "0,0,0,100,100,100,5", "50,0,100,100,100,100,5", "a,b,c,d,e,f,g", "0,0,10,10,10,10"]) {
    assert.equal(parseSpan(bad), null, String(bad));
  }
  // Both pages take it as a setting.
  assert.deepEqual(parse("span", "0,0,10,10,20,10,7"), { x: 0, y: 0, w: 10, h: 10, W: 20, H: 10, epoch: 7 });
  assert.equal(parseWallpaper("span", "0,0,10,10,20,10,7").W, 20);
  assert.equal(parse("span", "nonsense"), undefined);
});

test("two screens side by side make one picture: what crosses the edge carries on across it", () => {
  // A 1440 × 900 laptop screen on the left, a 2560 × 1440 screen to its right, their tops lined up.
  const W = 1440 + 2560;
  const H = 1440;
  const left = new PerspectiveCamera(45, 1, 0.1, 1000);
  const right = new PerspectiveCamera(45, 1, 0.1, 1000);
  for (const c of [left, right]) c.position.set(0, 0, 10);
  fitSpan(left, parseSpan(`0,0,1440,900,${W},${H},0`));
  fitSpan(right, parseSpan(`1440,0,2560,1440,${W},${H},0`));
  for (const c of [left, right]) c.updateMatrixWorld();
  assert.equal(left.aspect, W / H);
  // A point straight above the join: on the left screen's right edge and the right screen's left edge, at the same height.
  const whole = new PerspectiveCamera(45, W / H, 0.1, 1000);
  whole.position.set(0, 0, 10);
  whole.updateMatrixWorld();
  const join = new Vector3((2 * 1440) / W - 1, 1 - (2 * 300) / H, 0.5).unproject(whole); // 300 points down from the top
  const a = join.clone().project(left);
  const b = join.clone().project(right);
  assert.ok(Math.abs(a.x - 1) < 1e-6, `left screen: x ${a.x}`);
  assert.ok(Math.abs(b.x + 1) < 1e-6, `right screen: x ${b.x}`);
  // The same number of points down from the top on each (the screens are different heights).
  const down = (p, h) => ((1 - p.y) / 2) * h;
  assert.ok(Math.abs(down(a, 900) - 300) < 1e-6 && Math.abs(down(b, 1440) - 300) < 1e-6);
  // And none: back to the whole view.
  fitSpan(left, null);
  assert.equal(left.view?.enabled ?? false, false);
});

test("every screen's clock counts from the same moment", () => {
  const span = parseSpan("0,0,10,10,20,10,1000000");
  assert.equal(spanTime(span, 1, 1005000), 1005000, "live: just now");
  assert.equal(spanTime(span, 60, 1001000), 1000000 + 60000, "a minute a second");
});

test("a picture for saving: sizes kept sensible, and the pieces cover it exactly once", () => {
  assert.deepEqual(snapshotSize(3840.2, "2160"), { width: 3840, height: 2160 });
  assert.equal(snapshotSize(9000, 100), null);
  assert.equal(snapshotSize(0, 100), null);
  const W = 7680;
  const H = 4320;
  const tiles = snapshotTiles(W, H, 2880, 1800);
  assert.equal(tiles.length, 9);
  const covered = new Uint8Array((W / 10) * (H / 10));
  for (const t of tiles) {
    assert.ok(t.w > 0 && t.h > 0 && t.w <= 2880 && t.h <= 1800);
    for (let y = t.y; y < t.y + t.h; y += 10) for (let x = t.x; x < t.x + t.w; x += 10) covered[(y / 10) * (W / 10) + x / 10]++;
  }
  assert.ok(covered.every((n) => n === 1));
});
