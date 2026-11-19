import { rng } from '../core/noise';
import type { Traffic } from './Traffic';
import type { World } from './World';
import { Service } from './services';

export type TransitKind = 'bus' | 'metro';

export interface TransitLine {
  id: number;
  kind: TransitKind;
  name: string;
  color: string;
  /** Arrêts (cases de route) ou stations (cases d'équipement), dans l'ordre. */
  stops: number[];
  /** Itinéraire en boucle (bus uniquement). */
  path: number[];
  buses: number;
  passengers: number;
  lastMonth: number;
  broken: boolean;
}

/** Chaque trajet simulé représente plusieurs voyageurs. */
export const PASSENGER_SCALE = 10;

const LINE_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#6366f1'];
const BUS_RANGE = 6;
const METRO_RANGE = 9;

/**
 * Transports en commun. Les habitants dont le départ et l'arrivée sont proches
 * d'arrêts d'une même ligne la prennent souvent au lieu de la voiture.
 */
export class Transit {
  lines: TransitLine[] = [];
  private nextId = 1;
  private rand = rng(777);
  /** Facteur de budget des transports (0.5 à 1.5). */
  budget = 1;

  constructor(private world: World, private traffic: Traffic) {
    traffic.transitHook = (a, b) => this.tryRide(a, b);
  }

  private nameFor(kind: TransitKind): string {
    const n = this.lines.filter((l) => l.kind === kind).length + 1;
    return kind === 'bus' ? `Bus ${n}` : `Métro ${String.fromCharCode(64 + n)}`;
  }

  addLine(kind: TransitKind, stops: number[]): TransitLine | null {
    if (stops.length < 2) return null;
    const used = new Set(this.lines.map((l) => l.color));
    const color = LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[this.nextId % LINE_COLORS.length];
    const line: TransitLine = {
      id: this.nextId++, kind, name: this.nameFor(kind), color, stops: [...stops],
      path: [], buses: 0, passengers: 0, lastMonth: 0, broken: false,
    };
    this.lines.push(line);
    this.refreshLine(line);
    return line;
  }

  removeLine(id: number): void {
    this.traffic.removeLineVehicles(id);
    this.lines = this.lines.filter((l) => l.id !== id);
  }

  /** Itinéraire en boucle d'une ligne de bus passant par tous les arrêts. */
  routeFor(stops: number[], closed = true): number[] | null {
    const path: number[] = [];
    const n = stops.length;
    const legs = closed ? n : n - 1;
    for (let k = 0; k < legs; k++) {
      const a = stops[k], b = stops[(k + 1) % n];
      if (a === b) continue;
      const leg = this.traffic.findPath(a, b, true);
      if (!leg) return null;
      path.push(...leg.slice(0, -1));
    }
    if (!closed) path.push(stops[n - 1]);
    return path;
  }

  refreshLine(line: TransitLine): void {
    const w = this.world;
    line.stops = line.stops.filter((s) => (line.kind === 'bus' ? w.busStop[s] === 1 && w.tiles[s] === 1 : w.service[s] === Service.MetroStation));
    this.traffic.removeLineVehicles(line.id);
    if (line.stops.length < 2) { line.broken = true; line.path = []; line.buses = 0; return; }
    if (line.kind === 'metro') { line.broken = false; return; }
    const path = this.routeFor(line.stops);
    line.broken = !path || path.length < 2;
    line.path = path ?? [];
    if (line.broken) { line.buses = 0; return; }
    line.buses = Math.max(1, Math.round((Math.max(2, Math.ceil(line.path.length / 22))) * this.budget));
    const stops = new Set(line.stops);
    for (let k = 0; k < line.buses; k++) {
      this.traffic.addLoopVehicle(line.id, line.path, Math.floor((k * line.path.length) / line.buses), stops, line.color);
    }
  }

  /** Recalcule toutes les lignes (après un changement de routes, d'arrêts ou de budget). */
  refreshAll(): void {
    for (const l of this.lines) this.refreshLine(l);
    this.lines = this.lines.filter((l) => l.stops.length >= 2);
  }

  private nearest(line: TransitLine, tile: number, range: number): number {
    const n = this.world.size;
    const ti = tile % n, tj = (tile - ti) / n;
    let best = -1, bd = range + 1;
    for (const s of line.stops) {
      const si = s % n, sj = (s - si) / n;
      const d = Math.abs(si - ti) + Math.abs(sj - tj);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Un trajet entre deux cases de route peut-il se faire en transport en commun ? */
  private tryRide(a: number, b: number): boolean {
    for (const line of this.lines) {
      if (line.broken) continue;
      const range = line.kind === 'bus' ? BUS_RANGE : METRO_RANGE;
      const sa = this.nearest(line, a, range);
      if (sa < 0) continue;
      const sb = this.nearest(line, b, range);
      if (sb < 0 || sb === sa) continue;
      const p = (line.kind === 'bus' ? 0.55 : 0.8) * (0.6 + 0.4 * this.budget);
      if (this.rand() < p) {
        line.passengers += PASSENGER_SCALE;
        return true;
      }
    }
    return false;
  }

  onNewMonth(): number {
    let total = 0;
    for (const l of this.lines) {
      l.lastMonth = l.passengers;
      total += l.passengers;
      l.passengers = 0;
    }
    return total;
  }

  get busCount(): number {
    return this.lines.reduce((s, l) => s + (l.kind === 'bus' ? l.buses : 0), 0);
  }

  get metroLines(): number {
    return this.lines.filter((l) => l.kind === 'metro' && !l.broken).length;
  }
}
