import * as THREE from 'three';
import { E, N, S, W, type World } from '../sim/World';

const ASPHALT = new THREE.Color('#41454c');
const ASPHALT_EDGE = new THREE.Color('#383b41');
const SIDEWALK = new THREE.Color('#c4bfb4');
const CURB = new THREE.Color('#9d988e');
const MARK = new THREE.Color('#f4f1e8');

const SW = 0.16; // largeur du trottoir (fraction de case)
const Y_ROAD = 0.035;
const Y_WALK = 0.075;
const Y_MARK = 0.045;

/**
 * Construit un maillage unique pour toutes les routes (reconstruit à chaque modification).
 * Chaque case est décomposée en rectangles plaqués sur le relief.
 */
export class RoadMesh {
  readonly mesh: THREE.Mesh;
  private pos: number[] = [];
  private col: number[] = [];

  constructor(private world: World) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'roads';
    this.rebuild();
  }

  rebuild(): void {
    this.pos = [];
    this.col = [];
    const w = this.world;
    for (let j = 0; j < w.size; j++) {
      for (let i = 0; i < w.size; i++) {
        if (w.isRoad(i, j)) this.buildTile(i, j, w.roadMask(i, j));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  /** Rectangle en coordonnées locales de case [0,1]², subdivisé pour épouser le relief. */
  private rect(i: number, j: number, u0: number, v0: number, u1: number, v1: number, y: number, c: THREE.Color): void {
    const du = u1 - u0, dv = v1 - v0;
    const nu = Math.max(1, Math.ceil(du / 0.25)), nv = Math.max(1, Math.ceil(dv / 0.25));
    const w = this.world;
    const P = (u: number, v: number) => {
      const x = i + u, z = j + v;
      return [x, w.heightAt(x, z) + y, z];
    };
    for (let b = 0; b < nv; b++) {
      for (let a = 0; a < nu; a++) {
        const ua = u0 + (du * a) / nu, ub = u0 + (du * (a + 1)) / nu;
        const va = v0 + (dv * b) / nv, vb = v0 + (dv * (b + 1)) / nv;
        const p00 = P(ua, va), p10 = P(ub, va), p01 = P(ua, vb), p11 = P(ub, vb);
        this.pos.push(...p00, ...p01, ...p10, ...p10, ...p01, ...p11);
        for (let k = 0; k < 6; k++) this.col.push(c.r, c.g, c.b);
      }
    }
  }

  private buildTile(i: number, j: number, mask: number): void {
    const R = (u0: number, v0: number, u1: number, v1: number, y: number, c: THREE.Color) => this.rect(i, j, u0, v0, u1, v1, y, c);
    const deg = [N, E, S, W].filter((d) => mask & d).length;

    // Chaussée
    R(0, 0, 1, 1, Y_ROAD, ASPHALT);

    // Trottoirs : coins toujours présents, bandes sur les côtés non connectés
    const a = SW, b = 1 - SW, c2 = SW * 0.25;
    R(0, 0, a, a, Y_WALK, SIDEWALK);
    R(b, 0, 1, a, Y_WALK, SIDEWALK);
    R(0, b, a, 1, Y_WALK, SIDEWALK);
    R(b, b, 1, 1, Y_WALK, SIDEWALK);
    if (!(mask & N)) { R(a, 0, b, a, Y_WALK, SIDEWALK); R(a, a, b, a + c2, Y_ROAD + 0.005, ASPHALT_EDGE); }
    if (!(mask & S)) { R(a, b, b, 1, Y_WALK, SIDEWALK); R(a, b - c2, b, b, Y_ROAD + 0.005, ASPHALT_EDGE); }
    if (!(mask & W)) { R(0, a, a, b, Y_WALK, SIDEWALK); R(a, a, a + c2, b, Y_ROAD + 0.005, ASPHALT_EDGE); }
    if (!(mask & E)) { R(b, a, 1, b, Y_WALK, SIDEWALK); R(b - c2, a, b, b, Y_ROAD + 0.005, ASPHALT_EDGE); }

    // Bordures de trottoir côté chaussée (liseré plus sombre)
    const k = 0.02;
    if (mask & N) { R(a - k, 0, a, a, Y_WALK + 0.002, CURB); R(b, 0, b + k, a, Y_WALK + 0.002, CURB); }
    if (mask & S) { R(a - k, b, a, 1, Y_WALK + 0.002, CURB); R(b, b, b + k, 1, Y_WALK + 0.002, CURB); }
    if (mask & W) { R(0, a - k, a, a, Y_WALK + 0.002, CURB); R(0, b, a, b + k, Y_WALK + 0.002, CURB); }
    if (mask & E) { R(b, a - k, 1, a, Y_WALK + 0.002, CURB); R(b, b, 1, b + k, Y_WALK + 0.002, CURB); }

    // Marquage au sol
    const lw = 0.025;
    const dash = (u0: number, v0: number, u1: number, v1: number) => R(u0, v0, u1, v1, Y_MARK, MARK);
    if (deg <= 2) {
      // Ligne centrale pointillée sur chaque bras
      if (mask & N) dash(0.5 - lw, 0.05, 0.5 + lw, 0.3);
      if (mask & S) dash(0.5 - lw, 0.7, 0.5 + lw, 0.95);
      if (mask & W) dash(0.05, 0.5 - lw, 0.3, 0.5 + lw);
      if (mask & E) dash(0.7, 0.5 - lw, 0.95, 0.5 + lw);
    } else {
      // Carrefour : passages piétons sur chaque bras
      const zebra = (horizontal: boolean, lo: number, hi: number) => {
        for (let t = a + 0.04; t < b - 0.04; t += 0.11) {
          if (horizontal) dash(t, lo, t + 0.055, hi);
          else dash(lo, t, hi, t + 0.055);
        }
      };
      if (mask & N) zebra(true, 0.02, 0.12);
      if (mask & S) zebra(true, 0.88, 0.98);
      if (mask & W) zebra(false, 0.02, 0.12);
      if (mask & E) zebra(false, 0.88, 0.98);
    }
  }
}
