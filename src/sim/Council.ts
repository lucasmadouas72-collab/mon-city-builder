import type { Simulation } from './Simulation';
import { Coverage } from './services';
import { DEFAULT_TAX } from './economy';
import { diagnose } from './Advisor';

/**
 * Conseil municipal (§13) : indicateurs de mandat, objectifs annuels, plaintes des habitants,
 * projets proposés (coût, délai, effets attendus, risques) et élections tous les 4 ans.
 */

export type ModKey = 'happiness' | 'crime' | 'garbage' | 'landValue' | 'tourism' | 'education' | 'health' | 'maintenance' | 'commerce' | 'construction';

export interface Modifier { key: ModKey; value: number; until: number; source: string }

interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  cost: number;
  months: number;
  effect: string;
  risk: string;
  /** Probabilité que le risque se réalise. */
  riskChance: number;
  riskKind: 'overrun' | 'delay' | 'weak';
  mods: Array<[ModKey, number]>;
  /** Durée de l'effet (mois). */
  duration: number;
  /** Proposé seulement si… */
  when?: (sim: Simulation) => boolean;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  cost: number;
  months: number;
  effect: string;
  risk: string;
  riskChance: number;
  status: 'proposed' | 'running' | 'done' | 'rejected';
  progress: number;
  /** Mois de fin prévu (pour les projets en cours). */
  end: number;
  outcome?: string;
}

const PROJECTS: ProjectTemplate[] = [
  { id: 'schools', title: 'Rénovation des écoles', description: 'Isolation, numérique et nouvelles salles de classe.', cost: 18000, months: 4, effect: 'Éducation : +15 % d’efficacité pendant 2 ans', risk: 'Dépassement de budget de 25 %', riskChance: 0.25, riskKind: 'overrun', mods: [['education', 0.15]], duration: 24, when: (s) => s.stats.population > 300 },
  { id: 'health', title: 'Plan santé de proximité', description: 'Maisons médicales et prévention dans les quartiers.', cost: 22000, months: 5, effect: 'Santé : +15 % d’efficacité pendant 2 ans, bonheur +2 %', risk: 'Retard de 3 mois (recrutement)', riskChance: 0.3, riskKind: 'delay', mods: [['health', 0.15], ['happiness', 0.02]], duration: 24, when: (s) => s.stats.population > 500 },
  { id: 'police', title: 'Police de proximité', description: 'Patrouilles à pied et médiateurs de quartier.', cost: 15000, months: 3, effect: 'Délinquance −12 % pendant 18 mois', risk: 'Effet moitié moindre si le chômage reste élevé', riskChance: 0.3, riskKind: 'weak', mods: [['crime', 0.12]], duration: 18, when: (s) => s.crimeIndex > 0.2 },
  { id: 'clean', title: 'Grande campagne de propreté', description: 'Tri sélectif, composteurs et sensibilisation.', cost: 9000, months: 2, effect: 'Déchets produits −12 % pendant 2 ans', risk: 'Habitudes difficiles à changer : effet réduit', riskChance: 0.25, riskKind: 'weak', mods: [['garbage', 0.12]], duration: 24 },
  { id: 'greenways', title: 'Coulées vertes', description: 'Arbres d’alignement, places plantées, berges aménagées.', cost: 25000, months: 6, effect: 'Valeur foncière +4 %, bonheur +2 % pendant 3 ans', risk: 'Dépassement de budget de 25 %', riskChance: 0.3, riskKind: 'overrun', mods: [['landValue', 0.04], ['happiness', 0.02]], duration: 36 },
  { id: 'festival', title: 'Festival d’été', description: 'Concerts, marchés nocturnes et animations.', cost: 8000, months: 1, effect: 'Bonheur +4 % et tourisme +10 % pendant 4 mois', risk: 'Météo défavorable : effet réduit', riskChance: 0.35, riskKind: 'weak', mods: [['happiness', 0.04], ['tourism', 0.1]], duration: 4 },
  { id: 'roads', title: 'Plan de rénovation de la voirie', description: 'Programme pluriannuel de réfection des chaussées et des équipements.', cost: 30000, months: 6, effect: 'Usure des routes et équipements −40 % pendant 3 ans', risk: 'Retard de 3 mois (chantiers)', riskChance: 0.3, riskKind: 'delay', mods: [['maintenance', 0.4]], duration: 36, when: (s) => s.roadCount > 150 },
  { id: 'shops', title: 'Revitalisation du commerce', description: 'Façades rénovées, signalétique, animations commerciales.', cost: 14000, months: 3, effect: 'Ventes des commerces +6 % pendant 2 ans', risk: 'Effet réduit si le pouvoir d’achat baisse', riskChance: 0.25, riskKind: 'weak', mods: [['commerce', 0.06]], duration: 24, when: (s) => s.stats.population > 600 },
  { id: 'permits', title: 'Guichet unique des permis', description: 'Instruction plus rapide des permis de construire.', cost: 7000, months: 2, effect: 'Chantiers 30 % plus rapides pendant 3 ans', risk: 'Retard de 3 mois (informatique)', riskChance: 0.25, riskKind: 'delay', mods: [['construction', 0.3]], duration: 36 },
  { id: 'tourism', title: 'Office de tourisme et patrimoine', description: 'Mise en valeur du patrimoine, circuits et promotion.', cost: 16000, months: 4, effect: 'Attrait touristique +15 % pendant 3 ans', risk: 'Dépassement de budget de 25 %', riskChance: 0.2, riskKind: 'overrun', mods: [['tourism', 0.15]], duration: 36, when: (s) => s.stats.population > 1000 },
];

