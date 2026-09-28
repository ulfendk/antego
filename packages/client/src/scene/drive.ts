import type { BoardSpec } from '@antego/shared';

/**
 * Route planning for the toy vehicles that drive across the board (an easter egg): from the
 * table on one side to the table on the other, round every soldier and table prop, preferably
 * straight through a lake. Pure maths on world x/z (1 unit = 1 square, board centred on 0).
 */

export interface P2 {
  x: number;
  z: number;
}

export type Obstacle =
  | { kind: 'rect'; x: number; z: number; hx: number; hz: number }
  | { kind: 'circle'; x: number; z: number; r: number };

export interface DriveRequest {
  board: BoardSpec;
  /** Soldiers standing on the board (world positions). */
  pieces: readonly P2[];
  obstacles: readonly Obstacle[];
  /** Vehicle footprint: half its width and half its length. */
  halfWidth: number;
  halfLength: number;
  rng?: () => number;
}

/** A soldier and its base plate, as a circle. */
export const PIECE_RADIUS = 0.3;
const GRID = 0.25;
/** How far out onto the table the route starts and ends. */
const RUN_UP = 2.6;
/** And how much further it may come from, where the table is clear. */
const RUN_IN = 6;

const half = (board: BoardSpec) => board.size / 2;

/** Whether p lies on the printed cardboard (the playable squares plus the 0.5 margin round them). */
export function onCardboard(board: BoardSpec, p: P2): boolean {
  const h = half(board);
  for (const dx of [-0.5, 0, 0.5]) {
    for (const dz of [-0.5, 0, 0.5]) {
      if (board.playable({ x: Math.floor(p.x + dx + h), y: Math.floor(p.z + dz + h) })) return true;
    }
  }
  return false;
}

export function inLake(board: BoardSpec, p: P2): boolean {
  const h = half(board);
  const x = Math.floor(p.x + h);
  const y = Math.floor(p.z + h);
  return board.lakes.some((l) => l.x === x && l.y === y);
}

/** Centres of the lakes (each a block of adjacent lake squares). */
export function lakeCentres(board: BoardSpec): P2[] {
  const h = half(board);
  const left = [...board.lakes];
  const out: P2[] = [];
  while (left.length) {
    const block = [left.pop()!];
    for (let i = 0; i < block.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        const q = left[j]!;
        if (Math.abs(q.x - block[i]!.x) + Math.abs(q.y - block[i]!.y) === 1) {
          block.push(q);
          left.splice(j, 1);
        }
      }
    }
    const n = block.length;
    out.push({
      x: block.reduce((s, q) => s + q.x, 0) / n + 0.5 - h,
      z: block.reduce((s, q) => s + q.y, 0) / n + 0.5 - h,
    });
  }
  return out;
}

/** Distance from p to the nearest soldier or prop (negative inside one). */
function clearance(p: P2, pieces: readonly P2[], obstacles: readonly Obstacle[]) {
  let d = Infinity;
  for (const q of pieces) d = Math.min(d, Math.hypot(p.x - q.x, p.z - q.z) - PIECE_RADIUS);
  for (const o of obstacles) {
    if (o.kind === 'circle') d = Math.min(d, Math.hypot(p.x - o.x, p.z - o.z) - o.r);
    else {
      const qx = Math.abs(p.x - o.x) - o.hx;
      const qz = Math.abs(p.z - o.z) - o.hz;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      d = Math.min(d, outside + Math.min(Math.max(qx, qz), 0));
    }
  }
  return d;
}

/**
 * Plans a drive, or returns null when there is no room (a crowded board). The route is a
 * dense polyline (about 5 cm spacing) whose every pose keeps the whole vehicle clear.
 */
export function planDrive(req: DriveRequest): P2[] | null {
  const rng = req.rng ?? Math.random;
  const lakes = lakeCentres(req.board);
  const lanes = lakes.length ? lakes : [{ x: 0, z: 0 }];
  // Try a few lakes and directions; the first that works wins.
  const tries: { lake: P2; alongX: boolean; sign: number }[] = [];
  for (const lake of lanes) {
    for (const alongX of [true, false]) {
      for (const sign of [1, -1]) tries.push({ lake, alongX, sign });
    }
  }
  for (let i = tries.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tries[i], tries[j]] = [tries[j]!, tries[i]!];
  }
  for (const t of tries.slice(0, 8)) {
    const route = plan(req, t.lake, t.alongX, t.sign);
    if (route) return route;
  }
  return null;
}

