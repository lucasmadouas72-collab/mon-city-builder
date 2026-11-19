import { rng } from '../core/noise';
import type { World } from './World';
import { BuildState, Zone } from './zones';

/**
 * Trafic : chaque véhicule fait un vrai trajet (domicile → travail, courses, livraisons)
 * sur le graphe des routes, calculé par A*. Conduite à droite, virages lissés,
 * distance de sécurité avec le véhicule de devant et priorité aux carrefours.
 */

export const enum VehicleKind {
  Car = 0,
  Truck = 1,
}

const LANE = 0.17; // décalage de la voie par rapport à l'axe de la route
const CAR_SPEED = 1.9; // cases par seconde à vitesse 1
const TRUCK_SPEED = 1.4;
const MAX_VEHICLES = 1500;
const SAFE_GAP = 0.3;
const MAX_ASTAR = 8000;

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  color: number;
  path: number[];
  seg: number;
  t: number;
  speed: number;
  maxSpeed: number;
  /** Position et direction courantes (calculées à chaque pas). */
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Courbe du segment courant : entrée, contrôle, sortie. */
  c: [number, number, number, number, number, number];
  len: number;
  wait: number;
  /** Carrefour actuellement réservé par le véhicule (-1 si aucun). */
  holding: number;
  age: number;
}

interface WeightedList {
  tiles: number[];
  cumulative: number[];
  total: number;
}

const emptyList = (): WeightedList => ({ tiles: [], cumulative: [], total: 0 });

const CAR_COLORS = [0xe8e8e8, 0x2b2f36, 0xc0392b, 0x2e6fb7, 0xe1b12c, 0x7f8c8d, 0x1e8449, 0xf0ece2, 0x8e44ad, 0xd35400];
const TRUCK_COLORS = [0xf2f2ee, 0xe67e22, 0x3d6f8f, 0xc8a24a];

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() { return this.items.length; }
  push(item: number, p: number) {
    const a = this.items, q = this.prio;
    a.push(item); q.push(p);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (q[parent] <= q[k]) break;
      [a[parent], a[k]] = [a[k], a[parent]];
      [q[parent], q[k]] = [q[k], q[parent]];
      k = parent;
    }
  }
  pop(): number {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastI = a.pop()!, lastP = q.pop()!;
    if (a.length) {
      a[0] = lastI; q[0] = lastP;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        [q[m], q[k]] = [q[k], q[m]];
        k = m;
      }
    }
    return top;
  }
}

export class Traffic {
  vehicles: Vehicle[] = [];
  /** Densité moyenne de véhicules par case de route (moyenne glissante). */
  readonly density: Float32Array;
  /** Statistiques. */
  tripsCompleted = 0;
  tripsFailed = 0;
  flow = 1;

  private nextId = 1;
  private rand = rng(4242);
  private homes = emptyList();
  private jobs = emptyList();
  private shops = emptyList();
  private factories = emptyList();
  private occupants = new Map<number, Map<number, number>>(); // carrefour → (id véhicule → direction d'entrée)
  private buckets = new Map<number, Vehicle[]>();
  private spawnBudget = 0;
  // Tampons A*
  private gScore: Float32Array;
  private cameFrom: Int32Array;
  private visitStamp: Uint32Array;
  private stamp = 1;

  constructor(private world: World) {
    const n = world.size * world.size;
    this.density = new Float32Array(n);
    this.gScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.visitStamp = new Uint32Array(n);
  }

  // ---------- Bâtiments sources et destinations ----------

  refreshBuildings(capacity: (idx: number) => number): void {
    const w = this.world;
    const lists = { h: emptyList(), j: emptyList(), s: emptyList(), f: emptyList() };
    const add = (l: WeightedList, idx: number, weight: number) => {
      l.total += weight;
      l.tiles.push(idx);
      l.cumulative.push(l.total);
    };
    for (let idx = 0; idx < w.bState.length; idx++) {
      if (w.bState[idx] !== BuildState.Built) continue;
      const cap = capacity(idx);
      const z = w.zones[idx];
      if (z === Zone.Residential) add(lists.h, idx, cap);
      else {
        add(lists.j, idx, cap);
        if (z === Zone.Commercial) add(lists.s, idx, cap);
        if (z === Zone.Industrial) add(lists.f, idx, cap);
      }
    }
    this.homes = lists.h; this.jobs = lists.j; this.shops = lists.s; this.factories = lists.f;
  }