export interface Objective { id: string; text: string; reward: number; check: (sim: Simulation) => boolean; done?: boolean | null; target?: number }

interface ObjectiveTemplate { id: string; make: (sim: Simulation, target?: number, force?: boolean) => Objective | null }

const OBJECTIVES: ObjectiveTemplate[] = [
  { id: 'pop', make: (s, t) => { const target = t ?? Math.max(500, Math.round((s.stats.population * 1.3 + 300) / 100) * 100); return { id: 'pop', target, text: `Atteindre ${target.toLocaleString('fr-FR')} habitants`, reward: 8000 + target, check: (x) => x.stats.population >= target }; } },
  { id: 'unemp', make: (s, _t, f) => (f || s.stats.population > 200 ? { id: 'unemp', text: 'Chômage sous 6 %', reward: 10000, check: (x) => x.stats.unemployment < 0.06 } : null) },
  { id: 'health', make: (s, _t, f) => (f || s.stats.population > 400 ? { id: 'health', text: '70 % des bâtiments couverts par la santé', reward: 12000, check: (x) => (x.utilities.stats.coverage[Coverage.Health] ?? 0) >= 0.7 } : null) },
  { id: 'air', make: () => ({ id: 'air', text: 'Pollution de l’air moyenne sous 15 %', reward: 9000, check: (x) => x.utilities.stats.air < 0.15 }) },
  { id: 'balance', make: () => ({ id: 'balance', text: 'Finir l’année avec un solde mensuel positif', reward: 7000, check: (x) => x.stats.income - x.stats.expenses > 0 }) },
  { id: 'happy', make: () => ({ id: 'happy', text: 'Bonheur moyen au-dessus de 60 %', reward: 12000, check: (x) => x.utilities.stats.happiness >= 0.6 }) },
  { id: 'waste', make: (s, _t, f) => (f || s.stats.population > 300 ? { id: 'waste', text: 'Moins de 5 % de bâtiments sans collecte des déchets', reward: 8000, check: (x) => x.waste.stats.accumulating <= x.stats.buildings * 0.05 } : null) },
  { id: 'crime', make: (s, _t, f) => (f || s.stats.population > 1000 ? { id: 'crime', text: 'Délinquance sous 20 %', reward: 10000, check: (x) => x.crimeIndex < 0.2 } : null) },
];

const TERM = 48;

export class Council {
  approval = 0.6;
  /** Historique mensuel de la cote de popularité. */
  approvalHistory: number[] = [];
  projects: Project[] = [];
  modifiers: Modifier[] = [];
  objectives: Objective[] = [];
  complaints: Array<{ text: string; count: number; district: string | null }> = [];
  elections: Array<{ month: number; score: number; won: boolean }> = [];
  private rand = Math.random;

  constructor(private sim: Simulation) {}

  /** Somme des effets en cours pour une clé. */
  mod(key: ModKey): number {
    let v = 0;
    for (const m of this.modifiers) if (m.key === key) v += m.value;
    return v;
  }

  get termMonth(): number { return this.sim.monthIndex % TERM; }
  get monthsToElection(): number { return TERM - this.termMonth; }
  get mandate(): number { return Math.floor(this.sim.monthIndex / TERM) + 1; }

  /** Cote de popularité : bonheur, emploi, sécurité, finances, impôts. */
  computeApproval(): number {
    const s = this.sim, st = s.stats;
    if (!st.population) return 0.6;
    const taxes = Object.values(s.taxes).reduce((a, b) => a + b, 0) / 4;
    const balance = st.income - st.expenses;
    let a = 0.15 + s.utilities.stats.happiness * 0.55 + (1 - Math.min(1, st.unemployment * 4)) * 0.15 + (1 - s.crimeIndex) * 0.1
      + (s.money < 0 ? -0.15 : balance < 0 ? -0.05 : 0.05) - Math.max(0, taxes - DEFAULT_TAX) * 0.012;
    a -= Math.min(0.12, this.complaints.reduce((x, c) => x + c.count, 0) * 0.004);
    a += this.projects.filter((p) => p.status === 'done' && p.end > s.monthIndex - 12).length * 0.01;
    return Math.max(0, Math.min(1, a));
  }

