import * as THREE from 'three';
import { sfx } from '../audio/sfx.js';
import { activeBoard } from './board.js';
import { loadModel, modelMesh } from './pieces.js';
import { plasticMaterial } from './plastic.js';
import type { Presenter } from './presenter.js';
import { toyBoxCentres } from './props.js';
import type { Stage } from './stage.js';
import { ease, tween, wait } from './tween.js';

/**
 * Little surprises around the table that have nothing to do with the game: a toy jeep racing
 * past behind enemy lines, a paper plane gliding over, a tank peeking out from behind a toy
 * box, a fallen soldier sitting up in the toy box to wave. One every minute or so.
 */
/** Toy vehicles are sculpted to the soldiers' scale (see tools/models/vehicles.py). */
const VEHICLE_SCALE = 1.1;
/** Distance from a toy box's flaps to the tank's centre line (half the tank's width, and some). */
const TANK_CLEARANCE = 0.75;
const WHEEL_R = 0.2;

export class EasterEggs {
  private next = 30_000 + Math.random() * 30_000;
  private busy = false;
  private last = -1;
  private readonly olive = plasticMaterial('#56663a');
  private readonly rubber = plasticMaterial('#2c2d28');
  /** The toy vehicles, forward along +X; loaded after start-up (null until then). */
  private jeep: THREE.Group | null = null;
  private wheels: THREE.Object3D[] = [];
  private tank: THREE.Group | null = null;
  private turret: THREE.Object3D | null = null;
  private plane = this.buildPlane();
  private dust: THREE.Mesh[] = [];
  private dustGeo = new THREE.SphereGeometry(0.12, 8, 6);
  private dustMat = new THREE.MeshBasicMaterial({
    color: '#d9ccaa',
    transparent: true,
    depthWrite: false,
  });

  constructor(
    private scene: THREE.Scene,
    private stage: Stage,
    private presenter: Presenter,
  ) {
    this.plane.visible = false;
    scene.add(this.plane);
    // Not needed for the first half minute: don't compete with the soldiers while loading.
    setTimeout(() => void this.loadVehicles().catch(() => undefined), 5000);
  }

  /** Called every frame (not during mini-games). */
  update(dt: number) {
    this.updateDust(dt);
    if (this.busy) return;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = 40_000 + Math.random() * 50_000;
    let pick = Math.floor(Math.random() * this.eggs.length);
    if (pick === this.last) pick = (pick + 1) % this.eggs.length;
    this.play(pick);
  }

  /** Each resolves false if it had nothing to show. */
  private readonly eggs: (() => Promise<boolean>)[] = [
    () => this.jeepRun(),
    () => this.planeGlide(),
    () => this.tankPeek(),
    () => this.wave(),
  ];

  /** Run one now (0 jeep, 1 plane, 2 tank, 3 wave); `?debug` exposes this as eggs.play(i). */
  play(i: number) {
    if (this.busy) return;
    if ((i === 0 || i === 2) && !this.jeep) {
      this.next = 2000;
      return;
    }
    this.last = i;
    this.busy = true;
    void this.eggs[i]!()
      .catch(() => false)
      .then((played) => {
        this.busy = false;
        // Nothing to show from here (no fallen soldiers, no box in view): try another soon.
        if (!played) this.next = 2000;
      });
  }

  // ---------------------------------------------------------------- the jeep

  private async loadVehicles() {
    const [manifest, body, wheel, hull, turret] = await Promise.all([
      fetch('/models/manifest.json').then(
        (r) => r.json() as Promise<Record<string, { parts?: number[][] }>>,
      ),
      loadModel('jeep.glb'),
      loadModel('jeep-wheel.glb'),
      loadModel('tank.glb'),
      loadModel('tank-turret.glb'),
    ]);
    // The models look along +Z; the egg code drives along +X.
    const vehicle = (...parts: THREE.Object3D[]) => {
      const outer = new THREE.Group();
      const inner = new THREE.Group();
      inner.rotation.y = Math.PI / 2;
      inner.add(...parts);
      outer.add(inner);
      outer.scale.setScalar(VEHICLE_SCALE);
      outer.visible = false;
      this.scene.add(outer);
      return outer;
    };
    this.wheels = (manifest['jeep-wheel']?.parts ?? []).map(([x, y, z]) => {
      const hub = new THREE.Group();
      hub.position.set(x!, y!, z!);
      hub.add(modelMesh(wheel, this.rubber));
      return hub;
    });
    this.jeep = vehicle(modelMesh(body, this.olive), ...this.wheels);
    const [tx, ty, tz] = manifest['tank-turret']?.parts?.[0] ?? [0, 0.5, 0.05];
    this.turret = new THREE.Group();
    this.turret.position.set(tx!, ty!, tz!);
    this.turret.add(modelMesh(turret, this.olive));
    this.tank = vehicle(modelMesh(hull, this.olive), this.turret);
  }

