import * as THREE from 'three';
import { sfx } from '../audio/sfx.js';
import { BOARD_TOP, activeBoard } from './board.js';
import { inLake, onCardboard, type P2 } from './drive.js';
import { every } from './tween.js';

interface Drop {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
}
interface Fade {
  mesh: THREE.Mesh;
  life: number;
  age: number;
  grow: number;
  opacity: number;
}

/** Height of the surface under p: the cardboard's top, or the table. */
export function groundAt(p: P2) {
  return onCardboard(activeBoard(), p) ? BOARD_TOP : 0;
}

/**
 * Water play for toy vehicles in the printed lakes: spray from the wheels, white foam, bow
 * waves and ripples where drops land, a splash sound; afterwards wet tyre prints that dry up.
 * One Water per scene; one Wake per vehicle.
 */
export class Water {
  private drops: Drop[] = [];
  private fades: Fade[] = [];
  private readonly dropGeo = new THREE.SphereGeometry(1, 8, 6);
  private readonly dropMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.08,
    transparent: true,
    opacity: 0.92,
    emissive: '#8fb4d0',
    emissiveIntensity: 0.55,
  });
  private readonly ringGeo = new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2);
  private readonly dotGeo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  private readonly printGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(private scene: THREE.Scene) {}

  wake(kind: 'jeep' | 'tank', contacts: readonly P2[]) {
    return new Wake(this, kind, contacts);
  }

  /** Drop everything at once (a race or game ending). */
  clear() {
    for (const d of this.drops) this.scene.remove(d.mesh);
    for (const f of this.fades) {
      this.scene.remove(f.mesh);
      (f.mesh.material as THREE.Material).dispose();
    }
    this.drops = [];
    this.fades = [];
  }

  spray(p: P2, h: P2, side: P2, outward: number, speed: number) {
    const lively = Math.min(1.3, 0.5 + speed / 2.5);
    for (let n = 0; n < 3; n++) {
      if (this.drops.length > 320) return;
      const r = 0.028 + Math.random() * 0.038;
      const mesh = new THREE.Mesh(this.dropGeo, this.dropMat);
      mesh.scale.setScalar(r);
      mesh.position.set(p.x, BOARD_TOP + 0.03, p.z);
      const out = outward * (0.6 + Math.random() * 1.1) * lively;
      const back = -(0.2 + Math.random() * 0.5) * speed * 0.4;
      const vel = new THREE.Vector3(
        side.x * out + h.x * back + (Math.random() - 0.5) * 0.3,
        (1.6 + Math.random() * 1.4) * lively,
        side.z * out + h.z * back + (Math.random() - 0.5) * 0.3,
      );
      this.drops.push({ mesh, vel });
      this.scene.add(mesh);
      this.tick();
    }
  }

  /** Churned-up white water where a wheel is. */
  foam(p: P2) {
    const mesh = this.fade(this.dotGeo, '#ffffff', 0.45, 0.6, 0.3);
    if (!mesh) return;
    mesh.position.set(
      p.x + (Math.random() - 0.5) * 0.1,
      BOARD_TOP + 0.005,
      p.z + (Math.random() - 0.5) * 0.1,
    );
    mesh.scale.setScalar(0.08);
  }

  ripple(p: P2, from: number, to: number, life: number, opacity = 0.75) {
    const mesh = this.fade(this.ringGeo, '#ffffff', opacity, life, (to - from) / life);
    if (!mesh) return;
    mesh.position.set(p.x, BOARD_TOP + 0.004, p.z);
    mesh.scale.setScalar(from);
  }

  /** A wet tyre (or track) print, fading as it dries. */
  print(p: P2, h: P2, kind: 'jeep' | 'tank', level: number) {
    const mesh = this.fade(this.printGeo, '#1d2a33', 0.5 * level, 9, 0, true);
    if (!mesh) return;
    mesh.position.set(p.x, groundAt(p) + 0.002, p.z);
    mesh.rotation.y = Math.atan2(-h.z, h.x);
    if (kind === 'tank') mesh.scale.set(0.09, 1, 0.22);
    else mesh.scale.set(0.1, 1, 0.14);
  }

  /** A drop of water landing on the cardboard or the table. */
  private dot(p: P2) {
    const mesh = this.fade(this.dotGeo, '#1d2a33', 0.22, 6, 0);
    if (!mesh) return;
    mesh.scale.setScalar(0.02 + Math.random() * 0.025);
    mesh.position.set(p.x, groundAt(p) + 0.002, p.z);
  }

  private fade(
    geo: THREE.BufferGeometry,
    color: string,
    opacity: number,
    life: number,
    grow: number,
    offset = false,
  ) {
    if (this.fades.length > 240) return null;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: offset,
        polygonOffsetFactor: offset ? -1 : 0,
      }),
    );
    this.fades.push({ mesh, life, age: 0, grow, opacity });
    this.scene.add(mesh);
    this.tick();
    return mesh;
  }

  private ticking = false;

  /** Keep the water moving (also while the tab is in the background) until it has all settled. */
  private tick() {
    if (this.ticking) return;
    this.ticking = true;
    void every((dt) => {
      this.update(dt);
      this.ticking = this.drops.length + this.fades.length > 0;
      return this.ticking;
    });
  }

  /** Droplets fly and land (with a ripple), rings grow, prints dry. */
  private update(dtMs: number) {
    const dt = Math.min(dtMs, 100) / 1000;
    const board = activeBoard();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.vel.y -= 11 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      const p = { x: d.mesh.position.x, z: d.mesh.position.z };
      if (d.mesh.position.y > groundAt(p)) continue;
      if (inLake(board, p)) this.ripple(p, 0.03, 0.22, 0.6, 0.45);
      else if (Math.random() < 0.5) this.dot(p);
      this.scene.remove(d.mesh);
      this.drops.splice(i, 1);
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]!;
      f.age += dt;
      const k = f.age / f.life;
      if (f.grow) f.mesh.scale.setScalar(f.mesh.scale.x + f.grow * dt);
      const m = f.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = f.opacity * (1 - k) * (f.grow ? 1 : Math.min(1, (1 - k) * 3));
      if (k >= 1) {
        this.scene.remove(f.mesh);
        m.dispose();
        this.fades.splice(i, 1);
      }
    }
  }
}

