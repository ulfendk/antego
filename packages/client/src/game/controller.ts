import {
  aiMinigameScore,
  applyAction,
  chooseAiMove,
  createGame,
  randomPlacement,
  randomSeed,
  viewFor,
  PRESET_IDS,
  presetPlacement,
  type Action,
  type Difficulty,
  type GameEvent,
  type GameOptions,
  type GameState,
  type GameView,
  type Placement,
  type Pos,
  type Team,
} from '@antego/shared';

export type Listener = (view: GameView, events: GameEvent[]) => void;

/** What the app talks to, whether the game runs on this device or on the server. */
export interface Controller {
  readonly mode: 'ai' | 'hotseat' | 'online';
  subscribe(fn: Listener): void;
  setup(team: Team, placement: Placement[]): void;
  move(team: Team, pieceId: string, to: Pos): void;
  resign(team: Team): void;
  dispose(): void;
}

/** Runs the shared engine on this device: hot-seat for two kids, or against the computer. */
export class LocalController implements Controller {
  private state: GameState;
  private listeners: Listener[] = [];
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  /** Who is looking at the screen right now (hot-seat hands the device over; null hides every rank). */
  viewer: Team | null;
  readonly aiTeam: Team | null;

  constructor(
    readonly mode: 'ai' | 'hotseat',
    options: Partial<GameOptions>,
    private difficulty: Difficulty = 'mellem',
  ) {
    this.state = createGame(randomSeed(), options);
    this.aiTeam = mode === 'ai' ? 'brun' : null;
    this.viewer = 'groen';
    if (this.aiTeam) {
      const seed = randomSeed();
      const pick = seed % (PRESET_IDS.length + 1);
      const placement =
        pick < PRESET_IDS.length
          ? presetPlacement(this.aiTeam, PRESET_IDS[pick]!)
          : randomPlacement(this.aiTeam, seed);
      this.state = applyAction(this.state, { type: 'setup', team: this.aiTeam, placement }).state;
    }
  }

  get game(): Readonly<GameState> {
    return this.state;
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    fn(this.view(), []);
  }

  view(): GameView {
    return viewFor(this.state, this.viewer);
  }

  setup(team: Team, placement: Placement[]) {
    this.act({ type: 'setup', team, placement });
  }

  move(team: Team, pieceId: string, to: Pos) {
    this.act({ type: 'move', team, pieceId, to });
  }

  resign(team: Team) {
    this.act({ type: 'resign', team });
  }

  dispose() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.listeners = [];
  }

  private act(action: Action) {
    const { state, events } = applyAction(this.state, action);
    this.state = state;
    const v = this.view();
    for (const l of this.listeners) l(v, events);
    this.afterAction();
  }

  private afterAction() {
    const s = this.state;
    // Mini-games aren't in this build yet: settle any battle with simulated scores.
    if (s.phase === 'battle' && s.pendingBattle) {
      const b = s.pendingBattle;
      this.act({
        type: 'minigameResult',
        scores: {
          attacker: aiMinigameScore('mellem', b.handicap.attacker, b.seed),
          defender: aiMinigameScore('mellem', b.handicap.defender, b.seed + 1),
        },
      });
      return;
    }
    if (s.phase === 'play' && s.turn === this.aiTeam) this.scheduleAi();
  }

  /** Called by the app once the human's move animation has played, so the bot doesn't feel instant. */
  private scheduleAi() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      const s = this.state;
      if (s.phase !== 'play' || s.turn !== this.aiTeam) return;
      const move = chooseAiMove(viewFor(s, this.aiTeam), this.difficulty, randomSeed());
      if (move) this.move(this.aiTeam, move.pieceId, move.to);
      else this.resign(this.aiTeam);
    }, 1600);
  }
}
