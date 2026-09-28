import * as THREE from 'three';
import { BOARDS, type BoardId } from '@antego/shared';
import { buildTable, setActiveBoard } from './board.js';
import type { PieceKit } from './pieces.js';
import { buildProps } from './props.js';

/**
 * The table and everything on it, per board. Boards are built the first time they're used and
 * kept, so switching between classic and the plus board is instant afterwards.
 */
export class World {
  private built = new Map<BoardId, THREE.Group>();
  current: BoardId | null = null;

  constructor(
    private scene: THREE.Scene,
    private kit: PieceKit,
    private printSize: number,
  ) {}

  use(id: BoardId) {
    setActiveBoard(BOARDS[id]);
    if (this.current === id) return;
    this.current = id;
    let group = this.built.get(id);
    if (!group) {
      group = new THREE.Group();
      const { table, print } = buildTable(this.printSize, BOARDS[id]);
      group.add(table, buildProps(this.kit, print, BOARDS[id]));
      this.built.set(id, group);
      this.scene.add(group);
    }
    for (const [key, g] of this.built) g.visible = key === id;
  }
}
