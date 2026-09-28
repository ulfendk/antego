import { LINES, type LineId } from '../generated/lines.js';

export const t = (id: LineId) => LINES[id];

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style') el.setAttribute('style', String(v));
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Text from content/lines, tagged with its line id so it can be read aloud. */
export function line(id: LineId, tag: 'span' | 'p' | 'h1' | 'h2' = 'span', cls = '') {
  return h(tag, { class: cls, 'data-line': id }, t(id));
}

export function button(id: LineId, onclick: () => void, cls = '', icon?: string) {
  return h(
    'button',
    { class: `btn ${cls}`, 'data-line': id, onclick: () => onclick() },
    icon ? h('span', { class: 'icon', 'aria-hidden': 'true' }, icon) : null,
    h('span', {}, t(id)),
  );
}
