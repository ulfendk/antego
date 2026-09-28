import {
  BOARD_SIZE,
  RANKS,
  type MoveRecord,
  type PieceView,
  type Pos,
  type Team,
} from './types.js';

/** The two 2×2 lakes in the middle of the board. */
export const LAKES: readonly Pos[] = [
  { x: 2, y: 4 },
  { x: 3, y: 4 },
  { x: 2, y: 5 },
  { x: 3, y: 5 },
  { x: 6, y: 4 },
  { x: 7, y: 4 },
  { x: 6, y: 5 },
  { x: 7, y: 5 },
];

/** Max consecutive back-and-forth moves of one piece between the same two squares. */
export const MAX_SHUTTLE_MOVES = 3;

export const isLake = (p: Pos) => LAKES.some((l) => l.x === p.x && l.y === p.y);
export const inBounds = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < BOARD_SIZE && p.y < BOARD_SIZE;
export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

/** Green sets up on the bottom four rows (y 6–9), brown on the top four (y 0–3). */
export function homeRows(team: Team): number[] {
  return team === 'groen' ? [6, 7, 8, 9] : [0, 1, 2, 3];
}

export function isHomeSquare(team: Team, p: Pos): boolean {
  return inBounds(p) && homeRows(team).includes(p.y);
}

export function pieceAt(pieces: readonly PieceView[], p: Pos): PieceView | undefined {
  return pieces.find((q) => q.x === p.x && q.y === p.y);
}

const DIRS: readonly Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Squares a piece may move to (empty or enemy-occupied). Works on a player's view,
 * since it only needs the rank of the player's own pieces.
 */
export function legalTargets(
  pieces: readonly PieceView[],
  history: readonly MoveRecord[],
  piece: PieceView,
): Pos[] {
  if (!piece.rank || !RANKS[piece.rank].movable) return [];
  const range = piece.rank === 'spejder' ? BOARD_SIZE : 1;
  const out: Pos[] = [];
  for (const d of DIRS) {
    for (let step = 1; step <= range; step++) {
      const p = { x: piece.x + d.x * step, y: piece.y + d.y * step };
      if (!inBounds(p) || isLake(p)) break;
      const occupant = pieceAt(pieces, p);
      if (occupant?.team === piece.team) break;
      if (!isShuttleBlocked(history, piece, p)) out.push(p);
      if (occupant) break; // can attack, but not jump past
    }
  }
  return out;
}

/** Simplified two-square rule: a piece may not shuttle between the same two squares forever. */
export function isShuttleBlocked(
  history: readonly MoveRecord[],
  piece: PieceView,
  to: Pos,
): boolean {
  const from = { x: piece.x, y: piece.y };
  const own = history.filter((m) => m.team === piece.team);
  let run = 0;
  for (let i = own.length - 1; i >= 0; i--) {
    const m = own[i]!;
    const shuttles =
      m.pieceId === piece.id &&
      ((samePos(m.from, from) && samePos(m.to, to)) ||
        (samePos(m.from, to) && samePos(m.to, from)));
    if (!shuttles) break;
    run++;
  }
  return run >= MAX_SHUTTLE_MOVES;
}

export function hasAnyMove(
  pieces: readonly PieceView[],
  history: readonly MoveRecord[],
  team: Team,
): boolean {
  return pieces.some((p) => p.team === team && legalTargets(pieces, history, p).length > 0);
}
