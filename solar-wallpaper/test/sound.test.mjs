// The quiet sound (src/sound.js): the parts that aren't the browser's own.
import assert from "node:assert/strict";
import test from "node:test";
import { BELLS, bellGap, DRONE, roomEcho } from "../src/sound.js";

test("the bells keep to a pentatonic scale, and the drone goes deeper away from home", () => {
  for (const notes of Object.values(BELLS)) {
    // Every step between neighbouring notes is a whole tone or a minor third (two or three semitones).
    for (let i = 1; i < notes.length; i++) {
      const semitones = 12 * Math.log2(notes[i] / notes[i - 1]);
      assert.ok(Math.abs(semitones - Math.round(semitones)) < 0.02 && [2, 3].includes(Math.round(semitones)), `${notes[i - 1]} to ${notes[i]}`);
    }
  }
  assert.ok(DRONE.away < DRONE.home);
  assert.ok(BELLS.away[0] < BELLS.home[0]);
});

test("a bell every 6 to 16 seconds", () => {
  assert.equal(bellGap(() => 0), 6);
  assert.equal(bellGap(() => 0.999999), 6 + 0.999999 * 10);
});

test("the room's echo dies away to nothing, a little differently left and right", () => {
  const ctx = {
    sampleRate: 1000,
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (c) => data[c] };
    },
  };
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const echo = roomEcho(ctx, 5, random);
  const [l, r] = [echo.getChannelData(0), echo.getChannelData(1)];
  assert.equal(l.length, 5000);
  const loud = (d, from, to) => Math.max(...Array.from(d.slice(from, to), Math.abs));
  assert.ok(loud(l, 0, 500) > 0.5, "loud at first");
  assert.ok(loud(l, 4500, 5000) < 0.002, "nothing by the end");
  assert.notDeepEqual(Array.from(l.slice(0, 50)), Array.from(r.slice(0, 50)));
});
