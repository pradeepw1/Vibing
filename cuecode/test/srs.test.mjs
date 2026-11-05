import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../app/srs.js');
const { srs } = globalThis.Cuecode;
const { DAY, MINUTE } = srs;
const NOW = Date.UTC(2026, 10, 5, 12);

test('a new card marked Good comes back tomorrow', () => {
  const s = srs.review(undefined, 3, NOW);
  assert.equal(s.due, NOW + DAY);
  assert.equal(s.interval, 1);
});

test('a new card marked Again comes back in a minute', () => {
  const s = srs.review(undefined, 1, NOW);
  assert.equal(s.due, NOW + MINUTE);
  assert.equal(s.interval, 0);
  assert.equal(s.lapses, 0, 'still learning, so not a lapse');
});

test('Hard while learning waits ten minutes', () => {
  assert.equal(srs.review(undefined, 2, NOW).due, NOW + 10 * MINUTE);
});

test('Easy on a new card skips ahead', () => {
  assert.equal(srs.review(undefined, 4, NOW).interval, 4);
});

test('gaps grow when you keep getting it right', () => {
  let s;
  let t = NOW;
  const gaps = [];
  for (let i = 0; i < 5; i += 1) {
    s = srs.review(s, 3, t);
    gaps.push(s.interval);
    t = s.due;
  }
  assert.deepEqual(gaps, [1, 3, 8, 20, 50]);
});

test('Good always moves forward, even with a low ease', () => {
  const s = srs.review({ reps: 5, ease: 1.3, interval: 1, lapses: 0, due: NOW }, 3, NOW);
  assert.ok(s.interval >= 2);
});

test('forgetting a known card resets it and counts a lapse', () => {
  const s = srs.review({ reps: 5, ease: 2.5, interval: 30, lapses: 0, due: NOW }, 1, NOW);
  assert.equal(s.interval, 0);
  assert.equal(s.lapses, 1);
  assert.equal(s.ease, 2.3);
});

test('ease stays within bounds', () => {
  let s = { reps: 5, ease: 1.35, interval: 10, lapses: 0, due: NOW };
  for (let i = 0; i < 5; i += 1) s = srs.review(s, 1, NOW);
  assert.equal(s.ease, 1.3);
  s = { reps: 5, ease: 2.95, interval: 10, lapses: 0, due: NOW };
  for (let i = 0; i < 5; i += 1) s = srs.review(s, 4, NOW);
  assert.equal(s.ease, 3);
});

test('after a lapse, Good relearns it in a day', () => {
  const lapsed = srs.review({ reps: 5, ease: 2.5, interval: 30, lapses: 0, due: NOW }, 1, NOW);
  assert.equal(srs.review(lapsed, 3, NOW).interval, 1);
});

test('the queue is due cards first, oldest first, then new ones up to the limit', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const states = {
    a: { reps: 1, interval: 1, due: NOW - 5 },
    b: { reps: 1, interval: 1, due: NOW - 50 },
    c: { reps: 1, interval: 1, due: NOW + DAY },
  };
  const q = srs.buildQueue(cards, states, { now: NOW, newLeft: 1 });
  assert.deepEqual(q.map((c) => c.id), ['b', 'a', 'd']);
});

test('no new cards once the daily allowance is used', () => {
  const q = srs.buildQueue([{ id: 'x' }], {}, { now: NOW, newLeft: 0 });
  assert.equal(q.length, 0);
});

test('deck stats add up', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const states = {
    a: { reps: 2, interval: 30, due: NOW + DAY },
    b: { reps: 2, interval: 2, due: NOW - 1 },
    c: { reps: 1, interval: 1, due: NOW + DAY },
  };
  assert.deepEqual(srs.deckStats(cards, states, NOW), { total: 4, fresh: 1, due: 1, learning: 2, known: 1 });
});

test('a streak grows on consecutive days and resets after a gap', () => {
  let streak = srs.touchStreak(undefined, NOW);
  assert.equal(streak.days, 1);
  assert.equal(srs.touchStreak(streak, NOW + MINUTE).days, 1, 'same day');
  streak = srs.touchStreak(streak, NOW + DAY);
  assert.equal(streak.days, 2);
  assert.equal(srs.liveStreak(streak, NOW + 2 * DAY), 2, 'still alive until tomorrow ends');
  assert.equal(srs.liveStreak(streak, NOW + 3 * DAY), 0);
  assert.equal(srs.touchStreak(streak, NOW + 5 * DAY).days, 1);
});

test('button labels read like English', () => {
  assert.equal(srs.nextLabel(undefined, 1, NOW), 'in a minute');
  assert.equal(srs.nextLabel(undefined, 2, NOW), 'in 10 minutes');
  assert.equal(srs.nextLabel(undefined, 3, NOW), 'tomorrow');
  assert.equal(srs.nextLabel(undefined, 4, NOW), 'in 4 days');
  assert.equal(srs.nextLabel({ reps: 9, ease: 2.5, interval: 60, lapses: 0, due: NOW }, 3, NOW), 'in 5 months');
});
