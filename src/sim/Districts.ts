import type { Simulation } from './Simulation';
import { BuildState, hasHomes, hasJobs, kindOf, Zone, type ZoneType } from './zones';

/**
 * Quartiers (§13) : le joueur trace des limites, nomme le quartier et lui applique
 * des politiques publiques et des impôts locaux.
 */

export type PolicyId =
  | 'parking' | 'trucks' | 'housingAid' | 'commerce' | 'lowEmission' | 'recycling'
  | 'transit' | 'quiet' | 'maintenance' | 'terraces' | 'noHeavyIndustry';

export interface PolicyInfo {
  name: string;
  /** Thème du cahier des charges. */
  theme: string;
  description: string;
  /** Coût mensuel : fixe + par logement + par entreprise. */
  flat: number;
  perHome: number;
  perBusiness: number;
  /** Recette mensuelle par emploi (stationnement, terrasses). */
  incomePerJob?: number;
}

export const POLICIES: Record<PolicyId, PolicyInfo> = {
  parking: { name: 'Stationnement payant', theme: 'Stationnement et circulation', description: 'Recette par emploi, valeur foncière en hausse ; commerces : −3 % de ventes.', flat: 50, perHome: 0, perBusiness: 0, incomePerJob: 1.5 },
  trucks: { name: 'Poids lourds limités', theme: 'Poids lourds et nuisances', description: 'Bruit −30 % ; industrie du quartier −5 % de production.', flat: 120, perHome: 0, perBusiness: 0 },
  housingAid: { name: 'Aides au logement', theme: 'Logement', description: 'Loyers −20 % pour les foyers du quartier, bonheur en hausse.', flat: 0, perHome: 4, perBusiness: 0 },
  commerce: { name: 'Incitations commerciales', theme: 'Commerce', description: 'Les commerces s’y installent plus volontiers ; ventes +5 %.', flat: 0, perHome: 0, perBusiness: 10 },
  lowEmission: { name: 'Zone à faibles émissions', theme: 'Environnement', description: 'Pollution de l’air −35 % ; commerces : −4 % de ventes.', flat: 300, perHome: 0, perBusiness: 0 },
  recycling: { name: 'Objectif recyclage', theme: 'Déchets', description: 'Déchets produits −20 %, tri à la source.', flat: 0, perHome: 1, perBusiness: 2 },
  transit: { name: 'Transports publics et vélo', theme: 'Mobilité', description: 'Pistes cyclables, abonnements aidés : bonheur +, air −10 %, valeur foncière +.', flat: 400, perHome: 0, perBusiness: 0 },
  quiet: { name: 'Quartier calme', theme: 'Horaires, bruit, livraisons', description: 'Livraisons en journée, bars fermés à 23 h : bruit −35 %, lumière −40 % ; commerces −5 %.', flat: 80, perHome: 0, perBusiness: 0 },
  maintenance: { name: 'Priorité d’entretien', theme: 'Investissement et entretien local', description: 'Routes et équipements du quartier s’usent deux fois moins vite.', flat: 350, perHome: 0, perBusiness: 0 },
  terraces: { name: 'Terrasses et marchés', theme: 'Occupation de l’espace public', description: 'Ventes des commerces +6 %, petite redevance ; un peu plus de bruit.', flat: 0, perHome: 0, perBusiness: 0, incomePerJob: 0.6 },
  noHeavyIndustry: { name: 'Industrie lourde interdite', theme: 'Poids lourds et nuisances', description: 'Plus aucune nouvelle usine ou mine dans le quartier.', flat: 0, perHome: 0, perBusiness: 0 },
};
export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];

export interface District {
  id: number;
  name: string;
  color: string;
  policies: PolicyId[];
  /** Ajustement local des impôts (points de %), par famille. */
  tax: Record<number, number>;
}

export interface DistrictStats {
  tiles: number;
  population: number;
  jobs: number;
  buildings: number;
  happiness: number;
  crime: number;
  air: number;
  noise: number;
  landValue: number;
  cost: number;
  income: number;
}

