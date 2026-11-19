import type { World } from './World';
import { BuildState, Zone } from './zones';
import { Coverage, SERVICE_INFO, Service } from './services';
import { DIRS8, ROAD_INFO, type RoadType } from './roads';

/**
 * Couverture des services calculée par la route (temps de trajet, embouteillages compris)
 * et capacité réelle des écoles et des cliniques.
 */

export interface FacilityLoad {
  used: number;
  capacity: number;
  /** Bâtiments à portée. */
  reached: number;
  /** Temps d'attente estimé (jours), cliniques seulement. */
  wait: number;
}

export interface ReachStats {
  students: number;
  seats: number;
  unschooled: number;
  patients: number;
  beds: number;
  untreated: number;
}

class Heap {
  private a: number[] = [];
  private p: number[] = [];
  get size() { return this.a.length; }
  push(v: number, pr: number) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    let k = a.length - 1;
    while (k > 0) { const q = (k - 1) >> 1; if (p[q] <= p[k]) break; [a[q], a[k]] = [a[k], a[q]]; [p[q], p[k]] = [p[k], p[q]]; k = q; }
  }
  pop(): [number, number] {
    const a = this.a, p = this.p;
    const top: [number, number] = [a[0], p[0]];
    const lv = a.pop()!, lp = p.pop()!;
    if (a.length) {
      a[0] = lv; p[0] = lp;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; [p[m], p[k]] = [p[k], p[m]]; k = m;
      }
    }
    return top;
  }
}

/** Services dont la portée suit le réseau routier (les parcs restent à distance de marche). */
export const ROAD_SERVICES = [Service.Clinic, Service.School, Service.Police, Service.FireStation];
/** Capacité par établissement (élèves ou patients). */
export const FACILITY_CAPACITY: Partial<Record<Service, number>> = { [Service.School]: 320, [Service.Clinic]: 90 };
/** Véhicules d'intervention par établissement. */
export const FACILITY_VEHICLES: Partial<Record<Service, number>> = { [Service.Clinic]: 2, [Service.Police]: 3, [Service.FireStation]: 2 };

export function computeReach(
  w: World,
  access: (idx: number) => number,
  capacity: (idx: number) => number,
  budget: (s: Service) => number,
  density: Float32Array | null,
  studentShare: number,
  sickShare: number,
  coverage: Uint8Array,
): { loads: Map<number, FacilityLoad>; stats: ReachStats } {
  const n = w.size;
  const loads = new Map<number, FacilityLoad>();
  const stats: ReachStats = { students: 0, seats: 0, unschooled: 0, patients: 0, beds: 0, untreated: 0 };

  // Accès routier de chaque bâtiment
  const buildings: number[] = [];
  const bAccess = new Map<number, number>();
  for (let k = 0; k < w.bState.length; k++) {
    if (w.bState[k] !== BuildState.Built) continue;
    const a = access(k);
    if (a < 0) continue;
    buildings.push(k);
    bAccess.set(k, a);
  }

  // Temps de trajet depuis chaque établissement (Dijkstra limité)
  const dist = new Float64Array(n * n);
  const offers = new Map<number, Array<[number, number]>>(); // bâtiment -> [(établissement, temps)]
  for (let s = 0; s < w.service.length; s++) {
    const type = w.service[s] as Service;
    if (!ROAD_SERVICES.includes(type)) continue;
    const info = SERVICE_INFO[type as Exclude<Service, 0>];
    const bf = budget(type);
    const maxT = info.radius! * (0.55 + 0.45 * bf);
    const start = access(s);
    const cap = Math.round((FACILITY_CAPACITY[type] ?? 0) * bf);
    loads.set(s, { used: 0, capacity: cap, reached: 0, wait: 0 });
    if (start < 0) continue;
    dist.fill(Infinity);
    const heap = new Heap();
    dist[start] = 0;
    heap.push(start, 0);
    const reachedRoads: number[] = [];
    while (heap.size) {
      const [cur, d] = heap.pop();
      if (d > dist[cur]) continue;
      reachedRoads.push(cur);
      const ci = cur % n, cj = (cur - ci) / n, links = w.links[cur];
      for (let k = 0; k < 8; k++) {
        if (!(links & (1 << k))) continue;
        const q = (cj + DIRS8[k][1]) * n + ci + DIRS8[k][0];
        if (!w.carsAllowed(q)) continue;
        const speed = ROAD_INFO[w.roadType[q] as RoadType]?.speed ?? 1;
        const jam = density ? 1 + Math.min(density[q], 6) * 0.12 : 1;
        const nd = d + ((k % 2 ? 1.414 : 1) / speed) * jam;
        if (nd < dist[q] && nd <= maxT) { dist[q] = nd; heap.push(q, nd); }
      }
    }
    const bit = info.coverage!;
    const load = loads.get(s)!;
    for (const b of buildings) {
      const a = bAccess.get(b)!;
      const t = dist[a] + w.roadDist[b] * 0.5;
      if (!(t <= maxT)) continue;
      load.reached++;
      if (bit === Coverage.Police || bit === Coverage.Fire) coverage[b] |= bit;
      else {
        let l = offers.get(b);
        if (!l) offers.set(b, (l = []));
        l.push([s, t]);
      }
    }
    void reachedRoads;
  }

  // Affectation des élèves et des patients à l'établissement le plus proche qui a de la place
  const assign = (type: Service, bit: Coverage, demandOf: (b: number) => number, kind: 'school' | 'clinic') => {
    const list = buildings
      .filter((b) => w.zones[b] === Zone.Residential)
      .map((b) => ({ b, need: demandOf(b), opts: (offers.get(b) ?? []).filter(([s]) => w.service[s] === type).sort((x, y) => x[1] - y[1]) }))
      .sort((x, y) => (x.opts[0]?.[1] ?? 99) - (y.opts[0]?.[1] ?? 99));
    for (const { b, need, opts } of list) {
      let left = need;
      for (const [s] of opts) {
        if (left <= 0) break;
        const L = loads.get(s)!;
        const take = Math.min(left, Math.max(0, L.capacity - L.used));
        L.used += take;
        left -= take;
      }
      if (kind === 'school') { stats.students += need; stats.unschooled += left; }
      else { stats.patients += need; stats.untreated += left; }
      if (need <= 0 || left <= need * 0.5) coverage[b] |= bit;
    }
  };
  assign(Service.School, Coverage.Education, (b) => capacity(b) * studentShare, 'school');
  assign(Service.Clinic, Coverage.Health, (b) => capacity(b) * sickShare, 'clinic');
  for (const [s, L] of loads) {
    const type = w.service[s];
    if (type === Service.School) stats.seats += L.capacity;
    if (type === Service.Clinic) { stats.beds += L.capacity; L.wait = L.capacity ? Math.max(0.5, (L.used / L.capacity) ** 3 * 6) : 0; }
  }
  stats.students = Math.round(stats.students); stats.unschooled = Math.round(stats.unschooled);
  stats.patients = Math.round(stats.patients); stats.untreated = Math.round(stats.untreated);
  for (const L of loads.values()) L.used = Math.round(L.used);
  return { loads, stats };
}
