import {
  aiMinigameScore,
  applyAction,
  BOARDS,
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

/**
 * Runs the shared engine on this device: hot-seat for 2–4 kids, or one child against 1–3
 * computer armies. Two armies play classic Stratego; three or four use the plus board.
 */
export class LocalController implements Controller {
  private state: GameState;
  private listeners: Listener[] = [];
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private scores: Partial<Record<Team, number>> = {};
  /** Who is looking at the screen right now (hot-seat hands the device over; null hides every rank). */
  viewer: Team | null;
  /** Armies played by the computer (everyone but green, against the computer). */
  readonly aiTeams: readonly Team[];

  constructor(
    readonly mode: 'ai' | 'hotseat',
    options: Partial<GameOptions>,
    private difficulty: Difficulty = 'mellem',
    players: 2 | 3 | 4 = 2,
  ) {
    const board = players > 2 ? 'kryds' : 'klassisk';
    this.state = createGame(randomSeed(), options, { board, players });
    this.aiTeams = mode === 'ai' ? this.state.teams.filter((t) => t !== 'groen') : [];
    this.viewer = 'groen';
    for (const team of this.aiTeams) {
      const seed = randomSeed();
      const pick = seed % (PRESET_IDS.length + 1);
      const spec = BOARDS[board];
      const placement =
        pick < PRESET_IDS.length
          ? presetPlacement(team, PRESET_IDS[pick]!, spec)
          : randomPlacement(team, seed, spec);
      this.state = applyAction(this.state, { type: 'setup', team, placement }).state;
    }
  }

  private isAi(team: Team) {
    return this.aiTeams.includes(team);
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
    return this.aiTeams.length ? 'groen' : view.turn;
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
    const defender = this.state.pieces.find((p) => p.id === b.defenderId)!.team;
    const a = this.scores[attacker];
    const d = this.scores[defender];
    if (a === undefined || d === undefined) return;
    this.scores = {};
    this.act({ type: 'minigameResult', scores: { attacker: a, defender: d } });
  }

  localPlayers(attacker: Team, defender: Team): Team[] {
    // Hot-seat: both play on this device, the attacker first. Against the computer: only the human.
    return [attacker, defender].filter((t) => !this.isAi(t));
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
    // A battle goes to a mini-game: computer armies "play" their side right away; humans play in
    // the app. Two computer armies fighting each other are settled on the spot.
    if (s.phase === 'battle' && s.pendingBattle && this.aiTeams.length) {
      const b = s.pendingBattle;
      const att = s.pieces.find((p) => p.id === b.attackerId)!.team;
      const def = s.pieces.find((p) => p.id === b.defenderId)!.team;
      this.scores = {};
      if (this.isAi(att))
        this.scores[att] = aiMinigameScore(this.difficulty, b.handicap.attacker, b.seed);
      if (this.isAi(def))
        this.scores[def] = aiMinigameScore(this.difficulty, b.handicap.defender, b.seed + 1);
      if (this.isAi(att) && this.isAi(def)) {
        const scores = { attacker: this.scores[att]!, defender: this.scores[def]! };
        this.scores = {};
        this.act({ type: 'minigameResult', scores });
      }
      return;
    }
    if (s.phase === 'play' && this.isAi(s.turn)) this.scheduleAi();
  }

  /** The bot moves after a short pause, so it doesn't feel instant. */
  private scheduleAi() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(
      () => {
        this.aiTimer = null;
        const s = this.state;
        const team = s.turn;
        if (s.phase !== 'play' || !this.isAi(team)) return;
        const move = chooseAiMove(viewFor(s, team), this.difficulty, randomSeed());
        if (move) this.move(team, move.pieceId, move.to);
        else this.resign(team);
        // Once the human is out, the remaining computer armies play on a little quicker.
      },
      this.state.out.includes('groen') ? 700 : 1600,
    );
  }
}
