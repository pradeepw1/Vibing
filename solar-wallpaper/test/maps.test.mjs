// Checks the real maps in dist/maps/ are all there and match their list, and the "photos" setting.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MOONS, PLANETS } from "../src/bodies.js";
import { DEFAULTS, parse } from "../src/settings.js";

const dir = new URL("../dist/maps/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

/** The picture a map script holds, as bytes. */
function pictureOf(name) {
  const text = readFileSync(new URL(`${name}.js`, dir), "utf8");
  const m = text.match(/\["([^"]+)"\] = "data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)";\s*$/);
  assert.ok(m, `${name}.js is a map script`);
  assert.equal(m[1], name, `${name}.js names itself`);
  return { mime: m[2], bytes: Buffer.from(m[3], "base64") };
}

test("every body except the Sun has a lite map", () => {
  for (const b of [...PLANETS, ...MOONS]) {
    if (b.id === "earth") continue; // Earth has its own: earth, earth-extra and clouds
    assert.ok(manifest[b.id]?.lite, `${b.id} has a lite map`);
  }
  for (const layer of ["earth", "earth-extra", "clouds", "saturn-rings"]) assert.ok(manifest[layer]?.lite, `${layer} has a lite map`);
});

test("every map in the list is a file of the listed size and kind", () => {
  for (const [layer, sizes] of Object.entries(manifest)) {
    for (const [tier, info] of Object.entries(sizes)) {
      const name = `${layer}.${tier}`;
      assert.ok(existsSync(new URL(`${name}.js`, dir)), `${name}.js exists`);
      const { mime, bytes } = pictureOf(name);
      assert.equal(bytes.length, info.bytes, `${name} is ${info.bytes} bytes`);
      if (mime === "image/webp") {
        assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF");
        assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP");
      } else assert.equal(mime, "image/jpeg");
    }
  }
});

test("a sharp map is bigger than its lite one", () => {
  for (const [layer, sizes] of Object.entries(manifest)) if (sizes.sharp) assert.ok(sizes.sharp.width > sizes.lite.width, `${layer}: sharp is wider`);
});

test("the photos setting is on unless switched off", () => {
  assert.equal(DEFAULTS.photos, true);
  assert.equal(parse("photos", "0"), false);
  assert.equal(parse("photos", "1"), true);
});
