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
  readonly mode: 'ai' | 'hotseat' | 'online' | 'tutorial';
  subscribe(fn: Listener): void;
  /** The latest view of the game for whoever is looking at this screen. */
  view(): GameView;
  /** Hot-seat hands the device over (null hides every rank); other modes ignore it. */
  setViewer(team: Team | null): void;
  /** Which army the person holding this device commands right now (null: nobody, e.g. spectating). */
  me(view: GameView): Team | null;
  setup(team: Team, placement: Placement[]): void;
  move(team: Team, pieceId: string, to: Pos): void;
  resign(team: Team): void;
  /** A mini-game score (0–100) for one side of the current battle. */
  reportMinigame(team: Team, score: number): void;
  /** Which teams play the current battle's mini-game on this device. */
  localPlayers(attacker: Team, defender: Team): Team[];
  dispose(): void;
}

/** Runs the shared engine on this device: hot-seat for two kids, or against the computer. */
export class LocalController implements Controller {
  private state: GameState;
  private listeners: Listener[] = [];
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private scores: Partial<Record<Team, number>> = {};
  /** Who is looking at the screen right now (hot-seat hands the device over; null hides every rank). */
  viewer: Team | null;
  readonly aiTeam: Team | null;

  constructor(
    readonly mode: 'ai' | 'hotseat',
    options: Partial<GameOptions>,
    private difficulty: Difficulty = 'mellem',
  ) {
    this.state = createGame(randomSeed(), options);
    this.aiTeam = mode === 'ai' ? 'sand' : null;
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

  setViewer(team: Team | null) {
    this.viewer = team;
  }

  me(view: GameView): Team {
    return this.aiTeam ? (this.aiTeam === 'groen' ? 'sand' : 'groen') : view.turn;
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

  reportMinigame(team: Team, score: number) {
    const b = this.state.pendingBattle;
    if (this.state.phase !== 'battle' || !b) return;
    this.scores[team] = score;
    const attacker = this.state.pieces.find((p) => p.id === b.attackerId)!.team;
    const defender: Team = attacker === 'groen' ? 'sand' : 'groen';
    const a = this.scores[attacker];
    const d = this.scores[defender];
    if (a === undefined || d === undefined) return;
    this.scores = {};
    this.act({ type: 'minigameResult', scores: { attacker: a, defender: d } });
  }

  localPlayers(attacker: Team, defender: Team): Team[] {
    // Hot-seat: both play on this device, the attacker first. Against the computer: only the human.
    return [attacker, defender].filter((t) => t !== this.aiTeam);
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
    // A battle goes to a mini-game: the computer "plays" its side right away; humans play in the app.
    if (s.phase === 'battle' && s.pendingBattle && this.aiTeam) {
      const b = s.pendingBattle;
      const aiAttacks = s.pieces.find((p) => p.id === b.attackerId)?.team === this.aiTeam;
      const h = aiAttacks ? b.handicap.attacker : b.handicap.defender;
      this.scores = { [this.aiTeam]: aiMinigameScore(this.difficulty, h, b.seed) };
      return;
    }
    if (s.phase === 'play' && s.turn === this.aiTeam) this.scheduleAi();
  }

  /** The bot moves after a short pause, so it doesn't feel instant. */
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
