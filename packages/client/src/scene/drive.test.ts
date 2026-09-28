import { describe, expect, it } from 'vitest';
import { BOARDS, homeSquares } from '@antego/shared';
import { inLake, onCardboard, planDrive, sweptClear, type P2 } from './drive.js';

const JEEP = { halfWidth: 0.56, halfLength: 1.05 };
const world = (board: typeof BOARDS.klassisk, p: { x: number; y: number }): P2 => ({
  x: p.x + 0.5 - board.size / 2,
  z: p.y + 0.5 - board.size / 2,
});
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

describe('driving over the board', () => {
  it('crosses an empty board from table to table, through a lake', () => {
    const board = BOARDS.klassisk;
    const route = planDrive({ board, pieces: [], obstacles: [], ...JEEP, rng: seeded(3) })!;
    expect(route).not.toBeNull();
    expect(onCardboard(board, route[0]!)).toBe(false);
    expect(onCardboard(board, route[route.length - 1]!)).toBe(false);
    expect(route.some((p) => inLake(board, p))).toBe(true);
  });

  it('finds the gap between two full armies and keeps clear of every soldier', () => {
    for (const id of ['klassisk', 'kryds'] as const) {
      const board = BOARDS[id];
      const teams = ['groen', 'sand'] as const;
      const pieces = teams.flatMap((t) => homeSquares(t, board).map((q) => world(board, q)));
      for (let seed = 1; seed <= 4; seed++) {
        const route = planDrive({ board, pieces, obstacles: [], ...JEEP, rng: seeded(seed) });
        expect(route, `${id} seed ${seed}`).not.toBeNull();
        expect(
          sweptClear(route!, JEEP.halfWidth, JEEP.halfLength, pieces, []),
          `${id} ${seed} swept`,
        ).toBe(true);
        expect(
          route!.some((p) => inLake(board, p)),
          `${id} ${seed} lake`,
        ).toBe(true);
      }
    }
  });

  it('gets past full armies with the toy boxes and spare soldiers on the table', () => {
    // As laid out in props.ts for the classic board.
    const board = BOARDS.klassisk;
    const obstacles = [
      { kind: 'rect', x: 8.5, z: 4.3, hx: 2.71, hz: 3.46 },
      { kind: 'rect', x: -8.5, z: -4.3, hx: 2.71, hz: 3.46 },
      { kind: 'circle', x: 8.6, z: -6.4, r: 0.45 },
      { kind: 'circle', x: -7.2, z: 7.6, r: 0.45 },
    ] as const;
    const pieces = (['groen', 'sand'] as const).flatMap((t) =>
      homeSquares(t, board).map((q) => world(board, q)),
    );
    const TANK = { halfWidth: 0.62, halfLength: 1.27 };
    for (const size of [JEEP, TANK]) {
      const route = planDrive({ board, pieces, obstacles, ...size, rng: seeded(9) });
      expect(route).not.toBeNull();
      expect(sweptClear(route!, size.halfWidth, size.halfLength, pieces, obstacles)).toBe(true);
    }
  });

  it('drives round a box on the table', () => {
    const board = BOARDS.klassisk;
    const box = { kind: 'rect', x: 8.5, z: 0, hx: 2.7, hz: 3.4 } as const;
    const route = planDrive({ board, pieces: [], obstacles: [box], ...JEEP, rng: seeded(5) });
    expect(route).not.toBeNull();
    expect(sweptClear(route!, JEEP.halfWidth, JEEP.halfLength, [], [box])).toBe(true);
  });

  it('gives up on a board with no room to pass', () => {
    const board = BOARDS.klassisk;
    const pieces: P2[] = [];
    for (let y = 0; y < 10; y += 2)
      for (let x = 0; x < 10; x++) pieces.push(world(board, { x, y }));
    for (let x = 0; x < 10; x += 2)
      for (let y = 0; y < 10; y++) pieces.push(world(board, { x, y }));
    expect(planDrive({ board, pieces, obstacles: [], ...JEEP })).toBeNull();
  });
});
