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

describe('team mode (2 against 2)', () => {
  const p = (id: string, team: Team, rank: Piece['rank'], x: number, y: number): Piece => ({
    id,
    team,
    rank,
    x,
    y,
    revealed: false,
    moved: true,
  });

  function teamSandbox(pieces: Piece[]): GameState {
    return {
      ...createGame(5, { minigames: 'aldrig' }, { board: 'kryds', players: 4, hold: true }),
      phase: 'play',
      turnNumber: 1,
      placed: { groen: true, blaa: true, sand: true, brun: true },
      pieces,
    };
  }

  it('partners block each other and cannot attack each other', () => {
    const s = teamSandbox([
      p('g', 'groen', 'spejder', 6, 10),
      p('s', 'sand', 'sergent', 6, 7),
      p('b', 'blaa', 'sergent', 6, 4),
    ]);
    const targets = legalTargets(s.pieces, [], s.pieces[0]!, kryds, ['groen', 'sand']);
    expect(targets).toContainEqual({ x: 6, y: 8 });
    expect(targets).not.toContainEqual({ x: 6, y: 7 }); // partner
    expect(targets).not.toContainEqual({ x: 6, y: 6 }); // can't jump past
    expect(() =>
      applyAction(s, { type: 'move', team: 'groen', pieceId: 'g', to: { x: 6, y: 7 } }),
    ).toThrow();
  });

  it('partners see each other’s ranks, enemies stay hidden', () => {
    const s = teamSandbox([
      p('g', 'groen', 'major', 6, 10),
      p('s', 'sand', 'sergent', 6, 1),
      p('b', 'blaa', 'kaptajn', 1, 6),
      p('r', 'brun', 'spion', 12, 6),
    ]);
    const v = viewFor(s, 'groen');
    const rank = (id: string) => v.pieces.find((q) => q.id === id)!.rank;
    expect([rank('g'), rank('s'), rank('b'), rank('r')]).toEqual(['major', 'sergent', null, null]);
  });

  it('a team wins together once both enemy armies are out – even if one partner fell first', () => {
    let s = teamSandbox([
      p('g', 'groen', 'major', 6, 1),
      p('gf', 'groen', 'flag', 6, 13),
      p('sf', 'sand', 'flag', 6, 0), // sand has only its flag left…
      p('b', 'blaa', 'sergent', 1, 6),
      p('bf', 'blaa', 'flag', 0, 7),
      p('r', 'brun', 'sergent', 12, 6),
      p('rf', 'brun', 'flag', 13, 3),
    ]);
    // Sand (green's partner) can't move and is knocked out when its turn comes.
    s = applyAction(s, { type: 'move', team: 'groen', pieceId: 'g', to: { x: 5, y: 1 } }).state;
    s = applyAction(s, { type: 'move', team: 'blaa', pieceId: 'b', to: { x: 1, y: 5 } }).state;
    expect(s.out).toContain('sand');
    expect(s.phase).toBe('play');
    // Knock out both enemies: brown gives up, then grey-blue.
    s = applyAction(s, { type: 'resign', team: 'brun' }).state;
    expect(s.phase).toBe('play');
    s = applyAction(s, { type: 'resign', team: 'blaa' }).state;
    expect(s.phase).toBe('over');
    expect(s.winners.sort()).toEqual(['groen', 'sand']);
  });

  it('four computer armies can play 2 against 2 to a team win', () => {
    let finished = 0;
    for (let game = 0; game < 3; game++) {
      let s = createGame(
        game + 11,
        { minigames: 'lige' },
        { board: 'kryds', players: 4, hold: true },
      );
      s.teams.forEach((team, i) => {
        s = applyAction(s, {
          type: 'setup',
          team,
          placement: randomPlacement(team, game * 7 + i, kryds),
        }).state;
      });
      for (let turn = 0; turn < 6000 && s.phase !== 'over'; turn++) {
        if (s.phase === 'battle') {
          const b = s.pendingBattle!;
          s = applyAction(s, {
            type: 'minigameResult',
            scores: {
              attacker: aiMinigameScore('mellem', 0, b.seed),
              defender: aiMinigameScore('mellem', 0, b.seed + 1),
            },
          }).state;
          continue;
        }
        const move = chooseAiMove(viewFor(s, s.turn), 'svaer', turn);
        // (Attacking a partner is an illegal move, so applyAction would throw.)
        s = applyAction(s, { type: 'move', team: s.turn, ...move! }).state;
      }
      if (s.phase === 'over') {
        finished++;
        expect(s.winners).toHaveLength(2);
        expect(['groen,sand', 'blaa,brun']).toContain([...s.winners].sort().join(','));
      }
    }
    expect(finished).toBeGreaterThanOrEqual(2);
  });
});
