import type { World } from './World';
import { computeReach, ROAD_SERVICES, type FacilityLoad, type ReachStats } from './ServiceReach';
import { BuildState, Zone, hasHomes, kindOf, zoneInfo } from './zones';
import {
  CONSUMPTION, Coverage, SERVICE_INFO, Service, Utility, type BudgetKey,
} from './services';

const hash01 = (idx: number, salt: number) => {
  let h = Math.imul(idx ^ (salt * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface PowerStats { production: Record<string, number>; consumption: number; losses: number; imported: number; exported: number; deficit: number; overloaded: number; substations: number }
export interface WaterStats { captage: number; treated: number; storage: number; storageCap: number; consumption: number; imported: number; fromStorage: number; deficit: number; lowPressure: number }
export interface SewageStats { collected: number; capacity: number; overflow: number }

export interface UtilityStats {
  power: PowerStats;
  water: WaterStats;
  sewage: SewageStats;
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
  private gridSpare = new Map<number, number>();
  /** Part de la demande couverte, par réseau électrique et par réseau d'eau [eau, égouts]. */
  gridRatio = new Map<number, number>();
  netRatio = new Map<number, [number, number]>();
  /** Remplissage des châteaux d'eau (case → unités). */
  storage = new Map<number, number>();
  /** Charge et capacité des sous-stations. */
  substations = new Map<number, [number, number]>();
  /** Bâtiments desservis par une sous-station en surcharge, ou en basse pression d'eau. */
  readonly overload: Uint8Array;
  readonly lowPressure: Uint8Array;
  /** Bilan des réseaux d'eau (pour le stockage quotidien). */
  private lastWater = new Map<number, { balance: number; towers: number[] }>();
  /** Achats et ventes autorisés aux villes voisines. */
  policy = { importPower: true, exportPower: true, importWater: true };
  /** Ensoleillement, débit des cours d'eau et niveau des nappes (0 à ~1,2), fournis par l'environnement. */
  solarFactor = 0.7;
  hydroFactor = 1;
  waterFactor = 1;
  /** Charge de l'incinérateur (0 à 1), fournie par la gestion des déchets. */
  wasteBurn = 0;
  /** Les déchets du bâtiment sont-ils collectés, et quel est leur niveau (jours de production) ? */
  garbageOk: (idx: number) => boolean = () => true;
  garbageLevel: (idx: number) => number = () => 0;
  /** Bonheur ajouté par les politiques de quartier, et effet des politiques sur les pollutions. */
  districtHappiness: (idx: number) => number = () => 0;
  afterPollution: (air: Float32Array, noise: Float32Array, light: Float32Array) => void = () => {};

  /** Rendement d'un équipement selon son état d'entretien (100 % au-dessus de 50 % d'état). */
  conditionFactor(idx: number): number {
    const c = this.world.condition[idx];
    return c >= 50 ? 1 : 0.5 + c / 100;
  }

  /** Chaque jour : les châteaux d'eau se remplissent avec le surplus ou se vident pendant les pénuries. */
  daily(): void {
    for (const { balance, towers } of this.lastWater.values()) {
      if (!towers.length) continue;
      const cap = SERVICE_INFO[Service.WaterTower].storage!;
      const per = (balance * 0.2) / towers.length;
      for (const t of towers) this.storage.set(t, Math.max(0, Math.min(cap, (this.storage.get(t) ?? 0) + per)));
    }
  }
  /** Facteur de budget par poste (0.5 à 1.5). */
  budget: (key: BudgetKey) => number = () => 1;
  /** Ajustement global du bonheur (impôts…). */
  happinessOffset = 0;
  /** Équipements en panne (catastrophe). */
  offline: Map<number, number> = new Map();
  /** Production des éoliennes selon le vent. */
  windFactor = 1;
  /** Part d'élèves et de malades dans la population (fournie par la démographie). */
  studentsOf: (idx: number) => number = () => 0;
  sickOf: (idx: number) => number = () => 0;
  /** Occupation de chaque école ou clinique, et bilan global. */
  loads = new Map<number, FacilityLoad>();
  reach: ReachStats = { students: 0, seats: 0, unschooled: 0, patients: 0, beds: 0, untreated: 0 };
  /** Risque de délinquance par case (0 à 1), calculé par la simulation. */
  readonly crime: Float32Array = new Float32Array(0);
  /** Multiplicateurs de consommation (saison, météo). */
  consumptionMul = [1, 1, 1, 1];
  stats: UtilityStats = {
    power: { production: {}, consumption: 0, losses: 0, imported: 0, exported: 0, deficit: 0, overloaded: 0, substations: 0 },
    water: { captage: 0, treated: 0, storage: 0, storageCap: 0, consumption: 0, imported: 0, fromStorage: 0, deficit: 0, lowPressure: 0 },
    sewage: { collected: 0, capacity: 0, overflow: 0 },
    supply: [0, 0, 0, 0], demand: [0, 0, 0, 0], served: [0, 0, 0, 0], happiness: 0, coverage: {}, burning: 0, air: 0, noise: 0 };

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
    this.overload = new Uint8Array(n);
    this.lowPressure = new Uint8Array(n);
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
        const p = zoneInfo(w.zones[idx])?.pollution, lvl = w.bLevel[idx];
        if (p) {
          if (p.air) splat(air, i, j, 0.07 * lvl * p.air, 5);
          if (p.noise >= 1) splat(noise, i, j, 0.06 * Math.min(1.2, p.noise) * (kindOf(w.zones[idx]) === Zone.Industrial ? 1 : 0.42 * lvl), kindOf(w.zones[idx]) === Zone.Industrial ? 3 : 2);
          else if (p.noise) splat(noise, i, j, 0.025 * lvl * p.noise, 2);
        }
      }
      const s = w.service[idx];
      if (s === Service.PowerPlant) splat(air, i, j, 0.35, 8);
      else if (s === Service.Landfill) splat(air, i, j, 0.12, 4);
      else if (s === Service.Incinerator) splat(air, i, j, 0.22, 7);
      else if (s === Service.LandfillSite) { splat(air, i, j, 0.15, 5); splat(noise, i, j, 0.04, 3); }
      else if (s === Service.Composting) splat(air, i, j, 0.05, 3);
      else if (s === Service.Airport) { splat(noise, i + 2, j + 1, 0.4, 10); splat(air, i + 2, j + 1, 0.06, 6); }
      else if (s === Service.Harbor) { splat(noise, i + 1, j, 0.15, 5); splat(air, i + 1, j, 0.05, 4); }
      else if (s === Service.TrainStation) splat(noise, i, j, 0.05, 3);
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
        const p = zoneInfo(w.zones[idx])?.pollution, lvl = w.bLevel[idx];
        if (!(this.served[idx] & (1 << Utility.Sewage))) splatWater(i, j, 0.03 * lvl, 9);
        if (p?.water) splatWater(i, j, 0.05 * lvl * p.water, 4);
        if (p && p.light >= 0.5) splat(light, i, j, 0.05 * lvl * Math.min(1.5, p.light), 3);
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
    this.afterPollution(air, noise, this.light);
  }

  /** Une station de pompage proche d'une eau polluée distribue une eau contaminée sur son réseau. */
  private computeContamination(treatedShare: Map<number, number>): void {
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
      // Sans traitement, une pollution plus faible suffit à contaminer l'eau
      const ts = treatedShare.get(net) ?? 0;
      if (worst > 0.3 + ts * 0.4 || (ts < 0.5 && worst > 0.15)) e[0] += 1 - ts * 0.85;
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
    return this.missing(idx).length === 0;
  }

  /** Le réseau de cette case dispose-t-il d'au moins un équipement pour chaque ressource ? */
  missing(idx: number): Utility[] {
    const net = this.networkOf(idx), g = this.powerGridOf(idx);
    const s = net >= 0 ? this.spare.get(net) : undefined;
    const out: Utility[] = [];
    if (g < 0 || !((this.gridSpare.get(g) ?? 0) > 0)) out.push(Utility.Power);
    if (!s || s[Utility.Water] <= 0) out.push(Utility.Water);
    return out;
  }

  hasUtility(idx: number, u: Utility): boolean {
    return (this.served[idx] & (1 << u)) !== 0;
  }

  // ---------- Réseau électrique : routes + lignes haute tension ----------

  /** Identifiant du réseau électrique de chaque case de route ou de ligne (-1 sinon). */
  private gridOf: Int32Array = new Int32Array(0);

  private buildGrids(): void {
    const w = this.world, n = w.size, N = n * n;
    const parent = new Int32Array(N);
    for (let k = 0; k < N; k++) parent[k] = k;
    const find = (k: number): number => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    // Chaque réseau routier connexe forme un réseau électrique (câbles le long des routes)
    const rootOfComp = new Map<number, number>();
    for (let k = 0; k < N; k++) {
      if (w.tiles[k] !== 1) continue;
      const c = this.component[k];
      const r = rootOfComp.get(c);
      if (r === undefined) rootOfComp.set(c, k); else union(k, r);
    }
    // Les lignes haute tension relient les réseaux entre eux et aux centrales isolées
    for (let k = 0; k < N; k++) {
      if (!w.powerLine[k]) continue;
      const i = k % n, j = (k - i) / n;
      if (w.tiles[k] === 1) union(k, k);
      for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) {
        if (!w.inBounds(a, b) || (a === i && b === j)) continue;
        const q = b * n + a;
        if (w.powerLine[q]) union(k, q);
        else if (w.tiles[q] === 1 && (a === i || b === j)) union(k, q);
      }
    }
    // Équipements touchant une ligne : reliés à la fois à la ligne et à leur route
    for (let k = 0; k < N; k++) {
      if (!w.service[k]) continue;
      const line = this.lineNear(k);
      const road = this.access(k);
      if (line >= 0 && road >= 0) union(line, road);
    }
    const g = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) if (w.tiles[k] === 1 || w.powerLine[k]) g[k] = find(k);
    this.gridOf = g;
  }

  /** Case de ligne haute tension voisine d'une case (-1 si aucune). */
  private lineNear(k: number): number {
    const w = this.world, n = w.size, i = k % n, j = (k - i) / n;
    for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) if (w.inBounds(a, b) && w.powerLine[b * n + a]) return b * n + a;
    return -1;
  }

  /** Réseau électrique d'un bâtiment ou équipement (-1 si aucun). */
  powerGridOf(idx: number): number {
    const line = this.world.service[idx] ? this.lineNear(idx) : -1;
    if (line >= 0) return this.gridOf[line];
    const a = this.access(idx);
    return a >= 0 ? this.gridOf[a] : -1;
  }

  compute(): void {
    const w = this.world, n = w.size;
    this.labelComponents();
    this.buildGrids();

    const totalSupply = [0, 0, 0, 0];
    this.coverage.fill(0);
    this.nuisance.fill(0);
    const PS = { thermal: 0, nuclear: 0, solar: 0, hydro: 0, wind: 0, waste: 0, import: 0 } as Record<string, number>;
    // Sources électriques (centrales et sous-stations) par réseau
    const gridSupply = new Map<number, number>();
    const gridSources = new Map<number, Array<{ i: number; j: number; k: number; cap: number }>>();
    const interPower = new Map<number, number>();
    const waterNet = new Map<number, { captage: number; treat: number; demand: number; imp: number; sewCap: number; sewDem: number; towers: number[]; inter: number; sources: number[] }>();
    const wn = (net: number) => { let v = waterNet.get(net); if (!v) waterNet.set(net, (v = { captage: 0, treat: 0, demand: 0, imp: 0, sewCap: 0, sewDem: 0, towers: [], inter: 0, sources: [] })); return v; };
    const add = <K,>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    const potential = w.energyPotential();
    for (let idx = 0; idx < w.service.length; idx++) {
      const s = w.service[idx] as Service;
      if (!s) continue;
      const info = SERVICE_INFO[s as Exclude<Service, Service.None>];
      const i = idx % n, j = (idx - i) / n;
      const off = (this.offline.has(idx) ? 0 : 1) * this.conditionFactor(idx);
      const bud = this.budget(info.budget);
      if (info.utility === Utility.Power) {
        const src = info.powerSource ?? 'thermal';
        const f = src === 'wind' ? this.windFactor * (0.6 + potential.wind * 0.5)
          : src === 'solar' ? this.solarFactor * (0.5 + potential.solar * 0.6)
          : src === 'hydro' ? this.hydroFactor * (0.5 + potential.hydro * 0.5)
          : src === 'waste' ? this.wasteBurn : 1;
        const cap = info.capacity! * Math.min(1.2, bud) * off * f;
        PS[src] += cap;
        totalSupply[Utility.Power] += cap;
        const g = this.powerGridOf(idx);
        if (g >= 0) {
          add(gridSupply, g, cap);
          let l = gridSources.get(g); if (!l) gridSources.set(g, (l = []));
          l.push({ i, j, k: idx, cap: Infinity });
        }
      } else if (info.utility !== undefined) {
        const net = this.networkOf(idx);
        const cap = info.capacity! * bud * off * (info.utility === Utility.Water ? this.waterFactor : 1);
        if (info.utility !== Utility.Garbage) totalSupply[info.utility] += cap;
        if (net >= 0 && info.utility === Utility.Water) { wn(net).captage += cap; wn(net).sources.push(idx); }
        if (net >= 0 && info.utility === Utility.Sewage) wn(net).sewCap += cap;
      }
      if (s === Service.Substation) {
        const g = this.powerGridOf(idx);
        if (g >= 0) { let l = gridSources.get(g); if (!l) gridSources.set(g, (l = [])); l.push({ i, j, k: idx, cap: info.treatment! * bud * off }); }
      }
      if (s === Service.Interconnect && off) {
        const g = this.powerGridOf(idx);
        if (g >= 0) add(interPower, g, 3000);
        const net = this.networkOf(idx);
        if (net >= 0) { wn(net).inter += 2000; wn(net).sources.push(idx); }
      }
      if (s === Service.WaterTreatment) { const net = this.networkOf(idx); if (net >= 0) wn(net).treat += info.treatment! * bud * off; }
      if (s === Service.WaterTower) {
        const net = this.networkOf(idx);
        if (!this.storage.has(idx)) this.storage.set(idx, info.storage! * 0.5);
        if (net >= 0) { wn(net).towers.push(idx); wn(net).sources.push(idx); }
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
    // Les châteaux d'eau inexistants sont oubliés
    for (const t of [...this.storage.keys()]) if (w.service[t] !== Service.WaterTower) this.storage.delete(t);

    // Santé, éducation, police, pompiers : portée par la route et capacités réelles
    const reach = computeReach(w, this.access, this.capacity, (svc) => this.budget(SERVICE_INFO[svc as Exclude<Service, 0>].budget),
      this.trafficDensity, this.studentsOf, this.sickOf, this.coverage);
    this.loads = reach.loads;
    this.reach = reach.stats;

    // Consommation, pertes en ligne et charge des sous-stations
    const N = w.bState.length;
    const bGrid = new Int32Array(N).fill(-1), bNet = new Int32Array(N).fill(-1), bSub = new Int32Array(N).fill(-1);
    const powDem = new Float32Array(N);
    const subLoad = new Map<number, number>();
    const totalDemand = [0, 0, 0, 0];
    let consumption = 0, losses = 0;
    for (let idx = 0; idx < N; idx++) {
      if (w.bState[idx] !== BuildState.Built) continue;
      const cap = this.capacity(idx);
      const net = this.networkOf(idx);
      const g = this.powerGridOf(idx);
      bNet[idx] = net; bGrid[idx] = g;
      const pc = cap * CONSUMPTION[Utility.Power] * this.consumptionMul[Utility.Power];
      const wc = cap * CONSUMPTION[Utility.Water] * this.consumptionMul[Utility.Water];
      const sc = cap * CONSUMPTION[Utility.Sewage] * this.consumptionMul[Utility.Sewage];
      totalDemand[Utility.Water] += wc; totalDemand[Utility.Sewage] += sc;
      if (net >= 0) { wn(net).demand += wc; wn(net).sewDem += sc; }
      // Pertes : 2 % près d'une centrale ou d'une sous-station, plus loin elles augmentent
      const i = idx % n, j = (idx - i) / n;
      let best = Infinity, sub = -1;
      for (const src of (g >= 0 ? gridSources.get(g) : undefined) ?? []) {
        const d = Math.hypot(src.i - i, src.j - j);
        if (d < best) { best = d; sub = src.cap === Infinity ? -1 : src.k; }
      }
      const loss = best <= 14 ? 0.02 : Math.min(0.25, 0.02 + (Math.min(best, 200) - 14) * 0.006);
      if (best <= 14 && sub >= 0) { bSub[idx] = sub; add(subLoad, sub, pc); }
      powDem[idx] = pc * (1 + loss);
      consumption += pc;
      losses += pc * loss;
    }
    // Sous-stations en surcharge : pertes accrues pour les bâtiments qu'elles desservent
    const overloaded = new Set<number>();
    this.substations.clear();
    for (const [k, load] of subLoad) {
      const cap = SERVICE_INFO[Service.Substation].treatment! * this.budget('utilities') * (this.offline.has(k) ? 0 : 1);
      this.substations.set(k, [load, cap]);
      if (load > cap) overloaded.add(k);
    }
    for (const k of gridSources.values()) for (const s2 of k) if (s2.cap !== Infinity && !this.substations.has(s2.k)) this.substations.set(s2.k, [0, s2.cap]);
    const gridDemand = new Map<number, number>();
    this.overload.fill(0);
    for (let idx = 0; idx < N; idx++) {
      if (!powDem[idx]) continue;
      if (bSub[idx] >= 0 && overloaded.has(bSub[idx])) { const extra = powDem[idx] * 0.1; powDem[idx] += extra; losses += extra; this.overload[idx] = 1; }
      totalDemand[Utility.Power] += powDem[idx];
      if (bGrid[idx] >= 0) add(gridDemand, bGrid[idx], powDem[idx]);
    }
    // Achats et ventes d'électricité par les interconnexions
    let imported = 0, exported = 0, deficit = 0;
    const gridRatio = new Map<number, number>();
    const grids = new Set([...gridSupply.keys(), ...gridDemand.keys()]);
    for (const g of grids) {
      const sup = gridSupply.get(g) ?? 0, dem = gridDemand.get(g) ?? 0, inter = interPower.get(g) ?? 0;
      let eff = sup;
      if (dem > sup && inter && this.policy.importPower) { const im = Math.min(dem - sup, inter); imported += im; eff += im; }
      else if (sup > dem && inter && this.policy.exportPower) exported += Math.min(sup - dem, inter);
      if (dem > eff) deficit += dem - eff;
      gridRatio.set(g, dem ? eff / dem : 1);
    }
    PS.import = imported;

    // Eau : captage, traitement, stockage, importations ; assainissement : débordements
    let captage = 0, treated = 0, wImported = 0, wDeficit = 0, sewOverflow = 0, sewCap = 0, fromStorage = 0;
    const netRatio = new Map<number, [number, number]>();
    const treatedShare = new Map<number, number>();
    this.lastWater = new Map();
    for (const [net, v] of waterNet) {
      captage += v.captage; sewCap += v.sewCap;
      let eff = v.captage;
      if (v.demand > eff && v.inter && this.policy.importWater) { const im = Math.min(v.demand - eff, v.inter); v.imp = im; wImported += im; eff += im; }
      const stored = v.towers.reduce((a, t) => a + (this.storage.get(t) ?? 0), 0);
      const fromSt = v.demand > eff ? Math.min(stored, v.demand - eff) : 0;
      fromStorage += fromSt;
      eff += fromSt;
      if (v.demand > eff) wDeficit += v.demand - eff;
      const tr = Math.min(v.captage, v.treat);
      treated += tr;
      treatedShare.set(net, v.captage ? (tr + v.imp) / (v.captage + v.imp) : 1);
      netRatio.set(net, [v.demand ? eff / v.demand : 1, v.sewDem ? Math.min(1, v.sewCap / v.sewDem) : v.sewCap ? 1 : 0]);
      if (v.sewDem > v.sewCap) sewOverflow += v.sewDem - v.sewCap;
      this.lastWater.set(net, { balance: v.captage + v.imp - v.demand, towers: v.towers });
    }

    // Marge disponible pour de nouveaux bâtiments
    this.gridSpare.clear();
    for (const g of grids) this.gridSpare.set(g, (gridSupply.get(g) ?? 0) + (this.policy.importPower ? interPower.get(g) ?? 0 : 0) - (gridDemand.get(g) ?? 0));
    this.spare.clear();
    for (const [net, v] of waterNet) this.spare.set(net, [0, v.captage + (this.policy.importWater ? v.inter : 0) - v.demand, 0, 0]);
    this.gridRatio = gridRatio;
    this.netRatio = netRatio;

    this.computePollution();
    this.computeContamination(treatedShare);

    // Distribution : si la production manque, une partie des bâtiments n'est pas desservie
    const servedCount = [0, 0, 0, 0];
    let buildings = 0, happySum = 0, happyWeight = 0, lowPressure = 0;
    const covCount: Record<number, number> = {};
    for (const c of [Coverage.Health, Coverage.Education, Coverage.Police, Coverage.Fire, Coverage.Park, Coverage.Leisure]) covCount[c] = 0;
    this.lowPressure.fill(0);
    for (let idx = 0; idx < N; idx++) {
      this.served[idx] = 0;
      if (w.bState[idx] !== BuildState.Built) { this.happiness[idx] = 0; continue; }
      buildings++;
      const g = bGrid[idx], net = bNet[idx];
      const pr = g >= 0 && gridSupply.has(g) || (g >= 0 && interPower.has(g) && this.policy.importPower) ? gridRatio.get(g) ?? 0 : 0;
      const wr = net >= 0 ? netRatio.get(net) : undefined;
      const ratios = [pr, wr?.[0] ?? 0, wr?.[1] ?? 0];
      for (let u = 0; u < 3; u++) {
        const ratio = Math.min(1, ratios[u]);
        if (ratio <= 0) continue;
        if (ratio >= 1 || hash01(idx, u + 1) < ratio) { this.served[idx] |= 1 << u; servedCount[u]++; }
      }
      if (this.garbageOk(idx)) { this.served[idx] |= 1 << Utility.Garbage; servedCount[Utility.Garbage]++; }
      // Pression : il faut une station de pompage ou un château d'eau assez proche
      if (this.served[idx] & (1 << Utility.Water)) {
        const i = idx % n, j = (idx - i) / n;
        let best = Infinity;
        for (const s2 of waterNet.get(net)?.sources ?? []) best = Math.min(best, Math.hypot((s2 % n) - i, Math.floor(s2 / n) - j));
        const tall = w.bLevel[idx] >= 3 || (w.zones[idx] === Zone.ResidentialHigh) || (w.zones[idx] === Zone.Office && w.bLevel[idx] >= 2);
        if (best > (tall ? 16 : 26)) { this.lowPressure[idx] = 1; lowPressure++; }
      }
      const cov = this.coverage[idx];
      for (const c in covCount) if (cov & Number(c)) covCount[c]++;

      // Bonheur
      const s = this.served[idx];
      let h = 0.45;
      h += s & (1 << Utility.Power) ? 0.08 : -0.25;
      h += s & (1 << Utility.Water) ? 0.08 : -0.25;
      h += s & (1 << Utility.Sewage) ? 0.06 : -0.06;
      h += s & (1 << Utility.Garbage) ? 0.05 : -0.05 - Math.min(0.1, this.garbageLevel(idx) * 0.02);
      if (this.lowPressure[idx]) h -= 0.04;
      if (this.overload[idx]) h -= 0.02;
      if (cov & Coverage.Health) h += 0.07;
      if (cov & Coverage.Education) h += 0.06;
      if (cov & Coverage.Police) h += 0.06;
      if (cov & Coverage.Fire) h += 0.04;
      if (cov & Coverage.Park) h += 0.07;
      if (cov & Coverage.Leisure) h += 0.05;
      h -= this.nuisance[idx];
      h -= Math.min(0.35, this.air[idx] * 0.45 + this.noise[idx] * 0.25);
      h -= this.crime[idx] * 0.18;
      if (this.contaminated[idx]) h -= 0.12;
      h -= w.soilPol[idx] * 0.12 + (hasHomes(w.zones[idx]) ? this.light[idx] * 0.05 : 0);
      if (w.bDamage[idx]) h -= w.bDamage[idx] / 400;
      h += this.happinessOffset + this.districtHappiness(idx);
      if (this.fire[idx]) h -= 0.3;
      h = Math.max(0, Math.min(1, h));
      this.happiness[idx] = h;
      const weight = hasHomes(w.zones[idx]) ? this.capacity(idx) : this.capacity(idx) * 0.3;
      happySum += h * weight;
      happyWeight += weight;
    }

    const coverage: Record<number, number> = {};
    for (const c in covCount) coverage[c] = buildings ? covCount[c] / buildings : 0;
    let burning = 0, airSum = 0, noiseSum = 0;
    for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Built) { airSum += this.air[k]; noiseSum += this.noise[k]; }
    for (let k = 0; k < this.fire.length; k++) if (this.fire[k]) burning++;
    totalSupply[Utility.Water] += wImported;
    this.stats = {
      power: { production: Object.fromEntries(Object.entries(PS).map(([k, v]) => [k, Math.round(v)])), consumption: Math.round(consumption), losses: Math.round(losses), imported: Math.round(imported), exported: Math.round(exported), deficit: Math.round(deficit), overloaded: overloaded.size, substations: this.substations.size },
      water: { captage: Math.round(captage), treated: Math.round(treated), storage: Math.round([...this.storage.values()].reduce((a, b) => a + b, 0)), storageCap: this.storage.size * (SERVICE_INFO[Service.WaterTower].storage ?? 0), consumption: Math.round(totalDemand[Utility.Water]), imported: Math.round(wImported), fromStorage: Math.round(fromStorage), deficit: Math.round(wDeficit), lowPressure },
      sewage: { collected: Math.round(totalDemand[Utility.Sewage]), capacity: Math.round(sewCap), overflow: Math.round(sewOverflow) },
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
