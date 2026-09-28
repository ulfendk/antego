import type { Obstacle, P2 } from '../scene/drive.js';

/**
 * The race course: a closed loop marked with masking tape, round the table and across the
 * board (through both lakes), on the classic board's table layout. Pure geometry: a smooth
 * centre line sampled every STEP units, with "how far round" (s) queries.
 */

/** Centre line of the lap, clockwise from the start line on the near side of the table. */
export const WAYPOINTS: readonly P2[] = [
  { x: -1.0, z: 9.4 }, // start / finish
  { x: 3.5, z: 9.4 },
  { x: 8.5, z: 9.6 },
  { x: 11.8, z: 9.3 },
  { x: 13.2, z: 7.0 },
  { x: 13.3, z: 3.6 },
  { x: 12.9, z: 0.4 },
  { x: 10.4, z: -1.0 },
  { x: 7.0, z: -1.0 },
  { x: 5.0, z: -0.9 },
  { x: 3.5, z: -0.5 }, // east lake
  { x: 2.3, z: -1.3 },
  { x: 2.0, z: -3.0 },
  { x: 2.6, z: -5.6 },
  { x: 2.0, z: -8.6 },
  { x: -0.4, z: -9.8 },
  { x: -2.8, z: -8.6 },
  { x: -2.8, z: -5.4 },
  { x: -2.3, z: -2.4 },
  { x: -2.0, z: 0.4 }, // west lake
  { x: -2.4, z: 3.2 },
  { x: -3.0, z: 5.2 },
  { x: -4.4, z: 6.0 },
  { x: -6.3, z: 5.4 },
  { x: -9.3, z: 5.9 }, // round the spare soldier
  { x: -10.0, z: 9.2 },
  { x: -7.4, z: 11.1 },
  { x: -4.6, z: 9.8 },
];

export const HALF_WIDTH = 1.4;
export const LAPS = 3;
const STEP = 0.1;

export class Track {
  readonly points: P2[];
  readonly tangents: P2[];
  readonly length: number;

  constructor(waypoints: readonly P2[] = WAYPOINTS) {
    const dense = catmullRom(waypoints, 24);
    // Resample evenly so index * STEP is the distance round the lap.
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1]!;
      const b = dense[i % dense.length]!;
      cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cum[cum.length - 1]!;
    const n = Math.round(total / STEP);
    this.length = n * STEP;
    this.points = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = (i / n) * total;
      while (cum[j + 1]! < s) j++;
      const a = dense[j]!;
      const b = dense[(j + 1) % dense.length]!;
      const k = (s - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
      this.points.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
    }
    this.tangents = this.points.map((_, i) => {
      const a = this.points[(i - 2 + n) % n]!;
      const b = this.points[(i + 2) % n]!;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    });
  }

  private index(s: number) {
    const n = this.points.length;
    return ((Math.round(s / STEP) % n) + n) % n;
  }

  /** Point on the centre line at distance s round the lap (wraps). */
  at(s: number): P2 {
    return this.points[this.index(s)]!;
  }

  tangent(s: number): P2 {
    return this.tangents[this.index(s)]!;
  }

  /** Wrap a lap distance into [0, length). */
  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }

  /**
   * Nearest point of the centre line to p, searching only within `window` of the previous s
   * (so crossing stretches and cut corners can't make a car jump ahead). Returns its s and the
   * signed distance off the line (positive to the right of the direction of travel).
   */
  nearest(p: P2, near: number, window = 4): { s: number; off: number } {
    let best = Infinity;
    let bestS = near;
    for (let d = -window; d <= window; d += STEP) {
      const q = this.at(near + d);
      const dist = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (dist < best) {
        best = dist;
        bestS = near + d;
      }
    }
    const s = this.wrap(bestS);
    const q = this.at(s);
    const t = this.tangent(s);
    // Right of travel is (-t.z, t.x) in x/z.
    const off = (p.x - q.x) * -t.z + (p.z - q.z) * t.x;
    return { s, off };
  }

  /** Global search (for placing things). */
  nearestAnywhere(p: P2): { s: number; dist: number } {
    let best = Infinity;
    let at = 0;
    this.points.forEach((q, i) => {
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) {
        best = d;
        at = i;
      }
    });
    return { s: at * STEP, dist: Math.sqrt(best) };
  }

  /** Offset sideways from the centre line (positive = right of travel). */
  side(s: number, off: number): P2 {
    const q = this.at(s);
    const t = this.tangent(s);
    return { x: q.x - t.z * off, z: q.z + t.x * off };
  }
}

/**
 * Where soldiers stand as marshals (they topple when hit): just outside the tape on the outer
 * side of the sharper bends, three to a bend, clear of `keepOut` (boxes and the like).
 */
export function coneSpots(track: Track, keepOut: readonly Obstacle[] = []): P2[] {
  const n = track.points.length;
  const bend = (i: number) => {
    const a = track.tangents[(i - 8 + n) % n]!;
    const b = track.tangents[(i + 8) % n]!;
    return { amount: 1 - (a.x * b.x + a.z * b.z), dir: a.x * b.z - a.z * b.x };
  };
  const spots: P2[] = [];
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const here = bend(i).amount;
    if (here < 0.25 || here < bend((i + 1) % n).amount || here < bend((i - 1 + n) % n).amount)
      continue;
    if (i - last < 60) continue;
    last = i;
    // Turning right (dir > 0, towards +right) puts the outside on the left.
    const outer = bend(i).dir > 0 ? -1 : 1;
    for (const d of [-1.2, 0, 1.2]) {
      const p = track.side(i * STEP + d, outer * (HALF_WIDTH + 0.5));
      if (keepOut.every((o) => obstacleDistance(p, o) > 0.6)) spots.push(p);
    }
  }
  return spots;
}

/** Closed Catmull-Rom spline through the points, `per` samples per segment. */
function catmullRom(pts: readonly P2[], per: number): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}

/** Distance from p to an obstacle's edge (negative inside). */
export function obstacleDistance(p: P2, o: Obstacle) {
  if (o.kind === 'circle') return Math.hypot(p.x - o.x, p.z - o.z) - o.r;
  const qx = Math.abs(p.x - o.x) - o.hx;
  const qz = Math.abs(p.z - o.z) - o.hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
