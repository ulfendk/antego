import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import {
  ERR_OUTDATED_CLIENT,
  PROTOCOL_VERSION,
  ROOM_GAME,
  presetPlacement,
  type GameView,
  type ServerMessages,
} from '@antego/shared';
import { GameRoom } from './GameRoom.js';

const PORT = 25_671;
let server: Server;

beforeAll(async () => {
  server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define(ROOM_GAME, GameRoom);
  await server.listen(PORT, '127.0.0.1');
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

/** Collects the latest view pushed to a client. */
function track(room: Room) {
  const box: { view: GameView | null; next: Promise<GameView> } = { view: null, next: null! };
  let resolve!: (v: GameView) => void;
  const arm = () => (box.next = new Promise((r) => (resolve = r)));
  arm();
  room.onMessage('view', (msg: ServerMessages['view'] & { view: GameView }) => {
    box.view = msg.view;
    const r = resolve;
    arm();
    r(msg.view);
  });
  room.onMessage('opponent', () => undefined);
  room.onMessage('rejected', () => undefined);
  return box;
}

async function until(box: ReturnType<typeof track>, pred: (v: GameView) => boolean) {
  while (!box.view || !pred(box.view)) await box.next;
  return box.view;
}

describe('GameRoom', () => {
  it('rejects outdated clients', async () => {
    const c = new Client(`ws://127.0.0.1:${PORT}`);
    await expect(c.create(ROOM_GAME, { protocol: PROTOCOL_VERSION - 1 })).rejects.toMatchObject({
      code: ERR_OUTDATED_CLIENT,
    });
  });

  it('creates a 4-digit room, seats two players and hides enemy ranks', async () => {
    const a = new Client(`ws://127.0.0.1:${PORT}`);
    const b = new Client(`ws://127.0.0.1:${PORT}`);
    const host = await a.create(ROOM_GAME, {
      protocol: PROTOCOL_VERSION,
      options: { minigames: 'aldrig' },
    });
    expect(host.roomId).toMatch(/^\d{4}$/);
    const hostBox = track(host);
    const guest = await b.joinById(host.roomId, { protocol: PROTOCOL_VERSION });
    const guestBox = track(guest);

    expect((await until(hostBox, () => true)).viewer).toBe('groen');
    expect((await until(guestBox, () => true)).viewer).toBe('brun');

    host.send('setup', { placement: presetPlacement('groen', 'forsvar') });
    guest.send('setup', { placement: presetPlacement('brun', 'angreb') });

    const hv = await until(hostBox, (v) => v.phase === 'play');
    const gv = await until(guestBox, (v) => v.phase === 'play');
    expect(hv.pieces).toHaveLength(80);
    expect(hv.pieces.filter((p) => p.team === 'brun').every((p) => p.rank === null)).toBe(true);
    expect(gv.pieces.filter((p) => p.team === 'groen').every((p) => p.rank === null)).toBe(true);

    // Green moves a front-row piece forward.
    const mover = hv.pieces.find((p) => p.team === 'groen' && p.y === 6 && p.x === 0)!;
    host.send('move', { pieceId: mover.id, to: { x: 0, y: 5 } });
    const after = await until(guestBox, (v) => v.turn === 'brun');
    expect(after.pieces.find((p) => p.id === mover.id)).toMatchObject({ x: 0, y: 5, rank: null });

    await host.leave();
    await guest.leave();
  });

  it('refuses a third player', async () => {
    const [a, b, c] = [0, 1, 2].map(() => new Client(`ws://127.0.0.1:${PORT}`));
    const host = await a!.create(ROOM_GAME, { protocol: PROTOCOL_VERSION });
    const guest = await b!.joinById(host.roomId, { protocol: PROTOCOL_VERSION });
    await expect(c!.joinById(host.roomId, { protocol: PROTOCOL_VERSION })).rejects.toBeTruthy();
    await host.leave();
    await guest.leave();
  });
});
