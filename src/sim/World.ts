import { MAP_SIZE, MAX_ROAD_SLOPE, SEA_LEVEL } from '../config';
import { fbm, rng } from '../core/noise';
import { MAX_BUILD_SLOPE, ZONE_DEPTH } from './zones';
import { SERVICE_INFO, type Service } from './services';

export const enum Tile {
  Empty = 0,
  Road = 1,
}

/** Bits de connexion d'une route vers ses voisines. */
export const N = 1, E = 2, S = 4, W = 8;

/**
 * Données du monde : relief (hauteurs aux coins des cases), occupation des cases et arbres.
 * Une case (i, j) couvre x ∈ [i, i+1], z ∈ [j, j+1]. Le nord est vers -z.
 */
export class World {
  readonly size = MAP_SIZE;
  /** Hauteurs aux coins : (size+1)² valeurs. */
  readonly heights: Float32Array;
  readonly tiles: Uint8Array;
  /** Nombre d'arbres par case (0 à 3). */
  readonly trees: Uint8Array;
  readonly seed: number;

  // Zonage et bâtiments (une case = un bâtiment)
  readonly zones: Uint8Array;
  readonly bState: Uint8Array;
  readonly bLevel: Uint8Array;
  readonly bVariant: Uint8Array;
  /** Jours restants de chantier, ou âge du bâtiment. */
  readonly bTimer: Uint16Array;
  /** Distance (en cases) jusqu'à la route la plus proche, 255 si trop loin. */
  readonly roadDist: Uint8Array;
  /** Bâtiment de service présent sur la case (Service.None sinon). */
  readonly service: Uint8Array;

  constructor(seed = 1337) {
    this.seed = seed;
    const n = this.size;
    this.heights = new Float32Array((n + 1) * (n + 1));
    this.tiles = new Uint8Array(n * n);
    this.trees = new Uint8Array(n * n);
    this.zones = new Uint8Array(n * n);
    this.bState = new Uint8Array(n * n);
    this.bLevel = new Uint8Array(n * n);
    this.bVariant = new Uint8Array(n * n);
    this.bTimer = new Uint16Array(n * n);
    this.roadDist = new Uint8Array(n * n).fill(255);
    this.service = new Uint8Array(n * n);
    this.generate();
  }

  /** Recalcule la distance aux routes (parcours en largeur sur la terre ferme). */
  computeRoadDist(): void {
    const n = this.size;
    const dist = this.roadDist;
    dist.fill(255);
    let queue: number[] = [];
    for (let k = 0; k < n * n; k++) if (this.tiles[k] === Tile.Road) { dist[k] = 0; queue.push(k); }
    for (let d = 1; d <= ZONE_DEPTH + 1 && queue.length; d++) {
      const next: number[] = [];
      for (const k of queue) {
        const i = k % n, j = (k - i) / n;
        const nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
        for (const [a, b] of nb) {
          if (!this.inBounds(a, b)) continue;
          const q = b * n + a;
          if (dist[q] !== 255 || this.isWater(a, b)) continue;
          dist[q] = d;
          next.push(q);
        }
      }
      queue = next;
    }
  }

  /** Raison pour laquelle on ne peut pas zoner la case, ou null. */
  zoneBlocker(i: number, j: number): string | null {
    if (!this.inBounds(i, j)) return 'Hors de la carte';
    if (this.isRoad(i, j)) return 'Case occupée par une route';
    if (this.service[this.index(i, j)]) return 'Case occupée par un équipement';
    if (this.isWater(i, j)) return "Impossible de zoner sur l'eau";
    const [lo, hi] = this.tileMinMax(i, j);
    if (hi - lo > MAX_BUILD_SLOPE) return 'Terrain trop pentu';
    if (this.roadDist[this.index(i, j)] > ZONE_DEPTH) return 'Trop loin d\'une route';
    return null;
  }

  /** Direction de la route la plus proche (bit N/E/S/W), pour orienter la façade. */
  facing(i: number, j: number): number {
    const order: Array<[number, number, number]> = [[i, j + 1, S], [i + 1, j, E], [i, j - 1, N], [i - 1, j, W]];
    for (const [a, b, dir] of order) if (this.isRoad(a, b)) return dir;
    const here = this.roadDist[this.index(i, j)];
    for (const [a, b, dir] of order) {
      if (this.inBounds(a, b) && this.roadDist[this.index(a, b)] < here) return dir;
    }
    return S;
  }

  // ---------- Génération ----------

