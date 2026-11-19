import { rng } from '../core/noise';
import { VehicleKind, type Traffic } from './Traffic';
import type { World } from './World';
import { Service } from './services';
import { RoadFlag } from './roads';

export type TransitKind = 'bus' | 'tram' | 'metro' | 'train' | 'ferry';
export type LineStatus = 'ok' | 'overloaded' | 'underused' | 'deficit' | 'broken';

export interface TransitLine {
  id: number;
  kind: TransitKind;
  name: string;
  color: string;
  /** Arrêts (cases de route) ou stations (cases d'équipement), dans l'ordre. */
  stops: number[];
  /** Itinéraire en boucle (cases parcourues). */
  path: number[];
  /** Véhicules souhaités par le joueur (0 = nombre conseillé). */
  target: number;
  /** Véhicules en service. */
  vehicles: number;
  /** Compatibilité : bus en service. */
  buses: number;
  passengers: number;
  lastMonth: number;
  broken: boolean;
  /** Raison de l'interruption. */
  reason: string;
  /** Lignes en correspondance. */
  connections: number[];
  /** Train relié au réseau national (bord de la carte). */
  regional: boolean;
  revenue: number;
}

export interface LineInfo {
  lengthKm: number;
  roundTripMin: number;
  recommended: number;
  vehicles: number;
  headwayMin: number;
  capacity: number;
  cost: number;
  revenue: number;
  load: number;
  status: LineStatus;
  connections: string[];
}

/** Chaque trajet simulé représente plusieurs voyageurs. */
export const PASSENGER_SCALE = 10;

export const KIND_NAMES: Record<TransitKind, string> = { bus: 'Bus', tram: 'Tramway', metro: 'Métro', train: 'Train', ferry: 'Ferry' };
/** Capacité d'un véhicule, distance entre véhicules conseillée (cases), vitesse (m/min), coût mensuel par véhicule, prix du billet. */
const CAP: Record<TransitKind, number> = { bus: 60, tram: 160, metro: 600, train: 450, ferry: 180 };
const SPACING: Record<TransitKind, number> = { bus: 22, tram: 26, metro: 14, train: 45, ferry: 30 };
const SPEED: Record<TransitKind, number> = { bus: 300, tram: 330, metro: 650, train: 1000, ferry: 380 };
export const VEHICLE_COST: Record<TransitKind, number> = { bus: 60, tram: 180, metro: 220, train: 320, ferry: 200 };
const LINE_COST: Record<TransitKind, number> = { bus: 0, tram: 150, metro: 400, train: 300, ferry: 80 };
export const TICKET: Record<TransitKind, number> = { bus: 1.5, tram: 1.7, metro: 2, train: 3, ferry: 2.5 };
const BASE: Record<TransitKind, number> = { bus: 0.5, tram: 0.65, metro: 0.8, train: 0.85, ferry: 0.7 };
const RANGE: Record<TransitKind, number> = { bus: 6, tram: 7, metro: 9, train: 11, ferry: 8 };
const TILE_M = 16;

const LINE_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

/**
 * Transports collectifs (§12) : lignes de bus, tram, métro, train et ferry, avec capacité,
 * fréquence, coûts et recettes, correspondances et trajets avec changement ; vélo et taxi.
 */
export class Transit {
  lines: TransitLine[] = [];
  private nextId = 1;
  private rand = rng(777);
  /** Facteur de budget des transports (0.5 à 1.5). */
  budget = 1;
  /** Dépôts disponibles (fourni par la simulation). */
  hasDepot: (kind: TransitKind, line: TransitLine) => boolean = () => true;
  /** Météo courante (le ferry s'arrête par tempête, le vélo baisse sous la pluie). */
  weather: () => string = () => 'sun';
  /** Flotte de taxis et population (pour la part de trajets en taxi). */
  taxiFleet = 0;
  population = 0;
  /** Accès aux pistes cyclables : 0 aucun, 1 piste proche, 2 piste et vélos partagés. */
  bikeAccess: Uint8Array;
  private parkRide: Uint8Array;
  /** Trajets du mois par mode, à vélo et en taxi. */
  month = { bike: 0, taxi: 0, transfers: 0 };
  lastMonthStats = { bike: 0, taxi: 0, transfers: 0, byKind: {} as Record<string, number> };
  /** Horloges d'animation des trains et ferries (secondes simulées ; les ferries s'arrêtent par tempête). */
  clock = 0;
  ferryClock = 0;

