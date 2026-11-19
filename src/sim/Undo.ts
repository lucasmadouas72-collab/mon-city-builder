import type { Simulation } from './Simulation';
import { BuildState, Zone } from './zones';

/** Annuler / rétablir les actions du joueur (routes, zones, équipements, terrain, lignes). */

interface Snapshot {
  tiles: Uint8Array;
  zones: Uint8Array;
  service: Uint8Array;
  busStop: Uint8Array;
  trees: Uint8Array;
  heights: Float32Array;
  roadType: Uint8Array;
  oneway: Uint8Array;
  lights: Uint8Array;
  links: Uint8Array;
  lines: Array<{ kind: 'bus' | 'metro'; stops: number[]; color: string; name: string }>;
  /** Argent dépensé par l'action (remboursé à l'annulation). */
  cost: number;
}

const LIMIT = 30;

export class UndoStack {
  private undo: Snapshot[] = [];
  private redo: Snapshot[] = [];
  onChange?: () => void;

  constructor(private sim: Simulation) {}

  get canUndo(): boolean { return this.undo.length > 0; }
  get canRedo(): boolean { return this.redo.length > 0; }

  private capture(cost = 0): Snapshot {
    const w = this.sim.world;
    return {
      tiles: w.tiles.slice(), zones: w.zones.slice(), service: w.service.slice(), busStop: w.busStop.slice(),
      trees: w.trees.slice(), heights: w.heights.slice(),
      roadType: w.roadType.slice(), oneway: w.oneway.slice(), lights: w.lights.slice(), links: w.links.slice(),
      lines: this.sim.transit.lines.map((l) => ({ kind: l.kind, stops: [...l.stops], color: l.color, name: l.name })),
      cost,
    };
  }

  private differs(a: Snapshot): boolean {
    const w = this.sim.world;
    const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    return !eq(a.tiles, w.tiles) || !eq(a.zones, w.zones) || !eq(a.service, w.service) || !eq(a.busStop, w.busStop)
      || !eq(a.trees, w.trees) || !eq(a.heights, w.heights) || !eq(a.roadType, w.roadType) || !eq(a.oneway, w.oneway) || !eq(a.lights, w.lights) || !eq(a.links, w.links) || a.lines.length !== this.sim.transit.lines.length;
  }

  /** Exécute une action du joueur en mémorisant l'état précédent. */
  record<T>(action: () => T): T {
    const before = this.capture();
    const money = this.sim.money;
    const result = action();
    if (this.differs(before)) {
      before.cost = Number.isFinite(money) ? money - this.sim.money : 0;
      this.undo.push(before);
      if (this.undo.length > LIMIT) this.undo.shift();
      this.redo = [];
      this.onChange?.();
    }
    return result;
  }

  /** Démarre une action longue (glisser avec un outil de terrain). */
  begin(): () => void {
    const before = this.capture();
    const money = this.sim.money;
    return () => {
      if (!this.differs(before)) return;
      before.cost = Number.isFinite(money) ? money - this.sim.money : 0;
      this.undo.push(before);
      if (this.undo.length > LIMIT) this.undo.shift();
      this.redo = [];
      this.onChange?.();
    };
  }

  undoLast(): void {
    const snap = this.undo.pop();
    if (!snap) return;
    const current = this.capture(snap.cost);
    this.restore(snap, snap.cost);
    this.redo.push(current);
    this.onChange?.();
  }

  redoLast(): void {
    const snap = this.redo.pop();
    if (!snap) return;
    const current = this.capture(snap.cost);
    this.restore(snap, -snap.cost);
    this.undo.push(current);
    this.onChange?.();
  }

  private restore(s: Snapshot, refund: number): void {
    const sim = this.sim, w = sim.world;
    const terrain = s.heights.some((h, i) => h !== w.heights[i]);
    w.tiles.set(s.tiles); w.zones.set(s.zones); w.service.set(s.service); w.busStop.set(s.busStop); w.trees.set(s.trees); w.heights.set(s.heights);
    w.roadType.set(s.roadType); w.oneway.set(s.oneway); w.lights.set(s.lights); w.links.set(s.links);
    // Les bâtiments incompatibles avec l'état restauré disparaissent
    for (let k = 0; k < w.bState.length; k++) {
      if (w.bState[k] !== BuildState.Empty && (w.zones[k] === Zone.None || w.tiles[k] === 1 || w.service[k])) {
        w.bState[k] = BuildState.Empty; w.bLevel[k] = 0; w.bTimer[k] = 0;
      }
    }
    if (Number.isFinite(sim.money)) sim.money += refund;
    for (const l of [...sim.transit.lines]) sim.transit.removeLine(l.id);
    sim.afterLoad();
    for (const l of s.lines) {
      const line = sim.transit.addLine(l.kind, l.stops);
      if (line) { line.color = l.color; line.name = l.name; sim.transit.refreshLine(line); }
    }
    sim.traffic.validate();
    sim.recomputeStats();
    const ev = sim.events;
    if (terrain) ev.emit('terrainChanged', undefined);
    ev.emit('roadsChanged', { tiles: [] });
    ev.emit('zonesChanged', undefined);
    ev.emit('servicesChanged', undefined);
    ev.emit('treesChanged', undefined);
    ev.emit('buildingsChanged', { tiles: [] });
    ev.emit('transitChanged', undefined);
    ev.emit('moneyChanged', sim.money);
  }
}
