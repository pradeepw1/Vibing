// Live space weather (src/spaceweather.js): reading NOAA's sunspots, aurora and Kp, and putting them in place.
import assert from "node:assert/strict";
import test from "node:test";
import * as A from "astronomy-engine";
import { Object3D, Quaternion, Vector3 } from "three";
import { bodyQuaternion, eqjToScene } from "../src/ephemeris.js";
import { createSpaceWeather, kpWords, readAurora, readKp, readRegions, spotUniforms } from "../src/spaceweather.js";

// From NOAA's list for 15 November 2026, the Sun's central meridian was at Carrington longitude 48 (each group's
// Carrington longitude plus its longitude from the middle of the disc came to 48).
const group = (o) => ({ observed_date: "2026-11-15", region: 4600, latitude: 3, longitude: 0, carrington_longitude: 48, area: 200, number_spots: 5, extent: 6, ...o });

test("a sunspot group NOAA saw in the middle of the disc is on the side of our Sun facing Earth", () => {
  const got = readRegions([group(), group({ region: 4601, area: 0, number_spots: 0 }), { ...group({ region: 4590 }), observed_date: "2026-11-14" }]);
  assert.equal(got.groups, 1, "the latest day only, and only groups with spots");
  assert.equal(got.at, Date.parse("2026-11-16T00:00:00Z"), "as they were at the end of that day");
  assert.equal(got.spots.length, 5, "the main spot and four more along the group");
  const when = new Date(got.at);
  const axis = A.RotationAxis(A.Body.Sun, when);
  const turn = bodyQuaternion(axis.north, axis.spin, new Quaternion());
  const e = A.HelioVector(A.Body.Earth, when);
  const toEarth = eqjToScene(e.x, e.y, e.z).normalize();
  const off = (got.spots[0].dir.clone().applyQuaternion(turn).angleTo(toEarth) * 180) / Math.PI;
  assert.ok(off < 1.5, `${off.toFixed(2)} degrees from the middle of the disc as seen from Earth`);
  // 200 millionths of the visible half: about a degree and a half across, with its edge.
  assert.ok(got.spots[0].radius > 0.02 && got.spots[0].radius < 0.03);
  assert.ok(got.spots.slice(1).every((s) => s.radius < got.spots[0].radius && s.dir.angleTo(got.spots[0].dir) < 0.1));
  assert.equal(readRegions([]), null);
  assert.equal(readRegions("nonsense"), null);
});

test("the aurora forecast, the Kp index and what it means", () => {
  const a = readAurora({ "Forecast Time": "2026-11-16T09:25:00Z", coordinates: [[10, 65, 80], [359, -70, 12], [0, 999, 50]] });
  assert.equal(a.data[(65 + 90) * 360 + 10], 204);
  assert.equal(a.data[(-70 + 90) * 360 + 359], 31);
  assert.equal(a.peak, 80);
  assert.equal(a.at, Date.parse("2026-11-16T09:25:00Z"));
  assert.equal(readAurora({}), null);
  const kp = readKp([{ time_tag: "2026-11-16T00:00:00", Kp: 0.33 }, { time_tag: "2026-11-16T03:00:00", Kp: "5.67" }]);
  assert.deepEqual(kp, { kp: 5.67, at: Date.parse("2026-11-16T03:00:00Z") });
  assert.equal(kpWords(0.33), "quiet");
  assert.equal(kpWords(5.67), "a minor storm (G1)");
  assert.equal(kpWords(9), "an extreme storm (G5)");
});

test("switched on, it fetches all three, shows them, and fades them when the clock is days away", async () => {
  const sun = { mesh: { material: { uniforms: spotUniforms() } } };
  const earth = { mesh: new Object3D(), material: { uniforms: { sunDir: { value: new Vector3(1, 0, 0) } } } };
  const asked = [];
  const answers = {
    solar_regions: [group()],
    ovation: { "Forecast Time": "2026-11-16T00:30:00Z", coordinates: [[10, 65, 40]] },
    "k-index": [{ time_tag: "2026-11-16T00:00:00", Kp: 2 }],
  };
  let said = "";
  const sw = createSpaceWeather({
    sun,
    earth,
    onStatus: (t) => (said = t),
    fetcher: async (url) => (asked.push(url), Object.entries(answers).find(([k]) => url.includes(k))[1]),
  });
  const now = Date.parse("2026-11-16T01:00:00Z");
  sw.update(0, now);
  assert.equal(asked.length, 0, "nothing fetched while it's off");
  sw.setOn(true);
  sw.update(0, now);
  assert.equal(asked.length, 3);
  await new Promise((r) => setTimeout(r, 10));
  sw.update(1, now);
  assert.equal(asked.length, 3, "not again until it's due");
  assert.equal(sun.mesh.material.uniforms.spotCount.value, 5);
  assert.equal(sun.mesh.material.uniforms.spotFade.value, 1);
  assert.ok(sw.shell.visible && earth.mesh.children.includes(sw.shell));
  assert.equal(said, "From NOAA: 1 sunspot group today; Kp 2.0, quiet; aurora up to 40% likely.");
  sw.update(2, now + 10 * 86400000); // the clock ten days on
  assert.equal(sun.mesh.material.uniforms.spotFade.value, 0);
  assert.equal(sw.shell.visible, false);
  sw.setOn(false);
  assert.equal(said, "");
});
