import * as THREE from 'three';
import { TEAM_COLORS } from '../scene/textures.js';
import type { Stage } from '../scene/stage.js';
import { toyBoxCentres } from '../scene/props.js';
import { every } from '../scene/tween.js';
import type { VehicleKit } from '../scene/vehicles.js';

/**
 * The green jeep parked in the green army's toy box on the welcome screen. Tap it to race.
 * Every so often it gives a little hop, so curious fingers find it.
 */
export class RaceLauncher {
  private jeep: THREE.Group | null = null;
  private shown = false;
  private hopIn = 4;
  private hop = 0;
  private home = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private stage: Stage,
  ) {}

  attach(vehicles: VehicleKit) {
    const { object } = vehicles.jeep(TEAM_COLORS.groen.plastic);
    object.visible = this.shown;
    this.jeep = object;
    this.scene.add(object);
    this.place();
    void every((dt) => {
      this.update(dt);
      return true;
    });
  }

  /** On the welcome screen only (the classic table). */
  show(on: boolean) {
    this.shown = on;
    if (on) this.place();
    if (this.jeep) this.jeep.visible = on;
  }

  get visible() {
    return this.shown && !!this.jeep;
  }

  private place() {
    const box = toyBoxCentres()[0];
    if (!this.jeep || !box) return;
    // Parked a little askew on the floor of the box, nose towards the board.
    this.home.set(box.centre.x + 0.2, 0.06, box.centre.z + 0.5);
    this.jeep.position.copy(this.home);
    this.jeep.rotation.set(0.03, Math.PI / 2 + 0.35, 0);
  }

  /** Called every frame. */
  update(dt: number) {
    if (!this.visible || !this.jeep) return;
    const s = dt / 1000;
    this.hopIn -= s;
    if (this.hopIn <= 0) {
      this.hop = 0.5;
      this.hopIn = 6 + Math.random() * 5;
    }
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - s);
      const k = this.hop / 0.5;
      this.jeep.position.y = this.home.y + Math.sin(k * Math.PI) * 0.25;
      this.jeep.rotation.z = Math.sin(k * Math.PI * 2) * 0.08;
    }
  }

  /** Did a tap at these client coordinates hit the jeep (generously)? */
  hit(clientX: number, clientY: number) {
    if (!this.visible || !this.jeep) return false;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const p = this.jeep.getWorldPosition(new THREE.Vector3()).setY(0.4).project(this.stage.camera);
    if (p.z > 1) return false;
    const x = r.left + ((p.x + 1) / 2) * r.width;
    const y = r.top + ((1 - p.y) / 2) * r.height;
    // About the jeep's size on screen, and never smaller than a fingertip.
    const size = Math.max(44, this.screenSize(r));
    return Math.hypot(clientX - x, clientY - y) < size;
  }

  private screenSize(r: DOMRect) {
    const a = this.jeep!.getWorldPosition(new THREE.Vector3());
    const b = a.clone().add(new THREE.Vector3(1.1, 0, 0));
    const pa = a.project(this.stage.camera);
    const pb = b.project(this.stage.camera);
    return (Math.hypot(pa.x - pb.x, pa.y - pb.y) / 2) * r.width;
  }
}
