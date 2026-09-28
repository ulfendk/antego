import {
  applyAction,
  createGame,
  viewFor,
  type GameEvent,
  type GameState,
  type GameView,
  type Piece,
  type Pos,
  type Rank,
  type Team,
} from '@antego/shared';
import type { Controller, Listener } from './controller.js';

/** The practice battlefield: a handful of soldiers, a straight road for the captain to the flag. */
const LAYOUT: [Team, Rank, number, number][] = [
  ['groen', 'kaptajn', 4, 7],
  ['groen', 'spejder', 1, 8],
  ['groen', 'minoer', 6, 8],
  ['groen', 'sergent', 2, 7],
  ['groen', 'mine', 3, 9],
  ['groen', 'spion', 8, 8],
  ['groen', 'flag', 5, 9],
  ['sand', 'sergent', 4, 5],
  ['sand', 'flag', 4, 3],
  ['sand', 'mine', 8, 2],
  ['sand', 'spejder', 0, 0],
  ['sand', 'spion', 9, 1],
];

export const CAPTAIN = 'groen-kaptajn';

/**
 * Runs the real engine on the practice board. Only green plays: after each green move the
 * turn comes straight back, so the tutorial can explain at its own pace.
 */
export class TutorialController implements Controller {
  readonly mode = 'tutorial';
  private state: GameState;
  private listeners: Listener[] = [];

  constructor() {
    const pieces: Piece[] = LAYOUT.map(([team, rank, x, y]) => ({
      id: `${team}-${rank}`,
      team,
      rank,
      x,
      y,
      revealed: false,
      moved: false,
    }));
    this.state = {
      ...createGame(7, { minigames: 'aldrig' }),
      phase: 'play',
      turnNumber: 1,
      placed: { groen: true, sand: true },
      pieces,
    };
  }

  get game(): Readonly<GameState> {
    return this.state;
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    fn(this.view(), []);
  }

  view(): GameView {
    return viewFor(this.state, 'groen');
  }

  setViewer() {}

  me(): Team {
    return 'groen';
  }

  setup() {}

  move(team: Team, pieceId: string, to: Pos) {
    const { state, events } = applyAction(this.state, { type: 'move', team, pieceId, to });
    // The sand army "passes": hand the turn straight back to green.
    let out: GameEvent[] = events;
    if (state.phase === 'play' && state.turn === 'sand') {
      state.turn = 'groen';
      state.turnNumber++;
      out = events.map((e) => (e.type === 'turn' ? { type: 'turn', team: 'groen' } : e));
    }
    this.state = state;
    const v = this.view();
    for (const l of this.listeners) l(v, out);
  }

  resign() {}

  reportMinigame() {}

  localPlayers(): Team[] {
    return ['groen'];
  }

  dispose() {
    this.listeners = [];
  }
}
