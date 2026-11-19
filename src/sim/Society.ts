import { Citizens, JOB_MIX, SALARY, Status, type SocietyContext } from './Citizens';
import type { Simulation } from './Simulation';
import { BuildState, Zone } from './zones';
import { Coverage } from './services';

/**
 * Marché du logement et entreprises. Les foyers choisissent un logement selon leurs revenus,
 * le loyer et la qualité du quartier ; les entreprises embauchent, produisent, vendent,
 * paient salaires, loyers et impôts, et peuvent licencier ou fermer.
 */

/** Production mensuelle par employé selon la qualification. */
const PRODUCTIVITY = [2700, 3900, 5400];
const OFFICE_VALUE = [2000, 3000, 4800];
/** Chiffre d'affaires qu'un employé de commerce peut assurer par mois. */
const SALES_PER_EMPLOYEE = 3000;
/** Part de leurs recettes que les commerces dépensent en marchandises. */
const GOODS_SHARE = 0.45;

export interface BusinessStats {
  businesses: number;
  struggling: number;
  closedThisMonth: number;
  closedTotal: number;
  spending: number;
  goodsDemand: number;
  goodsProduced: number;
  imports: number;
  exports: number;
  openJobs: [number, number, number];
  slots: [number, number, number];
  avgMargin: Record<number, number>;
  underused: number;
}

export class Society {
  readonly citizens: Citizens;
  readonly revenue: Float32Array;
  readonly costs: Float32Array;
  readonly profit: Float32Array;
  /** Bénéfice avant impôts (base de l'impôt sur les sociétés). */
  readonly preTax: Float32Array;
  readonly badMonths: Uint8Array;
  readonly goodMonths: Uint8Array;
  readonly landValue: Float32Array;
  /** Effectif souhaité par l'entreprise selon ses ventes (≤ postes du bâtiment). */
  readonly target: Uint16Array;
  stats: BusinessStats = {
    businesses: 0, struggling: 0, closedThisMonth: 0, closedTotal: 0, spending: 0, goodsDemand: 0, goodsProduced: 0,
    imports: 0, exports: 0, openJobs: [0, 0, 0], slots: [0, 0, 0], avgMargin: {}, underused: 0,
  };
  /** Indice du coût de la vie (1 = normal). */
  costOfLiving = 1;
  vacancy = 0;
  homesTotal = 0;
  homesFree = 0;
  private openings: Array<number[]> = [[], [], []];
  private vacant: number[] = [];

  constructor(private sim: Simulation) {
    const n = sim.world.size * sim.world.size;
    this.citizens = new Citizens(sim.world);
    this.revenue = new Float32Array(n);
    this.costs = new Float32Array(n);
    this.profit = new Float32Array(n);
    this.preTax = new Float32Array(n);
    this.badMonths = new Uint8Array(n);
    this.goodMonths = new Uint8Array(n);
    this.landValue = new Float32Array(n).fill(0.4);
    this.target = new Uint16Array(n).fill(65535);
  }

  // ---------- Emplois et logements disponibles ----------

  slotsOf(tile: number, level: number): number {
    const w = this.sim.world;
    const mix = JOB_MIX[w.zones[tile]];
    if (!mix || w.bState[tile] !== BuildState.Built) return 0;
    return Math.round(this.sim.capacity(tile) * mix[level]);
  }

  homesOf(tile: number): number {
    const w = this.sim.world;
    if (w.zones[tile] !== Zone.Residential || w.bState[tile] !== BuildState.Built) return 0;
    return this.citizens.homes(this.sim.capacity(tile));
  }

