import * as THREE from 'three';

interface Touch {
  x: number;
  y: number;
}

/**
 * Board-game camera controls, touch first:
 * - one finger (or left mouse button) grabs the table and drags it,
 * - two fingers pinch to zoom, twist to turn the table, and move up/down together to tilt,
 * - right mouse button turns and tilts, the mouse wheel zooms.
 * The camera pose itself is the state, so tweens (Stage.flyTo) can move it freely.
 */
export class CameraRig {
  readonly target = new THREE.Vector3();
  enabled = true;
  autoRotate = false;
  autoRotateSpeed = 0.25;
  minDistance = 4;
  maxDistance = 40;
  minPolar = 0.12;
  maxPolar = 1.25;
  /** How far (in board units) the look-at point may wander from the table's centre. */
  bounds = 7;
  /** When the last two-finger gesture happened, so a lifted finger isn't taken as a tap. */
  lastMultiTouch = -Infinity;

  private pointers = new Map<number, Touch>();
  private button = 0;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => this.down(e));
    dom.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      dom.addEventListener(ev, (e) => this.up(e));
    }
    dom.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Per frame: the menu's slow drift. */
  update(dt = 16) {
    if (!this.autoRotate) return;
    this.orbit(-this.autoRotateSpeed * (dt / 1000) * 0.4, 0);
  }

  // ---------------------------------------------------------------- pointer handling

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured (e.g. synthetic ones); gestures work without it.
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.button = e.pointerType === 'mouse' ? e.button : 0;
    if (this.pointers.size >= 2) this.lastMultiTouch = performance.now();
  }

  private move(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (this.pointers.size >= 2) {
      const others = [...this.pointers.entries()].filter(([id]) => id !== e.pointerId);
      const other = others[0]![1];
      this.twoFinger(prev, cur, other);
      this.lastMultiTouch = performance.now();
    } else if (this.button === 2) {
      // Right mouse button: turn and tilt.
      this.orbit((cur.x - prev.x) * -0.006, (cur.y - prev.y) * -0.004);
    } else {
      this.pan(prev, cur);
    }
    this.pointers.set(e.pointerId, cur);
  }

  private up(e: PointerEvent) {
    if (this.pointers.size >= 2) this.lastMultiTouch = performance.now();
    this.pointers.delete(e.pointerId);
  }

  private wheel(e: WheelEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.0012));
  }

  /** One finger moved while the other stayed: pinch (distance), twist (angle), tilt (shared vertical move). */
  private twoFinger(prev: Touch, cur: Touch, other: Touch) {
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
    const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
    if (d0 > 10 && d1 > 10) this.zoom(d0 / d1);
    const a0 = Math.atan2(prev.y - other.y, prev.x - other.x);
    const a1 = Math.atan2(cur.y - other.y, cur.x - other.x);
    let da = a1 - a0;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    // Each finger's move shifts the centroid by half; vertical centroid motion tilts.
    const dy = (cur.y - prev.y) / 2;
    this.orbit(da, dy * -0.004);
  }

  // ---------------------------------------------------------------- camera maths

  private spherical() {
    return new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
  }

  private apply(s: THREE.Spherical) {
    s.radius = THREE.MathUtils.clamp(s.radius, this.minDistance, this.maxDistance);
    s.phi = THREE.MathUtils.clamp(s.phi, this.minPolar, this.maxPolar);
    s.makeSafe();
    this.camera.position.setFromSpherical(s).add(this.target);
    this.camera.lookAt(this.target);
  }

  orbit(dTheta: number, dPhi: number) {
    const s = this.spherical();
    s.theta += dTheta;
    s.phi += dPhi;
    this.apply(s);
  }

  zoom(factor: number) {
    const s = this.spherical();
    s.radius *= factor;
    this.apply(s);
  }

  /** Drag the table: the point of the board under the finger stays under the finger. */
  private pan(prev: Touch, cur: Touch) {
    const a = this.groundAt(prev);
    const b = this.groundAt(cur);
    if (!a || !b) return;
    const delta = a.sub(b);
    const next = this.target.clone().add(delta);
    const r = Math.hypot(next.x, next.z);
    if (r > this.bounds) next.multiplyScalar(this.bounds / r);
    const moved = next.sub(this.target);
    this.target.add(moved);
    this.camera.position.add(moved);
  }

  private groundAt(p: Touch) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((p.x - rect.left) / rect.width) * 2 - 1,
      -((p.y - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, hit);
  }
}
