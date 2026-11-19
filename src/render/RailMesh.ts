import * as THREE from 'three';
import type { World } from '../sim/World';
import { BRIDGE_Y } from '../sim/roads';

const BALLAST = new THREE.Color('#8b8073');
const SLEEPER = new THREE.Color('#5a4636');
const STEEL = new THREE.Color('#b8bcc2');
const PIER = new THREE.Color('#a8a49a');

/** Voies ferrées : ballast, traverses et rails entre les cases reliées, piles de pont sur l'eau. */
export class RailMesh {
  readonly mesh: THREE.Mesh;
  private pos: number[] = [];
  private col: number[] = [];

  constructor(private world: World) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.mesh.receiveShadow = true;
    this.rebuild();
  }

  private y(x: number, z: number): number {
    const w = this.world;
    const i = Math.floor(x), j = Math.floor(z);
    const road = w.inBounds(i, j) && w.tiles[j * w.size + i] === 1;
    return road ? w.roadY(x, z) + 0.05 : Math.max(w.heightAt(x, z), BRIDGE_Y) + 0.04;
  }

  private quad(a: number[], b: number[], c: number[], d: number[], col: THREE.Color): void {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) this.col.push(col.r, col.g, col.b);
  }

  /** Bande parallèle au segment (x0,z0)→(x1,z1), entre les décalages o0 et o1. */
  private band(x0: number, z0: number, x1: number, z1: number, o0: number, o1: number, lift: number, col: THREE.Color): void {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    const P = (x: number, z: number, o: number) => { const px = x + nx * o, pz = z + nz * o; return [px, this.y(px, pz) + lift, pz]; };
    this.quad(P(x0, z0, o0), P(x0, z0, o1), P(x1, z1, o1), P(x1, z1, o0), col);
  }

  private box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color): void {
    const v = (x: number, y: number, z: number) => [x, y, z];
    this.quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1), c);
    this.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), c);
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), c);
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), c);
    this.quad(v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0), c);
  }

  rebuild(): void {
    this.pos = []; this.col = [];
    const w = this.world, n = w.size;
    for (let k = 0; k < w.rail.length; k++) {
      if (!w.rail[k]) continue;
      const i = k % n, j = (k - i) / n, cx = i + 0.5, cz = j + 0.5;
      const nb = w.railNeighbors(k);
      const segs = nb.length ? nb.map((q) => [(q % n) + 0.5, Math.floor(q / n) + 0.5]) : [[cx + 0.3, cz]];
      for (const [qx, qz] of segs) {
        // Demi-segment jusqu'au milieu de la liaison (chaque case dessine sa moitié)
        const mx = (cx + qx) / 2, mz = (cz + qz) / 2;
        const road = w.tiles[k] === 1;
        if (!road) this.band(cx, cz, mx, mz, -0.2, 0.2, 0, BALLAST);
        const len = Math.hypot(mx - cx, mz - cz), steps = Math.max(1, Math.round(len / 0.11));
        for (let s = 0; s < steps; s++) {
          const t0 = (s + 0.3) / steps, t1 = (s + 0.7) / steps;
          this.band(cx + (mx - cx) * t0, cz + (mz - cz) * t0, cx + (mx - cx) * t1, cz + (mz - cz) * t1, -0.15, 0.15, 0.012, SLEEPER);
        }
        for (const o of [-0.08, 0.08]) this.band(cx, cz, mx, mz, o - 0.012, o + 0.012, 0.03, STEEL);
      }
      if (w.isWater(i, j) && (i + j) % 2 === 0) this.box(cx - 0.08, Math.min(w.heightAt(cx, cz), -0.2), cz - 0.08, cx + 0.08, this.y(cx, cz) - 0.02, cz + 0.08, PIER);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }
}
