import { h } from '../ui/dom.js';

/**
 * A floating thumb stick: put a thumb down anywhere and push; the stick's base appears under
 * it and the knob follows (up to RADIUS). Push further for more gas. Arrow keys / WASD work
 * too. Screen directions: x right, y down.
 */
export class Joystick {
  readonly el: HTMLElement;
  private base = h('div', { class: 'stick-base' });
  private knob = h('div', { class: 'stick-knob' });
  private hint = h('div', { class: 'stick-hint', 'aria-hidden': 'true' }, '👆');
  private pointer: number | null = null;
  private origin = { x: 0, y: 0 };
  private value = { x: 0, y: 0 };
  private keys = new Set<string>();
  /** Set on the first touch or key press (to hide the hint). */
  touched = false;

  static readonly RADIUS = 58;

  constructor() {
    this.base.append(this.knob);
    this.el = h('div', { class: 'stick-area' }, this.hint, this.base);
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
  }

  /** Direction (screen x right, y down) and strength 0–1. */
  read(): { x: number; y: number; strength: number } {
    let { x, y } = this.value;
    if (this.pointer === null && this.keys.size) {
      x = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
      y = (this.keys.has('down') ? 1 : 0) - (this.keys.has('up') ? 1 : 0);
      const l = Math.hypot(x, y);
      if (l) return { x: x / l, y: y / l, strength: 1 };
    }
    const l = Math.hypot(x, y);
    // A little dead zone round the middle.
    const strength = Math.max(0, Math.min(1, (l - 0.12) / 0.78));
    return l ? { x: x / l, y: y / l, strength } : { x: 0, y: 0, strength: 0 };
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    this.el.remove();
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointer !== null) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    const r = this.el.getBoundingClientRect();
    this.origin = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.base.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
    this.base.classList.add('on');
    this.knob.style.transform = '';
    this.value = { x: 0, y: 0 };
    this.touched = true;
    this.hint.remove();
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    const r = this.el.getBoundingClientRect();
    let dx = e.clientX - r.left - this.origin.x;
    let dy = e.clientY - r.top - this.origin.y;
    const l = Math.hypot(dx, dy);
    const R = Joystick.RADIUS;
    if (l > R) {
      // Pulled past the edge: the base follows the thumb, so it never runs out of stick.
      const over = l - R;
      this.origin.x += (dx / l) * over;
      this.origin.y += (dy / l) * over;
      this.base.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.value = { x: dx / R, y: dy / R };
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.value = { x: 0, y: 0 };
    this.base.classList.remove('on');
  };

  private onKey = (e: KeyboardEvent) => {
    const k = (
      {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        a: 'left',
        d: 'right',
        w: 'up',
        s: 'down',
      } as Record<string, string>
    )[e.key];
    if (!k) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
    this.touched = true;
    this.hint.remove();
  };
}
