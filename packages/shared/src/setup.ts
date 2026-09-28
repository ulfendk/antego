import { BOARDS, type BoardSpec } from './board.js';
import { createRng, shuffle } from './rng.js';
import {
  ARMIES,
  RANKS,
  RANK_ORDER,
  type ArmyId,
  type Placement,
  type Rank,
  type Team,
} from './types.js';

const LETTER: Record<string, Rank> = {
  M: 'marskal',
  G: 'general',
  O: 'oberst',
  J: 'major',
  K: 'kaptajn',
  L: 'loejtnant',
  S: 'sergent',
  N: 'minoer',
  P: 'spejder',
  Y: 'spion',
  B: 'mine',
  F: 'flag',
};

export type PresetId = 'forsvar' | 'angreb' | 'snigende';

/**
 * Formations per army: rows from the front line (nearest the enemy) to the back row, left to
 * right as the owner sees it. The classic army fills 10×4, the small army 8×3.
 */
export const FORMATIONS: Record<ArmyId, Record<PresetId, readonly string[]>> = {
  klassisk: {
    forsvar: ['PLPKPPKLPM', 'SNJOGYOJNS', 'NKSLNBLSKB', 'PBJNBFBPBP'],
    angreb: ['PMPKOPGKPP', 'LSKOLSKLJP', 'NBNSYJNSLN', 'BPBNBFBJBP'],
    snigende: ['PPLKPSPKLP', 'JYMNOGNOJS', 'BSLNKBPKLP', 'FBNJSBPBNB'],
  },
  lille: {
    forsvar: ['PKPLSPKP', 'JNMOGYJL', 'NBBFBNSB'],
    angreb: ['MPGKPOKP', 'LJSYJLNP', 'BNBFBSBN'],
    snigende: ['PLPKPSKP', 'JYONMGLJ', 'FBNSBNBB'],
  },
};

/** Classic formations (kept for callers that only deal with the 2-player board). */
export const PRESETS = FORMATIONS.klassisk;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** Maps a row/column in the owner's perspective to board coordinates. */
export function ownerToBoard(
  team: Team,
  row: number,
  col: number,
  board: BoardSpec = BOARDS.klassisk,
) {
  return board.home(team, row, col);
}

export function presetPlacement(
  team: Team,
  id: PresetId,
  board: BoardSpec = BOARDS.klassisk,
): Placement[] {
  const out: Placement[] = [];
  FORMATIONS[board.army][id].forEach((line, row) => {
    [...line].forEach((ch, col) => out.push({ rank: LETTER[ch]!, ...board.home(team, row, col) }));
  });
  return out;
}

/** Random setup ("Bland"), with the flag on the back row behind a mine. */
export function randomPlacement(
  team: Team,
  seed: number,
  board: BoardSpec = BOARDS.klassisk,
): Placement[] {
  const rng = createRng(seed);
  const counts = ARMIES[board.army];
  const back = board.homeDepth - 1;
  const flagCol = Math.floor(rng() * board.homeWidth);
  const ranks: Rank[] = [];
  for (const r of RANK_ORDER) {
    for (let i = 0; i < counts[r]; i++) if (r !== 'flag') ranks.push(r);
  }
  // Reserve a mine in front of the flag, then shuffle the rest.
  ranks.splice(ranks.indexOf('mine'), 1);
  const rest = shuffle(ranks, rng);
  const out: Placement[] = [];
  for (let row = 0; row < board.homeDepth; row++) {
    for (let col = 0; col < board.homeWidth; col++) {
      let rank: Rank;
      if (row === back && col === flagCol) rank = 'flag';
      else if (row === back - 1 && col === flagCol) rank = 'mine';
      else rank = rest.pop()!;
      out.push({ rank, ...board.home(team, row, col) });
    }
  }
  return out;
}

/** Checks a full setup: right army composition, every piece on its own home zone, no overlaps. */
export function validatePlacement(
  team: Team,
  placement: readonly Placement[],
  board: BoardSpec = BOARDS.klassisk,
): string | null {
  const counts = new Map<Rank, number>();
  const seen = new Set<string>();
  const home = new Set<string>();
  for (let row = 0; row < board.homeDepth; row++) {
    for (let col = 0; col < board.homeWidth; col++) {
      const p = board.home(team, row, col);
      home.add(`${p.x},${p.y}`);
    }
  }
  for (const p of placement) {
    if (!(p.rank in RANKS)) return 'ukendt rang';
    const key = `${p.x},${p.y}`;
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !home.has(key))
      return 'uden for hjemmefeltet';
    if (seen.has(key)) return 'to brikker på samme felt';
    seen.add(key);
    counts.set(p.rank, (counts.get(p.rank) ?? 0) + 1);
  }
  const army = ARMIES[board.army];
  for (const r of RANK_ORDER) {
    if ((counts.get(r) ?? 0) !== army[r]) return `forkert antal ${r}`;
  }
  return null;
}
