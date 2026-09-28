import type { LineId } from '../generated/lines.js';
import { voice } from './voice.js';

const LONG_PRESS_MS = 450;
/** Where new text is read out automatically when it appears. */
const AUTO = '.panel, .setup-bar, .battle, .toast, .turn, .countdown';

/**
 * Makes every text in the game audible: new screens, banners and toasts are read out as they
 * appear, tapping any text reads it again, and a long press on a button reads its label
 * without pressing it (for kids who can't read yet).
 */
export function startReader() {
  const linesIn = (el: Element): LineId[] => {
    const own = el.matches('[data-line]') ? [el] : [];
    return [...own, ...el.querySelectorAll('[data-line]')]
      .filter((n) => !n.closest('.btn') && !n.closest('[aria-hidden="true"]'))
      .map((n) => (n as HTMLElement).dataset.line as LineId);
  };

  let pending: LineId[] = [];
  let scheduled = false;
  const observe = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof Element)) continue;
        const scope = node.matches(AUTO)
          ? node
          : node.closest(AUTO)
            ? node
            : node.querySelector(AUTO);
        if (scope) pending.push(...linesIn(node));
      }
    }
    if (pending.length && !scheduled) {
      scheduled = true;
      // Batch everything added in the same tick into one announcement.
      queueMicrotask(() => {
        scheduled = false;
        const ids = [...new Set(pending)];
        pending = [];
        voice.say(ids);
      });
    }
  });
  // The body, not just the UI root: toasts live directly under <body>.
  observe.observe(document.body, { childList: true, subtree: true });

  // Tap on text: read it (again).
  document.addEventListener('pointerdown', () => voice.unlock(), { capture: true });
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest('[data-line]');
    if (!el || el.closest('.btn')) return;
    voice.say((el as HTMLElement).dataset.line as LineId);
  });

  // Long press on a button: read its label instead of pressing it.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suppress: Element | null = null;
  document.addEventListener('pointerdown', (e) => {
    const btn = (e.target as Element | null)?.closest('.btn[data-line]');
    if (!btn) return;
    timer = setTimeout(() => {
      voice.say((btn as HTMLElement).dataset.line as LineId);
      suppress = btn;
    }, LONG_PRESS_MS);
  });
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  document.addEventListener('pointerup', cancel);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest('.btn');
      if (btn && btn === suppress) {
        e.stopPropagation();
        e.preventDefault();
      }
      suppress = null;
    },
    { capture: true },
  );
}
