import { CLOSE_FIGHT_MAX_DIFF, MAX_HANDICAP } from './battle.js';
import { legalTargets, pieceAt } from './board.js';
import { createRng } from './rng.js';
import {
  RANKS,
  type GameView,
  type MinigameMode,
  type PieceView,
  type Pos,
  type Rank,
} from './types.js';

export type Difficulty = 'let' | 'mellem' | 'svaer';

export interface AiMove {
  pieceId: string;
  to: Pos;
}

/** How much a piece is worth keeping (roughly its strength, with special pieces bumped up). */
const VALUE: Record<Rank, number> = {
  marskal: 20,
  general: 14,
  oberst: 10,
  major: 8,
  kaptajn: 6,
  loejtnant: 5,
  sergent: 4,
  minoer: 6,
  spejder: 2,
  spion: 9,
  mine: 3,
  flag: 1000,
};

const NOISE: Record<Difficulty, number> = { let: 12, mellem: 5, svaer: 1.5 };

/**
 * Heuristic bot. It only uses a player's view: enemy ranks are unknown unless revealed,
 * but it knows which enemy pieces have moved (so they're not mines or the flag).
 */
export function chooseAiMove(view: GameView, difficulty: Difficulty, seed: number): AiMove | null {
  const me = view.turn;
  const rng = createRng(seed);
  const mine = view.pieces.filter((p) => p.team === me);
  const enemies = view.pieces.filter((p) => p.team !== me);
  const knownStrong = enemies.filter((e) => e.rank && RANKS[e.rank].movable);

  let best: AiMove | null = null;
  let bestScore = -Infinity;
  for (const piece of mine) {
    for (const to of legalTargets(view.pieces, view.history, piece)) {
      let score = scoreMove(view, piece, to, knownStrong, view.options.minigames);
      score += (rng() - 0.5) * 2 * NOISE[difficulty];
      if (score > bestScore) {
        bestScore = score;
        best = { pieceId: piece.id, to };
      }
    }
  }
  return best;
}

function scoreMove(
  view: GameView,
  piece: PieceView,
  to: Pos,
  knownEnemies: PieceView[],
  mode: MinigameMode,
): number {
  const rank = piece.rank!;
  const target = pieceAt(view.pieces, to);
  // Green attacks upwards (towards y 0), brown downwards.
  const forward = piece.team === 'groen' ? piece.y - to.y : to.y - piece.y;
  let score = forward * 0.6;

  if (target) {
    score += attackScore(rank, target, mode);
  } else {
    // Don't walk next to a known stronger enemy.
    for (const e of knownEnemies) {
      if (Math.abs(e.x - to.x) + Math.abs(e.y - to.y) === 1 && beats(e.rank!, rank)) {
        score -= VALUE[rank] * 0.8;
      }
    }
    // Scouts are for probing; big pieces should stay a bit back early on.
    if (rank === 'spejder') score += 0.5;
    if (RANKS[rank].strength >= 9 && view.turnNumber < 20) score -= 1;
  }
  return score;
}

function attackScore(rank: Rank, target: PieceView, mode: MinigameMode): number {
  if (target.rank) {
    if (target.rank === 'flag') return 10_000;
    if (target.rank === 'mine') return rank === 'minoer' ? 8 : -VALUE[rank] - 5;
    const diff = RANKS[rank].strength - RANKS[target.rank].strength;
    if (rank === 'spion' && target.rank === 'marskal') return VALUE.marskal;
    const minigame =
      mode === 'altid' || (mode === 'taette' && Math.abs(diff) <= CLOSE_FIGHT_MAX_DIFF);
    // A mini-game gives the weaker side a real chance, so the odds are fuzzier.
    const pWin = minigame ? 0.5 + diff * 0.12 : diff > 0 ? 1 : diff === 0 ? 0.5 : 0;
    return pWin * VALUE[target.rank] - (1 - pWin) * VALUE[rank];
  }
  // Unknown enemy: an unmoved piece may be a mine or the flag.
  if (!target.moved) {
    if (rank === 'minoer') return 3;
    if (rank === 'spejder') return 2;
    return 1.5 - VALUE[rank] * 0.35;
  }
  // Unknown but moved: a probing attack with cheap pieces is fine, risky for valuable ones.
  return rank === 'spejder' ? 2.5 : 3 - VALUE[rank] * 0.3;
}

function beats(attacker: Rank, defender: Rank): boolean {
  if (defender === 'mine') return attacker === 'minoer';
  if (attacker === 'spion' && defender === 'marskal') return true;
  return RANKS[attacker].strength > RANKS[defender].strength;
}

const BASE_SCORE: Record<Difficulty, number> = { let: 35, mellem: 52, svaer: 68 };

/** The bot's "result" in a mini-game: noisy, better with difficulty and handicap. */
export function aiMinigameScore(difficulty: Difficulty, handicap: number, seed: number): number {
  const rng = createRng(seed ^ 0xa11ce);
  const h = Math.min(MAX_HANDICAP, Math.max(0, handicap));
  const score = BASE_SCORE[difficulty] + h * 8 + (rng() - 0.5) * 40;
  return Math.max(0, Math.min(100, Math.round(score)));
}
