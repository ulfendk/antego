import * as THREE from 'three';
import {
  RANKS,
  side,
  type GameEvent,
  type GameView,
  type PieceView,
  type Pos,
  type Rank,
  type Team,
} from '@antego/shared';
import { BOARD_TOP, squareAt, squareToWorld } from './board.js';
import { MOVES, type Move } from './alive.js';
import { FACING, PieceKit, PieceObject } from './pieces.js';
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
  focus?: (point: THREE.Vector3, span?: number) => Promise<void>;
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
        await this.hooks.focus?.(
          squareToWorld(e.from).lerp(squareToWorld(e.to), 0.5),
          Math.abs(e.to.x - e.from.x) + Math.abs(e.to.y - e.from.y),
        );
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
        const from = squareAt(att.position);
        const to = squareAt(def.position);
        // A scout charging from afar: frame the whole run, not just the clash.
        const span = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        await this.hooks.focus?.(
          squareToWorld(to).lerp(squareToWorld(from), span > 3 ? 0.5 : 0.25),
          span,
        );
        // Face each other (on the plus board they can meet side-on) and show who they are.
        await Promise.all([this.turnTo(att, def.position), this.turnTo(def, att.position)]);
        await Promise.all([this.reveal(att, e.attackerRank), this.reveal(def, e.defenderRank)]);
        // Walk up to a square's length away: they square up, they never touch.
        const gap = att.position.distanceTo(def.position);
        const stop = att.position.clone().lerp(def.position, Math.max(0, (gap - FACE_OFF) / gap));
        if (gap > FACE_OFF + 0.05) await this.hopFrom(att, att.position.clone(), stop);
        await this.taunt(att, e.attackerRank, def);
        await this.taunt(def, e.defenderRank, att);
        sfx.play('clash');
        await this.hooks.onBattle?.({
          attackerTeam: att.team,
          attackerRank: e.attackerRank,
          defenderRank: e.defenderRank,
          reason: e.reason,
        });
        this.lastBattle = { att, def, from, to, reason: e.reason };
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
          await this.hopFrom(lb.att, lb.att.position.clone(), squareToWorld(lb.to));
        }
        // Survivors turn back to face the way their army faces.
        if (lb) {
          const alive = [lb.att, lb.def].filter((o) => !e.fallen.includes(o.pieceId));
          await Promise.all(alive.map((o) => this.turnTo(o, null)));
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

  private lastBattle: {
    att: PieceObject;
    def: PieceObject;
    from: Pos;
    to: Pos;
    reason: string;
  } | null = null;

  /** Turn a soldier on the spot to face a point (null: back to his army's facing). */
  private turnTo(obj: PieceObject, point: THREE.Vector3 | null) {
    const want =
      point === null
        ? FACING[obj.team]
        : Math.atan2(point.x - obj.position.x, point.z - obj.position.z);
    const start = obj.body.rotation.y;
    const delta = Math.atan2(Math.sin(want - start), Math.cos(want - start));
    if (Math.abs(delta) < 0.05) return Promise.resolve();
    return tween(220 + Math.abs(delta) * 120, (k) => (obj.body.rotation.y = start + delta * k));
  }

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
    const dur = Math.max(230, 340 - rocks * 6);
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

  /**
   * Squaring up before the fight, without touching: a jump straight up, a double jump, a
   * stomp, puffing up and leaning back, or a spin on the spot. Mines and flags can't jump;
   * they just wobble.
   */
  private async taunt(obj: PieceObject, rank: Rank, enemy: PieceObject) {
    if (await this.comeAlive(obj, rank, enemy)) return;
    const rig = obj.rig;
    const reset = () => {
      tipOnEdge(rig, 0);
      rig.position.set(0, 0, 0);
      rig.rotation.set(0, 0, 0);
      rig.scale.setScalar(1);
    };
    if (!RANKS[rank].movable) {
      sfx.play('tick');
      await tween(360, (k) => (rig.rotation.z = Math.sin(k * Math.PI * 4) * 0.08 * (1 - k)));
      reset();
      return;
    }
    const jump = (h: number, ms: number) => {
      sfx.play('hop');
      return tween(
        ms,
        (k) => {
          const up = Math.sin(k * Math.PI);
          rig.position.y = h * up;
          // Squash a little on take-off and landing.
          const squash = 1 - 0.08 * Math.max(0, Math.cos(k * Math.PI * 2));
          rig.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        },
        ease.linear,
      );
    };
    const moves = [
      () => jump(0.35, 320),
      async () => {
        await jump(0.22, 220);
        await jump(0.3, 260);
      },
      async () => {
        for (const side of [1, -1, 1]) {
          await tween(120, (k) => tipOnEdge(rig, side * 0.2 * Math.sin(k * Math.PI)), ease.linear);
          sfx.play('tap');
        }
      },
      async () => {
        sfx.play('hop');
        await tween(260, (k) => {
          rig.scale.setScalar(1 + 0.12 * k);
          rig.rotation.x = -0.22 * k;
        });
        await wait(220);
        await tween(200, (k) => {
          rig.scale.setScalar(1.12 - 0.12 * k);
          rig.rotation.x = -0.22 * (1 - k);
        });
      },
      async () => {
        sfx.play('hop');
        await tween(460, (k) => {
          rig.rotation.y = k * Math.PI * 2;
          rig.position.y = Math.sin(k * Math.PI) * 0.12;
        });
      },
    ];
    await moves[Math.floor(Math.random() * moves.length)]!();
    reset();
  }

  /**
   * The toy comes to life (Toy Story style, still green plastic): a little shiver, then a move
   * that suits him – aiming his rifle, shaking a fist, a jump, a salute – and he freezes back
   * into a toy. False if this figure can't (then taunt() does it the stiff way).
   */
  private async comeAlive(obj: PieceObject, rank: Rank, enemy: PieceObject) {
    const alive = obj.comeAlive();
    if (!alive) return false;
    const moves = ALIVE_MOVES[rank] ?? MOVES;
    const move = moves[Math.floor(Math.random() * moves.length)]!;
    const dur = 1.5;
    const target = enemy.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0));
    sfx.play('tick');
    let beat = -1;
    await tween(
      dur * 1000,
      (k) => {
        const t = k * dur;
        obj.rig.position.y = alive.pose(move, t, dur, target);
        // A shiver as he wakes up.
        obj.rig.scale.setScalar(1 + Math.max(0, 0.04 * Math.sin(Math.min(1, t / 0.25) * Math.PI)));
        const b = Math.floor(t * 4);
        if (b !== beat) {
          beat = b;
          if (move === 'stomp' && b % 2 === 0 && t < dur - 0.3) sfx.play('tap');
          if (move === 'jump' && Math.abs(t / dur - 0.32) < 0.13) sfx.play('hop');
        }
      },
      ease.linear,
    );
    obj.rig.position.y = 0;
    obj.rig.scale.setScalar(1);
    // …and stiff again: back to being a plastic toy.
    obj.backToToy();
    sfx.play('tick');
    return true;
  }

  private async reveal(obj: PieceObject, rank: Rank) {
    if (obj.rank === rank) return;
    // The tile tips over like a flipped Stratego piece, and the soldier pops up.
    sfx.play('flip');
    await tween(220, (k) => (obj.rig.rotation.x = -k * 1.4), ease.in);
    obj.setRank(rank, false);
    obj.rig.rotation.x = 0;
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
/** What each rank likes to do when he comes alive to square up. */
const ALIVE_MOVES: Partial<Record<Rank, Move[]>> = {
  marskal: ['salute', 'flex', 'fist'],
  general: ['fist', 'salute', 'flex'],
  oberst: ['salute', 'flex', 'fist'],
  major: ['salute', 'fist', 'stomp'],
  kaptajn: ['aim', 'fist', 'stomp'],
  loejtnant: ['aim', 'fist', 'beckon'],
  sergent: ['aim', 'fist', 'stomp'],
  minoer: ['fist', 'beckon', 'stomp'],
  spejder: ['jump', 'beckon', 'jump'],
  spion: ['beckon', 'flex', 'jump'],
};

/** Centre to centre, two soldiers squaring up (their bases are ~0.6 wide). */
const FACE_OFF = 0.95;

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