  /** Chaque mois : avancement des projets, nouvelles propositions, plaintes, cote, élections, objectifs. */
  monthly(): void {
    const s = this.sim, mi = s.monthIndex;
    this.modifiers = this.modifiers.filter((m) => m.until > mi);
    for (const p of this.projects) {
      if (p.status !== 'running') continue;
      p.progress = Math.min(1, p.progress + 1 / Math.max(1, p.months));
      if (mi >= p.end) this.finish(p);
    }
    this.projects = this.projects.filter((p) => p.status !== 'rejected' && !(p.status === 'done' && p.end < mi - 24));
    // Nouvelles propositions (au plus 3 en attente)
    const pending = this.projects.filter((p) => p.status === 'proposed').length;
    if (pending < 3 && (pending === 0 || this.rand() < 0.4)) this.propose();
    this.complaints = this.collectComplaints();
    this.approval = this.computeApproval();
    this.approvalHistory.push(this.approval);
    if (this.approvalHistory.length > 120) this.approvalHistory.shift();
    // Objectifs annuels : bilan en fin d'année, nouveaux objectifs en début d'année
    if (mi > 0 && mi % 12 === 0) this.yearEnd();
    if (mi % 12 === 0 || !this.objectives.length) this.newObjectives();
    if (mi > 0 && mi % TERM === 0) this.election();
  }

  private propose(): void {
    const s = this.sim;
    const taken = new Set(this.projects.filter((p) => p.status !== 'done').map((p) => p.id));
    const recent = new Set(this.projects.map((p) => p.id));
    const options = PROJECTS.filter((t) => !taken.has(t.id) && !recent.has(t.id) && (!t.when || t.when(s)));
    const pool = options.length ? options : PROJECTS.filter((t) => !taken.has(t.id) && (!t.when || t.when(s)));
    if (!pool.length) return;
    const t = pool[Math.floor(this.rand() * pool.length)];
    const scale = 1 + Math.min(3, s.stats.population / 5000);
    this.projects.unshift({ id: t.id, title: t.title, description: t.description, cost: Math.round((t.cost * scale) / 100) * 100, months: t.months, effect: t.effect, risk: t.risk, riskChance: t.riskChance, status: 'proposed', progress: 0, end: 0 });
  }

  /** Le joueur approuve un projet : il est payé et lancé. */
  approve(id: string): boolean {
    const s = this.sim, p = this.projects.find((x) => x.id === id && x.status === 'proposed');
    if (!p) return false;
    if (!s.sandbox && s.money < p.cost) { s.events.emit('notify', { text: 'Fonds insuffisants pour ce projet', kind: 'error' }); return false; }
    s.payInvestment(p.cost, 'projects');
    p.status = 'running';
    p.end = s.monthIndex + p.months;
    s.events.emit('notify', { text: `Projet lancé : ${p.title} (${p.months} mois)`, kind: 'info' });
    return true;
  }

  reject(id: string): void {
    const p = this.projects.find((x) => x.id === id && x.status === 'proposed');
    if (p) { p.status = 'rejected'; this.approval = Math.max(0, this.approval - 0.005); }
  }

  private finish(p: Project): void {
    const s = this.sim, t = PROJECTS.find((x) => x.id === p.id)!;
    let factor = 1;
    if (this.rand() < p.riskChance && !p.outcome) {
      if (t.riskKind === 'delay') { p.end += 3; p.outcome = 'Retard de 3 mois'; s.events.emit('notify', { text: `${p.title} : retard de 3 mois`, kind: 'warn' }); return; }
      if (t.riskKind === 'overrun') { const extra = Math.round(p.cost * 0.25); s.payInvestment(extra, 'projects'); p.outcome = `Dépassement : +${extra.toLocaleString('fr-FR')} €`; }
      if (t.riskKind === 'weak') { factor = 0.5; p.outcome = 'Effet moitié moindre que prévu'; }
    }
    p.status = 'done';
    p.progress = 1;
    for (const [key, value] of t.mods) this.modifiers.push({ key, value: value * factor, until: s.monthIndex + t.duration, source: t.title });
    s.events.emit('notify', { text: `Projet terminé : ${p.title}${p.outcome ? ` (${p.outcome.toLowerCase()})` : ''}`, kind: 'info' });
  }

