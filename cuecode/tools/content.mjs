// Reads the text files in content/ into plain objects. Used by the build, the
// checker and the tests.
//
// A content file is a list of blocks. A line starting with %% opens a block:
//   %%key rest of the line
//   any lines below it, up to the next %% line
// %% was picked because no language here starts a line with it. @ would clash
// with Python decorators and Swift attributes.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT = join(ROOT, 'content');

export function parseBlocks(text, where = 'content') {
  const blocks = [];
  let current = null;
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^%%([a-z]+)(?:[ \t]+(.*))?$/);
    if (m) {
      current = { key: m[1], arg: (m[2] ?? '').trim(), body: [], line: i + 1, where };
      blocks.push(current);
    } else if (current) {
      current.body.push(line);
    } else if (line.trim()) {
      throw new Error(`${where}:${i + 1}: text before the first %% line`);
    }
  });
  for (const b of blocks) {
    while (b.body.length && !b.body[b.body.length - 1].trim()) b.body.pop();
    while (b.body.length && !b.body[0].trim()) b.body.shift();
    b.text = b.body.join('\n');
  }
  return blocks;
}

const value = (b) => b.text || b.arg;
const fail = (b, why) => { throw new Error(`${b.where}:${b.line}: ${why}`); };

function filesIn(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => join(dir, f));
}

// One concept: a job done in every language.
export function parseConcepts(text, where) {
  const concepts = [];
  let concept = null;
  let snippet = null;
  for (const b of parseBlocks(text, where)) {
    if (b.key === 'concept') {
      concept = { id: b.arg, docs: [], langs: {} };
      snippet = null;
      concepts.push(concept);
    } else if (!concept) {
      fail(b, 'expected %%concept first');
    } else if (['title', 'group', 'blurb', 'explain', 'mainframe'].includes(b.key)) {
      concept[b.key] = value(b);
    } else if (b.key === 'docs') {
      concept.docs = b.arg.split(/\s+/).filter(Boolean);
    } else if (b.key === 'lang') {
      snippet = { lang: b.arg, run: 'full' };
      concept.langs[b.arg] = snippet;
    } else if (!snippet) {
      fail(b, `%%${b.key} needs a %%lang above it`);
    } else if (['note', 'skip', 'demo', 'stdin', 'hl', 'play'].includes(b.key)) {
      snippet[b.key] = value(b);
    } else if (b.key === 'code') {
      snippet.code = b.text;
    } else if (b.key === 'output') {
      snippet.output = b.text;
    } else if (b.key === 'run') {
      // full, compile, live, or "none: why it can't run here"
      const [mode, ...why] = b.arg.split(':');
      snippet.run = mode.trim();
      if (why.length) snippet.why = why.join(':').trim();
    } else {
      fail(b, `unknown %%${b.key}`);
    }
  }
  return concepts;
}

export function parseCards(text, where) {
  const cards = [];
  let card = null;
  for (const b of parseBlocks(text, where)) {
    if (b.key === 'card') {
      card = { id: b.arg };
      cards.push(card);
    } else if (!card) {
      fail(b, 'expected %%card first');
    } else if (['deck', 'kind', 'ask', 'why'].includes(b.key)) {
      card[b.key] = value(b);
    } else if (b.key === 'code') {
      card.lang = b.arg;
      card.code = b.text;
    } else if (b.key === 'answer') {
      if (b.arg) card.answerLang = b.arg;
      card.answer = b.text;
    } else if (b.key === 'run') {
      const [mode, ...why] = b.arg.split(':');
      card.run = mode.trim();
      if (why.length) card.runWhy = why.join(':').trim();
    } else {
      fail(b, `unknown %%${b.key}`);
    }
  }
  return cards;
}

