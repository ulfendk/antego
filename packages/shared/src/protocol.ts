import type { GameEvent, GameOptions, GameView, Placement, Pos } from './types.js';

/** Bump when client and server can no longer talk to each other; old clients are then force-updated. */
export const PROTOCOL_VERSION = 2;
export const ROOM_GAME = 'spil';
export const ERR_OUTDATED_CLIENT = 4426;
export const ERR_ROOM_FULL = 4409;

export interface VersionInfo {
  version: string;
  protocol: number;
}

export interface CreateOptions {
  protocol: number;
  options: Partial<GameOptions>;
}

export interface JoinOptions {
  protocol: number;
}

/** Client → server messages. */
export interface ClientMessages {
  setup: { placement: Placement[] };
  move: { pieceId: string; to: Pos };
  minigameScore: { score: number };
  resign: Record<string, never>;
}

/** Server → client messages. The server pushes each player's own view (hidden ranks stay hidden). */
export interface ServerMessages {
  view: GameView;
  events: GameEvent[];
  opponent: { connected: boolean };
}

export function isRoomCode(s: string): boolean {
  return /^\d{4}$/.test(s);
}
