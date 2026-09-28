import * as THREE from 'three';
import {
  side,
  type GameEvent,
  type GameView,
  type PieceView,
  type Pos,
  type Rank,
  type Team,
} from '@antego/shared';
import { BOARD_TOP, squareToWorld } from './board.js';
import { PieceKit, PieceObject } from './pieces.js';
import { sfx } from '../audio/sfx.js';
import { toyBoxSlot } from './props.js';
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
  /** An army is knocked out (3–4 players): banner before its soldiers go to the toy box. */
  onOut?: (team: Team) => Promise<void> | void;
}

/** Where fallen soldiers end up: lying in their army's toy box beside the board. */
const graveSlot = toyBoxSlot;

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
    this.pending++;
    this.queue = this.queue
      .then(() => this.hold)
      .then(() => (gen === this.generation ? this.run(view, events) : undefined))
      .catch((err) => console.error(err))
      .finally(() => this.pending--);
    return this.queue;
  }

  private pending = 0;
  private hold: Promise<unknown> = Promise.resolve();

  /** Whether moves are being animated or waiting to be. */
  get busy() {
    return this.pending > 0;
  }

  /** Something is driving over the board: animations wait until it has passed. */
  holdUntil(done: Promise<unknown>) {
    this.hold = done.catch(() => undefined);
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
    this.friends = view.viewer ? side(view.viewer, view.hold) : [];
    for (const e of events) await this.animate(e, view);
    this.sync(view);
  }

  /** Instantly match the view (used on join/reconnect and after animations). */
  sync(view: GameView) {
    this.viewer = view.viewer;
    this.friends = view.viewer ? side(view.viewer, view.hold) : [];
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
    const perTeam: Record<Team, number> = { groen: 0, sand: 0, blaa: 0, brun: 0 };
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

  /** Badges on our own soldiers – and on our partner's in team mode. */
  private badgeFor(p: PieceView) {
    return this.showBadges && !!this.viewer && this.friends.includes(p.team) && p.rank !== null;
  }

  private friends: Team[] = [];

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

  /** Soldiers lying in the toy boxes. */
  fallenPieces(): PieceObject[] {
    return [...this.fallen.values()];
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
    sfx.play('tick');
    this.addRings(targets);
  }

  /** Pulse rings on some squares without selecting anything (the tutorial points at things). */
  hint(squares: Pos[]) {
    if (this.selected) void this.lift(this.selected, false);
    this.selected = null;
    this.clearRings();
    this.addRings(squares);
  }

  private addRings(squares: Pos[]) {
    for (const t of squares) {
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
        await this.threaten(att, def);
        sfx.play('clash');
        att.setRank(e.attackerRank, false);
        await this.reveal(def, e.defenderRank);
        await this.hooks.onBattle?.({
          attackerTeam: att.team,
          attackerRank: e.attackerRank,
          defenderRank: e.defenderRank,
          reason: e.reason,
        });
        this.lastBattle = { att, from, to, reason: e.reason };
        return;
      }
      case 'battleResolved': {
        const lb = this.lastBattle;
        this.lastBattle = null;
        const fallen = e.fallen
          .map((id) => this.pieces.get(id))
          .filter((o): o is PieceObject => !!o);
        // Special battles get their own sound; mines go "bum" as the attacker topples.
        const reason = lb?.reason;
        if (reason === 'mine') sfx.play('bum');
        else if (reason === 'mine-desarmeret') sfx.play('defuse');
        else if (reason === 'spion') sfx.play('sneaky');
        await Promise.all(fallen.map((o) => this.fall(o, view)));
        // The winning attacker takes the square.
        if (e.outcome === 'attacker' && lb) {
          const mid = squareToWorld(lb.from).lerp(squareToWorld(lb.to), 0.55);
          await this.hopFrom(lb.att, mid, squareToWorld(lb.to));
        }
        this.hooks.onBattleResolved?.(e.outcome);
        if (e.outcome !== 'both' && reason !== 'spion' && reason !== 'flag') sfx.play('fanfare');
        await wait(600);
        await this.hooks.unfocus?.();
        return;
      }
      case 'out': {
        this.select(null, []);
        await this.hooks.onOut?.(e.team);
        const objs = e.removed
          .map((id) => this.pieces.get(id))
          .filter((o): o is PieceObject => !!o);
        sfx.play('rattle');
        await Promise.all(objs.map((o, i) => wait(i * 70).then(() => this.fall(o, view, true))));
        return;
      }
      default:
        return;
    }
  }

  private lastBattle: { att: PieceObject; from: Pos; to: Pos; reason: string } | null = null;

  /** Toy-soldier walk: they're glued to their base plates, so they waddle along. */
  private hop(obj: PieceObject, from: Pos, to: Pos, fraction = 1) {
    const a = squareToWorld(from);
    return this.hopFrom(obj, a, a.clone().lerp(squareToWorld(to), fraction));
  }

  /**
   * The army-man waddle: the boots are fixed to the plate, so he tips onto one edge of it,
   * swings forward, sets it down (tap!) and tips onto the other edge – two rocks per square.
   */
  private async hopFrom(obj: PieceObject, a: THREE.Vector3, b: THREE.Vector3) {
    const dist = a.distanceTo(b);
    const rocks = Math.max(2, Math.round(dist * 2));
    // Unhurried steps; a scout's long run speeds up a little so it doesn't drag.
    const dur = Math.max(160, 250 - rocks * 6);
    const rig = obj.rig;
    obj.body.position.y = 0;
    obj.body.rotation.x = 0;
    for (let i = 0; i < rocks; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const p0 = a.clone().lerp(b, i / rocks);
      const p1 = a.clone().lerp(b, (i + 1) / rocks);
      await tween(
        dur,
        (k) => {
          const lift = Math.sin(k * Math.PI);
          tipOnEdge(rig, side * 0.32 * lift);
          // The lifted side swings round a little, like shuffling on one corner.
          rig.rotation.y = side * 0.12 * lift;
          obj.position.lerpVectors(p0, p1, ease.inOut(k));
          obj.shadowOpacity = 1 - lift * 0.2;
        },
        ease.linear,
      );
      sfx.play('tap');
    }
    tipOnEdge(rig, 0);
    rig.rotation.set(0, 0, 0);
    obj.shadowOpacity = 1;
  }

  /** Before the reveal: the attacker lunges twice and the hidden enemy trembles. */
  private async threaten(att: PieceObject, def: PieceObject) {
    for (let i = 0; i < 2; i++) {
      sfx.play('hop');
      await tween(
        170,
        (k) => {
          const s = Math.sin(k * Math.PI);
          att.rig.rotation.x = 0.38 * s;
          att.rig.position.z = 0.1 * s;
          att.rig.position.y = 0.04 * s;
          def.rig.rotation.z = Math.sin(k * Math.PI * 6) * 0.06;
        },
        ease.linear,
      );
    }
    att.rig.rotation.x = 0;
    att.rig.position.set(0, 0, 0);
    def.rig.rotation.z = 0;
  }

  private async reveal(obj: PieceObject, rank: Rank) {
    if (obj.rank === rank) return;
    // The tile tips over like a flipped Stratego piece, and the soldier pops up.
    sfx.play('flip');
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
  private async fall(obj: PieceObject, view: GameView, quiet = false) {
    const dir = obj.team === 'groen' ? 1 : -1;
    if (!quiet) sfx.play('clatter');
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
        obj.position.y += Math.sin(k * Math.PI) * 2;
      },
      ease.inOut,
    );
    if (!quiet) sfx.play('rattle');
    this.pieces.delete(obj.pieceId);
    obj.setBadge(false);
    this.layDown(obj);
    this.fallen.set(obj.pieceId, obj);
  }
}

/** Base plate half-width in the soldier's own frame (model units): the edge he rocks onto. */
const PLATE_HALF = 0.21;

/**
 * Roll the soldier by `theta` about one long edge of his base plate instead of its centre:
 * a positive roll lifts his right side, so he pivots on the left edge (and vice versa).
 */
function tipOnEdge(rig: THREE.Object3D, theta: number) {
  const edge = theta >= 0 ? -PLATE_HALF : PLATE_HALF;
  rig.rotation.z = theta;
  rig.position.x = edge - edge * Math.cos(theta);
  rig.position.y = -edge * Math.sin(theta);
}
