import * as THREE from 'three';
import { E, N, W, type World } from '../sim/World';
import { BuildState } from '../sim/zones';
import { Service, Utility } from '../sim/services';
import type { Utilities } from '../sim/Utilities';
import { createServiceModels } from './serviceModels';
import { patchEnv } from './envMaterials';

function iconTexture(draw: (g: CanvasRenderingContext2D) => void, bg: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const BOLT = (g: CanvasRenderingContext2D) => {
  g.beginPath();
  g.moveTo(36, 10); g.lineTo(18, 36); g.lineTo(30, 36); g.lineTo(26, 54); g.lineTo(46, 26); g.lineTo(34, 26); g.closePath();
  g.fill();
};
const DROP = (g: CanvasRenderingContext2D) => {
  g.beginPath();
  g.moveTo(32, 11);
  g.bezierCurveTo(22, 26, 18, 32, 18, 39);
  g.bezierCurveTo(18, 47, 24, 53, 32, 53);
  g.bezierCurveTo(40, 53, 46, 47, 46, 39);
  g.bezierCurveTo(46, 32, 42, 26, 32, 11);
  g.fill();
};

/** Équipements publics, icônes de problèmes (électricité, eau) et incendies. */
export class ServiceLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<Service, THREE.InstancedMesh>();
  private icons: THREE.Points[];
  private flames: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private burning: number[] = [];
  private lastIcons = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(private world: World, private utilities: Utilities) {
    const models = createServiceModels();
    const mat = patchEnv(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }), { windows: true, snow: true });
    for (const [type, geo] of models) {
      const mesh = new THREE.InstancedMesh(geo, mat, 256);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(type, mesh);
      this.group.add(mesh);
    }

    this.icons = [iconTexture(BOLT, '#eab308'), iconTexture(DROP, '#0ea5e9')].map((map) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 4096), 3));
      geo.setDrawRange(0, 0);
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map, size: 26, sizeAttenuation: false, transparent: true, depthTest: false, alphaTest: 0.1 }));
      pts.frustumCulled = false;
      pts.renderOrder = 20;
      this.group.add(pts);
      return pts;
    });

    this.flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.3, 6), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }), 600);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: '#4b4b4b', transparent: true, opacity: 0.55, flatShading: true }), 600);
    this.flames.count = this.smoke.count = 0;
    this.flames.frustumCulled = this.smoke.frustumCulled = false;
    this.group.add(this.flames, this.smoke);
    this.rebuild();
  }

  rebuild(): void {
    const w = this.world;
    const lists = new Map<Service, number[]>();
    for (let idx = 0; idx < w.service.length; idx++) {
      const s = w.service[idx] as Service;
      if (!s) continue;
      let l = lists.get(s);
      if (!l) lists.set(s, (l = []));
      l.push(idx);
    }
    for (const [type, mesh] of this.meshes) {
      const l = lists.get(type) ?? [];
      l.slice(0, 256).forEach((idx, k) => {
        const i = idx % w.size, j = Math.floor(idx / w.size);
        const face = w.facing(i, j);
        const angle = face === E ? Math.PI / 2 : face === W ? -Math.PI / 2 : face === N ? Math.PI : 0;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        mesh.setMatrixAt(k, this.m.compose(new THREE.Vector3(i + 0.5, w.tileMinMax(i, j)[1], j + 0.5), this.q, new THREE.Vector3(1, 1, 1)));
      });
      mesh.count = Math.min(l.length, 256);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  refreshFires(): void {
    this.burning = [];
    const f = this.utilities.fire;
    for (let k = 0; k < f.length; k++) if (f[k]) this.burning.push(k);
  }

  private topOf(idx: number): number {
    const w = this.world;
    const i = idx % w.size, j = Math.floor(idx / w.size);
    return w.tileMinMax(i, j)[1] + 0.35 + w.bLevel[idx] * w.bLevel[idx] * 0.18;
  }

  private updateIcons(): void {
    const w = this.world, ut = this.utilities;
    const counts = [0, 0];
    const arrays = this.icons.map((p) => p.geometry.attributes.position.array as Float32Array);
    for (let idx = 0; idx < w.bState.length; idx++) {
      if (w.bState[idx] !== BuildState.Built) continue;
      const noPower = !ut.hasUtility(idx, Utility.Power);
      const noWater = !ut.hasUtility(idx, Utility.Water);
      if (!noPower && !noWater) continue;
      const i = idx % w.size, j = Math.floor(idx / w.size);
      const y = this.topOf(idx);
      const both = noPower && noWater;
      if (noPower && counts[0] < 4096) { const o = counts[0]++ * 3; arrays[0].set([i + 0.5 - (both ? 0.14 : 0), y, j + 0.5], o); }
      if (noWater && counts[1] < 4096) { const o = counts[1]++ * 3; arrays[1].set([i + 0.5 + (both ? 0.14 : 0), y, j + 0.5], o); }
    }
    this.icons.forEach((p, k) => {
      p.geometry.setDrawRange(0, counts[k]);
      p.geometry.attributes.position.needsUpdate = true;
    });
  }

  update(time: number): void {
    // Icônes rafraîchies deux fois par seconde, avec un léger flottement
    if (Math.floor(time * 2) !== this.lastIcons) {
      this.lastIcons = Math.floor(time * 2);
      this.updateIcons();
    }
    const bob = Math.sin(time * 3) * 0.03;
    this.icons.forEach((p) => (p.position.y = bob));

    // Flammes et fumée
    const w = this.world;
    let n = 0;
    for (const idx of this.burning) {
      const i = idx % w.size, j = Math.floor(idx / w.size);
      const base = w.tileMinMax(i, j)[1] + 0.1;
      for (let k = 0; k < 4 && n < 150; k++, n++) {
        const ph = time * 9 + k * 1.7 + idx;
        const s = 0.8 + Math.sin(ph) * 0.25;
        const x = i + 0.5 + Math.cos(k * 1.6) * 0.16, z = j + 0.5 + Math.sin(k * 1.6) * 0.16;
        this.flames.setMatrixAt(n, this.m.compose(new THREE.Vector3(x, base + 0.15 * s + k * 0.03, z), this.q.identity(), new THREE.Vector3(s, s * (1.2 + Math.sin(ph * 1.3) * 0.3), s)));
        const t = (time * 0.6 + k / 4) % 1;
        this.smoke.setMatrixAt(n, this.m.compose(new THREE.Vector3(x + t * 0.2, base + 0.4 + t * 1.2, z - t * 0.1), this.q.identity(), new THREE.Vector3(0.6 + t * 1.8, 0.6 + t * 1.8, 0.6 + t * 1.8)));
      }
    }
    this.flames.count = this.smoke.count = n;
    if (n) { this.flames.instanceMatrix.needsUpdate = true; this.smoke.instanceMatrix.needsUpdate = true; }
  }
}