function plan(req: DriveRequest, lake: P2, alongX: boolean, sign: number): P2[] | null {
  const { board, pieces, obstacles, halfWidth, halfLength } = req;
  const E = half(board) + RUN_UP + 0.6;
  const n = Math.ceil((2 * E) / GRID);
  const at = (i: number, j: number): P2 => ({ x: -E + (i + 0.5) * GRID, z: -E + (j + 0.5) * GRID });
  const need = halfWidth + 0.1;
  // In "lane" coordinates: u runs along the drive (from -sign to +sign), v across it.
  const u = (p: P2) => (alongX ? p.x : p.z) * sign;
  const v = (p: P2) => (alongX ? p.z : p.x);
  const clear = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) clear[j * n + i] = clearance(at(i, j), pieces, obstacles);
  }
  // Off the cardboard only in the run-ups at either end: no sneaking round the board's side.
  const boardEnd = half(board) + 0.5;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = at(i, j);
      if (Math.abs(u(p)) < boardEnd && !onCardboard(board, p)) clear[j * n + i] = -1;
    }
  }
  const free = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < n && j < n && clear[j * n + i]! > need;

  const laneV = v(lake);
  const startU = -(half(board) + RUN_UP);
  const goalU = half(board) + RUN_UP;

  // Start: the free cell on the start line nearest the lake's lane.
  let start = -1;
  let best = Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = at(i, j);
      if (Math.abs(u(p) - startU) > GRID / 2 || !free(i, j)) continue;
      const d = Math.abs(v(p) - laneV);
      if (d < best) {
        best = d;
        start = j * n + i;
      }
    }
  }
  if (start < 0 || best > 3) return null;

  // A*: cheaper through water (it's the fun bit), dearer close to things (stay mid-gap).
  const g = new Float32Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  const open: number[] = [start];
  const f = new Float32Array(n * n).fill(Infinity);
  g[start] = 0;
  f[start] = (goalU - u(at(start % n, Math.floor(start / n)))) * 0.7;
  const closed = new Uint8Array(n * n);
  let goal = -1;
  const steps = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;
  while (open.length) {
    let k = 0;
    for (let m = 1; m < open.length; m++) if (f[open[m]!]! < f[open[k]!]!) k = m;
    const cur = open[k]!;
    open[k] = open[open.length - 1]!;
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % n;
    const cj = Math.floor(cur / n);
    const cp = at(ci, cj);
    if (u(cp) >= goalU) {
      goal = cur;
      break;
    }
    for (const [di, dj, len] of steps) {
      const ni = ci + di;
      const nj = cj + dj;
      if (!free(ni, nj)) continue;
      const nk = nj * n + ni;
      if (closed[nk]) continue;
      const np = at(ni, nj);
      const water = inLake(board, np) ? 0.7 : 1;
      const tight = 1 + 0.6 / (clear[nk]! - need + 0.25);
      const drift = 0.08 * Math.abs(v(np) - laneV);
      const cost = g[cur]! + len * GRID * (water * tight + drift);
      if (cost < g[nk]!) {
        g[nk] = cost;
        from[nk] = cur;
        f[nk] = cost + Math.max(0, goalU - u(np)) * 0.7;
        open.push(nk);
      }
    }
  }
  if (goal < 0) return null;

  const cells: P2[] = [];
  for (let c = goal; c >= 0; c = from[c]!) cells.push(at(c % n, Math.floor(c / n)));
  cells.reverse();
  // Run-ups straight out along the lane, then string-pull and round the corners.
  const route = smooth(
    pull(cells, (a, b) => lineFree(a, b, (p) => clearance(p, pieces, obstacles) > need)),
  );
  const dense = resample(route, 0.05);
  if (!sweptClear(dense, halfWidth, halfLength, pieces, obstacles)) return null;
  // Arrive from (and leave to) further out, as far as the table is clear, so the vehicle
  // doesn't pop up out of nowhere.
  const ok = (p: P2) => clearance(p, pieces, obstacles) > halfLength + 0.1;
  return [...extend(dense, 0, ok).reverse(), ...dense, ...extend(dense, dense.length - 1, ok)];
}

/** Points continuing the route straight on from one end, up to RUN_IN long. */
function extend(route: readonly P2[], end: number, ok: (p: P2) => boolean): P2[] {
  const h = headingAt(route, end);
  const dir = end === 0 ? -1 : 1;
  const o = route[end]!;
  const out: P2[] = [];
  for (let s = 0.05; s <= RUN_IN; s += 0.05) {
    const p = { x: o.x + h.x * s * dir, z: o.z + h.z * s * dir };
    if (!ok(p)) break;
    out.push(p);
  }
  return out;
}

function lineFree(a: P2, b: P2, ok: (p: P2) => boolean) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (GRID / 2)));
  for (let s = 0; s <= steps; s++) {
    const k = s / steps;
    if (!ok({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k })) return false;
  }
  return true;
}

/** Drops grid zig-zags: keep only the points needed to see from one to the next. */
function pull(cells: P2[], visible: (a: P2, b: P2) => boolean): P2[] {
  const out = [cells[0]!];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !visible(cells[i]!, cells[j]!)) j--;
    out.push(cells[j]!);
    i = j;
  }
  return out;
}

/** Chaikin corner cutting (keeps the end points). */
function smooth(pts: P2[], rounds = 3): P2[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const q: P2[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      q.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p[p.length - 1]!);
    p = q;
  }
  return p;
}

export function resample(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [pts[0]!];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let s = step - carry;
    while (s <= len) {
      out.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len });
      s += step;
    }
    carry = len - (s - step);
  }
  const last = pts[pts.length - 1]!;
  if (Math.hypot(out[out.length - 1]!.x - last.x, out[out.length - 1]!.z - last.z) > 1e-6)
    out.push(last);
  return out;
}

/** Heading (unit vector) of a dense route at index i, looking a little ahead and behind. */
export function headingAt(route: readonly P2[], i: number, span = 6): P2 {
  const a = route[Math.max(0, i - span)]!;
  const b = route[Math.min(route.length - 1, i + span)]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

/** Every pose along the route keeps the vehicle's rectangle clear of soldiers and props. */
export function sweptClear(
  route: readonly P2[],
  halfWidth: number,
  halfLength: number,
  pieces: readonly P2[],
  obstacles: readonly Obstacle[],
): boolean {
  for (let i = 0; i < route.length; i += 2) {
    const c = route[i]!;
    const h = headingAt(route, i);
    // Sample the rectangle's outline and middle line.
    for (let a = -1; a <= 1; a += 0.25) {
      for (const b of [-1, 0, 1]) {
        const p = {
          x: c.x + h.x * a * halfLength - h.z * b * halfWidth,
          z: c.z + h.z * a * halfLength + h.x * b * halfWidth,
        };
        if (clearance(p, pieces, obstacles) < 0.02) return false;
      }
    }
  }
  return true;
}
