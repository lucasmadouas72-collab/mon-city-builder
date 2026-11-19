import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/noise';
import type { World } from '../sim/World';

function colored(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let k = 0; k < arr.length; k += 3) { arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function conifer(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 5).translate(0, 0.1, 0), '#6b4a32');
  const c1 = colored(new THREE.ConeGeometry(0.2, 0.38, 7).translate(0, 0.33, 0), '#ffffff');
  const c2 = colored(new THREE.ConeGeometry(0.15, 0.3, 7).translate(0, 0.52, 0), '#ffffff');
  return mergeGeometries([trunk, c1, c2])!;
}

function broadleaf(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.03, 0.045, 0.22, 5).translate(0, 0.11, 0), '#70503a');
  const crown = colored(new THREE.IcosahedronGeometry(0.2, 0).translate(0, 0.36, 0), '#ffffff');
  const crown2 = colored(new THREE.IcosahedronGeometry(0.13, 0).translate(0.08, 0.47, 0.04), '#ffffff');
  return mergeGeometries([trunk, crown, crown2])!;
}

const MAX_TREES = 40_000;

/** Arbres instanciés (deux essences), régénérés quand la forêt change. */
export class Trees {
  readonly group = new THREE.Group();
  private kinds: THREE.InstancedMesh[];

  constructor(private world: World) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.kinds = [conifer(), broadleaf()].map((geo) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_TREES);
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    });
    this.rebuild();
  }

  rebuild(): void {
    const w = this.world;
    const counts = [0, 0];
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const palettes = [
      ['#2f6b3a', '#3b7d44', '#28603a', '#447f3c'],
      ['#5d9b3c', '#6fa842', '#4f8d36', '#83b14a', '#9bb54a'],
    ];
    for (let idx = 0; idx < w.trees.length; idx++) {
      const count = w.trees[idx];
      if (!count) continue;
      const i = idx % w.size, j = Math.floor(idx / w.size);
      const r = rng(idx * 7919 + w.seed);
      const kindBias = r() < 0.5 + (w.corner(i, j) > 2.5 ? 0.35 : -0.1) ? 0 : 1;
      for (let t = 0; t < count; t++) {
        const kind = r() < 0.8 ? kindBias : 1 - kindBias;
        const x = i + 0.15 + r() * 0.7, z = j + 0.15 + r() * 0.7;
        const s = 0.75 + r() * 0.65;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        mat.compose(new THREE.Vector3(x, w.heightAt(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.3), s));
        const mesh = this.kinds[kind];
        const n = counts[kind]++;
        if (n >= MAX_TREES) continue;
        mesh.setMatrixAt(n, mat);
        const pal = palettes[kind];
        mesh.setColorAt(n, color.set(pal[Math.floor(r() * pal.length)]));
      }
    }
    this.kinds.forEach((m, k) => {
      m.count = Math.min(counts[k], MAX_TREES);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    });
  }
}
