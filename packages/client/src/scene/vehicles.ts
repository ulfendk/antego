import * as THREE from 'three';
import { loadModel, modelMesh, type Model } from './pieces.js';
import { plasticMaterial } from './plastic.js';

/** Toy vehicles are sculpted to the soldiers' scale (see tools/models/vehicles.py). */
export const VEHICLE_SCALE = 1.1;
export const WHEEL_R = 0.2;

/** Footprints after scaling, forward along +x (for steering round things and collisions). */
export const JEEP_SIZE = { halfWidth: 0.53 * VEHICLE_SCALE, halfLength: 0.98 * VEHICLE_SCALE };
export const TANK_SIZE = { halfWidth: 0.56 * VEHICLE_SCALE, halfLength: 1.15 * VEHICLE_SCALE };

export interface Jeep {
  object: THREE.Group;
  /** Wheel hubs: roll them with rotation.x. */
  wheels: THREE.Object3D[];
}

export interface Tank {
  object: THREE.Group;
  /** Swivel with rotation.y. */
  turret: THREE.Object3D;
}

interface Parts {
  body: Model;
  wheel: Model;
  hull: Model;
  turret: Model;
  wheelAt: number[][];
  turretAt: number[];
}

const rubber = plasticMaterial('#2c2d28');
const materials = new Map<string, THREE.Material>();
const plastic = (color: THREE.ColorRepresentation) => {
  const key = new THREE.Color(color).getHexString();
  let m = materials.get(key);
  if (!m) {
    m = plasticMaterial(color);
    materials.set(key, m);
  }
  return m;
};

/**
 * The Blender-built toy jeep and tank (jeep.glb, jeep-wheel.glb, tank.glb, tank-turret.glb),
 * loaded once; make as many as needed, in any plastic colour. Each vehicle is a group that
 * drives along its local +x.
 */
export class VehicleKit {
  private constructor(private parts: Parts) {}

  private static loading: Promise<VehicleKit> | null = null;

  static load(): Promise<VehicleKit> {
    VehicleKit.loading ??= (async () => {
      const [manifest, body, wheel, hull, turret] = await Promise.all([
        fetch('/models/manifest.json').then(
          (r) => r.json() as Promise<Record<string, { parts?: number[][] }>>,
        ),
        loadModel('jeep.glb'),
        loadModel('jeep-wheel.glb'),
        loadModel('tank.glb'),
        loadModel('tank-turret.glb'),
      ]);
      return new VehicleKit({
        body,
        wheel,
        hull,
        turret,
        wheelAt: manifest['jeep-wheel']?.parts ?? [],
        turretAt: manifest['tank-turret']?.parts?.[0] ?? [0, 0.5, 0.05],
      });
    })();
    VehicleKit.loading.catch(() => (VehicleKit.loading = null));
    return VehicleKit.loading;
  }

  /** The models look along +z; turn them so the vehicle drives along +x. */
  private wrap(...parts: THREE.Object3D[]) {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI / 2;
    inner.add(...parts);
    outer.add(inner);
    outer.scale.setScalar(VEHICLE_SCALE);
    outer.rotation.order = 'YZX';
    return outer;
  }

  jeep(color: THREE.ColorRepresentation = '#56663a'): Jeep {
    const wheels = this.parts.wheelAt.map(([x, y, z]) => {
      const hub = new THREE.Group();
      hub.position.set(x!, y!, z!);
      hub.add(modelMesh(this.parts.wheel, rubber));
      return hub;
    });
    return { object: this.wrap(modelMesh(this.parts.body, plastic(color)), ...wheels), wheels };
  }

  tank(color: THREE.ColorRepresentation = '#56663a'): Tank {
    const [tx, ty, tz] = this.parts.turretAt;
    const turret = new THREE.Group();
    turret.position.set(tx!, ty!, tz!);
    turret.add(modelMesh(this.parts.turret, plastic(color)));
    return { object: this.wrap(modelMesh(this.parts.hull, plastic(color)), turret), turret };
  }
}