  advance(dt: number): void {
    this.clock += dt;
    if (this.weather() !== 'storm') this.ferryClock += dt;
  }

  constructor(private world: World, private traffic: Traffic) {
    traffic.transitHook = (a, b) => this.tryRide(a, b);
    this.bikeAccess = new Uint8Array(world.size * world.size);
    this.parkRide = new Uint8Array(world.size * world.size);
  }

  private nameFor(kind: TransitKind): string {
    const n = this.lines.filter((l) => l.kind === kind).length + 1;
    return kind === 'metro' ? `Métro ${String.fromCharCode(64 + n)}` : `${KIND_NAMES[kind]} ${n}`;
  }

  addLine(kind: TransitKind, stops: number[]): TransitLine | null {
    if (stops.length < 2) return null;
    const used = new Set(this.lines.map((l) => l.color));
    const color = LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[this.nextId % LINE_COLORS.length];
    const line: TransitLine = {
      id: this.nextId++, kind, name: this.nameFor(kind), color, stops: [...stops], path: [], target: 0, vehicles: 0, buses: 0,
      passengers: 0, lastMonth: 0, broken: false, reason: '', connections: [], regional: false, revenue: 0,
    };
    this.lines.push(line);
    this.refreshLine(line);
    this.computeConnections();
    return line;
  }

  removeLine(id: number): void {
    this.traffic.removeLineVehicles(id);
    this.lines = this.lines.filter((l) => l.id !== id);
    this.computeConnections();
  }

  setVehicles(id: number, n: number): void {
    const l = this.lines.find((x) => x.id === id);
    if (!l) return;
    l.target = Math.max(0, Math.min(40, Math.round(n)));
    this.refreshLine(l);
  }

  // ---------- Arrêts et itinéraires ----------

  /** L'arrêt est-il valide pour ce mode ? */
  isStop(kind: TransitKind, s: number): boolean {
    const w = this.world;
    if (kind === 'bus') return w.busStop[s] === 1 && w.tiles[s] === 1;
    if (kind === 'tram') return w.busStop[s] === 2 && w.tiles[s] === 1 && (w.roadFlags[s] & RoadFlag.Tram) !== 0;
    if (kind === 'metro') return w.service[s] === Service.MetroStation;
    if (kind === 'train') return w.service[s] === Service.TrainStation;
    return w.service[s] === Service.FerryPier;
  }

