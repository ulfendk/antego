import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sfx } from '../audio/sfx.js';
import { activeBoard } from './board.js';
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
export class EasterEggs {
  private next = 30_000 + Math.random() * 30_000;
  private busy = false;
  private last = -1;
  private readonly olive = plasticMaterial('#56663a', false);
  private readonly dark = new THREE.MeshStandardMaterial({ color: '#23261c', roughness: 0.8 });
  private jeep = this.buildJeep();
  private tank = this.buildTank();
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
    for (const o of [this.jeep, this.tank, this.plane]) {
      o.visible = false;
      scene.add(o);
    }
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

  private readonly eggs = [
    () => this.jeepRun(),
    () => this.planeGlide(),
    () => this.tankPeek(),
    () => this.wave(),
  ];

  /** Run one now (0 jeep, 1 plane, 2 tank, 3 wave); `?debug` exposes this as eggs.play(i). */
  play(i: number) {
    if (this.busy) return;
    this.last = i;
    this.busy = true;
    void this.eggs[i]!()
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  // ---------------------------------------------------------------- the jeep

  private buildJeep() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.32, 0.72, 3, 0.06), this.olive);
    body.position.y = 0.34;
    const hood = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.14, 0.7, 3, 0.05), this.olive);
    hood.position.set(0.5, 0.55, 0);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.68), this.olive);
    screen.position.set(0.18, 0.66, 0);
    screen.rotation.z = 0.25;
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.6, 2, 0.05), this.dark);
    seat.position.set(-0.3, 0.56, 0);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 18), this.dark);
    spare.rotation.z = Math.PI / 2;
    spare.position.set(-0.8, 0.42, 0);
    g.add(body, hood, screen, seat, spare);
    for (const x of [-0.48, 0.48]) {
      for (const z of [-0.38, 0.38]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 18), this.dark);
        w.rotation.x = Math.PI / 2;
        w.position.set(x, 0.19, z);
        w.userData.wheel = true;
        g.add(w);
      }
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
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
    const j = this.jeep;
    j.visible = true;
    j.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    sfx.play('engine');
    let puff = 0;
    await tween(
      3600,
      (k) => {
        j.position.lerpVectors(a, b, k);
        // Bouncy toy suspension and spinning wheels.
        j.position.y = Math.abs(Math.sin(k * 60)) * 0.04;
        j.rotation.z = Math.sin(k * 45) * 0.03;
        j.children.forEach((w) => w.userData.wheel && (w.rotation.y += 0.5));
        if (k > puff) {
          puff = k + 0.02;
          this.puff(j.position.clone().addScaledVector(across, -0.8 * dir));
        }
      },
      ease.linear,
    );
    j.visible = false;
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
  }

  // ---------------------------------------------------------------- the tank

  private buildTank() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.3, 0.8, 3, 0.06), this.olive);
    hull.position.y = 0.3;
    for (const z of [-0.45, 0.45]) {
      const track = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.26, 0.2, 3, 0.1), this.dark);
      track.position.set(0, 0.14, z);
      g.add(track);
    }
    const turret = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.22, 20), this.olive);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 12), this.olive);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x = 0.5;
    turret.add(dome, barrel);
    turret.position.y = 0.55;
    turret.name = 'turret';
    g.add(hull, turret);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
  }

  /** Peeks out from behind the toy box furthest from the camera, looks around, backs off. */
  private async tankPeek() {
    const cam = this.stage.camera.position;
    const boxes = toyBoxCentres();
    if (!boxes.length) return;
    // Hide behind a box as seen from the camera, then roll out sideways. Prefer the furthest
    // box whose peek spot is actually on screen.
    const spots = boxes.map(({ centre: box, radius }) => {
      const away = box
        .clone()
        .sub(new THREE.Vector3(cam.x, 0, cam.z))
        .setY(0)
        .normalize();
      const side = new THREE.Vector3(-away.z, 0, away.x);
      // Roll out on the side away from the board, never onto it.
      if (box.clone().add(side).lengthSq() < box.clone().sub(side).lengthSq()) side.negate();
      const hidden = box.clone().addScaledVector(away, radius * 0.5);
      const out = hidden.clone().addScaledVector(side, radius + 1);
      hidden.addScaledVector(side, radius * 0.4);
      const s = out.clone().project(this.stage.camera);
      const onScreen = Math.abs(s.x) < 0.85 && Math.abs(s.y) < 0.85 && s.z < 1;
      return { side, hidden, out, onScreen, far: box.distanceTo(cam) };
    });
    const visible = spots.filter((s) => s.onScreen);
    const pool = visible.length ? visible : spots;
    const { side, hidden, out } = pool.reduce((a, b) => (b.far > a.far ? b : a));
    const t = this.tank;
    const turret = t.getObjectByName('turret')!;
    t.visible = true;
    t.position.copy(hidden);
    t.rotation.y = Math.atan2(-side.z, side.x);
    sfx.play('squeak');
    await tween(900, (k) => t.position.lerpVectors(hidden, out, k), ease.out);
    await tween(700, (k) => (turret.rotation.y = Math.sin(k * Math.PI) * 0.9), ease.inOut);
    await wait(400);
    await tween(700, (k) => (turret.rotation.y = -Math.sin(k * Math.PI) * 0.9), ease.inOut);
    sfx.play('squeak');
    await tween(900, (k) => t.position.lerpVectors(out, hidden, k), ease.inOut);
    t.visible = false;
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
    if (!who) return;
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
