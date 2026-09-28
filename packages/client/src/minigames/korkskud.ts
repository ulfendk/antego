import * as THREE from 'three';
import { createRng } from '@antego/shared';
import { soldierMesh } from '../scene/pieces.js';
import { sfx } from '../audio/sfx.js';
import { Minigame, canvasTexture, type MinigameContext, type Pointer } from './base.js';

/** Target positions [x, y, z]: each row hides behind its own fence. */
const SLOTS: [number, number, number][] = [
  [-3.2, 1.2, -0.2],
  [-1.6, 2.3, -0.95],
  [0, 1.2, -0.2],
  [1.6, 2.3, -0.95],
  [3.2, 1.2, -0.2],
  [-2.4, 3.2, -1.28],
  [2.4, 3.2, -1.28],
];
const COUNT = 14;

interface Target {
  group: THREE.Group;
  disc: THREE.Mesh;
  slot: number;
  at: number;
  life: number;
  state: 'wait' | 'up' | 'hit' | 'gone';
  t: number;
}

/**
 * Korkskud: cardboard targets pop up behind a toy fence; tap them before they drop again.
 * The stronger soldier's targets stay up a little longer and are a bit bigger.
 */
export class Korkskud extends Minigame {
  readonly duration = 12000;
  private targets: Target[] = [];
  private ray = new THREE.Raycaster();
  private hits = 0;
  private gunner: THREE.Mesh;

  constructor(ctx: MinigameContext) {
    super(ctx);
    this.table();
    this.buildStand();
    const rng = createRng(ctx.seed ^ 0x5eed);
    const h = ctx.handicap;
    const face = this.own(bullseye());
    const discGeo = this.own(
      new THREE.CylinderGeometry(0.62 * (1 + 0.08 * h), 0.62 * (1 + 0.08 * h), 0.06, 40),
    );
    discGeo.rotateX(Math.PI / 2);
    const stickGeo = this.own(new THREE.BoxGeometry(0.1, 1.4, 0.05));
    const edge = this.own(new THREE.MeshStandardMaterial({ color: '#c9b27a', roughness: 0.8 }));
    const faceMat = this.own(
      new THREE.MeshPhysicalMaterial({ map: face, roughness: 0.5, clearcoat: 0.3 }),
    );
    const busy: number[] = SLOTS.map(() => -Infinity);
    const span = this.duration - 1400;
    for (let i = 0; i < COUNT; i++) {
      const at = 300 + (i / COUNT) * span + rng() * 250;
      const life = (850 + rng() * 500) * (1 + 0.2 * h);
      let slot = Math.floor(rng() * SLOTS.length);
      for (let tries = 0; busy[slot]! > at && tries < SLOTS.length; tries++)
        slot = (slot + 1) % SLOTS.length;
      busy[slot] = at + life + 400;
      const group = new THREE.Group();
      const disc = new THREE.Mesh(discGeo, [edge, faceMat, faceMat]);
      disc.position.y = 0.7;
      disc.castShadow = true;
      const stick = new THREE.Mesh(stickGeo, edge);
      stick.castShadow = true;
      group.add(disc, stick);
      const [x, y, z] = SLOTS[slot]!;
      group.position.set(x, y - 1.6, z);
      group.visible = false;
      this.scene.add(group);
      this.targets.push({ group, disc, slot, at, life, state: 'wait', t: 0 });
    }
    // Our soldier watches from the front corner.
    this.gunner = soldierMesh(ctx.kit, ctx.rank, ctx.team);
    this.gunner.scale.setScalar(1.6);
    this.gunner.position.set(-4.4, 0, 2.2);
    this.gunner.rotation.y = Math.PI * 0.85;
    this.scene.add(this.gunner);
    this.camera.position.set(0, 2.8, 11);
    this.camera.lookAt(0, 1.9, 0);
  }

