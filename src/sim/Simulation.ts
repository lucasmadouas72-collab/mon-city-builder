import {
  MAX_ROAD_SLOPE, ROAD_COST, ROAD_REFUND, ROAD_UPKEEP_MONTH, SECONDS_PER_DAY, SIM_STEP, SPEEDS, START_MONEY, TREE_CLEAR_COST,
} from '../config';
import { Emitter, type GameEvents } from '../core/Events';
import { rng } from '../core/noise';
import { Tile, World } from './World';
import { Traffic } from './Traffic';
import { Utilities } from './Utilities';
import { Environment } from './Environment';
import { Emergency } from './Emergency';
import { Disasters } from './Disasters';
import { Society } from './Society';
import { Waste } from './Waste';
import { Districts } from './Districts';
import { Council } from './Council';
import { Tourism } from './Tourism';
import { Status } from './Citizens';
import { Demographics } from './Population';
import { DIFFICULTY, defaultConfig, type GameConfig } from '../game/config';
import { Transit, type TransitKind } from './Transit';
import {
  EARLY_REPAY_PENALTY, BUDGET_KEYS, BUS_STOP_COST, BUS_UNLOCK, DEFAULT_TAX, LOAN_OFFERS, MAX_LOANS, MAX_TAX,
  MILESTONES, MIN_TAX, defaultBudgets, defaultTaxes, loanPayment, milestoneIndex, type Loan,
} from './economy';
import type { BudgetKey } from './services';
import { BRIDGE_COST_MUL, DIRS8, ELEVATED_COST_MUL, LANES, RAIL_COST, ROAD_INFO, RoadFlag, RoadType, TUNNEL_COST_MUL, dirIndex } from './roads';
import { ABANDON_DAYS, Coverage, SERVICE_INFO, Service, Utility } from './services';
import {
  BuildState, hasHomes, hasJobs, jobKind, kindOf, Zone, ZONE_DEPTH, ZONE_INFO, zoneInfo, type LotShape, type ZoneId, type ZoneType,
} from './zones';
import { E, N, Resource, S, W } from './World';

const DAYS_PER_MONTH = 30;

/** Comptes d'un mois (§9). */
export interface LedgerEntry {
  month: number;
  incomeBy: Record<string, number>;
  expensesBy: Record<string, number>;
  invest: Record<string, number>;
  income: number;
  expenses: number;
  investTotal: number;
  debt: number;
  money: number;
}
/** Prix de l'énergie et de l'eau échangées avec les villes voisines (€ par unité et par mois). */
export const POWER_IMPORT_PRICE = 0.5;
export const POWER_EXPORT_PRICE = 0.2;
export const WATER_IMPORT_PRICE = 0.4;
/** Coût d'une case de ligne haute tension. */
export const POWER_LINE_COST = 18;
/** Surcoût de terrassement d'une case de route trop pentue. */
const GRADE_COST = 40;
const MODEL_VARIANTS = 4;
/** Jours d'abandon avant qu'un bâtiment délabré ne s'effondre. */
const RUIN_DAYS = 150;

/** Modèle choisi dans la bibliothèque pour un placement manuel. */
export interface BuildingSpec { zone: ZoneId; level: number; front: number; depth: number; style: number; variant?: number }

