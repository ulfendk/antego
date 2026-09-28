import * as THREE from 'three';
import type { Rank, Team } from '@antego/shared';
import { engineLoop, sfx } from '../audio/sfx.js';
import type { LineId } from '../generated/lines.js';
import { PIECE_SCALE, soldierMesh, type PieceKit } from '../scene/pieces.js';
import { tableObstacles } from '../scene/props.js';
import type { Stage } from '../scene/stage.js';
import { TEAM_COLORS } from '../scene/textures.js';
import { VEHICLE_SCALE, WHEEL_R, type VehicleKit } from '../scene/vehicles.js';
import { groundAt, type Wake, type Water } from '../scene/water.js';
import { button, h, line } from '../ui/dom.js';
import { voice } from '../voice/voice.js';
import { Joystick } from './joystick.js';
import { JEEP, TANK, speedOf, type Car } from './physics.js';
import { RaceSim, type RaceEvent } from './sim.js';
import { HALF_WIDTH, LAPS, coneSpots, type Track } from './track.js';

export interface RaceContext {
  stage: Stage;
  layer: HTMLElement;
  kit: PieceKit;
  vehicles: VehicleKit;
  water: Water;
}

/** Who races: grid order, front row first. The player starts on the second row. */
const FIELD: { team: Team; kind: 'jeep' | 'tank'; ai: boolean; pace: number }[] = [
  { team: 'sand', kind: 'jeep', ai: true, pace: 0.93 },
  { team: 'blaa', kind: 'jeep', ai: true, pace: 0.88 },
  { team: 'groen', kind: 'jeep', ai: false, pace: 1 },
  { team: 'brun', kind: 'tank', ai: true, pace: 0.9 },
];

const MEDALS = ['🥇', '🥈', '🥉', '4'];
const MARSHALS: Rank[] = ['sergent', 'spejder', 'kaptajn', 'loejtnant', 'major', 'minoer'];
const FIXED = 1 / 120;

