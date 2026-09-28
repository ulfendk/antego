import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Team } from '@antego/shared';
import { PIECE_SCALE, soldierMesh, type PieceKit } from './pieces.js';
import { BOARD_UNITS, TEAM_COLORS, fbm } from './textures.js';

/** Inner size of each army's toy box (x across, z along the table), in board units. */
const BOX = { w: 3.1, d: 4.6, h: 0.9, wall: 0.06 };

/** Toy box centre for an army: beside the board, on that player's side of the table. */
function boxCentre(team: Team) {
  const s = team === 'groen' ? 1 : -1;
  return new THREE.Vector3(s * 8.5, 0, s * 2.4);
}

/** Where the n-th fallen soldier of an army lies in its toy box (in rows, then layers). */
export function toyBoxSlot(team: Team, index: number) {
  const cols = 4;
  const rows = 7;
  const layer = Math.floor(index / (cols * rows));
  const j = index % (cols * rows);
  const col = j % cols;
  const row = Math.floor(j / cols);
  const s = team === 'groen' ? 1 : -1;
  const x = (col - 1.5) * 0.72 * s;
  const z = (row - 3) * 0.62 * s;
  return boxCentre(team).add(new THREE.Vector3(x, 0.1 + layer * 0.3, z));
}

function kraft(seed: number, print?: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const n = fbm(w, h, seed, 20, 3, 0.4);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 0.85 + n[i]! * 0.25;
    img.data[i * 4] = 176 * v;
    img.data[i * 4 + 1] = 138 * v;
    img.data[i * 4 + 2] = 92 * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  print?.(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** An open cardboard toy box with printed army markings on its sides and flaps folded out. */
function toyBox(team: Team) {
  const group = new THREE.Group();
  const col = TEAM_COLORS[team].plastic;
  const side = new THREE.MeshStandardMaterial({
    map: kraft(team === 'groen' ? 7 : 8, (g, w, h) => {
      g.fillStyle = col;
      g.fillRect(0, h * 0.62, w, h * 0.12);
      g.fillStyle = 'rgba(40, 30, 15, 0.8)';
      starPath(g, w / 2, h * 0.33, h * 0.2);
      g.fill();
    }),
    roughness: 0.9,
  });
  const inside = new THREE.MeshStandardMaterial({
    map: kraft(9),
    roughness: 0.95,
    color: '#d9cbb0',
  });
  const { w, d, h, wall } = BOX;
  const parts: [number, number, number, number, number, number, THREE.Material][] = [
    [w + wall * 2, wall, d + wall * 2, 0, wall / 2, 0, inside], // floor
    [wall, h, d + wall * 2, -(w + wall) / 2, h / 2, 0, side],
    [wall, h, d + wall * 2, (w + wall) / 2, h / 2, 0, side],
    [w, h, wall, 0, h / 2, -(d + wall) / 2, side],
    [w, h, wall, 0, h / 2, (d + wall) / 2, side],
  ];
  for (const [sx, sy, sz, x, y, z, m] of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Flaps folded outwards and drooping a little, like a box that's been opened a hundred times.
  const flap = (len: number, span: number, x: number, z: number, rotY: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, h, z);
    pivot.rotation.y = rotY;
    const m = new THREE.Mesh(new THREE.BoxGeometry(span, 0.03, len), inside);
    m.position.z = len / 2;
    m.castShadow = m.receiveShadow = true;
    const hinge = new THREE.Group();
    hinge.rotation.x = 0.35 + ((((x * 7 + z * 3) % 1) + 1) % 1) * 0.25;
    hinge.add(m);
    pivot.add(hinge);
    group.add(pivot);
  };
  flap(1.2, w, 0, d / 2 + wall, 0);
  flap(1.2, w, 0, -d / 2 - wall, Math.PI);
  flap(1.0, d, w / 2 + wall, 0, Math.PI / 2);
  flap(1.0, d, -w / 2 - wall, 0, -Math.PI / 2);
  group.position.copy(boxCentre(team));
  group.rotation.y = team === 'groen' ? 0 : Math.PI;
  return group;
}

/** The game's own box lid, printed with the board art, lying at the back of the table. */
function boxLid(boardPrint: THREE.Texture) {
  const size = BOARD_UNITS * 0.62;
  const edge = new THREE.MeshStandardMaterial({ color: '#3f5424', roughness: 0.7 });
  const top = new THREE.MeshPhysicalMaterial({ map: boardPrint, roughness: 0.35, clearcoat: 0.6 });
  const lid = new THREE.Mesh(new RoundedBoxGeometry(size, 0.5, size, 3, 0.04), [
    edge,
    edge,
    top,
    edge,
    edge,
    edge,
  ]);
  lid.position.set(-9.5, 0.25, -9);
  lid.rotation.y = 0.5;
  lid.castShadow = lid.receiveShadow = true;
  return lid;
}

/** Everything on the table around the board: toy boxes, the game box, a couple of spare soldiers. */
export function buildProps(kit: PieceKit, boardPrint: THREE.Texture) {
  const group = new THREE.Group();
  group.add(toyBox('groen'), toyBox('brun'), boxLid(boardPrint));
  // Spare soldiers that never made it into the game.
  const spares: [Team, 'spejder' | 'sergent', number, number, number][] = [
    ['groen', 'spejder', 8.6, -6.4, 0.6],
    ['brun', 'sergent', -7.2, 7.6, 2.4],
  ];
  for (const [team, rank, x, z, ry] of spares) {
    const s = soldierMesh(kit, rank, team, 1);
    const holder = new THREE.Group();
    holder.add(s);
    holder.scale.setScalar(PIECE_SCALE);
    holder.rotation.set(0, ry, Math.PI / 2);
    holder.position.set(x, 0.24, z);
    group.add(holder);
  }
  return group;
}