export interface PlaceEstimate { ok: boolean; tiles: number[]; invalid: number[]; reasons: string[]; warnings: string[]; cost: number; rect: [number, number, number, number]; face: number }

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
  lastPassengers = 0;

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
  readonly emergency: Emergency;
  readonly disasters: Disasters;
  readonly society: Society;
  readonly waste: Waste;
  readonly districts: Districts;
  readonly council: Council;
  readonly tourism: Tourism;
  /** Investissements du mois en cours, par poste (§9). */
  investMonth: Record<string, number> = {};
  /** Historique mensuel des comptes (recettes, fonctionnement, investissements, dette). */
  ledger: LedgerEntry[] = [];
  /** Coût des réparations du mois en cours (facturé en fin de mois). */
  private repairAccum = 0;
  /** Coût des réparations du mois précédent. */
  repairLastMonth = 0;
  /** Délinquance moyenne des bâtiments (0 à 1). */
  crimeIndex = 0;
  readonly demo = new Demographics();
  config: GameConfig = defaultConfig();
  /** Mode bac à sable : argent illimité, tout est débloqué. */
  sandbox = false;
  private incomeMul = 1;
  /** Historique mensuel pour les statistiques. */
  history: HistoryPoint[] = [];
  popAtMonthStart = 0;
  private lastUtilityHint = -999;

  constructor(world: World) {
    this.world = world;
    this.traffic = new Traffic(world);
    this.society = new Society(this);
    this.utilities = new Utilities(world, (idx) => this.traffic.roadAccess(idx), (idx) => this.occupants(idx));
    this.utilities.studentsOf = (idx) => this.society.citizens.students[idx];
    this.utilities.sickOf = (idx) => this.society.citizens.sickBy[idx];
    this.utilities.trafficDensity = this.traffic.density;
    this.transit = new Transit(world, this.traffic);
    this.transit.weather = () => this.env.weather;
    this.transit.hasDepot = (kind, line) => {
      const w = this.world;
      const want = kind === 'bus' ? Service.BusDepot : kind === 'tram' ? Service.TramDepot : kind === 'metro' ? Service.MetroDepot : 0;
      if (!want) return true;
      const net = kind === 'bus' ? this.utilities.networkOf(line.stops[0]) : -2;
      for (let k = 0; k < w.service.length; k++) if (w.service[k] === want && (net === -2 || this.utilities.networkOf(k) === net)) return true;
      return false;
    };
    this.emergency = new Emergency(world, this.traffic);
    this.emergency.budget = (svc) => this.budgets[SERVICE_INFO[svc as Exclude<Service, Service.None>].budget] / 100;
    this.disasters = new Disasters(this);
    this.waste = new Waste(this);
    this.districts = new Districts(this);
    this.council = new Council(this);
    this.tourism = new Tourism(this);
    // Effets des projets du conseil sur l'efficacité des services
    this.utilities.budget = (k) => (this.budgets[k] / 100) * (1 + (k === 'education' ? this.council.mod('education') : k === 'health' ? this.council.mod('health') : 0));
    this.utilities.districtHappiness = (idx) => this.districts.happiness(idx);
    this.utilities.afterPollution = (air, noise, light) => { this.districts.applyToPollution(air, noise, light); this.tourism.applyNoise(noise); };
    this.utilities.garbageOk = (idx) => this.waste.isCollected(idx);
    this.utilities.garbageLevel = (idx) => this.waste.level(idx);
    // Les missions des camions de collecte et celles des secours partagent le trafic
    const emergencyArrive = this.traffic.onMission;
    this.traffic.onMission = (v) => (this.waste.owns(v) ? this.waste.onArrive(v) : emergencyArrive?.(v));
    this.emergency.onFireReached = (tile) => {
      const w = this.world;
      if (w.forestFire[tile]) {
        // Feu de forêt : les pompiers éteignent les arbres autour
        const n = w.size, i0 = tile % n, j0 = Math.floor(tile / n);
        for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) if (w.inBounds(i, j)) w.forestFire[w.index(i, j)] = 0;
        this.events.emit('firesChanged', undefined);
        this.events.emit('notify', { text: 'Feu de forêt circonscrit par les pompiers', kind: 'info', tile });
        return;
      }
      if (!this.utilities.fire[tile]) return;
      this.utilities.fire[tile] = 0;
      this.events.emit('firesChanged', undefined);
      this.events.emit('notify', { text: 'Incendie maîtrisé par les pompiers', kind: 'info', tile });
    };
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

  isUnlocked(zone: number): boolean {
    return this.sandbox || this.maxPop >= (zoneInfo(zone)?.unlockPop ?? 0);
  }

  /** Voyageurs mensuels de l'aéroport. */
  airportPassengers = 0;
  /** Pression sur le stationnement des commerces et bureaux (demande / places), par case. */
  parkingPressure: Float32Array = new Float32Array(0);

  /** Attrait apporté par l'aéroport et les trains régionaux. */
  private transportAppeal(): number {
    const w = this.world;
    return (w.service.includes(Service.Airport) ? 0.15 : 0) + Math.min(0.12, this.transit.regionalStations * 0.04) + (w.service.includes(Service.Harbor) ? 0.03 : 0);
  }

  /** Capacités supplémentaires d'export et de stockage : port, gares régionales, aéroport. */
  freightBonus(): { export: number; storage: number } {
    const w = this.world;
    let harbors = 0, airport = 0;
    for (let k = 0; k < w.service.length; k++) { if (w.service[k] === Service.Harbor) harbors++; else if (w.service[k] === Service.Airport) airport++; }
    return { export: harbors * 250000 + this.transit.regionalStations * 80000 + airport * 60000, storage: harbors * 100000 + this.transit.regionalStations * 20000 };
  }

  /** Effet du stationnement sur les ventes d'un commerce (jusqu'à −15 % si les places manquent). */
  parkingFactor(k: number): number {
    const p = this.parkingPressure[k] ?? 0;
    return p > 1 ? 1 - Math.min(0.15, (p - 1) * 0.1) : 1;
  }

  /** Stationnement (§4) : places sur voirie (3 par case de rue proche) et parkings (400 places partagées). */
  private computeParking(): void {
    const w = this.world, n = w.size, c = this.society.citizens;
    if (this.parkingPressure.length !== w.tiles.length) this.parkingPressure = new Float32Array(w.tiles.length);
    const P = this.parkingPressure;
    P.fill(0);
    const garages: number[] = [];
    for (let k = 0; k < w.service.length; k++) if (w.service[k] === Service.Parking) garages.push(k);
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) continue;
      const kd = kindOf(w.zones[k]);
      if (kd !== Zone.Commercial && kd !== Zone.Office) continue;
      const demand = c.employees[k] * 0.35 + (kd === Zone.Commercial ? this.jobCapacity(k) * 0.8 : 0);
      const i0 = k % n, j0 = Math.floor(k / n);
      let street = 0;
      for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) if (w.inBounds(i, j) && w.carsAllowed(j * n + i) && !(w.roadFlags[j * n + i] & 48) && w.roadType[j * n + i] !== RoadType.Highway) street++;
      let garage = 0;
      for (const g of garages) if (Math.abs((g % n) - i0) + Math.abs(Math.floor(g / n) - j0) <= 6) garage += 60;
      P[k] = demand / Math.max(1, street * 3 + garage);
    }
  }

  /** Accidents sur les routes chargées, fin des incidents (§12). */
  private trafficIncidents(): void {
    const w = this.world, dens = this.traffic.density;
    for (let k = 0; k < w.incident.length; k++) if (w.incident[k]) { w.incident[k]--; if (!w.incident[k]) w.incidentKind[k] = 0; }
    for (let k = 0; k < this.traffic.volume.length; k++) this.traffic.volume[k] *= 0.85;
    const bad = ['rain', 'snow', 'fog', 'frost', 'storm'].includes(this.env.weather) ? 2 : 1;
    for (let s = 0; s < 40; s++) {
      const k = Math.floor(this.rand() * w.tiles.length);
      if (w.tiles[k] !== Tile.Road || dens[k] < 1.2 || w.incident[k]) continue;
      if (this.rand() < dens[k] * 0.02 * bad * (w.roadFlags[k] & RoadFlag.Zone30 ? 0.4 : 1)) {
        w.incident[k] = 2 + Math.floor(this.rand() * 3);
        w.incidentKind[k] = 1;
        this.accidentsThisMonth++;
        if (this.dayCount - this.lastAccidentNote > 15) {
          this.lastAccidentNote = this.dayCount;
          this.events.emit('notify', { text: 'Accident de la circulation : la route est ralentie quelques jours', kind: 'warn', tile: k });
        }
      }
    }
  }
  accidentsThisMonth = 0;
  accidentsLastMonth = 0;
  private lastAccidentNote = -999;

  /** Prochain identifiant de bâtiment (stable, sauvegardé). */
  nextBuildingId = 1;
  /** Demande propre à chaque type de zone (densités, zones spécialisées). */
  zoneDemand: Record<number, number> = {};
  /** Attrait touristique de la ville (0 à 1). */
  tourismAppeal = 0;
  /** Bâtiments ayant évolué depuis la dernière annonce. */
  private evolved: number[] = [];

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
    this.disasters.level = c.disasters ?? 'rare';
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
    this.accumulateSoil();
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

  /** Capital restant dû sur tous les emprunts. */
  get debt(): number {
    return this.loans.reduce((a, l) => a + this.loanBalance(l), 0);
  }

  /** Capacité d'emprunt : 18 mois de recettes moyennes (au moins 40 000 €). */
  get borrowingCapacity(): number {
    const last = this.ledger.slice(-12);
    const avg = last.length ? last.reduce((a, e) => a + e.income, 0) / last.length : this.stats.income;
    return Math.max(40_000, Math.round(avg * 18));
  }

  takeLoan(index: number): boolean {
    const o = LOAN_OFFERS[index];
    if (!o || this.loans.length >= MAX_LOANS) return false;
    if (this.debt + o.amount > this.borrowingCapacity) {
      this.events.emit('notify', { text: `Capacité d’emprunt dépassée (${this.borrowingCapacity.toLocaleString('fr-FR')} € au total)`, kind: 'warn' });
      return false;
    }
    this.loans.push({ ...o, remaining: o.months, payment: loanPayment(o), takenAt: this.monthIndex });
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
    const due = Math.round(this.loanBalance(l) * (1 + EARLY_REPAY_PENALTY));
    if (due > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants pour rembourser', kind: 'error' });
      return false;
    }
    this.loans.splice(index, 1);
    this.spend(due, 'debt');
    this.recomputeStats();
    return true;
  }

  /** Avance la simulation d'un temps réel dt (s), par pas fixes. */
  update(dt: number): void {
    const scaled = Math.min(dt, 0.1) * this.speed;
    // Trafic : pas variable (mouvement fluide), découpé pour rester stable en vitesse rapide
    const sub = Math.ceil(scaled / 0.05);
    this.env.advance(scaled);
    this.emergency.update(scaled);
    this.transit.advance(scaled);
    this.disasters.update(scaled);
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
    this.emergency.daily(this.dayCount);
    this.disasters.daily();
    this.repairDaily();
    this.generateIncidents();
    this.society.daily();
    this.utilities.daily();
    this.waste.daily();
    this.maintainDaily();
    this.trafficIncidents();
    this.tourism.daily();
    this.society.citizens.tally();
    if (this.dayCount % 10 === 0) this.computeCrime();

    // Avancement des chantiers
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] === BuildState.Construction) {
        if (w.bTimer[idx] > 0) w.bTimer[idx]--;
        if (w.bTimer[idx] === 0) {
          w.bState[idx] = BuildState.Built;
          changed.push(idx);
          if (w.bLevel[idx] >= 2 && w.anchorOf(idx) === idx) this.evolved.push(idx);
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
          changed.push(...this.abandonBuilding(idx, 'sans électricité ou sans eau'));
          continue;
        }
      } else ut.problemDays[idx] = 0;
      const covered = (ut.coverage[idx] & Coverage.Fire) !== 0;
      if (ut.fire[idx]) {
        // Le feu progresse jusqu'à l'arrivée des pompiers (véhicules sur la route)
        ut.fire[idx]--;
        if (ut.fire[idx] === 0) {
          changed.push(...this.clearBuilding(idx));
          this.emergency.closeFire(idx, true);
          this.events.emit('notify', { text: covered ? 'Un bâtiment a brûlé : les pompiers sont arrivés trop tard (trafic ou casernes occupées)' : 'Un bâtiment a brûlé : aucune caserne à portée', kind: 'warn', tile: idx });
          this.events.emit('firesChanged', undefined);
        }
      } else if (this.rand() < (covered ? 0.00003 : 0.00006) * w.bLevel[idx] * (this.env.weather === 'heat' ? 2 : 1)) {
        ut.fire[idx] = 20; // durée avant destruction (jours), cohérente avec le temps de trajet des camions
        this.emergency.report('fire', idx, this.dayCount);
        this.events.emit('notify', { text: covered ? 'Incendie déclaré, les pompiers sont en route' : 'Incendie déclaré, aucune caserne à portée !', kind: 'warn', tile: idx });
        this.events.emit('firesChanged', undefined);
      }
    }

    const tiles = this.zonedTiles();
    if (tiles.length) {
      const samples = Math.min(tiles.length, 6 + Math.floor(tiles.length * 0.02));
      for (let s = 0; s < samples; s++) {
        const idx = w.anchorOf(tiles[Math.floor(this.rand() * tiles.length)]);
        const zone = w.zones[idx] as ZoneId;
        if (!zone) continue;
        const demand = this.zoneDemand[zone] ?? 0;
        const access = w.roadDist[idx] <= ZONE_DEPTH;
        const state = w.bState[idx];

        if (state === BuildState.Empty) {
          if (w.rubble[idx] || w.flooded[idx] || w.powerLine[idx]) continue;
          // Le zonage rend des parcelles disponibles : un bâtiment n'apparaît que si les conditions sont réunies (§5)
          const score = this.siteScore(idx, zone);
          if (access && demand > 0 && score > 0 && this.isUnlocked(zone) && this.rand() < (0.08 + demand * 0.35) * score) {
            if (this.utilities.canGrow(idx)) {
              const lot = this.findParcel(idx, zone);
              changed.push(...this.startConstruction(idx, 1, lot));
            } else blockedByUtilities = idx;
          }
        } else if (state === BuildState.Built) {
          if (!access) {
            // Plus d'accès routier : le bâtiment est abandonné
            changed.push(...this.abandonBuilding(idx, 'plus d\'accès routier'));
          } else if (demand < -0.55 && this.rand() < 0.04 && this.lotOccupants(idx) === 0) {
            changed.push(...this.abandonBuilding(idx, 'aucune demande'));
          } else if (w.bLevel[idx] < 3 && w.bTimer[idx] > 40 && demand > 0.15 && this.canUpgrade(idx) && this.rand() < 0.12) {
            changed.push(...this.startConstruction(idx, w.bLevel[idx] + 1));
          }
        } else if (state === BuildState.Abandoned) {
          // Réhabilitation quand les conditions reviennent, sinon effondrement au bout de quelques mois
          const ut = this.utilities;
          if (access && demand > 0.1 && ut.hasUtility(idx, Utility.Power) && ut.hasUtility(idx, Utility.Water) && this.rand() < 0.25) {
            changed.push(...this.startConstruction(idx, Math.max(1, w.bLevel[idx])));
          }
        }
      }
    }
    // Les bâtiments abandonnés se délabrent puis s'effondrent
    for (const idx of tiles) {
      if (w.bState[idx] !== BuildState.Abandoned || w.anchorOf(idx) !== idx) continue;
      if (w.bTimer[idx] < 65535) w.bTimer[idx]++;
      if (w.bTimer[idx] > RUIN_DAYS) {
        const lot = this.clearBuilding(idx);
        for (const t of lot) w.rubble[t] = 1;
        changed.push(...lot);
        this.events.emit('notify', { text: 'Un bâtiment abandonné s\'est effondré : démolissez les ruines ou rétablissez les services', kind: 'warn', tile: idx });
      }
    }
    if (this.evolved.length && this.dayCount % 10 === 0) this.announceEvolutions();

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

  // ---------- Entretien et dégradation (§13) ----------

  /** Usure quotidienne des routes (selon le trafic) et des équipements, compensée par le budget d'entretien. */
  private maintainDaily(): void {
    const w = this.world, cond = w.condition, dens = this.traffic.density;
    const mb = this.budgets.maintenance / 100;
    const slow = 1 - Math.min(0.8, this.council.mod('maintenance'));
    let changed = false;
    for (let k = 0; k < w.tiles.length; k++) {
      let decay = 0, repair = 0;
      if (w.tiles[k] === Tile.Road) { decay = 0.03 + Math.min(4, dens[k]) * 0.04; repair = 0.06 * mb; }
      else if (w.service[k]) { decay = w.service[k] <= 2 || w.service[k] === Service.NuclearPlant ? 0.085 : 0.07; repair = 0.075 * mb; }
      else continue;
      if (this.districts.has(k, 'maintenance')) decay *= 0.5;
      const before = cond[k];
      cond[k] = Math.max(0, Math.min(100, cond[k] - decay * slow + repair));
      if ((before >= 50) !== (cond[k] >= 50) || (before >= 25) !== (cond[k] >= 25)) changed = true;
      // Pannes des équipements très mal entretenus
      if (w.service[k] && cond[k] < 20 && !this.disasters.offline.has(k) && this.rand() < 0.01) {
        this.disasters.offline.set(k, 5);
        this.events.emit('notify', { text: `Panne : ${SERVICE_INFO[w.service[k] as Exclude<Service, Service.None>].name} hors service quelques jours (mauvais entretien)`, kind: 'warn', tile: k });
      }
    }
    if (changed) this.events.emit('roadsChanged', { tiles: [] });
  }

  /** Coût de rénovation complète d'un équipement ou d'une route usée. */
  renovationCost(idx: number): number {
    const w = this.world;
    const missing = (100 - w.condition[idx]) / 100;
    if (w.service[idx]) return Math.round(SERVICE_INFO[w.service[idx] as Exclude<Service, Service.None>].cost * 0.4 * missing);
    if (w.tiles[idx] === Tile.Road) return Math.round((ROAD_INFO[w.roadType[idx] as RoadType]?.cost ?? ROAD_COST) * 0.8 * missing);
    return 0;
  }

  /** Rénove des équipements ou des routes (remise à 100 %). */
  renovate(tiles: number[]): boolean {
    const w = this.world;
    const list = tiles.filter((k) => (w.service[k] || w.tiles[k] === Tile.Road) && w.condition[k] < 99);
    const cost = list.reduce((a, k) => a + this.renovationCost(k), 0);
    if (!list.length) return false;
    if (!this.sandbox && cost > this.money) { this.events.emit('notify', { text: 'Fonds insuffisants pour la rénovation', kind: 'error' }); return false; }
    for (const k of list) {
      w.condition[k] = 100;
      if (w.tiles[k] === Tile.Road) { w.incident[k] = 4; w.incidentKind[k] = 2; } // travaux
    }
    this.spend(cost, 'renovation');
    this.recomputeStats();
    this.events.emit('roadsChanged', { tiles: [] });
    this.events.emit('notify', { text: `Rénovation de ${list.length} élément(s) · ${cost.toLocaleString('fr-FR')} €`, kind: 'info' });
    return true;
  }

  /** Routes en mauvais état (moins de 50 %). */
  wornRoads(): number[] {
    const w = this.world, out: number[] = [];
    for (let k = 0; k < w.tiles.length; k++) if (w.tiles[k] === Tile.Road && w.condition[k] < 50) out.push(k);
    return out;
  }

  // ---------- Catastrophes : dégâts et reconstruction ----------

  /** Inflige des dégâts à un bâtiment ; renvoie true s'il est détruit (il laisse des gravats). */
  damageBuilding(k: number, amount: number): boolean {
    const w = this.world;
    if (w.bState[k] !== BuildState.Built) return false;
    w.bDamage[k] = Math.min(100, w.bDamage[k] + amount);
    if (w.bDamage[k] >= 100) {
      this.clearBuilding(k);
      w.rubble[k] = 1;
      return true;
    }
    return false;
  }

  /** Met le feu à un bâtiment (accident, feu de forêt). */
  igniteBuilding(k: number): void {
    if (this.utilities.fire[k] || this.world.bState[k] !== BuildState.Built) return;
    this.utilities.fire[k] = 20;
    this.emergency.report('fire', k, this.dayCount);
    this.events.emit('firesChanged', undefined);
  }

  /** Démographie (pyramide, naissances, éducation…) calculée à partir des habitants réels. */
  private syncDemographics(): void {
    const c = this.society.citizens;
    const s = c.summary();
    const total = s.ages.reduce((a, b) => a + b, 0) || 1;
    this.demo.shares = s.ages.map((a) => a / total);
    const adults = s.edu.reduce((a, b) => a + b, 0) || 1;
    this.demo.education = (s.edu[2] + s.edu[3]) / adults;
    this.demo.sick = this.stats.population ? s.sick / this.stats.population : 0;
    const r = c.report;
    this.demo.last = { births: r.births, deaths: r.deaths, migration: r.immigrants - r.emigrants };
    this.lastSociety = s;
  }

  /** Dernier bilan détaillé de la population (mis à jour chaque mois). */
  lastSociety: import('./Citizens').SocietySummary | null = null;

  /** Pollution des sols : s'accumule autour de l'industrie et des centres de tri, se résorbe lentement. */
  private accumulateSoil(): void {
    const w = this.world, n = w.size;
    for (let k = 0; k < w.soilPol.length; k++) w.soilPol[k] *= 0.985;
    const add = (k: number, amount: number, r: number) => {
      const i0 = k % n, j0 = Math.floor(k / n);
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (!w.inBounds(i, j)) continue;
        const d = Math.hypot(i - i0, j - j0);
        if (d <= r) { const q = w.index(i, j); w.soilPol[q] = Math.min(1, w.soilPol[q] + amount * (1 - d / (r + 1))); }
      }
    };
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.bState[k] === BuildState.Built) { const p = zoneInfo(w.zones[k])?.pollution; if (p && (p.air || p.water) > 0.3) add(k, 0.008 * w.bLevel[k] * Math.max(p.air, p.water * 0.5), 2); }
      if (w.service[k] === Service.Landfill) add(k, 0.015, 3);
      if (w.service[k] === Service.LandfillSite) add(k, 0.025, 4);
      if (w.service[k] === Service.Incinerator) add(k, 0.006, 4);
      if (w.service[k] === Service.PowerPlant) add(k, 0.006, 3);
    }
  }

  /** Après des dégâts : statistiques et affichage à jour. */
  afterDisasterHit(): void {
    this.recomputeStats();
    this.events.emit('buildingsChanged', { tiles: [] });
    this.events.emit('damageChanged', undefined);
    this.events.emit('floodChanged', undefined);
  }

  /** Réparations quotidiennes (payées en fin de mois) et déblaiement des gravats. */
  private repairDaily(): void {
    const w = this.world;
    let changed = false;
    const rate = this.budgets.fire / 100;
    for (let k = 0; k < w.bDamage.length; k++) {
      if (w.bDamage[k] && !w.flooded[k]) {
        const r = Math.min(w.bDamage[k], Math.round(3 * rate) || 1);
        w.bDamage[k] -= r;
        this.repairAccum += r * 4 * Math.max(1, w.bLevel[k]);
        changed = true;
      }
      if (w.roadDamage[k] && !w.flooded[k]) {
        const r = Math.min(w.roadDamage[k], 5);
        w.roadDamage[k] -= r;
        this.repairAccum += r * 2;
        changed = true;
      }
      if (w.rubble[k]) {
        if (++w.rubble[k] > 15) { w.rubble[k] = 0; this.repairAccum += 60; changed = true; }
      }
    }
    if (changed && this.dayCount % 3 === 0) this.events.emit('damageChanged', undefined);
  }

  /** Urgences médicales et délits du jour (selon les malades et la délinquance). */
  private generateIncidents(): void {
    const w = this.world;
    const tiles = this.zonedTiles();
    if (!tiles.length || !this.stats.population) return;
    const medical = this.stats.population * this.demo.sick * 0.004;
    for (let k = 0; k < 3; k++) {
      if (this.rand() > medical / 3) continue;
      const idx = tiles[Math.floor(this.rand() * tiles.length)];
      if (w.bState[idx] === BuildState.Built && hasHomes(w.zones[idx])) this.emergency.report('medical', idx, this.dayCount);
    }
    for (let k = 0; k < 25; k++) {
      const idx = tiles[Math.floor(this.rand() * tiles.length)];
      if (w.bState[idx] !== BuildState.Built) continue;
      if (this.rand() < this.utilities.crime[idx] * 0.03 * w.bLevel[idx]) this.emergency.report('crime', idx, this.dayCount);
    }
  }

  /** Délinquance : chômage, faible valeur foncière, absence de police et délits non élucidés. */
  computeCrime(): void {
    const w = this.world, ut = this.utilities;
    const unemp = this.stats.unemployment;
    let sum = 0, count = 0;
    const unsolved = new Map<number, number>();
    for (const inc of this.emergency.incidents) if (inc.type === 'crime' && inc.status === 'failed') unsolved.set(inc.tile, (unsolved.get(inc.tile) ?? 0) + 1);
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] !== BuildState.Built) { ut.crime[idx] = 0; continue; }
      const lv = this.landValue(idx);
      let c = 0.1 + unemp * 1.1 + (0.5 - lv) * 0.5 - (ut.coverage[idx] & Coverage.Police ? 0.3 : 0) + (unsolved.get(idx) ?? 0) * 0.1;
      if (kindOf(w.zones[idx]) === Zone.Commercial) c += 0.05;
      c -= this.council.mod('crime');
      c = clamp(c, 0, 1);
      ut.crime[idx] = c;
      sum += c; count++;
    }
    this.crimeIndex = count ? sum / count : 0;
  }

  /**
   * Lance un chantier : nouveau bâtiment (éventuellement sur une parcelle de plusieurs cases)
   * ou évolution d'un bâtiment existant. Renvoie les cases concernées.
   */
  private startConstruction(idx: number, level: number, lot?: [number, number, number, number, number] | null): number[] {
    const w = this.world, n = w.size;
    let anchor = w.anchorOf(idx);
    const fresh = w.bState[anchor] === BuildState.Empty;
    if (fresh) {
      if (lot) {
        const [i0, j0, gw, gh, face] = lot;
        anchor = j0 * n + i0;
        w.setLot(anchor, gw, gh);
        w.bFace[anchor] = face;
      } else w.setLot(anchor, 1, 1);
    }
    const tiles = w.lotTiles(anchor);
    const id = fresh ? this.nextBuildingId++ : w.bId[anchor];
    const variant = fresh || this.rand() < 0.5 ? Math.floor(this.rand() * MODEL_VARIANTS) : w.bVariant[anchor];
    const timer = Math.max(2, Math.round((5 + Math.floor(this.rand() * 6) + level * 3 + (tiles.length > 1 ? 3 : 0)) * (1 - this.council.mod('construction'))));
    let trees = false;
    for (const t of tiles) {
      w.bState[t] = BuildState.Construction;
      w.bLevel[t] = level;
      w.bVariant[t] = variant;
      w.bTimer[t] = timer;
      w.bId[t] = id;
      if (w.trees[t]) { w.trees[t] = 0; trees = true; }
    }
    if (trees) this.events.emit('treesChanged', undefined);
    return tiles;
  }

  /** Les occupants partent : les foyers cherchent un autre logement, les employés perdent leur emploi. */
  private evictTile(t: number): void {
    if (!this.society) return;
    const c = this.society.citizens;
    if (c.homesTaken[t] || c.residents[t]) c.evict(t, (h) => this.society.findHome(c.hIncome[h], t));
    if (c.employees[t]) c.fireAll(t);
  }

  /** Rase le bâtiment (toutes les cases de sa parcelle). Renvoie les cases libérées. */
  private clearBuilding(idx: number): number[] {
    const w = this.world;
    const tiles = w.lotTiles(idx);
    for (const t of tiles) {
      this.evictTile(t);
      this.utilities.fire[t] = 0;
      this.utilities.problemDays[t] = 0;
      w.bState[t] = BuildState.Empty;
      w.bLevel[t] = 0;
      w.bTimer[t] = 0;
      w.bId[t] = 0;
    }
    w.clearLot(idx);
    return tiles;
  }

  /** Le bâtiment se vide et devient abandonné (délabré) ; il peut être réhabilité ou démoli. */
  private abandonBuilding(idx: number, why: string): number[] {
    const w = this.world;
    const tiles = w.lotTiles(idx);
    for (const t of tiles) {
      this.evictTile(t);
      this.utilities.fire[t] = 0;
      this.utilities.problemDays[t] = 0;
      w.bState[t] = BuildState.Abandoned;
      w.bTimer[t] = 0;
    }
    if (this.dayCount - this.lastAbandonNote > 20) {
      this.lastAbandonNote = this.dayCount;
      this.events.emit('notify', { text: `Un bâtiment a été abandonné (${why})`, kind: 'warn', tile: idx });
    }
    return tiles;
  }
  private lastAbandonNote = -999;

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
        if (w.bState[k] === BuildState.Abandoned) v -= 0.04;
        if (w.bState[k] === BuildState.Built) {
          const z = w.zones[k], kd = kindOf(z);
          if (z === Zone.Agriculture) v += 0.004;
          else if (kd === Zone.Industrial) v -= 0.06;
          else if (z === Zone.Tourism) v += 0.03;
          else if (kd === Zone.Commercial) v += 0.025;
          else if (kd === Zone.Office) v += 0.02;
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
    if (cov & Coverage.Leisure) v += 0.05;
    v -= this.utilities.nuisance[idx];
    v -= this.utilities.air[idx] * 0.4 + this.utilities.noise[idx] * 0.2 + this.world.soilPol[idx] * 0.3;
    v += this.council.mod('landValue');
    if (this.districts.has(idx, 'parking')) v += 0.02;
    if (this.districts.has(idx, 'transit')) v += 0.03;
    return clamp(v, 0, 1);
  }

  /**
   * Critères d'évolution d'un bâtiment (§6) : demande, accessibilité, services, valeur foncière,
   * santé financière et main-d'œuvre. Chaque critère est affiché sur la fiche.
   */
  evolutionCriteria(idx: number): Array<[string, boolean]> {
    const w = this.world, ut = this.utilities, soc = this.society, c = soc.citizens;
    const a = w.anchorOf(idx);
    const level = w.bLevel[a];
    const zone = w.zones[a];
    const lot = w.lotTiles(a);
    const pop = this.stats.population;
    const out: Array<[string, boolean]> = [];
    out.push([`Demande suffisante (${Math.round((this.zoneDemand[zone] ?? 0) * 100)} %)`, (this.zoneDemand[zone] ?? 0) > 0.15]);
    out.push(['Accès routier', w.roadDist[a] <= ZONE_DEPTH]);
    out.push(['Électricité et eau', ut.hasUtility(a, Utility.Power) && ut.hasUtility(a, Utility.Water)]);
    if (level >= 2) out.push(['Évacuation des eaux usées', ut.hasUtility(a, Utility.Sewage)]);
    if (level >= 2 && hasHomes(zone)) out.push(['École à portée', (ut.coverage[a] & Coverage.Education) !== 0]);
    if (zone === Zone.Research) out.push(['École à portée', (ut.coverage[a] & Coverage.Education) !== 0]);
    const lvNeed = zone === Zone.Agriculture || kindOf(zone) === Zone.Industrial ? 0 : level === 1 ? 0.4 : 0.55;
    if (lvNeed) out.push([`Valeur foncière ≥ ${Math.round(lvNeed * 100)} %`, this.landValue(a) >= lvNeed]);
    if (hasHomes(zone)) {
      let taken = 0, homes = 0;
      for (const t of lot) { taken += c.homesTaken[t]; homes += soc.homesOf(t); }
      out.push(['Logements occupés à 80 %', homes > 0 && taken >= homes * 0.8]);
    }
    if (hasJobs(zone)) {
      let emp = 0, slots = 0, good = 0;
      for (const t of lot) { emp += c.employees[t]; slots += soc.slotsOf(t, 0) + soc.slotsOf(t, 1) + soc.slotsOf(t, 2); good = Math.max(good, soc.goodMonths[t]); }
      out.push(['Entreprise rentable (2 mois)', good >= 2]);
      out.push(['Travailleurs disponibles (70 % des postes)', slots > 0 && emp >= slots * 0.7]);
    }
    const popNeed = kindOf(zone) === Zone.Industrial ? (level === 1 ? 250 : 1500) : level === 1 ? 200 : 1500;
    out.push([`Population ≥ ${popNeed.toLocaleString('fr-FR')}`, pop > popNeed || this.sandbox]);
    return out;
  }

  private canUpgrade(idx: number): boolean {
    return this.evolutionCriteria(idx).every(([label, ok]) => ok || label.startsWith('Demande') || label.startsWith('Travailleurs'));
  }

  /** Qualité du terrain pour un nouveau bâtiment (0 = impossible), selon les nuisances et la valeur foncière (§5). */
  siteScore(idx: number, zone: ZoneId): number {
    const s0 = this.siteScoreBase(idx, zone);
    if (!s0) return 0;
    const d = this.districts;
    if (!d.allowsIndustry(idx, zone)) return 0;
    let f = 1 - d.taxMod(idx, kindOf(zone)) * 0.06;
    if (kindOf(zone) === Zone.Commercial && d.has(idx, 'commerce')) f += 0.3;
    return s0 * Math.max(0.1, f);
  }

  private siteScoreBase(idx: number, zone: ZoneId): number {
    const info = ZONE_INFO[zone];
    const ut = this.utilities;
    if (ut.noise[idx] > info.noiseTolerance) return 0;
    if (zone === Zone.Mixed) {
      // Pas d'industrie bruyante à proximité, pas de desserte par autoroute seule
      if (ut.air[idx] > 0.3) return 0;
    }
    const lv = this.society.landValue[idx] || this.landValue(idx);
    if (zone === Zone.ResidentialHigh || zone === Zone.CommercialDense || zone === Zone.Office || zone === Zone.Research) return 0.4 + lv;
    if (zone === Zone.Agriculture) return (1.3 - lv) * (this.world.resources[idx] & Resource.Fertile ? 1.4 : 0.7);
    if (zone === Zone.Mining) return this.world.resources[idx] & Resource.Ore ? 1.2 : 0;
    if (zone === Zone.Forestry) return 1.2 - lv * 0.5;
    if (zone === Zone.Tourism) return 0.3 + lv + (ut.coverage[idx] & Coverage.Park ? 0.4 : 0);
    return 1;
  }

  /** Cherche une parcelle (forme choisie selon la zone) contenant la case, dont la façade touche une route (§5). */
  findParcel(idx: number, zone: ZoneId, shapes?: LotShape[]): [number, number, number, number, number] | null {
    const w = this.world, n = w.size;
    const info = ZONE_INFO[zone];
    const list = [...(shapes ?? info.lots)];
    // Tirage pondéré de l'ordre d'essai
    const order: LotShape[] = [];
    while (list.length) {
      const total = list.reduce((a, l) => a + l[2], 0);
      let r = this.rand() * total, k = 0;
      while (k < list.length - 1 && (r -= list[k][2]) > 0) k++;
      order.push(list.splice(k, 1)[0]);
    }
    const i = idx % n, j = Math.floor(idx / n);
    const free = (t: number) => w.zones[t] === zone && w.bState[t] === BuildState.Empty && !w.rubble[t] && !w.flooded[t] && !w.powerLine[t] && w.lotRoot[t] < 0 && w.roadDist[t] <= ZONE_DEPTH;
    for (const [front, depth] of order) {
      if (front * depth === 1) return null; // une seule case
      const faces = [S, E, N, W].sort(() => this.rand() - 0.5);
      for (const face of faces) {
        const gw = face === N || face === S ? front : depth;
        const gh = face === N || face === S ? depth : front;
        for (let j0 = j - gh + 1; j0 <= j; j0++) for (let i0 = i - gw + 1; i0 <= i; i0++) {
          if (!w.inBounds(i0, j0) || !w.inBounds(i0 + gw - 1, j0 + gh - 1)) continue;
          let ok = true;
          for (let b = j0; b < j0 + gh && ok; b++) for (let a = i0; a < i0 + gw; a++) if (!free(b * n + a)) { ok = false; break; }
          if (!ok) continue;
          // Façade : toute la largeur doit toucher une route ouverte aux voitures
          let road = true;
          for (let s2 = 0; s2 < front && road; s2++) {
            const [a, b] = face === S ? [i0 + s2, j0 + gh] : face === N ? [i0 + s2, j0 - 1] : face === E ? [i0 + gw, j0 + s2] : [i0 - 1, j0 + s2];
            road = w.inBounds(a, b) && w.tiles[b * n + a] === Tile.Road && w.roadType[b * n + a] !== RoadType.Highway;
          }
          if (!road || w.rectSlope(i0, j0, gw, gh) > info.maxSlope) continue;
          return [i0, j0, gw, gh, face];
        }
      }
    }
    return null;
  }

  /** Occupants de toutes les cases d'un bâtiment. */
  lotOccupants(idx: number): number {
    return this.world.lotTiles(idx).reduce((a, t) => a + this.occupants(t), 0);
  }

  /** Annonce groupée des évolutions, sans bloquer le joueur (§6). */
  private announceEvolutions(): void {
    const w = this.world;
    const list = this.evolved.filter((k) => w.bState[k] === BuildState.Built);
    this.evolved = [];
    if (!list.length) return;
    const top = list.filter((k) => w.bLevel[k] === 3).length;
    const name = ZONE_INFO[w.zones[list[0]] as ZoneId]?.buildings.split(',')[0].toLowerCase() ?? 'bâtiment';
    const text = list.length === 1
      ? `Un bâtiment évolue au niveau ${w.bLevel[list[0]]} (${name})`
      : `${list.length} bâtiments ont évolué${top ? `, dont ${top} au niveau 3` : ''}`;
    this.events.emit('notify', { text, kind: 'info', tile: list[list.length - 1] });
    this.events.emit('buildingsEvolved', { tiles: list });
  }

  /** Habitants (logements) ou employés (entreprises) réellement présents. */
  occupants(idx: number): number {
    const c = this.society.citizens;
    return c.residents[idx] + c.employees[idx];
  }

  /** Ferme une entreprise en faillite : employés licenciés, bâtiment vidé (la zone reste). */
  closeBusiness(k: number): void {
    const w = this.world;
    const tiles = w.lotTiles(k);
    // Zone mixte : seule la boutique ferme, les logements restent
    if (w.zones[k] === Zone.Mixed) {
      for (const t of tiles) this.society.citizens.fireAll(t);
      this.events.emit('notify', { text: 'Une boutique de zone mixte a fermé (manque de clients)', kind: 'warn', tile: k });
      return;
    }
    this.clearBuilding(k);
    this.events.emit('buildingsChanged', { tiles });
    this.events.emit('notify', { text: 'Une entreprise a fait faillite et fermé (manque de clients, de marchandises ou de personnel)', kind: 'warn', tile: k });
  }

  /** Habitants que le bâtiment peut loger (par case). */
  homeCapacity(idx: number): number {
    const w = this.world;
    if (w.bState[idx] !== BuildState.Built) return 0;
    const base = zoneInfo(w.zones[idx])?.homes[w.bLevel[idx] - 1] ?? 0;
    return w.bDamage[idx] ? Math.round(base * (1 - w.bDamage[idx] / 100)) : base;
  }

  /** Emplois offerts par le bâtiment (par case). */
  jobCapacity(idx: number): number {
    const w = this.world;
    if (w.bState[idx] !== BuildState.Built) return 0;
    const base = zoneInfo(w.zones[idx])?.jobs[w.bLevel[idx] - 1] ?? 0;
    return w.bDamage[idx] ? Math.round(base * (1 - w.bDamage[idx] / 100)) : base;
  }

  /** Capacité totale (habitants + emplois). */
  capacity(idx: number): number {
    return this.homeCapacity(idx) + this.jobCapacity(idx);
  }

  recomputeStats(): void {
    const w = this.world;
    const jobs = zeroByZone();
    let buildings = 0;
    for (const idx of this.zonedTiles()) {
      if (w.bState[idx] !== BuildState.Built) continue;
      buildings++;
      const jk = jobKind(w.zones[idx]);
      if (jk) jobs[jk] += this.jobCapacity(idx);
    }
    const cz = this.society.citizens;
    const population = cz.population;
    let employed = 0, jobless = 0, joblessHigh = 0, joblessLow = 0;
    for (let c = 0; c < cz.count; c++) {
      if (!cz.alive[c]) continue;
      if (cz.status[c] === Status.Worker) employed++;
      else if (cz.status[c] === Status.Unemployed) { jobless++; if (cz.edu[c] >= 3) joblessHigh++; if (cz.edu[c] <= 1) joblessLow++; }
    }
    this.utilities.happinessOffset = -(this.taxes[Zone.Residential] - DEFAULT_TAX) * 0.012 + this.env.happiness;
    this.utilities.consumptionMul = this.env.consumption(this.monthIndex);
    this.utilities.happinessOffset -= this.disasters.malus;
    this.utilities.happinessOffset += this.council.mod('happiness');
    this.utilities.offline = this.disasters.offline;
    this.utilities.windFactor = this.env.windFactor;
    this.utilities.solarFactor = this.env.solarFactor(this.monthIndex);
    this.utilities.hydroFactor = this.env.hydroFactor(this.monthIndex);
    this.utilities.waterFactor = this.env.waterFactor;
    // Camions de marchandises selon les flux de la chaîne de production
    const ch = this.society.chain;
    this.traffic.freight = { share: clamp(0.08 + ch.trucks / (ch.trucks + 200000) * 0.25, 0.08, 0.3), raw: ch.rawLocal + ch.rawExport, goods: ch.goodsLocal + ch.goodsExport, food: ch.foodLocal, imports: ch.goodsImport + ch.foodImport + ch.rawImport };
    this.utilities.compute();
    const wst = this.waste.stats;
    this.utilities.stats.demand[Utility.Garbage] = wst.produced;
    this.utilities.stats.supply[Utility.Garbage] = wst.capacity + Math.min(wst.landfillCap - wst.landfillUsed, wst.produced);
    this.computeParking();
    const totalJobs = jobs[Zone.Commercial] + jobs[Zone.Industrial] + jobs[Zone.Office];
    const workers = employed + jobless;
    const unemployment = workers ? jobless / workers : 0;

    // Demande calculée à partir des ménages, des emplois, des logements et des entreprises (§22)
    const soc = this.society, bs = soc.stats;
    const demand = zeroByZone();
    const happy = population ? this.utilities.stats.happiness : 0.6;
    const open = bs.openJobs[0] + bs.openJobs[1] + bs.openJobs[2];
    demand[Zone.Residential] = clamp(0.3 + (open - jobless) / (population * 0.4 + 40) + (0.06 - soc.vacancy) * 5 + (happy - 0.55) * 0.8 - Math.max(0, soc.citizens.summaryBurden - 0.35));
    const cSlots = bs.slots[0] + bs.slots[1] + bs.slots[2];
    void cSlots;
    const comCap = jobs[Zone.Commercial] * 2600 + 2000;
    const cm = bs.avgMargin[Zone.Commercial];
    demand[Zone.Commercial] = population ? clamp((bs.spending / comCap - 1) * 0.6 + (cm !== undefined ? cm * 3 : 0.3) + (jobless / Math.max(1, workers)) * 0.8) : -0.2;
    const im = bs.avgMargin[Zone.Industrial];
    demand[Zone.Industrial] = population ? clamp(Math.max(-0.5, (bs.goodsDemand - bs.goodsProduced) / (bs.goodsDemand + bs.goodsProduced + 5000)) * 0.6 + (joblessLow / Math.max(1, workers)) * 2 + (im !== undefined ? im * 2 : 0.25)) : -0.2;
    demand[Zone.Office] = this.isUnlocked(Zone.Office) ? clamp((joblessHigh * 2 + soc.citizens.underemployedCount - bs.openJobs[2]) / (population * 0.04 + 15) + (this.demo.education - 0.3)) : 0;
    // Les impôts élevés freinent la demande, les impôts bas l'encouragent
    for (const z of [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as ZoneType[]) {
      if (z !== Zone.Office || this.isUnlocked(z)) demand[z] = clamp(demand[z] - (this.taxes[z] - DEFAULT_TAX) * 0.035);
    }
    this.computeZoneDemand(demand, population);

    // Recettes
    // Impôt sur le revenu des ménages et impôt sur les bénéfices des entreprises
    const incomeBy: Record<string, number> = soc.taxIncome(this.taxes, 1);
    incomeBy.tickets = this.transit.ticketRevenue;
    let taxis = 0, airports = 0;
    for (let k = 0; k < w.service.length; k++) { if (w.service[k] === Service.TaxiDepot) taxis++; else if (w.service[k] === Service.Airport) airports++; }
    this.transit.taxiFleet = Math.round(taxis * 10 * (this.budgets.transport / 100));
    this.transit.population = population;
    incomeBy.taxi = taxis * 10 * 40;
    // Aéroport : redevances selon les voyageurs (habitants, affaires, touristes)
    this.airportPassengers = airports ? Math.round(population * 0.4 + this.tourismAppeal * 6000) * airports : 0;
    incomeBy.airport = this.airportPassengers * 1.5;
    incomeBy.leisure = this.tourism.lastIncome;
    // Ventes aux villes voisines et revente des matériaux recyclés
    const ps = this.utilities.stats.power, ws = this.utilities.stats.water;
    incomeBy.energy = ps.exported * POWER_EXPORT_PRICE;
    incomeBy.recycling = this.waste.stats.recyclingIncome;

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
    expensesBy.transport += this.transit.operatingCost + stops * 10 * (this.budgets.transport / 100);
    expensesBy.loans = this.loans.reduce((sum, l) => sum + l.payment, 0);
    expensesBy.reconstruction = this.repairAccum;
    expensesBy.imports = ps.imported * POWER_IMPORT_PRICE + ws.imported * WATER_IMPORT_PRICE;
    // Entretien du patrimoine (routes et équipements) et politiques de quartier
    let svcUpkeep = 0;
    for (let k = 0; k < w.service.length; k++) if (w.service[k]) svcUpkeep += SERVICE_INFO[w.service[k] as Exclude<Service, Service.None>].upkeep;
    expensesBy.maintenance = (this.roadCount * 1.2 + svcUpkeep * 0.12) * (this.budgets.maintenance / 100);
    const pol = this.districts.budget();
    expensesBy.policies = pol.cost;
    expensesBy.events = this.tourism.lastCost;
    incomeBy.fees = pol.income;
    for (const k in incomeBy) incomeBy[k] = Math.round(incomeBy[k] * (['tickets', 'energy', 'recycling', 'fees', 'taxi', 'airport', 'leisure'].includes(k) ? 1 : this.incomeMul));
    for (const k in expensesBy) expensesBy[k] = Math.round(expensesBy[k]);
    const income = Object.values(incomeBy).reduce((a, b) => a + b, 0);
    const expenses = Object.values(expensesBy).reduce((a, b) => a + b, 0);

    this.traffic.refreshBuildings((idx) => this.occupants(idx));
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
    this.accidentsLastMonth = this.accidentsThisMonth;
    this.accidentsThisMonth = 0;
    const us = this.utilities.stats;
    void us;
    this.tourism.monthly();
    this.society.monthly();
    this.waste.monthly();
    this.council.monthly();
    this.syncDemographics();
    this.popAtMonthStart = this.stats.population;
    this.accumulateSoil();
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
    const investTotal = Object.entries(this.investMonth).filter(([k]) => k !== 'debt').reduce((a, [, v]) => a + v, 0);
    this.ledger.push({
      month: this.monthIndex, incomeBy: { ...this.stats.incomeBy }, expensesBy: { ...this.stats.expensesBy }, invest: { ...this.investMonth },
      income: this.stats.income, expenses: this.stats.expenses, investTotal: Math.round(investTotal), debt: Math.round(this.debt), money: Math.round(this.money + net),
    });
    if (this.ledger.length > 60) this.ledger.shift();
    this.investMonth = {};
    this.repairLastMonth = this.repairAccum;
    this.repairAccum = 0;
    if (net !== 0 && !this.sandbox) {
      this.money += net;
      this.events.emit('moneyChanged', this.money);
    }
  }

  /** Dépense ponctuelle, comptée comme investissement du mois (sauf remboursement de dette). */
  private spend(amount: number, category = 'other'): void {
    if (amount > 0) this.investMonth[category] = (this.investMonth[category] ?? 0) + amount;
    if (this.sandbox) return;
    this.money -= amount;
    this.events.emit('moneyChanged', this.money);
  }

  /** Investissement décidé hors construction (projets du conseil, rénovations). */
  payInvestment(amount: number, category: string): void {
    this.spend(amount, category);
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

  /** Ouvrage des routes tracées : au sol, en tunnel ou en viaduc. */
  roadStructure: 'ground' | 'tunnel' | 'elevated' = 'ground';

  estimateRoads(path: number[], type: RoadType = RoadType.Street): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    const info = ROAD_INFO[type];
    const structure = type === RoadType.Pedestrian ? 'ground' : this.roadStructure;
    if (structure !== 'ground') {
      // Tunnels et viaducs : ignorent le relief et l'eau, sans terrassement
      const mul = structure === 'tunnel' ? TUNNEL_COST_MUL : ELEVATED_COST_MUL;
      const onPath2 = new Set(path);
      for (const idx of path) {
        const i = idx % w.size, j = Math.floor(idx / w.size);
        if (w.tiles[idx] === Tile.Road) {
          const follows = w.neighbors(idx).every((q) => onPath2.has(q));
          const flag = structure === 'tunnel' ? RoadFlag.Tunnel : RoadFlag.Elevated;
          if (follows && (w.roadType[idx] !== type || !(w.roadFlags[idx] & flag))) { out.valid.push(idx); out.cost += info.cost * mul; }
          continue;
        }
        const bad = !w.inBounds(i, j) ? 'Hors de la carte' : w.service[idx] || w.annex[idx] ? 'Case occupée par un équipement' : w.rail[idx] ? 'Voie ferrée sur la case' : null;
        if (bad) { out.invalid.push(idx); out.reason ??= bad; continue; }
        out.valid.push(idx);
        out.cost += info.cost * mul;
      }
      return out;
    }
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
    const structure = type === RoadType.Pedestrian ? 'ground' : this.roadStructure;
    for (const idx of est.valid) {
      if (w.tiles[idx] !== Tile.Road) { added++; w.condition[idx] = 100; }
      w.tiles[idx] = Tile.Road;
      w.roadType[idx] = type;
      w.roadFlags[idx] = (w.roadFlags[idx] & ~(RoadFlag.Tunnel | RoadFlag.Elevated)) | (structure === 'tunnel' ? RoadFlag.Tunnel : structure === 'elevated' ? RoadFlag.Elevated : 0);
      if (type === RoadType.Pedestrian || type === RoadType.Highway) w.roadFlags[idx] &= ~(RoadFlag.Tram | RoadFlag.Zone30);
      const lim = LANES[type];
      if (w.lanes[idx] && (w.lanes[idx] < lim[1] || w.lanes[idx] > lim[2])) w.lanes[idx] = 0;
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
      if (structure !== 'ground') break;
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
    this.spend(est.cost, 'roads');
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

  /** Demande de chaque type de zone : densités, zone mixte et zones spécialisées (§5). */
  private computeZoneDemand(demand: Record<ZoneType, number>, population: number): void {
    const w = this.world, soc = this.society, us = this.utilities.stats;
    const jobsOf: Record<number, number> = {};
    for (const idx of this.zonedTiles()) if (w.bState[idx] === BuildState.Built) jobsOf[w.zones[idx]] = (jobsOf[w.zones[idx]] ?? 0) + this.jobCapacity(idx);
    const j = (z: Zone) => jobsOf[z] ?? 0;
    const happy = population ? us.happiness : 0.6;
    // Attrait touristique : parcs, eau, bonheur, sécurité
    this.tourismAppeal = clamp(this.council.mod('tourism') + this.transportAppeal() + this.tourism.attraction() * 0.3 + (us.coverage[Coverage.Park] ?? 0) * 0.5 + (happy - 0.4) * 0.8 + (1 - this.crimeIndex) * 0.2 + Math.min(0.2, population / 20000), 0, 1);
    const bs = soc.stats;
    const d: Record<number, number> = {};
    d[Zone.ResidentialLow] = demand[Zone.Residential] + 0.05;
    d[Zone.Residential] = demand[Zone.Residential];
    d[Zone.ResidentialHigh] = demand[Zone.Residential] + (population > 3000 ? 0.1 : -0.05);
    d[Zone.Commercial] = demand[Zone.Commercial];
    d[Zone.CommercialDense] = demand[Zone.Commercial] + (population > 4000 ? 0.1 : -0.1);
    d[Zone.Office] = demand[Zone.Office] + (w.service.includes(Service.Airport) ? 0.1 : 0);
    d[Zone.Industrial] = demand[Zone.Industrial];
    d[Zone.Mixed] = (demand[Zone.Residential] + demand[Zone.Commercial]) / 2 + 0.05;
    d[Zone.Agriculture] = demand[Zone.Industrial] * 0.5 + 0.2 - j(Zone.Agriculture) / (population * 0.05 + 40);
    const ch = soc.chain;
    const rawShort = ch.rawNeed ? ch.rawImport / ch.rawNeed : 0;
    d[Zone.Forestry] = demand[Zone.Industrial] * 0.4 + rawShort * 0.5 + 0.05 - j(Zone.Forestry) / (population * 0.04 + 30);
    d[Zone.Mining] = demand[Zone.Industrial] * 0.4 + rawShort * 0.6 + 0.05 - j(Zone.Mining) / (population * 0.04 + 30);
    // La demande industrielle tient compte des débouchés (invendus) et de la logistique (§22)
    if (ch.unsold > 0) d[Zone.Industrial] = (d[Zone.Industrial] ?? 0) - Math.min(0.4, ch.unsold / (ch.produced + 1));
    d[Zone.Logistics] = demand[Zone.Industrial] * 0.4 + (bs.goodsDemand ? (bs.imports / bs.goodsDemand) * 0.6 : 0) - j(Zone.Logistics) / (population * 0.04 + 30);
    d[Zone.Research] = this.isUnlocked(Zone.Research) ? demand[Zone.Office] * 0.6 + (this.demo.education - 0.35) - j(Zone.Research) / (population * 0.02 + 20) : 0;
    d[Zone.Tourism] = this.isUnlocked(Zone.Tourism) ? this.tourismAppeal * 0.8 - 0.1 - j(Zone.Tourism) / (population * 0.03 + 30) : 0;
    for (const z in d) d[z] = clamp(d[z] - (this.taxes[kindOf(Number(z)) as ZoneType] - DEFAULT_TAX) * (Number(z) > 4 ? 0.035 : 0));
    this.zoneDemand = d;
  }

  // ---------- Zonage ----------

  estimateZone(area: number[], zone: Zone): { valid: number[]; invalid: number[]; reason: string | null } {
    const w = this.world;
    const out = { valid: [] as number[], invalid: [] as number[], reason: null as string | null };
    if (zone !== Zone.None && !this.isUnlocked(zone)) {
      out.reason = `Débloqué à ${ZONE_INFO[zone as ZoneId].unlockPop.toLocaleString('fr-FR')} habitants`;
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
    const reason = info.footprint ? this.footprintBlocker(idx, type) : w.serviceBlocker(i, j, type);
    if (reason) return { ok: false, reason, cost: info.cost };
    const near = (pred: (k: number) => boolean) => { for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) if (w.inBounds(a, b) && pred(w.index(a, b))) return true; return false; };
    if (info.needsRail && !near((k) => w.rail[k] === 1)) return { ok: false, reason: 'Une gare doit toucher une voie ferrée', cost: info.cost };
    if (info.needsTram && !near((k) => (w.roadFlags[k] & RoadFlag.Tram) !== 0)) return { ok: false, reason: 'Le dépôt doit toucher une voie de tram', cost: info.cost };
    if (info.cost > this.money) return { ok: false, reason: 'Fonds insuffisants', cost: info.cost };
    return { ok: true, reason: null, cost: info.cost };
  }

  /** Grand équipement : toutes les cases de l'emprise doivent être libres et assez plates, avec une route le long. */
  private footprintBlocker(root: number, type: Service): string | null {
    const w = this.world, n = w.size, info = SERVICE_INFO[type as Exclude<Service, Service.None>];
    const [fw, fh] = info.footprint!;
    const i0 = root % n, j0 = Math.floor(root / n);
    if (!w.inBounds(i0 + fw - 1, j0 + fh - 1)) return 'Hors de la carte';
    let road = false, water = false;
    for (let j = j0; j < j0 + fh; j++) for (let i = i0; i < i0 + fw; i++) {
      const k = j * n + i;
      if (w.tiles[k] === Tile.Road) return 'Une route traverse l’emprise';
      if (w.service[k] || w.annex[k]) return 'Emprise occupée par un équipement';
      if (w.bState[k]) return 'Emprise occupée par un bâtiment';
      if (w.rail[k]) return 'Une voie ferrée traverse l’emprise';
      if (w.isWater(i, j)) return "Impossible de construire sur l'eau";
      if (w.roadDist[k] === 1) road = true;
    }
    for (let j = j0 - 2; j < j0 + fh + 2 && !water; j++) for (let i = i0 - 2; i < i0 + fw + 2; i++) if (w.inBounds(i, j) && w.isWater(i, j)) { water = true; break; }
    if (w.rectSlope(i0, j0, fw, fh) > 1) return 'Terrain trop pentu : aplanissez l’emprise';
    if (!road) return 'L’emprise doit longer une route';
    if (info.nearWater && !water) return "Doit être au bord de l'eau";
    return null;
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
    w.condition[idx] = 100;
    const fp = SERVICE_INFO[type as Exclude<Service, Service.None>].footprint;
    if (fp) {
      const n = w.size, i0 = idx % n, j0 = Math.floor(idx / n);
      for (let j = j0; j < j0 + fp[1]; j++) for (let i = i0; i < i0 + fp[0]; i++) {
        const k = j * n + i;
        if (k === idx) continue;
        w.annex[k] = idx + 1;
        if (w.zones[k]) { w.zones[k] = Zone.None; this.zonedDirty = true; }
        if (w.trees[k]) w.trees[k] = 0;
      }
      this.events.emit('treesChanged', undefined);
    }
    this.spend(est.cost, 'services');
    if (SERVICE_INFO[type as Exclude<Service, Service.None>].category === 'transport') { this.transit.refreshAll(); this.events.emit('transitChanged', undefined); }
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
    this.spend(BUS_STOP_COST, 'transport');
    this.events.emit('transitChanged', undefined);
    return true;
  }

  createLine(kind: TransitKind, stops: number[]): boolean {
    const line = this.transit.addLine(kind, stops);
    if (!line) return false;
    if (line.broken) {
      const why = line.reason || 'arrêts non reliés';
      this.transit.removeLine(line.id);
      this.events.emit('notify', { text: `Ligne impossible : ${why.charAt(0).toLowerCase()}${why.slice(1)}`, kind: 'warn' });
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
          this.spend(cost, 'terrain');
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
    this.spend(next.size * cost, 'terrain');
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

  // ---------- Aménagements des routes et voies ferrées (§4, §12) ----------

  /** Coût par case de chaque aménagement. */
  static readonly FLAG_COST: Record<number, number> = { [RoadFlag.Tram]: 40, [RoadFlag.Bike]: 6, [RoadFlag.BusLane]: 4, [RoadFlag.Zone30]: 2 };

  /** Cases où l'aménagement est possible, et raison sinon. */
  estimateRoadFlag(tiles: number[], flag: RoadFlag): CostEstimate & { remove: boolean } {
    const w = this.world;
    const out = { cost: 0, valid: [] as number[], invalid: [] as number[], reason: null as string | null, remove: false };
    const roads = tiles.filter((k) => w.tiles[k] === Tile.Road);
    out.remove = roads.length > 0 && roads.every((k) => w.roadFlags[k] & flag);
    for (const k of tiles) {
      if (w.tiles[k] !== Tile.Road) { out.invalid.push(k); continue; }
      const t = w.roadType[k] as RoadType;
      let bad: string | null = null;
      if (flag === RoadFlag.Tram && (t === RoadType.Highway || t === RoadType.Pedestrian)) bad = 'Le tram circule sur les rues et avenues';
      if (flag === RoadFlag.BusLane && w.lanesAt(k) < 2) bad = 'Voie de bus : il faut au moins 2 voies par sens (avenue, autoroute)';
      if (flag === RoadFlag.Bike && t === RoadType.Highway) bad = 'Pas de piste cyclable sur autoroute';
      if (flag === RoadFlag.Zone30 && (t === RoadType.Highway || t === RoadType.Pedestrian)) bad = 'Zone 30 : rues et avenues uniquement';
      if (bad && !out.remove) { out.invalid.push(k); out.reason ??= bad; continue; }
      out.valid.push(k);
      if (!out.remove) out.cost += Simulation.FLAG_COST[flag] ?? 0;
    }
    if (flag === RoadFlag.Tram && !this.isServiceUnlocked(Service.TramDepot)) { out.reason = 'Tramway débloqué à 2 500 habitants'; out.invalid = tiles; out.valid = []; }
    return out;
  }

  /** Pose ou retire un aménagement (voie de tram, piste cyclable, voie de bus, zone 30). */
  paintRoadFlag(tiles: number[], flag: RoadFlag): boolean {
    const est = this.estimateRoadFlag(tiles, flag);
    if (!est.valid.length) { if (est.reason) this.events.emit('notify', { text: est.reason, kind: 'warn' }); return false; }
    if (!this.sandbox && est.cost > this.money) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    const w = this.world;
    for (const k of est.valid) {
      if (est.remove) { w.roadFlags[k] &= ~flag; if (flag === RoadFlag.Tram && w.busStop[k] === 2) w.busStop[k] = 0; }
      else w.roadFlags[k] |= flag;
    }
    this.spend(est.cost, 'transport');
    this.transit.refreshAll();
    this.recomputeStats();
    this.events.emit('roadsChanged', { tiles: est.valid });
    this.events.emit('transitChanged', undefined);
    return true;
  }

  /** Ajoute ou retire une voie par sens sur des cases de route. */
  setLanes(tiles: number[], delta: number): boolean {
    const w = this.world;
    const changed: number[] = [];
    let cost = 0;
    for (const k of tiles) {
      if (w.tiles[k] !== Tile.Road) continue;
      const [, lo, hi] = LANES[w.roadType[k] as RoadType];
      const cur = w.lanesAt(k), next = Math.max(lo, Math.min(hi, cur + delta));
      if (next === cur) continue;
      changed.push(k);
      if (delta > 0) cost += 25 * (w.roadType[k] === RoadType.Highway ? 2 : 1);
    }
    if (!changed.length) { this.events.emit('notify', { text: delta > 0 ? 'Nombre maximal de voies atteint pour ce type de route' : 'Nombre minimal de voies atteint', kind: 'warn' }); return false; }
    if (!this.sandbox && cost > this.money) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    for (const k of changed) {
      w.lanes[k] = Math.max(1, w.lanesAt(k) + delta);
      if (w.lanesAt(k) < 2) w.roadFlags[k] &= ~RoadFlag.BusLane;
    }
    this.spend(cost, 'roads');
    this.events.emit('roadsChanged', { tiles: changed });
    return true;
  }

  /** Voie ferrée : séparée des routes, peut les croiser (passage à niveau) et franchir l'eau. */
  estimateRail(path: number[]): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    if (!this.isServiceUnlocked(Service.TrainStation)) return { ...out, invalid: path, reason: 'Trains débloqués à 2 000 habitants' };
    for (const k of path) {
      if (w.rail[k]) continue;
      const i = k % w.size, j = Math.floor(k / w.size);
      const [lo, hi] = w.tileMinMax(i, j);
      const water = w.isWater(i, j);
      const steep = !water && hi - lo > MAX_ROAD_SLOPE && w.tiles[k] !== Tile.Road;
      const grade = steep && this.canGrade(i, j);
      const bad = w.service[k] || w.annex[k] ? 'Case occupée par un équipement' : w.bState[k] ? 'Un bâtiment occupe la case' : water && lo < -2.2 ? 'Eau trop profonde' : steep && !grade ? 'Terrain trop pentu : aplanissez-le' : null;
      if (bad) { out.invalid.push(k); out.reason ??= bad; continue; }
      out.valid.push(k);
      out.cost += RAIL_COST * (water ? BRIDGE_COST_MUL : 1) + w.trees[k] * TREE_CLEAR_COST + (grade ? GRADE_COST : 0);
      if (grade) out.graded = (out.graded ?? 0) + 1;
    }
    return out;
  }

  buildRail(path: number[]): boolean {
    const est = this.estimateRail(path);
    const w = this.world, n = w.size;
    if (est.invalid.length) { this.events.emit('notify', { text: est.reason ?? 'Tracé impossible', kind: 'warn' }); return false; }
    if (!this.sandbox && est.cost > this.money) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    let trees = false, zones = false;
    // Terrassement des cases trop pentues
    let graded = false;
    for (const k of est.valid) {
      const i = k % n, j = Math.floor(k / n);
      const [lo, hi] = w.tileMinMax(i, j);
      if (hi - lo <= MAX_ROAD_SLOPE || w.isWater(i, j) || w.tiles[k] === Tile.Road) continue;
      const corners = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
      const avg = corners.reduce((sum, [a, b]) => sum + w.corner(a, b), 0) / 4;
      for (const [a, b] of corners) if (!this.cornerLocked(a, b, true)) w.heights[b * (n + 1) + a] = avg + (w.corner(a, b) - avg) * 0.3;
      graded = true;
    }
    if (graded) this.events.emit('terrainChanged', undefined);
    for (const k of est.valid) {
      w.rail[k] = 1;
      if (w.trees[k]) { w.trees[k] = 0; trees = true; }
      if (w.zones[k]) { w.zones[k] = Zone.None; zones = true; this.zonedDirty = true; }
    }
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (dirIndex((b % n) - (a % n), Math.floor(b / n) - Math.floor(a / n)) >= 0) w.connectRail(a, b);
    }
    this.spend(est.cost, 'transport');
    if (trees) this.events.emit('treesChanged', undefined);
    if (zones) this.events.emit('zonesChanged', undefined);
    this.transit.refreshAll();
    this.recomputeStats();
    this.events.emit('railChanged', undefined);
    this.events.emit('transitChanged', undefined);
    return true;
  }

  /** Arrêt de tram sur une case de route équipée d'une voie de tram. */
  placeTramStop(idx: number): boolean {
    const w = this.world;
    if (!(w.roadFlags[idx] & RoadFlag.Tram) || w.tiles[idx] !== Tile.Road) { this.events.emit('notify', { text: 'Un arrêt de tram se place sur une voie de tram', kind: 'warn' }); return false; }
    if (w.busStop[idx] === 2) return false;
    if (!this.sandbox && this.money < 600) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    w.busStop[idx] = 2;
    this.spend(600, 'transport');
    this.events.emit('transitChanged', undefined);
    return true;
  }

  // ---------- Quartiers ----------

  /** Peint des cases dans un quartier (id 0 = retirer, -1 = nouveau quartier). Renvoie l'id utilisé. */
  paintDistrict(tiles: number[], id: number): number {
    if (id < 0) id = this.districts.create().id;
    const n = this.districts.paint(tiles, id);
    if (n || id) { this.recomputeStats(); this.events.emit('districtsChanged', undefined); }
    return id;
  }

  // ---------- Lignes haute tension ----------

  /** Cases où une ligne peut passer : au-dessus des routes, champs, arbres et de l'eau, pas sur les bâtiments. */
  estimatePowerLine(path: number[]): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    for (const k of path) {
      if (w.powerLine[k]) continue;
      const i = k % w.size, j = Math.floor(k / w.size);
      const bad = w.service[k] ? 'Un équipement occupe la case' : w.bState[k] ? 'Un bâtiment occupe la case' : w.isWater(i, j) && w.tileMinMax(i, j)[0] < -2.4 ? 'Eau trop profonde' : null;
      if (bad) { out.invalid.push(k); out.reason ??= bad; continue; }
      out.valid.push(k);
      out.cost += POWER_LINE_COST * (w.isWater(i, j) ? 2 : 1);
    }
    return out;
  }

  buildPowerLine(path: number[]): boolean {
    const est = this.estimatePowerLine(path);
    if (est.invalid.length) { this.events.emit('notify', { text: est.reason ?? 'Tracé impossible', kind: 'warn' }); return false; }
    if (!est.valid.length) return false;
    if (!this.sandbox && est.cost > this.money) { this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' }); return false; }
    for (const k of est.valid) this.world.powerLine[k] = 1;
    this.spend(est.cost, 'utilities');
    this.recomputeStats();
    this.events.emit('powerLinesChanged', undefined);
    return true;
  }

  // ---------- Bibliothèque : placement manuel, déplacement, amélioration (§6) ----------

  /** Coût de construction d'un modèle de la bibliothèque. */
  constructionCost(zone: ZoneId, level: number, tiles: number): number {
    return Math.round(ZONE_INFO[zone].cost * tiles * level);
  }

  /** Coût d'amélioration au niveau suivant. */
  upgradeCost(idx: number): number {
    const w = this.world, a = w.anchorOf(idx);
    const info = zoneInfo(w.zones[a]);
    return info ? Math.round(info.cost * w.lotTiles(a).length * (w.bLevel[a] + 1) * 0.5) : 0;
  }

  /** Coût de démolition (moitié prix pour un bâtiment abandonné). */
  demolishCost(idx: number): number {
    const w = this.world, a = w.anchorOf(idx);
    return Math.round(w.lotTiles(a).length * (20 + 15 * Math.max(1, w.bLevel[a])) * (w.bState[a] === BuildState.Abandoned ? 0.5 : 1));
  }

  /** Entretien mensuel à la charge du propriétaire (indicatif). */
  ownerUpkeep(idx: number): number {
    const w = this.world, a = w.anchorOf(idx);
    const info = zoneInfo(w.zones[a]);
    return info ? Math.round(info.cost * w.lotTiles(a).length * Math.max(1, w.bLevel[a]) * 0.004) : 0;
  }

  /** Rectangle occupé par un modèle posé en (i, j) avec la façade orientée vers `face`. */
  placementRect(spec: BuildingSpec, i: number, j: number, face: number): [number, number, number, number] {
    const gw = face === E || face === W ? spec.depth : spec.front;
    const gh = face === E || face === W ? spec.front : spec.depth;
    return [i - Math.floor((gw - 1) / 2), j - Math.floor((gh - 1) / 2), gw, gh];
  }

  /** Cases de route le long de la façade d'un rectangle. */
  private frontRoads(rect: [number, number, number, number], face: number): number {
    const w = this.world;
    const [i0, j0, gw, gh] = rect;
    let c = 0;
    const len = face === N || face === S ? gw : gh;
    for (let s2 = 0; s2 < len; s2++) {
      const [a, b] = face === S ? [i0 + s2, j0 + gh] : face === N ? [i0 + s2, j0 - 1] : face === E ? [i0 + gw, j0 + s2] : [i0 - 1, j0 + s2];
      if (w.inBounds(a, b) && w.carsAllowed(w.index(a, b))) c++;
    }
    return c;
  }

  /**
   * Vérifie le terrain pour un placement manuel : emprise libre, pente, route sur la façade,
   * distance de sécurité, raccordement (avertissement), coût (§6).
   * face = 0 : orientation automatique vers la route.
   */
  estimatePlace(spec: BuildingSpec, i: number, j: number, face = 0, ignore?: Set<number>, costMul = 1): PlaceEstimate {
    const w = this.world, n = w.size;
    const info = ZONE_INFO[spec.zone];
    if (!face) {
      let best = S, bestN = -1;
      for (const f of [S, E, N, W]) { const c = this.frontRoads(this.placementRect(spec, i, j, f), f); if (c > bestN) { bestN = c; best = f; } }
      face = best;
    }
    const rect = this.placementRect(spec, i, j, face);
    const [i0, j0, gw, gh] = rect;
    const out: PlaceEstimate = { ok: false, tiles: [], invalid: [], reasons: [], warnings: [], cost: 0, rect, face };
    const reason = (r: string) => { if (!out.reasons.includes(r)) out.reasons.push(r); };
    let trees = 0;
    for (let b = j0; b < j0 + gh; b++) for (let a = i0; a < i0 + gw; a++) {
      if (!w.inBounds(a, b)) { reason('Hors de la carte'); continue; }
      const k = b * n + a;
      out.tiles.push(k);
      let bad: string | null = null;
      if (w.isWater(a, b)) bad = "Impossible de construire sur l'eau";
      else if (w.tiles[k] === Tile.Road) bad = 'Emprise occupée par une route';
      else if (w.service[k] && !ignore?.has(k)) bad = 'Emprise occupée par un équipement';
      else if (w.bState[k] && !ignore?.has(k)) bad = 'Emprise occupée par un bâtiment';
      else if (w.rubble[k]) bad = 'Gravats à déblayer';
      else if (w.powerLine[k]) bad = 'Ligne haute tension au-dessus';
      if (bad) { out.invalid.push(k); reason(bad); }
      trees += w.trees[k];
    }
    if (!this.isUnlocked(spec.zone)) reason(`Débloqué à ${info.unlockPop.toLocaleString('fr-FR')} habitants`);
    if (out.tiles.length === gw * gh && w.rectSlope(i0, j0, gw, gh) > info.maxSlope) { reason('Pente trop forte : aplanissez le terrain'); out.invalid.push(...out.tiles); }
    if (!this.frontRoads(rect, face)) reason('Absence de route devant la façade (R pour pivoter)');
    // Distance de sécurité entre industrie et logements
    const polluting = kindOf(spec.zone) === Zone.Industrial && spec.zone !== Zone.Agriculture;
    if (polluting || hasHomes(spec.zone)) {
      let conflict = false;
      for (let b = j0 - 2; b < j0 + gh + 2 && !conflict; b++) for (let a = i0 - 2; a < i0 + gw + 2; a++) {
        if (!w.inBounds(a, b)) continue;
        const k = b * n + a;
        if (!w.bState[k] || ignore?.has(k)) continue;
        const z = w.zones[k];
        const other = kindOf(z) === Zone.Industrial && z !== Zone.Agriculture;
        if ((polluting && hasHomes(z)) || (hasHomes(spec.zone) && other)) { conflict = true; break; }
      }
      if (conflict) reason('Distance de sécurité insuffisante (industrie et logements à moins de 3 cases)');
    }
    // Raccordement : prévenir sans bloquer
    const probe = out.tiles.find((k) => !out.invalid.includes(k));
    if (probe !== undefined) {
      const miss = this.utilities.missing(probe);
      if (miss.length) out.warnings.push(`Pas encore raccordé : ${miss.map((u) => (u === Utility.Power ? 'électricité' : 'eau')).join(' et ')}`);
      else if (this.utilities.noise[probe] > info.noiseTolerance) out.warnings.push('Quartier trop bruyant pour ce type de bâtiment');
    }
    out.cost = Math.round((this.constructionCost(spec.zone, spec.level, gw * gh) + trees * TREE_CLEAR_COST) * costMul);
    if (!this.sandbox && out.cost > this.money) reason('Fonds insuffisants');
    out.ok = out.reasons.length === 0;
    return out;
  }

  /** Pose un bâtiment de la bibliothèque. */
  placeBuilding(spec: BuildingSpec, i: number, j: number, face = 0, keep?: { id: number; variant: number }): boolean {
    const est = this.estimatePlace(spec, i, j, face);
    if (!est.ok) { this.events.emit('notify', { text: est.reasons[0], kind: 'warn' }); return false; }
    this.build(spec, est, keep, keep ? 2 : 4);
    this.spend(est.cost, 'buildings');
    this.events.emit('notify', { text: `${ZONE_INFO[spec.zone].name} posé (${est.rect[2]}×${est.rect[3]} cases)`, kind: 'info', tile: est.tiles[0] });
    return true;
  }

  private build(spec: BuildingSpec, est: PlaceEstimate, keep: { id: number; variant: number } | undefined, days: number): void {
    const w = this.world;
    const [i0, j0, gw, gh] = est.rect;
    const anchor = w.index(i0, j0);
    let trees = false;
    for (const t of est.tiles) {
      w.zones[t] = spec.zone;
      w.rubble[t] = 0;
      if (w.trees[t]) { w.trees[t] = 0; trees = true; }
    }
    w.setLot(anchor, gw, gh);
    w.bFace[anchor] = est.face;
    w.bStyle[anchor] = spec.style;
    w.bManual[anchor] = 1;
    const id = keep?.id ?? this.nextBuildingId++;
    const variant = keep?.variant ?? spec.variant ?? Math.floor(this.rand() * MODEL_VARIANTS);
    for (const t of est.tiles) {
      w.bState[t] = BuildState.Construction;
      w.bLevel[t] = spec.level;
      w.bVariant[t] = variant;
      w.bTimer[t] = days;
      w.bId[t] = id;
    }
    this.zonedDirty = true;
    if (trees) this.events.emit('treesChanged', undefined);
    this.recomputeStats();
    this.events.emit('zonesChanged', undefined);
    this.events.emit('buildingsChanged', { tiles: est.tiles });
  }

  /** Modèle équivalent à un bâtiment existant (pour le déplacer). */
  specOf(idx: number): BuildingSpec | null {
    const w = this.world, a = w.anchorOf(idx);
    if (!w.bState[a] || !w.zones[a]) return null;
    const [gw, gh] = w.lotDims(a);
    const face = w.faceOf(a);
    const front = face === E || face === W ? gh : gw;
    const depth = face === E || face === W ? gw : gh;
    return { zone: w.zones[a] as ZoneId, level: Math.max(1, w.bLevel[a]), front, depth, style: w.bStyle[a], variant: w.bVariant[a] };
  }

  /** Coût d'un déplacement : 30 % de la construction. */
  static readonly MOVE_COST = 0.3;

  /** Estimation du déplacement d'un bâtiment (ou d'un équipement) vers (i, j). */
  estimateMove(from: number, i: number, j: number, face = 0): PlaceEstimate | null {
    const w = this.world;
    if (w.service[from]) {
      const svc = w.service[from] as Service;
      const info = SERVICE_INFO[svc as Exclude<Service, Service.None>];
      if (info.footprint) return { ok: false, tiles: [], invalid: [], reasons: ['Un grand équipement ne se déplace pas : démolissez-le puis reconstruisez-le'], warnings: [], cost: 0, rect: [0, 0, 1, 1], face: S };
      const k = w.index(i, j);
      const out: PlaceEstimate = { ok: false, tiles: [k], invalid: [], reasons: [], warnings: [], cost: Math.round(info.cost * 0.2), rect: [i, j, 1, 1], face: S };
      const block = k === from ? null : w.serviceBlocker(i, j, svc);
      if (block) { out.reasons.push(block); out.invalid.push(k); }
      if (w.bState[k] && k !== from) { out.reasons.push('Emprise occupée par un bâtiment'); out.invalid.push(k); }
      if (this.emergency.inService(from) > 0) out.reasons.push('Véhicules en mission : attendez leur retour');
      if (!this.sandbox && out.cost > this.money) out.reasons.push('Fonds insuffisants');
      out.ok = !out.reasons.length;
      return out;
    }
    const spec = this.specOf(from);
    if (!spec) return null;
    return this.estimatePlace(spec, i, j, face, new Set(w.lotTiles(from)), Simulation.MOVE_COST);
  }

  /** Déplace un bâtiment : les occupants partent, le bâtiment est reconstruit à l'identique ailleurs. */
  moveBuilding(from: number, i: number, j: number, face = 0): boolean {
    const w = this.world;
    const est = this.estimateMove(from, i, j, face);
    if (!est) return false;
    if (!est.ok) { this.events.emit('notify', { text: est.reasons[0], kind: 'warn' }); return false; }
    if (w.service[from]) {
      const svc = w.service[from];
      const to = est.tiles[0];
      if (to === from) return false;
      w.service[from] = Service.None;
      if (w.zones[to]) { w.zones[to] = Zone.None; this.zonedDirty = true; }
      if (w.trees[to]) { w.trees[to] = 0; this.events.emit('treesChanged', undefined); }
      w.service[to] = svc;
      w.condition[to] = w.condition[from];
      this.spend(est.cost, 'services');
      this.transit.refreshAll();
      this.recomputeStats();
      this.events.emit('servicesChanged', undefined);
      this.events.emit('transitChanged', undefined);
      this.events.emit('notify', { text: `${SERVICE_INFO[svc as Exclude<Service, Service.None>].name} déplacé(e)`, kind: 'info', tile: to });
      return true;
    }
    const spec = this.specOf(from)!;
    const a = w.anchorOf(from);
    const keep = { id: w.bId[a], variant: w.bVariant[a] };
    const old = this.clearBuilding(a);
    for (const t of old) w.zones[t] = Zone.None;
    this.build(spec, est, keep, 2);
    this.spend(est.cost, 'buildings');
    this.events.emit('buildingsChanged', { tiles: old });
    this.events.emit('notify', { text: 'Bâtiment déplacé : les occupants reviendront après le chantier', kind: 'info', tile: est.tiles[0] });
    return true;
  }

  /** Amélioration payée par la ville (si les réseaux le permettent). */
  upgradeBuilding(idx: number): boolean {
    const w = this.world, ut = this.utilities, a = w.anchorOf(idx);
    const fail = (text: string) => { this.events.emit('notify', { text, kind: 'warn', tile: a }); return false; };
    if (w.bState[a] !== BuildState.Built || !w.zones[a]) return fail('Seul un bâtiment actif peut être amélioré');
    if (w.bLevel[a] >= 3) return fail('Niveau maximal atteint');
    if (!ut.hasUtility(a, Utility.Power) || !ut.hasUtility(a, Utility.Water)) return fail('Raccordez d\'abord l\'électricité et l\'eau');
    if (w.bLevel[a] >= 2 && !ut.hasUtility(a, Utility.Sewage)) return fail('Le niveau 3 exige l\'évacuation des eaux usées');
    const cost = this.upgradeCost(a);
    if (!this.sandbox && cost > this.money) return fail('Fonds insuffisants');
    const tiles = this.startConstruction(a, w.bLevel[a] + 1);
    this.spend(cost, 'buildings');
    this.recomputeStats();
    this.events.emit('buildingsChanged', { tiles });
    return true;
  }

  /** Change l'orientation d'un bâtiment existant (quart de tour). */
  rotateBuilding(idx: number): void {
    const w = this.world, a = w.anchorOf(idx);
    if (!w.bState[a]) return;
    const [gw, gh] = w.lotDims(a);
    const order = [S, W, N, E];
    let f = order[(order.indexOf(w.faceOf(a)) + 1) % 4];
    // Une parcelle rectangulaire ne peut que se retourner (180°)
    if (gw !== gh) f = order[(order.indexOf(w.faceOf(a)) + 2) % 4];
    w.bFace[a] = f;
    this.events.emit('buildingsChanged', { tiles: [] });
  }

  // ---------- Démolition ----------

  estimateBulldoze(area: number[]): { refund: number; cost: number; tiles: number[] } {
    const w = this.world;
    let refund = 0, cost = 0;
    const tiles: number[] = [];
    // Un bâtiment sur plusieurs cases est démoli en entier
    const all = new Set<number>();
    for (const raw of area) {
      const idx = w.annex[raw] ? w.annex[raw] - 1 : raw;
      if (w.bState[idx] && !w.service[idx] && w.tiles[idx] !== Tile.Road) for (const t of w.lotTiles(idx)) all.add(t);
      else all.add(idx);
    }
    for (const idx of all) {
      if (w.powerLine[idx]) {
        refund += Math.round(POWER_LINE_COST * 0.3);
        tiles.push(idx);
      } else if (w.rail[idx] && w.tiles[idx] !== Tile.Road) {
        refund += Math.round(RAIL_COST * 0.3);
        tiles.push(idx);
      } else if (w.tiles[idx] === Tile.Road) {
        refund += Math.round((ROAD_INFO[w.roadType[idx] as RoadType]?.cost ?? ROAD_COST) * ROAD_REFUND);
        tiles.push(idx);
      } else if (w.service[idx]) {
        refund += Math.round(SERVICE_INFO[w.service[idx] as Exclude<Service, Service.None>].cost * 0.25);
        tiles.push(idx);
      } else if (w.bState[idx]) {
        cost += this.demolishCost(idx) / w.lotTiles(idx).length;
        tiles.push(idx);
      } else if (w.trees[idx]) {
        cost += w.trees[idx] * TREE_CLEAR_COST;
        tiles.push(idx);
      }
    }
    return { refund, cost: Math.round(cost), tiles };
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
    let lines = false, rails = false;
    for (const idx of est.tiles) {
      if (w.powerLine[idx]) {
        w.powerLine[idx] = 0;
        lines = true;
      } else if (w.rail[idx] && w.tiles[idx] !== Tile.Road) {
        w.rail[idx] = 0;
        w.disconnectRail(idx);
        rails = true;
      } else if (w.tiles[idx] === Tile.Road) {
        w.tiles[idx] = Tile.Empty;
        w.busStop[idx] = 0;
        w.roadFlags[idx] = 0;
        w.lanes[idx] = 0;
        w.incident[idx] = 0;
        w.roadType[idx] = 0;
        w.oneway[idx] = 0;
        w.lights[idx] = 0;
        w.disconnect(idx);
        roads.push(idx);
      } else if (w.service[idx]) {
        w.service[idx] = Service.None;
        for (let k = 0; k < w.annex.length; k++) if (w.annex[k] === idx + 1) w.annex[k] = 0;
        services = true;
      } else if (w.bState[idx]) {
        buildings.push(...this.clearBuilding(idx));
      } else if (w.trees[idx]) {
        w.trees[idx] = 0;
        trees = true;
      }
    }
    this.roadCount -= roads.length;
    this.spend(est.cost - est.refund, 'demolition');
    if (roads.length) this.updateAutoLights(roads);
    if (roads.length) this.onRoadsChanged(roads);
    if (buildings.length) {
      this.recomputeStats();
      this.events.emit('buildingsChanged', { tiles: buildings });
    }
    if (trees) this.events.emit('treesChanged', undefined);
    if (lines) { this.recomputeStats(); this.events.emit('powerLinesChanged', undefined); }
    if (rails) { this.transit.refreshAll(); this.events.emit('railChanged', undefined); this.events.emit('transitChanged', undefined); }
    if (services) {
      this.transit.refreshAll();
      this.recomputeStats();
      this.events.emit('servicesChanged', undefined);
    }
    if (roads.length || services) this.events.emit('transitChanged', undefined);
  }
}
