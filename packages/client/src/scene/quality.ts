export type Quality = 'hoej' | 'mellem' | 'lav';

const KEY = 'antego.quality';

export function savedQuality(): Quality | null {
  try {
    const q = localStorage.getItem(KEY);
    return q === 'hoej' || q === 'mellem' || q === 'lav' ? q : null;
  } catch {
    return null;
  }
}

export function saveQuality(q: Quality | null) {
  try {
    if (q) localStorage.setItem(KEY, q);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

/** A first guess from the device; the stage downgrades further if frames are slow. */
export function detectQuality(): Quality {
  const saved = savedQuality();
  if (saved) return saved;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (coarse && (mem <= 3 || cores <= 4)) return 'lav';
  if (coarse) return 'mellem';
  return 'hoej';
}

export interface QualitySettings {
  dpr: number;
  shadowMap: number;
  post: boolean;
  ao: boolean;
  dof: boolean;
  bloom: boolean;
  printSize: number;
  lod0Distance: number;
}

export const SETTINGS: Record<Quality, QualitySettings> = {
  hoej: {
    dpr: 2,
    shadowMap: 2048,
    post: true,
    ao: true,
    dof: true,
    bloom: true,
    printSize: 4096,
    lod0Distance: 9,
  },
  mellem: {
    dpr: 1.5,
    shadowMap: 1024,
    post: true,
    ao: true,
    dof: false,
    bloom: false,
    printSize: 2048,
    lod0Distance: 6,
  },
  lav: {
    dpr: 1,
    shadowMap: 0,
    post: false,
    ao: false,
    dof: false,
    bloom: false,
    printSize: 2048,
    lod0Distance: 0,
  },
};