interface Visual {
  object: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D | null;
  wake: Wake;
  y: number;
  hop: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The tabletop race: three laps round the table and across the board against three toy
 * vehicles, steered with a thumb stick. Resolves with what the player wants next.
 */
export async function runRace(ctx: RaceContext): Promise<'again' | 'back'> {
  const { stage, layer } = ctx;
  const obstacles = tableObstacles();
  const sim = new RaceSim(
    FIELD.map((f) => ({ spec: f.kind === 'tank' ? TANK : JEEP, ai: f.ai, pace: f.pace })),
    obstacles,
    [],
  );
  const cones = coneSpots(sim.track, obstacles);
  sim.cones.push(...cones.map((c) => ({ x: c.x, z: c.z, down: 0, fellX: 0, fellZ: 1 })));
  const me = FIELD.findIndex((f) => !f.ai);
  // ?debug: poke at the race from devtools.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { raceSim: sim });

  const root = new THREE.Group();
  root.add(tape(sim.track), startLine(sim.track));
  const marshals = cones.map((c, i) => {
    const pivot = new THREE.Group();
    const team: Team = i % 2 ? 'sand' : 'groen';
    const mesh = soldierMesh(ctx.kit, MARSHALS[i % MARSHALS.length]!, team);
    mesh.scale.multiplyScalar(PIECE_SCALE);
    pivot.add(mesh);
    pivot.position.set(c.x, groundAt(c), c.z);
    const toTrack = sim.track.at(sim.track.nearestAnywhere(c).s);
    mesh.rotation.y = Math.atan2(toTrack.x - c.x, toTrack.z - c.z);
    root.add(pivot);
    return pivot;
  });
  const visuals: Visual[] = FIELD.map((f) => {
    const color = TEAM_COLORS[f.team].plastic;
    const v =
      f.kind === 'tank'
        ? { ...ctx.vehicles.tank(color), wheels: [] as THREE.Object3D[] }
        : { ...ctx.vehicles.jeep(color), turret: null };
    const s = VEHICLE_SCALE;
    const [ax, az] = f.kind === 'tank' ? [0.66 * s, 0.38 * s] : [0.55 * s, 0.4 * s];
    const contacts = [-1, 1].flatMap((fx) => [-1, 1].map((r) => ({ x: fx * ax, z: r * az })));
    root.add(v.object);
    return {
      object: v.object,
      wheels: v.wheels,
      turret: 'turret' in v ? (v.turret as THREE.Object3D) : null,
      wake: ctx.water.wake(f.kind, contacts),
      y: 0,
      hop: 0,
    };
  });
  stage.scene.add(root);

  // HUD and controls.
  const stick = new Joystick();
  const lapEl = h('div', { class: 'race-lap' });
  const placeEl = h('div', { class: 'race-place' });
  let quit = false;
  let finishedAt: number | null = null;
  const hud = h(
    'div',
    { class: 'race-hud' },
    lapEl,
    placeEl,
    button('race.stop', () => (quit = true), 'small race-stop', '✕'),
  );

  // Chase camera: straight down the table from the near side, a little ahead of the car.
  const cam = stage.camera;
  const from = { pos: cam.position.clone(), look: stage.controls.target.clone() };
  const look = new THREE.Vector3();
  const follow = () => {
    const c = sim.racers[me]!.car;
    return new THREE.Vector3(c.x + c.vx * 0.35, 0, c.z + c.vz * 0.35);
  };
  const chaseOffset = () => {
    const d = cam.aspect < 0.9 ? 17 : 13.5;
    return new THREE.Vector3(0, d * Math.cos(0.62), d * Math.sin(0.62));
  };
  look.copy(follow());
  let intro = 0; // camera swoop from the menu, 0–1
  let go = false;
  let acc = 0;
  let engine: ReturnType<typeof engineLoop> = null;
  let bumpAt = 0;

  const draw = (dt: number) => {
    sim.racers.forEach((r, i) => drawCar(r.car, visuals[i]!, sim, i, dt, r.respawn));
    sim.cones.forEach((c, i) => {
      const m = marshals[i]!;
      const fall = c.down > 0.5 ? Math.min(1, (3.5 - c.down) / 0.3) : c.down / 0.5;
      m.quaternion.setFromAxisAngle(
        new THREE.Vector3(c.fellZ, 0, -c.fellX).normalize(),
        (Math.PI / 2) * (c.down > 0 ? fall : 0),
      );
    });
  };

  const onEvent = (e: RaceEvent) => {
    const mine = e.racer === me;
    const near = (() => {
      const a = sim.racers[e.racer]!.car;
      const b = sim.racers[me]!.car;
      return Math.hypot(a.x - b.x, a.z - b.z) < 9;
    })();
    switch (e.type) {
      case 'bump':
        if ((mine || near) && sim.time > bumpAt) {
          sfx.play(e.speed > 3 ? 'thud' : 'tap');
          bumpAt = sim.time + 0.15;
        }
        break;
      case 'cone':
        if (mine || near) sfx.play('clatter');
        break;
      case 'lap':
        if (!mine) break;
        if (e.lap === LAPS - 1) {
          sfx.play('beepHigh');
          voice.say('race.sidste_omgang');
        } else if (e.lap < LAPS) sfx.play('tick');
        break;
      case 'finish':
        if (mine) {
          sfx.play(e.place === 1 ? 'victory' : 'fanfare');
          finishedAt = sim.time;
        }
        break;
      case 'respawn':
        visuals[e.racer]!.hop = 0.6;
        if (mine) sfx.play('pop');
        break;
      case 'wrongWay':
        if (mine) voice.say('race.forkert_vej');
        break;
    }
  };

  stage.drive((dtMs) => {
    const dt = Math.min(dtMs, 100) / 1000;
    const input = stick.read();
    const player = { dirX: input.x, dirZ: input.y, throttle: input.strength };
    acc += dt;
    while (acc >= FIXED) {
      for (const e of sim.step(FIXED, player, go)) onEvent(e);
      acc -= FIXED;
    }
    draw(dt);
    // Camera: swoop in from the menu, then chase.
    const target = follow();
    look.lerp(target, 1 - Math.exp(-4 * dt));
    const want = look.clone().add(chaseOffset());
    if (intro < 1) {
      intro = Math.min(1, intro + dt / 1.6);
      const k = intro < 0.5 ? 2 * intro * intro : 1 - (-2 * intro + 2) ** 2 / 2;
      cam.position.lerpVectors(from.pos, want, k);
      cam.lookAt(new THREE.Vector3().lerpVectors(from.look, look, k));
    } else {
      cam.position.copy(want);
      cam.lookAt(look);
    }
    stage.lightAt(look);
    const r = sim.racers[me]!;
    engine?.set(Math.max(0, speedOf(r.car)) / JEEP.maxSpeed, go ? input.strength : 0);
    lapEl.textContent = `🏁 ${Math.min(LAPS, Math.max(1, r.lap + 1))}/${LAPS}`;
    const place = sim.order().indexOf(me);
    placeEl.textContent = MEDALS[place]!;
    placeEl.className = `race-place p${place + 1}`;
  });

  try {
    // Intro card while the camera swoops down onto the grid.
    const started = await new Promise<boolean>((resolve) =>
      layer.replaceChildren(
        h(
          'div',
          { class: 'panel minigame-intro groen' },
          h('div', { class: 'mg-icon', 'aria-hidden': 'true' }, '🚙'),
          line('race.titel', 'h1'),
          line('race.hjaelp', 'p'),
          button('menu.start', () => resolve(true), 'big go', '▶'),
          button('menu.tilbage', () => resolve(false), 'small', '↩'),
        ),
      ),
    );
    if (!started) return 'back';
    layer.replaceChildren(hud, stick.el);
    engine = engineLoop();
    for (const id of ['minispil.klar', 'minispil.parat', 'minispil.start'] as const) {
      const cd = h('div', { class: 'countdown' }, line(id, 'span'));
      hud.append(cd);
      sfx.play(id === 'minispil.start' ? 'beepHigh' : 'beep');
      await wait(id === 'minispil.start' ? 450 : 700);
      cd.remove();
    }
    go = true;
    // Race until the player is home (plus a moment to enjoy it) or stops.
    while (!quit && (finishedAt === null || sim.time - finishedAt < 2.5)) await wait(100);
    if (quit) return 'back';
    const place = sim.racers[me]!.finished ?? 4;
    const order = sim.order();
    engine?.stop();
    engine = null;
    return await new Promise<'again' | 'back'>((resolve) => {
      layer.replaceChildren(
        h(
          'div',
          { class: 'panel race-result' },
          line(`race.nummer_${Math.min(4, place)}` as LineId, 'h1'),
          h(
            'ol',
            { class: 'podium' },
            ...order.map((i, n) =>
              h(
                'li',
                { class: `${FIELD[i]!.team}${i === me ? ' me' : ''}` },
                h('span', { class: 'medal' }, MEDALS[n]!),
                h(
                  'span',
                  { class: 'car', 'aria-hidden': 'true' },
                  FIELD[i]!.kind === 'tank' ? '🪖' : '🚙',
                ),
              ),
            ),
          ),
          h(
            'div',
            { class: 'row' },
            button('race.igen', () => resolve('again'), 'big go', '🔁'),
            button('menu.tilbage', () => resolve('back'), 'small', '↩'),
          ),
        ),
      );
      voice.say(`race.nummer_${Math.min(4, place)}` as LineId);
    });
  } finally {
    engine?.stop();
    // Hand the camera back where it is now, so the flight home starts smoothly.
    stage.controls.target.copy(look);
    stage.drive(null);
    stage.lightAt(null);
    stick.dispose();
    stage.scene.remove(root);
    ctx.water.clear();
    layer.replaceChildren();
  }
}

/** Place a vehicle from its physics state: ride height and pitch over the board's edge, roll in turns. */
function drawCar(car: Car, v: Visual, sim: RaceSim, i: number, dt: number, respawn: number) {
  const hx = Math.cos(car.a);
  const hz = Math.sin(car.a);
  const axle = car.spec.halfLength * 0.6;
  const yf = groundAt({ x: car.x + hx * axle, z: car.z + hz * axle });
  const yr = groundAt({ x: car.x - hx * axle, z: car.z - hz * axle });
  v.y += ((yf + yr) / 2 - v.y) * Math.min(1, dt * 20);
  const o = v.object;
  const fwd = speedOf(car);
  const side = car.vx * -hz + car.vz * hx;
  // Respawn: picked up and dropped back on the tape.
  if (v.hop > 0) v.hop = Math.max(0, v.hop - dt);
  const lift = v.hop > 0 ? Math.sin((v.hop / 0.6) * Math.PI) * 0.9 : 0;
  o.visible = respawn <= 0 || Math.floor(respawn * 12) % 2 === 0;
  o.position.set(
    car.x,
    v.y + lift + Math.abs(Math.sin(sim.time * 17 + i)) * 0.01 * Math.min(1, fwd / 3),
    car.z,
  );
  o.rotation.y = -car.a;
  o.rotation.z = Math.atan2(yf - yr, 2 * axle) * 0.8;
  o.rotation.x = THREE.MathUtils.clamp(-side * 0.035, -0.12, 0.12);
  for (const w of v.wheels) w.rotation.x += (fwd * dt) / (WHEEL_R * VEHICLE_SCALE);
  if (v.turret) {
    // The tank's gun follows whoever is just ahead of it.
    let yaw = 0;
    let best = 7;
    for (const other of sim.racers) {
      const c = other.car;
      if (c === car) continue;
      const dx = c.x - car.x;
      const dz = c.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d < best && dx * hx + dz * hz > 0) {
        best = d;
        yaw = -Math.atan2(hx * dz - hz * dx, hx * dx + hz * dz);
      }
    }
    v.turret.rotation.y +=
      (THREE.MathUtils.clamp(yaw, -0.7, 0.7) - v.turret.rotation.y) * Math.min(1, dt * 3);
  }
  v.wake.step({ x: car.x, z: car.z }, { x: hx, z: hz }, car.spec.halfLength, fwd, dt);
}

