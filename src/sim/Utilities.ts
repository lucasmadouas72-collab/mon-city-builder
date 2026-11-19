import type { World } from './World';
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
  /** Réseau routier connexe de chaque case de route (-1 sinon). */
  private component: Int32Array;
  private spare: Map<number, number[]> = new Map();
  /** Facteur de budget par poste (0.5 à 1.5). */
  budget: (key: BudgetKey) => number = () => 1;
  /** Ajustement global du bonheur (impôts…). */
  happinessOffset = 0;
  stats: UtilityStats = { supply: [0, 0, 0, 0], demand: [0, 0, 0, 0], served: [0, 0, 0, 0], happiness: 0, coverage: {}, burning: 0 };

  constructor(private world: World, private access: (idx: number) => number, private capacity: (idx: number) => number) {
    const n = world.size * world.size;
    this.served = new Uint8Array(n);
    this.coverage = new Uint8Array(n);
    this.nuisance = new Float32Array(n);
    this.happiness = new Float32Array(n);
    this.problemDays = new Uint16Array(n);
    this.fire = new Uint8Array(n);
    this.component = new Int32Array(n);
  }

  private labelComponents(): void {
    const w = this.world, n = w.size;
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
        const i = cur % n, j = (cur - i) / n;
        if (i + 1 < n && w.tiles[cur + 1] === 1 && comp[cur + 1] === -1) { comp[cur + 1] = label; stack.push(cur + 1); }
        if (i > 0 && w.tiles[cur - 1] === 1 && comp[cur - 1] === -1) { comp[cur - 1] = label; stack.push(cur - 1); }
        if (j + 1 < n && w.tiles[cur + n] === 1 && comp[cur + n] === -1) { comp[cur + n] = label; stack.push(cur + n); }
        if (j > 0 && w.tiles[cur - n] === 1 && comp[cur - n] === -1) { comp[cur - n] = label; stack.push(cur - n); }
      }
      label++;
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
        const cap = info.capacity! * this.budget(info.budget);
        if (net >= 0) get(supply, net)[info.utility] += cap;
        totalSupply[info.utility] += cap;
      }
      if (info.coverage && info.radius) {
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

    // Consommation par réseau
    const buildingNet = new Int32Array(w.bState.length).fill(-1);
    const totalDemand = [0, 0, 0, 0];
    for (let idx = 0; idx < w.bState.length; idx++) {
      if (w.bState[idx] !== BuildState.Built) continue;
      const net = this.networkOf(idx);
      buildingNet[idx] = net;
      const cap = this.capacity(idx);
      for (const u of UTILITIES) {
        totalDemand[u] += cap * CONSUMPTION[u];
        if (net >= 0) get(demand, net)[u] += cap * CONSUMPTION[u];
      }
    }

    this.spare.clear();
    for (const [net, sup] of supply) {
      const dem = demand.get(net) ?? [0, 0, 0, 0];
      this.spare.set(net, sup.map((s, u) => s - dem[u]));
    }

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
    let burning = 0;
    for (let k = 0; k < this.fire.length; k++) if (this.fire[k]) burning++;
    this.stats = {
      supply: totalSupply.map(Math.round),
      demand: totalDemand.map(Math.round),
      served: servedCount.map((c) => (buildings ? c / buildings : 1)),
      happiness: happyWeight ? happySum / happyWeight : 0,
      coverage,
      burning,
    };
  }
}
