import {
  MAX_ROAD_SLOPE, ROAD_COST, ROAD_REFUND, ROAD_UPKEEP_MONTH, SECONDS_PER_DAY, SIM_STEP, SPEEDS, START_MONEY, TREE_CLEAR_COST,
} from '../config';
import { Emitter, type GameEvents } from '../core/Events';
import { rng } from '../core/noise';
import { Tile, World } from './World';
import { Traffic } from './Traffic';
import { Utilities } from './Utilities';
import { Environment } from './Environment';
import { Demographics } from './Population';
import { DIFFICULTY, defaultConfig, type GameConfig } from '../game/config';
import { Transit, type TransitKind } from './Transit';
import {
  BUDGET_KEYS, BUS_STOP_COST, BUS_UNLOCK, BUS_UPKEEP, DEFAULT_TAX, LOAN_OFFERS, MAX_LOANS, MAX_TAX, METRO_LINE_UPKEEP,
  MILESTONES, MIN_TAX, TICKET_PRICE, defaultBudgets, defaultTaxes, loanPayment, milestoneIndex, type Loan,
} from './economy';
import type { BudgetKey } from './services';
import { BRIDGE_COST_MUL, DIRS8, ROAD_INFO, RoadType, dirIndex } from './roads';
import { ABANDON_DAYS, Coverage, SERVICE_INFO, Service, Utility } from './services';
import { BuildState, Zone, ZONE_DEPTH, ZONE_INFO, type ZoneType } from './zones';

const DAYS_PER_MONTH = 30;
/** Surcoût de terrassement d'une case de route trop pentue. */
const GRADE_COST = 40;
const MODEL_VARIANTS = 4;

export interface CostEstimate {
  /** Cases dont la pente sera aplanie automatiquement. */
  graded?: number;
  cost: number;
  valid: number[];
  invalid: number[];
  reason: string | null;
}

