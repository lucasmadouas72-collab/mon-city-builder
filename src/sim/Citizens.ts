import { rng } from '../core/noise';
import type { World } from './World';
import { BuildState, Zone } from './zones';

/**
 * Habitants individuels et foyers. Chaque citoyen a un âge, un niveau d'éducation, un statut,
 * un emploi ou une école, un revenu, une santé et un niveau de bonheur. Les mises à jour se font
 * par lots (1/30e de la population par jour) pour tenir de grandes villes.
 */

export const enum Status { Baby = 0, Child = 1, Teen = 2, Student = 3, Worker = 4, Unemployed = 5, Retired = 6 }
export const STATUS_NAMES = ['bébé', 'écolier·ère', 'collégien·ne ou lycéen·ne', 'étudiant·e', 'actif·ve', 'sans emploi', 'retraité·e'];
export const EDU_NAMES = ['sans diplôme', 'primaire', 'secondaire', 'supérieur'];
/** Salaire mensuel selon le niveau de qualification du poste (0 peu qualifié, 1 qualifié, 2 très qualifié). */
export const SALARY = [1200, 1900, 3200];
/** Répartition des postes par qualification selon le type de zone. */
export const JOB_MIX: Record<number, [number, number, number]> = {
  [Zone.Commercial]: [0.6, 0.35, 0.05],
  [Zone.Industrial]: [0.6, 0.35, 0.05],
  [Zone.Office]: [0.1, 0.4, 0.5],
};
export const HOUSEHOLD_SIZE = 2.4;

const INIT = 4096;

export interface PopReport {
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
  moves: number;
}

export class Citizens {
  // --- Citoyens ---
  cap = INIT;
  count = 0;
  age = new Float32Array(INIT);
  edu = new Uint8Array(INIT);
  status = new Uint8Array(INIT);
  household = new Int32Array(INIT);
  job = new Int32Array(INIT).fill(-1);
  jobLevel = new Int8Array(INIT).fill(-1);
  sick = new Uint8Array(INIT);
  happy = new Float32Array(INIT);
  seed = new Uint32Array(INIT);
  alive = new Uint8Array(INIT);
  idle = new Uint8Array(INIT);
  private freeC: number[] = [];

  // --- Foyers ---
  hCap = INIT;
  hCount = 0;
  hHome = new Int32Array(INIT).fill(-1);
  hAlive = new Uint8Array(INIT);
  hSeed = new Uint32Array(INIT);
  hRent = new Float32Array(INIT);
  hIncome = new Float32Array(INIT);
  hHappy = new Float32Array(INIT);
  members: number[][] = [];
  private freeH: number[] = [];

  // --- Par case ---
  residents: Uint16Array;
  homesTaken: Uint16Array;
  employees: Uint16Array;
  employeesBy: [Uint16Array, Uint16Array, Uint16Array];
  students: Uint16Array;
  sickBy: Uint16Array;
  householdsAt = new Map<number, number[]>();

  population = 0;
  /** Valeurs mises à jour chaque jour par tally() : part du loyer dans le revenu, actifs sous-employés. */
  summaryBurden = 0;
  underemployedCount = 0;
  report: PopReport = { births: 0, deaths: 0, immigrants: 0, emigrants: 0, moves: 0 };
  /** Cumuls du mois en cours. */
  month: PopReport = { births: 0, deaths: 0, immigrants: 0, emigrants: 0, moves: 0 };
  private rand = rng(2024);
  private cursor = 0;
  private hCursor = 0;

  constructor(private world: World) {
    const n = world.size * world.size;
    this.residents = new Uint16Array(n);
    this.homesTaken = new Uint16Array(n);
    this.employees = new Uint16Array(n);
    this.employeesBy = [new Uint16Array(n), new Uint16Array(n), new Uint16Array(n)];
    this.students = new Uint16Array(n);
    this.sickBy = new Uint16Array(n);
  }

  random(): number { return this.rand(); }

  // ---------- Allocation ----------

