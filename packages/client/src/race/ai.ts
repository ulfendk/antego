import { speedOf, type Car, type Drive } from './physics.js';
import { HALF_WIDTH, type Track } from './track.js';

/**
 * A computer racer: aims at a point a little way ahead on the course (further at speed),
 * holds its own line across the lane, lifts for sharp bends, and edges round a car right in
 * front. `pace` scales its effort; the race nudges it to keep things close for young players.
 */
export class Driver {
  /** Preferred line: -1 (left edge) … 1 (right edge), drifting slowly. */
  private line: number;
  private wander = Math.random() * 10;

  constructor(
    private track: Track,
    public pace: number,
    line = 0,
  ) {
    this.line = line;
  }

  drive(car: Car, s: number, others: readonly Car[], dt: number): Drive {
    this.wander += dt;
    const v = Math.max(0, speedOf(car));
    const ahead = 1.6 + v * 0.42;
    let line = this.line * 0.55 + Math.sin(this.wander * 0.4) * 0.15;
    // Someone just in front? Go round them.
    const t = this.track.tangent(s);
    for (const o of others) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const along = dx * t.x + dz * t.z;
      const across = dx * -t.z + dz * t.x;
      if (along > 0 && along < 2.6 && Math.abs(across) < 1.3)
        line = across > 0 ? line - 0.6 : line + 0.6;
    }
    line = Math.max(-0.75, Math.min(0.75, line));
    const target = this.track.side(s + ahead, line * HALF_WIDTH);
    // How sharp is the course ahead? Lift for hairpins.
    const t2 = this.track.tangent(s + ahead + 2.5);
    const bend = 1 - (t.x * t2.x + t.z * t2.z); // 0 straight … 2 U-turn
    const lift = bend > 0.35 && v > 3.2 ? 0.45 : bend > 0.15 && v > 4.2 ? 0.75 : 1;
    return { dirX: target.x - car.x, dirZ: target.z - car.z, throttle: lift, limit: this.pace };
  }
}
