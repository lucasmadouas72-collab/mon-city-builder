import * as THREE from 'three';
import { E, N, W, type World } from '../sim/World';
import { BuildState } from '../sim/zones';
import { createModels, type ModelSet } from './buildingModels';
import { patchEnv } from './envMaterials';

interface Slot {
  mesh: THREE.InstancedMesh;
  id: number;
}

interface Anim {
  idx: number;
  start: number;
}

const ANIM_TIME = 0.6;

/** Bâtiments instanciés : un InstancedMesh par modèle, avec animation d'apparition. */
export class Buildings {
  readonly group = new THREE.Group();
  private models: ModelSet;
  private meshes = new Map<string, THREE.InstancedMesh>();
  private material: THREE.MeshStandardMaterial;
  private slots = new Map<number, Slot>();
  private anims: Anim[] = [];
  private dirty = true;
  private pending = new Set<number>();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private world: World) {
    this.models = createModels();
    this.material = patchEnv(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }), { windows: true, snow: true });
  }

  /** Signale des cases modifiées (pour les animer à la prochaine reconstruction). */
  markChanged(tiles: number[]): void {
    for (const t of tiles) this.pending.add(t);
    this.dirty = true;
  }

  private modelKey(idx: number): string | null {
    const w = this.world;
    const state = w.bState[idx];
    if (state === BuildState.Construction) return `c-${w.bLevel[idx]}`;
    if (state === BuildState.Built) return `${w.zones[idx]}-${w.bLevel[idx]}-${w.bVariant[idx]}`;
    return null;
  }

  private geometry(key: string): THREE.BufferGeometry {
    if (key.startsWith('c-')) return this.models.construction[Number(key.slice(2))];
    return this.models.buildings.get(key)!;
  }

  private meshFor(key: string, needed: number): THREE.InstancedMesh {
    let mesh = this.meshes.get(key);
    if (!mesh || mesh.instanceMatrix.count < needed) {
      if (mesh) { this.group.remove(mesh); mesh.dispose(); }
      const cap = Math.max(16, Math.ceil(needed * 1.5));
      mesh = new THREE.InstancedMesh(this.geometry(key), this.material, cap);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    return mesh;
  }

  private matrixFor(idx: number, scaleY = 1): THREE.Matrix4 {
    const w = this.world;
    const i = idx % w.size, j = Math.floor(idx / w.size);
    const face = w.facing(i, j);
    const angle = face === E ? Math.PI / 2 : face === W ? -Math.PI / 2 : face === N ? Math.PI : 0;
    const y = w.tileMinMax(i, j)[1];
    this.q.setFromAxisAngle(this.up, angle);
    return this.tmp.compose(new THREE.Vector3(i + 0.5, y, j + 0.5), this.q, new THREE.Vector3(1, scaleY, 1));
  }

  private rebuild(time: number): void {
    const w = this.world;
    const groups = new Map<string, number[]>();
    for (let idx = 0; idx < w.bState.length; idx++) {
      const key = this.modelKey(idx);
      if (!key) continue;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(idx);
    }
    this.slots.clear();
    for (const [key, mesh] of this.meshes) if (!groups.has(key)) mesh.count = 0;
    for (const [key, list] of groups) {
      const mesh = this.meshFor(key, list.length);
      list.forEach((idx, id) => {
        mesh.setMatrixAt(id, this.matrixFor(idx, this.pending.has(idx) ? 0.01 : 1));
        this.slots.set(idx, { mesh, id });
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const idx of this.pending) if (this.slots.has(idx)) this.anims.push({ idx, start: time });
    this.pending.clear();
    this.dirty = false;
  }

  update(time: number): void {
    if (this.dirty) this.rebuild(time);
    if (!this.anims.length) return;
    const touched = new Set<THREE.InstancedMesh>();
    this.anims = this.anims.filter((a) => {
      const slot = this.slots.get(a.idx);
      if (!slot) return false;
      const t = Math.min(1, (time - a.start) / ANIM_TIME);
      // Rebond léger en fin d'animation
      const s = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
      slot.mesh.setMatrixAt(slot.id, this.matrixFor(a.idx, Math.max(0.01, s)));
      touched.add(slot.mesh);
      return t < 1;
    });
    touched.forEach((m) => (m.instanceMatrix.needsUpdate = true));
  }
}
