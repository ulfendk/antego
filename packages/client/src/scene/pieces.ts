import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RANK_ORDER, type Rank, type Team } from '@antego/shared';
import { plasticMaterial } from './plastic.js';
import { TEAM_COLORS, badge, emblem, radial } from './textures.js';

interface Model {
  geo: THREE.BufferGeometry;
  /** Meshopt stores quantized positions; the node transform scales them back to board units. */
  matrix: THREE.Matrix4;
}

interface ModelSet {
  lod0: Model;
  lod1: Model;
}

/** A standalone soldier mesh in board units (used by the mini-games). */
export function soldierMesh(kit: PieceKit, rank: Rank, team: Team, lod: 0 | 1 = 0): THREE.Mesh {
  const set = kit.models.get(rank)!;
  const model = lod === 0 ? set.lod0 : set.lod1;
  const mesh = new THREE.Mesh(model.geo, kit.plastic[team]);
  mesh.applyMatrix4(model.matrix);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Everything needed to draw pieces, loaded once. */
export class PieceKit {
  models = new Map<Rank, ModelSet>();
  plastic: Record<Team, THREE.MeshPhysicalMaterial> = {
    groen: plasticMaterial(TEAM_COLORS.groen.plastic),
    sand: plasticMaterial(TEAM_COLORS.sand.plastic),
    blaa: plasticMaterial(TEAM_COLORS.blaa.plastic),
    brun: plasticMaterial(TEAM_COLORS.brun.plastic),
  };
  private badges = new Map<string, THREE.SpriteMaterial>();
  private tiles = new Map<Team, { body: THREE.Material; emblem: THREE.Material }>();
  readonly shadowMat = new THREE.MeshBasicMaterial({
    map: radial('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'),
    transparent: true,
    depthWrite: false,
  });
  readonly shadowGeo = new THREE.PlaneGeometry(0.95, 0.85).rotateX(-Math.PI / 2);
  /** Hidden enemy pieces: an upright Stratego-style plastic tile on a little foot. */
  readonly tileGeo = new RoundedBoxGeometry(0.58, 0.68, 0.12, 4, 0.045);
  readonly footGeo = new RoundedBoxGeometry(0.46, 0.05, 0.3, 3, 0.02);
  readonly emblemGeo = new THREE.PlaneGeometry(0.44, 0.44);

  constructor(public lod0Distance: number) {}

  static async load(lod0Distance: number, onProgress?: (k: number) => void): Promise<PieceKit> {
    const kit = new PieceKit(lod0Distance);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const grab = async (file: string): Promise<Model> => {
      const gltf = await loader.loadAsync(`/models/${file}`);
      gltf.scene.updateMatrixWorld(true);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      const m = mesh as unknown as THREE.Mesh;
      const g = m.geometry;
      const col = g.getAttribute('color');
      if (col) {
        g.setAttribute('aoCurv', col);
        g.deleteAttribute('color');
      }
      return { geo: g, matrix: m.matrixWorld.clone() };
    };
    let done = 0;
    await Promise.all(
      RANK_ORDER.map(async (rank) => {
        const [lod0, lod1] = await Promise.all([grab(`${rank}.glb`), grab(`${rank}-lod1.glb`)]);
        kit.models.set(rank, { lod0, lod1 });
        onProgress?.(++done / RANK_ORDER.length);
      }),
    );
    return kit;
  }

  badge(rank: Rank, team: Team) {
    const key = `${rank}-${team}`;
    let m = this.badges.get(key);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: badge(rank, team), depthTest: false, transparent: true });
      this.badges.set(key, m);
    }
    return m;
  }

  tile(team: Team) {
    let m = this.tiles.get(team);
    if (!m) {
      m = {
        body: plasticMaterial(TEAM_COLORS[team].plastic, false),
        emblem: new THREE.MeshStandardMaterial({
          map: emblem(team),
          transparent: true,
          roughness: 0.5,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      };
      this.tiles.set(team, m);
    }
    return m;
  }
}

export const PIECE_SCALE = 1.3;

/** Soldiers face the enemy: the models look along +Z, so turn each army towards its front. */
const FACING: Record<Team, number> = {
  groen: Math.PI, // towards -Z
  sand: 0, // towards +Z
  blaa: Math.PI / 2, // towards +X
  brun: -Math.PI / 2, // towards -X
};

/** One piece on the table: a soldier (or a hidden tile for unknown enemies), its contact shadow and badge. */
export class PieceObject extends THREE.Group {
  rank: Rank | null = null;
  /** The part that tips over, hops and lifts (the shadow stays on the board). */
  readonly body = new THREE.Group();
  private badgeSprite: THREE.Sprite | null = null;
  private shadow: THREE.Mesh;

  constructor(
    public readonly pieceId: string,
    public readonly team: Team,
    private kit: PieceKit,
  ) {
    super();
    this.shadow = new THREE.Mesh(kit.shadowGeo, kit.shadowMat);
    this.shadow.position.y = 0.002;
    this.shadow.renderOrder = 1;
    this.add(this.shadow, this.body);
    // A touch bigger than a real army man on a Stratego square, so small screens read well.
    this.scale.setScalar(PIECE_SCALE);
    // Soldiers face the enemy: green looks towards -Z, brown towards +Z.
    this.body.rotation.y = FACING[team];
  }

  /** Show the soldier for a known rank, or the army's hidden card for null. */
  setRank(rank: Rank | null, showBadge: boolean) {
    if (rank === this.rank && this.body.children.length) {
      this.setBadge(showBadge);
      return;
    }
    this.rank = rank;
    this.body.clear();
    this.badgeSprite = null;
    if (rank) {
      const set = this.kit.models.get(rank)!;
      const mat = this.kit.plastic[this.team];
      const lod = new THREE.LOD();
      const hi = new THREE.Mesh(set.lod0.geo, mat);
      const lo = new THREE.Mesh(set.lod1.geo, mat);
      hi.applyMatrix4(set.lod0.matrix);
      lo.applyMatrix4(set.lod1.matrix);
      for (const m of [hi, lo]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      if (this.kit.lod0Distance > 0) lod.addLevel(hi, 0);
      lod.addLevel(lo, this.kit.lod0Distance);
      this.body.add(lod);
    } else {
      // Rank unknown: the army's plastic tile, embossed emblem on both faces.
      const m = this.kit.tile(this.team);
      const tile = new THREE.Group();
      const slab = new THREE.Mesh(this.kit.tileGeo, m.body);
      slab.castShadow = slab.receiveShadow = true;
      tile.add(slab);
      for (const side of [1, -1]) {
        const e = new THREE.Mesh(this.kit.emblemGeo, m.emblem);
        e.position.set(0, 0.03, side * 0.061);
        if (side < 0) e.rotation.y = Math.PI;
        tile.add(e);
      }
      tile.position.y = 0.38;
      tile.rotation.x = -0.07;
      const foot = new THREE.Mesh(this.kit.footGeo, m.body);
      foot.position.y = 0.025;
      foot.castShadow = foot.receiveShadow = true;
      this.body.add(tile, foot);
    }
    this.setBadge(showBadge);
  }

  setBadge(show: boolean) {
    if (!show || !this.rank) {
      if (this.badgeSprite) this.remove(this.badgeSprite);
      this.badgeSprite = null;
      return;
    }
    if (this.badgeSprite) return;
    const s = new THREE.Sprite(this.kit.badge(this.rank, this.team));
    s.scale.setScalar(0.24);
    s.position.y = this.rank === 'mine' ? 0.32 : this.rank === 'flag' ? 1.0 : 0.95;
    s.renderOrder = 10;
    this.badgeSprite = s;
    this.add(s);
  }

  set shadowOpacity(v: number) {
    this.shadow.visible = v > 0.01;
    this.shadow.scale.setScalar(0.8 + (1 - v) * 0.6);
  }
}
