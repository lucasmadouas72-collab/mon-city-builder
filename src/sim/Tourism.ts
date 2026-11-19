import type { Simulation } from './Simulation';
import { SERVICE_INFO, Service } from './services';
import { Season } from './Environment';
import { BuildState, Zone } from './zones';

/**
 * Tourisme, culture, sport et événements (§15) : fréquentation des équipements selon la saison,
 * touristes et hôtels, recettes ; événements programmés par le joueur, avec estimation
 * (visiteurs, sécurité, transports, recettes, nuisances), déroulement et archives.
 */

/** Part des entrées encaissée par la ville. */
const CITY_SHARE = 0.12;

export type EventKind = 'match' | 'concert' | 'festival' | 'fair' | 'market' | 'competition' | 'show' | 'seasonal';

export interface EventInfo { name: string; draw: number; ticket: number; cost: number; days: number; noise: number; outdoor: boolean; tourists: number }

export const EVENT_INFO: Record<EventKind, EventInfo> = {
  match: { name: 'Match', draw: 1.1, ticket: 25, cost: 6000, days: 1, noise: 0.25, outdoor: false, tourists: 0.2 },
  concert: { name: 'Concert', draw: 1.2, ticket: 40, cost: 12000, days: 1, noise: 0.35, outdoor: false, tourists: 0.35 },
  festival: { name: 'Festival', draw: 1.5, ticket: 15, cost: 18000, days: 3, noise: 0.3, outdoor: true, tourists: 0.5 },
  fair: { name: 'Salon professionnel', draw: 0.7, ticket: 20, cost: 9000, days: 3, noise: 0.05, outdoor: false, tourists: 0.6 },
  market: { name: 'Marché', draw: 0.9, ticket: 0, cost: 1500, days: 1, noise: 0.08, outdoor: true, tourists: 0.15 },
  competition: { name: 'Compétition sportive', draw: 0.8, ticket: 12, cost: 5000, days: 2, noise: 0.15, outdoor: false, tourists: 0.3 },
  show: { name: 'Spectacle', draw: 0.6, ticket: 30, cost: 4000, days: 2, noise: 0.05, outdoor: false, tourists: 0.15 },
  seasonal: { name: 'Fête saisonnière', draw: 1.3, ticket: 0, cost: 7000, days: 4, noise: 0.15, outdoor: true, tourists: 0.3 },
};

export interface EventEstimate {
  visitors: number;
  tourists: number;
  security: number;
  securityAvailable: number;
  transitShare: number;
  parking: number;
  revenue: number;
  cost: number;
  noise: number;
  warnings: string[];
}

export interface CityEvent {
  id: number;
  venue: number;
  kind: EventKind;
  day: number;
  capacity: number;
  status: 'planned' | 'running' | 'done' | 'cancelled';
  est: EventEstimate;
  result?: { visitors: number; revenue: number; cost: number; incidents: number; satisfaction: number; notes: string[] };
}

export interface FacilityStat { tile: number; service: Service; visitors: number; capacity: number; revenue: number }

/** Lieux pouvant accueillir des événements : équipements de loisirs et parcs. */
export function venueEvents(svc: Service): EventKind[] {
  if (svc === Service.Park) return ['market', 'festival', 'seasonal'];
  return (SERVICE_INFO[svc as Exclude<Service, 0>]?.leisure?.events ?? []) as EventKind[];
}

export class Tourism {
  /** Touristes du dernier mois et nuitées. */
  tourists = 0;
  /** Facteur de remplissage des hôtels (fourni à l'économie). */
  hotelFactor = 1;
  hotelRooms = 0;
  occupancy = 0;
  /** Dépenses des touristes dans les commerces (€ par mois). */
  spending = 0;
  facilities: FacilityStat[] = [];
  events: CityEvent[] = [];
  history: CityEvent[] = [];
  private nextId = 1;
  /** Recettes et coûts du mois (entrées, billetterie des événements). */
  monthIncome = 0;
  monthCost = 0;
  lastIncome = 0;
  lastCost = 0;
  private rand = Math.random;

  constructor(private sim: Simulation) {}

  private season(monthOffset = 0): Season {
    return this.sim.env.season(this.sim.monthIndex + monthOffset);
  }

  /** Effet de la saison sur la fréquentation d'un équipement. */
  seasonFactor(svc: Service, season = this.season()): number {
    if (svc === Service.Beach) return [0.8, 1.6, 0.5, 0.15][season];
    if (svc === Service.Pool) return [1, 1.4, 0.9, 0.7][season];
    if (svc === Service.IceRink) return [0.6, 0.4, 1, 1.6][season];
    if (svc === Service.Promenade || svc === Service.Zoo || svc === Service.AmusementPark) return [1.1, 1.4, 0.9, 0.5][season];
    return [1, 0.9, 1, 1.1][season];
  }

