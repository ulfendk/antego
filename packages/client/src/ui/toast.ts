import type { LineId } from '../generated/lines.js';
import { line } from './dom.js';

let host: HTMLElement | null = null;

/** Small, non-blocking message at the top of the screen (read aloud like every other text). */
export function toast(lines: LineId | LineId[], ms = 3500) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  (Array.isArray(lines) ? lines : [lines]).forEach((id, i) => {
    if (i) el.append(' – ');
    el.append(line(id));
  });
  host.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
