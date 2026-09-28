import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_GAME } from '@antego/shared';
import { config } from './config.js';
import { configureHttp } from './http.js';
import { GameRoom } from './rooms/GameRoom.js';

const server = new Server({
  transport: new WebSocketTransport({
    // Keep idle connections alive through reverse proxies (a kid thinking about a move).
    pingInterval: 15_000,
    pingMaxRetries: 3,
  }),
  express: configureHttp,
  greet: false,
});

server.define(ROOM_GAME, GameRoom);

await server.listen(config.port, '0.0.0.0');
console.log(
  `[server] Antego ${config.appVersion} listening on :${config.port} (client: ${config.clientDir})`,
);
