import { describe, expect, it } from 'vitest';
import { aiMinigameScore, chooseAiMove } from './ai.js';
import { BOARDS, homeSquares, isLake, legalTargets } from './board.js';
import { applyAction, createGame, viewFor } from './engine.js';
import { PRESET_IDS, presetPlacement, randomPlacement, validatePlacement } from './setup.js';
import { ARMIES, RANK_ORDER, type GameState, type Piece, type Team } from './types.js';

const kryds = BOARDS.kryds;
const ALL: Team[] = ['groen', 'blaa', 'sand', 'brun'];

describe('the plus-shaped 3–4 player board', () => {
  it('gives every army an 8×3 home on playable, lake-free squares, without overlaps', () => {
    const seen = new Set<string>();
    for (const team of ALL) {
      const home = homeSquares(team, kryds);
      expect(home).toHaveLength(24);
      for (const p of home) {
        expect(kryds.playable(p)).toBe(true);
        expect(isLake(p, kryds)).toBe(false);
        const key = `${p.x},${p.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('uses the 24-piece army', () => {
    expect(RANK_ORDER.reduce((n, r) => n + ARMIES.lille[r], 0)).toBe(24);
  });

  it.each(PRESET_IDS)('formation %s is valid for every army', (id) => {
    for (const team of ALL)
      expect(validatePlacement(team, presetPlacement(team, id, kryds), kryds)).toBeNull();
  });

  it('random setups are valid with the flag on the back row', () => {
    for (const team of ALL) {
      for (let seed = 0; seed < 20; seed++) {
        const p = randomPlacement(team, seed, kryds);
        expect(validatePlacement(team, p, kryds)).toBeNull();
        const flag = p.find((q) => q.rank === 'flag')!;
        const back = homeSquares(team, kryds).slice(-8);
        expect(back.some((b) => b.x === flag.x && b.y === flag.y)).toBe(true);
      }
    }
  });

  it('seats three armies clockwise, leaving the east arm open', () => {
    expect(createGame(1, {}, { board: 'kryds', players: 3 }).teams).toEqual([
      'groen',
      'blaa',
      'sand',
    ]);
    expect(createGame(1, {}, { board: 'kryds', players: 4 }).teams).toEqual([
      'groen',
      'blaa',
      'sand',
      'brun',
    ]);
  });

  it("the grey-blue army's scout runs east along a free row", () => {
    const scout: Piece = {
      id: 's',
      team: 'blaa',
      rank: 'spejder',
      x: 2,
      y: 3,
      revealed: false,
      moved: false,
    };
    const targets = legalTargets([scout], [], scout, kryds);
    expect(targets).toContainEqual({ x: 13, y: 3 });
    expect(targets).not.toContainEqual({ x: 2, y: 2 }); // cut-away corner
  });
});

function started(players: 3 | 4, seed = 1): GameState {
  let s = createGame(seed, { minigames: 'lige' }, { board: 'kryds', players });
  s.teams.forEach((team, i) => {
    s = applyAction(s, {
      type: 'setup',
      team,
      placement: randomPlacement(team, seed * 10 + i, kryds),
    }).state;
  });
  return s;
}

describe('3–4 player games', () => {
  it('starts when every army has set up, green first', () => {
    const s = started(4);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('groen');
    expect(s.pieces).toHaveLength(96);
  });

  it('knocks an army out when its flag is taken, clears its soldiers and plays on', () => {
    const sandbox: GameState = {
      ...createGame(3, { minigames: 'aldrig' }, { board: 'kryds', players: 3 }),
      phase: 'play',
      turnNumber: 1,
      placed: { groen: true, blaa: true, sand: true },
      pieces: [
        { id: 'g', team: 'groen', rank: 'sergent', x: 6, y: 1, revealed: false, moved: true },
        { id: 'gf', team: 'groen', rank: 'flag', x: 6, y: 13, revealed: false, moved: false },
        { id: 'sf', team: 'sand', rank: 'flag', x: 6, y: 0, revealed: false, moved: false },
        { id: 'ss', team: 'sand', rank: 'spejder', x: 9, y: 2, revealed: false, moved: false },
        { id: 'b', team: 'blaa', rank: 'sergent', x: 0, y: 5, revealed: false, moved: false },
        { id: 'bf', team: 'blaa', rank: 'flag', x: 0, y: 8, revealed: false, moved: false },
      ],
    };
    const r = applyAction(sandbox, {
      type: 'move',
      team: 'groen',
      pieceId: 'g',
      to: { x: 6, y: 0 },
    });
    expect(r.state.phase).toBe('play');
    expect(r.state.out).toEqual(['sand']);
    expect(r.state.pieces.some((p) => p.team === 'sand')).toBe(false);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: 'out', team: 'sand', reason: 'flag' }),
    );
    // Turn order skips the knocked-out army.
    expect(r.state.turn).toBe('blaa');
    const r2 = applyAction(r.state, {
      type: 'move',
      team: 'blaa',
      pieceId: 'b',
      to: { x: 0, y: 4 },
    });
    expect(r2.state.turn).toBe('groen');
  });

  it('a player giving up on their turn hands over to the next army', () => {
    const s = started(3);
    const r = applyAction(s, { type: 'resign', team: 'groen' });
    expect(r.state.out).toEqual(['groen']);
    expect(r.state.turn).toBe('blaa');
    expect(r.state.phase).toBe('play');
  });

  it.each([3, 4] as const)(
    '%i computer armies can play a whole game to a single winner',
    (players) => {
      let finished = 0;
      for (let game = 0; game < 3; game++) {
        let s = started(players, game + 1);
        for (let turn = 0; turn < 6000 && s.phase !== 'over'; turn++) {
          if (s.phase === 'battle') {
            const b = s.pendingBattle!;
            s = applyAction(s, {
              type: 'minigameResult',
              scores: {
                attacker: aiMinigameScore('mellem', b.handicap.attacker, b.seed),
                defender: aiMinigameScore('mellem', b.handicap.defender, b.seed + 1),
              },
            }).state;
            continue;
          }
          const move = chooseAiMove(viewFor(s, s.turn), 'svaer', turn);
          expect(move).not.toBeNull();
          s = applyAction(s, { type: 'move', team: s.turn, ...move! }).state;
        }
        // Bots may occasionally end up circling in a sparse endgame; armies must be knocked out
        // along the way, and a finished game must have exactly one army left standing.
        expect(s.out.length).toBeGreaterThan(0);
        if (s.phase === 'over') {
          expect(s.out).toHaveLength(players - 1);
          expect(s.teams).toContain(s.winner);
          expect(s.out).not.toContain(s.winner);
        }
        finished += s.phase === 'over' ? 1 : 0;
      }
      expect(finished).toBeGreaterThanOrEqual(2);
    },
  );
});