/** One vehicle's splashing and dripping; call step() every frame while it moves. */
export class Wake {
  private wet: { level: number; inWater: boolean; nextPrint: number }[];
  private s = 0;
  private splashAt = 0;
  private bowAt = 0;
  private sprayIn = 0;

  constructor(
    private water: Water,
    private kind: 'jeep' | 'tank',
    /** Wheel (or track corner) contact points in the vehicle's frame: x forward, z right. */
    private contacts: readonly P2[],
  ) {
    this.wet = contacts.map(() => ({ level: 0, inWater: false, nextPrint: 0 }));
  }

  /**
   * c: centre, h: unit heading, speed in units/s. Returns how much of the vehicle is in the
   * water (0–1), for slowing it down.
   */
  step(c: P2, h: P2, halfLength: number, speed: number, dt: number) {
    const board = activeBoard();
    const ds = Math.abs(speed) * dt;
    this.s += ds;
    const side = { x: -h.z, z: h.x };
    const at = (fwd: number, right: number): P2 => ({
      x: c.x + h.x * fwd + side.x * right,
      z: c.z + h.z * fwd + side.z * right,
    });
    const moving = Math.abs(speed) > 0.3;
    let inWater = 0;
    this.contacts.forEach((k, n) => {
      const p = at(k.x, k.z);
      const w = this.wet[n]!;
      const water = inLake(board, p);
      if (water) {
        inWater++;
        if (!w.inWater && moving && this.s > this.splashAt) {
          sfx.play('splash');
          this.splashAt = this.s + 0.9;
        }
        w.level = 1;
        if (moving && this.sprayIn <= 0) {
          this.water.spray(p, h, side, Math.sign(k.z) || 1, Math.abs(speed));
          this.water.foam(p);
        }
      } else if (w.level > 0) {
        w.level = Math.max(0, w.level - ds / 3.5);
        if (this.s >= w.nextPrint) {
          this.water.print(p, h, this.kind, w.level);
          w.nextPrint = this.s + 0.13;
        }
      }
      w.inWater = water;
    });
    this.sprayIn = this.sprayIn <= 0 ? 0.05 : this.sprayIn - dt;
    if (inWater && moving && this.s >= this.bowAt) {
      const front = at(halfLength * 0.9 * Math.sign(speed), 0);
      if (inLake(board, front)) this.water.ripple(front, 0.35, 1.1, 1.3);
      const back = at(-halfLength * 0.8 * Math.sign(speed), 0);
      if (inLake(board, back)) this.water.ripple(back, 0.25, 0.8, 1.1);
      this.bowAt = this.s + 0.22;
    }
    return inWater / Math.max(1, this.contacts.length);
  }
}
