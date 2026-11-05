// Keeps the content honest: every link resolves, nothing is half-written, and
// the app never claims a snippet ran unless the checker passed that exact code.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, collectJobs, jobHash, loadContent, parseBlocks, parseConcepts } from '../tools/content.mjs';
import { buildData, renderData } from '../tools/build.mjs';

const content = loadContent();
const { concepts, cards, docs } = content;
const LANGS = ['python', 'swift', 'java', 'cobol', 'jcl', 'js', 'ts', 'html', 'css'];
const CORE = ['python', 'swift', 'java', 'cobol', 'js', 'ts', 'html', 'css'];

test('ids are unique', () => {
  for (const list of [concepts, cards, docs]) {
    const ids = list.map((x) => x.id);
    assert.deepEqual(ids, [...new Set(ids)]);
  }
});

test('every concept covers all eight languages, or says why not', () => {
  for (const c of concepts) {
    for (const lang of CORE) {
      const s = c.langs[lang];
      assert.ok(s, `${c.id} has nothing for ${lang}`);
      assert.ok(s.code || s.skip, `${c.id}/${lang} has no code and no reason`);
    }
    for (const lang of Object.keys(c.langs)) assert.ok(LANGS.includes(lang), `${c.id}: unknown ${lang}`);
  }
});

test('every concept explains itself in words, with a mainframe view', () => {
  for (const c of concepts) {
    for (const field of ['title', 'group', 'blurb', 'explain', 'mainframe']) assert.ok(c[field], `${c.id} needs ${field}`);
  }
});

test('code with a run mode of full has an expected output', () => {
  for (const c of concepts) {
    for (const s of Object.values(c.langs)) {
      if (s.code && s.run === 'full') assert.ok(s.output !== undefined, `${c.id}/${s.lang} needs output`);
      if (s.run === 'none') assert.ok(s.why, `${c.id}/${s.lang} should say why it can't run`);
    }
  }
});

test('links between concepts and docs all resolve', () => {
  const docIds = new Set(docs.map((d) => d.id));
  const conceptIds = new Set(concepts.map((c) => c.id));
  for (const c of concepts) for (const d of c.docs) assert.ok(docIds.has(d), `${c.id} links to missing doc ${d}`);
  for (const d of docs) if (d.see) assert.ok(conceptIds.has(d.see), `${d.id} links to missing concept ${d.see}`);
});

test('the finder only recommends concepts that exist', async () => {
  await import('../app/finder-data.js');
  const conceptIds = new Set(concepts.map((c) => c.id));
  for (const cap of globalThis.Cuecode.finderData.caps) {
    for (const id of cap.learn) assert.ok(conceptIds.has(id), `${cap.id} suggests missing concept ${id}`);
  }
});

test('every card is complete', () => {
  const decks = ['python', 'swift', 'java', 'cobol', 'mainframe', 'frontend'];
  const kinds = ['predict', 'fill', 'fix', 'write', 'explain'];
  for (const k of cards) {
    assert.ok(decks.includes(k.deck), `${k.id} deck ${k.deck}`);
    assert.ok(kinds.includes(k.kind), `${k.id} kind ${k.kind}`);
    assert.ok(k.ask && k.answer, `${k.id} needs a question and an answer`);
    if (['predict', 'fill', 'fix'].includes(k.kind)) assert.ok(k.code, `${k.id} needs code`);
    if (k.kind === 'fill') assert.match(k.code, /_{4,}/, `${k.id} needs a ____ gap`);
  }
});

test('every doc says something simple', () => {
  for (const d of docs) {
    assert.ok(d.title && d.area && d.simple, `${d.id} is incomplete`);
    assert.ok(d.simple.length < 130, `${d.id}: "simple" should be short, it's ${d.simple.length}`);
    for (const l of d.links) assert.match(l.url, /^https:\/\//);
  }
});

test('COBOL stays inside its columns', () => {
  const check = (code, where) => {
    for (const line of code.split('\n')) {
      assert.ok(line.length <= 72, `${where}: past column 72: ${line}`);
      if (line.trim()) assert.ok(/^ {7}\S|^ {11}|^ {6}\*/.test(line) || /^ {7}/.test(line), `${where}: bad indent: ${line}`);
    }
  };
  for (const c of concepts) {
    const s = c.langs.cobol;
    if (s?.code && !s.hl) check(s.code, c.id);
  }
  for (const k of cards) {
    if (k.lang === 'cobol') check(k.code, k.id);
    if (k.answerLang === 'cobol') check(k.answer, k.id);
  }
});

test('JCL stays inside column 71', () => {
  for (const c of concepts) {
    if (c.langs.jcl?.code) for (const line of c.langs.jcl.code.split('\n')) assert.ok(line.length <= 71, line);
  }
});

test('the checker has run every example and they all still pass', () => {
  const verified = JSON.parse(readFileSync(join(ROOT, 'content/verified.json'), 'utf8'));
  const stale = collectJobs(content).filter((j) => !verified.passed[jobHash(j)]).map((j) => j.id);
  assert.deepEqual(stale, [], 'run: npm run verify');
});

test('a snippet is only marked as run if that exact code passed', () => {
  const data = buildData();
  const edited = JSON.parse(JSON.stringify(content));
  edited.concepts[0].langs.python.code += '\n# changed';
  const verified = JSON.parse(readFileSync(join(ROOT, 'content/verified.json'), 'utf8'));
  const job = collectJobs(edited).find((j) => j.id === `${edited.concepts[0].id}/python`);
  assert.equal(verified.passed[jobHash(job)], undefined, 'edited code must lose its pass');
  assert.equal(data.concepts[0].langs.python.checked, 'ran');
});

test('app/data.js is up to date with content/', () => {
  const file = join(ROOT, 'app/data.js');
  assert.ok(existsSync(file), 'run: npm run build');
  assert.equal(readFileSync(file, 'utf8'), renderData(buildData()), 'run: npm run build');
});

test('the parser keeps code that looks like directives', () => {
  const [c] = parseConcepts('%%concept x\n%%lang python\n%%code\n@dataclass\nclass A: pass\n', 'test');
  assert.equal(c.langs.python.code, '@dataclass\nclass A: pass');
});

test('the parser rejects stray text and unknown keys', () => {
  assert.throws(() => parseBlocks('hello\n%%concept x', 'test'), /before the first/);
  assert.throws(() => parseConcepts('%%concept x\n%%lang py\n%%nonsense y', 'test'), /unknown/);
});
