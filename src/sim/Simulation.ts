import {
  ROAD_COST, ROAD_REFUND, ROAD_UPKEEP_MONTH, SECONDS_PER_DAY, SIM_STEP, SPEEDS, START_MONEY, TREE_CLEAR_COST,
} from '../config';
import { Emitter, type GameEvents } from '../core/Events';
import { rng } from '../core/noise';
import { Tile, World } from './World';
import { Traffic } from './Traffic';
import { Utilities } from './Utilities';
import { ABANDON_DAYS, Coverage, SERVICE_INFO, Service, Utility } from './services';
import { BuildState, Zone, ZONE_DEPTH, ZONE_INFO, type ZoneType } from './zones';

const DAYS_PER_MONTH = 30;
const MODEL_VARIANTS = 4;

export interface CostEstimate {
  cost: number;
  valid: number[];
  invalid: number[];
  reason: string | null;
}

export interface CityStats {
  population: number;
  jobs: Record<ZoneType, number>;
  totalJobs: number;
  workers: number;
  buildings: number;
  /** Demande par zone, dans [-1, 1]. */
  demand: Record<ZoneType, number>;
  income: number;
  expenses: number;
}

const zeroByZone = (): Record<ZoneType, number> => ({ [Zone.Residential]: 0, [Zone.Commercial]: 0, [Zone.Industrial]: 0, [Zone.Office]: 0 });
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

/** État de la partie et règles du jeu. Ne dépend pas du rendu. */
export class Simulation {
  readonly events = new Emitter<GameEvents>();
  readonly world: World;
  money = START_MONEY;
  speedIndex = 1;
  /** Jours écoulés depuis le début de la partie. */
  dayCount = 0;
  roadCount = 0;
  stats: CityStats = {
    population: 0, jobs: zeroByZone(), totalJobs: 0, workers: 0, buildings: 0,
    demand: zeroByZone(), income: 0, expenses: 0,
  };

  private dayProgress = 0;
  private accumulator = 0;
  private rand = rng(9001);
  /** Cases zonées (cache reconstruit quand le zonage change). */
  private zoned: number[] = [];
  private zonedDirty = true;

  readonly traffic: Traffic;
  readonly utilities: Utilities;
  private lastUtilityHint = -999;

  constructor(world: World) {
    this.world = world;
    this.traffic = new Traffic(world);
    this.utilities = new Utilities(world, (idx) => this.traffic.roadAccess(idx), (idx) => this.capacity(idx));
    this.recomputeStats();
  }

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  setSpeed(index: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    this.events.emit('speedChanged', this.speedIndex);
  }

  get date() {
    const month = Math.floor(this.dayCount / DAYS_PER_MONTH);
    return { day: (this.dayCount % DAYS_PER_MONTH) + 1, month: month % 12, year: 1 + Math.floor(month / 12) };
  }

  isUnlocked(zone: ZoneType): boolean {
    return this.stats.population >= ZONE_INFO[zone].unlockPop;
  }

  /** Avance la simulation d'un temps réel dt (s), par pas fixes. */
  update(dt: number): void {
    const scaled = Math.min(dt, 0.1) * this.speed;
    // Trafic : pas variable (mouvement fluide), découpé pour rester stable en vitesse rapide
    const sub = Math.ceil(scaled / 0.05);
    const target = this.traffic.targetVehicles(this.stats.population, this.stats.totalJobs);
    for (let k = 0; k < sub; k++) this.traffic.update(scaled / sub, target);
    this.accumulator += Math.min(dt, 0.25) * this.speed;
    while (this.accumulator >= SIM_STEP) {
      this.accumulator -= SIM_STEP;
      this.tick(SIM_STEP);
    }
  }

  private tick(step: number): void {
    this.dayProgress += step / SECONDS_PER_DAY;
    while (this.dayProgress >= 1) {
      this.dayProgress -= 1;
      this.dayCount++;
      this.onNewDay();
      if (this.dayCount % DAYS_PER_MONTH === 0) this.onNewMonth();
      this.events.emit('dateChanged', this.date);
    }
  }

  // ---------- Croissance de la ville ----------

