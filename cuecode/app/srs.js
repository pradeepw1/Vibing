// Spaced repetition: show a card again just before you'd forget it.
// A simple form of SM-2. All pure functions, so the tests can drive them.
(function (root) {
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const START_EASE = 2.5;
  const MIN_EASE = 1.3;
  const MAX_EASE = 3.0;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const isNew = (s) => !s || s.reps === 0;

  // rating: 1 Again, 2 Hard, 3 Good, 4 Easy
  function review(state, rating, now) {
    const s = state ?? { reps: 0, ease: START_EASE, interval: 0, lapses: 0, due: now };
    let { reps, ease, interval, lapses } = s;
    const learning = reps === 0 || interval === 0;
    let wait;

    if (rating === 1) {
      lapses += learning ? 0 : 1;
      ease = clamp(ease - 0.2, MIN_EASE, MAX_EASE);
      reps = Math.max(reps, 1);
      interval = 0;
      wait = MINUTE;
    } else if (learning) {
      reps += 1;
      if (rating === 2) { interval = 0; wait = 10 * MINUTE; }
      else if (rating === 3) { interval = 1; wait = DAY; }
      else { interval = 4; wait = 4 * DAY; ease = clamp(ease + 0.15, MIN_EASE, MAX_EASE); }
    } else {
      reps += 1;
      if (rating === 2) {
        ease = clamp(ease - 0.15, MIN_EASE, MAX_EASE);
        interval = Math.max(interval + 1, Math.round(interval * 1.2));
      } else if (rating === 3) {
        interval = Math.max(interval + 1, Math.round(interval * ease));
      } else {
        interval = Math.max(interval + 2, Math.round(interval * ease * 1.3));
        ease = clamp(ease + 0.15, MIN_EASE, MAX_EASE);
      }
      wait = interval * DAY;
    }
    return { reps, ease, interval, lapses, due: now + wait, last: now };
  }

  // Words for the button: "in 10 minutes", "in 3 days".
  function nextLabel(state, rating, now) {
    const ms = review(state, rating, now).due - now;
    if (ms < DAY) {
      const mins = Math.round(ms / MINUTE);
      return mins < 2 ? 'in a minute' : `in ${mins} minutes`;
    }
    const days = Math.round(ms / DAY);
    if (days === 1) return 'tomorrow';
    if (days < 30) return `in ${days} days`;
    const months = Math.round(days / 30);
    return months === 1 ? 'in a month' : `in ${months} months`;
  }

  const dayKey = (now) => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Cards for this sitting: everything due, oldest first, then a few new ones.
  function buildQueue(cards, states, { now, newLeft, limit = 40 }) {
    const due = cards
      .filter((c) => !isNew(states[c.id]) && states[c.id].due <= now)
      .sort((a, b) => states[a.id].due - states[b.id].due);
    const fresh = cards.filter((c) => isNew(states[c.id])).slice(0, Math.max(0, newLeft));
    return [...due, ...fresh].slice(0, limit);
  }

  // A card you know well has been stretched past three weeks.
  function deckStats(cards, states, now) {
    let fresh = 0; let due = 0; let learning = 0; let known = 0;
    for (const c of cards) {
      const s = states[c.id];
      if (isNew(s)) { fresh += 1; continue; }
      if (s.due <= now) due += 1;
      if (s.interval >= 21) known += 1; else learning += 1;
    }
    return { total: cards.length, fresh, due, learning, known };
  }

  function touchStreak(streak, now) {
    const today = dayKey(now);
    const s = streak ?? { days: 0, last: null };
    if (s.last === today) return s;
    const yesterday = dayKey(now - DAY);
    return { days: s.last === yesterday ? s.days + 1 : 1, last: today };
  }

  const liveStreak = (streak, now) => {
    if (!streak?.last) return 0;
    return streak.last === dayKey(now) || streak.last === dayKey(now - DAY) ? streak.days : 0;
  };

  (root.Cuecode ??= {}).srs = { review, nextLabel, buildQueue, deckStats, dayKey, touchStreak, liveStreak, isNew, DAY, MINUTE };
})(globalThis);
