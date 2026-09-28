import { describe, expect, it } from 'vitest';
import { type GameState, type Piece, type Team } from '@antego/shared';
import { LocalController } from './controller.js';

const piece = (id: string, team: Team, rank: Piece['rank'], x: number, y: number): Piece => ({
  id,
  team,
  rank,
  x,
  y,
  revealed: false,
  moved: false,
});

/**
 * A local game on a small practice position: green's scout attacks sand's scout up a clear
 * column. Equal ranks, so the battle goes to a mini-game.
 */
function battleGame(mode: 'ai' | 'hotseat') {
  const c = new LocalController(mode, { minigames: 'lige' });
  c.subscribe(() => undefined);
  const inner = c as unknown as { state: GameState };
  inner.state = {
    ...inner.state,
    phase: 'play',
    turn: 'groen',
    turnNumber: 1,
    placed: { groen: true, sand: true },
    pieces: [
      piece('gs', 'groen', 'spejder', 0, 6),
      piece('gf', 'groen', 'flag', 9, 9),
      piece('gm', 'groen', 'sergent', 8, 9),
      piece('ss', 'sand', 'spejder', 0, 3),
      piece('sf', 'sand', 'flag', 9, 0),
      piece('sm', 'sand', 'sergent', 8, 0),
    ],
  };
  c.move('groen', 'gs', { x: 0, y: 3 });
  return c;
}

describe('LocalController mini-games', () => {
  it('against the computer, only the human plays and the computer has already scored', () => {
    const c = battleGame('ai');
    expect(c.game.phase).toBe('battle');
    expect(c.localPlayers('groen', 'sand')).toEqual(['groen']);
    c.reportMinigame('groen', 100);
    expect(c.game.phase).not.toBe('battle');
    expect(c.game.fallen.length).toBeGreaterThan(0);
    c.dispose();
  });

  it('hot-seat waits for both armies before settling the battle', () => {
    const c = battleGame('hotseat');
    expect(c.localPlayers('groen', 'sand')).toEqual<Team[]>(['groen', 'sand']);
    c.reportMinigame('groen', 90);
    expect(c.game.phase).toBe('battle');
    c.reportMinigame('sand', 10);
    expect(c.game.phase).toBe('play');
    // Green's scout won the mini-game, so the defender fell.
    expect(c.game.fallen.map((p) => p.team)).toEqual(['sand']);
  });
});