  private onNewDay(): void {
    const w = this.world;
    const changed: number[] = [];

    // Avancement des chantiers
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] === BuildState.Construction) {
        if (w.bTimer[idx] > 0) w.bTimer[idx]--;
        if (w.bTimer[idx] === 0) {
          w.bState[idx] = BuildState.Built;
          changed.push(idx);
        }
      } else if (w.bState[idx] === BuildState.Built && w.bTimer[idx] < 65535) {
        w.bTimer[idx]++;
      }
    }

    const ut = this.utilities;
    let blockedByUtilities = -1;
    // Bâtiments sans électricité ou sans eau : abandonnés au bout d'un moment. Incendies.
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] !== BuildState.Built) continue;
      if (!ut.hasUtility(idx, Utility.Power) || !ut.hasUtility(idx, Utility.Water)) {
        if (++ut.problemDays[idx] >= ABANDON_DAYS) {
          this.clearBuilding(idx);
          changed.push(idx);
          continue;
        }
      } else ut.problemDays[idx] = 0;
      const covered = (ut.coverage[idx] & Coverage.Fire) !== 0;
      if (ut.fire[idx]) {
        ut.fire[idx]--;
        if (covered && ut.fire[idx] > 0 && this.rand() < 0.45) ut.fire[idx] = 0; // les pompiers éteignent
        if (ut.fire[idx] === 0 && !covered) {
          this.clearBuilding(idx);
          changed.push(idx);
          this.events.emit('notify', { text: 'Un bâtiment a brûlé (pas de caserne à proximité)', kind: 'warn' });
        }
        if (!ut.fire[idx]) this.events.emit('firesChanged', undefined);
      } else if (this.rand() < (covered ? 0.00004 : 0.00022) * w.bLevel[idx]) {
        ut.fire[idx] = 8;
        this.events.emit('firesChanged', undefined);
      }
    }

    const tiles = this.zonedTiles();
    if (tiles.length) {
      const d = this.stats.demand;
      const samples = Math.min(tiles.length, 6 + Math.floor(tiles.length * 0.02));
      for (let s = 0; s < samples; s++) {
        const idx = tiles[Math.floor(this.rand() * tiles.length)];
        const zone = w.zones[idx] as ZoneType;
        const demand = d[zone];
        const access = w.roadDist[idx] <= ZONE_DEPTH;
        const state = w.bState[idx];

        if (state === BuildState.Empty) {
          if (access && demand > 0 && this.isUnlocked(zone) && this.rand() < 0.08 + demand * 0.35) {
            if (this.utilities.canGrow(idx)) {
              this.startConstruction(idx, 1);
              changed.push(idx);
            } else blockedByUtilities = idx;
          }
        } else if (state === BuildState.Built) {
          if (!access) {
            // Plus d'accès routier : le bâtiment est abandonné puis rasé
            this.clearBuilding(idx);
            changed.push(idx);
          } else if (demand < -0.55 && this.rand() < 0.04) {
            this.clearBuilding(idx);
            changed.push(idx);
          } else if (w.bLevel[idx] < 3 && w.bTimer[idx] > 40 && demand > 0.15 && this.canUpgrade(idx) && this.rand() < 0.12) {
            this.startConstruction(idx, w.bLevel[idx] + 1);
            changed.push(idx);
          }
        }
      }
    }

    if (blockedByUtilities >= 0 && this.dayCount - this.lastUtilityHint > 40) {
      this.lastUtilityHint = this.dayCount;
      const miss = ut.missing(blockedByUtilities).map((u) => (u === Utility.Power ? "d'électricité" : "d'eau"));
      const text = miss.length
        ? `Les bâtiments ne poussent pas : il manque ${miss.join(' et ')} (menu Réseaux)`
        : 'Production insuffisante : ajoutez des équipements (menu Réseaux)';
      this.events.emit('notify', { text, kind: 'warn' });
    }

    if (changed.length) {
      this.recomputeStats();
      this.events.emit('buildingsChanged', { tiles: changed });
    } else if (this.dayCount % 5 === 0) {
      this.recomputeStats();
    }
  }

  private startConstruction(idx: number, level: number): void {
    const w = this.world;
    w.bState[idx] = BuildState.Construction;
    w.bLevel[idx] = level;
    w.bVariant[idx] = Math.floor(this.rand() * MODEL_VARIANTS);
    w.bTimer[idx] = 5 + Math.floor(this.rand() * 6) + level * 3;
    if (w.trees[idx]) {
      w.trees[idx] = 0;
      this.events.emit('treesChanged', undefined);
    }
  }

  private clearBuilding(idx: number): void {
    const w = this.world;
    this.utilities.fire[idx] = 0;
    this.utilities.problemDays[idx] = 0;
    w.bState[idx] = BuildState.Empty;
    w.bLevel[idx] = 0;
    w.bTimer[idx] = 0;
  }

  /** Valeur foncière simplifiée : eau et verdure la font monter, l'industrie la fait baisser. */
  landValue(idx: number): number {
    const w = this.world;
    const i = idx % w.size, j = Math.floor(idx / w.size);
    let v = 0.35;
    let water = false;
    for (let b = j - 3; b <= j + 3; b++) {
      for (let a = i - 3; a <= i + 3; a++) {
        if (!w.inBounds(a, b) || (a === i && b === j)) continue;
        const k = w.index(a, b);
        const near = Math.abs(a - i) + Math.abs(b - j) <= 3;
        if (!near) continue;
        if (!water && w.isWater(a, b)) water = true;
        if (w.trees[k]) v += 0.012;
        if (w.bState[k] === BuildState.Built) {
          const z = w.zones[k];
          if (z === Zone.Industrial) v -= 0.06;
          else if (z === Zone.Commercial) v += 0.025;
          else if (z === Zone.Office) v += 0.02;
          v += 0.004 * w.bLevel[k];
        }
      }
    }
    if (water) v += 0.15;
    const cov = this.utilities.coverage[idx];
    if (cov & Coverage.Health) v += 0.05;
    if (cov & Coverage.Education) v += 0.05;
    if (cov & Coverage.Police) v += 0.05;
    if (cov & Coverage.Fire) v += 0.03;
    if (cov & Coverage.Park) v += 0.09;
    v -= this.utilities.nuisance[idx];
    return clamp(v, 0, 1);
  }

  private canUpgrade(idx: number): boolean {
    const w = this.world;
    const level = w.bLevel[idx];
    const zone = w.zones[idx] as ZoneType;
    const pop = this.stats.population;
    const ut = this.utilities;
    if (!ut.hasUtility(idx, Utility.Power) || !ut.hasUtility(idx, Utility.Water)) return false;
    if (level === 2 && !ut.hasUtility(idx, Utility.Sewage)) return false;
    if (zone === Zone.Industrial) return pop > (level === 1 ? 250 : 1500);
    if (level === 2 && zone === Zone.Residential && !(ut.coverage[idx] & Coverage.Education)) return false;
    const lv = this.landValue(idx);
    return level === 1 ? pop > 200 && lv > 0.4 : pop > 1500 && lv > 0.55;
  }

  capacity(idx: number): number {
    const w = this.world;
    if (w.bState[idx] !== BuildState.Built) return 0;
    return ZONE_INFO[w.zones[idx] as ZoneType].capacity[w.bLevel[idx] - 1];
  }

  recomputeStats(): void {
    const w = this.world;
    const jobs = zeroByZone();
    let population = 0, buildings = 0;
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] !== BuildState.Built) continue;
      buildings++;
      const cap = this.capacity(idx);
      const z = w.zones[idx] as ZoneType;
      if (z === Zone.Residential) population += cap;
      else jobs[z] += cap;
    }
    this.utilities.compute();
    const totalJobs = jobs[Zone.Commercial] + jobs[Zone.Industrial] + jobs[Zone.Office];
    const workers = Math.round(population * 0.55);

    const demand = zeroByZone();
    const happy = population ? this.utilities.stats.happiness : 0.6;
    demand[Zone.Residential] = clamp((totalJobs - workers + 45) / (workers * 0.4 + 60) + (happy - 0.55) * 0.6);
    const wantC = population * 0.2;
    demand[Zone.Commercial] = clamp((wantC - jobs[Zone.Commercial] + 6) / (wantC * 0.5 + 20));
    const wantI = population * 0.28 + 12;
    demand[Zone.Industrial] = clamp((wantI - jobs[Zone.Industrial]) / (wantI * 0.5 + 20));
    const wantO = this.isUnlocked(Zone.Office) ? population * 0.12 : 0;
    demand[Zone.Office] = this.isUnlocked(Zone.Office) ? clamp((wantO - jobs[Zone.Office] + 10) / (wantO * 0.5 + 25)) : 0;

    let income = population * ZONE_INFO[Zone.Residential].tax;
    for (const z of [Zone.Commercial, Zone.Industrial, Zone.Office] as const) income += jobs[z] * ZONE_INFO[z].tax;
    let expenses = this.roadCount * ROAD_UPKEEP_MONTH;
    for (let k = 0; k < w.service.length; k++) if (w.service[k]) expenses += SERVICE_INFO[w.service[k] as Exclude<Service, Service.None>].upkeep;

    this.traffic.refreshBuildings((idx) => this.capacity(idx));
    const prevPop = this.stats.population;
    this.stats = { population, jobs, totalJobs, workers, buildings, demand, income: Math.round(income), expenses: Math.round(expenses) };
    this.events.emit('statsChanged', this.stats);
    if (prevPop < ZONE_INFO[Zone.Office].unlockPop && population >= ZONE_INFO[Zone.Office].unlockPop) {
      this.events.emit('notify', { text: 'Nouvelle zone débloquée : Bureaux', kind: 'info' });
    }
  }

  private onNewMonth(): void {
    this.recomputeStats();
    const net = this.stats.income - this.stats.expenses;
    if (net !== 0) {
      this.money += net;
      this.events.emit('moneyChanged', this.money);
    }
  }

  private spend(amount: number): void {
    this.money -= amount;
    this.events.emit('moneyChanged', this.money);
  }

  private zonedTiles(): number[] {
    if (this.zonedDirty) {
      this.zoned = [];
      const z = this.world.zones;
      for (let k = 0; k < z.length; k++) if (z[k]) this.zoned.push(k);
      this.zonedDirty = false;
    }
    return this.zoned;
  }

  // ---------- Construction de routes ----------

  estimateRoads(path: number[]): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    for (const idx of path) {
      const i = idx % w.size, j = Math.floor(idx / w.size);
      if (w.tiles[idx] === Tile.Road) continue;
      const block = w.roadBlocker(i, j);
      if (block) {
        out.invalid.push(idx);
        out.reason ??= block;
      } else {
        out.valid.push(idx);
        out.cost += ROAD_COST + w.trees[idx] * TREE_CLEAR_COST;
      }
    }
    return out;
  }

  buildRoads(path: number[]): boolean {
    const est = this.estimateRoads(path);
    if (est.invalid.length) {
      this.events.emit('notify', { text: est.reason ?? 'Construction impossible', kind: 'warn' });
      return false;
    }
    if (est.valid.length === 0) return false;
    if (est.cost > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' });
      return false;
    }
    const w = this.world;
    let treesRemoved = false;
    const removedBuildings: number[] = [];
    for (const idx of est.valid) {
      w.tiles[idx] = Tile.Road;
      if (w.trees[idx]) { w.trees[idx] = 0; treesRemoved = true; }
      if (w.zones[idx]) {
        w.zones[idx] = Zone.None;
        if (w.bState[idx]) removedBuildings.push(idx);
        this.clearBuilding(idx);
        this.zonedDirty = true;
      }
    }
    this.roadCount += est.valid.length;
    this.spend(est.cost);
    this.onRoadsChanged(est.valid);
    if (treesRemoved) this.events.emit('treesChanged', undefined);
    if (removedBuildings.length) this.events.emit('buildingsChanged', { tiles: removedBuildings });
    this.events.emit('zonesChanged', undefined);
    return true;
  }

  private onRoadsChanged(tiles: number[]): void {
    this.world.computeRoadDist();
    this.traffic.validate();
    this.recomputeStats();
    this.events.emit('roadsChanged', { tiles });
  }

  // ---------- Zonage ----------

  estimateZone(area: number[], zone: Zone): { valid: number[]; invalid: number[]; reason: string | null } {
    const w = this.world;
    const out = { valid: [] as number[], invalid: [] as number[], reason: null as string | null };
    if (zone !== Zone.None && !this.isUnlocked(zone as ZoneType)) {
      out.reason = `Débloqué à ${ZONE_INFO[zone as ZoneType].unlockPop} habitants`;
      out.invalid = area;
      return out;
    }
    for (const idx of area) {
      const i = idx % w.size, j = Math.floor(idx / w.size);
      if (zone === Zone.None) {
        if (w.zones[idx]) out.valid.push(idx);
        continue;
      }
      if (w.zones[idx] === zone) continue;
      const block = w.zoneBlocker(i, j);
      if (block) { out.invalid.push(idx); out.reason ??= block; } else out.valid.push(idx);
    }
    return out;
  }

  applyZone(area: number[], zone: Zone): void {
    const w = this.world;
    const est = this.estimateZone(area, zone);
    if (!est.valid.length) {
      if (est.reason) this.events.emit('notify', { text: est.reason, kind: 'warn' });
      return;
    }
    const removed: number[] = [];
    for (const idx of est.valid) {
      if (w.bState[idx]) removed.push(idx);
      this.clearBuilding(idx);
      w.zones[idx] = zone;
    }
    this.zonedDirty = true;
    this.events.emit('zonesChanged', undefined);
    if (removed.length) {
      this.recomputeStats();
      this.events.emit('buildingsChanged', { tiles: removed });
    }
  }

  // ---------- Équipements ----------

  estimateService(idx: number, type: Service): { ok: boolean; reason: string | null; cost: number } {
    const w = this.world;
    const i = idx % w.size, j = Math.floor(idx / w.size);
    const info = SERVICE_INFO[type as Exclude<Service, Service.None>];
    const reason = w.serviceBlocker(i, j, type);
    if (reason) return { ok: false, reason, cost: info.cost };
    if (info.cost > this.money) return { ok: false, reason: 'Fonds insuffisants', cost: info.cost };
    return { ok: true, reason: null, cost: info.cost };
  }

  placeService(idx: number, type: Service): boolean {
    const w = this.world;
    const est = this.estimateService(idx, type);
    if (!est.ok) {
      this.events.emit('notify', { text: est.reason!, kind: 'warn' });
      return false;
    }
    const hadBuilding = w.bState[idx] !== BuildState.Empty;
    if (w.zones[idx]) { w.zones[idx] = Zone.None; this.zonedDirty = true; }
    this.clearBuilding(idx);
    if (w.trees[idx]) { w.trees[idx] = 0; this.events.emit('treesChanged', undefined); }
    w.service[idx] = type;
    this.spend(est.cost);
    this.recomputeStats();
    this.events.emit('servicesChanged', undefined);
    this.events.emit('zonesChanged', undefined);
    if (hadBuilding) this.events.emit('buildingsChanged', { tiles: [idx] });
    this.events.emit('notify', { text: `${SERVICE_INFO[type as Exclude<Service, Service.None>].name} construit(e)`, kind: 'info' });
    return true;
  }

  // ---------- Démolition ----------

  estimateBulldoze(area: number[]): { refund: number; cost: number; tiles: number[] } {
    const w = this.world;
    let refund = 0, cost = 0;
    const tiles: number[] = [];
    for (const idx of area) {
      if (w.tiles[idx] === Tile.Road) {
        refund += Math.round(ROAD_COST * ROAD_REFUND);
        tiles.push(idx);
      } else if (w.service[idx]) {
        refund += Math.round(SERVICE_INFO[w.service[idx] as Exclude<Service, Service.None>].cost * 0.25);
        tiles.push(idx);
      } else if (w.bState[idx]) {
        cost += 5 * Math.max(1, w.bLevel[idx]);
        tiles.push(idx);
      } else if (w.trees[idx]) {
        cost += w.trees[idx] * TREE_CLEAR_COST;
        tiles.push(idx);
      }
    }
    return { refund, cost, tiles };
  }

  bulldoze(area: number[]): void {
    const w = this.world;
    const est = this.estimateBulldoze(area);
    if (!est.tiles.length) return;
    if (est.cost - est.refund > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' });
      return;
    }
    const roads: number[] = [];
    const buildings: number[] = [];
    let trees = false, services = false;
    for (const idx of est.tiles) {
      if (w.tiles[idx] === Tile.Road) {
        w.tiles[idx] = Tile.Empty;
        roads.push(idx);
      } else if (w.service[idx]) {
        w.service[idx] = Service.None;
        services = true;
      } else if (w.bState[idx]) {
        this.clearBuilding(idx);
        buildings.push(idx);
      } else if (w.trees[idx]) {
        w.trees[idx] = 0;
        trees = true;
      }
    }
    this.roadCount -= roads.length;
    this.spend(est.cost - est.refund);
    if (roads.length) this.onRoadsChanged(roads);
    if (buildings.length) {
      this.recomputeStats();
      this.events.emit('buildingsChanged', { tiles: buildings });
    }
    if (trees) this.events.emit('treesChanged', undefined);
    if (services) {
      this.recomputeStats();
      this.events.emit('servicesChanged', undefined);
    }
  }
}