  private newObjectives(): void {
    const s = this.sim;
    const pool = OBJECTIVES.map((o) => o.make(s)).filter((o): o is Objective => !!o);
    const out: Objective[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    this.objectives = out;
  }

  private yearEnd(): void {
    const s = this.sim;
    let reward = 0, ok = 0;
    for (const o of this.objectives) { o.done = o.check(s); if (o.done) { reward += o.reward; ok++; } }
    if (reward && !s.sandbox) { s.money += reward; s.events.emit('moneyChanged', s.money); }
    this.approval = Math.max(0, Math.min(1, this.approval + ok * 0.02 - (this.objectives.length - ok) * 0.01));
    if (this.objectives.length) s.events.emit('notify', { text: `Bilan de l’année : ${ok}/${this.objectives.length} objectifs atteints${reward ? ` · subvention de ${reward.toLocaleString('fr-FR')} €` : ''}`, kind: ok ? 'info' : 'warn' });
  }

  private election(): void {
    const s = this.sim;
    const score = Math.round((0.3 + this.approval * 0.5 + (this.rand() - 0.5) * 0.08) * 100) / 100;
    const won = score >= 0.5;
    this.elections.push({ month: s.monthIndex, score, won });
    if (won) {
      const grant = Math.round(Math.max(0, s.stats.income) * 2);
      if (!s.sandbox) { s.money += grant; s.events.emit('moneyChanged', s.money); }
      s.events.emit('notify', { text: `Élections municipales : réélu avec ${Math.round(score * 100)} % des voix · dotation de ${grant.toLocaleString('fr-FR')} €`, kind: 'info' });
    } else {
      // Majorité perdue : le nouveau conseil gèle les projets et impose une pause fiscale
      for (const p of this.projects) if (p.status === 'proposed') p.status = 'rejected';
      this.modifiers.push({ key: 'happiness', value: -0.03, until: s.monthIndex + 12, source: 'Défaite électorale' });
      s.events.emit('notify', { text: `Élections municipales : seulement ${Math.round(score * 100)} % des voix. Votre majorité est fragilisée (bonheur −3 % pendant un an).`, kind: 'error' });
    }
  }

  /** Plaintes des habitants, tirées des problèmes réels de la ville. */
  private collectComplaints(): Array<{ text: string; count: number; district: string | null }> {
    const s = this.sim;
    const QUOTES: Record<string, string> = {
      'util-0': '« Encore une coupure de courant, le frigo a lâché ! »', 'util-1': '« Pas d’eau au robinet depuis ce matin. »',
      'util-2': '« Les égouts débordent dans la rue. »', 'util-3': '« Les poubelles s’entassent, ça sent mauvais. »',
      school: '« Mes enfants n’ont pas de place à l’école. »', health: '« Trois semaines pour voir un médecin… »',
      crime: '« On ne se sent plus en sécurité le soir. »', traffic: '« Une heure de bouchons pour aller travailler ! »',
      unemployment: '« Je cherche du travail depuis des mois. »', pollution: '« L’air est irrespirable près de l’usine. »',
      'rent-burden': '« Le loyer prend la moitié de mon salaire. »', 'housing-shortage': '« Impossible de trouver un logement. »',
      happiness: '« Cette ville ne pense pas à ses habitants. »', budget: '« Où passe l’argent de nos impôts ? »',
      'waste-trucks': '« Le camion-poubelle ne passe plus. »', pressure: '« L’eau coule à peine au 10e étage. »',
      'sewage-overflow': '« La rivière est devenue un égout. »', worn: '« La route est pleine de nids-de-poule. »',
      abandoned: '« Les immeubles abandonnés attirent les squatteurs. »',
    };
    const issues = diagnose(s).filter((i) => i.severity !== 'good' && QUOTES[i.id]);
    return issues.slice(0, 6).map((i) => ({
      text: QUOTES[i.id], count: i.severity === 'critical' ? 8 : i.severity === 'serious' ? 5 : 2,
      district: i.tile !== undefined ? s.districts.nameAt(i.tile) : null,
    }));
  }

  serialize(): unknown {
    return {
      approval: this.approval, approvalHistory: this.approvalHistory, projects: this.projects, modifiers: this.modifiers, elections: this.elections,
      objectives: this.objectives.map((o) => ({ id: o.id, done: o.done ?? null, target: o.target })),
    };
  }

  restore(d: Record<string, any> | undefined): void {
    if (!d) return;
    this.approval = d.approval ?? 0.6;
    this.approvalHistory = d.approvalHistory ?? [];
    this.projects = d.projects ?? [];
    this.modifiers = d.modifiers ?? [];
    this.elections = d.elections ?? [];
    // Les objectifs sont régénérés à partir des modèles (leurs conditions ne se sauvegardent pas)
    this.objectives = (d.objectives ?? []).map((x: { id: string; done: boolean | null; target?: number }) => {
      const o = OBJECTIVES.find((t) => t.id === x.id)?.make(this.sim, x.target, true);
      return o ? { ...o, done: x.done } : null;
    }).filter(Boolean);
  }
}
