import type { LineId } from '../generated/lines.js';

interface Manifest {
  [id: string]: { file: string; text: string; speaker: string };
}

const KEY = 'antego.voice';

/**
 * Plays the pre-rendered Røst voice lines (packages/client/public/voice). Speech is queued;
 * something new to say interrupts what's being said. Lines without a rendering are skipped.
 */
class Voice {
  private manifest: Manifest = {};
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private queue: LineId[] = [];
  private current: AudioBufferSourceNode | null = null;
  private generation = 0;
  enabled = readEnabled();

  async load() {
    try {
      const res = await fetch('/voice/manifest.json');
      if (res.ok) this.manifest = (await res.json()) as Manifest;
    } catch {
      // Offline without a cached manifest: the game just stays quiet.
    }
  }

  /** Browsers only allow audio after a user gesture; call from the first tap. */
  unlock() {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.9;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  has(id: LineId) {
    return id in this.manifest;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // Not remembered in private mode.
    }
    if (!on) this.stop();
  }

  /** Say one or more lines in order, cutting off whatever was being said. */
  say(ids: LineId | LineId[]) {
    if (!this.enabled) return;
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => this.has(id));
    if (!list.length) return;
    this.stop();
    this.queue = list;
    for (const id of list) void this.buffer(id); // start fetching them all
    void this.next(this.generation);
  }

  stop() {
    this.generation++;
    this.queue = [];
    try {
      this.current?.stop();
    } catch {
      // Already stopped.
    }
    this.current = null;
  }

  private buffer(id: LineId): Promise<AudioBuffer | null> {
    const file = this.manifest[id]!.file;
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`/voice/${file}`)
        .then((r) => r.arrayBuffer())
        .then((data) => (this.ctx ? this.ctx.decodeAudioData(data) : null))
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p;
  }

  private async next(gen: number) {
    const id = this.queue.shift();
    if (!id || !this.ctx || !this.gain || gen !== this.generation) return;
    const buf = await this.buffer(id);
    if (gen !== this.generation) return;
    if (!buf) return void this.next(gen);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.onended = () => {
      if (this.current === src) this.current = null;
      if (gen === this.generation) setTimeout(() => void this.next(gen), 120);
    };
    this.current = src;
    src.start();
  }
}

function readEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const voice = new Voice();
