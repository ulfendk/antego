export const BOARD_SIZE = 10;

export type Team = 'groen' | 'brun';
export const TEAMS: readonly Team[] = ['groen', 'brun'];
export const other = (t: Team): Team => (t === 'groen' ? 'brun' : 'groen');

export type Rank =
  | 'marskal'
  | 'general'
  | 'oberst'
  | 'major'
  | 'kaptajn'
  | 'loejtnant'
  | 'sergent'
  | 'minoer'
  | 'spejder'
  | 'spion'
  | 'mine'
  | 'flag';

export interface RankInfo {
  /** Stratego strength; mine and flag never attack, so theirs only matters for sorting. */
  strength: number;
  count: number;
  movable: boolean;
}

export const RANKS: Record<Rank, RankInfo> = {
  marskal: { strength: 10, count: 1, movable: true },
  general: { strength: 9, count: 1, movable: true },
  oberst: { strength: 8, count: 2, movable: true },
  major: { strength: 7, count: 3, movable: true },
  kaptajn: { strength: 6, count: 4, movable: true },
  loejtnant: { strength: 5, count: 4, movable: true },
  sergent: { strength: 4, count: 4, movable: true },
  minoer: { strength: 3, count: 5, movable: true },
  spejder: { strength: 2, count: 8, movable: true },
  spion: { strength: 1, count: 1, movable: true },
  mine: { strength: 11, count: 6, movable: false },
  flag: { strength: 0, count: 1, movable: false },
};

export const RANK_ORDER = Object.keys(RANKS) as Rank[];
export const ARMY_SIZE = RANK_ORDER.reduce((n, r) => n + RANKS[r].count, 0);

export interface Pos {
  x: number;
  y: number;
}

export interface Piece extends Pos {
  id: string;
  team: Team;
  rank: Rank;
  /** Both players know its rank (it has been in a battle). */
  revealed: boolean;
  /** It has moved at least once, so everyone knows it isn't a mine or the flag. */
  moved: boolean;
}

/** A piece as one player sees it: enemy ranks are unknown until revealed. */
export interface PieceView extends Omit<Piece, 'rank'> {
  rank: Rank | null;
}

export type MinigameMode = 'altid' | 'taette' | 'aldrig';

export interface GameOptions {
  minigames: MinigameMode;
}

export const DEFAULT_OPTIONS: GameOptions = { minigames: 'taette' };

export type MinigameId = 'faldskaerm' | 'korkskud' | 'stormloeb';
export const MINIGAMES: readonly MinigameId[] = ['faldskaerm', 'korkskud', 'stormloeb'];

export interface PendingBattle {
  attackerId: string;
  defenderId: string;
  from: Pos;
  to: Pos;
  game: MinigameId;
  seed: number;
  /** 0–3 bonus level each side gets in the mini-game (the stronger soldier gets the rank difference, capped). */
  handicap: { attacker: number; defender: number };
}

export type Phase = 'setup' | 'play' | 'battle' | 'over';
export type WinReason = 'flag' | 'ingen-traek' | 'opgivet';

export interface MoveRecord {
  team: Team;
  pieceId: string;
  from: Pos;
  to: Pos;
}

export interface GameState {
  phase: Phase;
  options: GameOptions;
  seed: number;
  battleCount: number;
  turn: Team;
  turnNumber: number;
  placed: Record<Team, boolean>;
  pieces: Piece[];
  fallen: Piece[];
  history: MoveRecord[];
  pendingBattle: PendingBattle | null;
  winner: Team | null;
  winReason: WinReason | null;
}

export interface GameView extends Omit<GameState, 'pieces' | 'fallen'> {
  /** The team this view belongs to (null: spectator / hot-seat hand-over screen). */
  viewer: Team | null;
  pieces: PieceView[];
  fallen: PieceView[];
}

export type BattleOutcome = 'attacker' | 'defender' | 'both';

export interface Placement extends Pos {
  rank: Rank;
}

export type Action =
  | { type: 'setup'; team: Team; placement: Placement[] }
  | { type: 'move'; team: Team; pieceId: string; to: Pos }
  | { type: 'minigameResult'; scores: { attacker: number; defender: number } }
  | { type: 'resign'; team: Team };

export type GameEvent =
  | { type: 'placed'; team: Team }
  | { type: 'started' }
  | { type: 'moved'; pieceId: string; from: Pos; to: Pos }
  | {
      type: 'battle';
      attackerId: string;
      defenderId: string;
      attackerRank: Rank;
      defenderRank: Rank;
      /** null while a mini-game decides it. */
      outcome: BattleOutcome | null;
      reason: BattleReason;
    }
  | { type: 'battleResolved'; outcome: BattleOutcome; fallen: string[] }
  | { type: 'turn'; team: Team }
  | { type: 'over'; winner: Team; reason: WinReason };

export type BattleReason =
  'flag' | 'mine' | 'mine-desarmeret' | 'spion' | 'staerkere' | 'lige' | 'minispil';
