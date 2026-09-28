import * as THREE from 'three';
import { clampScore, type MinigameId } from '@antego/shared';
import type { LineId } from '../generated/lines.js';
import type { Stage } from '../scene/stage.js';
import { sfx } from '../audio/sfx.js';
import { button, h, line } from '../ui/dom.js';
import type { Minigame, MinigameContext, Pointer } from './base.js';
import { Faldskaerm } from './faldskaerm.js';
import { Korkskud } from './korkskud.js';
import { Stormloeb } from './stormloeb.js';

const GAMES: Record<
  MinigameId,
  { make: (ctx: MinigameContext) => Minigame; title: LineId; howto: LineId; icon: string }
> = {
  stormloeb: {
    make: (c) => new Stormloeb(c),
    title: 'minispil.stormloeb',
    howto: 'minispil.stormloeb_hjaelp',
    icon: '👆',
  },
  korkskud: {
    make: (c) => new Korkskud(c),
    title: 'minispil.korkskud',
    howto: 'minispil.korkskud_hjaelp',
    icon: '🎯',
  },
  faldskaerm: {
    make: (c) => new Faldskaerm(c),
    title: 'minispil.faldskaerm',
    howto: 'minispil.faldskaerm_hjaelp',
    icon: '🪂',
  },
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Five stars for a 0–100 score: pictures, not numbers, for the youngest players. */
export function stars(score: number) {
  const n = Math.round(clampScore(score) / 20);
  return h('div', { class: 'stars', 'aria-hidden': 'true' }, '★'.repeat(n) + '☆'.repeat(5 - n));
}

/**
 * Plays one mini-game for one player: intro card, "klar, parat, start!", the game with a
 * timer bar, then the result. Resolves with the 0–100 score.
 */
export async function runMinigame(
  stage: Stage,
  layer: HTMLElement,
  game: MinigameId,
  ctx: MinigameContext,
): Promise<number> {
  const spec = GAMES[game];
  const mg = spec.make(ctx);
  stage.setOverride(mg);
  try {
    // Intro: what to do, who is playing, and whether they have a head start.
    await new Promise<void>((resolve) =>
      layer.replaceChildren(
        h(
          'div',
          { class: `panel minigame-intro ${ctx.team}` },
          h('div', { class: 'mg-icon', 'aria-hidden': 'true' }, spec.icon),
          line(spec.title, 'h1'),
          line(
            ctx.team === 'groen' ? 'minispil.spiller_groen' : 'minispil.spiller_sand',
            'p',
            `team-chip ${ctx.team}`,
          ),
          line(spec.howto, 'p'),
          ctx.handicap > 0 ? line('minispil.fordel', 'p', 'bonus') : null,
          button('menu.start', () => resolve(), 'big go', '▶'),
        ),
      ),
    );
    for (const id of ['minispil.klar', 'minispil.parat', 'minispil.start'] as const) {
      layer.replaceChildren(h('div', { class: 'countdown' }, line(id, 'span')));
      sfx.play(id === 'minispil.start' ? 'beepHigh' : 'beep');
      await wait(id === 'minispil.start' ? 450 : 650);
    }
    const bar = h('div', { class: 'bar' });
    layer.replaceChildren(h('div', { class: 'mg-hud' }, h('div', { class: 'timer' }, bar)));

    const canvas = stage.renderer.domElement;
    const toPointer = (e: PointerEvent): Pointer => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      return { x, y, ndc: new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)) };
    };
    const onDown = (e: PointerEvent) => mg.down(toPointer(e));
    const onMove = (e: PointerEvent) => mg.move(toPointer(e));
    const onUp = (e: PointerEvent) => mg.up(toPointer(e));
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    const tick = setInterval(
      () => (bar.style.width = `${Math.max(0, 100 - (mg.elapsed / mg.duration) * 100)}%`),
      50,
    );
    await new Promise<void>((resolve) => {
      mg.onFinish = resolve;
      mg.running = true;
    });
    clearInterval(tick);
    sfx.play('whistle');
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);

    const score = clampScore(mg.score());
    layer.replaceChildren(
      h('div', { class: 'panel minigame-done' }, line('minispil.faerdig', 'h1'), stars(score)),
    );
    await wait(1600);
    return score;
  } finally {
    layer.replaceChildren();
    stage.setOverride(null);
    mg.dispose();
  }
}
