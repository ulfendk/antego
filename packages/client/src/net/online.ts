import { Client, type Room } from '@colyseus/sdk';
import {
  ERR_OUTDATED_CLIENT,
  ERR_ROOM_FULL,
  PROTOCOL_VERSION,
  ROOM_GAME,
  type ClientMessages,
  type CreateOptions,
  type GameEvent,
  type GameOptions,
  type GameView,
  type JoinOptions,
  type Placement,
  type Pos,
  type ServerMessages,
  type Team,
} from '@antego/shared';
import type { Controller, Listener } from '../game/controller.js';
import { updater } from '../pwa/updater.js';
import { colyseusEndpoint } from './endpoint.js';

const SESSION_KEY = 'antego.online';

export type JoinError = 'outdated' | 'not-found' | 'full' | 'offline';

export class OnlineError extends Error {
  constructor(readonly reason: JoinError) {
    super(reason);
  }
}

// The room state only carries lobby flags; the game itself arrives as per-player "view" messages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameRoom = Room<any, any>;

/** A game played through the server: each player only ever receives their own view. */
export class OnlineController implements Controller {
  readonly mode = 'online';
  private listeners: Listener[] = [];
  private latest: GameView | null = null;
  private pending: { view: GameView; events: GameEvent[] }[] = [];
  onOpponent: ((connected: boolean) => void) | null = null;
  onConnection: ((online: boolean) => void) | null = null;
  onRejected: ((reason: string) => void) | null = null;
  private left = false;

  private constructor(private room: GameRoom) {
    room.onMessage(
      'view',
      (msg: ServerMessages['view'] & { view: GameView; events: GameEvent[] }) => {
        this.latest = msg.view;
        if (!this.listeners.length) this.pending.push(msg);
        for (const l of this.listeners) l(msg.view, msg.events);
      },
    );
    room.onMessage('opponent', (msg: ServerMessages['opponent']) =>
      this.onOpponent?.(msg.connected),
    );
    room.onMessage('rejected', (msg: { reason: string }) => this.onRejected?.(msg.reason));
    room.onDrop(() => this.onConnection?.(false));
    room.onReconnect(() => {
      remember(room);
      this.onConnection?.(true);
    });
    room.onLeave(() => {
      if (!this.left) this.onConnection?.(false);
      forgetSession();
    });
    remember(room);
  }

  /** The 4-digit code friends type in to join. */
  get code() {
    return this.room.roomId;
  }

  get team(): Team | null {
    return this.latest?.viewer ?? null;
  }

  static async create(options: Partial<GameOptions>): Promise<OnlineController> {
    const opts: CreateOptions = { protocol: PROTOCOL_VERSION, options };
    return new OnlineController(await connect((c) => c.create(ROOM_GAME, opts)));
  }

  static async join(code: string): Promise<OnlineController> {
    const opts: JoinOptions = { protocol: PROTOCOL_VERSION };
    return new OnlineController(await connect((c) => c.joinById(code, opts)));
  }

  /** After a reload (an app update or a closed tab) we can slip back into the same game. */
  static async resume(): Promise<OnlineController | null> {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
    if (!token) return null;
    try {
      return new OnlineController(await connect((c) => c.reconnect(token!)));
    } catch {
      forgetSession();
      return null;
    }
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    for (const m of this.pending.splice(0)) fn(m.view, m.events);
  }

  view(): GameView {
    return this.latest!;
  }

  hasView() {
    return this.latest !== null;
  }

  setViewer() {
    // Each device only ever sees its own army.
  }

  me(): Team | null {
    return this.team;
  }

  setup(_team: Team, placement: Placement[]) {
    this.send('setup', { placement });
  }

  move(_team: Team, pieceId: string, to: Pos) {
    this.send('move', { pieceId, to });
  }

  resign() {
    this.send('resign', {});
  }

  reportMinigame(_team: Team, score: number) {
    this.send('minigameScore', { score });
  }

  localPlayers(): Team[] {
    return this.team ? [this.team] : [];
  }

  dispose() {
    this.left = true;
    this.listeners = [];
    forgetSession();
    void this.room.leave();
  }

  private send<K extends keyof ClientMessages>(type: K, msg: ClientMessages[K]) {
    this.room.send(type, msg);
  }
}

async function connect(open: (c: Client) => Promise<GameRoom>): Promise<GameRoom> {
  if (!navigator.onLine) throw new OnlineError('offline');
  try {
    return await open(new Client(colyseusEndpoint()));
  } catch (err) {
    console.warn('[online]', err);
    const code = (err as { code?: number }).code;
    if (code === ERR_OUTDATED_CLIENT) {
      void updater.forceUpdate();
      throw new OnlineError('outdated');
    }
    if (code === ERR_ROOM_FULL) throw new OnlineError('full');
    const msg = String((err as Error)?.message ?? err);
    if (/not found|invalid/i.test(msg) || code === 4212 || code === 520)
      throw new OnlineError('not-found');
    throw new OnlineError('offline');
  }
}

function remember(room: GameRoom) {
  try {
    sessionStorage.setItem(SESSION_KEY, room.reconnectionToken);
  } catch {
    // Without storage a reload just can't rejoin; the opponent wins after the grace period.
  }
}

function forgetSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}