  private growC(): void {
    const c = this.cap * 2;
    const g = <T extends Float32Array | Uint8Array | Int32Array | Int8Array | Uint32Array>(a: T, fill = 0): T => {
      const b = new (a.constructor as new (n: number) => T)(c);
      b.set(a); if (fill) b.fill(fill as never, a.length);
      return b;
    };
    this.age = g(this.age); this.edu = g(this.edu); this.status = g(this.status); this.household = g(this.household);
    this.job = g(this.job, -1); this.jobLevel = g(this.jobLevel, -1); this.sick = g(this.sick); this.happy = g(this.happy);
    this.seed = g(this.seed); this.alive = g(this.alive); this.idle = g(this.idle);
    this.cap = c;
  }

  private growH(): void {
    const c = this.hCap * 2;
    const g = <T extends Float32Array | Uint8Array | Int32Array | Uint32Array>(a: T, fill = 0): T => {
      const b = new (a.constructor as new (n: number) => T)(c);
      b.set(a); if (fill) b.fill(fill as never, a.length);
      return b;
    };
    this.hHome = g(this.hHome, -1); this.hAlive = g(this.hAlive); this.hSeed = g(this.hSeed);
    this.hRent = g(this.hRent); this.hIncome = g(this.hIncome); this.hHappy = g(this.hHappy);
    this.hCap = c;
  }

  private newCitizen(h: number, age: number, edu: number): number {
    let c = this.freeC.pop();
    if (c === undefined) { if (this.count >= this.cap) this.growC(); c = this.count++; }
    this.age[c] = age; this.edu[c] = edu; this.household[c] = h; this.job[c] = -1; this.jobLevel[c] = -1;
    this.sick[c] = 0; this.happy[c] = 0.6; this.seed[c] = Math.floor(this.rand() * 4e9); this.alive[c] = 1; this.idle[c] = 0;
    this.status[c] = statusFor(age, edu, false);
    this.members[h].push(c);
    const home = this.hHome[h];
    if (home >= 0) this.residents[home]++;
    this.population++;
    return c;
  }

  private newHousehold(home: number): number {
    let h = this.freeH.pop();
    if (h === undefined) { if (this.hCount >= this.hCap) this.growH(); h = this.hCount++; }
    this.hHome[h] = home; this.hAlive[h] = 1; this.hSeed[h] = Math.floor(this.rand() * 4e9);
    this.hRent[h] = 0; this.hIncome[h] = 0; this.hHappy[h] = 0.6;
    this.members[h] = [];
    if (home >= 0) this.attach(h, home);
    return h;
  }

  private attach(h: number, home: number): void {
    this.hHome[h] = home;
    this.homesTaken[home]++;
    let l = this.householdsAt.get(home);
    if (!l) this.householdsAt.set(home, (l = []));
    l.push(h);
    this.residents[home] += this.members[h].length;
  }

  private detach(h: number): void {
    const home = this.hHome[h];
    if (home < 0) return;
    this.homesTaken[home] = Math.max(0, this.homesTaken[home] - 1);
    this.residents[home] = Math.max(0, this.residents[home] - this.members[h].length);
    const l = this.householdsAt.get(home);
    if (l) { const i = l.indexOf(h); if (i >= 0) l.splice(i, 1); }
    this.hHome[h] = -1;
  }

  private quitJob(c: number): void {
    const j = this.job[c];
    if (j >= 0) {
      this.employees[j] = Math.max(0, this.employees[j] - 1);
      const lv = this.jobLevel[c];
      if (lv >= 0) this.employeesBy[lv][j] = Math.max(0, this.employeesBy[lv][j] - 1);
    }
    this.job[c] = -1; this.jobLevel[c] = -1;
  }

  private removeCitizen(c: number): void {
    if (!this.alive[c]) return;
    this.quitJob(c);
    const h = this.household[c];
    const m = this.members[h];
    const i = m.indexOf(c);
    if (i >= 0) m.splice(i, 1);
    const home = this.hHome[h];
    if (home >= 0) this.residents[home] = Math.max(0, this.residents[home] - 1);
    this.alive[c] = 0;
    this.freeC.push(c);
    this.population--;
    if (m.length === 0) this.removeHousehold(h);
  }

  private removeHousehold(h: number): void {
    if (!this.hAlive[h]) return;
    for (const c of [...this.members[h]]) {
      this.quitJob(c);
      this.alive[c] = 0;
      this.freeC.push(c);
      this.population--;
    }
    this.detach(h);
    this.members[h] = [];
    this.hAlive[h] = 0;
    this.freeH.push(h);
  }