  /** A painted cardboard shooting stand: back board and two fence rows the targets hide behind. */
  private buildStand() {
    const card = this.own(
      canvasTexture(1024, 512, (g) => {
        g.fillStyle = '#8a6a3c';
        g.fillRect(0, 0, 1024, 512);
        for (let i = 0; i < 16; i++) {
          g.fillStyle = i % 2 ? '#b0413e' : '#e9dcb4';
          g.fillRect(i * 64, 0, 64, 90);
        }
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i < 900; i++)
          g.fillRect(Math.random() * 1024, 90 + Math.random() * 422, 2, 2);
      }),
    );
    const back = new THREE.Mesh(
      this.own(new THREE.BoxGeometry(10, 5, 0.15)),
      this.own(new THREE.MeshStandardMaterial({ map: card, roughness: 0.8 })),
    );
    back.position.set(0, 2.5, -1.4);
    back.receiveShadow = true;
    this.scene.add(back);
    // Painted wooden slats with dark gaps and a little wear.
    const slats = this.own(
      canvasTexture(1024, 128, (g) => {
        for (let i = 0; i < 24; i++) {
          const x = (i * 1024) / 24;
          const tint = 0.9 + ((i * 37) % 10) / 50;
          g.fillStyle = `rgb(${93 * tint}, ${122 * tint}, ${56 * tint})`;
          g.fillRect(x, 0, 1024 / 24, 128);
          g.fillStyle = 'rgba(20, 30, 10, 0.8)';
          g.fillRect(x, 0, 3, 128);
          g.fillStyle = 'rgba(255, 250, 220, 0.12)';
          for (let k = 0; k < 6; k++)
            g.fillRect(x + 6 + ((i * 13 + k * 7) % 30), (k * 23 + i * 11) % 120, 2, 8);
        }
        g.fillStyle = 'rgba(0, 0, 0, 0.18)';
        g.fillRect(0, 118, 1024, 10);
      }),
    );
    const fenceMat = this.own(new THREE.MeshStandardMaterial({ map: slats, roughness: 0.75 }));
    for (const [y, z] of [
      [0.55, 0.2],
      [1.65, -0.7],
      [2.55, -1.1],
    ] as const) {
      const fence = new THREE.Mesh(this.own(new THREE.BoxGeometry(9.6, 1.1, 0.12)), fenceMat);
      fence.position.set(0, y, z);
      fence.castShadow = fence.receiveShadow = true;
      this.scene.add(fence);
    }
  }

  override down(p: Pointer) {
    if (!this.running || this.finished) return;
    this.ray.setFromCamera(p.ndc, this.camera);
    const up = this.targets.filter((t) => t.state === 'up');
    const hit = this.ray.intersectObjects(
      up.map((t) => t.disc),
      false,
    )[0];
    const target = hit && up.find((t) => t.disc === hit.object);
    if (!target) return;
    target.state = 'hit';
    sfx.play('pop');
    target.t = 0;
    this.hits++;
  }

  protected step(dt: number) {
    for (const t of this.targets) {
      const [, y] = SLOTS[t.slot]!;
      t.t += dt;
      if (t.state === 'wait' && this.elapsed >= t.at) {
        t.state = 'up';
        t.t = 0;
        t.group.visible = true;
      }
      if (t.state === 'up') {
        const rise = Math.min(1, t.t / 160);
        const fall = t.t > t.life ? Math.min(1, (t.t - t.life) / 160) : 0;
        t.group.position.y = y - 1.6 + 1.6 * (rise - fall);
        if (fall >= 1) {
          t.state = 'gone';
          t.group.visible = false;
        }
      }
      if (t.state === 'hit') {
        // Knocked flat backwards with a little spin.
        const k = Math.min(1, t.t / 260);
        t.group.rotation.x = -k * 1.5;
        t.disc.rotation.z = k * 0.6;
        if (k >= 1) {
          t.state = 'gone';
          t.group.visible = false;
        }
      }
    }
    if (this.targets.every((t) => t.state === 'gone')) this.finish();
  }

  private sway = 0;

  protected override idle(dt: number) {
    this.sway += dt;
    this.gunner.rotation.y = Math.PI * 0.85 + Math.sin(this.sway / 700) * 0.05;
  }

  score() {
    return Math.round((this.hits / COUNT) * 100);
  }
}

function bullseye() {
  return canvasTexture(256, 256, (g) => {
    const rings = ['#f3ecd2', '#b0413e', '#f3ecd2', '#b0413e', '#f3ecd2', '#b0413e'];
    rings.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(128, 128, 128 - i * 21, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#26301a';
    g.beginPath();
    g.arc(128, 128, 12, 0, Math.PI * 2);
    g.fill();
  });
}