  private pickWeighted(l: WeightedList): number {
    if (!l.total) return -1;
    const r = this.rand() * l.total;
    let lo = 0, hi = l.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (l.cumulative[mid] < r) lo = mid + 1; else hi = mid;
    }
    return l.tiles[lo];
  }

  /** Case de route la plus proche d'un bâtiment (en suivant la distance décroissante). */
  roadAccess(idx: number): number {
    const w = this.world;
    let cur = idx;
    for (let step = 0; step < 6; step++) {
      const i = cur % w.size, j = (cur - i) / w.size;
      if (w.isRoad(i, j)) return cur;
      let best = -1, bestD = w.roadDist[cur];
      for (const [a, b] of [[i, j + 1], [i + 1, j], [i, j - 1], [i - 1, j]]) {
        if (!w.inBounds(a, b)) continue;
        const k = w.index(a, b);
        if (w.roadDist[k] < bestD) { bestD = w.roadDist[k]; best = k; }
      }
      if (best < 0) return -1;
      cur = best;
    }
    return -1;
  }

  // ---------- Itinéraires ----------

  /** A* sur les cases de route, pénalisé par la congestion. */
  findPath(from: number, to: number): number[] | null {
    if (from === to) return null;
    const w = this.world;
    const n = w.size;
    const stamp = ++this.stamp;
    const g = this.gScore, came = this.cameFrom, seen = this.visitStamp;
    const ti = to % n, tj = (to - ti) / n;
    const open = new MinHeap();
    g[from] = 0; came[from] = -1; seen[from] = stamp;
    open.push(from, 0);
    let expansions = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === to) {
        const path: number[] = [];
        for (let k = to; k !== -1; k = came[k]) path.push(k);
        return path.reverse();
      }
      if (++expansions > MAX_ASTAR) return null;
      const ci = cur % n, cj = (cur - ci) / n;
      const gc = g[cur];
      for (let d = 0; d < 4; d++) {
        const a = ci + (d === 1 ? 1 : d === 3 ? -1 : 0);
        const b = cj + (d === 2 ? 1 : d === 0 ? -1 : 0);
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const k = b * n + a;
        if (w.tiles[k] !== 1) continue;
        const cost = gc + 1 + Math.min(this.density[k], 6) * 0.6;
        if (seen[k] === stamp && cost >= g[k]) continue;
        seen[k] = stamp;
        g[k] = cost;
        came[k] = cur;
        open.push(k, cost + Math.abs(a - ti) + Math.abs(b - tj));
      }
    }
    return null;
  }

  // ---------- Création des trajets ----------

  targetVehicles(population: number, jobs: number): number {
    return Math.min(MAX_VEHICLES, Math.round(population * 0.12 + jobs * 0.04));
  }

  private spawn(): boolean {
    const r = this.rand();
    let from: number, to: number, kind = VehicleKind.Car;
    if (r < 0.14 && this.factories.total && this.shops.total) {
      from = this.pickWeighted(this.factories);
      to = this.pickWeighted(this.shops);
      kind = VehicleKind.Truck;
    } else {
      from = this.pickWeighted(this.homes);
      to = this.pickWeighted(r < 0.4 && this.shops.total ? this.shops : this.jobs);
      // Une partie des trajets se fait dans l'autre sens (retour au domicile)
      if (this.rand() < 0.45) [from, to] = [to, from];
    }
    if (from < 0 || to < 0) return false;
    const a = this.roadAccess(from), b = this.roadAccess(to);
    if (a < 0 || b < 0) return false;
    const path = this.findPath(a, b);
    if (!path || path.length < 2) {
      if (a !== b) this.tripsFailed++;
      return false;
    }
    const v: Vehicle = {
      id: this.nextId++, kind,
      color: kind === VehicleKind.Truck ? TRUCK_COLORS[Math.floor(this.rand() * TRUCK_COLORS.length)] : CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)],
      path, seg: 0, t: 0, speed: 0,
      maxSpeed: (kind === VehicleKind.Truck ? TRUCK_SPEED : CAR_SPEED) * (0.9 + this.rand() * 0.2),
      x: 0, z: 0, hx: 1, hz: 0, c: [0, 0, 0, 0, 0, 0], len: 1, wait: 0, holding: -1, age: 0,
    };
    this.setupSegment(v);
    this.place(v);
    this.vehicles.push(v);
    return true;
  }

  // ---------- Géométrie des trajectoires ----------

  private dir(a: number, b: number): [number, number] {
    const n = this.world.size;
    const ai = a % n, bi = b % n;
    return [bi - ai, (b - bi) / n - (a - ai) / n];
  }

  private setupSegment(v: Vehicle): void {
    const n = this.world.size;
    const p = v.path, k = v.seg;
    const cur = p[k];
    const ci = cur % n, cj = (cur - ci) / n;
    const cx = ci + 0.5, cz = cj + 0.5;
    const dIn = k > 0 ? this.dir(p[k - 1], cur) : this.dir(cur, p[k + 1]);
    const dOut = k < p.length - 1 ? this.dir(cur, p[k + 1]) : dIn;
    // Voie de droite : droite de (dx, dz) = (-dz, dx)
    const ex = k > 0 ? cx - dIn[0] * 0.5 - dIn[1] * LANE : cx - dIn[1] * LANE;
    const ez = k > 0 ? cz - dIn[1] * 0.5 + dIn[0] * LANE : cz + dIn[0] * LANE;
    const ox = k < p.length - 1 ? cx + dOut[0] * 0.5 - dOut[1] * LANE : cx - dOut[1] * LANE;
    const oz = k < p.length - 1 ? cz + dOut[1] * 0.5 + dOut[0] * LANE : cz + dOut[0] * LANE;
    let mx: number, mz: number;
    if (dIn[0] === dOut[0] && dIn[1] === dOut[1]) {
      mx = (ex + ox) / 2; mz = (ez + oz) / 2;
    } else {
      // Point de contrôle à l'intersection des deux voies (virage arrondi)
      const s = (ox - ex) * dIn[0] + (oz - ez) * dIn[1];
      mx = ex + dIn[0] * s; mz = ez + dIn[1] * s;
    }
    v.c = [ex, ez, mx, mz, ox, oz];
    const chord = Math.hypot(ox - ex, oz - ez);
    v.len = Math.max(0.05, (chord + Math.hypot(mx - ex, mz - ez) + Math.hypot(ox - mx, oz - mz)) / 2);
  }

  private place(v: Vehicle): void {
    const [ax, az, bx, bz, cx, cz] = v.c;
    const t = v.t, u = 1 - t;
    v.x = u * u * ax + 2 * u * t * bx + t * t * cx;
    v.z = u * u * az + 2 * u * t * bz + t * t * cz;
    let hx = 2 * u * (bx - ax) + 2 * t * (cx - bx);
    let hz = 2 * u * (bz - az) + 2 * t * (cz - bz);
    const l = Math.hypot(hx, hz);
    if (l > 1e-5) { hx /= l; hz /= l; v.hx = hx; v.hz = hz; }
  }

  // ---------- Carrefours ----------

  private isJunction(tile: number): boolean {
    const w = this.world, n = w.size;
    const i = tile % n, j = (tile - i) / n;
    let deg = 0;
    if (w.isRoad(i + 1, j)) deg++;
    if (w.isRoad(i - 1, j)) deg++;
    if (w.isRoad(i, j + 1)) deg++;
    if (w.isRoad(i, j - 1)) deg++;
    return deg >= 3;
  }

  /** Un véhicule peut entrer dans le carrefour s'il est libre ou occupé par des véhicules venant du même côté. */
  private canEnter(tile: number, entryDir: number): boolean {
    const occ = this.occupants.get(tile);
    if (!occ || occ.size === 0) return true;
    for (const d of occ.values()) if (d !== entryDir) return false;
    return occ.size < 3;
  }

  private release(v: Vehicle): void {
    if (v.holding >= 0) {
      this.occupants.get(v.holding)?.delete(v.id);
      v.holding = -1;
    }
  }

  // ---------- Mise à jour ----------

  /** Supprime les véhicules dont l'itinéraire passe par une route disparue. */
  validate(): void {
    const w = this.world;
    this.vehicles = this.vehicles.filter((v) => {
      for (let k = v.seg; k < v.path.length; k++) {
        if (w.tiles[v.path[k]] !== 1) { this.release(v); return false; }
      }
      return true;
    });
  }

  update(dt: number, target: number): void {
    if (dt <= 0) return;
    // Création progressive de nouveaux trajets
    if (this.vehicles.length < target) {
      this.spawnBudget += dt * (4 + target * 0.08);
      let tries = 0;
      while (this.spawnBudget >= 1 && this.vehicles.length < target && tries++ < 6) {
        this.spawnBudget -= 1;
        this.spawn();
      }
      this.spawnBudget = Math.min(this.spawnBudget, 3);
    }

    // Répartition spatiale pour la détection du véhicule de devant
    this.buckets.clear();
    for (const v of this.vehicles) {
      const tile = v.path[v.seg];
      let b = this.buckets.get(tile);
      if (!b) this.buckets.set(tile, (b = []));
      b.push(v);
    }

    let speedSum = 0;
    const survivors: Vehicle[] = [];
    for (const v of this.vehicles) {
      v.age += dt;
      // Distance au véhicule de devant (même sens, sur la case courante ou la suivante)
      let gap = Infinity;
      const near = [this.buckets.get(v.path[v.seg]), v.seg + 1 < v.path.length ? this.buckets.get(v.path[v.seg + 1]) : undefined];
      for (const list of near) {
        if (!list) continue;
        for (const o of list) {
          if (o === v) continue;
          const dx = o.x - v.x, dz = o.z - v.z;
          const ahead = dx * v.hx + dz * v.hz;
          if (ahead <= 0) continue;
          const lateral = Math.abs(-dx * v.hz + dz * v.hx);
          if (lateral > 0.13) continue;
          const align = o.hx * v.hx + o.hz * v.hz;
          if (align < 0.6) continue; // sens opposé, perpendiculaire ou en plein virage croisé
          // Deux véhicules qui se voient mutuellement devant : le plus récent cède
          if (align < 0.98 && dx * o.hx + dz * o.hz < 0 && o.id > v.id) continue;
          if (ahead < gap) gap = ahead;
        }
      }
      let targetSpeed = v.maxSpeed;
      const len = v.kind === VehicleKind.Truck ? 0.34 : 0.24;
      if (gap < Infinity) targetSpeed *= Math.max(0, Math.min(1, (gap - len) / SAFE_GAP));

      // Priorité au carrefour suivant
      const remaining = (1 - v.t) * v.len;
      const next = v.seg + 1 < v.path.length ? v.path[v.seg + 1] : -1;
      let stopAt = Infinity;
      if (next >= 0 && remaining < 0.4 && v.holding !== next && this.isJunction(next)) {
        const d = this.dir(v.path[v.seg], next);
        const entry = d[0] + d[1] * 3;
        if (!this.canEnter(next, entry) && v.wait < 2.5) {
          stopAt = Math.max(0, remaining - 0.02);
          targetSpeed = Math.min(targetSpeed, v.maxSpeed * Math.max(0, stopAt / 0.3));
          if (stopAt < 0.05) v.wait += dt;
        }
      }

      // Accélération / freinage
      const accel = targetSpeed > v.speed ? 2.5 : 8;
      v.speed += Math.max(-accel * dt, Math.min(accel * dt, targetSpeed - v.speed));
      if (v.speed < 0.01 && targetSpeed === 0) v.speed = 0;

      // Avancée sur la courbe, passage aux cases suivantes
      let move = Math.min(v.speed * dt, stopAt);
      let alive = true;
      while (move > 0) {
        const left = (1 - v.t) * v.len;
        if (move < left) { v.t += move / v.len; break; }
        move -= left;
        if (v.seg >= v.path.length - 1) { alive = false; break; }
        const prevTile = v.path[v.seg];
        v.seg++;
        v.t = 0;
        v.wait = 0;
        const tile = v.path[v.seg];
        if (v.holding >= 0 && v.holding !== tile) this.release(v);
        if (this.isJunction(tile)) {
          const d = this.dir(prevTile, tile);
          let occ = this.occupants.get(tile);
          if (!occ) this.occupants.set(tile, (occ = new Map()));
          occ.set(v.id, d[0] + d[1] * 3);
          v.holding = tile;
        }
        this.setupSegment(v);
      }
      if (!alive || v.age > 240) {
        this.release(v);
        if (alive) this.tripsFailed++; else this.tripsCompleted++;
        continue;
      }
      this.place(v);
      speedSum += v.speed / v.maxSpeed;
      survivors.push(v);
    }
    this.vehicles = survivors;
    this.flow = survivors.length ? speedSum / survivors.length : 1;

    // Densité par case (moyenne glissante)
    const k = Math.min(1, dt * 0.8);
    for (let idx = 0; idx < this.density.length; idx++) {
      if (this.density[idx] > 0.001) this.density[idx] *= 1 - k;
      else this.density[idx] = 0;
    }
    for (const [tile, list] of this.buckets) this.density[tile] += list.length * k;
  }
}
