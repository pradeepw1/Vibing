// The screens. Plain DOM, no framework, so the page opens straight from disk.
(function () {
  const { data, highlight, srs, finder, finderData } = globalThis.Cuecode;
  const app = document.getElementById('app');

  const LANGS = {
    python: { name: 'Python' },
    swift: { name: 'Swift' },
    java: { name: 'Java' },
    cobol: { name: 'COBOL' },
    jcl: { name: 'JCL' },
    js: { name: 'JavaScript' },
    ts: { name: 'TypeScript' },
    html: { name: 'HTML' },
    css: { name: 'CSS' },
  };
  const ROUTE_LANG = { python: 'python', swift: 'swift', java: 'java', frontend: 'js', mainframe: 'cobol' };
  const NEW_PER_DAY = 15;
  const SESSION_SIZE = 25;

  const DECKS = [
    { id: 'python', name: 'Python', lang: 'python', blurb: 'Slices, lists, and the traps everyone falls in.' },
    { id: 'swift', name: 'Swift', lang: 'swift', blurb: 'Optionals, structs, classes and SwiftUI.' },
    { id: 'java', name: 'Java', lang: 'java', blurb: 'Types, strings, and how the JVM fits in.' },
    { id: 'cobol', name: 'COBOL', lang: 'cobol', blurb: 'PIC clauses, tables and silent truncation.' },
    { id: 'mainframe', name: 'Mainframe sense', lang: 'jcl', blurb: 'JCL, ABENDs, CICS, Db2: how the big iron thinks.' },
    { id: 'frontend', name: 'Frontend', lang: 'js', blurb: 'JavaScript, TypeScript, HTML and CSS.' },
    { id: 'bridge', name: 'Between languages', blurb: 'See it in one language, write it in another.' },
    { id: 'words', name: 'Plain words', blurb: 'What all the terms actually mean.' },
  ];
  const AREAS = [
    ['all', 'All'], ['basics', 'Basics'], ['python', 'Python'], ['swift', 'Swift'], ['java', 'Java'],
    ['frontend', 'Frontend'], ['mainframe', 'Mainframe'], ['web', 'Web and tools'],
  ];
  const KIND_LABEL = {
    predict: 'What does it print?', fill: 'Fill the gap', fix: 'Fix the bug',
    write: 'Write it', explain: 'Explain it', translate: 'Between languages',
  };
  const EXAMPLES = [
    'An iPhone app that tracks my workouts, shows progress charts and reminds me to train',
    'A website where people log in and pay for a monthly subscription',
    'Scrape prices from websites every morning and email me when one drops',
    'A nightly batch job that reads customer records and updates balances',
    'A chatbot that answers questions about my PDFs',
    'A REST API that gets customer data from the mainframe',
  ];

  // ---- Saved state ---------------------------------------------------------
  // Browser storage can be empty or blocked, so nothing here is relied on.
  const KEY = 'cuecode.v1';
  const defaults = () => ({
    cards: {}, newToday: { day: '', count: 0 }, streak: null,
    langs: ['python', 'swift', 'java', 'cobol'], decksOff: [], lastText: '',
  });
  const load = () => {
    try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults(); }
  };
  let store = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* still works, just won't persist */ } };

  // ---- Small helpers -------------------------------------------------------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  }
  const inline = (text) => text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((part) => {
    if (part[0] === '`') return h('code', { class: 'ic' }, part.slice(1, -1));
    if (part.startsWith('**')) return h('strong', null, part.slice(2, -2));
    return part;
  });
  const paras = (text) => text.split(/\n\s*\n/).map((p) => h('p', null, inline(p.replace(/\n/g, ' '))));
  const codeBlock = (code, lang) => h('pre', { class: `code lang-${lang}`, tabindex: '0' },
    h('code', { html: highlight(code, lang) }));
  const conceptById = (id) => data.concepts.find((c) => c.id === id);
  const docById = (id) => data.docs.find((d) => d.id === id);

  function toast(text) {
    document.querySelector('.toast')?.remove();
    const el = h('div', { class: 'toast', role: 'status' }, text);
    document.body.append(el);
    setTimeout(() => el.remove(), 1600);
  }
  async function copy(text, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast(label);
  }

  // ---- Cards: hand-written, plus two decks built from the other content ----
  const STARTERS = ['python', 'swift', 'java', 'cobol', 'js'];
  const PAIRS = [['python', 'swift'], ['python', 'java'], ['python', 'cobol'], ['java', 'cobol'], ['python', 'js'], ['js', 'ts'], ['swift', 'java']];
  function bridgeCards() {
    const cards = [];
    for (const c of data.concepts) {
      for (const [from, to] of PAIRS) {
        const a = c.langs[from];
        const b = c.langs[to];
        if (!a?.code || !b?.code || a.checked !== 'ran' || b.checked !== 'ran') continue;
        cards.push({
          id: `x-${c.id}-${from}-${to}`, deck: 'bridge', kind: 'translate',
          ask: `${c.title}: write this in ${LANGS[to].name}.`,
          lang: from, code: a.code, answerLang: to, answer: b.code, why: b.note, checked: 'ran',
        });
      }
    }
    return cards;
  }
  const wordCards = () => data.docs.map((d) => ({
    id: `w-${d.id}`, deck: 'words', kind: 'explain',
    ask: `In plain words, what is ${/^[A-Z]{2,}/.test(d.title) ? d.title : d.title.toLowerCase()}?`,
    answer: d.simple, why: d.like ? `Think of it like this: ${d.like}` : undefined,
  }));
  const allCards = [...data.cards, ...bridgeCards(), ...wordCards()];
  const cardsIn = (deck) => allCards.filter((c) => c.deck === deck);

  // New cards should mix the decks, not run through one and then the next.
  function interleave(lists) {
    const out = [];
    const rest = lists.map((l) => [...l]);
    while (rest.some((l) => l.length)) rest.forEach((l) => { if (l.length) out.push(l.shift()); });
    return out;
  }
  const activeCards = () => interleave(DECKS.filter((d) => !store.decksOff.includes(d.id)).map((d) => cardsIn(d.id)));

  function newAllowance(now) {
    const today = srs.dayKey(now);
    const used = store.newToday.day === today ? store.newToday.count : 0;
    return Math.max(0, NEW_PER_DAY - used);
  }
  function todayQueue(now) {
    return srs.buildQueue(activeCards(), store.cards, { now, newLeft: newAllowance(now), limit: SESSION_SIZE });
  }
  function reviewsWaiting(now) {
    return activeCards().filter((c) => !srs.isNew(store.cards[c.id]) && store.cards[c.id].due <= now).length;
  }

  // ---- Frame ---------------------------------------------------------------
  const NAV = [
    ['describe', 'Describe', 'M4 6h16M4 12h10M4 18h13'],
    ['cards', 'Cards', 'M4 7h16v12H4zM4 11h16'],
    ['compare', 'Compare', 'M4 5h7v14H4zM13 5h7v14h-7z'],
    ['docs', 'Docs', 'M6 4h12v16H6zM9 9h6M9 13h6'],
  ];
  const navIcon = (d) => {
    const wrap = h('span', { html: `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>` });
    return wrap.firstChild;
  };
  function isDark() {
    const set = document.documentElement.dataset.theme;
    return set ? set === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function frame(section, body) {
    const due = reviewsWaiting(Date.now());
    const themeBtn = h('button', {
      class: 'icon-btn', title: 'Light or dark', 'aria-label': 'Switch between light and dark',
      onclick() {
        const next = isDark() ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        store.theme = next;
        save();
      },
    }, '◐');
    app.replaceChildren(
      h('header', { class: 'top' }, h('div', { class: 'top-in' },
        h('a', { class: 'brand', href: '#/describe' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Cuecode'),
        h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(([id, label, icon]) =>
          h('a', { href: `#/${id}`, 'aria-current': section === id ? 'page' : null },
            navIcon(icon), label, id === 'cards' && due > 0 ? h('span', { class: 'badge' }, String(due)) : null))),
        themeBtn)),
      h('main', { class: 'main' }, body));
  }

  // ---- Describe ------------------------------------------------------------
  const describe = { text: '', shape: null, route: null, result: null };

  function runFinder() {
    const text = describe.text.trim();
    describe.result = text ? finder.analyse(text, finderData, { shape: describe.shape }) : null;
    if (describe.result && !describe.route) describe.route = describe.result.best;
    store.lastText = text;
    save();
  }

  function toolView(t) {
    return h('div', { class: 'tool' },
      h('div', null, h('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.name)),
      h('p', null, inline(t.why)),
      t.install && h('div', { class: 'install' },
        h('code', null, t.install),
        h('button', { class: 'mini', onclick: () => copy(t.install) }, 'Copy')));
  }
  function partView(title, plain, tools, gap) {
    return h('section', { class: `part${gap ? ' is-gap' : ''}` },
      h('h3', null, title),
      plain && h('p', { class: 'part-why' }, plain),
      gap ? h('p', { class: 'part-why', style: 'margin-top:6px' }, gap) : h('div', { class: 'tools' }, tools.map(toolView)));
  }

  function resultView(onChange) {
    const r = describe.result;
    if (!r.matched) {
      return h('div', { class: 'result' }, h('div', { class: 'notice' },
        h('strong', null, "I couldn't match that to anything yet. "),
        'Try saying where it runs and what it does, such as "an iPhone app that saves notes and sends reminders".'));
    }
    const plan = finder.planFor(r, describe.route, finderData);
    return h('div', { class: 'result' },
      h('div', { class: 'summary' },
        h('span', { class: 'eyebrow' }, "Here's what I understood"),
        h('h2', { style: 'margin-top:4px' }, `You're building ${r.shape.label}.`),
        r.caps.length ? h('div', { class: 'chips parts' }, r.caps.map((c) => h('span', { class: 'chip', title: `From: ${c.hits.join(', ')}` }, c.cap.label))) : null),
      r.assumed && h('p', { class: 'notice' }, "You didn't say where it runs, so I've guessed a website. Pick the right one below."),
      r.leftOut.length > 0 && h('p', { class: 'notice' }, `Left out, as you asked: ${r.leftOut.join(', ')}.`),
      r.missed.length > 0 && h('p', { class: 'notice' }, `Not on my list: ${r.missed.slice(0, 8).join(', ')}. I match common building blocks, so anything special to your idea may need its own research.`),
      h('div', { class: 'field-row' },
        h('span', { class: 'eyebrow' }, 'Where it runs'),
        h('div', { class: 'chips' }, finderData.shapes.map((s) => h('button', {
          class: 'chip', 'aria-pressed': String(s.id === r.shape.id),
          onclick() { describe.shape = s.id; describe.route = null; runFinder(); onChange(); },
        }, s.picker)))),
      h('div', { class: 'field-row' },
        h('span', { class: 'eyebrow' }, 'Build it with'),
        h('div', { class: 'route-tabs' }, r.routes.map((route, i) => h('button', {
          class: 'route-tab', 'data-lang': ROUTE_LANG[route.id], 'aria-pressed': String(route.id === describe.route),
          onclick() { describe.route = route.id; onChange(); },
        }, h('b', null, route.label), h('small', null,
          i === 0 ? 'Best fit' : !route.fits ? 'Not a natural fit' : route.total ? `${route.covered} of ${route.total} parts` : ' '))))),
      !plan.fits && h('p', { class: 'notice' }, `${plan.route.label} isn't a natural way to build ${r.shape.label}. ${plan.bestLabel} is. This shows only what it could do behind the scenes.`),
      h('div', { class: 'plan' },
        plan.start.length > 0 && partView('Start with', 'The foundation for this kind of project.', plan.start),
        plan.parts.map((p) => partView(p.label, p.plain, p.tools, p.gap)),
        plan.habits.length > 0 && partView('Good habits', 'Worth having from day one.', plan.habits)),
      h('div', { class: 'field-row' },
        h('span', { class: 'eyebrow' }, 'Learn these first'),
        h('div', { class: 'chips' },
          plan.learn.map((id) => conceptById(id)).filter(Boolean).map((c) =>
            h('a', { class: 'chip', href: `#/compare/${c.id}` }, c.title)),
          plan.decks.map((d) => h('a', { class: 'chip', href: `#/session/${d}`, 'data-lang': d === 'mainframe' ? 'jcl' : ROUTE_LANG[describe.route] },
            h('span', { class: 'dot' }), `Practise ${DECKS.find((x) => x.id === d).name}`)))),
      h('div', { class: 'plan-actions' },
        h('button', { class: 'btn ghost small', onclick: () => copy(finder.toMarkdown(r, plan), 'Plan copied') }, 'Copy this plan')));
  }

  function viewDescribe() {
    if (!describe.text && store.lastText) { describe.text = store.lastText; runFinder(); }
    const box = h('div');
    const fit = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
    const area = h('textarea', {
      id: 'describe-box', 'aria-label': 'Describe what you want to build',
      placeholder: 'I want to build…', rows: '3', value: describe.text,
      oninput() { describe.text = area.value; fit(); },
      onkeydown(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } },
    });
    const examples = h('div', { class: 'chips examples' }, EXAMPLES.map((text) =>
      h('button', { class: 'chip', onclick() { describe.text = text; viewDescribe(); go(); } }, text)));
    const paint = () => {
      examples.hidden = Boolean(describe.result);
      box.replaceChildren(describe.result ? resultView(paint) : '');
    };
    function go() {
      describe.shape = null;
      describe.route = null;
      runFinder();
      paint();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    frame('describe', h('div', { class: 'narrow' },
      h('div', { class: 'hero' },
        h('h1', null, 'What do you want to build?'),
        h('p', { class: 'lede' }, 'Describe it in your own words. You\'ll get the tools and libraries for it, in each language.')),
      h('div', { class: 'ask' }, area,
        h('div', { class: 'ask-foot' },
          h('small', { class: 'hide-phone' }, '⌘ Return to search'),
          h('button', { class: 'btn', onclick: go }, 'Find my tools'))),
      examples,
      box));
    paint();
    fit();
  }

  // ---- Cards hub -----------------------------------------------------------
  function viewCards() {
    const now = Date.now();
    const queue = todayQueue(now);
    const waiting = reviewsWaiting(now);
    const fresh = queue.filter((c) => srs.isNew(store.cards[c.id])).length;
    const streak = srs.liveStreak(store.streak, now);
    const known = Object.values(store.cards).filter((s) => s.interval >= 21).length;

    const importer = h('input', {
      type: 'file', accept: '.json', hidden: true,
      async onchange() {
        try {
          const saved = JSON.parse(await importer.files[0].text());
          if (typeof saved.cards !== 'object') throw new Error('not a backup');
          store = { ...defaults(), ...saved };
          save();
          toast('Progress restored');
          viewCards();
        } catch { toast("That file isn't a Cuecode backup"); }
      },
    });
    function exportProgress() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(store, null, 1)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `cuecode-progress-${srs.dayKey(now)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    }

    frame('cards', [
      h('section', { class: 'today' },
        h('div', null,
          h('h1', null, queue.length ? `${queue.length} card${queue.length === 1 ? '' : 's'} for today` : "You're all caught up"),
          h('div', { class: 'stats' },
            h('span', null, h('b', null, String(waiting)), ' to review'),
            h('span', null, h('b', null, String(fresh)), ' new'),
            h('span', null, h('b', null, String(known)), ' known well'),
            h('span', null, h('b', null, String(streak)), ' day streak'))),
        queue.length
          ? h('a', { class: 'btn', href: '#/session/today', id: 'start-today' }, 'Start')
          : h('p', { class: 'lede', style: 'margin:0' }, 'Pick a deck below for extra practice.')),
      h('div', { class: 'section-head' }, h('h2', null, 'Decks'), h('small', null, 'Ticked decks go into your daily mix')),
      h('div', { class: 'decks' }, DECKS.map((d) => {
        const cards = cardsIn(d.id);
        const s = srs.deckStats(cards, store.cards, now);
        const on = !store.decksOff.includes(d.id);
        return h('article', { class: 'deck', 'data-lang': d.lang },
          h('h3', null, d.name),
          h('p', null, d.blurb),
          h('div', { class: 'meter', 'aria-hidden': 'true' },
            h('i', { class: 'known', style: `width:${(s.known / s.total) * 100}%` }),
            h('i', { class: 'learning', style: `width:${(s.learning / s.total) * 100}%` })),
          h('div', { class: 'deck-foot' },
            h('span', null, `${s.total} cards${s.total - s.fresh ? `, ${s.total - s.fresh} seen` : ''}`),
            h('label', { class: 'check' },
              h('input', {
                type: 'checkbox', checked: on,
                onchange(e) {
                  store.decksOff = e.target.checked ? store.decksOff.filter((x) => x !== d.id) : [...store.decksOff, d.id];
                  save();
                  viewCards();
                },
              }), 'Daily')),
          h('a', { class: 'btn ghost small', href: `#/session/${d.id}` }, 'Practise this deck'));
      })),
      h('p', { class: 'fine' }, `Spaced repetition shows each card just before you'd forget it. Up to ${NEW_PER_DAY} new cards a day.`, checkedLine()),
      h('p', { class: 'fine' }, 'Progress stays in this browser. Save a backup before clearing browser data.'),
      h('div', { class: 'backup' },
        importer,
        h('button', { class: 'btn ghost small', onclick: exportProgress }, 'Save a backup'),
        h('button', { class: 'btn ghost small', onclick: () => importer.click() }, 'Restore a backup')),
    ]);
  }
  function checkedLine() {
    const names = Object.values(data.toolchains);
    return names.length ? ` Code answers were checked by really running them, on ${data.checkedOn}, with ${names.join(', ')}.` : '';
  }

  // ---- Cue card session ----------------------------------------------------
  const clean = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n').trim();
  let session = null;

  function startSession(deck) {
    const now = Date.now();
    const queue = deck === 'today'
      ? todayQueue(now)
      : srs.buildQueue(cardsIn(deck), store.cards, { now, newLeft: SESSION_SIZE, limit: SESSION_SIZE });
    session = { deck, queue, total: queue.length, done: 0, again: 0, flipped: false, typed: '' };
  }

  function rate(rating) {
    const now = Date.now();
    const card = session.queue[0];
    if (srs.isNew(store.cards[card.id])) {
      const today = srs.dayKey(now);
      const used = store.newToday.day === today ? store.newToday.count : 0;
      store.newToday = { day: today, count: used + 1 };
    }
    store.cards[card.id] = srs.review(store.cards[card.id], rating, now);
    store.streak = srs.touchStreak(store.streak, now);
    save();
    session.queue.shift();
    if (rating === 1) {
      session.queue.push(card); // forgotten cards come back before the session ends
      session.again += 1;
    } else {
      session.done += 1;
    }
    session.flipped = false;
    session.typed = '';
    viewSession();
  }

  function cardFront(card, deckName) {
    const typed = ['predict', 'fill', 'write', 'fix', 'translate'].includes(card.kind);
    const short = ['fill'].includes(card.kind);
    const input = typed && h(short ? 'input' : 'textarea', {
      id: 'card-answer', type: short ? 'text' : null, 'aria-label': 'Your answer',
      placeholder: 'Type your answer (optional)', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      value: session.typed, oninput(e) { session.typed = e.target.value; },
      onkeydown(e) {
        const done = e.key === 'Enter' && (short || e.metaKey || e.ctrlKey);
        if (done || (e.key === ' ' && !e.target.value)) { e.preventDefault(); e.stopPropagation(); flip(); }
      },
    });
    return h('div', { class: 'face front' },
      h('div', { class: 'face-head' }, h('span', { class: 'eyebrow' }, KIND_LABEL[card.kind]), h('span', { class: 'tag' }, deckName)),
      h('h2', null, inline(card.ask)),
      card.code && codeBlock(card.code, card.lang),
      input,
      h('div', { class: 'face-actions' },
        h('small', { class: 'hide-phone' }, card.kind === 'explain' ? 'Say it out loud first' : short ? 'Return to check' : '⌘ Return to check'),
        h('button', { class: 'btn', id: 'flip-btn', onclick: flip }, 'Show answer ', h('span', { class: 'kbd' }, 'Space'))));
  }

  function cardBack(card, deckName) {
    const now = Date.now();
    const state = store.cards[card.id];
    const yours = clean(session.typed);
    const exact = ['predict', 'fill'].includes(card.kind);
    const right = exact && yours && clean(card.answer) === yours;
    return h('div', { class: 'face back' },
      h('div', { class: 'face-head' }, h('span', { class: 'eyebrow' }, 'Answer'), h('span', { class: 'tag' }, deckName)),
      card.answerLang
        ? codeBlock(card.answer, card.answerLang)
        : (card.lang || card.kind === 'predict')
          ? codeBlock(card.answer, 'text')
          : h('p', { class: 'answer-text' }, inline(card.answer)),
      yours && (right
        ? h('p', { class: 'yours ok' }, 'That matches exactly.')
        : h('div', { class: 'yours no' }, exact ? 'Your answer:' : 'What you wrote:', h('pre', null, yours))),
      card.why && h('p', { class: 'why' }, inline(card.why)),
      h('div', { class: 'rates', role: 'group', 'aria-label': 'How well did you know it?' },
        [['Again', 1, 'again'], ['Hard', 2, ''], ['Good', 3, 'good'], ['Easy', 4, '']].map(([label, n, cls]) =>
          h('button', { class: `rate ${cls}`, onclick: () => rate(n) }, label, ' ', h('span', { class: 'kbd' }, String(n)),
            h('small', null, srs.nextLabel(state, n, now))))));
  }

  function flip() {
    if (!session || session.flipped) return;
    session.flipped = true;
    const root = document.querySelector('.flip');
    root.classList.add('is-back');
    root.querySelector('.back').replaceWith(cardBack(session.queue[0], deckLabel(session.queue[0])));
    root.querySelector('.front').inert = true;
    root.querySelector('.back').inert = false;
    root.querySelector('.rate.good')?.focus({ preventScroll: true });
  }
  const deckLabel = (card) => DECKS.find((d) => d.id === card.deck).name;

  function viewSession() {
    if (!session.queue.length) {
      frame('cards', h('div', { class: 'session' }, h('div', { class: 'done-card' },
        h('h1', null, session.total ? 'All done' : 'Nothing here right now'),
        h('p', { class: 'lede' }, session.total
          ? `${session.done} card${session.done === 1 ? '' : 's'} reviewed${session.again ? `, ${session.again} needed another go` : ''}. They'll come back when it's time.`
          : "You've done everything that's due in this deck."),
        h('a', { class: 'btn', href: '#/cards' }, 'Back to decks'))));
      return;
    }
    const card = session.queue[0];
    const label = deckLabel(card);
    const pct = session.total ? (session.done / session.total) * 100 : 0;
    const back = h('div', { class: 'face back' });
    back.inert = true;
    frame('cards', h('div', { class: 'session' },
      h('div', { class: 'session-top' },
        h('a', { class: 'btn ghost small', href: '#/cards' }, 'Stop'),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Session progress' }, h('i', { style: `width:${pct}%` })),
        h('small', null, `${session.done} of ${session.total}`)),
      h('div', { class: 'flip' }, h('div', { class: 'flip-in' }, cardFront(card, label), back))));
    document.getElementById('card-answer')?.focus({ preventScroll: true });
  }

  function sessionKeys(e) {
    if (!session || !location.hash.startsWith('#/session/') || !session.queue.length) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName ?? '');
    if (!session.flipped && !typing && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); return; }
    if (session.flipped && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rate(Number(e.key)); }
  }

  // ---- Live preview, in a locked-down frame --------------------------------
  // sandbox="allow-scripts" gives the code no access to this page or its saved
  // progress, and the CSP stops it reaching the network.
  function buildDoc(lang, code, demo) {
    const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
    const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:12px;color:#1d2126;background:#fff}</style>
<script>(function(){
  var show=function(a){return typeof a==='string'?a:a===undefined?'undefined':(function(){try{return JSON.stringify(a)}catch(e){return String(a)}})()};
  var send=function(kind,args){parent.postMessage({cuecode:kind,text:Array.prototype.map.call(args,show).join(' ')},'*')};
  console.log=function(){send('log',arguments)};
  console.error=function(){send('error',arguments)};
  addEventListener('error',function(e){send('error',[e.message])});
  addEventListener('unhandledrejection',function(e){send('error',[String(e.reason)])});
  var size=function(){parent.postMessage({cuecode:'size',height:Math.ceil(document.body?document.body.getBoundingClientRect().height+24:40)},'*')};
  addEventListener('load',function(){size();new ResizeObserver(size).observe(document.body)});
})();<\/script>`;
    if (lang === 'html') return head + code.replace(/^<!doctype html>\s*/i, '');
    if (lang === 'css') return `${head}<style>${code.replace(/<\/style/gi, '')}</style>${demo ?? ''}`;
    return `${head}${demo ?? ''}<script type="module">${safe(code)}<\/script>`;
  }

  window.addEventListener('message', (e) => {
    const frameEl = [...document.querySelectorAll('iframe.preview')].find((f) => f.contentWindow === e.source);
    if (!frameEl || typeof e.data?.cuecode !== 'string') return;
    if (e.data.cuecode === 'size') {
      if (!frameEl.dataset.fill) frameEl.style.height = `${Math.min(e.data.height, 320)}px`;
    } else if (frameEl.logTo) {
      frameEl.logTo.append(h('div', { class: e.data.cuecode === 'error' ? 'err' : null }, e.data.text));
    }
  });

  function preview(lang, code, demo) {
    const frameEl = h('iframe', { class: 'preview', sandbox: 'allow-scripts', title: 'Live result', style: 'height:64px' });
    frameEl.srcdoc = buildDoc(lang, code, demo);
    return h('div', { class: 'preview-wrap' }, frameEl);
  }

  function openPlayground(lang, code, demo, title) {
    const frameEl = h('iframe', { class: 'preview', sandbox: 'allow-scripts', title: 'Live result', 'data-fill': '1' });
    const log = h('pre', { class: 'pg-log' });
    frameEl.logTo = log;
    const area = h('textarea', { class: 'pg-code', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Code', value: code });
    const run = () => { log.replaceChildren(); frameEl.srcdoc = buildDoc(lang, area.value, demo); };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      }
    });
    const consoleOnly = lang === 'js' && !demo;
    const dialog = h('dialog', { class: `pg${consoleOnly ? ' console-only' : ''}`, 'aria-label': title },
      h('div', { class: 'pg-head' },
        h('b', null, title),
        h('button', { class: 'btn small', onclick: run }, 'Run ', h('span', { class: 'kbd' }, '⌘↩')),
        h('button', { class: 'btn ghost small', onclick: () => dialog.close() }, 'Close')),
      h('div', { class: 'pg-body' }, area, h('div', { class: 'pg-out' }, frameEl, log)));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    run();
    area.focus();
  }

  // ---- Compare -------------------------------------------------------------
  const CHECKED = {
    ran: (lang) => [`Ran ✓`, `Really ran on ${data.toolchains[lang] ?? 'this Mac'}. The output shown is what it printed.`],
    compiled: (lang) => ['Compiled ✓', `Passed ${data.toolchains[lang] ?? 'the compiler'}, but opens a window, so wasn't run.`],
    live: () => ['Live', 'Running right here in your browser.'],
  };

  function panel(concept, lang) {
    const s = concept.langs[lang];
    if (s.skip) {
      return h('section', { class: 'panel is-skip', 'data-lang': lang },
        h('div', { class: 'panel-head' }, h('span', { class: 'dot' }), LANGS[lang].name), h('p', null, s.skip));
    }
    const [label, title] = (CHECKED[s.checked] ?? (() => ['Not run', s.why ?? "Couldn't be run here."]))(lang);
    const playable = ['html', 'css', 'js'].includes(lang) && s.play !== 'no' && s.hl !== 'bash';
    const hl = s.hl ?? lang;
    return h('section', { class: 'panel', 'data-lang': lang },
      h('div', { class: 'panel-head' },
        h('span', { class: 'dot' }), LANGS[lang].name,
        s.hl !== 'bash' && h('span', { class: `checked${s.checked === 'ran' ? ' ran' : ''}`, title }, label),
        h('span', { class: 'spacer' }),
        playable && h('button', {
          class: 'mini', onclick: () => openPlayground(lang, s.code, s.demo, `${concept.title} in ${LANGS[lang].name}`),
        }, 'Try it'),
        h('button', { class: 'mini', 'aria-label': `Copy the ${LANGS[lang].name} code`, onclick: () => copy(s.code) }, 'Copy')),
      codeBlock(s.code, hl),
      s.output != null && h('div', { class: 'output' }, h('span', null, 'Output'), h('pre', null, s.output)),
      s.run === 'live' && hl !== 'bash' && preview(lang, s.code, s.demo),
      s.note && h('p', { class: 'panel-note' }, inline(s.note)));
  }

  function viewCompare(id) {
    const concept = conceptById(id) ?? data.concepts[0];
    const groups = [...new Set(data.concepts.map((c) => c.group))];
    const index = data.concepts.indexOf(concept);
    const prev = data.concepts[index - 1];
    const next = data.concepts[index + 1];
    const have = Object.keys(LANGS).filter((l) => concept.langs[l]);
    const shown = have.filter((l) => store.langs.includes(l));

    const picker = h('div', { class: 'picker' }, h('div', { class: 'picker-row' }, Object.keys(LANGS).map((lang) =>
      h('button', {
        class: 'chip', 'data-lang': lang, 'aria-pressed': String(store.langs.includes(lang)), disabled: !concept.langs[lang],
        style: concept.langs[lang] ? null : 'opacity:.4',
        onclick() {
          store.langs = store.langs.includes(lang) ? store.langs.filter((l) => l !== lang) : [...store.langs, lang];
          save();
          viewCompare(concept.id);
        },
      }, h('span', { class: 'dot' }), LANGS[lang].name))));

    const select = h('select', {
      class: 'side-select', 'aria-label': 'Choose a topic',
      onchange(e) { location.hash = `#/compare/${e.target.value}`; },
    }, groups.map((g) => h('optgroup', { label: g }, data.concepts.filter((c) => c.group === g).map((c) =>
      h('option', { value: c.id, selected: c.id === concept.id }, c.title)))));

    frame('compare', h('div', { class: 'split' },
      h('aside', { class: 'side', 'aria-label': 'Topics' }, groups.map((g) => [
        h('h4', null, g),
        data.concepts.filter((c) => c.group === g).map((c) =>
          h('a', { href: `#/compare/${c.id}`, 'aria-current': c.id === concept.id ? 'page' : null }, c.title)),
      ])),
      h('article', { class: 'concept' },
        select,
        h('h1', null, concept.title),
        h('p', { class: 'lede' }, concept.blurb),
        h('div', { class: 'prose' }, paras(concept.explain)),
        picker,
        shown.length
          ? h('div', { class: 'panels' }, shown.map((lang) => panel(concept, lang)))
          : h('p', { class: 'notice' }, 'Pick a language above to see the code.'),
        shown.includes('cobol') && concept.langs.cobol?.code && concept.langs.cobol.hl !== 'bash' && concept.langs.cobol.hl !== 'text' &&
          h('p', { class: 'fine' }, 'The faint lines on COBOL code mark columns 8 and 12. The red line is column 72, where the compiler stops reading.'),
        concept.mainframe && h('section', { class: 'mf' }, h('h2', null, 'Mainframe sense'), h('div', { class: 'prose', style: 'margin-top:0' }, paras(concept.mainframe))),
        concept.docs.length > 0 && h('div', { class: 'related' },
          h('span', { class: 'eyebrow' }, 'In plain words'),
          h('div', { class: 'chips', style: 'margin-top:7px' }, concept.docs.map((d) => docById(d)).filter(Boolean).map((d) =>
            h('a', { class: 'chip', href: `#/docs/${d.id}` }, d.title)))),
        h('nav', { class: 'pager', 'aria-label': 'Next and previous topic' },
          prev ? h('a', { class: 'btn ghost small', href: `#/compare/${prev.id}` }, `← ${prev.title}`) : h('span'),
          next ? h('a', { class: 'btn ghost small', href: `#/compare/${next.id}` }, `${next.title} →`) : h('span')),
        h('p', { class: 'fine' }, checkedLine().trim()))));
  }

  // ---- Docs ----------------------------------------------------------------
  const docsState = { query: '', area: 'all' };

  function docMatches() {
    const q = docsState.query.trim().toLowerCase();
    const inArea = data.docs.filter((d) => docsState.area === 'all' || d.area === docsState.area);
    if (!q) return inArea;
    const rank = (d) => {
      const title = d.title.toLowerCase();
      if (title === q || d.aka.some((a) => a.toLowerCase() === q)) return 0;
      if (title.startsWith(q)) return 1;
      if (title.includes(q) || d.aka.some((a) => a.toLowerCase().includes(q))) return 2;
      if (`${d.simple} ${d.more ?? ''}`.toLowerCase().includes(q)) return 3;
      return 9;
    };
    return inArea.map((d) => [rank(d), d]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0]).map(([, d]) => d);
  }

  function docPage(doc) {
    const concept = doc.see && conceptById(doc.see);
    return h('article', { class: 'doc-page' },
      h('span', { class: 'eyebrow' }, AREAS.find(([a]) => a === doc.area)?.[1]),
      h('h1', null, doc.title),
      h('p', { class: 'simple' }, inline(doc.simple)),
      doc.like && h('div', { class: 'like' }, h('b', null, 'Think of it like'), inline(doc.like)),
      doc.more && h('p', { class: 'doc-more' }, inline(doc.more)),
      doc.examples.map((e) => codeBlock(e.code, e.lang)),
      doc.aka.length > 0 && h('p', { class: 'aka' }, `Also called or seen as: ${doc.aka.join(', ')}`),
      h('div', { class: 'doc-actions' },
        concept && h('a', { class: 'btn small', href: `#/compare/${concept.id}` }, 'See it in every language'),
        doc.links.map((l) => h('a', { class: 'btn ghost small', href: l.url, target: '_blank', rel: 'noopener' }, `${l.label} ↗`))));
  }

  function viewDocs(id) {
    const doc = docById(id);
    const list = h('div', { class: 'doc-links' });
    const paint = () => {
      const items = docMatches();
      list.replaceChildren(...(items.length
        ? items.map((d) => h('a', { class: 'doc-link', href: `#/docs/${d.id}`, 'aria-current': d.id === id ? 'page' : null },
          h('b', null, d.title), h('small', null, d.simple.replace(/`/g, ''))))
        : [h('p', { class: 'notice' }, 'Nothing found. Try a shorter word.')]));
    };
    const filter = h('div', { class: 'chips docs-filter' }, AREAS.map(([area, label]) => h('button', {
      class: 'chip', 'aria-pressed': String(docsState.area === area),
      onclick() { docsState.area = area; viewDocs(id); },
    }, label)));
    frame('docs', h('div', { class: `docs${doc ? ' has-doc' : ''}` },
      h('div', { class: 'docs-list' },
        h('input', {
          class: 'search', type: 'search', placeholder: 'Search, like "S0C7" or "closure"', 'aria-label': 'Search the docs',
          value: docsState.query, oninput(e) { docsState.query = e.target.value; paint(); },
        }),
        filter, list),
      doc ? docPage(doc) : h('div', { class: 'doc-page' },
        h('h1', null, 'Docs in simple words'),
        h('p', { class: 'simple' }, 'Every term in one plain sentence, with something familiar to compare it to.'),
        h('p', { class: 'doc-more' }, `${data.docs.length} terms so far. Pick one from the list, or search for it.`))));
    paint();
  }

  // ---- Routing -------------------------------------------------------------
  function route() {
    const [section, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (section === 'cards') viewCards();
    else if (section === 'session') {
      if (!session || session.deck !== id) startSession(id);
      viewSession();
    } else if (section === 'compare') viewCompare(id);
    else if (section === 'docs') viewDocs(id);
    else viewDescribe();
    if (section !== 'session') session = null;
  }

  document.addEventListener('keydown', sessionKeys);
  window.addEventListener('hashchange', route);
  route();
})();
