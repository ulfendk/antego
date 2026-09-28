import { describe, expect, it } from 'vitest';
import { minigameOutcome, resolveBattle } from './battle.js';
import { isShuttleBlocked, legalTargets } from './board.js';
import { applyAction, createGame, RuleError, viewFor } from './engine.js';
import { aiMinigameScore, chooseAiMove } from './ai.js';
import { PRESET_IDS, presetPlacement, randomPlacement, validatePlacement } from './setup.js';
import type { GameState, Piece, Rank, Team } from './types.js';

function piece(
  id: string,
  team: Team,
  rank: Rank,
  x: number,
  y: number,
  extra: Partial<Piece> = {},
): Piece {
  return { id, team, rank, x, y, revealed: false, moved: false, ...extra };
}

/** A game in play with just the given pieces (plus unreachable flags so nobody runs out of moves by accident). */
function sandbox(pieces: Piece[], opts: Partial<GameState> = {}): GameState {
  return {
    ...createGame(1, { minigames: 'aldrig' }),
    phase: 'play',
    turnNumber: 1,
    placed: { groen: true, sand: true },
    pieces,
    ...opts,
  };
}

function started(seed = 42): GameState {
  let s = createGame(seed);
  s = applyAction(s, {
    type: 'setup',
    team: 'groen',
    placement: presetPlacement('groen', 'forsvar'),
  }).state;
  s = applyAction(s, {
    type: 'setup',
    team: 'sand',
    placement: presetPlacement('sand', 'angreb'),
  }).state;
  return s;
}

describe('setup', () => {
  it.each(PRESET_IDS)('preset %s is a valid army for both teams', (id) => {
    expect(validatePlacement('groen', presetPlacement('groen', id))).toBeNull();
    expect(validatePlacement('sand', presetPlacement('sand', id))).toBeNull();
  });

  it('random setups are valid and keep the flag on the back row', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = randomPlacement('sand', seed);
      expect(validatePlacement('sand', p)).toBeNull();
      expect(p.find((q) => q.rank === 'flag')!.y).toBe(0);
    }
  });

  it('rejects pieces outside the home rows and wrong armies', () => {
    const p = presetPlacement('groen', 'forsvar');
    expect(validatePlacement('sand', p)).not.toBeNull();
    expect(validatePlacement('groen', p.slice(1))).not.toBeNull();
  });

  it('starts play with green when both have placed', () => {
    const s = started();
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('groen');
    expect(s.pieces).toHaveLength(80);
  });
});

