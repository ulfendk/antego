import { BOARDS, type BoardSpec } from '@antego/shared';
import { inLake, onCardboard, type Obstacle, type P2 } from '../scene/drive.js';
import { Driver } from './ai.js';
import {
  CARDBOARD,
  TABLE,
  collideCars,
  collideObstacle,
  heading,
  inWater,
  speedOf,
  step,
  touches,
  type Car,
  type CarSpec,
  type Drive,
} from './physics.js';
import { HALF_WIDTH, LAPS, Track } from './track.js';

/** A soldier standing by the track as a cone: knock it over and it gets back up. */
export interface Cone {
  x: number;
  z: number;
  /** Seconds until it stands again (0 = standing). */
  down: number;
  /** Which way it fell (unit x/z), for the animation. */
  fellX: number;
  fellZ: number;
}

export interface Racer {
  car: Car;
  /** Computer driver, or null for the player. */
  driver: Driver | null;
  /** Distance round the current lap, laps completed (-1 on the grid, before the line). */
  s: number;
  lap: number;
  finished: number | null;
  /** 0–1: how much of it is in the water (for effects). */
  wet: number;
  /** Seconds far off the course (respawn after a while), and driving the wrong way. */
  lost: number;
  wrongWay: number;
  /** Set while being put back on the track (seconds left). */
  respawn: number;
}

export type RaceEvent =
  | { type: 'bump'; racer: number; speed: number; what: 'wall' | 'car' }
  | { type: 'cone'; racer: number; cone: number }
  | { type: 'lap'; racer: number; lap: number }
  | { type: 'finish'; racer: number; place: number }
  | { type: 'respawn'; racer: number }
  | { type: 'wrongWay'; racer: number };

const WHEELS: P2[] = [
  { x: 0.6, z: -0.44 },
  { x: 0.6, z: 0.44 },
  { x: -0.6, z: -0.44 },
  { x: -0.6, z: 0.44 },
];

const CONE_R = 0.28;

/**
 * The whole race without any drawing: cars, laps, places, cones and respawns. The screen
 * (race.ts) renders it; the tests race it headless.
 */
export class RaceSim {
  readonly track: Track;
  readonly racers: Racer[] = [];
  readonly cones: Cone[];
  time = 0;
  private places = 0;

  constructor(
    specs: readonly { spec: CarSpec; ai: boolean; pace?: number }[],
    readonly obstacles: readonly Obstacle[],
    cones: readonly P2[] = [],
    readonly board: BoardSpec = BOARDS.klassisk,
    track = new Track(),
  ) {
    this.track = track;
    this.cones = cones.map((c) => ({ x: c.x, z: c.z, down: 0, fellX: 0, fellZ: 1 }));
    // Grid: two by two behind the start line, facing along the course.
    specs.forEach((r, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = track.wrap(-2.2 - row * 2.6);
      const p = track.side(s, (col ? 1 : -1) * HALF_WIDTH * 0.45);
      const t = track.tangent(s);
      this.racers.push({
        car: { spec: r.spec, x: p.x, z: p.z, a: Math.atan2(t.z, t.x), vx: 0, vz: 0 },
        driver: r.ai ? new Driver(track, r.pace ?? 0.9, col ? 0.5 : -0.5) : null,
        s,
        lap: -1,
        finished: null,
        wet: 0,
        lost: 0,
        wrongWay: 0,
        respawn: 0,
      });
    });
  }

  /** How far round the race (for placings): laps and distance. */
  progress(r: Racer) {
    return r.lap * this.track.length + r.s;
  }

  /** Current order, leader first (finished racers by finishing place). */
  order(): number[] {
    return this.racers
      .map((r, i) => i)
      .sort((a, b) => {
        const ra = this.racers[a]!;
        const rb = this.racers[b]!;
        if (ra.finished !== null || rb.finished !== null)
          return (ra.finished ?? 99) - (rb.finished ?? 99);
        return this.progress(rb) - this.progress(ra);
      });
  }

  get done() {
    return this.racers.every((r) => r.finished !== null);
  }

