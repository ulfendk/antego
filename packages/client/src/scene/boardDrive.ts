import * as THREE from 'three';
import { sfx } from '../audio/sfx.js';
import { BOARD_TOP, activeBoard } from './board.js';
import { headingAt, inLake, onCardboard, planDrive, type P2 } from './drive.js';
import type { Presenter } from './presenter.js';
import { tableObstacles } from './props.js';
import { every } from './tween.js';

/** How a toy vehicle drives over the board (sizes in world units, after scaling). */
export interface VehicleSpec {
  kind: 'jeep' | 'tank';
  object: THREE.Object3D;
  halfWidth: number;
  halfLength: number;
  /** Distance from the centre to the front and rear axles (they ride the board's edge). */
  axle: number;
  /** Where the wheels (or track corners) touch the ground, in the vehicle's frame (+x forward). */
  contacts: P2[];
  /** Wheels to roll (jeep), with their radius. */
  wheels?: { hubs: THREE.Object3D[]; radius: number };
  /** Turret to swivel at soldiers (tank). */
  turret?: THREE.Object3D;
  speed: number;
}

const STEP = 0.05; // route spacing from planDrive

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

/**
 * The toy jeep or tank drives right across the board, round the soldiers and through a lake:
 * spray, ripples and a bow wave in the water, wet tyre prints on the cardboard after it.
 * Moves wait while it is on the board (and it hurries if one is waiting).
 */
export class BoardDrive {
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

  constructor(
    private scene: THREE.Scene,
    private presenter: Presenter,
  ) {}

  /** Drives across if there's room; false when the board is too crowded (or busy). */
  async drive(v: VehicleSpec): Promise<boolean> {
    if (this.presenter.busy) return false;
    const board = activeBoard();
    const pieces = this.presenter.boardPieces().map((o) => ({ x: o.position.x, z: o.position.z }));
    const route = planDrive({
      board,
      pieces,
      obstacles: tableObstacles(),
      halfWidth: v.halfWidth,
      halfLength: v.halfLength,
    });
    if (!route) return false;
    let passed!: () => void;
    this.presenter.holdUntil(new Promise<void>((r) => (passed = r)));
    try {
      await this.follow(v, route);
    } finally {
      v.object.visible = false;
      v.object.rotation.set(0, 0, 0);
      if (v.turret) v.turret.rotation.y = 0;
      passed();
    }
    return true;
  }

  private async follow(v: VehicleSpec, route: P2[]) {
    const board = activeBoard();
    const o = v.object;
    o.rotation.order = 'YZX';
    o.visible = true;
    const total = (route.length - 1) * STEP;
    const ground = (p: P2) => (onCardboard(board, p) ? BOARD_TOP : 0);
    const wet = v.contacts.map(() => ({ level: 0, inWater: false, nextPrint: 0 }));
    let s = 0;
    let splashAt = 0;
    let bowAt = 0;
    let aim = 0;
    let y = 0;
    let sprayIn = 0;
    sfx.play(v.kind === 'tank' ? 'rumble' : 'drive');

    await every((dtMs) => {
      const dt = Math.min(dtMs, 100) / 1000;
      // Ease in, and hurry off if a move is waiting for us.
      const speed = v.speed * Math.min(1, 0.35 + s / 1.2) * (this.presenter.busy ? 2.4 : 1);
      const ds = speed * dt;
      s = Math.min(total, s + ds);
      const f = s / STEP;
      const i = Math.min(route.length - 1, Math.floor(f));
      const a = route[i]!;
      const b = route[Math.min(route.length - 1, i + 1)]!;
      const c = { x: a.x + (b.x - a.x) * (f - i), z: a.z + (b.z - a.z) * (f - i) };
      const h = headingAt(route, i, 10);
      const side = { x: -h.z, z: h.x };
      const at = (fwd: number, right: number): P2 => ({
        x: c.x + h.x * fwd + side.x * right,
        z: c.z + h.z * fwd + side.z * right,
      });

      // Ride up onto the cardboard: height from both axles, pitch from the difference.
      const yf = ground(at(v.axle, 0));
      const yr = ground(at(-v.axle, 0));
      y += ((yf + yr) / 2 - y) * Math.min(1, dt * 18);
      o.position.set(c.x, y, c.z);
      o.rotation.y = Math.atan2(-h.z, h.x);
      o.rotation.z = Math.atan2(yf - yr, 2 * v.axle) * 0.8;
      if (v.kind === 'tank') o.rotation.z += Math.sin(s * 11) * 0.006;
      else o.position.y += Math.abs(Math.sin(s * 9)) * 0.012;

      if (v.wheels) for (const hub of v.wheels.hubs) hub.rotation.x += ds / v.wheels.radius;
      if (v.turret) {
        aim += (this.turretAim(c, h) - aim) * Math.min(1, dt * 2.5);
        v.turret.rotation.y = aim;
      }

      // Water: spray from every wheel in a lake, a bow wave, splash sounds; wet prints after.
      let anyWater = false;
      v.contacts.forEach((k, n) => {
        const p = at(k.x, k.z);
        const w = wet[n]!;
        const water = inLake(board, p);
        if (water) {
          anyWater = true;
          if (!w.inWater && s > splashAt) {
            sfx.play('splash');
            splashAt = s + 0.9;
          }
          w.level = 1;
        } else if (w.level > 0) {
          w.level = Math.max(0, w.level - ds / 3.5);
          if (s >= w.nextPrint && onCardboard(board, p)) {
            this.print(p, h, v.kind, w.level);
            w.nextPrint = s + 0.13;
          }
        }
        w.inWater = water;
        if (water && sprayIn <= 0) {
          this.spray(p, h, side, Math.sign(k.z) || 1, speed);
          this.foam(p);
        }
      });
      sprayIn = sprayIn <= 0 ? 0.05 : sprayIn - dt;
      if (anyWater && s >= bowAt) {
        const front = at(v.halfLength * 0.9, 0);
        if (inLake(board, front)) this.ripple(front, 0.35, 1.1, 1.3);
        const back = at(-v.halfLength * 0.8, 0);
        if (inLake(board, back)) this.ripple(back, 0.25, 0.8, 1.1);
        bowAt = s + 0.22;
      }
      return s < total;
    });
  }

