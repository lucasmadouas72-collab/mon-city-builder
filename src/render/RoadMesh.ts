import * as THREE from 'three';
import type { World } from '../sim/World';
import { DIRS8, RoadType } from '../sim/roads';

const C = (h: string) => new THREE.Color(h);
const ASPHALT = C('#41454c');
const ASPHALT_DARK = C('#34373d');
const SIDEWALK = C('#c4bfb4');
const CURB = C('#9d988e');
const MARK = C('#f4f1e8');
const YELLOW = C('#e8c547');
const MEDIAN = C('#6f9c47');
const BARRIER = C('#b9b6ae');
const PAVING = C('#cdbf9f');
const PAVING_2 = C('#bfae8a');
const PILLAR = C('#a8a49a');
const RAIL = C('#8a8f96');

const Y_ROAD = 0.035;
const Y_WALK = 0.075;
const Y_MARK = 0.046;
const STEPS = 6; // points par case le long de la courbe

type P2 = [number, number];

interface Sample {
  x: number;
  z: number;
  /** Normale (vers la droite du sens de parcours). */
  nx: number;
  nz: number;
  /** Distance cumulée depuis le début de la chaîne. */
  s: number;
  /** Distance au carrefour le plus proche (début ou fin de chaîne). */
  dj: number;
  water: boolean;
}

/**
 * Chaussées dessinées comme des rubans lisses qui passent par les cases reliées
 * (droites, diagonales et courbes). Les véhicules suivent exactement la même géométrie.
 */
export class RoadMesh {
  readonly mesh: THREE.Mesh;
  private pos: number[] = [];
  private col: number[] = [];