  private generate(): void {
    const n = this.size;
    const s = this.seed;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        // Collines douces + quelques reliefs plus marqués
        const base = fbm(i / 48, j / 48, s);
        const hills = fbm(i / 18 + 50, j / 18 + 50, s + 7, 4);
        let h = (base - 0.42) * 6 + 1.3 + Math.max(0, hills - 0.55) * 14;

        // Rivière sinueuse qui traverse la carte
        const rz = n * 0.58 + Math.sin(i / 17) * 9 + Math.sin(i / 6.3 + 1) * 2.5;
        const d = Math.abs(j - rz);
        const width = 2.6 + fbm(i / 20, 3, s + 3, 2) * 2;
        if (d < width + 7) {
          const t = Math.max(0, (d - width) / 7); // 0 dans le lit, 1 hors des berges
          const bed = -1.4;
          const k = t * t * (3 - 2 * t);
          h = bed + (Math.max(h, 0.35) - bed) * k;
        }

        // Lac au nord-ouest
        const lx = i - n * 0.24, lz = j - n * 0.22;
        const ld = Math.sqrt(lx * lx + lz * lz) / (11 + fbm(i / 9, j / 9, s + 9, 3) * 6);
        if (ld < 1.6) h = Math.min(h, -1.6 + Math.max(0, ld - 0.6) * 2.6);

        this.heights[j * (n + 1) + i] = h;
      }
    }

    // Forêts
    const rand = rng(s + 42);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (this.isWater(i, j)) continue;
        const f = fbm(i / 14 + 200, j / 14 + 200, s + 13, 4);
        const sparse = rand() < 0.015;
        if (f > 0.56 || sparse) {
          const density = f > 0.66 ? 3 : f > 0.6 ? 2 : 1;
          this.trees[j * n + i] = rand() < 0.85 ? density : 0;
        }
      }
    }
  }

  // ---------- Requêtes ----------

  inBounds(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.size && j < this.size;
  }

  index(i: number, j: number): number {
    return j * this.size + i;
  }

  corner(i: number, j: number): number {
    return this.heights[j * (this.size + 1) + i];
  }

  /** Hauteur exacte du terrain en (x, z), cohérente avec la triangulation du maillage. */
  heightAt(x: number, z: number): number {
    const n = this.size;
    x = Math.min(Math.max(x, 0), n - 1e-4);
    z = Math.min(Math.max(z, 0), n - 1e-4);
    const i = Math.floor(x), j = Math.floor(z);
    const fx = x - i, fz = z - j;
    const a = this.corner(i, j), b = this.corner(i + 1, j);
    const c = this.corner(i, j + 1), d = this.corner(i + 1, j + 1);
    if (fx + fz < 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  tileMinMax(i: number, j: number): [number, number] {
    const h = [this.corner(i, j), this.corner(i + 1, j), this.corner(i, j + 1), this.corner(i + 1, j + 1)];
    return [Math.min(...h), Math.max(...h)];
  }

  isWater(i: number, j: number): boolean {
    return this.tileMinMax(i, j)[0] < SEA_LEVEL + 0.05;
  }

  tile(i: number, j: number): Tile {
    return this.inBounds(i, j) ? (this.tiles[this.index(i, j)] as Tile) : Tile.Empty;
  }

  isRoad(i: number, j: number): boolean {
    return this.tile(i, j) === Tile.Road;
  }

  /** Raison pour laquelle on ne peut pas poser de route, ou null si c'est possible. */
  roadBlocker(i: number, j: number): string | null {
    if (!this.inBounds(i, j)) return 'Hors de la carte';
    if (this.isWater(i, j)) return "Impossible de construire sur l'eau";
    if (this.service[this.index(i, j)]) return 'Case occupée par un équipement';
    const [lo, hi] = this.tileMinMax(i, j);
    if (hi - lo > MAX_ROAD_SLOPE) return 'Terrain trop pentu';
    return null;
  }

  /** Raison pour laquelle on ne peut pas placer cet équipement, ou null. */
  serviceBlocker(i: number, j: number, s: Service): string | null {
    if (!this.inBounds(i, j)) return 'Hors de la carte';
    const idx = this.index(i, j);
    if (this.isRoad(i, j)) return 'Case occupée par une route';
    if (this.service[idx]) return 'Case occupée par un équipement';
    if (this.isWater(i, j)) return "Impossible de construire sur l'eau";
    const [lo, hi] = this.tileMinMax(i, j);
    if (hi - lo > MAX_BUILD_SLOPE) return 'Terrain trop pentu';
    if (this.roadDist[idx] !== 1) return 'Doit toucher une route';
    if (SERVICE_INFO[s as Exclude<Service, 0>].nearWater) {
      let near = false;
      for (let b = j - 2; b <= j + 2 && !near; b++) for (let a = i - 2; a <= i + 2; a++) if (this.inBounds(a, b) && this.isWater(a, b)) { near = true; break; }
      if (!near) return "Doit être à moins de 2 cases de l'eau";
    }
    return null;
  }

  roadMask(i: number, j: number): number {
    let m = 0;
    if (this.isRoad(i, j - 1)) m |= N;
    if (this.isRoad(i + 1, j)) m |= E;
    if (this.isRoad(i, j + 1)) m |= S;
    if (this.isRoad(i - 1, j)) m |= W;
    return m;
  }

  terrainLabel(i: number, j: number): string {
    if (this.isWater(i, j)) return 'Eau';
    const [lo, hi] = this.tileMinMax(i, j);
    if (hi - lo > MAX_ROAD_SLOPE) return 'Pente raide';
    if (this.trees[this.index(i, j)]) return 'Forêt';
    if (lo < 0.5) return 'Berge';
    return 'Prairie';
  }
}
