import * as THREE from 'three';
import {
  BOARDS,
  createRng,
  homeSquares,
  type BoardSpec,
  type Pos,
  type Rank,
  type Team,
} from '@antego/shared';

/** Classic board: 10×10 squares plus a 0.5 printed margin on every side. */
export const BOARD_UNITS = 11;

// ------------------------------------------------------------------ noise

/** Tileable fractal value noise in [0, 1]. */
export function fbm(
  w: number,
  h: number,
  seed: number,
  cells: number,
  octaves: number,
  stretch = 1,
): Float32Array {
  const out = new Float32Array(w * h);
  const rng = createRng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, Math.round(cells * 2 ** o));
    const cy = Math.max(1, Math.round(cells * stretch * 2 ** o));
    const grid = new Float32Array(cx * cy);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * cy;
      const iy = Math.floor(gy);
      const fy = smooth(gy - iy);
      const y0 = (iy % cy) * cx;
      const y1 = ((iy + 1) % cy) * cx;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * cx;
        const ix = Math.floor(gx);
        const fx = smooth(gx - ix);
        const x0 = ix % cx;
        const x1 = (ix + 1) % cx;
        const a = grid[y0 + x0]! + (grid[y0 + x1]! - grid[y0 + x0]!) * fx;
        const b = grid[y1 + x0]! + (grid[y1 + x1]! - grid[y1 + x0]!) * fx;
        out[y * w + x]! += (a + (b - a) * fy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function noiseCanvas(
  w: number,
  h: number,
  n: Float32Array,
  color: (v: number, i: number) => [number, number, number, number],
) {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const [r, gg, b, a] = color(n[i]!, i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

// ------------------------------------------------------------------ printed board

/** Print size in board units: the squares plus a 0.5 margin on every side. */
export const boardUnits = (spec: BoardSpec) => spec.size + 1;

/**
 * The printed top of the cardboard board: a meadow map with contour lines, an inked grid,
 * lakes printed with halftone, each army's colour on its home zone and a band along its
 * back edge, a camo frame, and the wear a well-loved board gets (rubbed edges; the classic
 * folding board also has a cracked fold line). Works for any board shape.
 */
export function boardPrint(size: number, spec: BoardSpec = BOARDS.klassisk): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const U = boardUnits(spec);
  const u = size / U; // pixels per board unit
  const lo = 512;
  const fx = u * 0.5;
  const sq = (x: number, y: number) => [fx + x * u, fx + y * u] as const;
  const squares: Pos[] = [];
  for (let y = 0; y < spec.size; y++)
    for (let x = 0; x < spec.size; x++) if (spec.playable({ x, y })) squares.push({ x, y });
  const isPlayable = (x: number, y: number) => spec.playable({ x, y });

  // Camo frame everywhere (the margin shows it).
  const camo = fbm(lo, lo, 11, 3, 5);
  const palette = [
    [72, 82, 44],
    [98, 108, 60],
    [138, 128, 84],
    [84, 72, 48],
  ];
  g.drawImage(
    noiseCanvas(lo, lo, camo, (v) => {
      const k = Math.min(3, Math.floor(v * 4.6 - 0.4));
      const col = palette[Math.max(0, k)]!;
      return [col[0]!, col[1]!, col[2]!, 255];
    }),
    0,
    0,
    size,
    size,
  );

  // Meadow for the playing field (clipped to the playable squares), with faint contour lines.
  const meadow = fbm(lo, lo, 23, 4, 5);
  const field = noiseCanvas(lo, lo, meadow, (v) => {
    // A pale khaki field map, so every army's plastic stands out on it.
    const base = mix([178, 174, 128], [204, 196, 150], v);
    const contour = Math.abs(((v * 14) % 1) - 0.5) < 0.05 ? 0.86 : 1;
    return [base[0]! * contour, base[1]! * contour, base[2]! * contour, 255];
  });
  g.save();
  g.beginPath();
  for (const p of squares) {
    const [px, py] = sq(p.x, p.y);
    g.rect(px - 0.5, py - 0.5, u + 1, u + 1);
  }
  g.clip();
  g.drawImage(field, fx, fx, u * spec.size, u * spec.size);
  g.restore();

  // Home zones: a hint of each army's colour.
  const armies = Object.keys(spec.forward) as Team[];
  for (const team of armies) {
    g.fillStyle = hexA(TEAM_COLORS[team].plastic, 0.2);
    for (const p of homeSquares(team, spec)) {
      const [px, py] = sq(p.x, p.y);
      g.fillRect(px, py, u, u);
    }
  }

  // Squares: a soft inner bevel, like a printed tile.
  for (const p of squares) {
    const [px, py] = sq(p.x, p.y);
    g.strokeStyle = 'rgba(255, 250, 220, 0.22)';
    g.lineWidth = u * 0.03;
    roundRect(g, px + u * 0.07, py + u * 0.07, u * 0.86, u * 0.86, u * 0.08);
    g.stroke();
    if ((p.x + p.y) % 2 === 0) {
      g.fillStyle = 'rgba(255, 255, 230, 0.04)';
      g.fillRect(px, py, u, u);
    }
  }

  // Lakes: each 2×2 block drawn from its top-left square.
  const lake = (x: number, y: number) => spec.lakes.some((l) => l.x === x && l.y === y);
  for (const l of spec.lakes) {
    if (!lake(l.x - 1, l.y) && !lake(l.x, l.y - 1)) {
      const [px, py] = sq(l.x, l.y);
      drawLake(g, px, py, u);
    }
  }

  // Inked grid, then a double frame along the outline of the playing field.
  g.strokeStyle = '#2d3419';
  g.lineWidth = u * 0.035;
  for (const p of squares) {
    const [px, py] = sq(p.x, p.y);
    g.strokeRect(px, py, u, u);
  }
  const outline: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [];
  for (const p of squares) {
    const [px, py] = sq(p.x, p.y);
    if (!isPlayable(p.x, p.y - 1)) outline.push({ a: [px, py], b: [px + u, py], n: [0, -1] });
    if (!isPlayable(p.x, p.y + 1))
      outline.push({ a: [px, py + u], b: [px + u, py + u], n: [0, 1] });
    if (!isPlayable(p.x - 1, p.y)) outline.push({ a: [px, py], b: [px, py + u], n: [-1, 0] });
    if (!isPlayable(p.x + 1, p.y))
      outline.push({ a: [px + u, py], b: [px + u, py + u], n: [1, 0] });
  }
  const along = (off: number, width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    for (const e of outline) {
      const ox = e.n[0] * off;
      const oy = e.n[1] * off;
      // Extend a little along the edge so frame corners close.
      const dx = e.a[0] === e.b[0] ? 0 : off;
      const dy = e.a[1] === e.b[1] ? 0 : off;
      line(g, e.a[0] + ox - dx, e.a[1] + oy - dy, e.b[0] + ox + dx, e.b[1] + oy + dy);
    }
  };
  along(u * 0.06, u * 0.06, '#2d3419');
  along(u * 0.16, u * 0.018, 'rgba(240, 230, 190, 0.8)');

  // Each army's band along the back edge of its home, with a star at each end.
  for (const team of armies) {
    const fwd = spec.forward[team]!;
    const back = homeSquares(team, spec).slice(-spec.homeWidth);
    const xs = back.map((p) => p.x);
    const ys = back.map((p) => p.y);
    const [x0, y0] = sq(Math.min(...xs), Math.min(...ys));
    const [x1, y1] = sq(Math.max(...xs) + 1, Math.max(...ys) + 1);
    g.fillStyle = TEAM_COLORS[team].plastic;
    const depth = u * 0.14;
    const gap = u * 0.2;
    let band: [number, number, number, number];
    let ends: [number, number][];
    if (fwd.y !== 0) {
      const y = fwd.y < 0 ? y1 + gap : y0 - gap - depth;
      band = [x0 + u * 0.7, y, x1 - x0 - u * 1.4, depth];
      ends = [
        [x0 - u * 0.25, y + depth / 2],
        [x1 + u * 0.25, y + depth / 2],
      ];
    } else {
      const x = fwd.x > 0 ? x0 - gap - depth : x1 + gap;
      band = [x, y0 + u * 0.7, depth, y1 - y0 - u * 1.4];
      ends = [
        [x + depth / 2, y0 - u * 0.25],
        [x + depth / 2, y1 + u * 0.25],
      ];
    }
    g.fillRect(...band);
    for (const [sx, sy] of ends) {
      g.fillStyle = '#e9e2c4';
      g.beginPath();
      g.arc(sx, sy, u * 0.19, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3f5424';
      star(g, sx, sy, u * 0.15, u * 0.06);
    }
  }

  // Print grain: tiny halftone-ish speckle over everything.
  const grain = fbm(lo, lo, 5, 64, 2);
  g.globalAlpha = 0.07;
  g.globalCompositeOperation = 'multiply';
  g.drawImage(
    noiseCanvas(lo, lo, grain, (v) => [v * 255, v * 255, v * 255, 255]),
    0,
    0,
    size,
    size,
  );
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  // Wear: rubbed patches along the board's outer edge (half a square outside the field).
  const rng = createRng(77);
  for (let i = 0; i < 260 * (spec.size / 10); i++) {
    const e = outline[Math.floor(rng() * outline.length)]!;
    const t = rng();
    const d = u * 0.5 - rng() ** 3 * u * 0.22;
    const x = e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * d;
    const y = e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * d;
    g.fillStyle = `rgba(215, 205, 180, ${0.08 + rng() * 0.25})`;
    g.beginPath();
    g.ellipse(
      x,
      y,
      u * (0.02 + rng() * 0.08),
      u * (0.01 + rng() * 0.03),
      rng() * Math.PI,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  if (spec.id === 'klassisk') {
    for (const [x, y] of [
      [0, 0],
      [size, 0],
      [0, size],
      [size, size],
    ]) {
      for (let i = 0; i < 18; i++) {
        g.fillStyle = `rgba(178, 170, 156, ${0.3 + rng() * 0.5})`;
        g.beginPath();
        g.arc(
          x! + (rng() - 0.5) * u * 0.25,
          y! + (rng() - 0.5) * u * 0.25,
          u * (0.02 + rng() * 0.07),
          0,
          Math.PI * 2,
        );
        g.fill();
      }
    }
    // The classic board folds across the middle; the ink has cracked along it.
    const mid = size / 2;
    g.fillStyle = 'rgba(30, 30, 20, 0.35)';
    g.fillRect(0, mid - u * 0.012, size, u * 0.024);
    g.strokeStyle = 'rgba(235, 228, 205, 0.55)';
    g.lineWidth = u * 0.01;
    g.beginPath();
    for (let x = 0; x < size; x += u * 0.05) {
      const on = rng() > 0.35;
      const y = mid + (rng() - 0.5) * u * 0.02;
      if (on) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }
  return tex(c);
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawLake(g: CanvasRenderingContext2D, x: number, y: number, u: number) {
  const w = u * 2;
  const rng = createRng(Math.floor(x));
  // Wobbly shoreline.
  const pts: [number, number][] = [];
  const cx = x + w / 2;
  const cy = y + w / 2;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    // A squircle that nearly fills the 2×2 squares.
    const r =
      (w * 0.47 * (1 + (rng() - 0.5) * 0.05)) /
      Math.pow(Math.abs(Math.cos(a)) ** 4 + Math.abs(Math.sin(a)) ** 4, 0.25);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const path = () => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
  };
  g.fillStyle = '#d9c88f';
  path();
  g.save();
  g.translate(cx, cy);
  g.scale(1.04, 1.04);
  g.translate(-cx, -cy);
  g.fill();
  g.restore();
  const grad = g.createRadialGradient(cx - w * 0.15, cy - w * 0.15, w * 0.05, cx, cy, w * 0.6);
  grad.addColorStop(0, '#5fa3c4');
  grad.addColorStop(1, '#2f6488');
  g.fillStyle = grad;
  path();
  g.fill();
  g.save();
  path();
  g.clip();
  // Halftone dots, bigger towards the deep middle.
  const step = u * 0.07;
  for (let py = y; py < y + w; py += step) {
    for (let px = x + ((py / step) % 2) * step * 0.5; px < x + w; px += step) {
      const d = Math.hypot(px - cx, py - cy) / (w * 0.5);
      g.fillStyle = 'rgba(20, 50, 80, 0.35)';
      g.beginPath();
      g.arc(px, py, step * 0.32 * Math.max(0, 1 - d), 0, Math.PI * 2);
      g.fill();
    }
  }
  // Printed ripples.
  g.strokeStyle = 'rgba(230, 245, 255, 0.55)';
  g.lineWidth = u * 0.025;
  for (let i = 0; i < 7; i++) {
    const rx = x + w * (0.2 + rng() * 0.6);
    const ry = y + w * (0.2 + rng() * 0.6);
    g.beginPath();
    g.arc(rx, ry, u * 0.12, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#2d3419';
  g.lineWidth = u * 0.03;
  path();
  g.stroke();
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, ri: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? ri : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

// ------------------------------------------------------------------ paper, cardboard, wood

/** Paper-fibre normal map and roughness variation for the laminated print. */
export function paperMaps(size = 1024) {
  const h = fbm(size, size, 3, 96, 3);
  const normal = heightToNormal(h, size, 2.2);
  const rough = noiseCanvas(size, size, fbm(size, size, 9, 24, 3), (v) => {
    const r = 70 + v * 60;
    return [r, r, r, 255];
  });
  return { normal: tex(normal, false, true), roughness: tex(rough, false, true) };
}

export function heightToNormal(h: Float32Array, size: number, strength: number) {
  return noiseCanvas(size, size, h, (_v, i) => {
    const x = i % size;
    const y = (i / size) | 0;
    const l = h[y * size + ((x + size - 1) % size)]!;
    const r = h[y * size + ((x + 1) % size)]!;
    const d = h[((y + 1) % size) * size + x]!;
    const t = h[((y + size - 1) % size) * size + x]!;
    let nx = (l - r) * strength;
    let ny = (d - t) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len;
    ny /= len;
    return [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz / len) * 0.5 * 255 + 127, 255];
  });
}

/** The board's edge: grey chipboard with the printed paper wrapped over the top. */
export function boardEdge() {
  const w = 512;
  const h = 64;
  const n = fbm(w, h, 31, 40, 3, 0.2);
  return tex(
    noiseCanvas(w, h, n, (v, i) => {
      const y = (i / w) | 0;
      if (y < h * 0.28) return [70 + v * 20, 82 + v * 20, 44 + v * 12, 255];
      const g = 150 + v * 40;
      return [g, g * 0.96, g * 0.9, 255];
    }),
  );
}

/**
 * An oak table top, tileable: four planks per tile with their own tone, long grain along the
 * plank, a butt joint somewhere along each one, dark seams between them and the odd knot.
 */
export function woodMaps(size = 1024) {
  const planks = 4;
  const pw = size / planks;
  const rng = createRng(4242);
  const grain = fbm(size, size, 41, 28, 4, 0.06);
  const fine = fbm(size, size, 43, 90, 2, 0.05);
  const blotch = fbm(size, size, 47, 3, 3);
  const info = Array.from({ length: planks }, () => ({
    tone: 0.75 + rng() * 0.35,
    joint: rng() * size,
    phase: rng() * 10,
    knots: Array.from({ length: 1 + Math.floor(rng() * 2) }, () => ({
      x: 0.25 + rng() * 0.5,
      y: rng() * size,
      r: 6 + rng() * 10,
    })),
  }));
  const light = [156, 116, 80];
  const dark = [96, 66, 44];
  const colorImg = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const p = Math.min(planks - 1, Math.floor(x / pw));
      const pl = info[p]!;
      const lx = x - p * pw;
      // Grain: stretched noise turned into growth rings, warped slightly across the plank.
      let ring = 0.5 + 0.5 * Math.sin(grain[i]! * 38 + pl.phase + (lx / pw) * 3);
      let h = 0.5 + ring * 0.12 + fine[i]! * 0.08;
      // Knots swirl the rings around a dark centre.
      for (const k of pl.knots) {
        const dx = lx - k.x * pw;
        let dy = y - k.y;
        if (dy > size / 2) dy -= size;
        if (dy < -size / 2) dy += size;
        const d = Math.hypot(dx, dy * 0.45);
        if (d < k.r * 5) {
          const w = 1 - d / (k.r * 5);
          ring = ring * (1 - w) + (0.5 + 0.5 * Math.sin(d * 0.9)) * w;
          if (d < k.r) {
            ring *= 0.35;
            h -= 0.1;
          }
        }
      }
      const t = Math.min(1, Math.max(0, ring * 0.75 + fine[i]! * 0.25));
      let r = dark[0]! + (light[0]! - dark[0]!) * t;
      let g = dark[1]! + (light[1]! - dark[1]!) * t;
      let b = dark[2]! + (light[2]! - dark[2]!) * t;
      const tone = pl.tone * (0.92 + blotch[i]! * 0.16);
      r *= tone;
      g *= tone;
      b *= tone;
      // Seams between planks and a butt joint along each one.
      const seam = Math.min(lx, pw - lx, Math.abs(y - pl.joint) * 1.4);
      if (seam < 2.2) {
        r *= 0.45;
        g *= 0.42;
        b *= 0.4;
        h -= 0.35;
      } else if (seam < 5) {
        h -= 0.08 * (1 - seam / 5); // softened plank edges
      }
      colorImg[i * 4] = r;
      colorImg[i * 4 + 1] = g;
      colorImg[i * 4 + 2] = b;
      colorImg[i * 4 + 3] = 255;
      height[i] = h;
    }
  }
  const { c, g } = canvas(size);
  g.putImageData(new ImageData(colorImg, size, size), 0, 0);
  const rough = noiseCanvas(size, size, fine, (v, i) => {
    const r = 120 + v * 50 + (height[i]! < 0.3 ? 60 : 0);
    return [r, r, r, 255];
  });
  return {
    map: tex(c, true, true),
    normal: tex(heightToNormal(height, size, 2.5), false, true),
    roughness: tex(rough, false, true),
  };
}

// ------------------------------------------------------------------ pieces

export const TEAM_COLORS: Record<Team, { plastic: string; card: string; ink: string }> = {
  groen: { plastic: '#2f6a12', card: '#557a34', ink: '#e8e4c8' },
  sand: { plastic: '#c28a4a', card: '#a8824e', ink: '#3b2a16' },
  blaa: { plastic: '#5d7486', card: '#6d8294', ink: '#eef2f5' },
  brun: { plastic: '#6b4428', card: '#7a5234', ink: '#f0e2cf' },
};

/**
 * The army emblem moulded into a hidden piece: a star in a ring, drawn as a light top edge
 * and a dark bottom edge so it reads as embossed plastic.
 */
export function emblem(team: Team) {
  const { c, g } = canvas(256);
  const dark = team === 'groen' ? 'rgba(10, 30, 0, 0.55)' : 'rgba(70, 40, 10, 0.55)';
  const light = team === 'groen' ? 'rgba(200, 235, 160, 0.55)' : 'rgba(255, 235, 200, 0.6)';
  const draw = (dx: number, dy: number, color: string) => {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.stroke();
    star(g, 128, 132, 66, 27);
    g.restore();
  };
  draw(3, 4, dark);
  draw(-2, -3, light);
  return tex(c);
}

const BADGE: Record<Rank, string> = {
  marskal: '10',
  general: '9',
  oberst: '8',
  major: '7',
  kaptajn: '6',
  loejtnant: '5',
  sergent: '4',
  minoer: '3',
  spejder: '2',
  spion: 'S',
  mine: '',
  flag: '',
};

/** Round rank badge floating above your own soldiers (a number, or an icon for mine/flag). */
export function badge(rank: Rank, team: Team) {
  const { c, g } = canvas(128);
  const col = TEAM_COLORS[team];
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(64, 68, 54, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f3ecd2';
  g.beginPath();
  g.arc(64, 62, 54, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = col.plastic;
  g.lineWidth = 9;
  g.stroke();
  g.fillStyle = '#26301a';
  if (rank === 'mine') {
    g.beginPath();
    g.arc(58, 70, 26, 0, Math.PI * 2);
    g.fill();
    g.fillRect(70, 34, 10, 20);
    g.fillStyle = '#e8762b';
    star(g, 84, 30, 14, 6);
  } else if (rank === 'flag') {
    g.fillRect(40, 26, 8, 72);
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.moveTo(48, 28);
    g.lineTo(96, 42);
    g.lineTo(48, 58);
    g.fill();
  } else {
    g.font = `${BADGE[rank].length > 1 ? 58 : 66}px "Black Ops One", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(BADGE[rank], 64, 66);
  }
  return tex(c);
}

export function radial(inner: string, outer: string, size = 128) {
  const { c, g } = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return tex(c);
}

/** Soft ink ring used to show where a selected soldier may go. */
export function targetRing() {
  const { c, g } = canvas(256);
  const grad = g.createRadialGradient(128, 128, 40, 128, 128, 124);
  grad.addColorStop(0, 'rgba(255,245,190,0.0)');
  grad.addColorStop(0.55, 'rgba(255,245,190,0.55)');
  grad.addColorStop(0.75, 'rgba(255,245,190,0.9)');
  grad.addColorStop(1, 'rgba(255,245,190,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return tex(c);
}
