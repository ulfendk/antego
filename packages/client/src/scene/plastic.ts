import * as THREE from 'three';

/**
 * Soft polyethylene toy plastic. The models carry baked per-vertex data in `aoCurv`:
 * R = ambient occlusion, G = curvature (0.5 flat, >0.5 convex edges). The shader darkens
 * crevices, lightens worn edges and fakes a little light bleeding through thin parts.
 */
export function plasticMaterial(
  color: THREE.ColorRepresentation,
  baked = true,
): THREE.MeshPhysicalMaterial {
  const base = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.35,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.35),
    specularIntensity: 0.6,
  });
  // Plain geometry (tiles, props) has no baked data: same plastic, no per-vertex shading.
  if (!baked) return m;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aoCurv;\nvarying vec4 vAoCurv;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAoCurv = aoCurv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vAoCurv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bakedAo = mix(1.0, vAoCurv.r, 0.75);
        float edge = clamp((vAoCurv.g - 0.5) * 2.0, -1.0, 1.0);
        diffuseColor.rgb *= bakedAo * (1.0 + max(edge, 0.0) * 0.45 - max(-edge, 0.0) * 0.2);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAoCurv.r;
        reflectedLight.indirectSpecular *= mix(1.0, vAoCurv.r, 0.8);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Thin, convex bits of soft plastic glow faintly when lit from behind.
        totalEmissiveRadiance += diffuseColor.rgb * 0.06 * smoothstep(0.5, 0.9, vAoCurv.g) * vAoCurv.r;`,
      );
  };
  m.customProgramCacheKey = () => 'antego-plastic';
  return m;
}