  /** Where "behind enemy lines" is for the camera's army: a lane beyond the far edge. */
  private farLane() {
    const board = activeBoard();
    const fwd = board.forward[this.stage.currentSide] ?? { x: 0, y: -1 };
    const d = board.size / 2 + 1.7;
    const across = new THREE.Vector3(-fwd.y, 0, fwd.x); // perpendicular to "forward"
    const centre = new THREE.Vector3(fwd.x * d, 0, fwd.y * d);
    return { centre, across };
  }

  private async jeepRun() {
    const { centre, across } = this.farLane();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = centre.clone().addScaledVector(across, -17 * dir);
    const b = centre.clone().addScaledVector(across, 17 * dir);
    const j = this.jeep!;
    j.visible = true;
    j.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    sfx.play('engine');
    let puff = 0;
    await tween(
      3600,
      (k) => {
        const before = j.position.clone().setY(0);
        j.position.lerpVectors(a, b, k);
        // Wheels roll with the distance covered; bouncy toy suspension.
        const roll = before.distanceTo(j.position) / (WHEEL_R * VEHICLE_SCALE);
        for (const w of this.wheels) w.rotation.x += roll;
        j.position.y = Math.abs(Math.sin(k * 60)) * 0.03;
        j.rotation.z = Math.sin(k * 45) * 0.025;
        if (k > puff) {
          puff = k + 0.02;
          this.puff(j.position.clone().addScaledVector(across, -0.8 * dir));
        }
      },
      ease.linear,
    );
    j.visible = false;
    return true;
  }

  // ---------------------------------------------------------------- the paper plane

  private buildPlane() {
    const geo = new THREE.BufferGeometry();
    // Nose at +X, two wings and a keel: a folded sheet of paper.
    const v = [
      [0.9, 0, 0],
      [-0.5, 0.16, 0.5],
      [-0.5, 0.02, 0],
      [0.9, 0, 0],
      [-0.5, 0.02, 0],
      [-0.5, 0.16, -0.5],
      [0.9, 0, 0],
      [-0.5, 0.02, 0],
      [-0.5, -0.08, 0],
    ].flat();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: '#f4f1e6',
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }

  private async planeGlide() {
    const { centre, across } = this.farLane();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = centre
      .clone()
      .multiplyScalar(0.4)
      .addScaledVector(across, -15 * dir)
      .setY(6);
    const b = centre
      .clone()
      .multiplyScalar(-0.2)
      .addScaledVector(across, 15 * dir)
      .setY(3.5);
    const p = this.plane;
    p.visible = true;
    p.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    sfx.play('whoosh');
    await tween(
      4200,
      (k) => {
        p.position.lerpVectors(a, b, k);
        p.position.y += Math.sin(k * Math.PI * 3) * 0.4;
        p.rotation.x = Math.sin(k * Math.PI * 3) * 0.25;
        p.rotation.z = Math.cos(k * Math.PI * 3) * 0.12;
      },
      ease.linear,
    );
    p.visible = false;
    return true;
  }

  // ---------------------------------------------------------------- the tank

