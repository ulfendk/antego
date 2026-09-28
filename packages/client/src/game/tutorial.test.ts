import { describe, expect, it } from 'vitest';
import { CAPTAIN, TutorialController } from './tutorial.js';

describe('TutorialController', () => {
  it("lets the captain walk the tutorial's route: step, win the battle, take the flag", () => {
    const c = new TutorialController();
    c.subscribe(() => undefined);
    const path = [
      { x: 4, y: 6 }, // "flyt"
      { x: 4, y: 5 }, // "angrib": kaptajn (6) beats the sergent (4)
      { x: 4, y: 4 },
      { x: 4, y: 3 }, // the flag
    ];
    for (const to of path.slice(0, 3)) {
      c.move('groen', CAPTAIN, to);
      // Brown never moves: it is always green's turn again.
      expect(c.game.turn).toBe('groen');
      expect(c.game.phase).toBe('play');
    }
    expect(c.game.fallen.map((p) => `${p.team}-${p.rank}`)).toEqual(['sand-sergent']);
    c.move('groen', CAPTAIN, path[3]!);
    expect(c.game.phase).toBe('over');
    expect(c.game.winner).toBe('groen');
    expect(c.game.winReason).toBe('flag');
  });

  it('hides brown ranks from the player', () => {
    const c = new TutorialController();
    expect(
      c
        .view()
        .pieces.filter((p) => p.team === 'sand')
        .every((p) => p.rank === null),
    ).toBe(true);
  });
});
