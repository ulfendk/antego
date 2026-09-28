import { minigameOutcome, resolveBattle } from './battle.js';
import { BOARDS, hasAnyMove, legalTargets, pieceAt, samePos } from './board.js';
import { mixSeed } from './rng.js';
import { validatePlacement } from './setup.js';
import {
  DEFAULT_OPTIONS,
  MINIGAMES,
  type Action,
  type BoardId,
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

export interface GameSetup {
  /** Classic 10×10 for two; the plus-shaped "kryds" board for three or four. */
  board?: BoardId;
  players?: 2 | 3 | 4;
}

export function createGame(
  seed: number,
  options: Partial<GameOptions> = {},
  setup: GameSetup = {},
): GameState {
  const board = setup.board ?? 'klassisk';
  const teams = [...BOARDS[board].seats[setup.players ?? 2]];
  return {
    phase: 'setup',
    options: { ...DEFAULT_OPTIONS, ...options },
    board,
    teams,
    out: [],
    seed: seed >>> 0,
    battleCount: 0,
    turn: teams[0]!,
    turnNumber: 0,
    placed: {},
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
      doResign(state, events, action.team);
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
  if (!state.teams.includes(team)) throw new RuleError('ikke med i spillet');
  if (state.placed[team]) throw new RuleError('allerede stillet op');
  const problem = validatePlacement(team, placement, BOARDS[state.board]);
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
  if (state.teams.every((t) => state.placed[t])) {
    state.phase = 'play';
    state.turn = state.teams[0]!;
    state.turnNumber = 1;
    events.push({ type: 'started' }, { type: 'turn', team: state.turn });
  }
}

function doMove(state: GameState, events: GameEvent[], team: Team, pieceId: string, to: Pos) {
  if (state.phase !== 'play') throw new RuleError('ikke tid til at flytte');
  if (state.turn !== team || state.out.includes(team)) throw new RuleError('ikke din tur');
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.team !== team) throw new RuleError('ukendt brik');
  if (
    !legalTargets(state.pieces, state.history, piece, BOARDS[state.board]).some((t) =>
      samePos(t, to),
    )
  ) {
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

  // Taking the flag knocks that army out (and wins outright when it was the last enemy).
  if (defender.rank === 'flag' && outcome === 'attacker') {
    if (knockOut(state, events, defender.team, 'flag')) return;
  }
  endTurn(state, events);
}

function doResign(state: GameState, events: GameEvent[], team: Team) {
  if (state.phase === 'over') throw new RuleError('spillet er slut');
  if (!state.teams.includes(team) || state.out.includes(team))
    throw new RuleError('ikke med i spillet');
  // A battle this army was part of is called off.
  if (state.phase === 'battle') {
    state.phase = 'play';
    state.pendingBattle = null;
  }
  if (knockOut(state, events, team, 'opgivet')) return;
  if (state.turn === team && state.phase === 'play') endTurn(state, events);
}

/** Hand the turn to the next army still in the game; armies that can't move are knocked out. */
function endTurn(state: GameState, events: GameEvent[]) {
  const board = BOARDS[state.board];
  let i = state.teams.indexOf(state.turn);
  for (let step = 0; step < state.teams.length; step++) {
    i = (i + 1) % state.teams.length;
    const team = state.teams[i]!;
    if (state.out.includes(team)) continue;
    if (team !== state.turn && !hasAnyMove(state.pieces, state.history, team, board)) {
      if (knockOut(state, events, team, 'ingen-traek')) return;
      continue;
    }
    state.turn = team;
    state.turnNumber++;
    events.push({ type: 'turn', team });
    return;
  }
}

/**
 * An army is out. If only one is left it wins; otherwise the loser's remaining soldiers are
 * packed into its toy box and the game goes on. Returns true when the game is over.
 */
function knockOut(state: GameState, events: GameEvent[], team: Team, reason: WinReason): boolean {
  if (!state.out.includes(team)) state.out.push(team);
  const active = state.teams.filter((t) => !state.out.includes(t));
  if (active.length <= 1) {
    finish(state, events, active[0] ?? team, reason);
    return true;
  }
  const removed = state.pieces.filter((p) => p.team === team);
  for (const p of removed) p.revealed = true;
  state.pieces = state.pieces.filter((p) => p.team !== team);
  state.fallen.push(...removed);
  state.history = state.history.filter((m) => m.team !== team);
  events.push({ type: 'out', team, reason, removed: removed.map((p) => p.id) });
  return false;
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
