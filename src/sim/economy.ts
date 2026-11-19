import type { BudgetKey } from './services';
import { Zone, type ZoneType } from './zones';

/** Taux d'imposition par défaut (%) et bornes. */
export const DEFAULT_TAX = 9;
export const MIN_TAX = 0;
export const MAX_TAX = 29;

export const BUDGET_KEYS: BudgetKey[] = ['utilities', 'health', 'education', 'police', 'fire', 'parks', 'transport', 'maintenance', 'culture'];
export const BUDGET_NAMES: Record<BudgetKey, string> = {
  utilities: 'Réseaux',
  health: 'Santé',
  education: 'Éducation',
  police: 'Police',
  fire: 'Pompiers',
  parks: 'Parcs',
  transport: 'Transports',
  maintenance: 'Entretien du patrimoine',
  culture: 'Culture, sport et loisirs',
};

export interface LoanOffer {
  amount: number;
  /** Taux annuel (%). */
  rate: number;
  months: number;
}

export const LOAN_OFFERS: LoanOffer[] = [
  { amount: 15_000, rate: 4, months: 24 },
  { amount: 40_000, rate: 6, months: 48 },
  { amount: 100_000, rate: 8, months: 96 },
];
export const MAX_LOANS = 3;

export interface Loan {
  amount: number;
  rate: number;
  months: number;
  remaining: number;
  payment: number;
  /** Mois de souscription. */
  takenAt?: number;
}

/** Pénalité de remboursement anticipé (part du capital restant dû). */
export const EARLY_REPAY_PENALTY = 0.02;

export interface ScheduleRow { month: number; payment: number; interest: number; principal: number; balance: number }

/** Échéancier d'un emprunt à taux fixe (mensualités constantes). */
export function loanSchedule(o: LoanOffer): ScheduleRow[] {
  const r = o.rate / 100 / 12, pay = loanPayment(o);
  let bal = o.amount;
  const rows: ScheduleRow[] = [];
  for (let m = 1; m <= o.months; m++) {
    const interest = bal * r;
    const principal = m === o.months ? bal : Math.min(bal, pay - interest);
    bal = Math.max(0, bal - principal);
    rows.push({ month: m, payment: m === o.months ? principal + interest : pay, interest, principal, balance: bal });
  }
  return rows;
}

/** Coût total des intérêts d'une offre. */
export function loanInterest(o: LoanOffer): number {
  return loanPayment(o) * o.months - o.amount;
}

/** Mensualité d'un emprunt à taux fixe. */
export function loanPayment(o: LoanOffer): number {
  const r = o.rate / 100 / 12;
  return Math.round((o.amount * r) / (1 - Math.pow(1 + r, -o.months)));
}

export interface Milestone {
  name: string;
  pop: number;
  reward: number;
  unlocks: string;
}

export const MILESTONES: Milestone[] = [
  { name: 'Hameau', pop: 0, reward: 0, unlocks: 'Routes, zones, électricité, eau, pompiers, parcs' },
  { name: 'Village', pop: 300, reward: 10_000, unlocks: "Clinique, école, station d'épuration, centre de tri" },
  { name: 'Bourg', pop: 600, reward: 15_000, unlocks: 'Zones de bureaux' },
  { name: 'Petite ville', pop: 1200, reward: 25_000, unlocks: 'Commissariat, lignes de bus' },
  { name: 'Ville', pop: 3000, reward: 50_000, unlocks: 'Métro' },
  { name: 'Grande ville', pop: 7000, reward: 100_000, unlocks: 'Prestige' },
  { name: 'Métropole', pop: 15000, reward: 200_000, unlocks: 'Prestige' },
  { name: 'Mégapole', pop: 30000, reward: 400_000, unlocks: 'Prestige' },
];

export function milestoneIndex(pop: number): number {
  let k = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (pop >= MILESTONES[i].pop) k = i;
  return k;
}

export const BUS_UNLOCK = 1200;
export const BUS_STOP_COST = 250;
export const BUS_UPKEEP = 60; // par bus et par mois
export const METRO_LINE_UPKEEP = 400; // par ligne et par mois
export const TICKET_PRICE = 1.5;

export const defaultTaxes = (): Record<ZoneType, number> => ({
  [Zone.Residential]: DEFAULT_TAX, [Zone.Commercial]: DEFAULT_TAX, [Zone.Industrial]: DEFAULT_TAX, [Zone.Office]: DEFAULT_TAX,
});
export const defaultBudgets = (): Record<BudgetKey, number> =>
  Object.fromEntries(BUDGET_KEYS.map((k) => [k, 100])) as Record<BudgetKey, number>;
