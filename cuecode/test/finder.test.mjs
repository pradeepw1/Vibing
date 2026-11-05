import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../app/finder-data.js');
require('../app/finder.js');
const { finder, finderData: data } = globalThis.Cuecode;

const run = (text, options) => finder.analyse(text, data, options);
const capIds = (r) => r.caps.map((c) => c.cap.id);

const cases = [
  { text: 'An iPhone app that tracks my workouts, shows progress charts and reminds me to train',
    shape: 'ios', best: 'swift', caps: ['store', 'charts', 'notify'] },
  { text: 'A website where people log in and pay for a subscription',
    shape: 'web', best: 'frontend', caps: ['auth', 'pay'] },
  { text: 'Scrape prices from websites every morning and email me when one drops',
    shape: 'script', best: 'python', caps: ['scrape', 'schedule', 'email'] },
  { text: 'A nightly batch job that reads customer records and updates balances',
    shape: 'batch', best: 'mainframe', caps: ['batchfile', 'schedule'] },
  { text: 'A REST API for a bank that connects to the mainframe and sends events to Kafka',
    shape: 'api', caps: ['bridge', 'queue'] },
  { text: 'A chatbot that answers questions about my PDFs',
    caps: ['ai', 'pdf'] },
  { text: 'A CICS teller screen for looking up a customer',
    shape: 'online', best: 'mainframe' },
  { text: 'Analyse a CSV of sales and forecast next month',
    shape: 'data', best: 'python', caps: ['sheets', 'ml'] },
  { text: 'A real-time multiplayer game in the browser',
    best: 'frontend', caps: ['realtime'] },
  { text: 'A Mac menu bar app that scans receipts',
    shape: 'mac', best: 'swift', caps: ['vision'] },
  { text: 'An Android app with a map of nearby cafes',
    shape: 'android', best: 'java', caps: ['maps'] },
  { text: 'A chrome extension that summarises the page',
    shape: 'extension', best: 'frontend', caps: ['ai'] },
];

for (const c of cases) {
  test(`understands: ${c.text}`, () => {
    const r = run(c.text);
    if (c.shape) assert.equal(r.shape.id, c.shape);
    if (c.best) assert.equal(r.best, c.best);
    for (const cap of c.caps ?? []) assert.ok(capIds(r).includes(cap), `missing ${cap} in ${capIds(r)}`);
  });
}

test('word endings are forgiven', () => {
  assert.equal(finder.stem('logging'), 'log');
  assert.equal(finder.stem('reminders'), 'reminder');
  assert.equal(finder.stem('charts'), 'chart');
  assert.equal(finder.stem('cities'), 'city');
  assert.equal(finder.stem('sell'), 'sell');
  assert.ok(capIds(run('users logging in')).includes('auth'));
});

test('"no login" means no login', () => {
  assert.ok(!capIds(run('a simple site with no login')).includes('auth'));
  assert.ok(!capIds(run("it doesn't need payments")).includes('pay'));
  assert.ok(capIds(run('a site with login')).includes('auth'));
});

test('a declined part is left out, and not reported as a word it missed', () => {
  const r = run('a phone app. No login needed.');
  assert.ok(!r.missed.includes('login'));
  assert.ok(!r.missed.includes('needed'), 'filler is matched on its stem');
  assert.deepEqual(r.leftOut, ['Sign-in']);
  assert.deepEqual(run('a phone app with login').leftOut, []);
});

test('a phone app that takes payments is told it needs a server', () => {
  const r = run('an iPhone app where customers pay');
  assert.ok(finder.planFor(r, 'swift', data).parts.some((p) => p.id === 'server'));
  const notes = run('an iPhone app that saves my notes');
  assert.ok(!finder.planFor(notes, 'swift', data).parts.some((p) => p.id === 'server'));
  const site = run('a website where customers pay');
  assert.ok(!finder.planFor(site, 'frontend', data).parts.some((p) => p.id === 'server'), 'a site already has one');
});

test('on-device AI needs no server, but a hosted key does', () => {
  const r = run('an iPhone app that summarises my notes');
  assert.ok(!finder.planFor(r, 'swift', data).parts.some((p) => p.id === 'server'));
  assert.ok(finder.planFor(r, 'frontend', data).parts.some((p) => p.id === 'server'));
});

test('a route that does not suit the project says so', () => {
  const r = run('an iPhone app with charts');
  assert.equal(r.routes.find((x) => x.id === 'swift').fits, true);
  assert.equal(r.routes.find((x) => x.id === 'mainframe').fits, false);
  assert.equal(finder.planFor(r, 'mainframe', data).fits, false);
});

test('it says when it had to assume where this runs', () => {
  const r = run('something that tracks my expenses');
  assert.equal(r.shape.id, 'web');
  assert.equal(r.assumed, true);
  assert.equal(run('an iPhone app').assumed, false);
});

test('picking a shape by hand overrides the guess', () => {
  const r = run('tracks my expenses', { shape: 'ios' });
  assert.equal(r.shape.id, 'ios');
  assert.equal(r.assumed, false);
  assert.equal(r.best, 'swift');
});

test('gibberish matches nothing and is reported as not understood', () => {
  const r = run('flurble wibbling zoggs');
  assert.equal(r.matched, false);
  assert.ok(r.missed.length >= 2);
  assert.equal(run('   ').empty, true);
});

test('words it did not recognise are listed, not silently dropped', () => {
  const r = run('an iPhone app for my beekeeping');
  assert.ok(r.missed.includes('beekeeping'));
  assert.ok(!r.missed.includes('iphone'));
});

test('a route with no tool for a part explains why', () => {
  const r = run('an app with a map');
  const plan = finder.planFor(r, 'mainframe', data);
  const maps = plan.parts.find((p) => p.id === 'maps');
  assert.equal(maps.tools.length, 0);
  assert.ok(maps.gap.length > 10);
});

test('every part has tools or an explanation on every route', () => {
  for (const cap of data.caps) {
    for (const route of data.routes) {
      const tools = cap.tools[route.id];
      assert.ok(tools, `${cap.id} has no entry for ${route.id}`);
      if (!tools.length) {
        const r = { caps: [{ cap, hits: [] }], shape: data.shapes[0], text: '', routes: data.routes.map((x) => ({ ...x, fits: true })) };
        assert.ok(finder.planFor(r, route.id, data).parts[0].gap);
      }
    }
  }
});

test('every tool has a name, a working-looking link and a reason', () => {
  const check = ([name, url, why]) => {
    assert.ok(name, 'name');
    assert.match(url, /^https:\/\//, `${name} link`);
    assert.ok(why?.length > 5, `${name} reason`);
  };
  for (const cap of data.caps) Object.values(cap.tools).flat().forEach(check);
  for (const shape of data.shapes) Object.values(shape.start).flat().forEach(check);
  Object.values(data.habits).flat().forEach(check);
  Object.values(data.server).flat().forEach(check);
});

test('the plan exports as Markdown', () => {
  const r = run('an iPhone app with charts');
  const md = finder.toMarkdown(r, finder.planFor(r, 'swift', data));
  assert.match(md, /# Plan: an iPhone app with charts/);
  assert.match(md, /Swift Charts/);
});
