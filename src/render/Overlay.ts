import * as THREE from 'three';
import type { World } from '../sim/World';

export const OverlayColor = {
  hover: new THREE.Color('#ffffff'),
  valid: new THREE.Color('#4ade80'),
  invalid: new THREE.Color('#f87171'),
  demolish: new THREE.Color('#fb923c'),
};

const MAX_TILES = 20_000;
const LIFT = 0.12;

/** Surbrillance de cases (aperçu de construction, survol), plaquée sur le relief. */
export class Overlay {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private material: THREE.MeshBasicMaterial;

  constructor(private world: World) {
    this.positions = new Float32Array(MAX_TILES * 6 * 3);
    this.colors = new Float32Array(MAX_TILES * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);
  }

  /** Remplace la surbrillance : liste de [indices de cases, couleur]. */
  set(layers: Array<[number[], THREE.Color]>): void {
    const w = this.world;
    let v = 0;
    const inset = 0.04;
    for (const [tiles, c] of layers) {
      for (const idx of tiles) {
        if (v >= MAX_TILES * 6) break;
        const i = idx % w.size, j = Math.floor(idx / w.size);
        const pts = [
          [i + inset, j + inset], [i + inset, j + 1 - inset], [i + 1 - inset, j + inset],
          [i + 1 - inset, j + inset], [i + inset, j + 1 - inset], [i + 1 - inset, j + 1 - inset],
        ];
        for (const [x, z] of pts) {
          const o = v * 3;
          this.positions[o] = x;
          this.positions[o + 1] = w.heightAt(x, z) + LIFT;
          this.positions[o + 2] = z;
          this.colors[o] = c.r; this.colors[o + 1] = c.g; this.colors[o + 2] = c.b;
          v++;
        }
      }
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, v);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(time: number): void {
    this.material.opacity = 0.38 + Math.sin(time * 4) * 0.08;
  }
}
