// A quiet sound to go with it (off unless you turn it on, and never on the desktop wallpaper): a low drone that slowly
// opens and closes, a faint wind, and now and then a soft bell. All made as it plays, with the Web Audio API: no
// recordings. Out among the galaxies it goes deeper and darker.

/** The bells' notes (a pentatonic scale, so any two sound well together), at home and away. */
export const BELLS = {
  home: [440, 523.25, 587.33, 659.25, 783.99, 880],
  away: [293.66, 349.23, 392, 440, 523.25, 587.33],
};
/** The drone's root, and the gap until the next bell (seconds). */
export const DRONE = { home: 55, away: 41.2 };
export const bellGap = (random = Math.random) => 6 + random() * 10;

/** A room for the sound to ring in: a few seconds of noise dying away (left and right different, so it feels wide). */
export function roomEcho(ctx, seconds = 5, random = Math.random) {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buffer;
}

export function createSound() {
  let ctx = null;
  let master = null;
  let parts = null;
  let on = false;
  let mood = "home";
  let bellTimer = 0;

  function build() {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const echo = ctx.createConvolver();
    echo.buffer = roomEcho(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    echo.connect(wet).connect(master);

    // The drone: a root, its fifth and its octave, through a filter that slowly opens and closes.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.05;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 150;
    sweep.connect(sweepDepth).connect(filter.frequency);
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.5;
    filter.connect(droneGain);
    droneGain.connect(master);
    droneGain.connect(echo);
    const voices = [
      [1, "sine", 0, 0.5],
      [1.5, "sine", 4, 0.25],
      [2, "triangle", -6, 0.12],
    ].map(([ratio, type, detune, level]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = DRONE.home * ratio;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      return { o, g, ratio };
    });
    // The fifth comes and goes, very slowly.
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.031;
    const breatheDepth = ctx.createGain();
    breatheDepth.gain.value = 0.15;
    breathe.connect(breatheDepth).connect(voices[1].g.gain);

    // The wind: noise through a band filter, rising and falling.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n.length; i++) n[i] = last = last * 0.97 + (Math.random() * 2 - 1) * 0.03 * 8; // (softened: less hiss)
    const wind = ctx.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 700;
    band.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.07;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.025;
    gust.connect(gustDepth).connect(windGain.gain);
    wind.connect(band).connect(windGain);
    windGain.connect(echo);
    windGain.connect(master);

    for (const v of voices) v.o.start();
    for (const s of [sweep, breathe, gust, wind]) s.start();
    parts = { filter, voices, echo };
    return true;
  }

  function bell() {
    if (!on || !ctx || ctx.state !== "running") return;
    const notes = BELLS[mood];
    const f = notes[Math.floor(Math.random() * notes.length)];
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    g.connect(parts.echo);
    g.connect(master);
    for (const [ratio, level] of [[1, 1], [2.76, 0.18]]) {
      // (A bell's overtones aren't whole multiples: 2.76 gives it its ring.)
      const o = ctx.createOscillator();
      o.frequency.value = f * ratio;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 5.1);
    }
  }

  function scheduleBell() {
    clearTimeout(bellTimer);
    if (!on) return;
    bellTimer = setTimeout(() => {
      bell();
      scheduleBell();
    }, bellGap() * 1000);
  }

  // Browsers only let sound start from a click or a key press: if it's on from the start, it waits for the first one.
  function wake() {
    if (on && ctx?.state === "suspended" && !document.hidden) ctx.resume();
  }
  addEventListener("pointerdown", wake, true);
  addEventListener("keydown", wake, true);
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else wake();
  });

  return {
    start() {
      if (on) return;
      if (!ctx && !build()) return;
      on = true;
      wake();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.18, t + 3);
      scheduleBell();
    },
    stop() {
      if (!on) return;
      on = false;
      clearTimeout(bellTimer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 1);
      setTimeout(() => !on && ctx.suspend(), 1200);
    },
    /** "home" among the planets, "away" out among the galaxies. */
    setMood(m) {
      if (m === mood) return;
      mood = m;
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const v of parts.voices) v.o.frequency.setTargetAtTime(DRONE[m] * v.ratio, t, 2);
      parts.filter.frequency.setTargetAtTime(m === "away" ? 260 : 400, t, 2);
    },
    get on() {
      return on;
    },
    get running() {
      return ctx?.state === "running";
    },
  };
}
