import * as THREE from 'three';
import type { Transit } from '../sim/Transit';
import type { World } from '../sim/World';

const RIBBON_W = 0.07;

/** Arrêts de bus (poteaux et abris) et tracés des lignes de bus et de métro. */
export class TransitView {
  readonly group = new THREE.Group();
  private stops: THREE.InstancedMesh;
  private lines = new THREE.Group();
  private draft = new THREE.Group();
  private _visible = false;

  constructor(private world: World, private transit: Transit) {
    const B = THREE.BoxGeometry;
    const pole = new B(0.02, 0.22, 0.02).translate(0, 0.11, 0);
    const sign = new B(0.07, 0.07, 0.012).translate(0, 0.22, 0);
    const shelter = new B(0.2, 0.012, 0.08).translate(0.1, 0.16, 0);
    const back = new B(0.2, 0.13, 0.008).translate(0.1, 0.09, -0.035);
    const geo = new THREE.BufferGeometry();
    const parts = [pole, sign, shelter, back].map((g) => g.toNonIndexed());
    const colors = ['#4b5563', '#22c55e', '#9ca3af', '#bfdbfe'];
    const pos: number[] = [], col: number[] = [];
    parts.forEach((g, k) => {
      const c = new THREE.Color(colors[k]);
      const a = g.attributes.position.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); col.push(c.r, c.g, c.b); }
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.stops = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 2048);
    this.stops.count = 0;
    this.stops.castShadow = true;
    this.stops.frustumCulled = false;
    this.lines.visible = false;
    this.group.add(this.stops, this.lines, this.draft);
    this.rebuild();
  }

  set visible(v: boolean) {
    this._visible = v;
    this.lines.visible = v;
  }

  get visible(): boolean {
    return this._visible;
  }

  private ribbon(points: THREE.Vector3[], color: string, dashed = false, lift = 0.16): THREE.Mesh {
    const pos: number[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      if (dashed && k % 2 === 1) continue;
      const a = points[k], b = points[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * RIBBON_W, nz = (dx / l) * RIBBON_W;
      const ya = a.y + lift, yb = b.y + lift;
      pos.push(a.x - nx, ya, a.z - nz, a.x + nx, ya, a.z + nz, b.x - nx, yb, b.z - nz);
      pos.push(b.x - nx, yb, b.z - nz, a.x + nx, ya, a.z + nz, b.x + nx, yb, b.z + nz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 15;
    return mesh;
  }

  private center(idx: number, lift = 0): THREE.Vector3 {
    const w = this.world;
    const i = idx % w.size, j = Math.floor(idx / w.size);
    return new THREE.Vector3(i + 0.5, w.heightAt(i + 0.5, j + 0.5) + lift, j + 0.5);
  }

  /** Points d'une polyligne passant par des cases, avec subdivision pour suivre le relief. */
  private tilePoints(tiles: number[], closed: boolean): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const seq = closed ? [...tiles, tiles[0]] : tiles;
    const w = this.world;
    for (let k = 0; k < seq.length - 1; k++) {
      const a = this.center(seq[k]), b = this.center(seq[k + 1]);
      const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5));
      for (let s = 0; s < steps; s++) {
        const p = a.clone().lerp(b, s / steps);
        p.y = w.heightAt(p.x, p.z);
        pts.push(p);
      }
    }
    pts.push(this.center(seq[seq.length - 1]));
    return pts;
  }

  rebuild(): void {
    const w = this.world;
    // Arrêts
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let idx = 0; idx < w.busStop.length && n < 2048; idx++) {
      if (!w.busStop[idx]) continue;
      const i = idx % w.size, j = Math.floor(idx / w.size);
      const x = i + 0.88, z = j + 0.88;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.isRoad(i + 1, j) || w.isRoad(i - 1, j) ? 0 : Math.PI / 2);
      this.stops.setMatrixAt(n++, m.compose(new THREE.Vector3(x, w.heightAt(x, z) + 0.07, z), q, new THREE.Vector3(1, 1, 1)));
    }
    this.stops.count = n;
    this.stops.instanceMatrix.needsUpdate = true;

    // Lignes
    this.lines.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    this.lines.clear();
    for (const line of this.transit.lines) {
      if (line.kind === 'bus' && line.path.length > 1) this.lines.add(this.ribbon(this.tilePoints(line.path, true), line.color));
      if (line.kind === 'metro') this.lines.add(this.ribbon(this.tilePoints(line.stops, true), line.color, true, 0.35));
    }
  }

  /** Aperçu de la ligne en cours de tracé. */
  setDraft(kind: 'bus' | 'metro' | null, tiles: number[]): void {
    this.draft.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    this.draft.clear();
    if (!kind || tiles.length < 2) return;
    this.draft.add(this.ribbon(this.tilePoints(tiles, false), '#ffffff', kind === 'metro', kind === 'metro' ? 0.35 : 0.18));
  }
}
