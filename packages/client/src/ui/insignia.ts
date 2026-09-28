import type { Rank } from '@antego/shared';
import type { LineId } from '../generated/lines.js';
import { h, line } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const GOLD = '#e0b43c';
const SILVER = '#aeb8bf';
const EDGE = '#2d3419';

function svg(w: number, children: string) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} 24`);
  el.setAttribute('class', 'insignia');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = children;
  return el;
}

const star = (cx: number, color: string) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 3.6 : 9;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(12 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}" stroke="${EDGE}" stroke-width="1.2" stroke-linejoin="round"/>`;
};

const stars = (n: number) =>
  svg(n * 20, Array.from({ length: n }, (_, i) => star(10 + i * 20, GOLD)).join(''));

const bars = (n: number) =>
  svg(
    n * 12,
    Array.from(
      { length: n },
      (_, i) =>
        `<rect x="${2 + i * 12}" y="3" width="8" height="18" rx="1.5" fill="${SILVER}" stroke="${EDGE}" stroke-width="1.2"/>`,
    ).join(''),
  );

const chevrons = (n: number, extra = '') => {
  // Stack the chevrons around the vertical middle, 6 units apart.
  const top = 12 - ((n - 1) * 6) / 2 - 2;
  const one = (y: number) => `3,${y + 5} 12,${y} 21,${y + 5}`;
  return svg(
    24 + (extra ? 16 : 0),
    Array.from(
      { length: n },
      (_, i) =>
        `<polyline points="${one(top + i * 6)}" fill="none" stroke="${EDGE}" stroke-width="5.4" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<polyline points="${one(top + i * 6)}" fill="none" stroke="${GOLD}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>`,
    ).join('') + extra,
  );
};

// A little shovel next to the minør's chevrons.
const SHOVEL = `<g transform="translate(26 0)"><rect x="4.2" y="1.5" width="3.6" height="12" rx="1" fill="#8a5a2b" stroke="${EDGE}" stroke-width="1"/><path d="M0.5 12.5h11l-1.8 7.5a4 4 0 0 1-7.4 0z" fill="${SILVER}" stroke="${EDGE}" stroke-width="1.4"/></g>`;

/**
 * Rank insignia ("distinktioner"): gold stars for the generals and field officers, silver bars
 * for the company officers, chevrons for the NCOs and scouts – and pictures for the specials.
 */
export function insignia(rank: Rank): SVGElement {
  switch (rank) {
    case 'marskal':
      return stars(4);
    case 'general':
      return stars(3);
    case 'oberst':
      return stars(2);
    case 'major':
      return stars(1);
    case 'kaptajn':
      return bars(2);
    case 'loejtnant':
      return bars(1);
    case 'sergent':
      return chevrons(3);
    case 'minoer':
      return chevrons(2, SHOVEL);
    case 'spejder':
      return chevrons(1);
    case 'spion':
      return svg(
        30,
        `<path d="M2 9c4-5 22-5 26 0l-2 7c-3 3-7 1-9-2h-4c-2 3-6 5-9 2z" fill="#26301a" stroke="${EDGE}" stroke-width="1"/><circle cx="9.5" cy="11" r="2.3" fill="#f3ecd2"/><circle cx="20.5" cy="11" r="2.3" fill="#f3ecd2"/>`,
      );
    case 'mine':
      return svg(
        26,
        `<ellipse cx="12" cy="15" rx="10" ry="6" fill="#4d5a2c" stroke="${EDGE}" stroke-width="1.2"/><rect x="9" y="6" width="6" height="5" rx="1" fill="#4d5a2c" stroke="${EDGE}" stroke-width="1.2"/><circle cx="12" cy="5" r="2" fill="#e8762b"/>`,
      );
    case 'flag':
      return svg(
        22,
        `<rect x="3" y="2" width="2.4" height="20" fill="${EDGE}"/><path d="M5.4 3h14l-4 5 4 5h-14z" fill="#c0392b" stroke="${EDGE}" stroke-width="1"/>`,
      );
  }
}

const rankLine = (r: Rank) => `rang.${r}` as LineId;

/** A rank's name with its insignia in front, for banners, toasts and the tutorial. */
export function rankLabel(rank: Rank, cls = 'rank') {
  return h('span', { class: `rank-label ${cls}` }, insignia(rank), line(rankLine(rank)));
}