  /** Listes des emplois vacants et des logements libres (une fois par jour). */
  refreshMarkets(): void {
    const w = this.sim.world, c = this.citizens;
    this.openings = [[], [], []];
    this.vacant = [];
    const open: [number, number, number] = [0, 0, 0], slots: [number, number, number] = [0, 0, 0];
    let homes = 0, free = 0;
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) continue;
      const z = w.zones[k];
      if (z === Zone.Residential) {
        const hm = this.homesOf(k);
        homes += hm;
        const f = hm - c.homesTaken[k];
        if (f > 0 && !w.flooded[k]) { free += f; this.vacant.push(k); }
      } else if (JOB_MIX[z]) {
        for (let l = 0; l < 3; l++) {
          const s = this.slotsOf(k, l);
          slots[l] += s;
          const o = this.wanted(k, l) - c.employeesBy[l][k];
          if (o > 0) { open[l] += o; this.openings[l].push(k); }
        }
      }
    }
    this.stats.openJobs = open;
    this.stats.slots = slots;
    this.homesTotal = homes;
    this.homesFree = free;
    this.vacancy = homes ? free / homes : 0;
  }

  /** Postes que l'entreprise veut pourvoir à ce niveau (selon ses ventes). */
  wanted(tile: number, level: number): number {
    const slots = this.slotsOf(tile, level);
    const mix = JOB_MIX[this.sim.world.zones[tile]];
    const t = this.target[tile];
    return t === 65535 || !mix ? slots : Math.min(slots, Math.round(t * mix[level]));
  }

  private dist(a: number, b: number): number {
    const n = this.sim.world.size;
    return Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  }

  /** Emploi accessible le mieux adapté : qualification la plus haute possible, puis distance. */
  findJob(home: number, maxLevel: number): [number, number] | null {
    const ut = this.sim.utilities;
    const net = ut.networkOf(home);
    if (net < 0) return null;
    for (let l = maxLevel; l >= 0; l--) {
      const list = this.openings[l];
      if (!list.length) continue;
      let best = -1, bd = Infinity;
      for (let s = 0; s < Math.min(14, list.length); s++) {
        const t = list[Math.floor(this.citizens.random() * list.length)];
        if (this.wanted(t, l) - this.citizens.employeesBy[l][t] <= 0 || ut.networkOf(t) !== net) continue;
        const d = this.dist(home, t);
        if (d < bd) { bd = d; best = t; }
      }
      if (best >= 0 && bd < 70) return [best, l];
    }
    return null;
  }

  rent(tile: number): number {
    const w = this.sim.world;
    const lv = this.landValue[tile];
    const scarcity = Math.max(0, 0.06 - this.vacancy) * 5;
    return Math.round((300 + 150 * Math.max(1, w.bLevel[tile])) * (0.6 + 0.8 * lv) * (1 + scarcity) * this.costOfLiving);
  }

  /** Logement libre le plus adapté : loyer abordable, quartier agréable, proche si possible. */
  findHome(income: number, from: number): number {
    const list = this.vacant;
    if (!list.length) return -1;
    const ut = this.sim.utilities, c = this.citizens;
    let best = -1, bs = -Infinity;
    for (let s = 0; s < Math.min(16, list.length); s++) {
      const t = list[Math.floor(c.random() * list.length)];
      if (this.homesOf(t) - c.homesTaken[t] <= 0 || t === from) continue;
      const burden = this.rent(t) / Math.max(400, income);
      const score = ut.happiness[t] * 1.5 + this.landValue[t] * 0.5 - Math.max(0, burden - 0.3) * 3 - (from >= 0 ? this.dist(from, t) * 0.005 : 0);
      if (score > bs) { bs = score; best = t; }
    }
    return best;
  }

  get ctx(): SocietyContext {
    const sim = this.sim, ut = sim.utilities, w = sim.world;
    return {
      healthAccess: (t) => (ut.coverage[t] & Coverage.Health ? 1 : 0.25),
      schoolAccess: (t) => (ut.coverage[t] & Coverage.Education ? 1 : 0.2),
      pollution: (t) => ut.air[t] + (ut.contaminated[t] ? 0.3 : 0),
      buildingHappiness: (t) => ut.happiness[t] || 0.45,
      findJob: (home, lvl) => this.findJob(home, lvl),
      isJobSite: (t) => w.bState[t] === BuildState.Built && !!JOB_MIX[w.zones[t]],
      findHome: (inc, from) => this.findHome(inc, from),
      rent: (t) => this.rent(t),
      wageFactor: (t) => (this.badMonths[t] > 1 ? 0.95 : this.goodMonths[t] > 2 ? 1.05 : 1),
      distance: (a, b) => this.dist(a, b),
      capacity: (t) => sim.capacity(t),
    };
  }

  // ---------- Quotidien ----------

  /** Arrivées de nouveaux foyers selon l'attractivité de la ville. */
  immigration(): void {
    const sim = this.sim, c = this.citizens;
    if (!this.vacant.length) return;
    const open = this.stats.openJobs[0] + this.stats.openJobs[1] + this.stats.openJobs[2];
    const unemployed = sim.stats.unemployment * sim.stats.workers;
    const happy = sim.stats.population ? sim.utilities.stats.happiness : 0.6;
    const attract = 0.4 + (open - unemployed) / (c.population * 0.3 + 30) + (happy - 0.55) * 1.5 - (sim.taxes[Zone.Residential] - 9) * 0.04;
    if (attract <= 0) return;
    const arrivals = Math.min(this.homesFree, Math.ceil(this.homesFree * 0.05 * Math.min(2, attract)));
    const eduBias = sim.demo.education;
    for (let k = 0; k < arrivals; k++) {
      const home = this.findHome(1600, -1);
      if (home < 0) break;
      c.immigrate(home, eduBias);
    }
  }

  daily(): void {
    this.refreshMarkets();
    this.citizens.dailyBatch(this.ctx);
    this.immigration();
  }

  // ---------- Mensuel : entreprises ----------

  monthly(): void {
    const sim = this.sim, w = sim.world, c = this.citizens;
    for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Built) this.landValue[k] = sim.landValue(k);
    // Dépenses des ménages (après loyer)
    let spending = 0;
    for (let h = 0; h < c.hCount; h++) if (c.hAlive[h]) spending += Math.max(0, c.hIncome[h] - c.hRent[h]) * 0.6;
    // Poids des commerces, production industrielle
    const jobs: number[] = [];
    let wC = 0, produced = 0;
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built || !JOB_MIX[w.zones[k]]) continue;
      jobs.push(k);
      if (w.zones[k] === Zone.Commercial) wC += sim.capacity(k) * (0.7 + this.landValue[k] * 0.6);
      if (w.zones[k] === Zone.Industrial) for (let l = 0; l < 3; l++) produced += c.employeesBy[l][k] * PRODUCTIVITY[l];
    }
    const goodsDemand = spending * GOODS_SHARE;
    const local = Math.min(produced, goodsDemand);
    const imports = Math.max(0, goodsDemand - produced);
    const exports = Math.max(0, produced - goodsDemand);
    this.costOfLiving = 1 + (goodsDemand ? (imports / goodsDemand) * 0.12 : 0);

    let struggling = 0, closed = 0, underused = 0, businesses = 0;
    const margins: Record<number, [number, number]> = {};
    const taxes = sim.taxes;
    for (const k of jobs) {
      const z = w.zones[k];
      const lv = this.landValue[k];
      let salaries = 0, rev = 0, goods = 0;
      for (let l = 0; l < 3; l++) salaries += c.employeesBy[l][k] * SALARY[l];
      const slotsAll = this.slotsOf(k, 0) + this.slotsOf(k, 1) + this.slotsOf(k, 2);
      if (z === Zone.Commercial) {
        // Part des achats des ménages selon la taille et l'attrait du commerce, limitée par son personnel
        const share = wC ? spending * (sim.capacity(k) * (0.7 + lv * 0.6)) / wC : 0;
        rev = Math.min(share, c.employees[k] * SALES_PER_EMPLOYEE);
        this.target[k] = Math.max(1, Math.min(slotsAll, Math.ceil(share / SALES_PER_EMPLOYEE)));
        goods = rev * GOODS_SHARE * (1 + (goodsDemand ? imports / goodsDemand : 0) * 0.15);
      } else if (z === Zone.Industrial) {
        let p = 0;
        for (let l = 0; l < 3; l++) p += c.employeesBy[l][k] * PRODUCTIVITY[l];
        rev = produced ? p * (local / produced + (exports / produced) * 0.85) : 0;
        goods = p * 0.15; // matières premières
      } else {
        for (let l = 0; l < 3; l++) rev += c.employeesBy[l][k] * OFFICE_VALUE[l];
        rev *= 0.85 + lv * 0.3;
      }
      const rentCost = sim.capacity(k) * 25 * (0.5 + lv);
      const pre = rev - salaries - goods - rentCost;
      const tax = Math.max(0, pre) * (taxes[z as 2 | 3 | 4] / 100) * 0.9;
      this.revenue[k] = rev;
      this.costs[k] = salaries + goods + rentCost + tax;
      this.preTax[k] = pre;
      this.profit[k] = pre - tax;
      const margin = rev > 0 ? this.profit[k] / rev : c.employees[k] ? -1 : 0;
      const m = margins[z] ?? (margins[z] = [0, 0]);
      m[0] += margin; m[1]++;
      businesses++;
      const slots = this.slotsOf(k, 0) + this.slotsOf(k, 1) + this.slotsOf(k, 2);
      if (slots && c.employees[k] < slots * 0.3) underused++;
      // Effectif trop grand pour les ventes : réduction progressive
      const excess = c.employees[k] - (this.target[k] === 65535 ? slotsAll : this.target[k]);
      if (excess > 0) c.layOff(k, Math.min(1, (excess / c.employees[k]) * 0.5));
      // Difficultés durables : licenciements, puis fermeture
      if (margin < -0.05 && c.employees[k] > 0) {
        this.badMonths[k] = Math.min(255, this.badMonths[k] + 1);
        this.goodMonths[k] = 0;
        struggling++;
        if (this.badMonths[k] >= 6) {
          closed++;
          sim.closeBusiness(k);
          continue;
        }
        if (this.badMonths[k] >= 3) c.layOff(k, 0.2);
      } else {
        this.badMonths[k] = 0;
        if (margin > 0.08) this.goodMonths[k] = Math.min(255, this.goodMonths[k] + 1);
      }
    }
    const avgMargin: Record<number, number> = {};
    for (const z in margins) avgMargin[z] = margins[z][1] ? margins[z][0] / margins[z][1] : 0;
    this.stats = {
      ...this.stats, businesses, struggling, closedThisMonth: closed, closedTotal: this.stats.closedTotal + closed,
      spending, goodsDemand, goodsProduced: produced, imports, exports, avgMargin, underused,
    };
    c.tally();
    c.endMonth();
  }

  /** Les 9 besoins des habitants (§7), de 0 à 1, avec ce qui les mesure. */
  needs(): Array<[string, number, string]> {
    const sim = this.sim, ut = sim.utilities, us = ut.stats, st = sim.stats, c = this.citizens;
    const cov = (b: number) => us.coverage[b] ?? 0;
    const pop = Math.max(1, st.population);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    let contaminated = 0, bld = 0;
    for (let k = 0; k < ut.contaminated.length; k++) if (sim.world.bState[k] === BuildState.Built) { bld++; if (ut.contaminated[k]) contaminated++; }
    return [
      ['Logement', clamp(1 - Math.max(0, c.summaryBurden - 0.3) * 2.5 - Math.max(0, 0.03 - this.vacancy) * 6), `loyer ${Math.round(c.summaryBurden * 100)} % du revenu · ${Math.round(this.vacancy * 100)} % de logements libres`],
      ['Emploi', clamp(1 - st.unemployment * 3 - (c.underemployedCount / pop) * 0.5), `chômage ${Math.round(st.unemployment * 100)} %`],
      ['Santé', clamp(cov(Coverage.Health) * 0.7 + (1 - sim.demo.sick * 8) * 0.3), `${Math.round(cov(Coverage.Health) * 100)} % couverts · ${Math.round(sim.demo.sick * 100)} % malades`],
      ['Éducation', clamp(cov(Coverage.Education)), `${ut.reach.unschooled} élève(s) sans place`],
      ['Mobilité', clamp(sim.traffic.flow * 0.7 + sim.traffic.transitShare * 2 + 0.15), `vitesse moyenne ${Math.round(sim.traffic.flow * 100)} %`],
      ['Consommation', clamp(Math.min(1, (st.jobs[Zone.Commercial] / pop) * 5) - (this.costOfLiving - 1) * 2), `coût de la vie ${Math.round(this.costOfLiving * 100)}`],
      ['Loisirs', clamp(cov(Coverage.Park) * 0.8 + 0.1), `${Math.round(cov(Coverage.Park) * 100)} % près d'un parc`],
      ['Sécurité', clamp(1 - sim.crimeIndex * 1.5), `délinquance ${Math.round(sim.crimeIndex * 100)} %`],
      ['Environnement', clamp(1 - us.air * 1.5 - us.noise - (bld ? contaminated / bld : 0)), `air ${Math.round(us.air * 100)} % · bruit ${Math.round(us.noise * 100)} %`],
    ];
  }

  /** Impôt sur les sociétés (selon le taux actuel) et impôt sur le revenu des ménages. */
  taxIncome(rates: Record<number, number>, mul: number): Record<string, number> {
    const w = this.sim.world, c = this.citizens;
    let res = 0;
    for (let h = 0; h < c.hCount; h++) if (c.hAlive[h]) res += c.hIncome[h];
    const out: Record<string, number> = { residential: res * (rates[Zone.Residential] / 100) * 0.02 * mul, commercial: 0, industrial: 0, office: 0 };
    const key: Record<number, string> = { [Zone.Commercial]: 'commercial', [Zone.Industrial]: 'industrial', [Zone.Office]: 'office' };
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) continue;
      const z = w.zones[k];
      if (!key[z]) continue;
      out[key[z]] += (Math.max(0, this.preTax[k]) * (rates[z] / 100) * 0.9 * 0.05 + c.employees[k] * 0.4 * (rates[z] / 9)) * mul;
    }
    return out;
  }

  /** Remplit les bâtiments existants (anciennes sauvegardes, avant les habitants individuels). */
  bootstrap(): void {
    const w = this.sim.world, c = this.citizens;
    this.refreshMarkets();
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built || w.zones[k] !== Zone.Residential) continue;
      const homes = this.homesOf(k);
      for (let h = 0; h < homes; h++) c.immigrate(k, 0.4);
    }
    // Les actifs trouvent un emploi
    const ctx = this.ctx;
    for (let i = 0; i < c.count; i++) {
      if (!c.alive[i] || c.status[i] !== Status.Unemployed) continue;
      const home = c.hHome[c.household[i]];
      const found = home >= 0 ? ctx.findJob(home, Math.max(0, Math.min(2, c.edu[i] - 1))) : null;
      if (found) {
        c.job[i] = found[0]; c.jobLevel[i] = found[1]; c.employees[found[0]]++; c.employeesBy[found[1]][found[0]]++; c.status[i] = Status.Worker;
        if (c.employeesBy[found[1]][found[0]] >= this.slotsOf(found[0], found[1])) this.refreshMarkets();
      }
    }
    c.tally();
    c.month = { births: 0, deaths: 0, immigrants: 0, emigrants: 0, moves: 0 };
  }
}
