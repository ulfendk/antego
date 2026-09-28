import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  readonly controls: OrbitControls;
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
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 26;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.2;
    this.controls.target.set(0, 0, 0.3);
    this.applyQuality();
    this.resize();
    this.setSide('groen', false);
    addEventListener('resize', () => this.resize());
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
          offset: 0.05,
          focusArea: 0.55,
          feather: 0.35,
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

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.9;
    // Keep the whole board in view: portrait phones need a higher, steeper camera.
    this.camera.fov = this.portrait ? 44 : 36;
    this.camera.updateProjectionMatrix();
    this.fitOverride();
  }

  /** Swing the camera round to an army's side of the table. */
  setSide(team: Team, animate = true) {
    this.side = team;
    const az = VIEW[team].azimuth;
    const polar = this.portrait ? 0.42 : 0.72;
    const dist = this.portrait ? 19 / Math.max(this.camera.aspect, 0.45) ** 0.35 : 17;
    this.controls.minAzimuthAngle = az - 1.1;
    this.controls.maxAzimuthAngle = az + 1.1;
    // Aim a little towards the player so the board sits above the bottom toolbar.
    const target = new THREE.Vector3(0, 0, team === 'groen' ? 1.3 : -1.3);
    const end = new THREE.Vector3().setFromSphericalCoords(dist, polar, az).add(target);
    if (!animate) {
      this.camera.position.copy(end);
      this.controls.target.copy(target);
      this.controls.update();
      return Promise.resolve();
    }
    const start = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const s0 = new THREE.Spherical().setFromVector3(start.clone().sub(t0));
    const s1 = new THREE.Spherical().setFromVector3(end.clone().sub(target));
    let dTheta = s1.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    // Unlock azimuth limits while swinging around.
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    return tween(
      1100,
      (k) => {
        const s = new THREE.Spherical(
          s0.radius + (s1.radius - s0.radius) * k,
          s0.phi + (s1.phi - s0.phi) * k,
          s0.theta + dTheta * k,
        );
        this.controls.target.lerpVectors(t0, target, k);
        this.camera.position.setFromSpherical(s).add(this.controls.target);
        this.camera.lookAt(this.controls.target);
      },
      ease.inOut,
    ).then(() => {
      this.controls.minAzimuthAngle = az - 1.1;
      this.controls.maxAzimuthAngle = az + 1.1;
      this.controls.update();
    });
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
    const o = this.override;
    if (o) {
      o.update(dt);
      this.renderer.toneMapping = THREE.AgXToneMapping;
      this.renderer.render(o.scene, o.camera);
      return;
    }
    this.onFrame?.(dt);
    this.controls.update();
    this.renderer.toneMapping = this.composer ? THREE.NoToneMapping : THREE.AgXToneMapping;
    if (this.composer) this.composer.render(dt / 1000);
    else this.renderer.render(this.scene, this.camera);
    this.watchFrameRate(dt);
  }

  /** Hand the screen to a mini-game (or back to the board with null). */
  setOverride(o: SceneOverride | null) {
    this.override = o;
    this.controls.enabled = !o;
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
