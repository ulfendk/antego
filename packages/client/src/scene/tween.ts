/** Tiny tween runner driven by the stage's frame loop. */
type Job = {
  t: number;
  dur: number;
  update: (k: number) => void;
  ease: (k: number) => number;
  done: () => void;
};

const jobs: Job[] = [];

export const ease = {
  linear: (k: number) => k,
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
  out: (k: number) => 1 - (1 - k) ** 3,
  in: (k: number) => k * k * k,
  back: (k: number) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2,
  /** Bounces like a plastic toy dropped on cardboard. */
  bounce: (k: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
};

export function tween(
  ms: number,
  update: (k: number) => void,
  e: (k: number) => number = ease.inOut,
): Promise<void> {
  return new Promise((resolve) => {
    jobs.push({ t: 0, dur: Math.max(1, ms), update, ease: e, done: resolve });
  });
}

export const wait = (ms: number) => tween(ms, () => undefined);

export function stepTweens(dtMs: number) {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]!;
    j.t += dtMs;
    const k = Math.min(1, j.t / j.dur);
    j.update(j.ease(k));
    if (k >= 1) {
      jobs.splice(i, 1);
      j.done();
    }
  }
}
