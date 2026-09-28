import * as THREE from 'three';
import { BOARDS, type BoardSpec, type Pos } from '@antego/shared';
import { BOARD_UNITS, boardEdge, boardPrint, boardUnits, paperMaps, woodMaps } from './textures.js';

export const BOARD_THICKNESS = 0.07;
/** Height of the printed surface above the table. */
export const BOARD_TOP = BOARD_THICKNESS;

let active: BoardSpec = BOARDS.klassisk;

/** The board currently on the table; square ↔ world conversions follow it. */
export function setActiveBoard(spec: BoardSpec) {
  active = spec;
}

export function activeBoard(): BoardSpec {
  return active;
}

/** Board square → world position of its centre on the printed surface. Green's home is nearest +Z. */
export function squareToWorld(p: Pos, y = BOARD_TOP): THREE.Vector3 {
  const o = (active.size - 1) / 2;
  return new THREE.Vector3(p.x - o, y, p.y - o);
}

export function worldToSquare(v: THREE.Vector3): Pos | null {
  const h = active.size / 2;
  const p = { x: Math.floor(v.x + h), y: Math.floor(v.z + h) };
  return active.playable(p) ? p : null;
}

/**
 * A folding cardboard game board: two laminated halves with a cloth hinge, printed top,
 * grey chipboard edges with the paper wrapped over, lying on a wooden table.
 */
export function buildTable(
  printSize: number,
  spec: BoardSpec = BOARDS.klassisk,
): { table: THREE.Group; print: THREE.Texture } {
  const group = new THREE.Group();
  const paper = paperMaps();
  const print = boardPrint(printSize, spec);
  const half = BOARD_UNITS / 2;
  const gap = 0.012;

  const top = new THREE.MeshPhysicalMaterial({
    map: print,
    roughness: 0.42,
    roughnessMap: paper.roughness,
    normalMap: paper.normal,
    normalScale: new THREE.Vector2(0.25, 0.25),
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
  });
  const edgeTex = boardEdge();
  edgeTex.wrapS = THREE.RepeatWrapping;
  edgeTex.repeat.set(8, 1);
  const edge = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.85 });
  const under = new THREE.MeshStandardMaterial({ color: '#2f3326', roughness: 0.9 });

  if (spec.id !== 'klassisk') {
    group.add(shapedBoard(spec, top, edge));
    group.add(woodTable());
    return { table: group, print };
  }

  // Two halves, split along the fold (world z = 0). Each gets the matching half of the print.
  for (const side of [-1, 1] as const) {
    const depth = half - gap / 2;
    const geo = new THREE.BoxGeometry(BOARD_UNITS, BOARD_THICKNESS, depth);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each. Remap the top (+y) face.
    for (let i = 8; i < 12; i++) {
      // v = 1 is the face's -Z edge; the canvas top (v = 1) is the far edge (brown's side).
      const v = uv.getY(i);
      uv.setY(i, side < 0 ? 1 - ((1 - v) * depth) / BOARD_UNITS : (v * depth) / BOARD_UNITS);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, [edge, edge, top, under, edge, edge]);
    mesh.position.set(0, BOARD_THICKNESS / 2, side * (gap / 2 + depth / 2));
    // A folded board never lies perfectly flat: each half lifts a hair at the hinge.
    mesh.rotation.x = side * -0.0022;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  // Cloth hinge visible in the fold.
  const hinge = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_UNITS - 0.02, BOARD_THICKNESS * 0.8, gap * 1.6),
    new THREE.MeshStandardMaterial({ color: '#1d2114', roughness: 1 }),
  );
  hinge.position.y = BOARD_THICKNESS * 0.4;
  group.add(hinge);

  group.add(woodTable());
  return { table: group, print };
}

/**
 * A one-piece plus-shaped board (the 3–4 player board), in the field's outline plus the
 * margin. Extruded from the outline with a soft bevel; the print is mapped from above.
 */
function shapedBoard(spec: BoardSpec, top: THREE.Material, edge: THREE.Material) {
  const U = boardUnits(spec);
  // A plus: the arms are the columns/rows that reach the board's edge.
  const h = spec.size / 2;
  let lo = 0;
  while (lo < spec.size && !spec.playable({ x: lo, y: 0 })) lo++;
  const a = h - lo + 0.5; // half arm width, including the 0.5 margin
  const b = h + 0.5; // half extent, including the margin
  const shape = new THREE.Shape();
  const pts: [number, number][] = [
    [-a, -b],
    [a, -b],
    [a, -a],
    [b, -a],
    [b, a],
    [a, a],
    [a, b],
    [-a, b],
    [-a, a],
    [-b, a],
    [-b, -a],
    [-a, -a],
  ];
  pts.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: BOARD_THICKNESS - 0.012,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // Shape x/y become world x/-z; map the top face's shape coordinates onto the print.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / U + 0.5, uv.getY(i) / U + 0.5);
  uv.needsUpdate = true;
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.006, 0);
  const mesh = new THREE.Mesh(geo, [top, edge]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function woodTable() {
  const wood = woodMaps();
  // Planks ~2.5 board squares wide.
  for (const t of [wood.map, wood.normal, wood.roughness]) t.repeat.set(6, 3);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshPhysicalMaterial({
      map: wood.map,
      normalMap: wood.normal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 1,
      roughnessMap: wood.roughness,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
    }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  return table;
}
