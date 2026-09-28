import { audioContext, unlockAudio } from './context.js';

/**
 * Toy-box sound effects, synthesised with Web Audio: plastic clicks, cardboard taps, cork
 * pops, springy boings and little bugle fanfares. Nothing to download, nothing violent.
 */
export type Sound =
  | 'click'
  | 'tick'
  | 'tap'
  | 'flip'
  | 'clash'
  | 'fanfare'
  | 'victory'
  | 'sad'
  | 'bum'
  | 'defuse'
  | 'sneaky'
  | 'clatter'
  | 'rattle'
  | 'pop'
  | 'hop'
  | 'thud'
  | 'beep'
  | 'beepHigh'
  | 'whistle'
  | 'engine'
  | 'whoosh'
  | 'squeak'
  | 'drive'
  | 'rumble'
  | 'splash';

const KEY = 'antego.sfx';

type Out = AudioNode;

let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function output(ctx: AudioContext): Out {
  if (!master) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(ctx.destination);
  }
  return master;
}

function noiseBuffer(ctx: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

const vary = (x: number, amount = 0.06) => x * (1 + (Math.random() * 2 - 1) * amount);

/** Attack/decay envelope on a gain node. */
function envelope(g: GainNode, t: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  t: number;
  dur: number;
  gain: number;
  attack?: number;
  vibrato?: { rate: number; depth: number };
  lowpass?: number;
}

function tone(ctx: AudioContext, out: Out, o: ToneOpts) {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, o.t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, o.t + o.dur);
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.vibrato.rate;
    depth.gain.value = o.vibrato.depth;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.t);
    lfo.stop(o.t + o.dur + 0.05);
  }
  const g = ctx.createGain();
  envelope(g, o.t, o.gain, o.attack ?? 0.005, o.dur);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    node = osc.connect(f);
  }
  node.connect(g).connect(out);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.05);
}

interface NoiseOpts {
  t: number;
  dur: number;
  gain: number;
  type: BiquadFilterType;
  freq: number;
  freq1?: number;
  q?: number;
  attack?: number;
}

