import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { loadContent } from '../tools/content.mjs';

const require = createRequire(import.meta.url);
require('../app/highlight.js');
const { highlight } = globalThis.Cuecode;
const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('colouring never changes the code itself', () => {
  const { concepts, cards, docs } = loadContent();
  const samples = [
    ...concepts.flatMap((c) => Object.values(c.langs).filter((s) => s.code).map((s) => [s.code, s.hl ?? s.lang])),
    ...cards.filter((k) => k.code).map((k) => [k.code, k.lang]),
    ...docs.flatMap((d) => d.examples.map((e) => [e.code, e.lang])),
  ];
  assert.ok(samples.length > 150);
  for (const [code, lang] of samples) assert.equal(textOf(highlight(code, lang)), code, lang);
});

test('page content is escaped, so code can never run as markup', () => {
  for (const lang of ['python', 'js', 'cobol', 'jcl', 'html', 'css', 'bash', 'text']) {
    const out = highlight('<img src=x onerror=alert(1)>', lang);
    assert.ok(!/<img/.test(out.replace(/<span[^>]*>|<\/span>/g, '')), `${lang}: ${out}`);
  }
});

test('COBOL: a comment in column 7 is a comment, a level number is a label', () => {
  assert.match(highlight('      * a note', 'cobol'), /t-com/);
  assert.match(highlight('       01  WS-A  PIC X(5).', 'cobol'), /t-label">01/);
  assert.match(highlight('       01  WS-A  PIC X(5).', 'cobol'), /t-type">PIC X\(5\)/);
  assert.match(highlight('           88  DONE  VALUE "Y".', 'cobol'), /t-label">88/);
});

test('JCL: labels, operations and parameters', () => {
  const out = highlight("//STEP1    EXEC PGM=REPORT1", 'jcl');
  assert.match(out, /t-label">\/\/STEP1/);
  assert.match(out, /t-kw">EXEC/);
  assert.match(out, /t-attr">PGM/);
  assert.match(highlight('//* a comment', 'jcl'), /t-com/);
});

test('Java and Swift: decorators and strings', () => {
  assert.match(highlight('@State private var n = 0', 'swift'), /t-attr">@State/);
  assert.match(highlight('String s = "hi";', 'java'), /t-str">"hi"/);
  assert.match(highlight('# hi', 'python'), /t-com/);
});
