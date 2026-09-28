import { homeRows } from './board.js';
import { createRng, shuffle } from './rng.js';
import { RANKS, RANK_ORDER, type Placement, type Rank, type Team } from './types.js';

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

/** Rows from the front line (nearest the lakes) to the back row, left to right as the owner sees it. */
export const PRESETS: Record<PresetId, readonly string[]> = {
  forsvar: ['PLPKPPKLPM', 'SNJOGYOJNS', 'NKSLNBLSKB', 'PBJNBFBPBP'],
  angreb: ['PMPKOPGKPP', 'LSKOLSKLJP', 'NBNSYJNSLN', 'BPBNBFBJBP'],
  snigende: ['PPLKPSPKLP', 'JYMNOGNOJS', 'BSLNKBPKLP', 'FBNJSBPBNB'],
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** Maps a row/column in the owner's perspective to board coordinates. */
export function ownerToBoard(team: Team, row: number, col: number) {
  const rows = homeRows(team);
  return team === 'groen' ? { x: col, y: rows[row]! } : { x: 9 - col, y: rows[3 - row]! };
}

export function presetPlacement(team: Team, id: PresetId): Placement[] {
  const out: Placement[] = [];
  PRESETS[id].forEach((line, row) => {
    [...line].forEach((ch, col) =>
      out.push({ rank: LETTER[ch]!, ...ownerToBoard(team, row, col) }),
    );
  });
  return out;
}

/** Random setup ("Bland"), with the flag on the back row behind at least one mine. */
export function randomPlacement(team: Team, seed: number): Placement[] {
  const rng = createRng(seed);
  const flagCol = Math.floor(rng() * 10);
  const ranks: Rank[] = [];
  for (const r of RANK_ORDER) {
    for (let i = 0; i < RANKS[r].count; i++) if (r !== 'flag') ranks.push(r);
  }
  // Reserve a mine in front of the flag, then shuffle the rest.
  ranks.splice(ranks.indexOf('mine'), 1);
  const rest = shuffle(ranks, rng);
  const out: Placement[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      let rank: Rank;
      if (row === 3 && col === flagCol) rank = 'flag';
      else if (row === 2 && col === flagCol) rank = 'mine';
      else rank = rest.pop()!;
      out.push({ rank, ...ownerToBoard(team, row, col) });
    }
  }
  return out;
}

/** Checks a full setup: right army composition, every piece on its own home rows, no overlaps. */
export function validatePlacement(team: Team, placement: readonly Placement[]): string | null {
  const counts = new Map<Rank, number>();
  const seen = new Set<string>();
  const rows = homeRows(team);
  for (const p of placement) {
    if (!(p.rank in RANKS)) return 'ukendt rang';
    if (!Number.isInteger(p.x) || p.x < 0 || p.x > 9 || !rows.includes(p.y))
      return 'uden for hjemmefeltet';
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return 'to brikker på samme felt';
    seen.add(key);
    counts.set(p.rank, (counts.get(p.rank) ?? 0) + 1);
  }
  for (const r of RANK_ORDER) {
    if ((counts.get(r) ?? 0) !== RANKS[r].count) return `forkert antal ${r}`;
  }
  return null;
}