  constructor(private world: World) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'roads';
    this.rebuild();
  }

  // ---------- Primitives ----------

  private tri(a: number[], b: number[], c: number[], col: THREE.Color): void {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) this.col.push(col.r, col.g, col.b);
  }

  private quad(a: number[], b: number[], c: number[], d: number[], col: THREE.Color): void {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  private y(x: number, z: number, lift: number): number {
    return this.world.roadY(x, z) + lift;
  }

  /** Disque (carrefour, impasse) plaqué sur la chaussée. */
  private disc(cx: number, cz: number, r: number, lift: number, col: THREE.Color, seg = 16): void {
    const c = [cx, this.y(cx, cz, lift), cz];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.tri(c, [x0, this.y(x0, z0, lift), z0], [x1, this.y(x1, z1, lift), z1], col);
    }
  }

  private box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color): void {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, b, d, e] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) this.quad(v[a], v[b], v[d], v[e], c);
  }

  /** Bande parallèle à l'axe, entre les décalages o0 et o1, pour les échantillons [i0, i1]. */
  private band(S: Sample[], o0: number, o1: number, lift: number, col: THREE.Color, keep?: (s: Sample) => boolean): void {
    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], b = S[k + 1];
      if (keep && !(keep(a) && keep(b))) continue;
      const P = (s: Sample, o: number) => { const x = s.x + s.nx * o, z = s.z + s.nz * o; return [x, this.y(x, z, lift), z]; };
      this.quad(P(a, o0), P(a, o1), P(b, o1), P(b, o0), col);
    }
  }

  /** Paroi verticale le long d'un bord (garde-corps, tablier de pont). */
  private wall(S: Sample[], o: number, y0: number, y1: number, col: THREE.Color, keep: (s: Sample) => boolean): void {
    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], b = S[k + 1];
      if (!keep(a) || !keep(b)) continue;
      const ax = a.x + a.nx * o, az = a.z + a.nz * o, bx = b.x + b.nx * o, bz = b.z + b.nz * o;
      const ya = this.y(ax, az, 0), yb = this.y(bx, bz, 0);
      this.quad([ax, ya + y0, az], [bx, yb + y0, bz], [bx, yb + y1, bz], [ax, ya + y1, az], col);
    }
  }

  // ---------- Construction ----------

  private center(t: number): P2 {
    const n = this.world.size;
    return [(t % n) + 0.5, Math.floor(t / n) + 0.5];
  }

  /** Les cases « nœuds » coupent les chaînes : carrefours, impasses, changement de type. */
  private isNode(t: number): boolean {
    const w = this.world;
    const nb = w.neighbors(t);
    if (nb.length !== 2) return true;
    return nb.some((q) => w.roadType[q] !== w.roadType[t]);
  }

  /** Chaînes de cases entre deux nœuds. */
  private chains(): number[][] {
    const w = this.world;
    const out: number[][] = [];
    const used = new Set<string>();
    const key = (a: number, b: number) => `${a}>${b}`;
    const walk = (start: number, first: number) => {
      const chain = [start, first];
      used.add(key(start, first)); used.add(key(first, start));
      let prev = start, cur = first;
      let guard = 0;
      while (!this.isNode(cur) && cur !== start && guard++ < 20000) {
        const next = w.neighbors(cur).find((q) => q !== prev)!;
        used.add(key(cur, next)); used.add(key(next, cur));
        chain.push(next);
        prev = cur; cur = next;
      }
      out.push(chain);
    };
    for (let t = 0; t < w.tiles.length; t++) {
      if (w.tiles[t] !== 1 || !this.isNode(t)) continue;
      for (const q of w.neighbors(t)) if (!used.has(key(t, q))) walk(t, q);
    }
    // Boucles fermées sans nœud
    for (let t = 0; t < w.tiles.length; t++) {
      if (w.tiles[t] !== 1) continue;
      for (const q of w.neighbors(t)) if (!used.has(key(t, q))) walk(t, q);
    }
    return out;
  }

  /** Axe lissé d'une chaîne : milieu des liaisons, point de contrôle au centre des cases. */
  private samples(chain: number[]): Sample[] {
    const w = this.world;
    const pts: P2[] = [];
    const C0 = chain.map((t) => this.center(t));
    const m = C0.length - 1;
    const closed = chain[0] === chain[m] && m > 1;
    pts.push(C0[0]);
    for (let k = 1; k < m; k++) {
      const a: P2 = [(C0[k - 1][0] + C0[k][0]) / 2, (C0[k - 1][1] + C0[k][1]) / 2];
      const b: P2 = [(C0[k][0] + C0[k + 1][0]) / 2, (C0[k][1] + C0[k + 1][1]) / 2];
      for (let s = 0; s < STEPS; s++) {
        const t = s / STEPS, u = 1 - t;
        pts.push([u * u * a[0] + 2 * u * t * C0[k][0] + t * t * b[0], u * u * a[1] + 2 * u * t * C0[k][1] + t * t * b[1]]);
      }
    }
    pts.push(C0[m]);
    if (closed) { pts[0] = [(C0[0][0] + C0[1][0]) / 2, (C0[0][1] + C0[1][1]) / 2]; }
    const startJ = this.isJunction(chain[0]), endJ = this.isJunction(chain[m]);
    const S: Sample[] = [];
    let s = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      if (k > 0) s += Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]);
      const ds = Math.hypot(p[0] - C0[0][0], p[1] - C0[0][1]), de = Math.hypot(p[0] - C0[m][0], p[1] - C0[m][1]);
      S.push({
        x: p[0], z: p[1], nx: -tz, nz: tx, s,
        dj: Math.min(startJ ? ds : 9, endJ ? de : 9),
        water: w.isWater(Math.floor(p[0]), Math.floor(p[1])),
      });
    }
    return S;
  }

  private isJunction(t: number): boolean {
    return this.world.linkCount(t) >= 3;
  }

  private chainType(chain: number[]): RoadType {
    const w = this.world;
    const t = chain.length > 2 ? chain[1] : chain[0];
    return (w.roadType[t] || RoadType.Street) as RoadType;
  }

  private buildChain(chain: number[]): void {
    const w = this.world;
    const S = this.samples(chain);
    const type = this.chainType(chain);
    const outside = (s: Sample) => s.dj > 0.5;
    const oneway = chain.some((t) => w.oneway[t]);

    if (type === RoadType.Pedestrian) {
      this.band(S, -0.5, 0.5, Y_WALK - 0.012, PAVING);
      this.band(S, -0.22, 0.22, Y_WALK - 0.008, PAVING_2, (s) => Math.floor(s.s * 3) % 2 === 0);
    } else if (type === RoadType.Highway) {
      this.band(S, -0.5, 0.5, Y_ROAD, ASPHALT_DARK);
      this.band(S, 0.45, 0.5, Y_WALK, BARRIER, outside);
      this.band(S, -0.5, -0.45, Y_WALK, BARRIER, outside);
      this.band(S, 0.38, 0.4, Y_MARK, MARK, outside);
      this.band(S, -0.4, -0.38, Y_MARK, MARK, outside);
      if (!oneway) this.band(S, -0.018, 0.018, Y_WALK, BARRIER, outside);
      for (const o of oneway ? [-0.2, 0, 0.2] : [-0.24, 0.24]) this.band(S, o - 0.012, o + 0.012, Y_MARK, MARK, (s) => outside(s) && Math.floor(s.s * 2.5) % 2 === 0);
    } else {
      this.band(S, -0.5, 0.5, Y_ROAD, type === RoadType.Avenue ? ASPHALT_DARK : ASPHALT);
      // Trottoirs et bordures (interrompus aux carrefours)
      this.band(S, 0.34, 0.5, Y_WALK, SIDEWALK, outside);
      this.band(S, -0.5, -0.34, Y_WALK, SIDEWALK, outside);
      this.band(S, 0.32, 0.34, Y_WALK, CURB, outside);
      this.band(S, -0.34, -0.32, Y_WALK, CURB, outside);
      if (type === RoadType.Avenue && !oneway) this.band(S, -0.045, 0.045, Y_WALK, MEDIAN, outside);
      else if (!oneway) this.band(S, -0.022, 0.022, Y_MARK, MARK, (s) => outside(s) && Math.floor(s.s * 4) % 2 === 0);
    }

    // Ponts : tablier épais et garde-corps au-dessus de l'eau
    const water = (s: Sample) => s.water;
    if (S.some(water)) {
      this.wall(S, 0.5, -0.12, Y_WALK + 0.1, RAIL, water);
      this.wall(S, -0.5, -0.12, Y_WALK + 0.1, RAIL, water);
    }
  }

  private buildNode(t: number): void {
    const w = this.world;
    const [cx, cz] = this.center(t);
    const deg = w.linkCount(t);
    const type = (w.roadType[t] || RoadType.Street) as RoadType;
    if (type === RoadType.Pedestrian) { this.disc(cx, cz, 0.5, Y_WALK - 0.011, PAVING); return; }
    const asphalt = type === RoadType.Street ? ASPHALT : ASPHALT_DARK;
    if (deg <= 1) {
      // Impasse ou case isolée : rond de chaussée bordé de trottoir
      if (type !== RoadType.Highway) this.disc(cx, cz, 0.5, Y_WALK - 0.001, SIDEWALK, 20);
      this.disc(cx, cz, type === RoadType.Highway ? 0.5 : 0.34, Y_ROAD + 0.002, asphalt, 20);
      return;
    }
    if (deg < 3) return;
    this.disc(cx, cz, 0.5, Y_ROAD + 0.001, asphalt, 20);
    // Passages piétons sur chaque branche
    if (type === RoadType.Highway) return;
    const lit = w.lights[t] === 1 || w.lights[t] === 2;
    for (let d = 0; d < 8; d++) {
      if (!(w.links[t] & (1 << d))) continue;
      let [dx, dz] = DIRS8[d];
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const px = -dz, pz = dx;
      for (let s = -0.27; s < 0.27; s += 0.11) {
        const P = (f: number, o: number) => { const x = cx + dx * f + px * o, z = cz + dz * f + pz * o; return [x, this.y(x, z, Y_MARK + 0.002), z]; };
        this.quad(P(0.4, s), P(0.4, s + 0.055), P(0.5, s + 0.055), P(0.5, s), MARK);
      }
      if (lit) {
        const P = (f: number, o: number) => { const x = cx + dx * f + px * o, z = cz + dz * f + pz * o; return [x, this.y(x, z, Y_MARK + 0.002), z]; };
        this.quad(P(0.36, 0), P(0.36, 0.3), P(0.38, 0.3), P(0.38, 0), MARK);
      }
    }
  }

  /** Flèche de sens unique au centre d'une case. */
  private arrow(t: number): void {
    const w = this.world;
    const d = w.oneway[t] - 1;
    if (d < 0) return;
    const [cx, cz] = this.center(t);
    let [dx, dz] = DIRS8[d];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const px = -dz, pz = dx;
    const P = (f: number, s: number) => { const x = cx + dx * f + px * s, z = cz + dz * f + pz * s; return [x, this.y(x, z, Y_MARK + 0.004), z]; };
    const col = w.roadType[t] === RoadType.Avenue ? YELLOW : MARK;
    this.tri(P(0.28, 0), P(0.08, 0.1), P(0.08, -0.1), col);
    this.quad(P(0.1, 0.035), P(-0.25, 0.035), P(-0.25, -0.035), P(0.1, -0.035), col);
  }

  rebuild(): void {
    this.pos = [];
    this.col = [];
    const w = this.world;
    for (const chain of this.chains()) this.buildChain(chain);
    for (let t = 0; t < w.tiles.length; t++) {
      if (w.tiles[t] !== 1) continue;
      if (this.isNode(t)) this.buildNode(t);
      if (w.oneway[t]) this.arrow(t);
      // Piles de pont
      const i = t % w.size, j = Math.floor(t / w.size);
      if (w.isWater(i, j) && (i + j) % 2 === 0) {
        const y = w.roadY(i + 0.5, j + 0.5);
        this.box(i + 0.42, Math.min(w.heightAt(i + 0.5, j + 0.5), -0.2), j + 0.42, i + 0.58, y - 0.1, j + 0.58, PILLAR);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }
}