const NAMES = ['Centre-ville', 'Les Rives', 'Les Hauts', 'Le Port', 'La Gare', 'Les Tilleuls', 'Saint-Martin', 'Belvédère', 'Les Prés', 'Bois-Joli',
  'La Fontaine', 'Les Vignes', 'Le Moulin', 'Les Pins', 'La Colline', 'Le Marché', 'Les Jardins', 'Val-Fleuri', 'Les Forges', 'La Plaine'];
const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#a3e635', '#fb923c', '#e879f9', '#2dd4bf', '#facc15'];

export class Districts {
  list: District[] = [];
  private nextId = 1;
  private byId = new Map<number, District>();
  private policyCache = new Map<number, Set<PolicyId>>();

  constructor(private sim: Simulation) {}

  get map(): Uint8Array { return this.sim.world.district; }

  private reindex(): void {
    this.byId = new Map(this.list.map((d) => [d.id, d]));
    this.policyCache = new Map(this.list.map((d) => [d.id, new Set(d.policies)]));
  }

  get(id: number): District | undefined { return this.byId.get(id); }

  create(): District {
    const used = new Set(this.list.map((d) => d.name));
    const name = NAMES.find((n) => !used.has(n)) ?? `Quartier ${this.nextId}`;
    const d: District = { id: this.nextId++, name, color: COLORS[(this.nextId - 2) % COLORS.length], policies: [], tax: {} };
    if (d.id > 250) throw new Error('Trop de quartiers');
    this.list.push(d);
    this.reindex();
    return d;
  }

  remove(id: number): void {
    this.list = this.list.filter((d) => d.id !== id);
    const m = this.map;
    for (let k = 0; k < m.length; k++) if (m[k] === id) m[k] = 0;
    this.reindex();
  }

  rename(id: number, name: string): void {
    const d = this.byId.get(id);
    if (d && name.trim()) d.name = name.trim().slice(0, 32);
  }

  /** Attribue des cases à un quartier (0 = hors quartier). */
  paint(tiles: number[], id: number): number {
    const m = this.map, w = this.sim.world;
    let n = 0;
    for (const t of tiles) if (!w.isWater(t % w.size, Math.floor(t / w.size)) && m[t] !== id) { m[t] = id; n++; }
    return n;
  }

  togglePolicy(id: number, p: PolicyId): void {
    const d = this.byId.get(id);
    if (!d) return;
    d.policies = d.policies.includes(p) ? d.policies.filter((x) => x !== p) : [...d.policies, p];
    this.reindex();
  }

  setTax(id: number, kind: ZoneType, delta: number): void {
    const d = this.byId.get(id);
    if (d) d.tax[kind] = Math.max(-5, Math.min(5, Math.round(delta)));
  }

  /** La politique s'applique-t-elle à cette case ? */
  has(tile: number, p: PolicyId): boolean {
    const id = this.map[tile];
    return id !== 0 && (this.policyCache.get(id)?.has(p) ?? false);
  }

  /** Ajustement local de l'impôt pour une case et une famille économique. */
  taxMod(tile: number, kind: number): number {
    const id = this.map[tile];
    return id ? this.byId.get(id)?.tax[kind] ?? 0 : 0;
  }

  nameAt(tile: number): string | null {
    const id = this.map[tile];
    return id ? this.byId.get(id)?.name ?? null : null;
  }

  /** Multiplicateur des ventes des commerces selon les politiques locales. */
  commerceFactor(tile: number): number {
    if (!this.map[tile]) return 1;
    let f = 1;
    if (this.has(tile, 'parking')) f -= 0.03;
    if (this.has(tile, 'commerce')) f += 0.05;
    if (this.has(tile, 'lowEmission')) f -= 0.04;
    if (this.has(tile, 'quiet')) f -= 0.05;
    if (this.has(tile, 'terraces')) f += 0.06;
    return f;
  }

