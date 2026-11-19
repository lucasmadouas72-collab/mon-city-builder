import type { Simulation } from './Simulation';
import { SERVICE_INFO, Service } from './services';
import { BuildState, kindOf, Zone } from './zones';
import { VehicleKind, type Vehicle } from './Traffic';

/** Tonnes de déchets produites par jour par habitant et par emploi. */
const PER_RESIDENT = 0.006;
const PER_JOB = 0.004;
/** Chargement d'un camion par tournée (tonnes). */
const TRUCK_LOAD = 140;
/** Rayon d'une tournée autour de sa destination (cases). */
const TOUR_RADIUS = 6;
/** Jours de déchets tolérés avant que le bâtiment soit considéré comme non collecté. */
const OK_DAYS = 10;
const MISSION_BASE = 1_000_000;
/** Recette de revente des matériaux recyclés (€ par tonne). */
const RECYCLE_PRICE = 1.6;

export interface WasteStats {
  /** Production estimée par mois (t). */
  produced: number;
  /** Collecté, traité par filière et mis en décharge ce mois-ci (t). */
  collected: number;
  processed: Record<string, number>;
  landfilled: number;
  /** Déchets en attente de traitement dans les centres (t). */
  waiting: number;
  /** Capacité de traitement mensuelle (t). */
  capacity: number;
  landfillUsed: number;
  landfillCap: number;
  /** Bâtiments où les déchets s'accumulent. */
  accumulating: number;
  trucks: number;
  trucksBusy: number;
  saturated: boolean;
  recyclingIncome: number;
}

interface Mission { depot: number; target: number; load: number }

/**
 * Déchets (§10) : chaque bâtiment produit des déchets qui s'accumulent jusqu'au passage
 * d'un camion de collecte. Les camions partent des centres, suivent les routes, ramassent
 * autour de leur destination puis reviennent. Les centres trient, recyclent, compostent
 * ou incinèrent selon leur capacité ; le reste part en décharge, qui finit par être pleine.
 */
export class Waste {
  readonly garbage: Float32Array;
  /** Remplissage de chaque décharge (case → tonnes). */
  landfill = new Map<number, number>();
  /** Déchets collectés en attente de traitement. */
  pool = 0;
  private missions = new Map<number, Mission>();
  private busy = new Map<number, number>();
  private targeted = new Set<number>();
  private nextMission = 1;
  private month = { collected: 0, landfilled: 0, processed: {} as Record<string, number>, recycled: 0 };
  /** Bonus de rendement agricole apporté par le compost (0 à 0,08). */
  compostBoost = 0;
  stats: WasteStats = {
    produced: 0, collected: 0, processed: {}, landfilled: 0, waiting: 0, capacity: 0, landfillUsed: 0, landfillCap: 0,
    accumulating: 0, trucks: 0, trucksBusy: 0, saturated: false, recyclingIncome: 0,
  };
  private rand = Math.random;

  constructor(private sim: Simulation) {
    this.garbage = new Float32Array(sim.world.size * sim.world.size);
  }

  /** Production quotidienne d'un bâtiment (t). */
  dailyOf(k: number): number {
    const c = this.sim.society.citizens;
    const z = this.sim.world.zones[k];
    const less = (this.sim.districts.has(k, 'recycling') ? 0.2 : 0) + this.sim.council.mod('garbage');
    return (c.residents[k] * PER_RESIDENT + c.employees[k] * PER_JOB * (kindOf(z) === Zone.Industrial ? 1.6 : 1)) * Math.max(0.3, 1 - less);
  }

  /** Niveau d'accumulation en jours de production. */
  level(k: number): number {
    const d = this.dailyOf(k);
    return d > 0 ? this.garbage[k] / d : 0;
  }

  isCollected(k: number): boolean {
    return this.level(k) < OK_DAYS;
  }

  private facilities(): number[] {
    const w = this.sim.world, out: number[] = [];
    for (let k = 0; k < w.service.length; k++) if (w.service[k] && SERVICE_INFO[w.service[k] as Exclude<Service, 0>].waste) out.push(k);
    return out;
  }

