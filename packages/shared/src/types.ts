/** Size of the classic 2-player board (the 3–4 player "kryds" board is larger, see board.ts). */
export const BOARD_SIZE = 10;

/** Army colours, like real army men: green and sand (tan), plus grey-blue and brown for 3–4 players. */
export type Team = 'groen' | 'sand' | 'blaa' | 'brun';
export const TEAMS: readonly Team[] = ['groen', 'sand', 'blaa', 'brun'];
/** The opponent in a 2-player game. */
export const other = (t: Team): Team => (t === 'groen' ? 'sand' : 'groen');

export type BoardId = 'klassisk' | 'kryds';
/** Classic 40-piece army, or the quicker 24-piece army used on the 3–4 player board. */
export type ArmyId = 'klassisk' | 'lille';

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

/** How many of each rank an army has. */
export const ARMIES: Record<ArmyId, Record<Rank, number>> = {
  klassisk: Object.fromEntries(RANK_ORDER.map((r) => [r, RANKS[r].count])) as Record<Rank, number>,
  lille: {
    marskal: 1,
    general: 1,
    oberst: 1,
    major: 2,
    kaptajn: 2,
    loejtnant: 2,
    sergent: 2,
    minoer: 3,
    spejder: 4,
    spion: 1,
    mine: 4,
    flag: 1,
  },
};

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

/** 'lige': equally matched soldiers duel in a mini-game; 'aldrig': classic, both fall. */
export type MinigameMode = 'lige' | 'aldrig';

export interface GameOptions {
  minigames: MinigameMode;
}

export const DEFAULT_OPTIONS: GameOptions = { minigames: 'lige' };

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
  /** Which board this game is played on. */
  board: BoardId;
  /** The armies in this game, in turn order. */
  teams: Team[];
  /** Armies that are out (flag taken, no moves left, or gave up). */
  out: Team[];
  seed: number;
  battleCount: number;
  turn: Team;
  turnNumber: number;
  placed: Partial<Record<Team, boolean>>;
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
  /** An army is knocked out while others play on (3–4 players). */
  | { type: 'out'; team: Team; reason: WinReason; removed: string[] }
  | { type: 'over'; winner: Team; reason: WinReason };

export type BattleReason =
  'flag' | 'mine' | 'mine-desarmeret' | 'spion' | 'staerkere' | 'lige' | 'minispil';