  /** Bonheur ajouté par les politiques du quartier. */
  happiness(tile: number): number {
    if (!this.map[tile]) return 0;
    let h = 0;
    if (this.has(tile, 'housingAid') && hasHomes(this.sim.world.zones[tile])) h += 0.04;
    if (this.has(tile, 'transit')) h += 0.025;
    if (this.has(tile, 'quiet') && hasHomes(this.sim.world.zones[tile])) h += 0.02;
    if (this.has(tile, 'parking') && hasHomes(this.sim.world.zones[tile])) h -= 0.01;
    return h;
  }

  /** Applique les politiques aux cartes de pollution (après leur calcul). */
  applyToPollution(air: Float32Array, noise: Float32Array, light: Float32Array): void {
    if (!this.list.some((d) => d.policies.length)) return;
    const m = this.map;
    for (let k = 0; k < m.length; k++) {
      if (!m[k]) continue;
      if (this.has(k, 'lowEmission')) air[k] *= 0.65;
      if (this.has(k, 'transit')) air[k] *= 0.9;
      if (this.has(k, 'trucks')) noise[k] *= 0.7;
      if (this.has(k, 'quiet')) { noise[k] *= 0.65; light[k] *= 0.6; }
      if (this.has(k, 'terraces')) noise[k] = Math.min(1, noise[k] + 0.04);
    }
  }

  /** Coût et recettes mensuels des politiques, par quartier. */
  budget(): { cost: number; income: number; by: Map<number, [number, number]> } {
    const sim = this.sim, w = sim.world, c = sim.society.citizens;
    const by = new Map<number, [number, number]>();
    for (const d of this.list) by.set(d.id, [d.policies.reduce((a, p) => a + POLICIES[p].flat, 0), 0]);
    for (let k = 0; k < w.bState.length; k++) {
      const id = this.map[k];
      if (!id || w.bState[k] !== BuildState.Built) continue;
      const d = this.byId.get(id);
      if (!d || !d.policies.length) continue;
      const e = by.get(id)!;
      for (const p of d.policies) {
        const info = POLICIES[p];
        if (info.perHome) e[0] += info.perHome * c.homesTaken[k];
        if (info.perBusiness && hasJobs(w.zones[k]) && c.employees[k]) e[0] += info.perBusiness;
        if (info.incomePerJob) e[1] += info.incomePerJob * c.employees[k];
      }
    }
    let cost = 0, income = 0;
    for (const [, [a, b]] of by) { cost += a; income += b; }
    return { cost, income, by };
  }

  /** Indicateurs d'un quartier. */
  stats(id: number): DistrictStats {
    const sim = this.sim, w = sim.world, ut = sim.utilities, c = sim.society.citizens;
    const s: DistrictStats = { tiles: 0, population: 0, jobs: 0, buildings: 0, happiness: 0, crime: 0, air: 0, noise: 0, landValue: 0, cost: 0, income: 0 };
    for (let k = 0; k < this.map.length; k++) {
      if (this.map[k] !== id) continue;
      s.tiles++;
      if (w.bState[k] !== BuildState.Built) continue;
      s.buildings++;
      s.population += c.residents[k];
      s.jobs += c.employees[k];
      s.happiness += ut.happiness[k]; s.crime += ut.crime[k]; s.air += ut.air[k]; s.noise += ut.noise[k];
      s.landValue += sim.society.landValue[k];
    }
    if (s.buildings) for (const key of ['happiness', 'crime', 'air', 'noise', 'landValue'] as const) s[key] /= s.buildings;
    const b = this.budget().by.get(id);
    if (b) { s.cost = b[0]; s.income = b[1]; }
    return s;
  }

  /** Une nouvelle usine ou mine peut-elle s'installer ici ? */
  allowsIndustry(tile: number, zone: number): boolean {
    return !(this.has(tile, 'noHeavyIndustry') && kindOf(zone) === Zone.Industrial && zone !== Zone.Agriculture && zone !== Zone.Forestry && zone !== Zone.Logistics);
  }

  serialize(): unknown {
    return { list: this.list, nextId: this.nextId };
  }

  restore(d: { list?: District[]; nextId?: number } | undefined): void {
    if (!d) return;
    this.list = d.list ?? [];
    this.nextId = d.nextId ?? this.list.reduce((a, x) => Math.max(a, x.id + 1), 1);
    this.reindex();
  }
}