export function parseDocs(text, where) {
  const docs = [];
  let doc = null;
  for (const b of parseBlocks(text, where)) {
    if (b.key === 'doc') {
      doc = { id: b.arg, aka: [], examples: [], links: [] };
      docs.push(doc);
    } else if (!doc) {
      fail(b, 'expected %%doc first');
    } else if (['title', 'area', 'simple', 'like', 'more', 'see'].includes(b.key)) {
      doc[b.key] = value(b);
    } else if (b.key === 'aka') {
      doc.aka = b.arg.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (b.key === 'example') {
      doc.examples.push({ lang: b.arg, code: b.text });
    } else if (b.key === 'link') {
      const [label, url] = b.arg.split('|').map((s) => s.trim());
      if (!url) fail(b, 'a link needs "label | url"');
      doc.links.push({ label, url });
    } else {
      fail(b, `unknown %%${b.key}`);
    }
  }
  return docs;
}

export function loadContent() {
  const load = (dir, parse) => filesIn(join(CONTENT, dir))
    .flatMap((f) => parse(readFileSync(f, 'utf8'), f.slice(ROOT.length + 1)));
  return {
    concepts: load('concepts', parseConcepts),
    cards: load('cards', parseCards),
    docs: load('docs', parseDocs),
  };
}

// Anything the app claims was checked is tied to this hash, so editing a
// snippet takes the claim away until the checker has run it again.
export function jobHash(job) {
  return createHash('sha1')
    .update(JSON.stringify([job.lang, job.mode, job.code, job.expected ?? null, job.stdin ?? null]))
    .digest('hex').slice(0, 16);
}

// Short card code is not a whole program, so it gets wrapped for the compiler.
export function wrapForRun(lang, code) {
  if (lang === 'java' && !/\bclass\s+Main\b/.test(code)) {
    const lines = code.split('\n');
    const imports = lines.filter((l) => /^import\s/.test(l));
    const body = lines.filter((l) => !/^import\s/.test(l));
    return `${imports.join('\n')}\npublic class Main {\n  public static void main(String[] args) throws Exception {\n${body.join('\n')}\n  }\n}\n`;
  }
  if (lang === 'cobol' && !/IDENTIFICATION DIVISION/.test(code)) {
    const hasProc = /PROCEDURE DIVISION/.test(code);
    const stop = /STOP RUN/.test(code) ? '' : '\n           STOP RUN.';
    return [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. CARD.',
      '       DATA DIVISION.',
      '       WORKING-STORAGE SECTION.',
      hasProc ? code : `       PROCEDURE DIVISION.\n${code}`,
    ].join('\n') + stop + '\n';
  }
  return code;
}

// Every piece of code the checker can try, with what it should do.
export function collectJobs({ concepts, cards }) {
  const jobs = [];
  for (const c of concepts) {
    for (const s of Object.values(c.langs)) {
      if (s.skip || !s.code || s.run === 'none' || s.run === 'live') continue;
      jobs.push({
        id: `${c.id}/${s.lang}`, lang: s.lang, code: s.code, mode: s.run,
        expected: s.run === 'full' ? s.output : undefined, stdin: s.stdin,
      });
    }
  }
  const RUNNABLE = new Set(['python', 'swift', 'java', 'cobol', 'js', 'ts']);
  for (const k of cards) {
    if (k.run === 'none' || !k.lang || !RUNNABLE.has(k.lang)) continue;
    if (k.kind === 'predict') {
      jobs.push({ id: `card:${k.id}`, lang: k.lang, code: wrapForRun(k.lang, k.code), mode: 'full', expected: k.answer });
    } else if (k.kind === 'fill') {
      const code = k.code.replace(/_{4,}/, k.answer);
      jobs.push({ id: `card:${k.id}`, lang: k.lang, code: wrapForRun(k.lang, code), mode: 'compile' });
    } else if (k.answerLang && RUNNABLE.has(k.answerLang)) {
      jobs.push({ id: `card:${k.id}`, lang: k.answerLang, code: wrapForRun(k.answerLang, k.answer), mode: 'compile' });
    }
  }
  return jobs;
}
