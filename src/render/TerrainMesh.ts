import * as THREE from 'three';
import { SEA_LEVEL } from '../config';
import { valueNoise } from '../core/noise';
import type { World } from '../sim/World';
import { patchEnv } from './envMaterials';

const BASE_Y = -4;

const C = {
  sandWet: new THREE.Color('#b9a879'),
  sand: new THREE.Color('#dccb94'),
  grassLow: new THREE.Color('#8cc152'),
  grass: new THREE.Color('#6fad45'),
  grassHigh: new THREE.Color('#58913a'),
  rock: new THREE.Color('#948b7d'),
  rockHigh: new THREE.Color('#aaa294'),
  soil: new THREE.Color('#6b5640'),
  soilDark: new THREE.Color('#4a3a2b'),
};

const tmp = new THREE.Color();

let desertBiome = false;
const DESERT = { low: new THREE.Color('#e3c58c'), mid: new THREE.Color('#d6ad6c'), high: new THREE.Color('#b98a55') };

function terrainColor(h: number, slope: number, jitter: number, out: THREE.Color): THREE.Color {
  if (desertBiome && h > SEA_LEVEL + 0.15) {
    out.copy(DESERT.low).lerp(DESERT.mid, Math.min(1, h / 2.5)).lerp(DESERT.high, Math.max(0, Math.min(1, (h - 2.5) / 3)));
    if (slope > 0.7) out.lerp(C.rock, Math.min(1, (slope - 0.7) / 0.6));
    out.offsetHSL(jitter * 0.01, 0, jitter * 0.03);
    return out;
  }
  if (h < SEA_LEVEL + 0.15) out.copy(C.sandWet);
  else if (h < 0.5) out.copy(C.sand).lerp(C.grassLow, Math.max(0, (h - 0.3) / 0.2));
  else if (h < 2) out.copy(C.grassLow).lerp(C.grass, (h - 0.5) / 1.5);
  else if (h < 4) out.copy(C.grass).lerp(C.grassHigh, (h - 2) / 2);
  else out.copy(C.grassHigh).lerp(C.rockHigh, Math.min(1, (h - 4) / 2));
  if (slope > 0.7) out.lerp(C.rock, Math.min(1, (slope - 0.7) / 0.6));
  out.offsetHSL(jitter * 0.012, jitter * 0.03, jitter * 0.025);
  return out;
}

/** Maillage low-poly du relief (ombrage plat, couleurs par triangle) + socle façon maquette. */
export function createTerrainMesh(world: World): THREE.Mesh {
  desertBiome = world.mapType === 'desert';
  const n = world.size;
  const triCount = n * n * 2 + n * 4 * 2;
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  let p = 0;

  const push = (x: number, y: number, z: number, c: THREE.Color) => {
    pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
    col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
    p += 3;
  };

  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    const ay = world.corner(ax, az), by = world.corner(bx, bz), cy = world.corner(cx, cz);
    const h = (ay + by + cy) / 3;
    const slope = Math.max(ay, by, cy) - Math.min(ay, by, cy);
    const jitter = valueNoise(ax * 0.9 + bx * 0.1, az * 0.9 + cz * 0.13, 5) * 2 - 1;
    terrainColor(h, slope, jitter, tmp);
    push(ax, ay, az, tmp);
    push(bx, by, bz, tmp);
    push(cx, cy, cz, tmp);
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Même découpe que World.heightAt : diagonale (i+1, j) → (i, j+1)
      tri(i, j, i, j + 1, i + 1, j);
      tri(i + 1, j, i, j + 1, i + 1, j + 1);
    }
  }

  // Socle : parois verticales sur les 4 bords
  const wall = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number, outwardFlip: boolean) => {
    const top = tmp.copy(C.soil);
    const a: [number, number, number] = [x0, h0, z0];
    const b: [number, number, number] = [x1, h1, z1];
    const c: [number, number, number] = [x1, BASE_Y, z1];
    const d: [number, number, number] = [x0, BASE_Y, z0];
    const quad = outwardFlip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const v of quad) {
      const shade = v[1] === BASE_Y ? C.soilDark : top;
      push(v[0], v[1], v[2], shade);
    }
  };
  for (let k = 0; k < n; k++) {
    wall(k, 0, k + 1, 0, world.corner(k, 0), world.corner(k + 1, 0), false); // nord
    wall(k, n, k + 1, n, world.corner(k, n), world.corner(k + 1, n), true); // sud
    wall(0, k, 0, k + 1, world.corner(0, k), world.corner(0, k + 1), true); // ouest
    wall(n, k, n, k + 1, world.corner(n, k), world.corner(n, k + 1), false); // est
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, p), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, p), 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = patchEnv(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), { snow: true, tint: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Surface de l'eau, avec un léger mouvement de vagues dans le shader. */
export function createWater(world: World): { mesh: THREE.Group; update: (t: number) => void } {
  const n = world.size;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(n, n, n / 2, n / 2);
  geo.rotateX(-Math.PI / 2);
  geo.translate(n / 2, SEA_LEVEL, n / 2);

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: '#3f9fc4', transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(position.x * 0.8 + uTime * 1.3) * 0.03 + cos(position.z * 0.7 + uTime * 1.1) * 0.03;`,
    );
  };
  const surface = new THREE.Mesh(geo, mat);
  surface.receiveShadow = true;
  group.add(surface);

  // Parois d'eau sur les bords là où le terrain est sous le niveau de la mer
  const side: number[] = [];
  const addSide = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number) => {
    if (h0 >= SEA_LEVEL && h1 >= SEA_LEVEL) return;
    const b0 = Math.min(h0, SEA_LEVEL), b1 = Math.min(h1, SEA_LEVEL);
    side.push(x0, SEA_LEVEL, z0, x1, SEA_LEVEL, z1, x1, b1, z1, x0, SEA_LEVEL, z0, x1, b1, z1, x0, b0, z0);
  };
  for (let k = 0; k < n; k++) {
    addSide(k, 0, k + 1, 0, world.corner(k, 0), world.corner(k + 1, 0));
    addSide(k, n, k + 1, n, world.corner(k, n), world.corner(k + 1, n));
    addSide(0, k, 0, k + 1, world.corner(0, k), world.corner(0, k + 1));
    addSide(n, k, n, k + 1, world.corner(n, k), world.corner(n, k + 1));
  }
  if (side.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
    sg.computeVertexNormals();
    const sm = new THREE.MeshStandardMaterial({ color: '#2f86ab', transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(sg, sm));
  }

  return { mesh: group, update: (t) => (uniforms.uTime.value = t) };
}
