import { describe, expect, it } from 'vitest';
import { BOARDS } from '@antego/shared';
import { inLake, type Obstacle } from '../scene/drive.js';
import { CARDBOARD, JEEP, TANK, collideObstacle, step, type Car } from './physics.js';
import { RaceSim } from './sim.js';
import { HALF_WIDTH, LAPS, Track, coneSpots, obstacleDistance } from './track.js';

/** The classic table as laid out in scene/props.ts: toy boxes, the lid, two spare soldiers. */
const TABLE: Obstacle[] = [
  { kind: 'rect', x: 8.5, z: 4.3, hx: 2.71, hz: 3.46 },
  { kind: 'rect', x: -8.5, z: -4.3, hx: 2.71, hz: 3.46 },
  { kind: 'circle', x: -12.5, z: -11, r: 11 * 0.62 * 0.72 },
  { kind: 'circle', x: 8.6, z: -6.4, r: 0.45 },
  { kind: 'circle', x: -7.2, z: 7.6, r: 0.45 },
];

describe('the race course', () => {
  const track = new Track();

  it('is a lap round the table and across the board, through both lakes, clear of the props', () => {
    expect(track.length).toBeGreaterThan(60);
    for (const o of TABLE) {
      const nearest = Math.min(...track.points.map((p) => obstacleDistance(p, o)));
      expect(nearest).toBeGreaterThan(HALF_WIDTH);
    }
    const lakes = track.points.filter((p) => inLake(BOARDS.klassisk, p));
    expect(lakes.some((p) => p.x > 0)).toBe(true);
    expect(lakes.some((p) => p.x < 0)).toBe(true);
  });

  it('never folds back close to itself', () => {
    const n = track.points.length;
    for (let i = 0; i < n; i += 5) {
      for (let j = 0; j < n; j += 5) {
        const apart = Math.min(Math.abs(i - j), n - Math.abs(i - j)) * 0.1;
        if (apart < 9) continue;
        const a = track.points[i]!;
        const b = track.points[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * HALF_WIDTH);
      }
    }
  });

  it('puts marshals outside the tape, off the props', () => {
    const cones = coneSpots(track, TABLE);
    expect(cones.length).toBeGreaterThanOrEqual(6);
    for (const c of cones) {
      expect(track.nearestAnywhere(c).dist).toBeGreaterThan(HALF_WIDTH);
      for (const o of TABLE) expect(obstacleDistance(c, o)).toBeGreaterThan(0.3);
    }
  });
});

describe('racing', () => {
  it('stops a car driven flat out into a toy box', () => {
    const box = TABLE[0]!;
    const car: Car = { spec: JEEP, x: 8.5, z: 12, a: -Math.PI / 2, vx: 0, vz: 0 };
    let bumped = 0;
    for (let i = 0; i < 240; i++) {
      step(car, { dirX: 0, dirZ: -1, throttle: 1 }, CARDBOARD, 1 / 60);
      bumped = Math.max(bumped, collideObstacle(car, box));
      expect(obstacleDistance(car, box)).toBeGreaterThan(0);
    }
    expect(bumped).toBeGreaterThan(3);
    expect(car.z).toBeGreaterThan(box.z + (box.kind === 'rect' ? box.hz : 0));
  });

  it('four computer racers all finish three laps, keeping to the course', () => {
    const cones = coneSpots(new Track(), TABLE);
    const sim = new RaceSim(
      [
        { spec: JEEP, ai: true, pace: 0.95 },
        { spec: JEEP, ai: true, pace: 0.9 },
        { spec: JEEP, ai: true, pace: 0.88 },
        { spec: TANK, ai: true, pace: 0.92 },
      ],
      TABLE,
      cones,
    );
    let respawns = 0;
    const laps: number[] = [];
    for (let t = 0; t < 240 && !sim.done; t += 1 / 60) {
      for (const e of sim.step(1 / 60, { dirX: 0, dirZ: 0, throttle: 0 })) {
        if (e.type === 'respawn') respawns++;
        if (e.type === 'lap' && e.racer === 0) laps.push(e.lap);
      }
      for (const r of sim.racers) {
        for (const o of TABLE) expect(obstacleDistance(r.car, o)).toBeGreaterThan(-0.05);
      }
    }
    expect(sim.done).toBe(true);
    expect(laps).toEqual([1, 2, 3].slice(0, LAPS));
    expect(respawns).toBeLessThanOrEqual(2);
    // A lap of about 80 units at jeep pace: the race lasts roughly a minute, not ten.
    expect(sim.time).toBeLessThan(90);
  });
});
