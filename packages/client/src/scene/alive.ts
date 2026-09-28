import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Model } from './pieces.js';

/**
 * A plastic army man coming to life, Toy Story style: the same green plastic figure, but
 * posable. The skinned copy of his model (skeleton from tools/models/build.py) is swapped in
 * for the stiff toy, moves, and eases back into the moulded pose exactly before the toy
 * returns, so nobody sees the join.
 *
 * Model space (glTF): +y up, +z forward, his right hand side is -x. Units are the model's
 * (a soldier is ~0.8 tall). Targets are given in model space; the solving happens in world
 * space, rotating bones by world-space deltas so their local axes don't matter.
 */
export type Move = 'aim' | 'fist' | 'jump' | 'stomp' | 'beckon' | 'salute' | 'flex';

export const MOVES: Move[] = ['aim', 'fist', 'jump', 'stomp', 'beckon', 'salute', 'flex'];

const v = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Alive {
  readonly root: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  private skeletons: THREE.Skeleton[] = [];
  /** Rest positions in model space, for building targets. */
  private at = new Map<string, THREE.Vector3>();
  /** Two hands sharing one prop (binoculars, a map): they move together. */
  private twoHanded = false;

  constructor(model: Model, material: THREE.Material) {
    this.root = cloneSkinned(model.skinned!);
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.material = material;
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
        this.skeletons.push(m.skeleton);
      }
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    for (const [name, b] of this.bones)
      this.rest.set(name, { q: b.quaternion.clone(), p: b.position.clone() });
    this.root.updateMatrixWorld(true);
    for (const name of this.bones.keys()) this.at.set(name, this.modelPos(name));
    const hr = this.at.get('hand_r');
    const hl = this.at.get('hand_l');
    let flagged = false;
    this.root.traverse((o) => (flagged ||= !!o.userData.two_handed));
    this.twoHanded = flagged || (!!hr && !!hl && hr.distanceTo(hl) < 0.16);
  }

  get ok() {
    return this.bones.has('hand_r') && this.bones.has('foot_r');
  }

  dispose() {
    for (const s of this.skeletons) s.dispose();
  }

  // ---------------------------------------------------------------- helpers

  private bone(name: string) {
    return this.bones.get(name)!;
  }

  private world(name: string) {
    return this.bone(name).getWorldPosition(v());
  }

  private modelPos(name: string) {
    return this.root.worldToLocal(this.world(name));
  }

  private toWorld(p: THREE.Vector3) {
    return this.root.localToWorld(p.clone());
  }

  private reset() {
    for (const [name, r] of this.rest) {
      const b = this.bone(name);
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Turn a bone by a world-space rotation (keeps working whatever its local axes are). */
  private turn(name: string, q: THREE.Quaternion) {
    const b = this.bone(name);
    const parent = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    const own = b.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(parent.invert().multiply(q.clone().multiply(own)));
    b.updateMatrixWorld(true);
  }

  private turnAbout(name: string, axisModel: THREE.Vector3, angle: number) {
    const axis = axisModel.clone().transformDirection(this.root.matrixWorld);
    this.turn(name, new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }

  /** Two-bone IK: upper → lower → end reaches `target` (world), bending towards `pole`. */
  private reach(
    upper: string,
    lower: string,
    end: string,
    target: THREE.Vector3,
    pole: THREE.Vector3,
  ) {
    const S = this.world(upper);
    const E = this.world(lower);
    const H = this.world(end);
    const l1 = S.distanceTo(E);
    const l2 = E.distanceTo(H);
    const d = target.clone().sub(S);
    const dist = THREE.MathUtils.clamp(d.length(), 1e-4, (l1 + l2) * 0.999);
    const dir = d.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    const p = pole.clone().sub(S);
    p.addScaledVector(dir, -p.dot(dir));
    if (p.lengthSq() < 1e-10) p.copy(E).sub(S).addScaledVector(dir, -E.clone().sub(S).dot(dir));
    const E2 = S.clone().addScaledVector(dir, a).addScaledVector(p.normalize(), h);
    const H2 = S.clone().addScaledVector(dir, dist);
    this.turn(
      upper,
      new THREE.Quaternion().setFromUnitVectors(
        E.sub(S).normalize(),
        E2.clone().sub(S).normalize(),
      ),
    );
    const Hn = this.world(end);
    this.turn(
      lower,
      new THREE.Quaternion().setFromUnitVectors(Hn.sub(E2).normalize(), H2.sub(E2).normalize()),
    );
  }

  /**
   * Hands to model-space targets (blended by w from where they rest). With one prop in both
   * hands the second hand keeps hold of it, whatever the move says, unless `free`.
   */
  private hands(r: THREE.Vector3 | null, l: THREE.Vector3 | null, w: number, free = false) {
    const restR = this.at.get('hand_r')!;
    const restL = this.at.get('hand_l')!;
    if (this.twoHanded && !free && r) l = restL.clone().add(r.clone().sub(restR));
    else if (this.twoHanded && !free && l) r = restR.clone().add(l.clone().sub(restL));
    for (const [s, target, rest] of [
      ['r', r, restR],
      ['l', l, restL],
    ] as const) {
      if (!target) continue;
      const t = rest.clone().lerp(target, w);
      // Elbows bend outwards and a little back.
      const elbow = this.at.get(`forearm_${s}`)!.clone();
      const pole = elbow.add(new THREE.Vector3(s === 'r' ? -0.2 : 0.2, -0.1, -0.12));
      this.reach(`upperarm_${s}`, `forearm_${s}`, `hand_${s}`, this.toWorld(t), this.toWorld(pole));
    }
  }

  /** Hips up/down (model units), knees bending to keep the boots on the plate. */
  private hips(drop: number) {
    const feet = (['r', 'l'] as const).map((s) => this.world(`foot_${s}`));
    const pelvis = this.bone('pelvis');
    const want = this.toWorld(
      this.modelPos('pelvis').add(new THREE.Vector3(0, -drop, 0.012 * drop * 10)),
    );
    pelvis.position.copy(pelvis.parent!.worldToLocal(want));
    pelvis.updateMatrixWorld(true);
    (['r', 'l'] as const).forEach((s, i) => {
      const knee = this.at
        .get(`shin_${s}`)!
        .clone()
        .add(new THREE.Vector3(0, 0, 0.3));
      this.reach(`thigh_${s}`, `shin_${s}`, `foot_${s}`, feet[i]!, this.toWorld(knee));
    });
  }

  /** Look at a world point (head yaw and a little pitch, within a neck's reach). */
  private look(target: THREE.Vector3 | null, w: number, extraYaw = 0) {
    let yaw = extraYaw;
    if (target) {
      const t = this.root.worldToLocal(target.clone());
      const h = this.at.get('head')!;
      yaw += Math.atan2(t.x - h.x, t.z - h.z);
    }
    yaw = THREE.MathUtils.clamp(yaw, -0.9, 0.9) * w;
    this.turnAbout('head', UP, yaw);
  }

  // ---------------------------------------------------------------- the moves

  /**
   * Pose for `move` at time t (seconds) of `dur`, looking at `enemy` (world). Returns how far
   * the whole figure should lift off the table (model units), for jumps.
   */
  pose(move: Move, t: number, dur: number, enemy: THREE.Vector3 | null): number {
    this.reset();
    // Ease in from the toy's pose, and back into it at the end.
    const w = Math.min(1, t / 0.22, Math.max(0, dur - t) / 0.28);
    const e = w * w * (3 - 2 * w);
    const sr = this.at.get('upperarm_r')!;
    const sl = this.at.get('upperarm_l')!;
    const head = this.at.get('head')!;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Alive: always breathing a little and keeping an eye on the enemy.
    this.turnAbout('chest', P(1, 0, 0), -Math.sin(t * 5) * 0.03 * e);
    let lift = 0;
    switch (move) {
      case 'aim': {
        // Rifle up to the shoulder, pointed at the enemy; a little lean into it.
        this.turnAbout('spine', P(1, 0, 0), 0.12 * e);
        this.look(enemy, e);
        if (this.twoHanded) {
          // Stock at the shoulder, the other hand along the barrel, sighting down it.
          const restR = this.at.get('hand_r')!;
          const restL = this.at.get('hand_l')!;
          const along = P(0.06, -0.04, 1).normalize();
          const r = sr.clone().add(P(0.05, 0.0, 0.1));
          const l = r.clone().addScaledVector(along, restR.distanceTo(restL));
          const before = this.bone('hand_r').getWorldQuaternion(new THREE.Quaternion());
          this.hands(r, l, e, true);
          // Turn the rifle (it's in his right hand) to point along the aim.
          const now = this.bone('hand_r').getWorldQuaternion(new THREE.Quaternion());
          const restAxis = this.toWorld(restL).sub(this.toWorld(restR)).normalize();
          const axis = restAxis.applyQuaternion(now.multiply(before.invert()));
          const want = axis
            .clone()
            .lerp(along.clone().transformDirection(this.root.matrixWorld), e)
            .normalize();
          this.turn('hand_r', new THREE.Quaternion().setFromUnitVectors(axis, want));
        } else {
          this.hands(sr.clone().add(P(0.02, -0.02, 0.22)), null, e);
        }
        break;
      }
      case 'fist': {
        // Fist up, shaking it: "just you wait!"
        this.look(enemy, e);
        const shake = Math.sin(t * 22) * 0.025;
        this.hands(
          sr.clone().add(P(-0.04, 0.2 + shake, 0.05)),
          sl.clone().add(P(0.05, -0.2, 0.03)),
          e,
        );
        break;
      }
      case 'jump': {
        // Crouch, spring up with both arms in the air, land in a crouch, stand.
        const k = t / dur;
        const crouch =
          k < 0.3
            ? Math.sin((k / 0.3) * Math.PI * 0.5)
            : k > 0.75
              ? Math.sin(((1 - k) / 0.25) * Math.PI)
              : 0;
        this.hips(0.06 * crouch * e);
        if (k > 0.3 && k < 0.8) lift = Math.sin(((k - 0.3) / 0.5) * Math.PI) * 0.45;
        const up = k > 0.25 && k < 0.85 ? 1 : 0.3;
        this.hands(
          sr.clone().add(P(-0.06, 0.24 * up, 0.02)),
          sl.clone().add(P(0.06, 0.24 * up, 0.02)),
          e,
        );
        this.look(enemy, e);
        break;
      }
      case 'stomp': {
        // Marching on the spot (as far as boots glued to a plate allow): hips bob, arms swing.
        const beat = Math.sin(t * 13);
        this.hips(0.025 * Math.abs(beat) * e);
        this.turnAbout('pelvis', P(0, 0, 1), beat * 0.05 * e);
        this.hands(
          sr.clone().add(P(-0.02, -0.19, beat * 0.08)),
          sl.clone().add(P(0.02, -0.19, -beat * 0.08)),
          e,
        );
        this.look(enemy, e);
        break;
      }
      case 'beckon': {
        // "Come on then!" – one hand out, fingers curling back, over and over.
        const curl = (Math.sin(t * 14) + 1) / 2;
        this.look(enemy, e);
        this.hands(null, sl.clone().add(P(0.03, 0.04 + curl * 0.05, 0.22 - curl * 0.08)), e);
        break;
      }
      case 'salute': {
        // A crisp salute: hand to the helmet's brim, chin up.
        this.look(enemy, e);
        this.turnAbout('head', P(1, 0, 0), -0.12 * e);
        this.hands(head.clone().add(P(-0.045, 0.1, 0.06)), null, e);
        break;
      }
      case 'flex': {
        // Double biceps and a puffed-out chest.
        this.turnAbout('chest', P(1, 0, 0), -0.15 * e);
        this.look(enemy, e * 0.6);
        this.hands(sr.clone().add(P(-0.12, 0.1, 0.0)), sl.clone().add(P(0.12, 0.1, 0.0)), e);
        break;
      }
    }
    return lift * e;
  }
}
