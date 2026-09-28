import * as THREE from 'three';
import { createRng } from '@antego/shared';
import { soldierMesh } from '../scene/pieces.js';
import { TEAM_COLORS } from '../scene/textures.js';
import { Minigame, canvasTexture, type MinigameContext, type Pointer } from './base.js';

const JUMPS = 3;
const START_Y = 10;
const RANGE = 5.5;

interface Jump {
  startX: number;
  targetX: number;
  wind: number;
  gust: number;
}

/**
 * Faldskærm: our soldier parachutes down; drag left/right to steer against the wind and land
 * on the target. Three jumps, scored on how close each landing is. The stronger soldier falls
 * a little slower and gets a bigger target.
 */
export class Faldskaerm extends Minigame {
  /** Three falls of ~4.5 s plus landings; the game normally ends after the third landing. */
  readonly duration = JUMPS * 6400;
  private jumps: Jump[] = [];
  private jump = 0;
  private scores: number[] = [];
  private para = new THREE.Group();
  private canopy: THREE.Mesh;
  private target: THREE.Mesh;
  private x = 0;
  private y = START_Y;
  private aim: number | null = null;
  private landedFor = 0;
  private fall: number;

  constructor(ctx: MinigameContext) {
    super(ctx);
    this.table();
    const rng = createRng(ctx.seed ^ 0xfa11);
    for (let i = 0; i < JUMPS; i++) {
      this.jumps.push({
        startX: (rng() - 0.5) * 2 * RANGE * 0.8,
        targetX: (rng() - 0.5) * 2 * RANGE * 0.6,
        wind: (rng() - 0.5) * 2.4,
        gust: rng() * Math.PI * 2,
      });
    }
    this.fall = 2.2 * (1 - 0.08 * ctx.handicap);

    // The landing zone: a printed cardboard target on the table.
    const size = 1.6 * (1 + 0.15 * ctx.handicap);
    this.target = new THREE.Mesh(
      this.own(new THREE.CylinderGeometry(size, size, 0.04, 48)),
      this.own(
        new THREE.MeshPhysicalMaterial({
          map: this.own(landingTexture()),
          roughness: 0.5,
          clearcoat: 0.4,
        }),
      ),
    );
    this.target.position.y = 0.02;
    this.target.receiveShadow = true;
    this.scene.add(this.target);

    // Our soldier hanging under a striped canopy.
    const soldier = soldierMesh(ctx.kit, ctx.rank, ctx.team);
    soldier.scale.setScalar(1.5);
    const canopyTex = this.own(stripes(TEAM_COLORS[ctx.team].plastic));
    this.canopy = new THREE.Mesh(
      this.own(new THREE.SphereGeometry(1.25, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)),
      this.own(
        new THREE.MeshStandardMaterial({ map: canopyTex, side: THREE.DoubleSide, roughness: 0.7 }),
      ),
    );
    this.canopy.scale.set(1, 0.55, 1);
    this.canopy.position.y = 2.3;
    this.canopy.castShadow = true;
    const lineMat = this.own(new THREE.LineBasicMaterial({ color: '#e8e2c8' }));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(Math.cos(a) * 1.15, 2.45, Math.sin(a) * 1.15),
        new THREE.Vector3(0, 1.05, 0),
      );
    }
    const lines = new THREE.LineSegments(
      this.own(new THREE.BufferGeometry().setFromPoints(pts)),
      lineMat,
    );
    this.para.add(soldier, this.canopy, lines);
    this.scene.add(this.para);
    this.startJump();
    this.camera.position.set(0, 6.5, 15);
    this.camera.lookAt(0, 4.2, 0);
  }

  private startJump() {
    const j = this.jumps[this.jump]!;
    this.x = j.startX;
    this.y = START_Y;
    this.aim = null;
    this.landedFor = 0;
    this.target.position.x = j.targetX;
    this.canopy.scale.set(1, 0.55, 1);
    this.para.rotation.z = 0;
    this.place();
  }

  private place() {
    this.para.position.set(this.x, this.y, 0);
  }

  /** Screen x (0–1) → the world x the soldier steers towards. */
  private toWorld(p: Pointer) {
    return (p.x - 0.5) * 2 * RANGE * 1.25;
  }

  override down(p: Pointer) {
    this.aim = this.toWorld(p);
  }

  override move(p: Pointer) {
    if (this.aim !== null) this.aim = this.toWorld(p);
  }

  override up() {
    this.aim = null;
  }

  protected step(dt: number) {
    const s = dt / 1000;
    const j = this.jumps[this.jump]!;
    if (this.landedFor > 0) {
      // Canopy crumples onto the table, then the next jump starts.
      this.landedFor += dt;
      this.canopy.scale.y = Math.max(0.12, 0.55 - this.landedFor / 900);
      this.canopy.position.y = Math.max(0.6, 2.3 - this.landedFor / 500);
      if (this.landedFor > 1300) {
        this.jump++;
        this.canopy.position.y = 2.3;
        if (this.jump >= JUMPS) this.finish();
        else this.startJump();
      }
      return;
    }
    const wind = j.wind * (0.7 + 0.5 * Math.sin(this.elapsed / 700 + j.gust));
    const steer = this.aim === null ? 0 : THREE.MathUtils.clamp(this.aim - this.x, -1, 1) * 3.2;
    const vx = wind + steer;
    this.x = THREE.MathUtils.clamp(this.x + vx * s, -RANGE * 1.3, RANGE * 1.3);
    this.y -= this.fall * s;
    this.para.rotation.z = THREE.MathUtils.lerp(this.para.rotation.z, -vx * 0.08, 0.1);
    if (this.y <= 0) {
      this.y = 0;
      this.para.rotation.z = 0;
      const d = Math.abs(this.x - j.targetX);
      const size = 1.6 * (1 + 0.15 * this.ctx.handicap);
      this.scores.push(Math.max(0, Math.round(100 - (d / size) * 60)));
      this.landedFor = 1;
    }
    this.place();
  }

  private sway = 0;

  protected override idle(dt: number) {
    this.sway += dt;
    this.para.rotation.z = Math.sin(this.sway / 600) * 0.05;
  }

  score() {
    const all = [...this.scores];
    while (all.length < JUMPS) all.push(0);
    return Math.round(all.reduce((a, b) => a + b, 0) / JUMPS);
  }
}

function landingTexture() {
  return canvasTexture(512, 512, (g) => {
    const rings = ['#f3ecd2', '#c0392b', '#f3ecd2', '#c0392b', '#f3ecd2'];
    rings.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(256, 256, 256 - i * 50, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#26301a';
    g.font = 'bold 90px "Black Ops One", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★', 256, 262);
  });
}

function stripes(color: string) {
  return canvasTexture(512, 64, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? color : '#efe8cf';
      g.fillRect(i * 64, 0, 64, 64);
    }
  });
}
