import { LAKES, type GameEvent, type GameView, type Pos } from '@antego/shared';
import { sfx } from '../audio/sfx.js';
import { CAPTAIN } from '../game/tutorial.js';
import type { LineId } from '../generated/lines.js';
import { button, h, line } from './dom.js';

type Wait = 'move' | 'battle' | 'flag';

interface Step {
  line: LineId;
  /** Squares to pulse while this step is shown. */
  hint?: (v: GameView) => Pos[];
  /** Hands-on steps wait for the player instead of showing "Videre". */
  wait?: Wait;
}

const at = (v: GameView, pred: (p: GameView['pieces'][number]) => boolean) =>
  v.pieces.filter(pred).map((p) => ({ x: p.x, y: p.y }));
const captain = (v: GameView) => v.pieces.find((p) => p.id === CAPTAIN);
const ahead = (v: GameView, n = 1) => {
  const c = captain(v);
  return c ? [{ x: c.x, y: c.y - n }] : [];
};

const STEPS: Step[] = [
  { line: 'tutorial.velkommen' },
  { line: 'tutorial.maal', hint: (v) => at(v, (p) => p.id.endsWith('-flag')) },
  { line: 'tutorial.dine', hint: (v) => at(v, (p) => p.team === 'groen') },
  { line: 'tutorial.fjender', hint: (v) => at(v, (p) => p.team === 'brun') },
  { line: 'tutorial.flyt', hint: (v) => ahead(v), wait: 'move' },
  { line: 'tutorial.flot_flyt' },
  { line: 'tutorial.soeer', hint: () => [...LAKES] },
  {
    line: 'tutorial.spejder',
    hint: (v) => at(v, (p) => p.team === 'groen' && p.rank === 'spejder'),
  },
  { line: 'tutorial.angrib', hint: (v) => ahead(v), wait: 'battle' },
  { line: 'tutorial.kamp_forklaring' },
  {
    line: 'tutorial.miner',
    hint: (v) => at(v, (p) => p.team === 'groen' && (p.rank === 'mine' || p.rank === 'minoer')),
  },
  { line: 'tutorial.spion', hint: (v) => at(v, (p) => p.team === 'groen' && p.rank === 'spion') },
  { line: 'tutorial.flag', hint: (v) => [...ahead(v, 1), ...ahead(v, 2)], wait: 'flag' },
];

export interface TutorialHost {
  hint(squares: Pos[]): void;
  /** Tutorial finished (or skipped): go on to a real game or the menu. */
  done(playNow: boolean): void;
  restart(): void;
}

/**
 * The sergeant's walkthrough: a coach card at the top of the screen, one step at a time,
 * pulsing the squares it talks about and waiting for the player on the hands-on steps.
 */
export class Tutorial {
  private step = 0;
  private view: GameView | null = null;
  readonly el = h('div', { class: 'coach-layer' });

  constructor(private host: TutorialHost) {}

  start(view: GameView) {
    this.view = view;
    this.step = 0;
    this.render();
  }

  dispose() {
    this.el.remove();
  }

  /** Called after each view has been animated on the board. */
  onPresented(view: GameView, events: GameEvent[]) {
    this.view = view;
    const s = STEPS[this.step];
    if (view.phase === 'over') {
      if (view.winner === 'groen' && view.winReason === 'flag') this.finish();
      else this.failed();
      return;
    }
    if (!captain(view) && s?.wait) {
      this.failed();
      return;
    }
    if (!s?.wait) return;
    const done =
      s.wait === 'move'
        ? events.some((e) => e.type === 'moved' || e.type === 'battle')
        : s.wait === 'battle'
          ? events.some((e) => e.type === 'battleResolved')
          : false;
    if (done) this.next();
    else this.render(); // keep pointing at the goal from wherever the captain is now
  }

  /** Point at this step's squares again (e.g. after the player tapped away a selection). */
  rehint() {
    const s = STEPS[this.step];
    if (s && this.view) this.host.hint(s.hint?.(this.view) ?? []);
  }

  private next() {
    this.step++;
    this.render();
  }

  private render() {
    const s = STEPS[this.step];
    const v = this.view;
    if (!s || !v) return;
    this.host.hint(s.hint?.(v) ?? []);
    this.el.replaceChildren(
      h(
        'div',
        { class: 'coach' },
        h('div', { class: 'coach-face', 'aria-hidden': 'true' }, '🪖'),
        h(
          'div',
          { class: 'coach-body' },
          line(s.line, 'p'),
          h(
            'div',
            { class: 'row' },
            s.wait ? null : button('tutorial.videre', () => this.next(), 'go', '▶'),
            button('tutorial.spring_over', () => this.host.done(false), 'small', '⏭'),
          ),
        ),
      ),
    );
  }

  private finish() {
    this.host.hint([]);
    sfx.play('victory', 300);
    this.el.replaceChildren(
      h(
        'div',
        { class: 'coach' },
        h('div', { class: 'coach-face', 'aria-hidden': 'true' }, '🎖️'),
        h(
          'div',
          { class: 'coach-body' },
          line('tutorial.godt', 'p'),
          h(
            'div',
            { class: 'row' },
            button('menu.spil_computer', () => this.host.done(true), 'go', '🤖'),
            button('slut.menu', () => this.host.done(false), 'small', '🏠'),
          ),
        ),
      ),
    );
  }

  private failed() {
    this.host.hint([]);
    this.el.replaceChildren(
      h(
        'div',
        { class: 'coach' },
        h('div', { class: 'coach-face', 'aria-hidden': 'true' }, '🪖'),
        h(
          'div',
          { class: 'coach-body' },
          line('tutorial.igen', 'p'),
          h(
            'div',
            { class: 'row' },
            button('tutorial.proev_igen', () => this.host.restart(), 'go', '🔁'),
            button('tutorial.spring_over', () => this.host.done(false), 'small', '⏭'),
          ),
        ),
      ),
    );
  }
}
