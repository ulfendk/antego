import { Room, ServerError, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  ERR_OUTDATED_CLIENT,
  ERR_ROOM_FULL,
  PROTOCOL_VERSION,
  RuleError,
  applyAction,
  clampScore,
  createGame,
  randomSeed,
  viewFor,
  type Action,
  type ClientMessages,
  type CreateOptions,
  type GameEvent,
  type GameState,
  type JoinOptions,
  type MinigameMode,
  type Team,
} from '@antego/shared';

/** How long a dropped player (screen lock, app update) may take to come back. */
export const RECONNECT_SECONDS = 120;
/** A mini-game that isn't finished by then counts as score 0 for the missing side. */
export const MINIGAME_TIMEOUT_MS = 45_000;

/** Only public lobby info lives in the schema state; the game itself is sent as per-player views. */
const LobbyState = schema(
  {
    groen: t.boolean().default(false),
    sand: t.boolean().default(false),
  },
  'LobbyState',
);
type LobbyState = SchemaType<typeof LobbyState>;

const usedCodes = new Set<string>();

function newRoomCode(): string {
  for (let i = 0; i < 1000; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedCodes.has(code)) return code;
  }
  throw new Error('no free room codes');
}

const MODES: readonly MinigameMode[] = ['lige', 'aldrig'];

export class GameRoom extends Room<{ state: LobbyState }> {
  override maxClients = 2;
  override maxMessagesPerSecond = 20;
  override state = new LobbyState();

  private game!: GameState;
  private seats = new Map<string, Team>();
  private scores: Partial<Record<Team, number>> = {};
  private minigameTimer: { clear(): void } | null = null;

  override onCreate(options: Partial<CreateOptions>) {
    this.roomId = newRoomCode();
    usedCodes.add(this.roomId);
    const mode = MODES.includes(options.options?.minigames as MinigameMode)
      ? (options.options!.minigames as MinigameMode)
      : undefined;
    this.game = createGame(randomSeed(), mode ? { minigames: mode } : {});

    this.onMessage('setup', (client, msg: ClientMessages['setup']) =>
      this.act(client, (team) => ({ type: 'setup', team, placement: msg.placement })),
    );
    this.onMessage('move', (client, msg: ClientMessages['move']) =>
      this.act(client, (team) => ({ type: 'move', team, pieceId: msg.pieceId, to: msg.to })),
    );
    this.onMessage('resign', (client) => this.act(client, (team) => ({ type: 'resign', team })));
    this.onMessage('minigameScore', (client, msg: ClientMessages['minigameScore']) =>
      this.onScore(client, msg.score),
    );
  }

  override onAuth(_client: Client, options: Partial<JoinOptions>) {
    if (options.protocol !== PROTOCOL_VERSION) {
      throw new ServerError(ERR_OUTDATED_CLIENT, 'Klienten er forældet – opdater spillet');
    }
    if (this.seats.size >= 2) throw new ServerError(ERR_ROOM_FULL, 'Rummet er fyldt');
    return true;
  }

  override onJoin(client: Client) {
    const taken = new Set(this.seats.values());
    const team: Team = taken.has('groen') ? 'sand' : 'groen';
    this.seats.set(client.sessionId, team);
    this.setConnected(team, true);
    this.sendView(client, []);
    this.broadcastOpponent();
  }

  override onDrop(client: Client) {
    const team = this.seats.get(client.sessionId);
    if (team) this.setConnected(team, false);
    this.broadcastOpponent();
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: Client) {
    const team = this.seats.get(client.sessionId);
    if (team) this.setConnected(team, true);
    this.sendView(client, []);
    this.broadcastOpponent();
  }

  override onLeave(client: Client) {
    const team = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (!team) return;
    this.setConnected(team, false);
    // Leaving a running game for good hands the win to the other player.
    if (this.game.phase !== 'over' && this.game.phase !== 'setup' && this.seats.size > 0) {
      this.apply({ type: 'resign', team });
    }
    this.broadcastOpponent();
  }

  override onDispose() {
    usedCodes.delete(this.roomId);
    this.minigameTimer?.clear();
  }

  private act(client: Client, build: (team: Team) => Action) {
    const team = this.seats.get(client.sessionId);
    if (!team) return;
    this.apply(build(team), client);
  }

  private apply(action: Action, from?: Client) {
    let events: GameEvent[];
    try {
      const result = applyAction(this.game, action);
      this.game = result.state;
      events = result.events;
    } catch (err) {
      if (err instanceof RuleError) {
        from?.send('rejected', { reason: err.message });
        return;
      }
      throw err;
    }
    if (this.game.phase === 'battle' && this.game.pendingBattle && !this.minigameTimer) {
      this.scores = {};
      this.minigameTimer = this.clock.setTimeout(() => this.finishMinigame(), MINIGAME_TIMEOUT_MS);
    }
    for (const c of this.clients) this.sendView(c, events);
  }

  private onScore(client: Client, score: number) {
    const team = this.seats.get(client.sessionId);
    if (!team || this.game.phase !== 'battle' || team in this.scores) return;
    this.scores[team] = clampScore(Number(score));
    if (this.scores.groen !== undefined && this.scores.sand !== undefined) this.finishMinigame();
  }

  private finishMinigame() {
    this.minigameTimer?.clear();
    this.minigameTimer = null;
    const battle = this.game.pendingBattle;
    if (this.game.phase !== 'battle' || !battle) return;
    const attackerTeam = this.game.pieces.find((p) => p.id === battle.attackerId)!.team;
    const defenderTeam: Team = attackerTeam === 'groen' ? 'sand' : 'groen';
    this.apply({
      type: 'minigameResult',
      scores: {
        attacker: this.scores[attackerTeam] ?? 0,
        defender: this.scores[defenderTeam] ?? 0,
      },
    });
  }

  private sendView(client: Client, events: GameEvent[]) {
    const team = this.seats.get(client.sessionId) ?? null;
    client.send('view', { view: viewFor(this.game, team), events });
  }

  // Online games are 2-player for now (seats groen/sand); 3–4 player rooms come next.
  private setConnected(team: Team, on: boolean) {
    if (team === 'groen' || team === 'sand') this.state[team] = on;
  }

  private isConnected(team: Team) {
    return team === 'groen' || team === 'sand' ? this.state[team] : false;
  }

  private broadcastOpponent() {
    for (const c of this.clients) {
      const team = this.seats.get(c.sessionId);
      const opp: Team = team === 'groen' ? 'sand' : 'groen';
      c.send('opponent', { connected: this.isConnected(opp) });
    }
  }
}
