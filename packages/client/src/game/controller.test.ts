import { describe, expect, it } from 'vitest';
import { presetPlacement, type Team } from '@antego/shared';
import { LocalController } from './controller.js';

/** Starts a local game and makes green's front scout attack straight up its column. */
function battleGame(mode: 'ai' | 'hotseat') {
  const c = new LocalController(mode, { minigames: 'altid' });
  c.subscribe(() => undefined);
  c.setup('groen', presetPlacement('groen', 'forsvar'));
  if (mode === 'hotseat') c.setup('brun', presetPlacement('brun', 'angreb'));
  const g = c.game;
  const scout = g.pieces.find((p) => p.team === 'groen' && p.rank === 'spejder' && p.y === 6)!;
  const target = g.pieces
    .filter((p) => p.team === 'brun' && p.x === scout.x)
    .sort((a, b) => b.y - a.y)[0]!;
  c.move('groen', scout.id, { x: target.x, y: target.y });
  return c;
}

describe('LocalController mini-games', () => {
  it('against the computer, only the human plays and the computer has already scored', () => {
    const c = battleGame('ai');
    expect(c.game.phase).toBe('battle');
    expect(c.localPlayers('groen', 'brun')).toEqual(['groen']);
    c.reportMinigame('groen', 100);
    expect(c.game.phase).not.toBe('battle');
    expect(c.game.fallen.length).toBeGreaterThan(0);
    c.dispose();
  });

  it('hot-seat waits for both armies before settling the battle', () => {
    const c = battleGame('hotseat');
    expect(c.localPlayers('groen', 'brun')).toEqual<Team[]>(['groen', 'brun']);
    c.reportMinigame('groen', 90);
    expect(c.game.phase).toBe('battle');
    c.reportMinigame('brun', 10);
    expect(c.game.phase).toBe('play');
    // Green's scout won the mini-game, so the defender fell.
    expect(c.game.fallen.map((p) => p.team)).toEqual(['brun']);
  });
});
