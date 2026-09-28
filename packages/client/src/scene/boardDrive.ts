import * as THREE from 'three';
import { sfx } from '../audio/sfx.js';
import { activeBoard } from './board.js';
import { headingAt, planDrive, type P2 } from './drive.js';
import type { Presenter } from './presenter.js';
import { tableObstacles } from './props.js';
import { every } from './tween.js';
import { Water, groundAt } from './water.js';

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

/**
 * The toy jeep or tank drives right across the board, round the soldiers and through a lake:
 * spray, ripples and a bow wave in the water, wet tyre prints on the cardboard after it.
 * Moves wait while it is on the board (and it hurries if one is waiting).
 */
export class BoardDrive {
  constructor(
    private water: Water,
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
    const o = v.object;
    o.rotation.order = 'YZX';
    o.visible = true;
    const total = (route.length - 1) * STEP;
    const wake = this.water.wake(v.kind, v.contacts);
    let s = 0;
    let aim = 0;
    let y = 0;
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
      const yf = groundAt(at(v.axle, 0));
      const yr = groundAt(at(-v.axle, 0));
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

      wake.step(c, h, v.halfLength, speed, dt);
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
}