  // ---------- Logement ----------

  /** Nombre de logements d'un bâtiment résidentiel. */
  homes(capacity: number): number {
    return Math.max(1, Math.round(capacity / HOUSEHOLD_SIZE));
  }

  /** Le foyer quitte la ville (émigration). */
  emigrate(h: number): void {
    this.month.emigrants += this.members[h].length;
    this.removeHousehold(h);
  }

  /** Un bâtiment disparaît : ses habitants cherchent ailleurs ou partent, ses employés perdent leur emploi. */
  evict(tile: number, findHome: (h: number) => number): void {
    for (const h of [...(this.householdsAt.get(tile) ?? [])]) {
      this.detach(h);
      const dest = findHome(h);
      if (dest >= 0) { this.attach(h, dest); this.month.moves++; } else this.emigrate(h);
    }
    this.householdsAt.delete(tile);
    this.residents[tile] = 0;
    this.homesTaken[tile] = 0;
    this.fireAll(tile);
  }

  /** Licencie tous les employés d'un bâtiment. */
  fireAll(tile: number): void {
    if (!this.employees[tile]) return;
    for (let c = 0; c < this.count; c++) if (this.alive[c] && this.job[c] === tile) { this.quitJob(c); this.status[c] = Status.Unemployed; }
  }

  /** Licencie une partie des employés (entreprise en difficulté). */
  layOff(tile: number, share: number): number {
    let n = Math.ceil(this.employees[tile] * share);
    const fired = n;
    for (let c = 0; c < this.count && n > 0; c++) {
      if (this.alive[c] && this.job[c] === tile) { this.quitJob(c); this.status[c] = Status.Unemployed; n--; }
    }
    return fired;
  }

  /** Victimes d'une catastrophe dans un bâtiment. */
  casualties(tile: number, count: number): number {
    let killed = 0;
    for (const h of [...(this.householdsAt.get(tile) ?? [])]) {
      for (const c of [...this.members[h]]) {
        if (killed >= count) return killed;
        this.removeCitizen(c);
        this.month.deaths++;
        killed++;
      }
    }
    return killed;
  }

  /** Nouveau foyer qui s'installe en ville. */
  immigrate(home: number, eduBias: number): number {
    const h = this.newHousehold(home);
    const r = this.rand();
    const size = r < 0.35 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4;
    const adultAge = 22 + this.rand() * 35;
    const edu = () => { const x = this.rand() + eduBias * 0.4; return x > 1.05 ? 3 : x > 0.6 ? 2 : x > 0.2 ? 1 : 0; };
    this.newCitizen(h, adultAge, edu());
    if (size >= 2) this.newCitizen(h, Math.max(19, adultAge + (this.rand() - 0.5) * 8), edu());
    for (let k = 2; k < size; k++) this.newCitizen(h, this.rand() * Math.min(17, adultAge - 18), 0);
    this.month.immigrants += size;
    return h;
  }

  // ---------- Mise à jour par lots ----------

  /**
   * Un trentième des citoyens vieillit d'un mois, étudie, cherche un emploi, tombe malade, a des enfants…
   * `ctx` fournit ce dont la population a besoin du reste de la ville.
   */
  dailyBatch(ctx: SocietyContext): void {
    const total = this.count;
    if (!total) return;
    const batch = Math.ceil(total / 30);
    for (let k = 0; k < batch; k++) {
      const c = this.cursor;
      this.cursor = (this.cursor + 1) % total;
      if (!this.alive[c]) continue;
      this.monthlyCitizen(c, ctx);
    }
    const hb = Math.ceil(this.hCount / 30);
    for (let k = 0; k < hb && this.hCount; k++) {
      const h = this.hCursor;
      this.hCursor = (this.hCursor + 1) % this.hCount;
      if (this.hAlive[h]) this.monthlyHousehold(h, ctx);
    }
  }

