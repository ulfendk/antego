import type { Obstacle, P2 } from '../scene/drive.js';

/**
 * Arcade physics for toy cars on a tabletop, Micro Machines style: point a direction and the
 * car turns towards it; it grips well on cardboard, drifts a little on the varnished table,
 * wallows in the lakes, bounces off boxes and bumps the other cars. Pure maths on x/z.
 */

export interface CarSpec {
  /** Top speed (units/s), acceleration (units/s²), turning (rad/s at speed). */
  maxSpeed: number;
  accel: number;
  turn: number;
  mass: number;
  halfLength: number;
  halfWidth: number;
}

export const JEEP: CarSpec = {
  maxSpeed: 6.4,
  accel: 9,
  turn: 3.6,
  mass: 1,
  halfLength: 1.05,
  halfWidth: 0.58,
};

/** Heavier and a little slower off the line, same top speed: it shoves jeeps aside. */
export const TANK: CarSpec = {
  maxSpeed: 6.0,
  accel: 6.5,
  turn: 3.0,
  mass: 2.2,
  halfLength: 1.2,
  halfWidth: 0.62,
};

export interface Car {
  spec: CarSpec;
  x: number;
  z: number;
  /** Heading angle: forward is (cos a, sin a) in x/z. */
  a: number;
  vx: number;
  vz: number;
}

export interface Drive {
  /** Where to go (need not be unit length; zero = no steering). */
  dirX: number;
  dirZ: number;
  /** 0–1. */
  throttle: number;
  /** Optional cap on top speed (0–1): computer racers' pace. */
  limit?: number;
}

export interface Surface {
  /** Sideways grip (1/s), rolling drag (1/s), and a cap on top speed (0–1). */
  grip: number;
  drag: number;
  top: number;
}

export const CARDBOARD: Surface = { grip: 10, drag: 0.45, top: 1 };
export const TABLE: Surface = { grip: 6.5, drag: 0.5, top: 1 };

/** The lake slows you down in proportion to how many wheels are in it. */
export function inWater(base: Surface, wet: number): Surface {
  return {
    grip: base.grip * (1 - wet * 0.4),
    drag: base.drag + wet * 2.2,
    top: base.top * (1 - wet * 0.45),
  };
}

export const heading = (c: Car): P2 => ({ x: Math.cos(c.a), z: Math.sin(c.a) });
export const speedOf = (c: Car) => c.vx * Math.cos(c.a) + c.vz * Math.sin(c.a);

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function step(car: Car, input: Drive, surface: Surface, dt: number) {
  const spec = car.spec;
  const want = Math.hypot(input.dirX, input.dirZ);
  let thrust = input.throttle * spec.accel;
  const fwd = speedOf(car);
  if (want > 1e-3) {
    const diff = wrapAngle(Math.atan2(input.dirZ, input.dirX) - car.a);
    // Turning needs a bit of speed (a toy car can't spin on the spot), but not much.
    const rate = spec.turn * Math.min(1, 0.3 + Math.abs(fwd) / 2.5);
    car.a = wrapAngle(car.a + Math.max(-rate * dt, Math.min(rate * dt, diff)));
    // Asked to go the other way: ease off while turning round.
    if (Math.abs(diff) > 1.7) thrust *= 0.35;
  }
  const hx = Math.cos(car.a);
  const hz = Math.sin(car.a);
  car.vx += hx * thrust * dt;
  car.vz += hz * thrust * dt;
  // Split into forward and sideways: sideways bleeds off by grip (drift), forward by drag.
  let f = car.vx * hx + car.vz * hz;
  let l = car.vx * -hz + car.vz * hx;
  l *= Math.exp(-surface.grip * dt);
  const brake = input.throttle < 0.05 ? 1.4 : 0;
  f *= Math.exp(-(surface.drag + brake) * dt);
  const top = spec.maxSpeed * surface.top * (input.limit ?? 1);
  if (f > top) f -= (f - top) * Math.min(1, 5 * dt);
  if (f < -top * 0.4) f = -top * 0.4;
  car.vx = hx * f - hz * l;
  car.vz = hz * f + hx * l;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

/** The two circles standing in for a car's rounded-rectangle body. */
export function bodyCircles(car: Car): { x: number; z: number; r: number }[] {
  const r = car.spec.halfWidth * 1.02;
  const off = car.spec.halfLength - r;
  const hx = Math.cos(car.a);
  const hz = Math.sin(car.a);
  return [
    { x: car.x + hx * off, z: car.z + hz * off, r },
    { x: car.x - hx * off, z: car.z - hz * off, r },
  ];
}

/** Whether the car's body overlaps a circle. */
export function touches(car: Car, x: number, z: number, r: number) {
  return bodyCircles(car).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r);
}

/** Push out of an obstacle and bounce. Returns the impact speed (0 if no contact). */
export function collideObstacle(car: Car, o: Obstacle, bounce = 0.35): number {
  let impact = 0;
  for (const c of bodyCircles(car)) {
    let nx = 0;
    let nz = 0;
    let depth: number;
    if (o.kind === 'circle') {
      const dx = c.x - o.x;
      const dz = c.z - o.z;
      const d = Math.hypot(dx, dz);
      depth = o.r + c.r - d;
      if (depth <= 0) continue;
      nx = dx / (d || 1);
      nz = dz / (d || 1);
    } else {
      // Nearest point of the rectangle to the circle's centre.
      const px = Math.max(o.x - o.hx, Math.min(o.x + o.hx, c.x));
      const pz = Math.max(o.z - o.hz, Math.min(o.z + o.hz, c.z));
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        depth = c.r - d;
        if (depth <= 0) continue;
        nx = dx / d;
        nz = dz / d;
      } else {
        // Centre inside the box: out through the nearest side.
        const ex = o.hx - Math.abs(c.x - o.x);
        const ez = o.hz - Math.abs(c.z - o.z);
        if (ex < ez) {
          nx = Math.sign(c.x - o.x) || 1;
          depth = ex + c.r;
        } else {
          nz = Math.sign(c.z - o.z) || 1;
          depth = ez + c.r;
        }
      }
    }
    car.x += nx * depth;
    car.z += nz * depth;
    const vn = car.vx * nx + car.vz * nz;
    if (vn < 0) {
      car.vx -= (1 + bounce) * vn * nx;
      car.vz -= (1 + bounce) * vn * nz;
      // Scrape: lose some speed along the wall too.
      car.vx *= 0.9;
      car.vz *= 0.9;
      impact = Math.max(impact, -vn);
    }
  }
  return impact;
}

/** Bump two cars apart (heavier cars shove harder). Returns the impact speed. */
export function collideCars(a: Car, b: Car, bounce = 0.4): number {
  let impact = 0;
  for (const ca of bodyCircles(a)) {
    for (const cb of bodyCircles(b)) {
      const dx = cb.x - ca.x;
      const dz = cb.z - ca.z;
      const d = Math.hypot(dx, dz);
      const depth = ca.r + cb.r - d;
      if (depth <= 0) continue;
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      const ma = a.spec.mass;
      const mb = b.spec.mass;
      const share = mb / (ma + mb);
      a.x -= nx * depth * share;
      a.z -= nz * depth * share;
      b.x += nx * depth * (1 - share);
      b.z += nz * depth * (1 - share);
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const j = (-(1 + bounce) * rel) / (1 / ma + 1 / mb);
        a.vx -= (j / ma) * nx;
        a.vz -= (j / ma) * nz;
        b.vx += (j / mb) * nx;
        b.vz += (j / mb) * nz;
        impact = Math.max(impact, -rel);
      }
    }
  }
  return impact;
}