  /**
   * Peeks out from behind the toy box: drives along the box's far side, parallel to a wall and
   * clear of the flaps, until it is past the corner – then looks around and backs off.
   */
  private async tankPeek() {
    const cam = this.stage.camera.position;
    const flat = new THREE.Vector3(cam.x, 0, cam.z);
    type Spot = { dir: THREE.Vector3; hidden: THREE.Vector3; out: THREE.Vector3; score: number };
    const spots: Spot[] = [];
    for (const { centre, halfX, halfZ } of toyBoxCentres()) {
      const towardBox = centre.clone().sub(flat).normalize();
      for (const [n, halfN, halfT] of [
        [new THREE.Vector3(1, 0, 0), halfX, halfZ],
        [new THREE.Vector3(-1, 0, 0), halfX, halfZ],
        [new THREE.Vector3(0, 0, 1), halfZ, halfX],
        [new THREE.Vector3(0, 0, -1), halfZ, halfX],
      ] as const) {
        const away = n.dot(towardBox); // > 0: this side faces away from the camera
        if (away < 0.2) continue;
        const hidden = centre.clone().addScaledVector(n, halfN + TANK_CLEARANCE);
        for (const sign of [1, -1]) {
          const dir = new THREE.Vector3(-n.z * sign, 0, n.x * sign);
          const out = hidden.clone().addScaledVector(dir, halfT + 1.3);
          const s = out.clone().project(this.stage.camera);
          if (Math.abs(s.x) > 0.8 || Math.abs(s.y) > 0.8 || s.z > 1) continue;
          if (nearBoard(out, 1.1) || nearBoard(hidden, 1.1)) continue;
          spots.push({ dir, hidden, out, score: away + centre.distanceTo(cam) * 0.05 });
        }
      }
    }
    if (!spots.length) return false;
    const { dir, hidden, out } = spots.reduce((a, b) => (b.score > a.score ? b : a));
    const t = this.tank!;
    const turret = this.turret!;
    t.visible = true;
    t.position.copy(hidden);
    t.rotation.y = Math.atan2(-dir.z, dir.x);
    const drive = 500 + hidden.distanceTo(out) * 260;
    sfx.play('squeak');
    await tween(drive, (k) => t.position.lerpVectors(hidden, out, k), ease.out);
    await tween(700, (k) => (turret.rotation.y = Math.sin(k * Math.PI) * 0.9), ease.inOut);
    await wait(400);
    await tween(700, (k) => (turret.rotation.y = -Math.sin(k * Math.PI) * 0.9), ease.inOut);
    sfx.play('squeak');
    await tween(drive, (k) => t.position.lerpVectors(out, hidden, k), ease.inOut);
    t.visible = false;
    return true;
  }

  // ---------------------------------------------------------------- the waving soldier

  /** A fallen soldier sits up in the toy box and waves – no hard feelings. */
  private async wave() {
    // Only soldiers the camera can see (a toy box may be off-screen on a phone).
    const fallen = this.presenter.fallenPieces().filter((p) => {
      const s = p.getWorldPosition(new THREE.Vector3()).project(this.stage.camera);
      return Math.abs(s.x) < 0.9 && Math.abs(s.y) < 0.9 && s.z < 1;
    });
    const who = fallen[Math.floor(Math.random() * fallen.length)];
    if (!who) return false;
    const lying = who.body.rotation.z;
    const upright = lying * 0.25;
    await tween(500, (k) => (who.body.rotation.z = lying + (upright - lying) * k), ease.out);
    await tween(
      1300,
      (k) => (who.rig.rotation.z = Math.sin(k * Math.PI * 6) * 0.22 * Math.sin(k * Math.PI)),
      ease.linear,
    );
    await tween(500, (k) => (who.body.rotation.z = upright + (lying - upright) * k), ease.bounce);
    who.rig.rotation.z = 0;
    return true;
  }

  // ---------------------------------------------------------------- dust

  private puff(at: THREE.Vector3) {
    const d = new THREE.Mesh(this.dustGeo, this.dustMat.clone());
    d.position.copy(at).setY(0.08);
    d.userData.life = 0;
    this.dust.push(d);
    this.scene.add(d);
  }

  private updateDust(dt: number) {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i]!;
      d.userData.life += dt / 1000;
      const k = d.userData.life / 0.9;
      d.scale.set(1 + k * 2.2, 0.6 + k * 0.8, 1 + k * 2.2);
      d.position.y += dt * 0.00008;
      (d.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.32 * (1 - k));
      if (k >= 1) {
        this.scene.remove(d);
        (d.material as THREE.Material).dispose();
        this.dust.splice(i, 1);
      }
    }
  }
}

/** Whether anything within `margin` of p stands on a playable square of the active board. */
function nearBoard(p: THREE.Vector3, margin: number) {
  const board = activeBoard();
  const half = board.size / 2;
  for (const dx of [-margin, 0, margin]) {
    for (const dz of [-margin, 0, margin]) {
      const x = Math.floor(p.x + dx + half);
      const y = Math.floor(p.z + dz + half);
      if (board.playable({ x, y })) return true;
    }
  }
  return false;
}