  daily(): void {
    const sim = this.sim, w = sim.world, n = w.size;
    // 1. Production
    let produced = 0, accumulating = 0;
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) { this.garbage[k] = 0; continue; }
      const d = this.dailyOf(k);
      produced += d;
      this.garbage[k] = Math.min(this.garbage[k] + d, d * 60 + 1);
      if (d > 0 && this.garbage[k] / d >= OK_DAYS) accumulating++;
    }
    const fac = this.facilities();
    const bud = sim.budgets.utilities / 100;
    // 2. Traitement : centres de tri, recyclage, compostage, incinération, puis décharge
    let capacity = 0, burnCap = 0, burned = 0;
    for (const k of fac) {
      const info = SERVICE_INFO[w.service[k] as Exclude<Service, 0>];
      if (!info.treatment || sim.disasters.offline.has(k)) continue;
      const cap = (info.treatment * bud) / 30;
      capacity += info.treatment * bud;
      const done = Math.min(this.pool, cap);
      this.pool -= done;
      const key = info.waste!;
      this.month.processed[key] = (this.month.processed[key] ?? 0) + done;
      if (key === 'recycling') this.month.recycled += done;
      if (key === 'incineration') { burnCap += cap; burned += done; }
    }
    let landfillCap = 0, landfillUsed = 0;
    for (const k of fac) {
      if (w.service[k] !== Service.LandfillSite) continue;
      const cap = SERVICE_INFO[Service.LandfillSite].storage!;
      const used = this.landfill.get(k) ?? 0;
      const take = Math.min(this.pool, cap - used);
      if (take > 0) { this.landfill.set(k, used + take); this.pool -= take; this.month.landfilled += take; }
      landfillCap += cap;
      landfillUsed += this.landfill.get(k) ?? 0;
    }
    for (const k of [...this.landfill.keys()]) if (w.service[k] !== Service.LandfillSite) this.landfill.delete(k);
    sim.utilities.wasteBurn = burnCap ? burned / burnCap : 0;
    const saturated = this.pool > Math.max(200, produced * 12);
    // 3. Départ des camions vers les quartiers les plus sales
    let trucks = 0;
    for (const depot of fac) {
      const info = SERVICE_INFO[w.service[depot] as Exclude<Service, 0>];
      if (!info.trucks || sim.disasters.offline.has(depot)) continue;
      const fleet = Math.max(1, Math.round(info.trucks * bud));
      trucks += fleet;
      // Tous les camions libres partent en tournée
      for (let t = this.busy.get(depot) ?? 0; t < fleet && !saturated; t++) if (!this.dispatch(depot, n)) break;
    }
    let busy = 0;
    for (const v of this.busy.values()) busy += v;
    this.stats = {
      produced: Math.round(produced * 30), collected: Math.round(this.month.collected), processed: Object.fromEntries(Object.entries(this.month.processed).map(([k, v]) => [k, Math.round(v)])),
      landfilled: Math.round(this.month.landfilled), waiting: Math.round(this.pool), capacity: Math.round(capacity), landfillUsed: Math.round(landfillUsed), landfillCap,
      accumulating, trucks, trucksBusy: busy, saturated, recyclingIncome: Math.round(this.month.recycled * RECYCLE_PRICE),
    };
  }

  /** Bilan mensuel : recettes du recyclage et bonus du compost. Renvoie la recette. */
  monthly(): number {
    const income = this.month.recycled * RECYCLE_PRICE;
    this.compostBoost = Math.min(0.08, (this.month.processed.compost ?? 0) / 10000);
    this.month = { collected: 0, landfilled: 0, processed: {}, recycled: 0 };
    this.targeted = new Set([...this.missions.values()].map((m) => m.target));
    return income;
  }

  private dispatch(depot: number, n: number): boolean {
    const sim = this.sim, w = sim.world, ut = sim.utilities, traffic = sim.traffic;
    const net = ut.networkOf(depot);
    const from = traffic.roadAccess(depot);
    if (net < 0 || from < 0) return false;
    const di = depot % n, dj = Math.floor(depot / n);
    // Cherche, parmi quelques bâtiments tirés au hasard, celui qui a le plus de déchets
    let best = -1, bestScore = 0;
    for (let s = 0; s < 60; s++) {
      const k = Math.floor(this.rand() * w.bState.length);
      if (w.bState[k] !== BuildState.Built || this.targeted.has(k)) continue;
      const dist = Math.hypot((k % n) - di, Math.floor(k / n) - dj);
      if (dist > 45 || ut.networkOf(k) !== net) continue;
      const score = this.level(k) * (1 + this.garbage[k]) / (1 + dist * 0.02);
      if (score > bestScore) { bestScore = score; best = k; }
    }
    if (best < 0 || this.level(best) < 2) return false;
    const to = traffic.roadAccess(best);
    if (to < 0 || to === from) { this.pool += this.collect(best, TRUCK_LOAD); return false; }
    const path = traffic.findPath(from, to);
    if (!path || path.length < 2) { this.targeted.add(best); return false; }
    const id = MISSION_BASE + this.nextMission++;
    this.missions.set(id, { depot, target: best, load: 0 });
    this.targeted.add(best);
    this.busy.set(depot, (this.busy.get(depot) ?? 0) + 1);
    traffic.addMissionVehicle(path, VehicleKind.Garbage, id);
    return true;
  }

  /** Ramasse les déchets des bâtiments autour d'une case ; renvoie le tonnage. */
  private collect(target: number, max: number): number {
    const w = this.sim.world, n = w.size;
    const i0 = target % n, j0 = Math.floor(target / n);
    let load = 0;
    for (let r = 0; r <= TOUR_RADIUS && load < max; r++) {
      for (let j = j0 - r; j <= j0 + r && load < max; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || !w.inBounds(i, j)) continue;
        const k = j * n + i;
        if (!this.garbage[k]) continue;
        const take = Math.min(this.garbage[k], max - load);
        this.garbage[k] -= take;
        load += take;
        if (load >= max) break;
      }
    }
    this.month.collected += load;
    return load;
  }

  /** Mission d'un camion de collecte ? */
  owns(v: Vehicle): boolean {
    return Math.abs(v.mission) >= MISSION_BASE;
  }

  /** Arrivée d'un camion : collecte puis retour, ou déchargement au centre. */
  onArrive(v: Vehicle): void {
    const sim = this.sim, traffic = sim.traffic;
    if (v.mission > 0) {
      const m = this.missions.get(v.mission);
      if (!m) return;
      this.targeted.delete(m.target);
      m.load = this.collect(m.target, TRUCK_LOAD);
      const a = traffic.roadAccess(m.target), b = traffic.roadAccess(m.depot);
      const back = a >= 0 && b >= 0 ? traffic.findPath(a, b) : null;
      if (back && back.length > 1) { traffic.addMissionVehicle(back, VehicleKind.Garbage, -v.mission); return; }
      this.unload(v.mission);
    } else this.unload(-v.mission);
  }

  private unload(id: number): void {
    const m = this.missions.get(id);
    if (!m) return;
    this.missions.delete(id);
    this.pool += m.load;
    this.busy.set(m.depot, Math.max(0, (this.busy.get(m.depot) ?? 1) - 1));
  }

  serialize(): Record<string, unknown> {
    const g: number[] = [];
    for (let k = 0; k < this.garbage.length; k++) if (this.garbage[k] > 0.05) g.push(k, Math.round(this.garbage[k] * 10) / 10);
    return { pool: Math.round(this.pool), landfill: [...this.landfill], garbage: g };
  }

  restore(d: { pool?: number; landfill?: Array<[number, number]>; garbage?: number[] } | undefined): void {
    if (!d) return;
    this.pool = d.pool ?? 0;
    this.landfill = new Map(d.landfill ?? []);
    const g = d.garbage ?? [];
    for (let i = 0; i + 1 < g.length; i += 2) this.garbage[g[i]] = g[i + 1];
  }
}