  /** Turret yaw (relative to the hull) towards the nearest soldier ahead, within reason. */
  private turretAim(c: P2, h: P2) {
    let best = 3.5;
    let yaw = 0;
    for (const o of this.presenter.boardPieces()) {
      const dx = o.position.x - c.x;
      const dz = o.position.z - c.z;
      const d = Math.hypot(dx, dz);
      const ahead = (dx * h.x + dz * h.z) / (d || 1);
      if (d < best && ahead > 0.3) {
        best = d;
        // Angle from heading to soldier; +yaw turns the turret to the left (towards -z side).
        yaw = Math.atan2(h.x * dz - h.z * dx, h.x * dx + h.z * dz) * -1;
      }
    }
    return THREE.MathUtils.clamp(yaw, -0.45, 0.45);
  }

  private spray(p: P2, h: P2, side: P2, outward: number, speed: number) {
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
  private foam(p: P2) {
    if (this.fades.length > 200) return;
    const opacity = 0.45;
    const mesh = new THREE.Mesh(
      this.dotGeo,
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    mesh.position.set(
      p.x + (Math.random() - 0.5) * 0.1,
      BOARD_TOP + 0.005,
      p.z + (Math.random() - 0.5) * 0.1,
    );
    mesh.scale.setScalar(0.08);
    this.fades.push({ mesh, life: 0.6, age: 0, grow: 0.3, opacity });
    this.scene.add(mesh);
    this.tick();
  }

  private ripple(p: P2, from: number, to: number, life: number, opacity = 0.75) {
    if (this.fades.length > 200) return;
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    mesh.position.set(p.x, BOARD_TOP + 0.004, p.z);
    mesh.scale.setScalar(from);
    this.fades.push({ mesh, life, age: 0, grow: (to - from) / life, opacity });
    this.scene.add(mesh);
    this.tick();
  }

  /** A wet tyre (or track) print on the cardboard, fading as it dries. */
  private print(p: P2, h: P2, kind: VehicleSpec['kind'], level: number) {
    if (this.fades.length > 200) return;
    const opacity = 0.5 * level;
    const mesh = new THREE.Mesh(
      this.printGeo,
      new THREE.MeshBasicMaterial({
        color: '#1d2a33',
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    mesh.position.set(p.x, BOARD_TOP + 0.002, p.z);
    mesh.rotation.y = Math.atan2(-h.z, h.x);
    if (kind === 'tank') mesh.scale.set(0.09, 1, 0.22);
    else mesh.scale.set(0.1, 1, 0.14);
    this.fades.push({ mesh, life: 9, age: 0, grow: 0, opacity });
    this.scene.add(mesh);
    this.tick();
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
      if (d.mesh.position.y > BOARD_TOP) continue;
      const p = { x: d.mesh.position.x, z: d.mesh.position.z };
      if (inLake(board, p)) this.ripple(p, 0.03, 0.22, 0.6, 0.45);
      else if (onCardboard(board, p) && Math.random() < 0.5) this.dot(p);
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

  /** A drop of water landing on the cardboard. */
  private dot(p: P2) {
    if (this.fades.length > 200) return;
    const opacity = 0.22;
    const mesh = new THREE.Mesh(
      this.dotGeo,
      new THREE.MeshBasicMaterial({
        color: '#1d2a33',
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    mesh.scale.setScalar(0.02 + Math.random() * 0.025);
    mesh.position.set(p.x, BOARD_TOP + 0.002, p.z);
    this.fades.push({ mesh, life: 6, age: 0, grow: 0, opacity });
    this.scene.add(mesh);
    this.tick();
  }
}
