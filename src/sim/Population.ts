/** Démographie par tranches d'âge : naissances, vieillissement, décès, migrations, éducation. */

export const COHORTS = ['Nourrissons', 'Enfants', 'Adolescents', 'Jeunes adultes', 'Adultes', 'Seniors'];
export const COHORT_AGES = ['0-2 ans', '3-10 ans', '11-17 ans', '18-27 ans', '28-64 ans', '65 ans et +'];
/** Part des tranches qui passe à la suivante chaque mois. */
const AGING = [1 / 36, 1 / 96, 1 / 84, 1 / 120, 1 / 444, 0];
/** Profil d'âge des nouveaux arrivants. */
const NEWCOMERS = [0.04, 0.1, 0.06, 0.4, 0.35, 0.05];

export interface MonthReport {
  births: number;
  deaths: number;
  migration: number;
}

export class Demographics {
  shares = [0.05, 0.11, 0.09, 0.17, 0.42, 0.16];
  /** Part des actifs diplômés (0 à 1). */
  education = 0.3;
  /** Part de la population malade. */
  sick = 0.02;
  last: MonthReport = { births: 0, deaths: 0, migration: 0 };

  counts(pop: number): number[] {
    return this.shares.map((s) => Math.round(s * pop));
  }

  workers(pop: number): number {
    return Math.round(pop * (this.shares[3] * 0.85 + this.shares[4] * 0.95));
  }

  students(pop: number): number {
    return Math.round(pop * (this.shares[1] + this.shares[2] + this.shares[3] * 0.25));
  }

  monthly(pop: number, prevPop: number, happiness: number, health: number, education: number, air: number): MonthReport {
    if (pop <= 0) { this.last = { births: 0, deaths: 0, migration: 0 }; return this.last; }
    const s = this.shares;
    const births = pop * (s[3] * 0.6 + s[4] * 0.25) * 0.004 * (0.5 + happiness);
    const deathRate = 0.007 * (1 - 0.45 * health) + air * 0.003;
    const deaths = pop * s[5] * deathRate + pop * 0.0002;
    const migration = pop - prevPop - births + deaths;

    // Vieillissement
    const moved = s.map((v, i) => v * AGING[i]);
    for (let i = 0; i < s.length; i++) {
      s[i] -= moved[i];
      if (i > 0) s[i] += moved[i - 1];
    }
    // Naissances, décès, migrations (en parts de la population)
    s[0] += births / pop;
    s[5] = Math.max(0.01, s[5] - deaths / pop);
    if (migration >= 0) for (let i = 0; i < s.length; i++) s[i] += (migration / pop) * NEWCOMERS[i];
    else for (let i = 0; i < s.length; i++) s[i] *= 1 + migration / pop;
    const total = s.reduce((a, b) => a + b, 0);
    for (let i = 0; i < s.length; i++) s[i] = Math.max(0.005, s[i] / total);

    this.education += (Math.min(0.95, 0.12 + education * 0.8) - this.education) * 0.04;
    this.sick = Math.max(0.005, 0.025 + air * 0.12 - health * 0.018);
    this.last = { births: Math.round(births), deaths: Math.round(deaths), migration: Math.round(migration) };
    return this.last;
  }
}