function noise(ctx: AudioContext, out: Out, o: NoiseOpts) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, o.t);
  if (o.freq1) f.frequency.exponentialRampToValueAtTime(o.freq1, o.t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  envelope(g, o.t, o.gain, o.attack ?? 0.002, o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(o.t, Math.random() * 0.5);
  src.stop(o.t + o.dur + 0.05);
}

/** One hard-plastic click (a base touching cardboard, a soldier knocking another). */
function plasticClick(ctx: AudioContext, out: Out, t: number, gain = 0.35) {
  noise(ctx, out, { t, dur: 0.025, gain, type: 'bandpass', freq: vary(2800, 0.25), q: 5 });
  tone(ctx, out, { t, dur: 0.035, gain: gain * 0.3, f0: vary(1500, 0.3) });
}

/** A little bugle tune: [frequency, seconds] pairs. */
function bugle(ctx: AudioContext, out: Out, t: number, notes: [number, number][], gain = 0.16) {
  let at = t;
  for (const [f, d] of notes) {
    tone(ctx, out, {
      type: 'sawtooth',
      f0: f,
      t: at,
      dur: d + 0.06,
      gain,
      attack: 0.02,
      lowpass: 2400,
      vibrato: d > 0.25 ? { rate: 5.5, depth: f * 0.012 } : undefined,
    });
    tone(ctx, out, {
      type: 'square',
      f0: f / 2,
      t: at,
      dur: d + 0.04,
      gain: gain * 0.25,
      attack: 0.02,
      lowpass: 900,
    });
    at += d;
  }
}

const N = {
  C4: 262,
  D4: 294,
  E4: 330,
  F4: 349,
  G4: 392,
  A4: 440,
  C5: 523,
  E5: 659,
  G5: 784,
  C6: 1047,
};

/** A little toy engine going past: a putt-putting low buzz that rises and falls (Doppler-ish). */
function engine(ctx: AudioContext, out: Out, t: number, dur = 3.6, pitch = 58, rate = 17) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(pitch, t);
  osc.frequency.linearRampToValueAtTime(pitch * 1.3, t + dur * 0.45);
  osc.frequency.linearRampToValueAtTime(pitch * 0.9, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 520;
  const putt = ctx.createGain();
  putt.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(putt.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f).connect(putt).connect(g).connect(out);
  for (const o of [osc, lfo]) {
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const SOUNDS: Record<Sound, (ctx: AudioContext, out: Out, t: number) => void> = {
  engine: (c, o, t) => engine(c, o, t),
  // Driving over the board: a longer putt-putt (jeep) and a deep clanking rumble (tank).
  drive: (c, o, t) => engine(c, o, t, 7, 62, 19),
  rumble: (c, o, t) => {
    engine(c, o, t, 9, 46, 9);
    for (let i = 0; i < 40; i++) {
      noise(c, o, {
        t: t + 0.4 + i * 0.2,
        dur: 0.04,
        gain: 0.02 + 0.09 * Math.sin((i / 40) * Math.PI),
        type: 'bandpass',
        freq: vary(900, 0.2),
        q: 6,
      });
    }
  },
  // Wheels hitting the water: a wet noise burst and a couple of bubbly blips.
  splash: (c, o, t) => {
    noise(c, o, { t, dur: 0.5, gain: 0.28, type: 'lowpass', freq: 2600, freq1: 500, attack: 0.01 });
    noise(c, o, { t, dur: 0.25, gain: 0.12, type: 'highpass', freq: 3000, attack: 0.005 });
    for (let i = 0; i < 3; i++) {
      tone(c, o, {
        type: 'sine',
        f0: vary(500, 0.3),
        f1: vary(1100, 0.2),
        t: t + 0.08 + i * 0.09,
        dur: 0.07,
        gain: 0.06,
      });
    }
  },
  whoosh: (c, o, t) =>
    noise(c, o, {
      t,
      dur: 2.4,
      gain: 0.08,
      type: 'bandpass',
      freq: 400,
      freq1: 1400,
      q: 1.2,
      attack: 0.9,
    }),
  squeak: (c, o, t) => {
    for (let i = 0; i < 3; i++) {
      tone(c, o, {
        f0: vary(1250, 0.1),
        f1: 1500,
        t: t + i * 0.18,
        dur: 0.12,
        gain: 0.05,
        vibrato: { rate: 40, depth: 60 },
      });
    }
  },
  click: (c, o, t) => {
    tone(c, o, { type: 'triangle', f0: 1400, f1: 900, t, dur: 0.045, gain: 0.12 });
    noise(c, o, { t, dur: 0.02, gain: 0.06, type: 'highpass', freq: 4000 });
  },
  tick: (c, o, t) => plasticClick(c, o, t, 0.3),
  tap: (c, o, t) => {
    noise(c, o, { t, dur: 0.07, gain: 0.45, type: 'lowpass', freq: vary(650) });
    tone(c, o, { f0: vary(160), f1: 90, t, dur: 0.09, gain: 0.3 });
    plasticClick(c, o, t + 0.004, 0.12);
  },
  flip: (c, o, t) => {
    noise(c, o, {
      t,
      dur: 0.16,
      gain: 0.4,
      type: 'bandpass',
      freq: 700,
      freq1: 3200,
      q: 1.5,
      attack: 0.04,
    });
    plasticClick(c, o, t + 0.16, 0.25);
  },
  // Cork gun pop, then a springy boing as the two soldiers square up.
  clash: (c, o, t) => {
    tone(c, o, { f0: 1300, f1: 170, t, dur: 0.08, gain: 0.45 });
    noise(c, o, { t, dur: 0.035, gain: 0.3, type: 'bandpass', freq: 1500, q: 2 });
    tone(c, o, {
      f0: 340,
      f1: 170,
      t: t + 0.06,
      dur: 0.45,
      gain: 0.28,
      vibrato: { rate: 28, depth: 50 },
    });
  },
  fanfare: (c, o, t) =>
    bugle(c, o, t, [
      [N.G4, 0.11],
      [N.C5, 0.11],
      [N.E5, 0.11],
      [N.G5, 0.42],
    ]),
  victory: (c, o, t) => {
    bugle(c, o, t, [
      [N.G4, 0.14],
      [N.G4, 0.07],
      [N.C5, 0.14],
      [N.E5, 0.14],
      [N.G5, 0.3],
      [N.E5, 0.12],
      [N.G5, 0.7],
    ]);
    // A little snare roll underneath.
    for (let i = 0; i < 12; i++)
      noise(c, o, { t: t + i * 0.05, dur: 0.05, gain: 0.08, type: 'highpass', freq: 2500 });
  },
  // "Womp womp": gentle, not mean.
  sad: (c, o, t) =>
    bugle(
      c,
      o,
      t,
      [
        [N.G4, 0.3],
        [370, 0.3],
        [N.F4, 0.3],
        [N.E4, 0.8],
      ],
      0.12,
    ),
  // A toy "bum" with a puff of dust: a thump and a soft rumble, no crack.
  bum: (c, o, t) => {
    tone(c, o, { f0: 120, f1: 38, t, dur: 0.55, gain: 0.6 });
    noise(c, o, { t, dur: 0.7, gain: 0.5, type: 'lowpass', freq: 1400, freq1: 180 });
    for (let i = 0; i < 5; i++)
      plasticClick(c, o, t + 0.25 + i * 0.07 + Math.random() * 0.04, 0.08);
  },
  defuse: (c, o, t) => {
    plasticClick(c, o, t, 0.2);
    tone(c, o, { f0: 880, t: t + 0.05, dur: 0.22, gain: 0.22 });
    tone(c, o, { f0: 1320, t: t + 0.17, dur: 0.35, gain: 0.22 });
  },
  // Tiptoeing plucks, then "ta-da!"
  sneaky: (c, o, t) => {
    const plucks = [N.G4, N.E4, N.D4];
    plucks.forEach((f, i) =>
      tone(c, o, { type: 'triangle', f0: f, t: t + i * 0.16, dur: 0.1, gain: 0.25 }),
    );
    bugle(
      c,
      o,
      t + 0.55,
      [
        [N.C5, 0.12],
        [N.G5, 0.45],
      ],
      0.14,
    );
  },
  // A plastic soldier toppling: clicks bouncing faster and quieter.
  clatter: (c, o, t) => {
    const hits = [0, 0.12, 0.21, 0.28, 0.33, 0.36];
    hits.forEach((d, i) => plasticClick(c, o, t + d, 0.4 * (1 - i / 7)));
    noise(c, o, { t, dur: 0.08, gain: 0.25, type: 'lowpass', freq: 500 });
  },
  // Dropped into the cardboard toy box among the others.
  rattle: (c, o, t) => {
    noise(c, o, { t, dur: 0.12, gain: 0.35, type: 'lowpass', freq: 350 });
    for (let i = 0; i < 14; i++)
      plasticClick(c, o, t + Math.random() * 0.45, 0.06 + Math.random() * 0.14);
  },
  pop: (c, o, t) => {
    tone(c, o, { f0: vary(900), f1: 220, t, dur: 0.07, gain: 0.35 });
    noise(c, o, { t, dur: 0.03, gain: 0.25, type: 'bandpass', freq: 2000, q: 2 });
  },
  hop: (c, o, t) =>
    tone(c, o, {
      f0: vary(420, 0.1),
      f1: 260,
      t,
      dur: 0.14,
      gain: 0.18,
      vibrato: { rate: 30, depth: 30 },
    }),
  thud: (c, o, t) => {
    noise(c, o, { t, dur: 0.15, gain: 0.5, type: 'lowpass', freq: 400 });
    tone(c, o, { f0: 110, f1: 60, t, dur: 0.18, gain: 0.35 });
  },
  beep: (c, o, t) =>
    tone(c, o, { type: 'square', f0: 660, t, dur: 0.14, gain: 0.08, lowpass: 2000 }),
  beepHigh: (c, o, t) =>
    tone(c, o, { type: 'square', f0: 990, t, dur: 0.3, gain: 0.09, lowpass: 2500 }),
  // Sergeant's whistle.
  whistle: (c, o, t) => {
    tone(c, o, {
      f0: 2100,
      f1: 2500,
      t,
      dur: 0.45,
      gain: 0.16,
      attack: 0.02,
      vibrato: { rate: 14, depth: 160 },
    });
    noise(c, o, { t, dur: 0.45, gain: 0.04, type: 'highpass', freq: 5000, attack: 0.02 });
  },
};

class Sfx {
  enabled = readEnabled();

  play(sound: Sound, delayMs = 0) {
    if (!this.enabled) return;
    const ctx = audioContext() ?? (navigator.userActivation?.hasBeenActive ? unlockAudio() : null);
    if (!ctx || ctx.state !== 'running') return;
    try {
      SOUNDS[sound](ctx, output(ctx), ctx.currentTime + 0.01 + delayMs / 1000);
    } catch (err) {
      // A sound must never break the game.
      console.warn(err);
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // Not remembered in private mode.
    }
  }
}

function readEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const sfx = new Sfx();

/** Debug: render a sound offline and measure it (used to check nothing is silent or clipping). */
export async function measureSound(sound: Sound) {
  const rate = 44100;
  const off = new OfflineAudioContext(1, rate * 3, rate);
  SOUNDS[sound](off as unknown as AudioContext, off.destination, 0.01);
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i]!);
    peak = Math.max(peak, v);
    sum += v * v;
    if (v > 0.002) last = i;
  }
  return {
    peak: +peak.toFixed(3),
    rms: +Math.sqrt(sum / d.length).toFixed(4),
    secs: +(last / rate).toFixed(2),
  };
}

export const ALL_SOUNDS = Object.keys(SOUNDS) as Sound[];
