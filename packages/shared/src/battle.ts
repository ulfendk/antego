import {
  RANKS,
  type BattleOutcome,
  type BattleReason,
  type MinigameMode,
  type Rank,
} from './types.js';

/** Largest head start a mini-game supports (kept for scoring; equal soldiers get none). */
export const MAX_HANDICAP = 3;

export type BattleDecision =
  | { kind: 'auto'; outcome: BattleOutcome; reason: BattleReason }
  | {
      kind: 'minigame';
      handicap: { attacker: number; defender: number };
    };

export function resolveBattle(attacker: Rank, defender: Rank, mode: MinigameMode): BattleDecision {
  if (defender === 'flag') return { kind: 'auto', outcome: 'attacker', reason: 'flag' };
  if (defender === 'mine') {
    return attacker === 'minoer'
      ? { kind: 'auto', outcome: 'attacker', reason: 'mine-desarmeret' }
      : { kind: 'auto', outcome: 'defender', reason: 'mine' };
  }
  if (attacker === 'spion' && defender === 'marskal') {
    return { kind: 'auto', outcome: 'attacker', reason: 'spion' };
  }

  // The stronger soldier always wins. Only equally matched soldiers duel in a mini-game
  // (or, without mini-games, both fall as in classic Stratego).
  const diff = RANKS[attacker].strength - RANKS[defender].strength;
  if (diff !== 0) {
    return { kind: 'auto', outcome: diff > 0 ? 'attacker' : 'defender', reason: 'staerkere' };
  }
  if (mode === 'aldrig') return { kind: 'auto', outcome: 'both', reason: 'lige' };
  return { kind: 'minigame', handicap: { attacker: 0, defender: 0 } };
}

/**
 * Mini-game scores are normalised to 0–100. Higher score wins; on a tie the
 * stronger soldier wins, and equal soldiers both fall (as in Stratego).
 */
export function minigameOutcome(
  scores: { attacker: number; defender: number },
  handicap: { attacker: number; defender: number },
): BattleOutcome {
  const a = clampScore(scores.attacker);
  const d = clampScore(scores.defender);
  if (a > d) return 'attacker';
  if (d > a) return 'defender';
  if (handicap.attacker > handicap.defender) return 'attacker';
  if (handicap.defender > handicap.attacker) return 'defender';
  return 'both';
}

export function clampScore(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : 0;
}
