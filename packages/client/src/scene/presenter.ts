import * as THREE from 'three';
import type { GameEvent, GameView, PieceView, Pos, Rank, Team } from '@antego/shared';
import { BOARD_TOP, squareToWorld } from './board.js';
import { PieceKit, PieceObject } from './pieces.js';
import { targetRing } from './textures.js';
import { ease, tween, wait } from './tween.js';

export interface BattleInfo {
  attackerTeam: Team;
  attackerRank: Rank;
  defenderRank: Rank;
  reason: string;
}

export interface PresenterHooks {
  /** A battle is about to be shown (UI banner). */
  onBattle?: (info: BattleInfo) => Promise<void> | void;
  /** How a battle ended, after the falls. */
  onBattleResolved?: (outcome: string) => void;
  /** Camera leans in on a move / battle, and back out afterwards. */
  focus?: (point: THREE.Vector3) => Promise<void>;
  unfocus?: () => Promise<void>;
}

/** Where fallen soldiers end up: lying in the toy box area beside the board, per army. */
function graveSlot(team: Team, index: number) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const side = team === 'groen' ? 1 : -1;
  return new THREE.Vector3(side * (6.4 + col * 0.58), 0.12, side * (4.2 - row * 0.62));
}

/**
 * Keeps the 3D pieces in step with the game: animates each event (hops, battles,
 * falls into the toy box), then reconciles everything with the latest view.
 */
export class Presenter {
  readonly group = new THREE.Group();
  private pieces = new Map<string, PieceObject>();
  private fallen = new Map<string, PieceObject>();
  private rings: THREE.Mesh[] = [];
  private ringMat = new THREE.MeshBasicMaterial({
    map: targetRing(),
    transparent: true,
    depthWrite: false,
    color: '#ffab40',
  });
  private selected: PieceObject | null = null;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private viewer: Team | null = null;
  private time = 0;
  showBadges = true;

  constructor(
    private kit: PieceKit,
    private hooks: PresenterHooks = {},
  ) {}

  /** Queue a view update; events are animated in order before the view is applied. */
  present(view: GameView, events: GameEvent[]): Promise<void> {
    const gen = this.generation;
    this.queue = this.queue
      .then(() => (gen === this.generation ? this.run(view, events) : undefined))
      .catch((err) => console.error(err));
    return this.queue;
  }

  /** Forget the current game: pending presentations are dropped and the board is cleared. */
  reset() {
    this.generation++;
    this.queue = Promise.resolve();
    this.select(null, []);
    for (const o of [...this.pieces.values(), ...this.fallen.values()]) this.group.remove(o);
    this.pieces.clear();
    this.fallen.clear();
    this.lastBattle = null;
  }

  private async run(view: GameView, events: GameEvent[]) {
    this.viewer = view.viewer;
    for (const e of events) await this.animate(e, view);
    this.sync(view);
  }

  /** Instantly match the view (used on join/reconnect and after animations). */
  sync(view: GameView) {
    this.viewer = view.viewer;
    const seen = new Set<string>();
    for (const p of view.pieces) {
      seen.add(p.id);
      const obj = this.ensure(p);
      obj.setRank(p.rank, this.badgeFor(p));
      if (obj !== this.selected) obj.position.copy(squareToWorld(p));
    }
    for (const [id, obj] of this.pieces) {
      if (!seen.has(id)) {
        this.group.remove(obj);
        this.pieces.delete(id);
      }
    }
    // Fallen soldiers rest in the toy box; rebuild that area if it's out of date (e.g. after reconnect).
    const fallenIds = new Set(view.fallen.map((p) => p.id));
    for (const [id, obj] of this.fallen) {
      if (!fallenIds.has(id)) {
        this.group.remove(obj);
        this.fallen.delete(id);
      }
    }
    const perTeam: Record<Team, number> = { groen: 0, brun: 0 };
    for (const p of view.fallen) {
      let obj = this.fallen.get(p.id);
      if (!obj) {
        obj = new PieceObject(p.id, p.team, this.kit);
        obj.setRank(p.rank, false);
        this.layDown(obj);
        this.fallen.set(p.id, obj);
        this.group.add(obj);
      }
      obj.position.copy(graveSlot(p.team, perTeam[p.team]++));
    }
  }