  /**
   * Advance by dt seconds. `player` steers racers without a driver (and finished racers
   * cruise on under a computer driver).
   */
  step(dt: number, player: Drive, go = true): RaceEvent[] {
    const events: RaceEvent[] = [];
    this.time += dt;
    const cars = this.racers.map((r) => r.car);
    const human = this.racers.find((r) => !r.driver);

    this.racers.forEach((r, i) => {
      const car = r.car;
      if (r.respawn > 0) {
        r.respawn -= dt;
        return;
      }
      let input: Drive = { dirX: 0, dirZ: 0, throttle: 0 };
      if (go) {
        if (r.driver) {
          // Keep it close for young players: ease off when well ahead of them, push when behind.
          const gap = human ? this.progress(r) - this.progress(human) : 0;
          const nudge = Math.max(0.86, Math.min(1.06, 1 - gap * 0.01));
          input = r.driver.drive(car, r.s, cars, dt);
          input.limit = (input.limit ?? 1) * nudge;
        } else if (r.finished !== null) {
          r.driver = new Driver(this.track, 0.8);
        } else input = player;
      }
      // Surface under the car: cardboard or table, plus however many wheels are in a lake.
      const h = heading(car);
      let wet = 0;
      for (const w of WHEELS) {
        const p = { x: car.x + h.x * w.x - h.z * w.z, z: car.z + h.z * w.x + h.x * w.z };
        if (inLake(this.board, p)) wet++;
      }
      r.wet = wet / WHEELS.length;
      const base = onCardboard(this.board, car) ? CARDBOARD : TABLE;
      step(car, input, r.wet ? inWater(base, r.wet) : base, dt);

      for (const o of this.obstacles) {
        const hit = collideObstacle(car, o);
        if (hit > 0.8) events.push({ type: 'bump', racer: i, speed: hit, what: 'wall' });
      }
      this.cones.forEach((c, k) => {
        if (c.down > 0) return;
        if (!touches(car, c.x, c.z, CONE_R)) return;
        const l = Math.hypot(car.vx, car.vz) || 1;
        c.down = 3.5;
        c.fellX = car.vx / l;
        c.fellZ = car.vz / l;
        car.vx *= 0.85;
        car.vz *= 0.85;
        events.push({ type: 'cone', racer: i, cone: k });
      });

      // Progress round the course.
      const prev = r.s;
      const { s, off } = this.track.nearest(car, r.s);
      const L = this.track.length;
      if (prev > L * 0.75 && s < L * 0.25) {
        r.lap++;
        if (r.lap >= 1) events.push({ type: 'lap', racer: i, lap: r.lap });
        if (r.lap >= LAPS && r.finished === null) {
          r.finished = ++this.places;
          events.push({ type: 'finish', racer: i, place: r.finished });
        }
      } else if (prev < L * 0.25 && s > L * 0.75) r.lap--;
      r.s = s;

      // Way off the course (or stuck): put it back on the line after a moment.
      r.lost = Math.abs(off) > HALF_WIDTH + 2.6 ? r.lost + dt : 0;
      if (r.lost > 0.8) {
        this.putBack(r);
        events.push({ type: 'respawn', racer: i });
      }
      const t = this.track.tangent(s);
      const along = car.vx * t.x + car.vz * t.z;
      r.wrongWay = along < -1 ? r.wrongWay + dt : 0;
      if (r.wrongWay > 1.2 && !r.driver) {
        r.wrongWay = -3; // don't nag every frame
        events.push({ type: 'wrongWay', racer: i });
      }
    });

    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i]!;
        const b = this.racers[j]!;
        if (a.respawn > 0 || b.respawn > 0) continue;
        const hit = collideCars(a.car, b.car);
        if (hit > 1) events.push({ type: 'bump', racer: i, speed: hit, what: 'car' });
      }
    }
    for (const c of this.cones) if (c.down > 0) c.down = Math.max(0, c.down - dt);
    return events;
  }

  /** Back on the centre line where it left the course, facing the right way, stopped. */
  putBack(r: Racer) {
    const p = this.track.side(r.s, 0);
    const t = this.track.tangent(r.s);
    Object.assign(r.car, { x: p.x, z: p.z, a: Math.atan2(t.z, t.x), vx: 0, vz: 0 });
    r.lost = 0;
    r.respawn = 0.6;
  }

  /** Speed along its heading (for sounds and wheels). */
  speed(i: number) {
    return speedOf(this.racers[i]!.car);
  }
}