/** Masking-tape lines along both edges of the course, following the board's edge up and down. */
function tape(track: Track) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#e8dcb6',
    roughness: 0.85,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const group = new THREE.Group();
  for (const edge of [-1, 1]) {
    // The edge line, minus any point that would step backwards: on the inside of a tight
    // bend the offset curve folds over itself, which would draw a spike.
    const line: { p: { x: number; z: number }; t: { x: number; z: number } }[] = [];
    for (let s = 0; s < track.length; s += 0.2) {
      const p = track.side(s, edge * HALF_WIDTH);
      const t = track.tangent(s);
      const prev = line[line.length - 1];
      if (prev && (p.x - prev.p.x) * t.x + (p.z - prev.p.z) * t.z < 0.02) continue;
      line.push({ p, t });
    }
    const pos: number[] = [];
    const idx: number[] = [];
    const n = line.length;
    line.forEach(({ p, t }, k) => {
      for (const w of [-0.07, 0.07]) {
        const q = { x: p.x - t.z * w, z: p.z + t.x * w };
        pos.push(q.x, groundAt(q) + 0.004, q.z);
      }
      const a = k * 2;
      const b = ((k + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** A chequered tape across the course at the start / finish. */
function startLine(track: Track) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#1c1c1a' : '#efe9d8';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, HALF_WIDTH * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  const p = track.at(0);
  const t = track.tangent(0);
  mesh.position.set(p.x, groundAt(p) + 0.005, p.z);
  mesh.rotation.y = Math.atan2(-t.z, t.x);
  mesh.receiveShadow = true;
  return mesh;
}
