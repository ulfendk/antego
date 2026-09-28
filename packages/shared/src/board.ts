import {
  type ArmyId,
  type BoardId,
  type MoveRecord,
  type PieceView,
  type Pos,
  type Team,
  RANKS,
} from './types.js';

/**
 * Everything the rules need to know about a board: which squares exist, where the lakes are,
 * each army's home zone (in the owner's perspective) and which way is "forward" for it.
 */
export interface BoardSpec {
  id: BoardId;
  /** Width and height of the bounding square. */
  size: number;
  lakes: readonly Pos[];
  army: ArmyId;
  /** Home zone depth (rows) and width (columns), as the owner sees it. */
  homeDepth: number;
  homeWidth: number;
  /** Seat/turn order for 2, 3 and 4 players. */
  seats: Record<2 | 3 | 4, readonly Team[]>;
  /** Unit step towards the enemy for each army. */
  forward: Partial<Record<Team, Pos>>;
  playable(p: Pos): boolean;
  /** Owner's perspective → board: row 0 is the front row, column 0 the owner's left. */
  home(team: Team, row: number, col: number): Pos;
}

const lake2x2 = (x: number, y: number): Pos[] => [
  { x, y },
  { x: x + 1, y },
  { x, y: y + 1 },
  { x: x + 1, y: y + 1 },
];

/** Classic Stratego: 10×10, two 2×2 lakes, 40 pieces a side. Green at the bottom. */
const KLASSISK: BoardSpec = {
  id: 'klassisk',
  size: 10,
  lakes: [...lake2x2(2, 4), ...lake2x2(6, 4)],
  army: 'klassisk',
  homeDepth: 4,
  homeWidth: 10,
  seats: { 2: ['groen', 'sand'], 3: ['groen', 'sand'], 4: ['groen', 'sand'] },
  forward: { groen: { x: 0, y: -1 }, sand: { x: 0, y: 1 } },
  playable: (p) => p.x >= 0 && p.y >= 0 && p.x < 10 && p.y < 10,
  home: (team, row, col) =>
    team === 'groen' ? { x: col, y: 6 + row } : { x: 9 - col, y: 3 - row },
};

/**
 * The 3–4 player board: a plus shape (14×14 with the 3×3 corners cut away). Each army holds
 * one 8×3 arm; the 8×8 middle has four small lakes. Green south, grey-blue west, sand north,
 * brown east; turns go clockwise. With three armies the east arm is open ground.
 */
const KRYDS: BoardSpec = {
  id: 'kryds',
  size: 14,
  lakes: [...lake2x2(4, 4), ...lake2x2(8, 4), ...lake2x2(4, 8), ...lake2x2(8, 8)],
  army: 'lille',
  homeDepth: 3,
  homeWidth: 8,
  seats: {
    2: ['groen', 'sand'],
    3: ['groen', 'blaa', 'sand'],
    4: ['groen', 'blaa', 'sand', 'brun'],
  },
  forward: {
    groen: { x: 0, y: -1 },
    sand: { x: 0, y: 1 },
    blaa: { x: 1, y: 0 },
    brun: { x: -1, y: 0 },
  },
  playable: (p) => {
    if (p.x < 0 || p.y < 0 || p.x >= 14 || p.y >= 14) return false;
    const inCornerX = p.x < 3 || p.x > 10;
    const inCornerY = p.y < 3 || p.y > 10;
    return !(inCornerX && inCornerY);
  },
  home: (team, row, col) => {
    switch (team) {
      case 'groen':
        return { x: 3 + col, y: 11 + row };
      case 'sand':
        return { x: 10 - col, y: 2 - row };
      case 'blaa':
        return { x: 2 - row, y: 3 + col };
      case 'brun':
        return { x: 11 + row, y: 10 - col };
    }
  },
};

export const BOARDS: Record<BoardId, BoardSpec> = { klassisk: KLASSISK, kryds: KRYDS };

/** Classic board lakes (kept for callers that only deal with the 2-player board). */
export const LAKES = KLASSISK.lakes;

/** Max consecutive back-and-forth moves of one piece between the same two squares. */
export const MAX_SHUTTLE_MOVES = 3;

export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
export const isLake = (p: Pos, board: BoardSpec = KLASSISK) =>
  board.lakes.some((l) => samePos(l, p));
export const inBounds = (p: Pos, board: BoardSpec = KLASSISK) => board.playable(p);

/** All squares of an army's home zone. */
export function homeSquares(team: Team, board: BoardSpec = KLASSISK): Pos[] {
  const out: Pos[] = [];
  for (let row = 0; row < board.homeDepth; row++) {
    for (let col = 0; col < board.homeWidth; col++) out.push(board.home(team, row, col));
  }
  return out;
}

/** Classic board: green sets up on the bottom four rows (y 6–9), brown on the top four (y 0–3). */
export function homeRows(team: Team): number[] {
  return team === 'groen' ? [6, 7, 8, 9] : [0, 1, 2, 3];
}

export function isHomeSquare(team: Team, p: Pos, board: BoardSpec = KLASSISK): boolean {
  return homeSquares(team, board).some((q) => samePos(q, p));
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
  board: BoardSpec = KLASSISK,
  /** Armies on this piece's side: they block like its own and can't be attacked. */
  friends: readonly Team[] = [piece.team],
): Pos[] {
  if (!piece.rank || !RANKS[piece.rank].movable) return [];
  const range = piece.rank === 'spejder' ? board.size : 1;
  const out: Pos[] = [];
  for (const d of DIRS) {
    for (let step = 1; step <= range; step++) {
      const p = { x: piece.x + d.x * step, y: piece.y + d.y * step };
      if (!inBounds(p, board) || isLake(p, board)) break;
      const occupant = pieceAt(pieces, p);
      if (occupant && friends.includes(occupant.team)) break;
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
  board: BoardSpec = KLASSISK,
  friends: readonly Team[] = [team],
): boolean {
  return pieces.some(
    (p) => p.team === team && legalTargets(pieces, history, p, board, friends).length > 0,
  );
}