  /** Score d'attraction de la ville (somme des attraits, plafonnée). */
  attraction(): number {
    const w = this.sim.world;
    let a = 0;
    for (let k = 0; k < w.service.length; k++) { const l = SERVICE_INFO[w.service[k] as Exclude<Service, 0>]?.leisure; if (l) a += l.appeal; }
    return Math.min(1.5, a);
  }

  /** Bilan mensuel : touristes, hôtels, fréquentation et recettes des équipements. */
  monthly(): void {
    const sim = this.sim, w = sim.world, n = w.size, c = sim.society.citizens;
    const attraction = this.attraction();
    let infoBoost = 1;
    for (let k = 0; k < w.service.length; k++) if (w.service[k] === Service.TouristInfo) infoBoost = 1.1;
    // La notoriété grandit avec la ville : une bourgade attire peu, même avec de beaux équipements
    const fame = Math.min(1, (sim.stats.population + 800) / 12000);
    this.tourists = Math.round((sim.tourismAppeal * 2000 + attraction * 9000) * fame * infoBoost * (0.6 + 0.4 * (sim.budgets.culture / 100)));
    // Hôtels : chambres des zones touristiques
    let rooms = 0;
    for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Built && w.zones[k] === Zone.Tourism) rooms += sim.jobCapacity(k) * 4;
    this.hotelRooms = rooms;
    const nights = this.tourists * 2.5;
    this.occupancy = rooms ? Math.min(1, nights / (rooms * 30)) : 0;
    this.hotelFactor = rooms ? Math.max(0.3, Math.min(1.6, nights / (rooms * 18))) : 1;
    this.spending = this.tourists * 45;
    // Fréquentation de chaque équipement : habitants proches et touristes
    const stats: FacilityStat[] = [];
    let income = 0;
    const bud = sim.budgets.culture / 100;
    for (let k = 0; k < w.service.length; k++) {
      const svc = w.service[k] as Service;
      const info = SERVICE_INFO[svc as Exclude<Service, 0>];
      const l = info?.leisure;
      if (!l) continue;
      const r = (info.radius ?? 10) * 1.5, i0 = k % n, j0 = Math.floor(k / n);
      let locals = 0;
      for (let j = Math.max(0, Math.floor(j0 - r)); j <= Math.min(n - 1, j0 + r); j += 2) for (let i = Math.max(0, Math.floor(i0 - r)); i <= Math.min(n - 1, i0 + r); i += 2) locals += c.residents[j * n + i] * 4;
      const rate = l.kind === 'sport' ? 0.5 : l.kind === 'culture' ? 0.3 : 0.25;
      const demand = (locals * rate + (attraction ? (this.tourists * l.appeal) / attraction : 0) * 0.8) * this.seasonFactor(svc) * (0.7 + 0.3 * bud) * sim.utilities.conditionFactor(k);
      const visitors = Math.round(Math.min(l.capacity, demand));
      // Part des entrées qui revient à la ville (le reste couvre l'exploitation courante)
      const revenue = Math.round(visitors * l.ticket * CITY_SHARE);
      income += revenue;
      stats.push({ tile: k, service: svc, visitors, capacity: l.capacity, revenue });
    }
    this.facilities = stats.sort((a, b) => b.visitors - a.visitors);
    this.monthIncome += income;
    this.lastIncome = this.monthIncome; this.lastCost = this.monthCost;
    this.monthIncome = 0; this.monthCost = 0;
  }

  // ---------- Événements ----------

  /** Estimation avant programmation : visiteurs, sécurité, transports, recettes, nuisances (§15). */
  estimate(venue: number, kind: EventKind, capacity: number, day: number): EventEstimate {
    const sim = this.sim, w = sim.world, n = w.size, ei = EVENT_INFO[kind];
    const svc = w.service[venue] as Service;
    const appeal = SERVICE_INFO[svc as Exclude<Service, 0>]?.leisure?.appeal ?? 0.02;
    const month = Math.floor(day / 30) - sim.monthIndex;
    const season = this.season(month);
    const outdoor = ei.outdoor ? [1, 1.4, 0.8, 0.4][season] : 1;
    const demand = (sim.stats.population * 0.15 + this.tourists * ei.tourists + 3000 * appeal * 10) * ei.draw * outdoor;
    const visitors = Math.round(Math.min(capacity, demand));
    const tourists = Math.round(visitors * ei.tourists);
    // Sécurité : agents nécessaires et commissariats proches
    const security = Math.ceil(visitors / 1500);
    const i0 = venue % n, j0 = Math.floor(venue / n);
    let police = 0, parking = 0;
    for (let k = 0; k < w.service.length; k++) {
      const d = Math.abs((k % n) - i0) + Math.abs(Math.floor(k / n) - j0);
      if (w.service[k] === Service.Police && d <= 30) police += 4;
      if (w.service[k] === Service.Parking && d <= 8) parking += 400;
    }
    const securityAvailable = Math.round(police * (sim.budgets.police / 100));
    // Transports : lignes desservant le lieu
    let transitCap = 0;
    for (const line of sim.transit.lines) {
      if (line.broken) continue;
      if (line.stops.some((s) => Math.abs((s % n) - i0) + Math.abs(Math.floor(s / n) - j0) <= 8)) transitCap += line.vehicles * ({ bus: 60, tram: 160, metro: 600, train: 450, ferry: 180 }[line.kind]) * 6;
    }
    const transitShare = visitors ? Math.min(0.7, transitCap / visitors) : 0;
    const revenue = Math.round(visitors * ei.ticket * 0.25 + tourists * 12);
    const cost = Math.round(ei.cost * (0.5 + capacity / 20000) + security * 300);
    const warnings: string[] = [];
    if (securityAvailable < security) warnings.push(`Sécurité insuffisante : ${security} équipes nécessaires, ${securityAvailable} disponibles (commissariats à moins de 30 cases)`);
    if (transitShare < 0.25 && visitors > 3000) warnings.push('Peu de transports en commun : embouteillages à prévoir autour du lieu');
    if (visitors - visitors * transitShare > parking + 2000 && visitors > 5000) warnings.push('Stationnement saturé : ajoutez un parking ou une ligne');
    if (ei.outdoor && season === Season.Winter) warnings.push('Événement en plein air en hiver : affluence réduite');
    if (visitors < capacity * 0.5) warnings.push(`Affluence attendue : ${Math.round((visitors / Math.max(1, capacity)) * 100)} % de la capacité`);
    return { visitors, tourists, security, securityAvailable, transitShare, parking, revenue, cost, noise: ei.noise, warnings };
  }

  /** Programme un événement ; renvoie un message d'erreur ou null. */
  schedule(venue: number, kind: EventKind, capacity: number, inDays: number): string | null {
    const sim = this.sim, w = sim.world;
    const svc = w.service[venue] as Service;
    if (!venueEvents(svc).includes(kind)) return 'Ce lieu ne peut pas accueillir ce type d’événement';
    const day = sim.dayCount + Math.max(3, Math.round(inDays));
    const ei = EVENT_INFO[kind];
    const busy = this.events.some((e) => e.venue === venue && e.status !== 'cancelled' && e.status !== 'done' && day < e.day + EVENT_INFO[e.kind].days && e.day < day + ei.days);
    if (busy) return 'Le lieu est déjà réservé à ces dates';
    const est = this.estimate(venue, kind, capacity, day);
    this.events.push({ id: this.nextId++, venue, kind, day, capacity, status: 'planned', est });
    this.events.sort((a, b) => a.day - b.day);
    return null;
  }

  cancel(id: number): void {
    const e = this.events.find((x) => x.id === id && x.status === 'planned');
    if (e) { e.status = 'cancelled'; this.monthCost += Math.round(e.est.cost * 0.2); }
    this.events = this.events.filter((x) => x.status !== 'cancelled');
  }

  /** Événement en cours (pour le trafic et le bruit). */
  get active(): CityEvent | undefined {
    return this.events.find((e) => e.status === 'running');
  }

  daily(): void {
    const sim = this.sim, day = sim.dayCount, w = sim.world;
    for (const e of this.events) {
      if (!w.service[e.venue] || !venueEvents(w.service[e.venue] as Service).includes(e.kind)) { e.status = 'cancelled'; continue; }
      if (e.status === 'planned' && day >= e.day) {
        e.status = 'running';
        e.est = this.estimate(e.venue, e.kind, e.capacity, e.day);
        const name = SERVICE_INFO[w.service[e.venue] as Exclude<Service, 0>].name;
        sim.events.emit('notify', { text: `${EVENT_INFO[e.kind].name} au ${name.toLowerCase()} : environ ${e.est.visitors.toLocaleString('fr-FR')} visiteurs attendus`, kind: 'info', tile: e.venue });
      }
      if (e.status === 'running' && day >= e.day + EVENT_INFO[e.kind].days) this.finish(e);
    }
    this.events = this.events.filter((e) => e.status === 'planned' || e.status === 'running');
    // Afflux de voitures vers le lieu pendant l'événement
    const a = this.active;
    sim.traffic.attractor = a ? { tile: sim.traffic.roadAccess(a.venue), weight: Math.min(0.55, (a.est.visitors * (1 - a.est.transitShare)) / (sim.stats.population * 2 + 4000)) } : null;
  }

  private finish(e: CityEvent): void {
    const sim = this.sim, w = sim.world, n = w.size;
    e.status = 'done';
    const est = e.est;
    const notes: string[] = [];
    // Embouteillages autour du lieu pendant l'événement
    const i0 = e.venue % n, j0 = Math.floor(e.venue / n);
    let dens = 0, cnt = 0;
    for (let j = j0 - 5; j <= j0 + 5; j++) for (let i = i0 - 5; i <= i0 + 5; i++) if (w.inBounds(i, j) && w.tiles[j * n + i] === 1) { dens += sim.traffic.density[j * n + i]; cnt++; }
    const jam = cnt ? dens / cnt : 0;
    const deficit = Math.max(0, est.security - est.securityAvailable);
    const incidents = deficit ? Math.round(deficit * (0.5 + this.rand())) : this.rand() < 0.1 ? 1 : 0;
    let satisfaction = 0.85 - deficit * 0.05 - Math.max(0, jam - 1) * 0.08 - (est.transitShare < 0.2 && est.visitors > 3000 ? 0.1 : 0) + (this.rand() - 0.5) * 0.1;
    satisfaction = Math.max(0.1, Math.min(1, satisfaction));
    if (incidents) notes.push(`${incidents} incident(s) de sécurité`);
    if (jam > 1.5) notes.push('Embouteillages autour du lieu');
    if (est.transitShare >= 0.4) notes.push('Bonne desserte en transports en commun');
    const visitors = Math.round(est.visitors * (0.9 + this.rand() * 0.15));
    const revenue = Math.round(est.revenue * (visitors / Math.max(1, est.visitors)));
    e.result = { visitors, revenue, cost: est.cost, incidents, satisfaction, notes };
    this.monthIncome += revenue;
    this.monthCost += est.cost;
    // Effets : bonheur et attrait touristique temporaires
    const mi = sim.monthIndex;
    sim.council.modifiers.push({ key: 'happiness', value: Math.round((satisfaction - 0.5) * 0.06 * 1000) / 1000, until: mi + 1, source: `${EVENT_INFO[e.kind].name} (${Math.round(satisfaction * 100)} % de satisfaits)` });
    if (visitors > 5000) sim.council.modifiers.push({ key: 'tourism', value: 0.03, until: mi + 2, source: EVENT_INFO[e.kind].name });
    if (incidents) sim.crimeIndex = Math.min(1, sim.crimeIndex + incidents * 0.01);
    this.history.unshift(e);
    if (this.history.length > 40) this.history.pop();
    sim.events.emit('notify', { text: `${EVENT_INFO[e.kind].name} terminé : ${visitors.toLocaleString('fr-FR')} visiteurs, ${Math.round(satisfaction * 100)} % de satisfaits, bilan ${(revenue - est.cost).toLocaleString('fr-FR')} €`, kind: satisfaction > 0.5 ? 'info' : 'warn', tile: e.venue });
  }

  /** Bruit autour d'un événement en cours. */
  applyNoise(noise: Float32Array): void {
    const e = this.active;
    if (!e) return;
    const w = this.sim.world, n = w.size, i0 = e.venue % n, j0 = Math.floor(e.venue / n), r = 7;
    for (let j = Math.max(0, j0 - r); j <= Math.min(n - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(n - 1, i0 + r); i++) {
      const d = Math.hypot(i - i0, j - j0);
      if (d <= r) noise[j * n + i] = Math.min(1, noise[j * n + i] + e.est.noise * (1 - d / (r + 1)));
    }
  }

  serialize(): unknown {
    return { events: this.events, history: this.history, nextId: this.nextId, tourists: this.tourists, facilities: this.facilities };
  }

  restore(d: Record<string, any> | undefined): void {
    if (!d) return;
    this.events = d.events ?? [];
    this.history = d.history ?? [];
    this.nextId = d.nextId ?? 1;
    this.tourists = d.tourists ?? 0;
    this.facilities = d.facilities ?? [];
  }
}
