import * as THREE from 'three';
import type { Rank, Team } from '@antego/shared';
import type { PieceKit } from '../scene/pieces.js';
import type { SceneOverride } from '../scene/stage.js';
import { woodMaps } from '../scene/textures.js';

export interface MinigameContext {
  kit: PieceKit;
  /** Same seed for both players, so both get the same targets, wind and timing. */
  seed: number;
  /** 0–3: the stronger soldier's head start. */
  handicap: number;
  team: Team;
  /** The soldier fighting this battle. */
  rank: Rank;
}

/** Pointer position: x/y in 0–1 across the screen, plus normalised device coordinates for raycasting. */
export interface Pointer {
  x: number;
  y: number;
  ndc: THREE.Vector2;
}

/** One short, seeded, touch-only game that ends with a 0–100 score. */
export abstract class Minigame implements SceneOverride {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 120);
  /** Milliseconds of play (the countdown bar). A game may also finish early. */
  abstract readonly duration: number;
  elapsed = 0;
  running = false;
  finished = false;
  onFinish: (() => void) | null = null;

  constructor(protected ctx: MinigameContext) {
    // A warm, out-of-focus room behind the table instead of a black void.
    this.scene.background = backdrop();
    this.scene.fog = new THREE.Fog('#5a4430', 18, 46);
    this.scene.environmentIntensity = 0.4;
    const key = new THREE.DirectionalLight('#fff0d8', 3);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera;
    c.left = c.bottom = -16;
    c.right = c.top = 16;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key, new THREE.HemisphereLight('#e4ebff', '#5a3e22', 0.5));
    this.key = key;
  }

  protected key: THREE.DirectionalLight;

  /** A wooden table top, like the one under the board. */
  protected table(size = 140) {
    const wood = sharedWood();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshPhysicalMaterial({
        map: wood.map,
        normalMap: wood.normal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 1,
        roughnessMap: wood.roughness,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  update(dt: number) {
    if (!this.running || this.finished) {
      this.idle(dt);
      return;
    }
    this.elapsed += dt;
    this.step(dt);
    if (this.elapsed >= this.duration) this.finish();
  }

  protected finish() {
    if (this.finished) return;
    this.finished = true;
    this.onFinish?.();
  }

  /** Before the start (and after the end): gentle idle animation. */
  protected idle(_dt: number) {}
  protected abstract step(dt: number): void;
  down(_p: Pointer) {}
  move(_p: Pointer) {}
  up(_p: Pointer) {}
  abstract score(): number;

  private owned: { dispose(): void }[] = [];

  /** Remember a geometry, material or texture this game created, so dispose() frees it (never the shared models). */
  protected own<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing);
    return thing;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.owned = [];
  }
}

let wood: ReturnType<typeof woodMaps> | null = null;
function sharedWood() {
  if (!wood) {
    wood = woodMaps(512);
    for (const t of [wood.map, wood.normal, wood.roughness]) t.repeat.set(14, 7);
  }
  return wood;
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let room: THREE.Texture | null = null;
function backdrop() {
  if (!room) {
    room = canvasTexture(64, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#2c2118');
      grad.addColorStop(0.45, '#6b5238');
      grad.addColorStop(0.62, '#5a4430');
      grad.addColorStop(1, '#3a2a1c');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 256);
    });
  }
  return room;
}
