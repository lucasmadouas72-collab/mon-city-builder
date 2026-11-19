import type { World } from './World';
import { computeReach, ROAD_SERVICES, type FacilityLoad, type ReachStats } from './ServiceReach';
import { BuildState, Zone } from './zones';
import {
  CONSUMPTION, Coverage, SERVICE_INFO, Service, UTILITIES, Utility, type BudgetKey,
} from './services';

const hash01 = (idx: number, salt: number) => {
  let h = Math.imul(idx ^ (salt * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface UtilityStats {
  supply: number[];
  demand: number[];
  /** Part des bâtiments desservis, par ressource. */
  served: number[];
  happiness: number;
  /** Part des bâtiments couverts, par service (clé = bit Coverage). */
  coverage: Record<number, number>;
  burning: number;
  /** Pollution moyenne de l'air et du bruit sur les cases bâties (0 à 1). */
  air: number;
  noise: number;
}

/**
 * Réseaux et services. Les ressources (électricité, eau, égouts, déchets) circulent
 * par le réseau routier : chaque réseau connexe partage la production de ses équipements.
 * Les services (santé, école, police, pompiers, parcs) couvrent un rayon autour d'eux.
 */
export class Utilities {
  /** Bits (1 << Utility) des ressources reçues par chaque case bâtie. */
  readonly served: Uint8Array;
  /** Bits Coverage par case. */
  readonly coverage: Uint8Array;
  /** Nuisance des équipements (0 à ~0.4). */
  readonly nuisance: Float32Array;
  readonly happiness: Float32Array;
  readonly problemDays: Uint16Array;
  /** Jours d'incendie restants (0 = pas de feu). */
  readonly fire: Uint8Array;
  /** Pollution de l'air et sonore (0 à ~1). */
  readonly air: Float32Array;
  /** Pollution de l'eau (cases d'eau) et pollution lumineuse (nuit). */
  readonly waterPol: Float32Array = new Float32Array(0);
  readonly light: Float32Array = new Float32Array(0);
  /** Bâtiments recevant une eau contaminée. */
  readonly contaminated: Uint8Array = new Uint8Array(0);
  readonly noise: Float32Array;
  /** Densité de trafic par case (fournie par le trafic). */
  trafficDensity: Float32Array | null = null;
  /** Réseau routier connexe de chaque case de route (-1 sinon). */
  private component: Int32Array;
  private spare: Map<number, number[]> = new Map();
  /** Facteur de budget par poste (0.5 à 1.5). */
  budget: (key: BudgetKey) => number = () => 1;
  /** Ajustement global du bonheur (impôts…). */
  happinessOffset = 0;
  /** Équipements en panne (catastrophe). */
  offline: Map<number, number> = new Map();
  /** Production des éoliennes selon le vent. */
  windFactor = 1;
  /** Part d'élèves et de malades dans la population (fournie par la démographie). */
  studentShare = 0.25;
  sickShare = 0.025;
  /** Occupation de chaque école ou clinique, et bilan global. */
  loads = new Map<number, FacilityLoad>();
  reach: ReachStats = { students: 0, seats: 0, unschooled: 0, patients: 0, beds: 0, untreated: 0 };
  /** Risque de délinquance par case (0 à 1), calculé par la simulation. */
  readonly crime: Float32Array = new Float32Array(0);
  /** Multiplicateurs de consommation (saison, météo). */
  consumptionMul = [1, 1, 1, 1];
  stats: UtilityStats = { supply: [0, 0, 0, 0], demand: [0, 0, 0, 0], served: [0, 0, 0, 0], happiness: 0, coverage: {}, burning: 0, air: 0, noise: 0 };

  constructor(private world: World, private access: (idx: number) => number, private capacity: (idx: number) => number) {
    const n = world.size * world.size;
    this.served = new Uint8Array(n);
    this.coverage = new Uint8Array(n);
    this.nuisance = new Float32Array(n);
    this.happiness = new Float32Array(n);
    this.problemDays = new Uint16Array(n);
    this.fire = new Uint8Array(n);
    this.air = new Float32Array(n);
    (this as { crime: Float32Array }).crime = new Float32Array(n);
    (this as { waterPol: Float32Array }).waterPol = new Float32Array(n);
    (this as { light: Float32Array }).light = new Float32Array(n);
    (this as { contaminated: Uint8Array }).contaminated = new Uint8Array(n);
    this.noise = new Float32Array(n);
    this.component = new Int32Array(n);
  }

  private labelComponents(): void {
    const w = this.world;
    const comp = this.component;
    comp.fill(-1);
    let label = 0;
    const stack: number[] = [];
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] !== 1 || comp[k] !== -1) continue;
      comp[k] = label;
      stack.push(k);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const q of w.neighbors(cur)) {
          if (w.tiles[q] === 1 && comp[q] === -1) { comp[q] = label; stack.push(q); }
        }
      }
      label++;
    }
  }

  /** Pollution de l'air (industrie, centrales, trafic) et sonore (trafic, industrie, commerces). */
  private computePollution(): void {
    const w = this.world, n = w.size;
    const air = this.air, noise = this.noise;
    air.fill(0);
    noise.fill(0);
    const splat = (field: Float32Array, i: number, j: number, amount: number, r: number) => {
      if (amount <= 0) return;
      for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) {
        for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) {
          const d = Math.hypot(a - i, b - j);
          if (d <= r) field[b * n + a] += amount * (1 - d / (r + 1));
        }
      }
    };
    for (let idx = 0; idx < w.tiles.length; idx++) {
      const i = idx % n, j = (idx - i) / n;
      if (w.bState[idx] === BuildState.Built) {
        const z = w.zones[idx], lvl = w.bLevel[idx];
        if (z === Zone.Industrial) { splat(air, i, j, 0.07 * lvl, 5); splat(noise, i, j, 0.06, 3); }
        else if (z === Zone.Commercial) splat(noise, i, j, 0.025 * lvl, 2);
      }
      const s = w.service[idx];
      if (s === Service.PowerPlant) splat(air, i, j, 0.35, 8);
      else if (s === Service.Landfill) splat(air, i, j, 0.12, 4);
      if (w.tiles[idx] === 1 && this.trafficDensity) {
        const d = Math.min(6, this.trafficDensity[idx]);
        if (d > 0.05) { splat(noise, i, j, d * 0.05, 2); splat(air, i, j, d * 0.02, 2); }
      }
      // Les arbres et les parcs absorbent un peu de pollution
      if (w.trees[idx]) air[idx] -= 0.02 * w.trees[idx];
    }
    // Eau : rejets d'égouts non traités et industries proches, diffusés dans les cases d'eau voisines
    const wp = this.waterPol, light = this.light;
    wp.fill(0); light.fill(0);
    const splatWater = (i: number, j: number, amount: number, r: number) => {
      for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) {
        if (!w.isWater(a, b)) continue;
        const d = Math.hypot(a - i, b - j);
        if (d <= r) wp[b * n + a] += amount * (1 - d / (r + 1));
      }
    };
    for (let idx = 0; idx < w.tiles.length; idx++) {
      const i = idx % n, j = (idx - i) / n;
      if (w.bState[idx] === BuildState.Built) {
        const z = w.zones[idx], lvl = w.bLevel[idx];
        if (!(this.served[idx] & (1 << Utility.Sewage))) splatWater(i, j, 0.03 * lvl, 9);
        if (z === Zone.Industrial) splatWater(i, j, 0.05 * lvl, 4);
        if (z === Zone.Commercial || z === Zone.Office) splat(light, i, j, 0.05 * lvl, 3);
      }
      if (w.service[idx] === Service.Sewage) splatWater(i, j, 0.04, 3);
      if (w.tiles[idx] === 1 && (w.roadType[idx] === 2 || w.roadType[idx] === 3)) light[idx] += 0.04;
    }
    for (let k = 0; k < wp.length; k++) { wp[k] = Math.min(1, wp[k]); light[k] = Math.min(1, light[k]); }
    for (let k = 0; k < air.length; k++) {
      if (this.coverage[k] & Coverage.Park) { air[k] *= 0.8; noise[k] *= 0.85; }
      air[k] = Math.max(0, Math.min(1, air[k]));
      noise[k] = Math.max(0, Math.min(1, noise[k]));
    }
  }

  /** Une station de pompage proche d'une eau polluée distribue une eau contaminée sur son réseau. */
  private computeContamination(_supply: Map<number, number[]>): void {
    const w = this.world, n = w.size;
    const bad = new Map<number, [number, number]>(); // réseau -> [capacité contaminée, capacité totale]
    for (let s = 0; s < w.service.length; s++) {
      if (w.service[s] !== Service.WaterPump) continue;
      const net = this.networkOf(s);
      if (net < 0) continue;
      const i = s % n, j = (s - i) / n;
      let worst = 0;
      for (let b = j - 3; b <= j + 3; b++) for (let a = i - 3; a <= i + 3; a++) if (w.inBounds(a, b)) worst = Math.max(worst, this.waterPol[b * n + a]);
      const e = bad.get(net) ?? [0, 0];
      e[1] += 1;
      if (worst > 0.3) e[0] += 1;
      bad.set(net, e);
    }
    this.contaminated.fill(0);
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built || !(this.served[k] & (1 << Utility.Water))) continue;
      const e = bad.get(this.networkOf(k));
      if (e && e[0] && hash01(k, 9) < e[0] / e[1]) this.contaminated[k] = 1;
    }
  }

  /** Réseau routier auquel un bâtiment ou équipement est raccordé (-1 si aucun). */
  networkOf(idx: number): number {
    const a = this.access(idx);
    return a >= 0 ? this.component[a] : -1;
  }

  /** Un nouveau bâtiment peut-il s'installer ici (électricité et eau disponibles) ? */
  canGrow(idx: number): boolean {
    const net = this.networkOf(idx);
    const s = net >= 0 ? this.spare.get(net) : undefined;
    return !!s && s[Utility.Power] > 0 && s[Utility.Water] > 0;
  }

  /** Le réseau de cette case dispose-t-il d'au moins un équipement pour chaque ressource ? */
  missing(idx: number): Utility[] {
    const net = this.networkOf(idx);
    const s = net >= 0 ? this.spare.get(net) : undefined;
    return [Utility.Power, Utility.Water].filter((u) => !s || s[u] <= 0);
  }

  hasUtility(idx: number, u: Utility): boolean {
    return (this.served[idx] & (1 << u)) !== 0;
  }

  compute(): void {
    const w = this.world, n = w.size;
    this.labelComponents();

    // Production par réseau
    const supply = new Map<number, number[]>();
    const demand = new Map<number, number[]>();
    const get = (m: Map<number, number[]>, k: number) => {
      let v = m.get(k);
      if (!v) m.set(k, (v = [0, 0, 0, 0]));
      return v;
    };
    const totalSupply = [0, 0, 0, 0];
    this.coverage.fill(0);
    this.nuisance.fill(0);
    for (let idx = 0; idx < w.service.length; idx++) {
      const s = w.service[idx] as Service;
      if (!s) continue;
      const info = SERVICE_INFO[s as Exclude<Service, Service.None>];
      const i = idx % n, j = (idx - i) / n;
      if (info.utility !== undefined) {
        const net = this.networkOf(idx);
        const off = this.offline.has(idx) ? 0 : 1;
        const cap = info.capacity! * this.budget(info.budget) * off * (s === Service.WindTurbine ? this.windFactor : 1);
        if (net >= 0) get(supply, net)[info.utility] += cap;
        totalSupply[info.utility] += cap;
      }
      if (info.coverage && info.radius && !ROAD_SERVICES.includes(s)) {
        const r = Math.round(info.radius * (0.55 + 0.45 * this.budget(info.budget))), r2 = r * r;
        for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) {
          for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) {
            if ((a - i) ** 2 + (b - j) ** 2 <= r2) this.coverage[b * n + a] |= info.coverage;
          }
        }
      }
      if (info.nuisance) {
        const r = 5;
        for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r); b++) {
          for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r); a++) {
            const d = Math.hypot(a - i, b - j);
            if (d <= r) this.nuisance[b * n + a] += info.nuisance * (1 - d / r);
          }
        }
      }
    }

    // Santé, éducation, police, pompiers : portée par la route et capacités réelles
    const reach = computeReach(w, this.access, this.capacity, (svc) => this.budget(SERVICE_INFO[svc as Exclude<Service, 0>].budget),
      this.trafficDensity, this.studentShare, this.sickShare, this.coverage);
    this.loads = reach.loads;
    this.reach = reach.stats;

    // Consommation par réseau
    const buildingNet = new Int32Array(w.bState.length).fill(-1);
    const totalDemand = [0, 0, 0, 0];
    for (let idx = 0; idx < w.bState.length; idx++) {
      if (w.bState[idx] !== BuildState.Built) continue;
      const net = this.networkOf(idx);
      buildingNet[idx] = net;
      const cap = this.capacity(idx);
      for (const u of UTILITIES) {
        const c = cap * CONSUMPTION[u] * this.consumptionMul[u];
        totalDemand[u] += c;
        if (net >= 0) get(demand, net)[u] += c;
      }
    }

    this.spare.clear();
    for (const [net, sup] of supply) {
      const dem = demand.get(net) ?? [0, 0, 0, 0];
      this.spare.set(net, sup.map((s, u) => s - dem[u]));
    }

    this.computePollution();
    this.computeContamination(supply);

    // Distribution : si la production manque, une partie des bâtiments n'est pas desservie
    const servedCount = [0, 0, 0, 0];
    let buildings = 0, happySum = 0, happyWeight = 0;
    const covCount: Record<number, number> = {};
    for (const c of [Coverage.Health, Coverage.Education, Coverage.Police, Coverage.Fire, Coverage.Park]) covCount[c] = 0;
    for (let idx = 0; idx < w.bState.length; idx++) {
      this.served[idx] = 0;
      if (w.bState[idx] !== BuildState.Built) { this.happiness[idx] = 0; continue; }
      buildings++;
      const net = buildingNet[idx];
      const sup = net >= 0 ? supply.get(net) : undefined;
      const dem = net >= 0 ? demand.get(net) : undefined;
      for (const u of UTILITIES) {
        if (!sup || !dem || sup[u] <= 0) continue;
        const ratio = Math.min(1, sup[u] / Math.max(1, dem[u]));
        if (ratio >= 1 || hash01(idx, u + 1) < ratio) { this.served[idx] |= 1 << u; servedCount[u]++; }
      }
      const cov = this.coverage[idx];
      for (const c in covCount) if (cov & Number(c)) covCount[c]++;

      // Bonheur
      const s = this.served[idx];
      let h = 0.45;
      h += s & (1 << Utility.Power) ? 0.08 : -0.25;
      h += s & (1 << Utility.Water) ? 0.08 : -0.25;
      h += s & (1 << Utility.Sewage) ? 0.06 : -0.06;
      h += s & (1 << Utility.Garbage) ? 0.05 : -0.05;
      if (cov & Coverage.Health) h += 0.07;
      if (cov & Coverage.Education) h += 0.06;
      if (cov & Coverage.Police) h += 0.06;
      if (cov & Coverage.Fire) h += 0.04;
      if (cov & Coverage.Park) h += 0.07;
      h -= this.nuisance[idx];
      h -= Math.min(0.35, this.air[idx] * 0.45 + this.noise[idx] * 0.25);
      h -= this.crime[idx] * 0.18;
      if (this.contaminated[idx]) h -= 0.12;
      h -= w.soilPol[idx] * 0.12 + (w.zones[idx] === Zone.Residential ? this.light[idx] * 0.05 : 0);
      if (w.bDamage[idx]) h -= w.bDamage[idx] / 400;
      h += this.happinessOffset;
      if (this.fire[idx]) h -= 0.3;
      h = Math.max(0, Math.min(1, h));
      this.happiness[idx] = h;
      const weight = w.zones[idx] === Zone.Residential ? this.capacity(idx) : this.capacity(idx) * 0.3;
      happySum += h * weight;
      happyWeight += weight;
    }

    const coverage: Record<number, number> = {};
    for (const c in covCount) coverage[c] = buildings ? covCount[c] / buildings : 0;
    let burning = 0, airSum = 0, noiseSum = 0;
    for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Built) { airSum += this.air[k]; noiseSum += this.noise[k]; }
    for (let k = 0; k < this.fire.length; k++) if (this.fire[k]) burning++;
    this.stats = {
      supply: totalSupply.map(Math.round),
      demand: totalDemand.map(Math.round),
      served: servedCount.map((c) => (buildings ? c / buildings : 1)),
      happiness: happyWeight ? happySum / happyWeight : 0,
      coverage,
      burning,
      air: buildings ? airSum / buildings : 0,
      noise: buildings ? noiseSum / buildings : 0,
    };
  }
}
