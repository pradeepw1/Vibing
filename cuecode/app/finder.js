// Reads a plain-English description and works out what's being built, which
// parts it needs, and the tools for each. It's word matching against a catalogue,
// not AI, so it works offline and says so when it doesn't recognise something.
(function (root) {
  const NEGATIONS = new Set(['no', 'not', 'without', 'dont', 'doesnt', 'wont', 'never']);

  function stem(word) {
    let w = word;
    if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && /(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    else return w;
    // logging -> logg -> log, but keep "sell" and "add"
    if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    return text.toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9/]+/g, ' ')
      .trim().split(/\s+/).filter(Boolean);
  }

  const stemPhrase = (phrase) => tokenize(phrase).map(stem);

  // Compile each trigger once. Longer phrases count for more than single words.
  const compiled = new WeakMap();
  function triggersOf(item) {
    if (!compiled.has(item)) {
      compiled.set(item, item.triggers.map((t) => ({ text: t, stems: stemPhrase(t) })));
    }
    return compiled.get(item);
  }

  function findHits(item, stems, words) {
    const hits = [];
    const used = new Set();
    const declined = new Set();
    for (const trigger of triggersOf(item)) {
      const n = trigger.stems.length;
      for (let i = 0; i + n <= stems.length; i += 1) {
        if (!trigger.stems.every((s, j) => stems[i + j] === s)) continue;
        const before = words.slice(Math.max(0, i - 3), i);
        if (before.some((w) => NEGATIONS.has(w))) {
          for (let j = i; j < i + n; j += 1) declined.add(j);
          continue;
        }
        hits.push({ text: words.slice(i, i + n).join(' '), weight: n });
        for (let j = i; j < i + n; j += 1) used.add(j);
      }
    }
    return { hits, used, declined };
  }

  function analyse(text, data, options = {}) {
    const words = tokenize(text);
    const stems = words.map(stem);
    const understood = new Set();
    const refused = new Set(); // "no login": understood, and left out on purpose
    const stemFiller = new Set([...data.filler].map(stem));

    const shapeScores = data.shapes.map((shape) => {
      const { hits, used } = findHits(shape, stems, words);
      used.forEach((i) => understood.add(i));
      return { shape, hits, score: hits.reduce((sum, h) => sum + h.weight * 2, 0) };
    }).sort((a, b) => b.score - a.score);

    const scanned = data.caps.map((cap) => {
      const { hits, used, declined } = findHits(cap, stems, words);
      used.forEach((i) => understood.add(i));
      declined.forEach((i) => { understood.add(i); refused.add(cap.label); });
      return { cap, hits: [...new Set(hits.map((h) => h.text))] };
    });
    const caps = scanned.filter((c) => c.hits.length);

    const best = shapeScores[0];
    const forced = options.shape && data.shapes.find((s) => s.id === options.shape);
    const shape = forced ?? (best.score > 0 ? best.shape : data.shapes.find((s) => s.id === 'web'));
    const assumed = !forced && best.score === 0;

    const routes = rankRoutes(shape, caps, data);
    const missed = [...new Set(words.filter((w, i) =>
      !understood.has(i) && !data.filler.has(w) && !stemFiller.has(stems[i]) && !/^\d+$/.test(w) && w.length > 2))];
    const leftOut = [...refused].filter((label) => !caps.some((c) => c.cap.label === label));

    return {
      text,
      empty: words.length === 0,
      matched: caps.length > 0 || best.score > 0,
      shape, assumed, forced: Boolean(forced),
      shapeHits: forced ? [] : [...new Set(best.hits.map((h) => h.text))],
      caps, routes, best: routes[0].id, missed, leftOut,
    };
  }

  function rankRoutes(shape, caps, data) {
    return data.routes.map((route) => {
      const covered = caps.filter((c) => (c.cap.tools[route.id] ?? []).length > 0);
      const score = (shape.fit[route.id] ?? 0) * 2 + covered.length * 1.5 - (caps.length - covered.length) * 3;
      return { ...route, score, covered: covered.length, total: caps.length, fits: (shape.fit[route.id] ?? 0) >= 2 };
    }).sort((a, b) => b.score - a.score);
  }

  const asTool = ([name, url, why, install]) => ({ name, url, why, install });
  const IN_APP = new Set(['ios', 'mac', 'android', 'desktop', 'extension']);

  function needsServer(analysis, routeId) {
    if (!IN_APP.has(analysis.shape.id)) return false;
    return analysis.caps.some(({ cap }) => cap.server === true || cap.server?.includes(routeId));
  }

  // The full plan for one route.
  function planFor(analysis, routeId, data) {
    const route = data.routes.find((r) => r.id === routeId);
    const start = (analysis.shape.start[routeId] ?? []).map(asTool);
    const parts = analysis.caps.map(({ cap, hits }) => ({
      id: cap.id, label: cap.label, plain: cap.plain, hits,
      tools: (cap.tools[routeId] ?? []).map(asTool),
      gap: (cap.tools[routeId] ?? []).length ? null
        : cap.none?.[routeId] ?? `${route.label} has no standard tool for this.`,
    }));
    if (needsServer(analysis, routeId) && data.server[routeId]?.length) {
      parts.push({
        id: 'server', label: 'A small server', hits: [], gap: null,
        plain: "Some of this can't live inside the app. Secret keys would be exposed, and an app can't reach other people by itself. A small server does that part.",
        tools: data.server[routeId].map(asTool),
      });
    }
    const learn = [...new Set(['variables', 'functions',
      ...analysis.caps.flatMap((c) => c.cap.learn)])].slice(0, 6);
    return {
      route, start, parts, learn,
      fits: analysis.routes.find((r) => r.id === routeId).fits,
      bestLabel: analysis.routes[0].label,
      habits: (data.habits[routeId] ?? []).map(asTool),
      decks: route.decks,
    };
  }

  function toMarkdown(analysis, plan) {
    const line = (t) => `- **${t.name}**: ${t.why}${t.install ? ` \`${t.install}\`` : ''} (${t.url})`;
    const out = [`# Plan: ${analysis.text.trim()}`, '', `Building ${analysis.shape.label} with ${plan.route.label}.`, ''];
    if (plan.start.length) out.push('## Start with', ...plan.start.map(line), '');
    for (const part of plan.parts) {
      out.push(`## ${part.label}`, part.plain, ...(part.tools.length ? part.tools.map(line) : [`- ${part.gap}`]), '');
    }
    if (plan.habits.length) out.push('## Good habits', ...plan.habits.map(line), '');
    return out.join('\n');
  }

  const api = { stem, tokenize, analyse, planFor, toMarkdown };
  (root.Cuecode ??= {}).finder = api;
})(globalThis);
