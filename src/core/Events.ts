type Handler<T> = (payload: T) => void;

/** Bus d'événements typé, pour découpler la simulation, le rendu et l'interface. */
export class Emitter<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<Handler<any>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.handlers.get(type)?.forEach((fn) => fn(payload));
  }
}

export interface GameEvents extends Record<string, unknown> {
  roadsChanged: { tiles: number[] };
  treesChanged: void;
  zonesChanged: void;
  servicesChanged: void;
  firesChanged: void;
  transitChanged: void;
  weatherChanged: void;
  terrainChanged: void;
  disaster: { id: number; phase: 'warning' | 'start' | 'end' };
  damageChanged: void;
  floodChanged: void;
  shake: { strength: number };
  milestone: { index: number };
  buildingsChanged: { tiles: number[] };
  buildingsEvolved: { tiles: number[] };
  statsChanged: import('../sim/Simulation').CityStats;
  moneyChanged: number;
  dateChanged: { day: number; month: number; year: number };
  speedChanged: number;
  notify: { text: string; kind?: 'info' | 'warn' | 'error'; tile?: number };
}
