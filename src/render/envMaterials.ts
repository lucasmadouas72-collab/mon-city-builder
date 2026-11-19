import * as THREE from 'three';

/** Uniformes partagés par tous les matériaux : nuit, neige, teinte saisonnière. */
export const ENV = {
  uNight: { value: 0 },
  uSnow: { value: 0 },
  uTint: { value: new THREE.Color(1, 1, 1) },
  uWet: { value: 0 },
};

interface PatchOptions {
  /** Fenêtres éclairées la nuit (couleurs bleutées). */
  windows?: boolean;
  /** Neige sur les surfaces horizontales. */
  snow?: boolean;
  /** Teinte saisonnière (herbe). */
  tint?: boolean;
  /** Phares des véhicules allumés la nuit. */
  headlights?: boolean;
}

/** Ajoute aux matériaux standard les effets d'environnement (nuit, neige, saisons). */
export function patchEnv(mat: THREE.MeshStandardMaterial, opts: PatchOptions): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ENV);
    shader.vertexShader = 'varying vec3 vCityWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec4 cityWp = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         cityWp = instanceMatrix * cityWp;
       #endif
       vCityWorld = (modelMatrix * cityWp).xyz;`,
    );
    let frag = 'uniform float uNight;\nuniform float uSnow;\nuniform vec3 uTint;\nuniform float uWet;\nvarying vec3 vCityWorld;\n' + shader.fragmentShader;
    let surface = '';
    if (opts.tint) surface += 'diffuseColor.rgb *= uTint;\n';
    if (opts.snow) {
      surface += `
        vec3 cityUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float cityFlat = smoothstep(0.55, 0.85, dot(normal, cityUp));
        float cityNoise = fract(sin(dot(floor(vCityWorld.xz * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * cityFlat * (0.75 + 0.25 * cityNoise));
      `;
    }
    if (surface) frag = frag.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + surface);
    let glow = '';
    if (opts.windows) {
      glow += `
        #ifdef USE_COLOR
        float cityWin = step(vColor.r * 1.6, vColor.b) * step(0.15, vColor.b);
        float cityRnd = fract(sin(dot(floor(vCityWorld * vec3(9.0, 7.7, 9.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        totalEmissiveRadiance += cityWin * step(0.5, cityRnd) * uNight * mix(vec3(1.0, 0.72, 0.4), vec3(0.8, 0.88, 1.0), step(0.88, cityRnd)) * 1.1;
        #endif
      `;
    }
    if (opts.headlights) {
      glow += `
        #ifdef USE_COLOR
        float cityLamp = step(0.9, vColor.r) * step(0.8, vColor.g) * step(vColor.b, 0.75);
        totalEmissiveRadiance += cityLamp * uNight * vec3(3.0, 2.6, 1.6);
        #endif
      `;
    }
    if (glow) frag = frag.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + glow);
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `env-${opts.windows ? 1 : 0}${opts.snow ? 1 : 0}${opts.tint ? 1 : 0}${opts.headlights ? 1 : 0}`;
  return mat;
}
