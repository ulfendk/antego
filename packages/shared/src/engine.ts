import { minigameOutcome, resolveBattle } from './battle.js';
import { hasAnyMove, legalTargets, pieceAt, samePos } from './board.js';
import { mixSeed } from './rng.js';
import { validatePlacement } from './setup.js';
import {
  DEFAULT_OPTIONS,
  MINIGAMES,
  other,
  type Action,
  type BattleOutcome,
  type GameEvent,
  type GameOptions,
  type GameState,
  type GameView,
  type Piece,
  type Placement,
  type Pos,
  type Team,
  type WinReason,
} from './types.js';

const HISTORY_LENGTH = 16;

/** Game state is plain JSON data. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class RuleError extends Error {}

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

export function createGame(seed: number, options: Partial<GameOptions> = {}): GameState {
  return {
    phase: 'setup',
    options: { ...DEFAULT_OPTIONS, ...options },
    seed: seed >>> 0,
    battleCount: 0,
    turn: 'groen',
    turnNumber: 0,
    placed: { groen: false, brun: false },
    pieces: [],
    fallen: [],
    history: [],
    pendingBattle: null,
    winner: null,
    winReason: null,
  };
}

/** Pure reducer: returns a new state plus the events that explain what happened (for animation). */
export function applyAction(prev: GameState, action: Action): ActionResult {
  const state = clone(prev);
  const events: GameEvent[] = [];
  switch (action.type) {
    case 'setup':
      doSetup(state, events, action.team, action.placement);
      break;
    case 'move':
      doMove(state, events, action.team, action.pieceId, action.to);
      break;
    case 'minigameResult':
      doMinigameResult(state, events, action.scores);
      break;
    case 'resign':
      if (state.phase === 'over') throw new RuleError('spillet er slut');
      finish(state, events, other(action.team), 'opgivet');
      break;
  }
  return { state, events };
}

function doSetup(
  state: GameState,
  events: GameEvent[],
  team: Team,
  placement: readonly Placement[],
) {
  if (state.phase !== 'setup') throw new RuleError('opstillingen er slut');
  if (state.placed[team]) throw new RuleError('allerede stillet op');
  const problem = validatePlacement(team, placement);
  if (problem) throw new RuleError(problem);
  placement.forEach((p, i) =>
    state.pieces.push({
      id: `${team}-${i}`,
      team,
      rank: p.rank,
      x: p.x,
      y: p.y,
      revealed: false,
      moved: false,
    }),
  );
  state.placed[team] = true;
  events.push({ type: 'placed', team });
  if (state.placed.groen && state.placed.brun) {
    state.phase = 'play';
    state.turn = 'groen';
    state.turnNumber = 1;
    events.push({ type: 'started' }, { type: 'turn', team: 'groen' });
  }
}

function doMove(state: GameState, events: GameEvent[], team: Team, pieceId: string, to: Pos) {
  if (state.phase !== 'play') throw new RuleError('ikke tid til at flytte');
  if (state.turn !== team) throw new RuleError('ikke din tur');
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.team !== team) throw new RuleError('ukendt brik');
  if (!legalTargets(state.pieces, state.history, piece).some((t) => samePos(t, to))) {
    throw new RuleError('ulovligt træk');
  }

  const from = { x: piece.x, y: piece.y };
  state.history.push({ team, pieceId, from, to: { ...to } });
  if (state.history.length > HISTORY_LENGTH) state.history.shift();
  piece.moved = true;

  const defender = pieceAt(state.pieces, to) as Piece | undefined;
  if (!defender) {
    piece.x = to.x;
    piece.y = to.y;
    events.push({ type: 'moved', pieceId, from, to: { ...to } });
    endTurn(state, events);
    return;
  }

  // Battle: both soldiers are revealed.
  piece.revealed = true;
  defender.revealed = true;
  const decision = resolveBattle(piece.rank, defender.rank, state.options.minigames);
  if (decision.kind === 'auto') {
    events.push({
      type: 'battle',
      attackerId: piece.id,
      defenderId: defender.id,
      attackerRank: piece.rank,
      defenderRank: defender.rank,
      outcome: decision.outcome,
      reason: decision.reason,
    });
    settleBattle(state, events, piece, defender, decision.outcome);
    return;
  }

  state.battleCount++;
  const seed = mixSeed(state.seed, state.battleCount);
  state.phase = 'battle';
  state.pendingBattle = {
    attackerId: piece.id,
    defenderId: defender.id,
    from,
    to: { ...to },
    game: MINIGAMES[seed % MINIGAMES.length]!,
    seed,
    handicap: decision.handicap,
  };
  events.push({
    type: 'battle',
    attackerId: piece.id,
    defenderId: defender.id,
    attackerRank: piece.rank,
    defenderRank: defender.rank,
    outcome: null,
    reason: 'minispil',
  });
}

function doMinigameResult(
  state: GameState,
  events: GameEvent[],
  scores: { attacker: number; defender: number },
) {
  const battle = state.pendingBattle;
  if (state.phase !== 'battle' || !battle) throw new RuleError('ingen kamp i gang');
  const attacker = state.pieces.find((p) => p.id === battle.attackerId)!;
  const defender = state.pieces.find((p) => p.id === battle.defenderId)!;
  state.pendingBattle = null;
  state.phase = 'play';
  settleBattle(state, events, attacker, defender, minigameOutcome(scores, battle.handicap));
}

function settleBattle(
  state: GameState,
  events: GameEvent[],
  attacker: Piece,
  defender: Piece,
  outcome: BattleOutcome,
) {
  const fallen: Piece[] = [];
  if (outcome === 'attacker' || outcome === 'both') fallen.push(defender);
  if (outcome === 'defender' || outcome === 'both') fallen.push(attacker);
  state.pieces = state.pieces.filter((p) => !fallen.includes(p));
  state.fallen.push(...fallen);
  if (outcome === 'attacker') {
    attacker.x = defender.x;
    attacker.y = defender.y;
  }
  events.push({ type: 'battleResolved', outcome, fallen: fallen.map((p) => p.id) });

  if (defender.rank === 'flag' && outcome === 'attacker') {
    finish(state, events, attacker.team, 'flag');
    return;
  }
  endTurn(state, events);
}

function endTurn(state: GameState, events: GameEvent[]) {
  const next = other(state.turn);
  if (!hasAnyMove(state.pieces, state.history, next)) {
    finish(state, events, state.turn, 'ingen-traek');
    return;
  }
  state.turn = next;
  state.turnNumber++;
  events.push({ type: 'turn', team: next });
}

function finish(state: GameState, events: GameEvent[], winner: Team, reason: WinReason) {
  state.phase = 'over';
  state.pendingBattle = null;
  state.winner = winner;
  state.winReason = reason;
  // At the end everything is shown.
  for (const p of state.pieces) p.revealed = true;
  events.push({ type: 'over', winner, reason });
}

/** What one team is allowed to see: enemy ranks stay hidden until revealed (or the game is over). */
export function viewFor(state: GameState, viewer: Team | null): GameView {
  const hide = (p: Piece) => ({
    ...p,
    rank: p.revealed || p.team === viewer || state.phase === 'over' ? p.rank : null,
  });
  return {
    ...clone(state),
    viewer,
    pieces: state.pieces.map(hide),
    fallen: state.fallen.map(hide),
  };
}
