import { Citizens, JOB_MIX, SALARY, Status, type SocietyContext } from './Citizens';
import type { Simulation } from './Simulation';
import { BuildState, hasHomes, jobKind, Zone } from './zones';
import { Resource } from './World';
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
/** Part de l'alimentation dans les achats de marchandises. */
const FOOD_SHARE = 0.3;
/** Matières premières nécessaires par unité de biens manufacturés (en valeur). */
const RAW_PER_GOOD = 0.25;
/** Secteur primaire : agriculture, sylviculture, extraction. */
const PRIMARY = new Set<number>([Zone.Agriculture, Zone.Forestry, Zone.Mining]);

/** Flux de la chaîne de production du dernier mois (en valeur, € par mois). */
export interface ProductionChain {
  crops: number; wood: number; ore: number;
  foodDemand: number; foodLocal: number; foodImport: number;
  rawNeed: number; rawLocal: number; rawImport: number; rawExport: number;
  produced: number; manufDemand: number; goodsLocal: number; goodsImport: number; goodsExport: number;
  goodsStock: number; rawStock: number; storageCap: number; exportCap: number; unsold: number;
  /** Volume de marchandises transportées (sert au nombre de camions). */
  trucks: number;
}

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
  /** Bonus de productivité industrielle apporté par la recherche. */
  innovation = 0;
  /** Part des flux de marchandises pris en charge par la logistique. */
  logisticsShare = 0;

  /** Production mensuelle d'un employé (industrie ou agriculture), avec le bonus de la recherche. */
  productivity(zone: number, level: number): number {
    const mul = zone === Zone.Agriculture ? 0.75 : zone === Zone.Forestry ? 0.7 : zone === Zone.Mining ? 0.9 : 1 + this.innovation;
    return PRODUCTIVITY[level] * mul;
  }

  /** Rendement lié au terrain : terres fertiles, forêts proches, gisement de minerai. */
  siteFactor(k: number): number {
    const w = this.sim.world, z = w.zones[k];
    if (z === Zone.Agriculture) return ((w.resources[k] & Resource.Fertile) ? 1.3 : 0.8) * (1 + this.sim.waste.compostBoost);
    if (z === Zone.Mining) return ((w.resources[k] & Resource.Ore) ? 1.1 : 0.2) * (this.sim.districts.has(k, 'trucks') ? 0.95 : 1);
    if (z === Zone.Industrial && this.sim.districts.has(k, 'trucks')) return 0.95;
    if (z === Zone.Forestry) {
      const n = w.size, i0 = k % n, j0 = Math.floor(k / n);
      let trees = 0;
      for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) if (w.inBounds(i, j)) trees += w.trees[j * n + i];
      return 0.7 + Math.min(0.6, trees * 0.02);
    }
    return 1;
  }

  /** Chaîne de production du dernier mois. */
  chain: ProductionChain = {
    crops: 0, wood: 0, ore: 0, foodDemand: 0, foodLocal: 0, foodImport: 0, rawNeed: 0, rawLocal: 0, rawImport: 0, rawExport: 0,
    produced: 0, manufDemand: 0, goodsLocal: 0, goodsImport: 0, goodsExport: 0, goodsStock: 0, rawStock: 0, storageCap: 80000, exportCap: 150000, unsold: 0, trucks: 0,
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
    return Math.round(this.sim.jobCapacity(tile) * mix[level]);
  }

  homesOf(tile: number): number {
    const w = this.sim.world;
    if (!hasHomes(w.zones[tile]) || w.bState[tile] !== BuildState.Built) return 0;
    return this.citizens.homes(this.sim.homeCapacity(tile));
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
      if (hasHomes(z)) {
        const hm = this.homesOf(k);
        homes += hm;
        const f = hm - c.homesTaken[k];
        if (f > 0 && !w.flooded[k]) { free += f; this.vacant.push(k); }
      }
      if (JOB_MIX[z]) {
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
    const aid = this.sim.districts.has(tile, 'housingAid') ? 0.8 : 1;
    return Math.round((300 + 150 * Math.max(1, w.bLevel[tile])) * (0.6 + 0.8 * lv) * (1 + scarcity) * this.costOfLiving * aid);
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
      capacity: (t) => sim.homeCapacity(t),
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
    let wC = 0, produced = 0, logistics = 0, researchers = 0, industrialStaff = 0;
    // Les centres de recherche rendent l'industrie plus productive (jusqu'à +15 %)
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) continue;
      if (w.zones[k] === Zone.Research) researchers += c.employeesBy[2][k];
      if (w.zones[k] === Zone.Industrial) industrialStaff += c.employees[k];
    }
    this.innovation = Math.min(0.15, researchers / (industrialStaff + 20) * 0.6);
    // Production de chaque entreprise du secteur primaire (cultures, bois, minerai) et de l'industrie
    const output = new Map<number, number>();
    let crops = 0, wood = 0, ore = 0;
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built || !JOB_MIX[w.zones[k]]) continue;
      jobs.push(k);
      const z = w.zones[k];
      if (jobKind(z) === Zone.Commercial && z !== Zone.Tourism) wC += sim.jobCapacity(k) * (0.7 + this.landValue[k] * 0.6) * (z === Zone.CommercialDense ? 1.15 : 1);
      if (z === Zone.Industrial || PRIMARY.has(z)) {
        let p = 0;
        for (let l = 0; l < 3; l++) p += c.employeesBy[l][k] * this.productivity(z, l);
        p *= this.siteFactor(k);
        output.set(k, p);
        if (z === Zone.Industrial) produced += p;
        else if (z === Zone.Agriculture) crops += p;
        else if (z === Zone.Forestry) wood += p;
        else ore += p;
      }
      if (z === Zone.Logistics) logistics += c.employees[k];
    }
    // Chaîne : cultures → alimentation et matières premières ; bois et minerai → industrie → commerces
    const ch = this.chain;
    const goodsDemand = spending * GOODS_SHARE;
    const foodDemand = goodsDemand * FOOD_SHARE, manufDemand = goodsDemand - foodDemand;
    const foodLocal = Math.min(crops * 0.6, foodDemand);
    const foodImport = foodDemand - foodLocal;
    const rawSupply = crops - foodLocal + wood + ore + ch.rawStock;
    const rawNeed = produced * RAW_PER_GOOD;
    const rawLocal = Math.min(rawSupply, rawNeed);
    const rawImport = rawNeed - rawLocal;
    const goodsSupply = produced + ch.goodsStock;
    const goodsLocal = Math.min(goodsSupply, manufDemand);
    const goodsImport = manufDemand - goodsLocal;
    // Exportations limitées par la logistique ; le reste est stocké, puis invendu
    const exportCap = 150000 + produced * 0.4 + logistics * 15000;
    const goodsSurplus = goodsSupply - goodsLocal, rawSurplus = rawSupply - rawLocal;
    const goodsExport = Math.min(goodsSurplus, exportCap);
    const rawExport = Math.min(rawSurplus, exportCap - goodsExport);
    const storageCap = 80000 + logistics * 5000;
    const goodsStock = Math.min(goodsSurplus - goodsExport, storageCap);
    const rawStock = Math.min(rawSurplus - rawExport, storageCap - goodsStock);
    const unsold = goodsSurplus - goodsExport - goodsStock + rawSurplus - rawExport - rawStock;
    const imports = foodImport + goodsImport + rawImport;
    const exports = goodsExport + rawExport;
    this.chain = {
      crops, wood, ore, foodDemand, foodLocal, foodImport, rawNeed, rawLocal, rawImport, rawExport, produced, manufDemand, goodsLocal, goodsImport, goodsExport,
      goodsStock, rawStock, storageCap, exportCap, unsold, trucks: rawLocal + goodsLocal + foodLocal + exports + imports * 0.5,
    };
    // Prix obtenus : vente locale au prix plein, à l'export à 85 % (biens) ou 80 % (matières premières)
    const primaryTotal = crops + wood + ore;
    const primaryFactor = primaryTotal ? (foodLocal + Math.min(rawLocal, rawSupply - ch.rawStock) + rawExport * 0.8) / primaryTotal : 0;
    const industryFactor = produced ? Math.min(1, (goodsLocal + goodsExport * 0.85) / Math.max(produced, goodsSupply)) : 0;
    const rawCost = rawNeed ? (rawLocal + rawImport * 1.3) / rawNeed : 1;
    // La logistique prend en charge une partie des flux (moins de surcoût pour les ménages)
    const handled = Math.min(imports + exports, logistics * 12000);
    this.logisticsShare = imports + exports ? handled / (imports + exports) : 0;
    const consumerImports = foodImport + goodsImport;
    this.costOfLiving = 1 + (goodsDemand ? (consumerImports / goodsDemand) * 0.12 * (1 - this.logisticsShare * 0.6) : 0);

    let struggling = 0, closed = 0, underused = 0, businesses = 0;
    const margins: Record<number, [number, number]> = {};
    const taxes = sim.taxes;
    for (const k of jobs) {
      const z = w.zones[k];
      const lv = this.landValue[k];
      let salaries = 0, rev = 0, goods = 0;
      for (let l = 0; l < 3; l++) salaries += c.employeesBy[l][k] * SALARY[l];
      const slotsAll = this.slotsOf(k, 0) + this.slotsOf(k, 1) + this.slotsOf(k, 2);
      if (z === Zone.Tourism) {
        // Hôtels : dépenses des visiteurs selon l'attrait de la ville et du quartier
        const appeal = 0.4 + sim.tourismAppeal + lv * 0.5;
        rev = c.employees[k] * 2600 * appeal;
        goods = rev * 0.2;
      } else if (z === Zone.Logistics) {
        // Plateformes de fret : rémunérées par le volume de marchandises traité
        rev = logistics ? c.employees[k] * 2400 * (0.7 + Math.min(1, (imports + exports) / (logistics * 12000 + 1)) * 0.6) : 0;
        goods = rev * 0.1;
      } else if (jobKind(z) === Zone.Commercial) {
        // Part des achats des ménages selon la taille et l'attrait du commerce, limitée par son personnel
        const share = wC ? spending * (sim.jobCapacity(k) * (0.7 + lv * 0.6) * (z === Zone.CommercialDense ? 1.15 : 1)) / wC : 0;
        rev = Math.min(share, c.employees[k] * SALES_PER_EMPLOYEE) * sim.districts.commerceFactor(k) * (1 + sim.council.mod('commerce'));
        this.target[k] = Math.max(1, Math.min(slotsAll, Math.ceil(share / SALES_PER_EMPLOYEE)));
        goods = rev * GOODS_SHARE * (1 + (goodsDemand ? imports / goodsDemand : 0) * 0.15);
      } else if (z === Zone.Industrial) {
        const p = output.get(k) ?? 0;
        rev = p * industryFactor;
        goods = p * RAW_PER_GOOD * rawCost; // matières premières locales ou importées (plus chères)
      } else if (PRIMARY.has(z)) {
        const p = output.get(k) ?? 0;
        rev = p * primaryFactor;
        goods = p * (z === Zone.Mining ? 0.12 : 0.08); // carburant, semences, entretien
      } else {
        for (let l = 0; l < 3; l++) rev += c.employeesBy[l][k] * OFFICE_VALUE[l];
        rev *= (0.85 + lv * 0.3) * (z === Zone.Research ? 1.2 : 1);
      }
      const rentCost = sim.jobCapacity(k) * 25 * (0.5 + lv) * (PRIMARY.has(z) ? 0.3 : 1);
      const pre = rev - salaries - goods - rentCost;
      const tax = Math.max(0, pre) * (taxes[jobKind(z) as 2 | 3 | 4] / 100) * 0.9;
      this.revenue[k] = rev;
      this.costs[k] = salaries + goods + rentCost + tax;
      this.preTax[k] = pre;
      this.profit[k] = pre - tax;
      const margin = rev > 0 ? this.profit[k] / rev : c.employees[k] ? -1 : 0;
      const mk = jobKind(z);
      const m = margins[mk] ?? (margins[mk] = [0, 0]);
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
    // Impôts locaux : chaque quartier peut ajuster ses taux
    const d = this.sim.districts;
    let resAdj = 0;
    for (let h = 0; h < c.hCount; h++) if (c.hAlive[h] && c.hHome[h] >= 0) resAdj += c.hIncome[h] * d.taxMod(c.hHome[h], Zone.Residential);
    const out: Record<string, number> = { residential: (res * rates[Zone.Residential] + resAdj) / 100 * 0.02 * mul, commercial: 0, industrial: 0, office: 0 };
    const key: Record<number, string> = { [Zone.Commercial]: 'commercial', [Zone.Industrial]: 'industrial', [Zone.Office]: 'office' };
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built) continue;
      const z = jobKind(w.zones[k]);
      if (!z || !key[z]) continue;
      const rate = Math.max(0, rates[z] + d.taxMod(k, z));
      out[key[z]] += (Math.max(0, this.preTax[k]) * (rate / 100) * 0.9 * 0.05 + c.employees[k] * 0.4 * (rate / 9)) * mul;
    }
    return out;
  }

  /** Remplit les bâtiments existants (anciennes sauvegardes, avant les habitants individuels). */
  bootstrap(): void {
    const w = this.sim.world, c = this.citizens;
    this.refreshMarkets();
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Built || !hasHomes(w.zones[k])) continue;
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