  private monthlyCitizen(c: number, ctx: SocietyContext): void {
    const h = this.household[c];
    const home = this.hHome[h];
    this.age[c] += 1 / 12;
    const a = this.age[c];
    // Mort naturelle (selon l'âge et l'accès aux soins)
    const health = home >= 0 ? ctx.healthAccess(home) : 0;
    const pDeath = a > 60 ? ((a - 60) / 30) ** 3 * 0.01 * (1.4 - health * 0.6) : 0.00004;
    if (this.rand() < pDeath) { this.removeCitizen(c); this.month.deaths++; return; }
    // Maladie
    const air = home >= 0 ? ctx.pollution(home) : 0;
    if (this.sick[c]) { if (this.rand() < 0.35 + health * 0.45) this.sick[c] = 0; }
    else if (this.rand() < 0.01 + air * 0.05) this.sick[c] = 1;
    // Études et diplômes
    const school = home >= 0 ? ctx.schoolAccess(home) : 0;
    if (a >= 11 && a < 11 + 1 / 12 && this.edu[c] < 1 && this.rand() < 0.4 + school * 0.6) this.edu[c] = 1;
    if (a >= 18 && a < 18 + 1 / 12 && this.edu[c] < 2 && this.rand() < 0.2 + school * 0.75) this.edu[c] = 2;
    if (a >= 22 && a < 22 + 1 / 12 && this.edu[c] === 2 && this.status[c] === Status.Student && this.rand() < 0.5 + school * 0.4) this.edu[c] = 3;
    // Statut selon l'âge
    const prev = this.status[c];
    if (a < 3) this.status[c] = Status.Baby;
    else if (a < 11) this.status[c] = Status.Child;
    else if (a < 18) this.status[c] = Status.Teen;
    else if (a < 22 && this.edu[c] >= 2 && (prev === Status.Student || prev === Status.Teen) && this.rand() < 0.97) this.status[c] = prev === Status.Teen ? (this.rand() < 0.4 + school * 0.3 ? Status.Student : Status.Unemployed) : Status.Student;
    else if (a >= 65) { if (prev !== Status.Retired) { this.quitJob(c); this.status[c] = Status.Retired; } }
    else if (prev === Status.Baby || prev === Status.Child || prev === Status.Teen || prev === Status.Student) this.status[c] = Status.Unemployed;

    // Recherche d'emploi (et changement d'emploi pour un poste mieux adapté)
    if (this.status[c] === Status.Unemployed || this.status[c] === Status.Worker) {
      const wantsBetter = this.status[c] === Status.Worker && this.jobLevel[c] < Math.min(2, this.edu[c] - 1) && this.rand() < 0.3;
      if (this.status[c] === Status.Unemployed || wantsBetter) {
        const found = home >= 0 ? ctx.findJob(home, Math.max(0, Math.min(2, this.edu[c] - 1))) : null;
        if (found && (!wantsBetter || found[1] > this.jobLevel[c])) {
          this.quitJob(c);
          this.job[c] = found[0]; this.jobLevel[c] = found[1];
          this.employees[found[0]]++;
          this.employeesBy[found[1]][found[0]]++;
          this.status[c] = Status.Worker;
          this.idle[c] = 0;
        } else if (this.status[c] === Status.Unemployed) this.idle[c] = Math.min(255, this.idle[c] + 1);
      }
      // L'emploi a disparu (bâtiment détruit, rasé, fermé)
      if (this.status[c] === Status.Worker && (this.job[c] < 0 || !ctx.isJobSite(this.job[c]))) { this.quitJob(c); this.status[c] = Status.Unemployed; }
    }

    // Bonheur individuel
    let hp = home >= 0 ? ctx.buildingHappiness(home) : 0.4;
    if (this.status[c] === Status.Unemployed) hp -= 0.15 + Math.min(0.1, this.idle[c] * 0.01);
    if (this.status[c] === Status.Worker && this.job[c] >= 0 && home >= 0) {
      const d = ctx.distance(home, this.job[c]);
      hp -= Math.min(0.15, Math.max(0, d - 12) * 0.006); // long trajet
      if (this.jobLevel[c] < this.edu[c] - 1) hp -= 0.04; // sous-emploi
    }
    if (this.sick[c]) hp -= 0.1;
    this.happy[c] = Math.max(0, Math.min(1, hp));
  }