export interface HistoryPoint {
  month: number;
  pop: number;
  money: number;
  income: number;
  expenses: number;
  happiness: number;
  unemployment: number;
  air: number;
  flow: number;
  jobs: number;
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
  /** Détail mensuel des recettes et dépenses. */
  incomeBy: Record<string, number>;
  expensesBy: Record<string, number>;
  unemployment: number;
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
    demand: zeroByZone(), income: 0, expenses: 0, incomeBy: {}, expensesBy: {}, unemployment: 0,
  };
  taxes = defaultTaxes();
  budgets = defaultBudgets();
  loans: Loan[] = [];
  /** Population maximale atteinte (les déblocages ne se perdent pas). */
  maxPop = 0;
  milestone = 0;
  private lastPassengers = 0;

  private dayProgress = 0;
  private accumulator = 0;
  private rand = rng(9001);
  /** Cases zonées (cache reconstruit quand le zonage change). */
  private zoned: number[] = [];
  private zonedDirty = true;

  readonly traffic: Traffic;
  readonly utilities: Utilities;
  readonly transit: Transit;
  readonly env = new Environment();
  readonly demo = new Demographics();
  config: GameConfig = defaultConfig();
  /** Mode bac à sable : argent illimité, tout est débloqué. */
  sandbox = false;
  private incomeMul = 1;
  /** Historique mensuel pour les statistiques. */
  history: HistoryPoint[] = [];
  private popAtMonthStart = 0;
  private lastUtilityHint = -999;

  constructor(world: World) {
    this.world = world;
    this.traffic = new Traffic(world);
    this.utilities = new Utilities(world, (idx) => this.traffic.roadAccess(idx), (idx) => this.capacity(idx));
    this.utilities.budget = (k) => this.budgets[k] / 100;
    this.utilities.trafficDensity = this.traffic.density;
    this.transit = new Transit(world, this.traffic);
    this.recomputeStats();
  }

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  setSpeed(index: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    this.events.emit('speedChanged', this.speedIndex);
  }

  /** Nombre de mois écoulés depuis le début de la partie. */
  get monthIndex(): number {
    return Math.floor(this.dayCount / DAYS_PER_MONTH);
  }

  get date() {
    const month = this.monthIndex + this.env.startMonth;
    return { day: (this.dayCount % DAYS_PER_MONTH) + 1, month: month % 12, year: 1 + Math.floor(month / 12) };
  }

  isUnlocked(zone: ZoneType): boolean {
    return this.sandbox || this.maxPop >= ZONE_INFO[zone].unlockPop;
  }

  isServiceUnlocked(s: Service): boolean {
    return this.sandbox || this.maxPop >= SERVICE_INFO[s as Exclude<Service, Service.None>].unlockPop;
  }

  get busUnlocked(): boolean {
    return this.sandbox || this.maxPop >= BUS_UNLOCK;
  }

  /** Applique les paramètres choisis à la création de la partie. */
  applyConfig(c: GameConfig): void {
    this.config = c;
    this.sandbox = c.mode === 'sandbox';
    this.money = this.sandbox ? Infinity : DIFFICULTY[c.difficulty].money;
    this.incomeMul = DIFFICULTY[c.difficulty].income;
    this.env.startMonth = c.startMonth;
    this.env.weatherEnabled = c.weather;
    this.recomputeStats();
    this.events.emit('moneyChanged', this.money);
  }

  /** Recalcule les données dérivées après un chargement ou une annulation. */
  afterLoad(): void {
    const w = this.world;
    w.computeRoadDist();
    this.roadCount = 0;
    let linked = 0;
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] !== Tile.Road) continue;
      this.roadCount++;
      if (w.links[k]) linked++;
      if (!w.roadType[k]) w.roadType[k] = RoadType.Street;
    }
    if (this.roadCount > 0 && linked === 0) w.deriveLinks();
    this.zonedDirty = true;
    this.popAtMonthStart = this.stats.population;
  }

  // ---------- Économie ----------

  setTax(zone: ZoneType, rate: number): void {
    this.taxes[zone] = Math.round(clamp(rate, MIN_TAX, MAX_TAX));
    this.recomputeStats();
  }

  setBudget(key: BudgetKey, pct: number): void {
    this.budgets[key] = Math.round(clamp(pct, 50, 150) / 5) * 5;
    if (key === 'transport') { this.transit.budget = this.budgets[key] / 100; this.transit.refreshAll(); }
    this.recomputeStats();
  }

  takeLoan(index: number): boolean {
    const o = LOAN_OFFERS[index];
    if (!o || this.loans.length >= MAX_LOANS) return false;
    this.loans.push({ ...o, remaining: o.months, payment: loanPayment(o) });
    this.money += o.amount;
    this.events.emit('moneyChanged', this.money);
    this.recomputeStats();
    this.events.emit('notify', { text: `Emprunt de ${o.amount.toLocaleString('fr-FR')} € obtenu`, kind: 'info' });
    return true;
  }

  /** Remboursement anticipé : capital restant dû. */
  loanBalance(l: Loan): number {
    const r = l.rate / 100 / 12;
    return Math.round((l.payment * (1 - Math.pow(1 + r, -l.remaining))) / r);
  }

  repayLoan(index: number): boolean {
    const l = this.loans[index];
    if (!l) return false;
    const due = this.loanBalance(l);
    if (due > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants pour rembourser', kind: 'error' });
      return false;
    }
    this.loans.splice(index, 1);
    this.spend(due);
    this.recomputeStats();
    return true;
  }

  /** Avance la simulation d'un temps réel dt (s), par pas fixes. */
  update(dt: number): void {
    const scaled = Math.min(dt, 0.1) * this.speed;
    // Trafic : pas variable (mouvement fluide), découpé pour rester stable en vitesse rapide
    const sub = Math.ceil(scaled / 0.05);
    this.env.advance(scaled);
    this.traffic.speedFactor = this.env.trafficSpeed;
    const target = Math.round(this.traffic.targetVehicles(this.stats.population, this.stats.totalJobs) * (1 - this.traffic.transitShare) * this.env.trafficVolume);
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
    if (this.env.onNewDay(this.monthIndex)) this.events.emit('weatherChanged', undefined);

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
          this.events.emit('notify', { text: 'Un bâtiment a brûlé (pas de caserne à proximité)', kind: 'warn', tile: idx });
        }
        if (!ut.fire[idx]) this.events.emit('firesChanged', undefined);
      } else if (this.rand() < (covered ? 0.00001 : 0.00006) * w.bLevel[idx]) {
        ut.fire[idx] = 8;
        this.events.emit('notify', { text: covered ? 'Incendie déclaré, les pompiers interviennent' : 'Incendie déclaré, aucune caserne à proximité !', kind: 'warn', tile: idx });
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
        if (w.tiles[k] === Tile.Road && w.roadType[k] === RoadType.Pedestrian) v += 0.015;
        if (w.tiles[k] === Tile.Road && w.roadType[k] === RoadType.Highway) v -= 0.02;
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
    v -= this.utilities.air[idx] * 0.4 + this.utilities.noise[idx] * 0.2;
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
    this.utilities.happinessOffset = -(this.taxes[Zone.Residential] - DEFAULT_TAX) * 0.012 + this.env.happiness;
    this.utilities.consumptionMul = this.env.consumption(this.monthIndex);
    this.utilities.compute();
    const totalJobs = jobs[Zone.Commercial] + jobs[Zone.Industrial] + jobs[Zone.Office];
    const workers = this.demo.workers(population);
    const unemployment = workers ? Math.max(0, workers - totalJobs) / workers : 0;

    const demand = zeroByZone();
    const happy = population ? this.utilities.stats.happiness : 0.6;
    demand[Zone.Residential] = clamp((totalJobs - workers + 45) / (workers * 0.4 + 60) + (happy - 0.55) * 0.6);
    const wantC = population * 0.2;
    demand[Zone.Commercial] = clamp((wantC - jobs[Zone.Commercial] + 6) / (wantC * 0.5 + 20));
    const wantI = population * 0.28 + 12;
    demand[Zone.Industrial] = clamp((wantI - jobs[Zone.Industrial]) / (wantI * 0.5 + 20));
    const wantO = this.isUnlocked(Zone.Office) ? population * 0.12 * (0.5 + this.demo.education) : 0;
    demand[Zone.Office] = this.isUnlocked(Zone.Office) ? clamp((wantO - jobs[Zone.Office] + 10) / (wantO * 0.5 + 25)) : 0;
    // Les impôts élevés freinent la demande, les impôts bas l'encouragent
    for (const z of [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as ZoneType[]) {
      if (z !== Zone.Office || this.isUnlocked(z)) demand[z] = clamp(demand[z] - (this.taxes[z] - DEFAULT_TAX) * 0.035);
    }

    // Recettes
    const incomeBy: Record<string, number> = {};
    incomeBy.residential = population * ZONE_INFO[Zone.Residential].tax * (this.taxes[Zone.Residential] / DEFAULT_TAX);
    incomeBy.commercial = jobs[Zone.Commercial] * ZONE_INFO[Zone.Commercial].tax * (this.taxes[Zone.Commercial] / DEFAULT_TAX);
    incomeBy.industrial = jobs[Zone.Industrial] * ZONE_INFO[Zone.Industrial].tax * (this.taxes[Zone.Industrial] / DEFAULT_TAX);
    incomeBy.office = jobs[Zone.Office] * ZONE_INFO[Zone.Office].tax * (this.taxes[Zone.Office] / DEFAULT_TAX);
    incomeBy.tickets = this.lastPassengers * TICKET_PRICE;

    // Dépenses
    let roadUpkeep = 0;
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] !== Tile.Road) continue;
      const u = ROAD_INFO[w.roadType[k] as RoadType]?.upkeep ?? ROAD_UPKEEP_MONTH;
      roadUpkeep += w.heights[0] !== undefined && w.isWater(k % w.size, Math.floor(k / w.size)) ? u * 3 : u;
    }
    const expensesBy: Record<string, number> = { roads: roadUpkeep };
    for (const k of BUDGET_KEYS) expensesBy[k] = 0;
    for (let k = 0; k < w.service.length; k++) {
      if (!w.service[k]) continue;
      const info = SERVICE_INFO[w.service[k] as Exclude<Service, Service.None>];
      expensesBy[info.budget] += info.upkeep * (this.budgets[info.budget] / 100);
    }
    let stops = 0;
    for (let k = 0; k < w.busStop.length; k++) stops += w.busStop[k];
    expensesBy.transport += (this.transit.busCount * BUS_UPKEEP + stops * 10 + this.transit.metroLines * METRO_LINE_UPKEEP) * (this.budgets.transport / 100);
    expensesBy.loans = this.loans.reduce((sum, l) => sum + l.payment, 0);
    for (const k in incomeBy) incomeBy[k] = Math.round(incomeBy[k] * (k === 'tickets' ? 1 : this.incomeMul));
    for (const k in expensesBy) expensesBy[k] = Math.round(expensesBy[k]);
    const income = Object.values(incomeBy).reduce((a, b) => a + b, 0);
    const expenses = Object.values(expensesBy).reduce((a, b) => a + b, 0);

    this.traffic.refreshBuildings((idx) => this.capacity(idx));
    const prevPop = this.stats.population;
    void prevPop;
    this.stats = { population, jobs, totalJobs, workers, buildings, demand, income, expenses, incomeBy, expensesBy, unemployment };
    if (population > this.maxPop) this.maxPop = population;
    const m = milestoneIndex(this.maxPop);
    if (m > this.milestone) {
      for (let k = this.milestone + 1; k <= m; k++) {
        const ms = MILESTONES[k];
        if (this.sandbox) continue;
        this.money += ms.reward;
        this.events.emit('milestone', { index: k });
      }
      this.milestone = m;
      this.events.emit('moneyChanged', this.money);
    }
    this.events.emit('statsChanged', this.stats);
  }

  private onNewMonth(): void {
    this.lastPassengers = this.transit.onNewMonth();
    const us = this.utilities.stats;
    this.demo.monthly(this.stats.population, this.popAtMonthStart, us.happiness, us.coverage[Coverage.Health] ?? 0, us.coverage[Coverage.Education] ?? 0, us.air);
    this.popAtMonthStart = this.stats.population;
    for (const l of this.loans) l.remaining--;
    const done = this.loans.filter((l) => l.remaining <= 0).length;
    if (done) this.events.emit('notify', { text: 'Emprunt entièrement remboursé', kind: 'info' });
    this.recomputeStats();
    this.loans = this.loans.filter((l) => l.remaining > 0);
    this.history.push({
      month: this.monthIndex, pop: this.stats.population, money: Math.round(this.money), income: this.stats.income,
      expenses: this.stats.expenses, happiness: us.happiness, unemployment: this.stats.unemployment, air: us.air,
      flow: this.traffic.flow, jobs: this.stats.totalJobs,
    });
    if (this.history.length > 360) this.history.shift();
    if (this.money < 0) this.events.emit('notify', { text: 'Le budget municipal est dans le rouge : augmentez les impôts ou réduisez les dépenses', kind: 'error' });
    if (this.stats.unemployment > 0.15 && this.stats.population > 200) this.events.emit('notify', { text: `Le chômage atteint ${Math.round(this.stats.unemployment * 100)} % : zonez des commerces, industries ou bureaux`, kind: 'warn' });
    const net = this.stats.income - this.stats.expenses;
    if (net !== 0 && !this.sandbox) {
      this.money += net;
      this.events.emit('moneyChanged', this.money);
    }
  }

  private spend(amount: number): void {
    if (this.sandbox) return;
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

  /** Types de voie débloqués. */
  isRoadUnlocked(t: RoadType): boolean {
    return this.sandbox || this.maxPop >= ROAD_INFO[t].unlockPop;
  }

  estimateRoads(path: number[], type: RoadType = RoadType.Street): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    const info = ROAD_INFO[type];
    if (!this.isRoadUnlocked(type)) {
      out.invalid = path;
      out.reason = `${info.name} : débloquée à ${info.unlockPop.toLocaleString('fr-FR')} habitants`;
      return out;
    }
    const onPath = new Set(path);
    for (const idx of path) {
      const i = idx % w.size, j = Math.floor(idx / w.size);
      const water = w.isWater(i, j);
      if (w.tiles[idx] === Tile.Road) {
        // Route existante d'un autre type : remplacée seulement si le tracé la suit
        // (aux croisements, chaque route garde son type)
        const follows = w.neighbors(idx).every((q) => onPath.has(q));
        if (w.roadType[idx] !== type && follows) { out.valid.push(idx); out.cost += info.cost * (water ? BRIDGE_COST_MUL : 1); }
        continue;
      }
      const block = w.roadBlocker(i, j);
      const gradeable = block !== null && block.startsWith('Terrain trop pentu') && this.canGrade(i, j);
      if (block && !gradeable) {
        out.invalid.push(idx);
        out.reason ??= block;
      } else {
        out.valid.push(idx);
        out.cost += info.cost * (water ? BRIDGE_COST_MUL : 1) + w.trees[idx] * TREE_CLEAR_COST + (gradeable ? GRADE_COST : 0);
        if (gradeable) out.graded = (out.graded ?? 0) + 1;
      }
    }
    return out;
  }

  buildRoads(path: number[], type: RoadType = RoadType.Street): boolean {
    const est = this.estimateRoads(path, type);
    if (est.invalid.length) {
      this.events.emit('notify', { text: est.reason ?? 'Construction impossible', kind: 'warn' });
      return false;
    }
    const w = this.world;
    // Liaisons à créer entre cases consécutives du tracé
    const n = w.size;
    const newLinks: Array<[number, number]> = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const d = dirIndex((b % n) - (a % n), Math.floor(b / n) - Math.floor(a / n));
      if (d >= 0 && !(w.links[a] & (1 << d))) newLinks.push([a, b]);
    }
    if (est.valid.length === 0 && !newLinks.length) return false;
    if (est.cost > this.money) {
      this.events.emit('notify', { text: `Fonds insuffisants : il faut ${est.cost.toLocaleString('fr-FR')} €`, kind: 'error' });
      return false;
    }
    let treesRemoved = false;
    const removedBuildings: number[] = [];
    let added = 0;
    for (const idx of est.valid) {
      if (w.tiles[idx] !== Tile.Road) added++;
      w.tiles[idx] = Tile.Road;
      w.roadType[idx] = type;
      if (type === RoadType.Pedestrian || type === RoadType.Highway) w.busStop[idx] = type === RoadType.Highway ? 0 : w.busStop[idx];
      if (w.trees[idx]) { w.trees[idx] = 0; treesRemoved = true; }
      if (w.zones[idx]) {
        w.zones[idx] = Zone.None;
        if (w.bState[idx]) removedBuildings.push(idx);
        this.clearBuilding(idx);
        this.zonedDirty = true;
      }
    }
    for (const [a, b] of newLinks) w.connect(a, b);
    // Terrassement automatique des cases trop pentues
    let graded = false;
    for (const idx of est.valid) {
      const i = idx % n, j = Math.floor(idx / n);
      const [lo, hi] = w.tileMinMax(i, j);
      if (hi - lo <= MAX_ROAD_SLOPE || w.isWater(i, j)) continue;
      const corners = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
      const avg = corners.reduce((sum, [a, b]) => sum + w.corner(a, b), 0) / 4;
      for (const [a, b] of corners) if (!this.cornerLocked(a, b, true)) w.heights[b * (n + 1) + a] = avg + (w.corner(a, b) - avg) * 0.3;
      graded = true;
    }
    if (graded) this.events.emit('terrainChanged', undefined);
    this.roadCount += added;
    this.spend(est.cost);
    this.updateAutoLights(path);
    this.onRoadsChanged(est.valid);
    if (treesRemoved) this.events.emit('treesChanged', undefined);
    if (removedBuildings.length) this.events.emit('buildingsChanged', { tiles: removedBuildings });
    this.events.emit('zonesChanged', undefined);
    return true;
  }

  /** Feux automatiques sur les carrefours d'avenues (sauf choix manuel du joueur). */
  private updateAutoLights(tiles: number[]): void {
    const w = this.world, n = w.size;
    const check = new Set<number>();
    for (const t of tiles) { check.add(t); for (const [dx, dz] of DIRS8) check.add(t + dx + dz * n); }
    for (const k of check) {
      if (k < 0 || k >= w.tiles.length) continue;
      if (w.lights[k] >= 2) continue; // réglage manuel
      if (w.tiles[k] !== Tile.Road) { w.lights[k] = 0; continue; }
      const nb = w.neighbors(k);
      const avenue = w.roadType[k] === RoadType.Avenue || nb.some((q) => w.roadType[q] === RoadType.Avenue);
      w.lights[k] = nb.length >= 3 && avenue && w.roadType[k] !== RoadType.Highway ? 1 : 0;
    }
  }

  /** Active ou retire les feux d'un carrefour. */
  toggleLights(idx: number): boolean {
    const w = this.world;
    if (w.tiles[idx] !== Tile.Road || w.linkCount(idx) < 3) {
      this.events.emit('notify', { text: 'Les feux se placent sur un carrefour (au moins 3 routes qui se rejoignent)', kind: 'warn' });
      return false;
    }
    const on = w.lights[idx] === 1 || w.lights[idx] === 2;
    w.lights[idx] = on ? 3 : 2;
    this.events.emit('roadsChanged', { tiles: [idx] });
    return true;
  }

  /** Met des routes en sens unique dans la direction du tracé (ou rétablit le double sens). */
  setOneway(path: number[]): boolean {
    const w = this.world, n = w.size;
    if (path.length < 2) {
      this.events.emit('notify', { text: 'Glissez le long de la route dans le sens de circulation voulu', kind: 'info' });
      return false;
    }
    // Direction de circulation de chaque case (indice 0-7, stocké + 1)
    const dirs: number[] = [];
    for (let k = 0; k < path.length; k++) {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, Math.max(1, k))];
      const [x, y] = k === 0 ? [path[0], path[1]] : [a, b];
      dirs.push(dirIndex((y % n) - (x % n), Math.floor(y / n) - Math.floor(x / n)) + 1);
    }
    const roads = path.filter((t) => w.tiles[t] === Tile.Road);
    if (!roads.length) return false;
    const already = path.every((t, k) => w.tiles[t] !== Tile.Road || w.oneway[t] === dirs[k]);
    path.forEach((t, k) => { if (w.tiles[t] === Tile.Road) w.oneway[t] = already ? 0 : dirs[k]; });
    this.traffic.validate();
    this.transit.refreshAll();
    this.events.emit('roadsChanged', { tiles: roads });
    this.events.emit('notify', { text: already ? 'Double sens rétabli' : `Sens unique sur ${roads.length} case(s)`, kind: 'info' });
    return true;
  }

  private onRoadsChanged(tiles: number[]): void {
    this.world.computeRoadDist();
    this.traffic.validate();
    this.transit.refreshAll();
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
    if (!this.isServiceUnlocked(type)) {
      return { ok: false, reason: `Débloqué à ${info.unlockPop.toLocaleString('fr-FR')} habitants`, cost: info.cost };
    }
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

  // ---------- Transports en commun ----------

  placeBusStop(idx: number): boolean {
    const w = this.world;
    if (!this.busUnlocked) { this.events.emit('notify', { text: `Bus débloqués à ${BUS_UNLOCK.toLocaleString('fr-FR')} habitants`, kind: 'warn' }); return false; }
    if (w.tiles[idx] !== Tile.Road) { this.events.emit('notify', { text: 'Un arrêt se place sur une route', kind: 'warn' }); return false; }
    if (w.roadType[idx] === RoadType.Highway || w.roadType[idx] === RoadType.Pedestrian) { this.events.emit('notify', { text: 'Pas d\'arrêt de bus sur une autoroute ou une voie piétonne', kind: 'warn' }); return false; }
    if (w.busStop[idx]) return false;
    if (this.money < BUS_STOP_COST) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    w.busStop[idx] = 1;
    this.spend(BUS_STOP_COST);
    this.events.emit('transitChanged', undefined);
    return true;
  }

  createLine(kind: TransitKind, stops: number[]): boolean {
    const line = this.transit.addLine(kind, stops);
    if (!line) return false;
    if (line.broken) {
      this.transit.removeLine(line.id);
      this.events.emit('notify', { text: 'Ligne impossible : les arrêts ne sont pas reliés par la route', kind: 'warn' });
      return false;
    }
    this.recomputeStats();
    this.events.emit('transitChanged', undefined);
    this.events.emit('notify', { text: `${line.name} créée (${line.stops.length} arrêts)`, kind: 'info' });
    return true;
  }

  removeLine(id: number): void {
    this.transit.removeLine(id);
    this.recomputeStats();
    this.events.emit('transitChanged', undefined);
  }

  // ---------- Terrain ----------

  /** Un coin du relief peut-il être modifié (aucune route ni construction autour) ? */
  private cornerLocked(ci: number, cj: number, allowRoads = false): boolean {
    const w = this.world;
    for (const [i, j] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) {
      if (!w.inBounds(i, j)) continue;
      const k = w.index(i, j);
      if ((!allowRoads && w.tiles[k] === Tile.Road) || w.service[k] || w.bState[k] !== BuildState.Empty) return true;
    }
    return false;
  }

  /** Une case pentue peut-elle être aplanie pour y poser une route ? */
  private canGrade(i: number, j: number): boolean {
    const w = this.world;
    const [lo, hi] = w.tileMinMax(i, j);
    if (hi - lo > 3) return false;
    return [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].filter(([a, b]) => !this.cornerLocked(a, b, true)).length >= 3;
  }

  /**
   * Modifie le relief autour d'un point : élever, abaisser, lisser, aplanir, ou planter des arbres.
   * Renvoie true si quelque chose a changé.
   */
  terraform(x: number, z: number, mode: 'up' | 'down' | 'smooth' | 'flat' | 'trees', radius: number, flatTarget = 0): boolean {
    const w = this.world, n = w.size;
    const cost = mode === 'trees' ? 6 : 3;
    let changed = 0;
    if (mode === 'trees') {
      for (let j = Math.floor(z - radius); j <= Math.ceil(z + radius); j++) {
        for (let i = Math.floor(x - radius); i <= Math.ceil(x + radius); i++) {
          if (!w.inBounds(i, j) || Math.hypot(i + 0.5 - x, j + 0.5 - z) > radius) continue;
          const k = w.index(i, j);
          if (w.tiles[k] || w.service[k] || w.bState[k] || w.isWater(i, j) || w.trees[k] >= 3) continue;
          if (this.money < cost) break;
          w.trees[k] = Math.min(3, w.trees[k] + 1);
          this.spend(cost);
          changed++;
        }
      }
      if (changed) { this.recomputeStats(); this.events.emit('treesChanged', undefined); }
      return changed > 0;
    }
    const H = (i: number, j: number) => w.heights[j * (n + 1) + i];
    const next = new Map<number, number>();
    for (let cj = Math.max(0, Math.floor(z - radius)); cj <= Math.min(n, Math.ceil(z + radius)); cj++) {
      for (let ci = Math.max(0, Math.floor(x - radius)); ci <= Math.min(n, Math.ceil(x + radius)); ci++) {
        const d = Math.hypot(ci - x, cj - z);
        if (d > radius || this.cornerLocked(ci, cj)) continue;
        const f = 1 - d / (radius + 0.5);
        const h = H(ci, cj);
        let v = h;
        if (mode === 'up') v = h + 0.12 * f;
        else if (mode === 'down') v = h - 0.12 * f;
        else if (mode === 'flat') v = h + (flatTarget - h) * 0.35 * f;
        else {
          let sum = 0, cnt = 0;
          for (const [a, b] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) if (a >= 0 && b >= 0 && a <= n && b <= n) { sum += H(a, b); cnt++; }
          v = h + (sum / cnt - h) * 0.4 * f;
        }
        v = Math.max(-3, Math.min(14, v));
        if (Math.abs(v - h) > 1e-4) next.set(cj * (n + 1) + ci, v);
      }
    }
    if (!next.size) return false;
    if (!this.sandbox && this.money < next.size * cost) {
      this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' });
      return false;
    }
    for (const [k, v] of next) w.heights[k] = v;
    this.spend(next.size * cost);
    // Les cases devenues aquatiques perdent arbres et zones
    let trees = false, zones = false;
    for (let j = Math.max(0, Math.floor(z - radius) - 1); j < Math.min(n, Math.ceil(z + radius) + 1); j++) {
      for (let i = Math.max(0, Math.floor(x - radius) - 1); i < Math.min(n, Math.ceil(x + radius) + 1); i++) {
        if (!w.isWater(i, j)) continue;
        const k = w.index(i, j);
        if (w.trees[k]) { w.trees[k] = 0; trees = true; }
        if (w.zones[k]) { w.zones[k] = Zone.None; zones = true; this.zonedDirty = true; }
      }
    }
    w.computeRoadDist();
    this.events.emit('terrainChanged', undefined);
    if (trees) this.events.emit('treesChanged', undefined);
    if (zones) this.events.emit('zonesChanged', undefined);
    return true;
  }

  // ---------- Démolition ----------

  estimateBulldoze(area: number[]): { refund: number; cost: number; tiles: number[] } {
    const w = this.world;
    let refund = 0, cost = 0;
    const tiles: number[] = [];
    for (const idx of area) {
      if (w.tiles[idx] === Tile.Road) {
        refund += Math.round((ROAD_INFO[w.roadType[idx] as RoadType]?.cost ?? ROAD_COST) * ROAD_REFUND);
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
        w.busStop[idx] = 0;
        w.roadType[idx] = 0;
        w.oneway[idx] = 0;
        w.lights[idx] = 0;
        w.disconnect(idx);
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
    if (roads.length) this.updateAutoLights(roads);
    if (roads.length) this.onRoadsChanged(roads);
    if (buildings.length) {
      this.recomputeStats();
      this.events.emit('buildingsChanged', { tiles: buildings });
    }
    if (trees) this.events.emit('treesChanged', undefined);
    if (services) {
      this.transit.refreshAll();
      this.recomputeStats();
      this.events.emit('servicesChanged', undefined);
    }
    if (roads.length || services) this.events.emit('transitChanged', undefined);
  }
}