  private badgeFor(p: PieceView) {
    return this.showBadges && p.team === this.viewer && p.rank !== null;
  }

  private ensure(p: PieceView) {
    let obj = this.pieces.get(p.id);
    if (!obj) {
      obj = new PieceObject(p.id, p.team, this.kit);
      obj.position.copy(squareToWorld(p));
      this.pieces.set(p.id, obj);
      this.group.add(obj);
    }
    return obj;
  }

  private layDown(obj: PieceObject) {
    obj.body.rotation.set(0, obj.team === 'groen' ? Math.PI : 0, Math.PI / 2);
    obj.body.position.set(0, 0.18, 0);
    obj.shadowOpacity = 0.4;
  }

  /** Pieces standing on the board (for tap picking). */
  boardPieces(): THREE.Object3D[] {
    return [...this.pieces.values()];
  }

  // ---------------------------------------------------------------- selection

  select(pieceId: string | null, targets: Pos[]) {
    if (this.selected && this.selected.pieceId !== pieceId) void this.lift(this.selected, false);
    this.clearRings();
    this.selected = pieceId ? (this.pieces.get(pieceId) ?? null) : null;
    if (!this.selected) return;
    void this.lift(this.selected, true);
    for (const t of targets) {
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
        this.ringMat,
      );
      ring.position.copy(squareToWorld(t, BOARD_TOP + 0.004));
      ring.renderOrder = 2;
      this.rings.push(ring);
      this.group.add(ring);
    }
  }

  private clearRings() {
    for (const r of this.rings) {
      this.group.remove(r);
      r.geometry.dispose();
    }
    this.rings = [];
  }

  private lift(obj: PieceObject, up: boolean) {
    const y0 = obj.body.position.y;
    const r0 = obj.body.rotation.x;
    return tween(
      180,
      (k) => {
        obj.body.position.y = y0 + ((up ? 0.16 : 0) - y0) * k;
        obj.body.rotation.x = r0 + ((up ? -0.12 : 0) - r0) * k;
        obj.shadowOpacity = up ? 1 - k * 0.5 : 0.5 + k * 0.5;
      },
      ease.out,
    );
  }

  /** Called every frame: the target rings breathe gently. */
  update(dt: number) {
    this.time += dt / 1000;
    this.ringMat.opacity = 0.55 + Math.sin(this.time * 4) * 0.25;
  }

  // ---------------------------------------------------------------- event animations

  private async animate(e: GameEvent, view: GameView) {
    switch (e.type) {
      case 'moved': {
        const obj = this.pieces.get(e.pieceId);
        if (!obj) return;
        this.select(null, []);
        await this.hooks.focus?.(squareToWorld(e.from).lerp(squareToWorld(e.to), 0.5));
        await this.hop(obj, e.from, e.to);
        await wait(250);
        await this.hooks.unfocus?.();
        return;
      }
      case 'battle': {
        const att = this.pieces.get(e.attackerId);
        const def = this.pieces.get(e.defenderId);
        if (!att || !def) return;
        this.select(null, []);
        // Walk up to the enemy, then both are revealed.
        const from = { x: Math.round(att.position.x + 4.5), y: Math.round(att.position.z + 4.5) };
        const to = { x: Math.round(def.position.x + 4.5), y: Math.round(def.position.z + 4.5) };
        await this.hooks.focus?.(squareToWorld(to).lerp(squareToWorld(from), 0.25));
        await this.hop(att, from, to, 0.55);
        att.setRank(e.attackerRank, false);
        await this.reveal(def, e.defenderRank);
        await this.hooks.onBattle?.({
          attackerTeam: att.team,
          attackerRank: e.attackerRank,
          defenderRank: e.defenderRank,
          reason: e.reason,
        });
        this.lastBattle = { att, from, to };
        return;
      }
      case 'battleResolved': {
        const lb = this.lastBattle;
        this.lastBattle = null;
        const fallen = e.fallen
          .map((id) => this.pieces.get(id))
          .filter((o): o is PieceObject => !!o);
        await Promise.all(fallen.map((o) => this.fall(o, view)));
        // The winning attacker takes the square.
        if (e.outcome === 'attacker' && lb) {
          const mid = squareToWorld(lb.from).lerp(squareToWorld(lb.to), 0.55);
          await this.hopFrom(lb.att, mid, squareToWorld(lb.to));
        }
        this.hooks.onBattleResolved?.(e.outcome);
        await wait(600);
        await this.hooks.unfocus?.();
        return;
      }
      default:
        return;
    }
  }

  private lastBattle: { att: PieceObject; from: Pos; to: Pos } | null = null;

  /** Toy-soldier hop: they're stuck to their bases, so they bounce along. */
  private hop(obj: PieceObject, from: Pos, to: Pos, fraction = 1) {
    const a = squareToWorld(from);
    return this.hopFrom(obj, a, a.clone().lerp(squareToWorld(to), fraction));
  }

  private async hopFrom(obj: PieceObject, a: THREE.Vector3, b: THREE.Vector3) {
    const dist = a.distanceTo(b);
    const hops = Math.max(1, Math.round(dist));
    // Unhurried hops; a scout's long run speeds up a little so it doesn't drag.
    const dur = Math.max(300, 460 - hops * 25);
    obj.body.position.y = 0;
    obj.body.rotation.x = 0;
    for (let i = 0; i < hops; i++) {
      const p0 = a.clone().lerp(b, i / hops);
      const p1 = a.clone().lerp(b, (i + 1) / hops);
      await tween(
        dur,
        (k) => {
          obj.position.lerpVectors(p0, p1, k);
          const arc = Math.sin(k * Math.PI);
          obj.body.position.y = arc * 0.22;
          obj.body.rotation.z = Math.sin(k * Math.PI * 2) * 0.08;
          obj.shadowOpacity = 1 - arc * 0.5;
        },
        ease.linear,
      );
      // Squash as the base lands on the cardboard.
      await tween(
        140,
        (k) => {
          const s = 1 - Math.sin(k * Math.PI) * 0.07;
          obj.body.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5);
        },
        ease.linear,
      );
    }
    obj.body.rotation.z = 0;
    obj.body.scale.set(1, 1, 1);
  }

  private async reveal(obj: PieceObject, rank: Rank) {
    if (obj.rank === rank) return;
    // The card tips over like a flipped Stratego tile, and the soldier pops up.
    await tween(
      220,
      (k) => (obj.body.rotation.x = (obj.team === 'groen' ? 1 : -1) * k * 1.4),
      ease.in,
    );
    obj.setRank(rank, false);
    obj.body.rotation.x = 0;
    obj.body.scale.setScalar(0.01);
    await tween(260, (k) => obj.body.scale.setScalar(Math.max(0.01, k)), ease.back);
  }

  /** Falls over with a toy bounce, then is lifted into the toy box beside the board. */
  private async fall(obj: PieceObject, view: GameView) {
    const dir = obj.team === 'groen' ? 1 : -1;
    await tween(
      520,
      (k) => {
        obj.body.rotation.z = (Math.PI / 2) * k * dir;
        obj.body.position.y = Math.sin(k * Math.PI) * 0.05 + k * 0.18;
      },
      ease.bounce,
    );
    await wait(250);
    const index = view.fallen
      .filter((p) => p.team === obj.team)
      .findIndex((p) => p.id === obj.pieceId);
    const dest = graveSlot(obj.team, Math.max(0, index));
    const start = obj.position.clone();
    await tween(
      650,
      (k) => {
        obj.position.lerpVectors(start, dest, k);
        obj.position.y += Math.sin(k * Math.PI) * 1.2;
      },
      ease.inOut,
    );
    this.pieces.delete(obj.pieceId);
    obj.setBadge(false);
    this.layDown(obj);
    this.fallen.set(obj.pieceId, obj);
  }
}