  private monthlyHousehold(h: number, ctx: SocietyContext): void {
    const m = this.members[h];
    if (!m.length) { this.removeHousehold(h); return; }
    const home = this.hHome[h];
    // Revenus, loyer, bonheur du foyer
    let income = 0, happy = 0, adults = 0;
    for (const c of m) {
      if (this.status[c] === Status.Worker && this.jobLevel[c] >= 0) income += SALARY[this.jobLevel[c]] * ctx.wageFactor(this.job[c]);
      else if (this.status[c] === Status.Retired) income += 900;
      else if (this.status[c] === Status.Unemployed) income += 450;
      happy += this.happy[c];
      if (this.age[c] >= 18) adults++;
    }
    const rent = home >= 0 ? ctx.rent(home) : 0;
    this.hIncome[h] = income;
    this.hRent[h] = rent;
    const burden = income > 0 ? rent / income : 2;
    happy = happy / m.length - Math.max(0, burden - 0.35) * 0.6;
    this.hHappy[h] = Math.max(0, Math.min(1, happy));

    // Naissance
    const parents = m.filter((c) => this.age[c] >= 20 && this.age[c] <= 42).length;
    if (parents >= 1 && m.length < 6 && this.rand() < 0.009 * parents * (0.5 + happy)) {
      this.newCitizen(h, 0, 0);
      this.month.births++;
    }
    // Les jeunes adultes quittent le foyer familial
    if (m.length > 2 && home >= 0) {
      const young = m.find((c) => this.age[c] >= 21 && this.age[c] <= 28 && this.status[c] === Status.Worker);
      if (young !== undefined && this.rand() < 0.08) {
        const dest = ctx.findHome(SALARY[Math.max(0, this.jobLevel[young])], home);
        if (dest >= 0) {
          this.members[h].splice(this.members[h].indexOf(young), 1);
          this.residents[home] = Math.max(0, this.residents[home] - 1);
          const nh = this.newHousehold(dest);
          this.household[young] = nh;
          this.members[nh].push(young);
          this.residents[dest]++;
          this.month.moves++;
        }
      }
    }
    // Déménagement ou départ si le logement est trop cher, trop petit ou le quartier déplaisant
    const crowded = home >= 0 && this.residents[home] > ctx.capacity(home) * 1.05;
    if (home >= 0 && (burden > 0.5 || crowded || happy < 0.35) && this.rand() < 0.25) {
      const dest = ctx.findHome(income, home);
      if (dest >= 0 && dest !== home) { this.detach(h); this.attach(h, dest); this.month.moves++; }
      else if (happy < 0.3 || burden > 0.8 || (adults && m.every((c) => this.status[c] !== Status.Worker && this.age[c] < 65 && this.age[c] >= 18 && this.idle[c] > 10))) this.emigrate(h);
    }
    if (home < 0) {
      const dest = ctx.findHome(income, -1);
      if (dest >= 0) this.attach(h, dest); else this.emigrate(h);
    }
  }

  /** Comptes par case (élèves, malades) et clôture du mois. */
  tally(): void {
    this.students.fill(0);
    this.sickBy.fill(0);
    let under = 0, inc = 0, rent = 0;
    for (let h = 0; h < this.hCount; h++) if (this.hAlive[h]) { inc += this.hIncome[h]; rent += this.hRent[h]; }
    this.summaryBurden = inc ? rent / inc : 0;
    for (let c = 0; c < this.count; c++) if (this.alive[c] && this.status[c] === Status.Worker && this.jobLevel[c] < this.edu[c] - 1) under++;
    this.underemployedCount = under;
    for (let c = 0; c < this.count; c++) {
      if (!this.alive[c]) continue;
      const home = this.hHome[this.household[c]];
      if (home < 0) continue;
      const s = this.status[c];
      if (s === Status.Child || s === Status.Teen || s === Status.Student) this.students[home]++;
      if (this.sick[c]) this.sickBy[home]++;
    }
  }

  endMonth(): void {
    this.report = this.month;
    this.month = { births: 0, deaths: 0, immigrants: 0, emigrants: 0, moves: 0 };
  }

  // ---------- Statistiques ----------

