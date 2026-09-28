import * as THREE from 'three';
import type { Pos } from '@antego/shared';
import { BOARD_UNITS, boardEdge, boardPrint, paperMaps, woodMaps } from './textures.js';

export const BOARD_THICKNESS = 0.07;
/** Height of the printed surface above the table. */
export const BOARD_TOP = BOARD_THICKNESS;

/** Board square → world position of its centre on the printed surface. y 9 (green's home) is nearest +Z. */
export function squareToWorld(p: Pos, y = BOARD_TOP): THREE.Vector3 {
  return new THREE.Vector3(p.x - 4.5, y, p.y - 4.5);
}

export function worldToSquare(v: THREE.Vector3): Pos | null {
  const x = Math.floor(v.x + 5);
  const y = Math.floor(v.z + 5);
  return x >= 0 && x < 10 && y >= 0 && y < 10 ? { x, y } : null;
}

/**
 * A folding cardboard game board: two laminated halves with a cloth hinge, printed top,
 * grey chipboard edges with the paper wrapped over, lying on a wooden table.
 */
export function buildTable(printSize: number): THREE.Group {
  const group = new THREE.Group();
  const paper = paperMaps();
  const print = boardPrint(printSize);
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

  const wood = woodMaps();
  wood.map.repeat.set(5, 5);
  wood.normal.repeat.set(5, 5);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshPhysicalMaterial({
      map: wood.map,
      normalMap: wood.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.55,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
    }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  group.add(table);
  return group;
}
