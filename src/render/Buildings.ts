import * as THREE from 'three';
import { E, W, N, type World } from '../sim/World';
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
  private tint = new THREE.Color();
  private pendingAnchors = new Set<number>();
  /** Flèches d'évolution (annonce visuelle non bloquante). */
  private markers: Array<{ mesh: THREE.Mesh; start: number; y: number }> = [];
  private markerGeo = new THREE.ConeGeometry(0.16, 0.32, 4);
  private markerMat = new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.9, depthTest: false });
  private clock = 0;

  private ghost: THREE.Mesh | null = null;
  private ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });

  /** Aperçu translucide du bâtiment à placer (vert si possible, rouge sinon). */
  preview(spec: { zone: number; level: number; style: number; variant?: number } | null, est: { ok: boolean; rect: [number, number, number, number]; face: number } | null): void {
    if (!spec || !est) { if (this.ghost) this.ghost.visible = false; return; }
    const w = this.world;
    const [i0, j0, gw, gh] = est.rect;
    const face = est.face;
    const [f, d] = face === E || face === W ? [gh, gw] : [gw, gh];
    const style = spec.style ? spec.style - 1 : w.styleAt(Math.max(0, i0), Math.max(0, j0));
    const geo = this.models.building(`${spec.zone}-${spec.level}-${spec.variant ?? 0}-${style}-${f}x${d}`);
    if (!this.ghost) { this.ghost = new THREE.Mesh(geo, this.ghostMat); this.ghost.renderOrder = 20; this.group.add(this.ghost); }
    this.ghost.geometry = geo;
    this.ghost.visible = true;
    this.ghostMat.color.set(est.ok ? '#b8f5c8' : '#ff9a9a');
    const angle = face === E ? Math.PI / 2 : face === W ? -Math.PI / 2 : face === N ? Math.PI : 0;
    const y = w.inBounds(i0, j0) && w.inBounds(i0 + gw - 1, j0 + gh - 1) ? w.rectTop(i0, j0, gw, gh) : w.heightAt(i0, j0);
    this.ghost.position.set(i0 + gw / 2, y, j0 + gh / 2);
    this.ghost.rotation.set(0, angle, 0);
  }

  /** Affiche une flèche montante au-dessus des bâtiments qui viennent d'évoluer. */
  flashEvolution(tiles: number[]): void {
    const w = this.world;
    for (const t of tiles.slice(0, 30)) {
      const [gw, gh] = w.lotDims(t);
      const i = t % w.size, j = Math.floor(t / w.size);
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
      mesh.renderOrder = 40;
      const y = w.rectTop(i, j, gw, gh) + 0.4 + w.bLevel[t] * 0.5;
      mesh.position.set(i + gw / 2, y, j + gh / 2);
      this.group.add(mesh);
      this.markers.push({ mesh, start: this.clock, y });
    }
  }

  constructor(private world: World) {
    this.models = createModels();
    this.material = patchEnv(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }), { windows: true, snow: true });
  }

  /** Signale des cases modifiées (pour les animer à la prochaine reconstruction). */
  markChanged(tiles: number[]): void {
    for (const t of tiles) this.pending.add(t);
    this.dirty = true;
  }

  /** Façade × profondeur du bâtiment ancré en idx, selon son orientation. */
  private shape(idx: number): [number, number] {
    const w = this.world;
    const [gw, gh] = w.lotDims(idx);
    const face = w.faceOf(idx);
    return face === E || face === W ? [gh, gw] : [gw, gh];
  }

  private modelKey(idx: number): string | null {
    const w = this.world;
    const root = w.lotRoot[idx];
    if (root >= 0 && root !== idx) return null; // case secondaire d'un grand bâtiment
    const state = w.bState[idx];
    if (state === BuildState.Construction) {
      const [f, d] = this.shape(idx);
      return `c-${w.bLevel[idx]}-${f}x${d}`;
    }
    if (state === BuildState.Built || state === BuildState.Abandoned) {
      const [f, d] = this.shape(idx);
      return `${w.zones[idx]}-${Math.max(1, w.bLevel[idx])}-${w.bVariant[idx]}-${w.styleOf(idx)}-${f}x${d}`;
    }
    if (w.rubble[idx]) return 'rubble';
    return null;
  }

  private geometry(key: string): THREE.BufferGeometry {
    if (key.startsWith('c-')) {
      const [, level, size] = key.split('-');
      const [f, d] = size.split('x').map(Number);
      return this.models.construction(Number(level), f, d);
    }
    if (key === 'rubble') return this.models.rubble;
    return this.models.building(key);
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
    const rubbleOnly = !w.bState[idx];
    const face = rubbleOnly ? w.facing(i, j) : w.faceOf(idx);
    const [gw, gh] = rubbleOnly ? [1, 1] : w.lotDims(idx);
    const angle = face === E ? Math.PI / 2 : face === W ? -Math.PI / 2 : face === N ? Math.PI : 0;
    const y = w.rectTop(i, j, gw, gh);
    this.q.setFromAxisAngle(this.up, angle);
    return this.tmp.compose(new THREE.Vector3(i + gw / 2, y, j + gh / 2), this.q, new THREE.Vector3(1, scaleY, 1));
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
    this.pendingAnchors = new Set([...this.pending].map((t) => w.anchorOf(t)));
    for (const [key, mesh] of this.meshes) if (!groups.has(key)) mesh.count = 0;
    for (const [key, list] of groups) {
      const mesh = this.meshFor(key, list.length);
      list.forEach((idx, id) => {
        mesh.setMatrixAt(id, this.matrixFor(idx, this.pending.has(idx) || this.pendingAnchors.has(idx) ? 0.01 : 1));
        // Bâtiments endommagés : teinte assombrie, roussie ; abandonnés : ternes et grisés
        let dmg = 0;
        for (const t of this.world.lotTiles(idx)) dmg = Math.max(dmg, this.world.bDamage[t] / 100);
        if (this.world.bState[idx] === BuildState.Abandoned) this.tint.setRGB(0.5, 0.47, 0.44);
        else this.tint.setRGB(1 - dmg * 0.55, 1 - dmg * 0.65, 1 - dmg * 0.7);
        mesh.setColorAt(id, this.tint);
        this.slots.set(idx, { mesh, id });
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const idx of this.pending) { const a = w.anchorOf(idx); if (this.slots.has(a) && !this.anims.some((x) => x.idx === a)) this.anims.push({ idx: a, start: time }); }
    this.pending.clear();
    this.dirty = false;
  }

  update(time: number): void {
    this.clock = time;
    if (this.markers.length) {
      this.markers = this.markers.filter((m) => {
        const t = time - m.start;
        m.mesh.position.y = m.y + t * 0.5;
        m.mesh.rotation.y = t * 3;
        if (t > 3) { this.group.remove(m.mesh); return false; }
        return true;
      });
    }
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
