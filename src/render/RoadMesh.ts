import * as THREE from 'three';
import { E, N, S, W, type World } from '../sim/World';
import { RoadType } from '../sim/roads';

const C = (h: string) => new THREE.Color(h);
const ASPHALT = C('#41454c');
const ASPHALT_DARK = C('#34373d');
const ASPHALT_EDGE = C('#383b41');
const SIDEWALK = C('#c4bfb4');
const CURB = C('#9d988e');
const MARK = C('#f4f1e8');
const YELLOW = C('#e8c547');
const MEDIAN = C('#6f9c47');
const BARRIER = C('#b9b6ae');
const PAVING = C('#cdbf9f');
const PAVING_2 = C('#bfae8a');
const PLANTER = C('#5f8f3c');
const PILLAR = C('#a8a49a');
const RAIL = C('#8a8f96');

const SW = 0.16; // largeur du trottoir (fraction de case)
const Y_ROAD = 0.035;
const Y_WALK = 0.075;
const Y_MARK = 0.045;

/**
 * Maillage unique de toutes les voies (reconstruit à chaque modification) :
 * rues, avenues, autoroutes, voies piétonnes, ponts, sens uniques.
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
    this.mesh.castShadow = true;
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

  private pushTri(a: number[], b: number[], c: number[], col: THREE.Color): void {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) this.col.push(col.r, col.g, col.b);
  }

  /** Rectangle en coordonnées locales de case [0,1]², subdivisé pour épouser la chaussée. */
  private rect(i: number, j: number, u0: number, v0: number, u1: number, v1: number, y: number, c: THREE.Color): void {
    const du = u1 - u0, dv = v1 - v0;
    const nu = Math.max(1, Math.ceil(du / 0.25)), nv = Math.max(1, Math.ceil(dv / 0.25));
    const w = this.world;
    const P = (u: number, v: number) => {
      const x = i + u, z = j + v;
      return [x, w.roadY(x, z) + y, z];
    };
    for (let b = 0; b < nv; b++) {
      for (let a = 0; a < nu; a++) {
        const ua = u0 + (du * a) / nu, ub = u0 + (du * (a + 1)) / nu;
        const va = v0 + (dv * b) / nv, vb = v0 + (dv * (b + 1)) / nv;
        const p00 = P(ua, va), p10 = P(ub, va), p01 = P(ua, vb), p11 = P(ub, vb);
        this.pushTri(p00, p01, p10, c);
        this.pushTri(p10, p01, p11, c);
      }
    }
  }

  /** Boîte en coordonnées monde (piles de pont, garde-corps). */
  private box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color): void {
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
    for (const [a, b, d, e] of faces) { this.pushTri(v[a], v[b], v[d], c); this.pushTri(v[a], v[d], v[e], c); }
  }

  /** Flèche de sens unique au centre de la case. */
  private arrow(i: number, j: number, dir: number): void {
    const w = this.world;
    const [dx, dz] = dir === N ? [0, -1] : dir === S ? [0, 1] : dir === E ? [1, 0] : [-1, 0];
    const px = -dz, pz = dx;
    const P = (f: number, s: number) => {
      const x = i + 0.5 + dx * f + px * s, z = j + 0.5 + dz * f + pz * s;
      return [x, w.roadY(x, z) + Y_MARK + 0.003, z];
    };
    this.pushTri(P(0.28, 0), P(0.08, 0.1), P(0.08, -0.1), MARK);
    this.pushTri(P(0.1, 0.035), P(-0.25, 0.035), P(0.1, -0.035), MARK);
    this.pushTri(P(0.1, -0.035), P(-0.25, 0.035), P(-0.25, -0.035), MARK);
  }

  private buildTile(i: number, j: number, mask: number): void {
    const w = this.world;
    const k = w.index(i, j);
    const type = w.roadType[k] as RoadType || RoadType.Street;
    const R = (u0: number, v0: number, u1: number, v1: number, y: number, c: THREE.Color) => this.rect(i, j, u0, v0, u1, v1, y, c);
    const deg = [N, E, S, W].filter((d) => mask & d).length;
    const straight = deg <= 2;
    const lw = 0.025;
    const dash = (u0: number, v0: number, u1: number, v1: number, c = MARK) => R(u0, v0, u1, v1, Y_MARK, c);

    if (type === RoadType.Pedestrian) {
      R(0, 0, 1, 1, Y_WALK - 0.01, PAVING);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if ((a + b) % 2) R(a / 4 + 0.02, b / 4 + 0.02, (a + 1) / 4 - 0.02, (b + 1) / 4 - 0.02, Y_WALK - 0.005, PAVING_2);
      if (!(mask & N) && !(mask & S) || !(mask & E) && !(mask & W)) { R(0.05, 0.05, 0.17, 0.17, Y_WALK + 0.03, PLANTER); R(0.83, 0.83, 0.95, 0.95, Y_WALK + 0.03, PLANTER); }
    } else if (type === RoadType.Highway) {
      R(0, 0, 1, 1, Y_ROAD, ASPHALT_DARK);
      // Lignes de rive et glissières sur les côtés fermés
      const e = 0.07;
      if (!(mask & N)) { R(0, 0, 1, 0.05, Y_WALK, BARRIER); dash(0, e, 1, e + lw); }
      if (!(mask & S)) { R(0, 0.95, 1, 1, Y_WALK, BARRIER); dash(0, 1 - e - lw, 1, 1 - e); }
      if (!(mask & W)) { R(0, 0, 0.05, 1, Y_WALK, BARRIER); dash(e, 0, e + lw, 1); }
      if (!(mask & E)) { R(0.95, 0, 1, 1, Y_WALK, BARRIER); dash(1 - e - lw, 0, 1 - e, 1); }
      if (straight) {
        // Séparateur central et pointillés des voies
        if (mask & (N | S)) { R(0.485, mask & N ? 0 : 0.5, 0.515, mask & S ? 1 : 0.5, Y_WALK, BARRIER); for (const u of [0.26, 0.74]) { dash(u - 0.012, 0.1, u + 0.012, 0.35); dash(u - 0.012, 0.6, u + 0.012, 0.85); } }
        if (mask & (E | W)) { R(mask & W ? 0 : 0.5, 0.485, mask & E ? 1 : 0.5, 0.515, Y_WALK, BARRIER); for (const v of [0.26, 0.74]) { dash(0.1, v - 0.012, 0.35, v + 0.012); dash(0.6, v - 0.012, 0.85, v + 0.012); } }
      }
    } else {
      // Rue ou avenue : chaussée, trottoirs, bordures
      R(0, 0, 1, 1, Y_ROAD, type === RoadType.Avenue ? ASPHALT_DARK : ASPHALT);
      const a = SW, b = 1 - SW, c2 = SW * 0.25;
      R(0, 0, a, a, Y_WALK, SIDEWALK);
      R(b, 0, 1, a, Y_WALK, SIDEWALK);
      R(0, b, a, 1, Y_WALK, SIDEWALK);
      R(b, b, 1, 1, Y_WALK, SIDEWALK);
      if (!(mask & N)) { R(a, 0, b, a, Y_WALK, SIDEWALK); R(a, a, b, a + c2, Y_ROAD + 0.005, ASPHALT_EDGE); }
      if (!(mask & S)) { R(a, b, b, 1, Y_WALK, SIDEWALK); R(a, b - c2, b, b, Y_ROAD + 0.005, ASPHALT_EDGE); }
      if (!(mask & W)) { R(0, a, a, b, Y_WALK, SIDEWALK); R(a, a, a + c2, b, Y_ROAD + 0.005, ASPHALT_EDGE); }
      if (!(mask & E)) { R(b, a, 1, b, Y_WALK, SIDEWALK); R(b - c2, a, b, b, Y_ROAD + 0.005, ASPHALT_EDGE); }
      const kk = 0.02;
      if (mask & N) { R(a - kk, 0, a, a, Y_WALK + 0.002, CURB); R(b, 0, b + kk, a, Y_WALK + 0.002, CURB); }
      if (mask & S) { R(a - kk, b, a, 1, Y_WALK + 0.002, CURB); R(b, b, b + kk, 1, Y_WALK + 0.002, CURB); }
      if (mask & W) { R(0, a - kk, a, a, Y_WALK + 0.002, CURB); R(0, b, a, b + kk, Y_WALK + 0.002, CURB); }
      if (mask & E) { R(b, a - kk, 1, a, Y_WALK + 0.002, CURB); R(b, b, 1, b + kk, Y_WALK + 0.002, CURB); }

      if (straight) {
        if (type === RoadType.Avenue && !w.oneway[k]) {
          // Terre-plein central planté
          if (mask & N) R(0.46, 0, 0.54, 0.5, Y_WALK, MEDIAN);
          if (mask & S) R(0.46, 0.5, 0.54, 1, Y_WALK, MEDIAN);
          if (mask & W) R(0, 0.46, 0.5, 0.54, Y_WALK, MEDIAN);
          if (mask & E) R(0.5, 0.46, 1, 0.54, Y_WALK, MEDIAN);
        } else if (!w.oneway[k]) {
          if (mask & N) dash(0.5 - lw, 0.05, 0.5 + lw, 0.3);
          if (mask & S) dash(0.5 - lw, 0.7, 0.5 + lw, 0.95);
          if (mask & W) dash(0.05, 0.5 - lw, 0.3, 0.5 + lw);
          if (mask & E) dash(0.7, 0.5 - lw, 0.95, 0.5 + lw);
        }
      } else {
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
        if (w.lights[k] === 1 || w.lights[k] === 2) {
          // Lignes d'arrêt devant les feux
          if (mask & N) dash(0.5, 0.13, b, 0.15, MARK);
          if (mask & S) dash(a, 0.85, 0.5, 0.87, MARK);
          if (mask & W) dash(0.13, a, 0.15, 0.5, MARK);
          if (mask & E) dash(0.85, 0.5, 0.87, b, MARK);
        }
      }
    }
    if (w.oneway[k] && type !== RoadType.Pedestrian) this.arrow(i, j, w.oneway[k]);
    if (type === RoadType.Avenue && straight && w.oneway[k]) dash(0.48, 0.48, 0.52, 0.52, YELLOW);

    // Pont : piles et garde-corps au-dessus de l'eau
    if (w.isWater(i, j)) {
      const y = w.roadY(i + 0.5, j + 0.5);
      const bed = Math.min(w.heightAt(i + 0.5, j + 0.5), -0.2);
      if ((i + j) % 2 === 0) this.box(i + 0.4, bed, j + 0.4, i + 0.6, y, j + 0.6, PILLAR);
      this.box(i + 0.02, y - 0.09, j + 0.02, i + 0.98, y, j + 0.98, PILLAR); // tablier
      const r = 0.035, h = y + Y_WALK + 0.09;
      if (!(mask & N)) this.box(i, y, j, i + 1, h, j + r, RAIL);
      if (!(mask & S)) this.box(i, y, j + 1 - r, i + 1, h, j + 1, RAIL);
      if (!(mask & W)) this.box(i, y, j, i + r, h, j + 1, RAIL);
      if (!(mask & E)) this.box(i + 1 - r, y, j, i + 1, h, j + 1, RAIL);
    }
  }
}
