import type { BudgetKey } from './services';
import { Zone, type ZoneType } from './zones';

/** Taux d'imposition par défaut (%) et bornes. */
export const DEFAULT_TAX = 9;
export const MIN_TAX = 0;
export const MAX_TAX = 29;

export const BUDGET_KEYS: BudgetKey[] = ['utilities', 'health', 'education', 'police', 'fire', 'parks', 'transport'];
export const BUDGET_NAMES: Record<BudgetKey, string> = {
  utilities: 'Réseaux',
  health: 'Santé',
  education: 'Éducation',
  police: 'Police',
  fire: 'Pompiers',
  parks: 'Parcs',
  transport: 'Transports',
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