  /** Case du réseau propre au mode, à côté d'une station (voie ferrée, eau). */
  private access(kind: TransitKind, s: number): number {
    const w = this.world, n = w.size, i = s % n, j = Math.floor(s / n);
    if (kind === 'bus' || kind === 'tram' || kind === 'metro') return s;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const a = i + dx, b = j + dz;
      if (!w.inBounds(a, b)) continue;
      const k = b * n + a;
      if (kind === 'train' ? w.rail[k] : w.isWater(a, b)) return k;
    }
    return -1;
  }

  /** Parcours en largeur sur le réseau du mode (tram, rail, eau). */
  private bfs(kind: TransitKind, from: number, to: number): number[] | null {
    const w = this.world, n = w.size;
    if (from === to) return [from];
    const came = new Map<number, number>([[from, -1]]);
    const queue = [from];
    for (let qi = 0; qi < queue.length && queue.length < 40000; qi++) {
      const cur = queue[qi];
      let next: number[];
      if (kind === 'tram') next = w.neighbors(cur).filter((q) => (w.roadFlags[q] & RoadFlag.Tram) !== 0);
      else if (kind === 'train') next = w.railNeighbors(cur);
      else {
        const i = cur % n, j = (cur - i) / n;
        next = [];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const a = i + dx, b = j + dz;
          if (w.inBounds(a, b) && (w.isWater(a, b) || b * n + a === to)) next.push(b * n + a);
        }
      }
      for (const q of next) {
        if (came.has(q)) continue;
        came.set(q, cur);
        if (q === to) {
          const path: number[] = [];
          for (let k = to; k !== -1; k = came.get(k)!) path.push(k);
          return path.reverse();
        }
        queue.push(q);
      }
    }
    return null;
  }

  /** Itinéraire en boucle passant par tous les arrêts (ou ouvert, pour l'aperçu). */
  routeFor(stops: number[], closed = true, kind: TransitKind = 'bus'): number[] | null {
    const path: number[] = [];
    const n = stops.length;
    const legs = closed ? n : n - 1;
    const nodes = stops.map((s) => this.access(kind, s));
    if (nodes.some((x) => x < 0)) return null;
    for (let k = 0; k < legs; k++) {
      const a = nodes[k], b = nodes[(k + 1) % n];
      if (a === b) continue;
      if (kind === 'metro') { path.push(a); continue; }
      const leg = kind === 'bus' ? this.traffic.findPath(a, b, true) : this.bfs(kind, a, b);
      if (!leg) return null;
      path.push(...leg.slice(0, -1));
    }
    if (!closed) path.push(nodes[n - 1]);
    return path;
  }

  /** Longueur réelle d'un itinéraire (cases, en tenant compte des diagonales). */
  pathLength(line: TransitLine): number {
    const p = line.path, n = this.world.size;
    let len = 0;
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      len += Math.hypot((a % n) - (b % n), Math.floor(a / n) - Math.floor(b / n));
    }
    return len;
  }

  refreshLine(line: TransitLine): void {
    line.stops = line.stops.filter((s) => this.isStop(line.kind, s));
    this.traffic.removeLineVehicles(line.id);
    line.vehicles = 0; line.buses = 0;
    if (line.stops.length < 2) { line.broken = true; line.reason = 'Moins de deux arrêts valides'; line.path = []; return; }
    const path = this.routeFor(line.stops, true, line.kind);
    line.broken = !path || path.length < 2;
    line.path = path ?? [];
    if (line.broken) { line.reason = line.kind === 'train' ? 'Gares non reliées par la voie ferrée' : line.kind === 'ferry' ? 'Embarcadères non reliés par l’eau' : line.kind === 'tram' ? 'Arrêts non reliés par une voie de tram' : 'Arrêts non reliés par la route'; return; }
    const depot = this.hasDepot(line.kind, line);
    if (!depot && line.kind === 'tram') { line.broken = true; line.reason = 'Aucun dépôt de tramway relié'; return; }
    line.reason = depot ? '' : line.kind === 'bus' ? 'Sans dépôt de bus : un seul bus' : line.kind === 'metro' ? 'Sans dépôt : capacité réduite de moitié' : '';
    const rec = this.recommended(line);
    let v = line.target > 0 ? line.target : Math.max(1, Math.round(rec * this.budget));
    if (!depot && line.kind === 'bus') v = 1;
    line.vehicles = v;
    line.regional = line.kind === 'train' && line.stops.some((s) => this.reachesEdge(s));
    if (line.kind === 'bus' || line.kind === 'tram') {
      line.buses = line.kind === 'bus' ? v : 0;
      const stops = new Set(line.stops);
      for (let k = 0; k < v; k++) {
        this.traffic.addLoopVehicle(line.id, line.path, Math.floor((k * line.path.length) / v), stops, line.color, line.kind === 'tram' ? VehicleKind.Tram : VehicleKind.Bus);
      }
    }
  }

  private reachesEdge(station: number): boolean {
    const w = this.world, n = w.size, start = this.access('train', station);
    if (start < 0) return false;
    const seen = new Set([start]);
    const q = [start];
    for (let qi = 0; qi < q.length && qi < 20000; qi++) {
      const c = q[qi];
      if (w.edgeDistance(c % n, Math.floor(c / n)) === 0) return true;
      for (const x of w.railNeighbors(c)) if (!seen.has(x)) { seen.add(x); q.push(x); }
    }
    return false;
  }

  recommended(line: TransitLine): number {
    if (line.kind === 'metro') return Math.max(2, Math.ceil(this.pathLength(line) / SPACING.metro));
    return Math.max(1, Math.ceil(this.pathLength(line) / SPACING[line.kind]));
  }

  /** Recalcule toutes les lignes (après un changement de routes, d'arrêts ou de budget). */
  refreshAll(): void {
    for (const l of this.lines) this.refreshLine(l);
    this.lines = this.lines.filter((l) => l.stops.length >= 2);
    this.computeConnections();
    this.computeAccess();
  }

  private computeConnections(): void {
    const n = this.world.size;
    const near = (a: number, b: number) => Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 3;
    for (const l of this.lines) l.connections = [];
    for (let i = 0; i < this.lines.length; i++) for (let j = i + 1; j < this.lines.length; j++) {
      const A = this.lines[i], B = this.lines[j];
      if (A.stops.some((a) => B.stops.some((b) => near(a, b)))) { A.connections.push(B.id); B.connections.push(A.id); }
    }
  }

  /** Accès aux pistes cyclables et parkings relais. */
  computeAccess(): void {
    const w = this.world, n = w.size;
    this.bikeAccess.fill(0);
    this.parkRide.fill(0);
    const mark = (arr: Uint8Array, k: number, r: number, v: number) => {
      const i0 = k % n, j0 = Math.floor(k / n);
      for (let j = Math.max(0, j0 - r); j <= Math.min(n - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(n - 1, i0 + r); i++) arr[j * n + i] = Math.max(arr[j * n + i], v);
    };
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] === 1 && w.roadFlags[k] & RoadFlag.Bike) mark(this.bikeAccess, k, 3, 1);
      if (w.service[k] === Service.Parking) mark(this.parkRide, k, 4, 1);
    }
    for (let k = 0; k < w.tiles.length; k++) if (w.service[k] === Service.BikeStation) {
      const i0 = k % n, j0 = Math.floor(k / n);
      for (let j = Math.max(0, j0 - 8); j <= Math.min(n - 1, j0 + 8); j++) for (let i = Math.max(0, i0 - 8); i <= Math.min(n - 1, i0 + 8); i++) {
        const q = j * n + i;
        this.bikeAccess[q] = this.bikeAccess[q] ? 2 : 1;
      }
    }
  }

  // ---------- Exploitation ----------

  info(line: TransitLine): LineInfo {
    const len = this.pathLength(line);
    const roundTripMin = (len * TILE_M) / SPEED[line.kind] + line.stops.length * 0.5;
    const v = line.vehicles;
    const depotFactor = line.kind === 'metro' && line.reason ? 0.5 : 1;
    // Voyageurs transportables par mois, à l'échelle des trajets simulés
    const capacity = Math.round((v * CAP[line.kind] * Math.min(120, 600 / Math.max(10, len)) * depotFactor) / PASSENGER_SCALE);
    const cost = v * VEHICLE_COST[line.kind] * this.budget + LINE_COST[line.kind];
    const revenue = line.lastMonth * TICKET[line.kind];
    const load = capacity ? line.lastMonth / capacity : 0;
    const status: LineStatus = line.broken ? 'broken' : load >= 0.95 ? 'overloaded' : capacity && load < 0.15 && line.lastMonth >= 0 ? 'underused' : revenue < cost ? 'deficit' : 'ok';
    return {
      lengthKm: (len * TILE_M) / 1000, roundTripMin, recommended: this.recommended(line), vehicles: v, headwayMin: v ? roundTripMin / v : 0,
      capacity, cost, revenue, load, status, connections: line.connections.map((id) => this.lines.find((l) => l.id === id)?.name ?? ''),
    };
  }

  /** Aperçu d'une ligne en cours de tracé (longueur, temps, véhicules, coût, correspondances). */
  preview(kind: TransitKind, stops: number[]): { ok: boolean; lengthKm: number; roundTripMin: number; recommended: number; cost: number; connections: string[] } {
    const path = stops.length >= 2 ? this.routeFor(stops, true, kind) : null;
    if (!path) return { ok: false, lengthKm: 0, roundTripMin: 0, recommended: 0, cost: 0, connections: [] };
    const tmp = { kind, path, stops, connections: [] } as unknown as TransitLine;
    const len = this.pathLength(tmp), rec = this.recommended(tmp);
    const n = this.world.size;
    const near = (a: number, b: number) => Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 3;
    return {
      ok: true, lengthKm: (len * TILE_M) / 1000, roundTripMin: (len * TILE_M) / SPEED[kind] + stops.length * 0.5, recommended: rec,
      cost: rec * VEHICLE_COST[kind] + LINE_COST[kind], connections: this.lines.filter((l) => l.stops.some((a) => stops.some((b) => near(a, b)))).map((l) => l.name),
    };
  }

  private nearest(line: TransitLine, tile: number): number {
    const n = this.world.size, range = RANGE[line.kind];
    const ti = tile % n, tj = (tile - ti) / n;
    let best = -1, bd = range + 1;
    for (const s of line.stops) {
      const si = s % n, sj = (s - si) / n;
      const d = Math.abs(si - ti) + Math.abs(sj - tj);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private usable(line: TransitLine): boolean {
    if (line.broken || !line.vehicles) return false;
    if (line.kind === 'ferry' && this.weather() === 'storm') return false;
    return true;
  }

  private chance(line: TransitLine, from: number): number {
    const rec = Math.max(1, this.recommended(line));
    const freq = Math.min(1.2, 0.5 + (line.vehicles / rec) * 0.5);
    const cap = this.info(line).capacity;
    if (line.passengers >= cap) return 0; // ligne saturée
    return BASE[line.kind] * freq * (0.6 + 0.4 * this.budget) + (this.parkRide[from] ? 0.15 : 0);
  }

  /** Mode choisi pour un trajet entre deux cases de route : transport collectif, vélo, taxi ou voiture. */
  private tryRide(a: number, b: number): 'transit' | 'bike' | 'taxi' | null {
    const w = this.world, n = w.size;
    const dist = Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
    const nearA: TransitLine[] = [], nearB: TransitLine[] = [];
    for (const line of this.lines) {
      if (!this.usable(line)) continue;
      const sa = this.nearest(line, a), sb = this.nearest(line, b);
      if (sa >= 0) nearA.push(line);
      if (sb >= 0) nearB.push(line);
      if (sa >= 0 && sb >= 0 && sa !== sb && this.rand() < this.chance(line, a)) {
        line.passengers += PASSENGER_SCALE;
        return 'transit';
      }
    }
    // Trajet avec une correspondance
    for (const A of nearA) for (const B of nearB) {
      if (A === B || !A.connections.includes(B.id)) continue;
      if (this.rand() < Math.min(this.chance(A, a), this.chance(B, a)) * 0.6) {
        A.passengers += PASSENGER_SCALE; B.passengers += PASSENGER_SCALE;
        this.month.transfers += PASSENGER_SCALE;
        return 'transit';
      }
    }
    // Vélo : trajets courts, pistes cyclables aux deux bouts, pas sous la pluie
    const wx = this.weather();
    if (dist <= 32 && this.bikeAccess[a] && this.bikeAccess[b] && !['rain', 'storm', 'snow', 'frost'].includes(wx)) {
      const p = 0.2 + (this.bikeAccess[a] === 2 || this.bikeAccess[b] === 2 ? 0.15 : 0);
      if (this.rand() < p) { this.month.bike += PASSENGER_SCALE; return 'bike'; }
    }
    if (this.taxiFleet && this.rand() < Math.min(0.08, this.taxiFleet / (this.population * 0.02 + 20))) {
      this.month.taxi += PASSENGER_SCALE;
      return 'taxi';
    }
    return null;
  }

  onNewMonth(): number {
    let total = 0;
    const byKind: Record<string, number> = {};
    for (const l of this.lines) {
      l.lastMonth = l.passengers;
      l.revenue = l.passengers * TICKET[l.kind];
      total += l.passengers;
      byKind[l.kind] = (byKind[l.kind] ?? 0) + l.passengers;
      l.passengers = 0;
    }
    this.lastMonthStats = { ...this.month, byKind };
    this.month = { bike: 0, taxi: 0, transfers: 0 };
    return total;
  }

  /** Recettes des billets du mois écoulé. */
  get ticketRevenue(): number {
    return this.lines.reduce((a, l) => a + l.revenue, 0);
  }

  /** Coût mensuel d'exploitation de toutes les lignes. */
  get operatingCost(): number {
    return this.lines.reduce((a, l) => a + (l.broken ? 0 : l.vehicles * VEHICLE_COST[l.kind] * this.budget + LINE_COST[l.kind]), 0);
  }

  get busCount(): number {
    return this.lines.reduce((s, l) => s + (l.kind === 'bus' ? l.vehicles : 0), 0);
  }

  get metroLines(): number {
    return this.lines.filter((l) => l.kind === 'metro' && !l.broken).length;
  }

  /** Gares reliées au réseau national. */
  get regionalStations(): number {
    const set = new Set<number>();
    for (const l of this.lines) if (l.regional) for (const s of l.stops) set.add(s);
    return set.size;
  }
}