  summary(): SocietySummary {
    const s: SocietySummary = {
      ages: [0, 0, 0, 0, 0, 0], edu: [0, 0, 0, 0], workers: 0, unemployed: 0, unemployedByEdu: [0, 0, 0, 0],
      underemployed: 0, students: 0, retired: 0, sick: 0, households: 0, avgIncome: 0, avgRent: 0, burden: 0, happiness: 0,
    };
    let inc = 0, rent = 0, hh = 0, happy = 0, adults = 0;
    for (let c = 0; c < this.count; c++) {
      if (!this.alive[c]) continue;
      const a = this.age[c], st = this.status[c];
      s.ages[a < 3 ? 0 : a < 11 ? 1 : a < 18 ? 2 : a < 28 ? 3 : a < 65 ? 4 : 5]++;
      if (a >= 25) { s.edu[this.edu[c]]++; adults++; }
      if (st === Status.Worker) { s.workers++; if (this.jobLevel[c] < this.edu[c] - 1) s.underemployed++; }
      if (st === Status.Unemployed) { s.unemployed++; s.unemployedByEdu[this.edu[c]]++; }
      if (st === Status.Student || st === Status.Child || st === Status.Teen) s.students++;
      if (st === Status.Retired) s.retired++;
      if (this.sick[c]) s.sick++;
      happy += this.happy[c];
    }
    for (let h = 0; h < this.hCount; h++) {
      if (!this.hAlive[h]) continue;
      hh++; inc += this.hIncome[h]; rent += this.hRent[h];
    }
    s.households = hh;
    s.avgIncome = hh ? inc / hh : 0;
    s.avgRent = hh ? rent / hh : 0;
    s.burden = inc ? rent / inc : 0;
    s.happiness = this.population ? happy / this.population : 0;
    void adults;
    return s;
  }

  // ---------- Sauvegarde ----------

  serialize(): Record<string, unknown> {
    const alive: number[] = [];
    for (let c = 0; c < this.count; c++) if (this.alive[c]) alive.push(c);
    const hs: number[] = [];
    for (let h = 0; h < this.hCount; h++) if (this.hAlive[h]) hs.push(h);
    const hIndex = new Map(hs.map((h, i) => [h, i]));
    return {
      c: alive.map((c) => [Math.round(this.age[c] * 12), this.edu[c], this.status[c], hIndex.get(this.household[c]) ?? 0, this.job[c], this.jobLevel[c], this.sick[c], this.seed[c]]),
      h: hs.map((h) => [this.hHome[h], this.hSeed[h]]),
    };
  }

  restore(data: { c: number[][]; h: number[][] }, isJobSite: (t: number) => boolean): void {
    for (const [home, seed] of data.h) { const h = this.newHousehold(home >= 0 && this.world.bState[home] === BuildState.Built ? home : -1); this.hSeed[h] = seed; }
    for (const [ageM, edu, status, hi, job, jl, sick, seed] of data.c) {
      const c = this.newCitizen(hi, ageM / 12, edu);
      this.status[c] = status; this.sick[c] = sick; this.seed[c] = seed;
      if (job >= 0 && jl >= 0 && isJobSite(job)) { this.job[c] = job; this.jobLevel[c] = jl; this.employees[job]++; this.employeesBy[jl][job]++; }
      else if (status === Status.Worker) this.status[c] = Status.Unemployed;
    }
  }
}

export interface SocietyContext {
  healthAccess: (tile: number) => number;
  schoolAccess: (tile: number) => number;
  pollution: (tile: number) => number;
  buildingHappiness: (tile: number) => number;
  findJob: (home: number, maxLevel: number) => [number, number] | null;
  isJobSite: (tile: number) => boolean;
  findHome: (income: number, from: number) => number;
  rent: (tile: number) => number;
  wageFactor: (tile: number) => number;
  distance: (a: number, b: number) => number;
  capacity: (tile: number) => number;
}

export interface SocietySummary {
  ages: number[];
  edu: number[];
  workers: number;
  unemployed: number;
  unemployedByEdu: number[];
  underemployed: number;
  students: number;
  retired: number;
  sick: number;
  households: number;
  avgIncome: number;
  avgRent: number;
  burden: number;
  happiness: number;
}

function statusFor(age: number, edu: number, _employed: boolean): Status {
  if (age < 3) return Status.Baby;
  if (age < 11) return Status.Child;
  if (age < 18) return Status.Teen;
  if (age < 22 && edu >= 2) return Status.Student;
  if (age >= 65) return Status.Retired;
  return Status.Unemployed;
}

export { Zone };
