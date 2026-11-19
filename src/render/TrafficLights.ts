import * as THREE from 'three';
import type { Traffic } from '../sim/Traffic';
import type { World } from '../sim/World';

const MAX = 2000;
const RED = new THREE.Color('#ff3b30').multiplyScalar(2.2);
const GREEN = new THREE.Color('#34d058').multiplyScalar(2.2);

/** Feux tricolores : mâts aux coins des carrefours, couleur selon la phase. */
export class TrafficLights {
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private slots: Array<{ tile: number; horizontal: boolean }> = [];
  private m = new THREE.Matrix4();

  constructor(private world: World, private traffic: Traffic) {
    this.poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.32, 0.02).translate(0, 0.16, 0), new THREE.MeshStandardMaterial({ color: '#3b4048' }), MAX);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX);
    this.poles.count = this.heads.count = 0;
    this.poles.frustumCulled = this.heads.frustumCulled = false;
    this.heads.setColorAt(0, RED);
    this.group.add(this.poles, this.heads);
    this.rebuild();
  }

  rebuild(): void {
    const w = this.world;
    this.slots = [];
    let n = 0;
    for (let k = 0; k < w.lights.length && n < MAX - 2; k++) {
      if (w.lights[k] !== 1 && w.lights[k] !== 2) continue;
      const i = k % w.size, j = Math.floor(k / w.size);
      for (const [u, v, horizontal] of [[0.12, 0.12, true], [0.88, 0.88, false]] as Array<[number, number, boolean]>) {
        const x = i + u, z = j + v, y = w.roadY(x, z) + 0.07;
        this.poles.setMatrixAt(n, this.m.makeTranslation(x, y, z));
        this.heads.setMatrixAt(n, this.m.makeTranslation(x, y + 0.34, z));
        this.slots.push({ tile: k, horizontal });
        n++;
      }
    }
    this.poles.count = this.heads.count = n;
    this.poles.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  update(): void {
    this.slots.forEach((s, k) => this.heads.setColorAt(k, this.traffic.green(s.tile, s.horizontal) ? GREEN : RED));
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }
}
