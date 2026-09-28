import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BloomEffect,
  BlendFunction,
  EffectComposer,
  EffectPass,
  KernelSize,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  TiltShiftEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Team } from '@antego/shared';
import { BOARD_TOP, worldToSquare } from './board.js';
import { CameraRig } from './rig.js';
import { SETTINGS, type Quality } from './quality.js';
import { stepTweens, tween, ease } from './tween.js';

export interface SceneOverride {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number): void;
  resize?(aspect: number): void;
}

/** Default camera for each army: behind its own home rows, looking across the board. */
const VIEW: Record<Team, { azimuth: number }> = {
  groen: { azimuth: 0 },
  brun: { azimuth: Math.PI },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  readonly controls: CameraRig;
  private composer: EffectComposer | null = null;
  private key!: THREE.DirectionalLight;
  private last = performance.now();
  private frameTimes: number[] = [];
  private side: Team = 'groen';
  private portrait = false;
  onFrame: ((dt: number) => void) | null = null;
  onSlow: (() => void) | null = null;
  /** A mini-game takes over the screen: its own scene, camera and per-frame update. */
  private override: SceneOverride | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    public quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !SETTINGS[quality].post,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = SETTINGS[quality].shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    this.scene.background = new THREE.Color('#1f1810');
    this.scene.fog = new THREE.Fog('#1f1810', 24, 48);

    this.lights();
    this.controls = new CameraRig(this.camera, canvas);
    this.controls.target.set(0, 0, 0.3);
    this.applyQuality();
    this.resize();
    this.setSide('groen', false);
    addEventListener('resize', () => this.resize());
    // iOS changes the viewport in steps (rotation, toolbars); also check every frame in frame().
    visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.renderer.setAnimationLoop(() => this.frame());
    // Hidden tabs get no animation frames; keep animations (and so the game flow) moving anyway.
    setInterval(() => {
      if (!document.hidden) return;
      stepTweens(100);
      this.override?.update(100);
    }, 100);
  }

  private lights() {
    // Warm lamp from over the green player's shoulder, casting soft contact shadows.
    this.key = new THREE.DirectionalLight('#fff0d8', 3.2);
    this.key.position.set(5, 11, 6);
    this.key.castShadow = true;
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -8;
    cam.right = cam.top = 8;
    cam.near = 1;
    cam.far = 30;
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.015;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);
    this.scene.add(new THREE.HemisphereLight('#dfe6ff', '#5a3e22', 0.35));
    const rim = new THREE.DirectionalLight('#cfe0ff', 0.6);
    rim.position.set(-6, 5, -8);
    this.scene.add(rim);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.applyQuality();
    this.resize();
  }

  private applyQuality() {
    const s = SETTINGS[this.quality];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, s.dpr));
    this.renderer.shadowMap.enabled = s.shadowMap > 0;
    this.key.castShadow = s.shadowMap > 0;
    if (s.shadowMap > 0) {
      this.key.shadow.mapSize.set(s.shadowMap, s.shadowMap);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.composer?.dispose();
    this.composer = null;
    if (!s.post) {
      this.renderer.toneMapping = THREE.AgXToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (s.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 0.45;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = this.quality !== 'hoej';
      ao.configuration.gammaCorrection = false;
      composer.addPass(ao);
    }
    const effects = [];
    if (s.bloom)
      effects.push(new BloomEffect({ luminanceThreshold: 0.9, intensity: 0.22, mipmapBlur: true }));
    if (s.dof) {
      // Tilt-shift sells the miniature scale: sharp across the board, soft at the top and bottom.
      effects.push(
        new TiltShiftEffect({
          offset: 0.08,
          focusArea: 0.78,
          feather: 0.25,
          kernelSize: KernelSize.SMALL,
        }),
      );
    }
    effects.push(new VignetteEffect({ darkness: 0.42, offset: 0.32 }));
    if (this.quality === 'hoej') {
      const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      grain.blendMode.opacity.value = 0.18;
      effects.push(grain);
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
    composer.addPass(new EffectPass(this.camera, ...effects));
    composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    this.composer = composer;
  }

  private size = { w: 0, h: 0 };
  private focused = false;

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.round(r.width || innerWidth);
    const h = Math.round(r.height || innerHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.9;
    this.camera.fov = this.portrait ? 50 : 38;
    this.camera.updateProjectionMatrix();
    this.fitOverride();
    // Re-frame the board for the new shape (unless we're zoomed in on a move).
    if (!this.focused && !this.flying) this.setSide(this.side, false);
  }

  /** Where the camera sits for an army: angles from the screen shape, distance so the board fits. */
  private framing(team: Team) {
    const az = VIEW[team].azimuth;
    // Portrait phones look down more steeply; landscape gets the classic table view.
    const polar = this.portrait ? 0.36 : 0.78;
    const toward = team === 'groen' ? 1 : -1;
    // Try aiming at different points along the player's axis and keep the one that shows the
    // board biggest (closest camera) while everything still fits.
    let best = { target: new THREE.Vector3(), dist: Infinity };
    for (let shift = 0; shift <= 4; shift += 0.25) {
      const target = new THREE.Vector3(0, 0, toward * shift);
      const dist = this.fitDistance(target, polar, az);
      if (dist < best.dist - 1e-3) best = { target, dist };
    }
    return { target: best.target, polar, az, dist: best.dist };
  }

  /**
   * Smallest camera distance at which the board (and the soldiers on its edge) is on screen,
   * leaving room at the top for the turn pill and at the bottom for toolbars. Narrow portrait
   * screens fit the playing squares (not the printed margin) and keep clear of the bottom
   * toolbar area.
   */
  private fitDistance(target: THREE.Vector3, polar: number, az: number) {
    const cam = this.camera.clone();
    const e = this.portrait ? 5.25 : 5.7;
    // Keep ~72 px at the top free for the turn pill and menu button, whatever the screen height.
    const top = 1 - 2 * Math.min(0.22, 72 / Math.max(1, this.size.h));
    const bottom = this.portrait ? -0.3 : -0.8;
    const pts: THREE.Vector3[] = [];
    for (const x of [-e, e])
      for (const z of [-e, e]) for (const y of [0, 1.1]) pts.push(new THREE.Vector3(x, y, z));
    const fits = (d: number) => {
      cam.position.setFromSphericalCoords(d, polar, az).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return pts.every((p) => {
        const v = p.clone().project(cam);
        return Math.abs(v.x) < 0.985 && v.y > bottom && v.y < top && v.z < 1;
      });
    };
    let lo = 4;
    let hi = 80;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private flying = false;

  /** Smoothly move the camera to look at `target` from the given spherical position. */
  private flyTo(target: THREE.Vector3, end: THREE.Spherical, ms: number) {
    const t0 = this.controls.target.clone();
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t0));
    let dTheta = end.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.flying = true;
    this.controls.enabled = false;
    return tween(
      ms,
      (k) => {
        const s = new THREE.Spherical(
          s0.radius + (end.radius - s0.radius) * k,
          s0.phi + (end.phi - s0.phi) * k,
          s0.theta + dTheta * k,
        );
        this.controls.target.lerpVectors(t0, target, k);
        this.camera.position.setFromSpherical(s).add(this.controls.target);
        this.camera.lookAt(this.controls.target);
      },
      ease.inOut,
    ).then(() => {
      this.flying = false;
      this.controls.enabled = !this.override;
    });
  }

  /** Behind the menus: a slow cinematic drift around the table. */
  idleOrbit(on: boolean) {
    this.controls.autoRotate = on;
  }

  /** Swing the camera round to an army's side of the table. */
  setSide(team: Team, animate = true) {
    this.side = team;
    this.focused = false;
    this.controls.autoRotate = false;
    const f = this.framing(team);
    if (!animate) {
      this.controls.target.copy(f.target);
      this.camera.position.setFromSphericalCoords(f.dist, f.polar, f.az).add(f.target);
      this.camera.lookAt(f.target);
      return Promise.resolve();
    }
    return this.flyTo(f.target, new THREE.Spherical(f.dist, f.polar, f.az), 1100);
  }

  private beforeFocus: { target: THREE.Vector3; sphere: THREE.Spherical } | null = null;

  /** Lean in on a move: closer and centred between the two squares, from the player's current angle. */
  focus(point: THREE.Vector3) {
    const cur = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    if (!this.focused)
      this.beforeFocus = { target: this.controls.target.clone(), sphere: cur.clone() };
    this.focused = true;
    const f = this.framing(this.side);
    const target = new THREE.Vector3(point.x, 0, point.z);
    const radius = Math.min(cur.radius, f.dist) * 0.6;
    return this.flyTo(
      target,
      new THREE.Spherical(radius, Math.min(cur.phi + 0.1, 1.0), cur.theta),
      850,
    );
  }

  /** Back to where the player had the camera before the move. */
  unfocus() {
    if (!this.focused) return Promise.resolve();
    this.focused = false;
    const back = this.beforeFocus;
    this.beforeFocus = null;
    if (!back) return Promise.resolve();
    return this.flyTo(back.target, back.sphere, 900);
  }

  get currentSide() {
    return this.side;
  }

  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);

  /**
   * Which board square is under a screen point (client pixels)? Pieces are tested first:
   * tapping the top of a tall soldier should pick its square, not the one behind it.
   */
  pick(clientX: number, clientY: number, pieces: THREE.Object3D[] = []) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    // World matrices are normally refreshed by rendering; don't rely on that having happened.
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray
      .intersectObjects(pieces, true)
      .filter((h) => !(h.object as THREE.Sprite).isSprite);
    if (hits[0]) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !pieces.includes(o)) o = o.parent;
      if (o) return worldToSquare(o.position);
    }
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return worldToSquare(hit);
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    stepTweens(dt);
    this.resize();
    const o = this.override;
    if (o) {
      o.update(dt);
      this.renderer.toneMapping = THREE.AgXToneMapping;
      this.renderer.render(o.scene, o.camera);
      return;
    }
    this.onFrame?.(dt);
    this.controls.update(dt);
    this.renderer.toneMapping = this.composer ? THREE.NoToneMapping : THREE.AgXToneMapping;
    if (this.composer) this.composer.render(dt / 1000);
    else this.renderer.render(this.scene, this.camera);
    this.watchFrameRate(dt);
  }

  /** Hand the screen to a mini-game (or back to the board with null). */
  setOverride(o: SceneOverride | null) {
    this.override = o;
    this.controls.enabled = !o && !this.flying;
    if (o) {
      o.scene.environment = this.scene.environment;
      this.fitOverride();
    }
  }

  private fitOverride() {
    const o = this.override;
    if (!o) return;
    o.camera.aspect = this.camera.aspect;
    o.camera.updateProjectionMatrix();
    o.resize?.(this.camera.aspect);
  }

  /** If the first seconds are clearly too slow, ask to step down a quality tier. */
  private watchFrameRate(dt: number) {
    if (this.frameTimes.length >= 120 || document.hidden) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length === 120) {
      const avg = this.frameTimes.slice(30).reduce((a, b) => a + b, 0) / 90;
      if (avg > 40) this.onSlow?.();
    }
  }

  resetFrameWatch() {
    this.frameTimes = [];
  }
}