describe('movement', () => {
  it('normal pieces move one square, never into lakes', () => {
    const s = sandbox([piece('a', 'groen', 'sergent', 2, 6), piece('f', 'sand', 'flag', 9, 0)]);
    const targets = legalTargets(s.pieces, s.history, s.pieces[0]!);
    expect(targets).toEqual(
      expect.arrayContaining([
        { x: 3, y: 6 },
        { x: 1, y: 6 },
        { x: 2, y: 7 },
      ]),
    );
    expect(targets).not.toContainEqual({ x: 2, y: 5 }); // lake
    expect(targets).toHaveLength(3);
  });

  it('scouts run in straight lines but stop at pieces and lakes', () => {
    const s = sandbox([
      piece('s', 'groen', 'spejder', 0, 9),
      piece('e', 'sand', 'sergent', 0, 3),
      piece('f', 'sand', 'flag', 9, 0),
    ]);
    const targets = legalTargets(s.pieces, s.history, s.pieces[0]!);
    expect(targets).toContainEqual({ x: 0, y: 3 }); // may attack at range
    expect(targets).not.toContainEqual({ x: 0, y: 2 });
    expect(targets).toContainEqual({ x: 9, y: 9 });
  });

  it('mines and flags never move', () => {
    const s = sandbox([piece('m', 'groen', 'mine', 5, 9), piece('f', 'groen', 'flag', 4, 9)]);
    expect(legalTargets(s.pieces, s.history, s.pieces[0]!)).toEqual([]);
    expect(legalTargets(s.pieces, s.history, s.pieces[1]!)).toEqual([]);
  });

  it('rejects moves out of turn or illegal squares', () => {
    const s = started();
    const brown = s.pieces.find((p) => p.team === 'sand' && p.y === 3)!;
    expect(() =>
      applyAction(s, { type: 'move', team: 'sand', pieceId: brown.id, to: { x: brown.x, y: 4 } }),
    ).toThrow(RuleError);
    const green = s.pieces.find((p) => p.team === 'groen' && p.y === 6 && p.rank === 'kaptajn')!;
    expect(() =>
      applyAction(s, { type: 'move', team: 'groen', pieceId: green.id, to: { x: green.x, y: 3 } }),
    ).toThrow(RuleError);
  });

  it('blocks endless shuttling between two squares', () => {
    let s = sandbox([
      piece('a', 'groen', 'sergent', 0, 9),
      piece('b', 'sand', 'sergent', 9, 0),
      piece('gf', 'groen', 'flag', 5, 9),
      piece('bf', 'sand', 'flag', 5, 0),
    ]);
    const hop = (team: Team, id: string, x: number, y: number) =>
      (s = applyAction(s, { type: 'move', team, pieceId: id, to: { x, y } }).state);
    hop('groen', 'a', 0, 8);
    hop('sand', 'b', 9, 1);
    hop('groen', 'a', 0, 9);
    hop('sand', 'b', 9, 0);
    hop('groen', 'a', 0, 8);
    hop('sand', 'b', 9, 1);
    const a = s.pieces.find((p) => p.id === 'a')!;
    expect(isShuttleBlocked(s.history, a, { x: 0, y: 9 })).toBe(true);
    expect(isShuttleBlocked(s.history, a, { x: 1, y: 8 })).toBe(false);
  });
});

