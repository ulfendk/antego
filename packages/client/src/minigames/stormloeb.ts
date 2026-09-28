import * as THREE from 'three';
import { other } from '@antego/shared';
import { soldierMesh } from '../scene/pieces.js';
import { sfx } from '../audio/sfx.js';
import { Minigame, canvasTexture, type MinigameContext } from './base.js';

const GOAL = 30;
/** Speed added per tap, and how fast it bleeds off: ~6 taps a second gets a kid most of the way. */
const IMPULSE = 1.75;
const FRICTION = 3;
const MIN_TAP_MS = 60;

/**
 * Stormløb: tap as fast as you can and the soldier hops along a cardboard track to the
 * enemy flag. The stronger soldier takes slightly longer hops.
 */
export class Stormloeb extends Minigame {
  readonly duration = 9000;
  private runner = new THREE.Group();
  private body: THREE.Mesh;
  private x = 0;
  private v = 0;
  private hop = 0;
  private lastTap = -Infinity;
  private dust: THREE.Mesh[] = [];

  constructor(ctx: MinigameContext) {
    super(ctx);
    this.table();
    this.scene.add(this.track());
    this.body = soldierMesh(ctx.kit, 'spejder', ctx.team);
    this.body.scale.setScalar(1.6);
    this.runner.add(this.body);
    this.runner.rotation.y = Math.PI / 2; // run towards +X
    this.runner.position.set(0, 0.06, 0);
    this.scene.add(this.runner);
    const flag = soldierMesh(ctx.kit, 'flag', other(ctx.team));
    flag.scale.setScalar(2.2);
    flag.position.set(GOAL + 0.6, 0.06, -0.3);
    this.scene.add(flag);
    this.placeCamera();
  }

  private track() {
    const len = GOAL + 6;
    const tex = this.own(
      canvasTexture(4096, 256, (g) => {
        g.fillStyle = '#d7c68f';
        g.fillRect(0, 0, 4096, 256);
        const px = 4096 / len;
        g.fillStyle = 'rgba(80, 60, 30, 0.08)';
        for (let i = 0; i < 600; i++) g.fillRect(Math.random() * 4096, Math.random() * 256, 3, 3);
        g.strokeStyle = '#6b5a33';
        g.lineWidth = 6;
        g.strokeRect(6, 18, 4084, 220);
        // Distance ticks every 2 units and a chequered finish line.
        g.fillStyle = '#6b5a33';
        for (let d = 2; d < GOAL; d += 2)
          g.fillRect((d + 2) * px - 3, 18, 6, d % 10 === 0 ? 60 : 30);
        const fx = (GOAL + 2) * px;
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 2; j++) {
            g.fillStyle = (i + j) % 2 ? '#222' : '#f3ecd2';
            g.fillRect(fx + j * 24, 18 + i * 27.5, 24, 27.5);
          }
        }
        g.fillStyle = '#f3ecd2';
        g.fillRect(2 * px - 6, 18, 12, 220);
      }),
    );
    const mesh = new THREE.Mesh(
      this.own(new THREE.BoxGeometry(len, 0.05, 2.2)),
      this.own(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.4 })),
    );
    mesh.position.set(len / 2 - 2, 0.025, 0);
    mesh.receiveShadow = true;
    return mesh;
  }

  private placeCamera() {
    const x = this.runner.position.x;
    this.camera.position.set(x + 3, 3.6, 9);
    this.camera.lookAt(x + 4.5, 0.5, 0);
    this.key.position.set(x + 6, 12, 8);
    this.key.target.position.set(x + 3, 0, 0);
    this.key.target.updateMatrixWorld();
  }

  override down() {
    if (!this.running || this.finished) return;
    if (this.elapsed - this.lastTap < MIN_TAP_MS) return;
    this.lastTap = this.elapsed;
    this.v += IMPULSE * (1 + 0.15 * this.ctx.handicap);
    sfx.play('hop');
    this.puff();
  }

  protected step(dt: number) {
    const s = dt / 1000;
    this.v *= Math.exp(-FRICTION * s);
    this.x = Math.min(GOAL, this.x + this.v * s);
    this.hop += this.v * s * 2.2;
    this.runner.position.x = this.x;
    this.body.position.y = Math.abs(Math.sin(this.hop)) * 0.35 * Math.min(1, this.v / 2);
    this.body.rotation.x = Math.sin(this.hop * 2) * 0.08;
    this.animateDust(s);
    this.placeCamera();
    if (this.x >= GOAL) this.finish();
  }

  protected override idle(dt: number) {
    this.hop += dt / 400;
    this.body.position.y = Math.abs(Math.sin(this.hop)) * 0.05;
    this.animateDust(dt / 1000);
  }

  private dustMat = this.own(
    new THREE.MeshBasicMaterial({ color: '#e8dcb6', transparent: true, depthWrite: false }),
  );
  private dustGeo = this.own(new THREE.SphereGeometry(0.12, 8, 6));

  private puff() {
    const d = new THREE.Mesh(this.dustGeo, this.dustMat.clone());
    d.position.set(this.x - 0.3, 0.15, (Math.random() - 0.5) * 0.4);
    d.userData.life = 0;
    this.dust.push(d);
    this.scene.add(d);
  }

  private animateDust(s: number) {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i]!;
      d.userData.life += s;
      const k = d.userData.life / 0.6;
      d.scale.setScalar(1 + k * 2.5);
      d.position.y += s * 0.4;
      (d.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 * (1 - k));
      if (k >= 1) {
        this.scene.remove(d);
        (d.material as THREE.Material).dispose();
        this.dust.splice(i, 1);
      }
    }
  }

  score() {
    return Math.round((this.x / GOAL) * 100);
  }
}
