// Turns content/ into app/data.js, which the page loads with a plain <script>.
// That way index.html works when opened straight from disk, with no server.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT, ROOT, collectJobs, jobHash, loadContent } from './content.mjs';

export function buildData() {
  const content = loadContent();
  const path = join(CONTENT, 'verified.json');
  const verified = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { passed: {}, toolchains: {} };
  const byId = new Map(collectJobs(content).map((j) => [j.id, jobHash(j)]));
  const passed = (id) => verified.passed[byId.get(id)];

  const concepts = content.concepts.map((c) => {
    const langs = {};
    for (const [id, s] of Object.entries(c.langs)) {
      const out = { ...s };
      if (s.code && !s.skip) {
        if (s.run === 'live') out.checked = 'live';
        else if (s.run === 'none') out.checked = 'none';
        else out.checked = { full: 'ran', compile: 'compiled' }[passed(`${c.id}/${id}`)] ?? 'none';
      }
      langs[id] = out;
    }
    return { ...c, langs };
  });
  const cards = content.cards.map((k) => ({
    ...k, checked: { full: 'ran', compile: 'compiled' }[passed(`card:${k.id}`)] ?? 'none',
  }));
  return {
    toolchains: verified.toolchains ?? {},
    checkedOn: verified.checkedOn ?? null,
    concepts, cards, docs: content.docs,
  };
}

export const renderData = (data) =>
  `// Made by tools/build.mjs from content/. Edit those files, not this one.\n` +
  `(globalThis.Cuecode ??= {}).data = ${JSON.stringify(data)};\n`;

if (process.argv[1]?.endsWith('build.mjs')) {
  const data = buildData();
  writeFileSync(join(ROOT, 'app/data.js'), renderData(data));
  const n = data.concepts.reduce((sum, c) => sum + Object.values(c.langs).filter((s) => s.code).length, 0);
  console.log(`app/data.js: ${data.concepts.length} concepts, ${n} snippets, ${data.cards.length} cards, ${data.docs.length} docs`);
}