describe('battles', () => {
  it('special cases', () => {
    expect(resolveBattle('sergent', 'flag', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'attacker',
    });
    expect(resolveBattle('marskal', 'mine', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'defender',
    });
    expect(resolveBattle('minoer', 'mine', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'attacker',
    });
    expect(resolveBattle('spion', 'marskal', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'attacker',
    });
    // The spy only wins when it attacks.
    expect(resolveBattle('marskal', 'spion', 'aldrig')).toMatchObject({
      kind: 'auto',
      outcome: 'attacker',
    });
  });

  it('classic mode: stronger wins, equal both fall', () => {
    expect(resolveBattle('major', 'kaptajn', 'aldrig')).toMatchObject({ outcome: 'attacker' });
    expect(resolveBattle('spejder', 'kaptajn', 'aldrig')).toMatchObject({ outcome: 'defender' });
    expect(resolveBattle('major', 'major', 'aldrig')).toMatchObject({ outcome: 'both' });
  });

  it('only equally matched soldiers duel in a mini-game; otherwise the stronger wins', () => {
    expect(resolveBattle('major', 'major', 'lige')).toEqual({
      kind: 'minigame',
      handicap: { attacker: 0, defender: 0 },
    });
    expect(resolveBattle('major', 'kaptajn', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'attacker',
      reason: 'staerkere',
    });
    expect(resolveBattle('kaptajn', 'major', 'lige')).toMatchObject({
      kind: 'auto',
      outcome: 'defender',
    });
  });

  it('mini-game ties go to the stronger soldier, or both fall', () => {
    expect(minigameOutcome({ attacker: 50, defender: 50 }, { attacker: 2, defender: 0 })).toBe(
      'attacker',
    );
    expect(minigameOutcome({ attacker: 50, defender: 50 }, { attacker: 0, defender: 0 })).toBe(
      'both',
    );
    expect(minigameOutcome({ attacker: 10, defender: 90 }, { attacker: 3, defender: 0 })).toBe(
      'defender',
    );
  });

  it('capturing the flag wins', () => {
    const s = sandbox([
      piece('a', 'groen', 'spejder', 5, 1),
      piece('bf', 'sand', 'flag', 5, 0),
      piece('b', 'sand', 'sergent', 0, 0),
      piece('gf', 'groen', 'flag', 9, 9),
    ]);
    const r = applyAction(s, { type: 'move', team: 'groen', pieceId: 'a', to: { x: 5, y: 0 } });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe('groen');
    expect(r.state.winReason).toBe('flag');
  });

  it('runs a mini-game battle end to end', () => {
    const s = sandbox(
      [
        piece('a', 'groen', 'major', 5, 6),
        piece('b', 'sand', 'major', 5, 5),
        piece('gf', 'groen', 'flag', 9, 9),
        piece('bf', 'sand', 'flag', 0, 0),
        piece('bs', 'sand', 'sergent', 1, 0),
      ],
      { options: { minigames: 'lige' } },
    );
    const r1 = applyAction(s, { type: 'move', team: 'groen', pieceId: 'a', to: { x: 5, y: 5 } });
    expect(r1.state.phase).toBe('battle');
    expect(r1.state.pendingBattle).toMatchObject({ handicap: { attacker: 0, defender: 0 } });
    const r2 = applyAction(r1.state, {
      type: 'minigameResult',
      scores: { attacker: 80, defender: 20 },
    });
    expect(r2.state.phase).toBe('play');
    expect(r2.state.pieces.find((p) => p.id === 'a')).toMatchObject({ x: 5, y: 5, revealed: true });
    expect(r2.state.fallen.map((p) => p.id)).toEqual(['b']);
    expect(r2.state.turn).toBe('sand');
  });

  it('a player without movable pieces loses', () => {
    const s = sandbox([
      piece('a', 'groen', 'marskal', 5, 6),
      piece('b', 'sand', 'sergent', 5, 5),
      piece('bf', 'sand', 'flag', 0, 0),
      piece('gf', 'groen', 'flag', 9, 9),
    ]);
    const r = applyAction(s, { type: 'move', team: 'groen', pieceId: 'a', to: { x: 5, y: 5 } });
    expect(r.state.winner).toBe('groen');
    expect(r.state.winReason).toBe('ingen-traek');
  });
});

describe('hidden information', () => {
  it('views hide enemy ranks until revealed', () => {
    const s = started();
    const v = viewFor(s, 'groen');
    expect(v.pieces.filter((p) => p.team === 'sand').every((p) => p.rank === null)).toBe(true);
    expect(v.pieces.filter((p) => p.team === 'groen').every((p) => p.rank !== null)).toBe(true);
  });
});

describe('ai', () => {
  it('always picks a legal move and can play whole games against itself', () => {
    for (let game = 0; game < 5; game++) {
      let s = createGame(game, { minigames: 'lige' });
      s = applyAction(s, {
        type: 'setup',
        team: 'groen',
        placement: randomPlacement('groen', game),
      }).state;
      s = applyAction(s, {
        type: 'setup',
        team: 'sand',
        placement: randomPlacement('sand', game + 100),
      }).state;
      for (let turn = 0; turn < 2000 && s.phase !== 'over'; turn++) {
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
        const move = chooseAiMove(viewFor(s, s.turn), turn % 2 ? 'svaer' : 'let', turn);
        expect(move).not.toBeNull();
        s = applyAction(s, { type: 'move', team: s.turn, ...move! }).state;
      }
      expect(s.pieces.length).toBeLessThan(80);
    }
  });

  it('takes a known flag when it can', () => {
    const s = sandbox([
      piece('a', 'groen', 'sergent', 5, 1),
      piece('bf', 'sand', 'flag', 5, 0, { revealed: true }),
      piece('b', 'sand', 'sergent', 0, 0),
      piece('gf', 'groen', 'flag', 9, 9),
    ]);
    expect(chooseAiMove(viewFor(s, 'groen'), 'let', 3)).toEqual({
      pieceId: 'a',
      to: { x: 5, y: 0 },
    });
  });
});
