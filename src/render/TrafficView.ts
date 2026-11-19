import * as THREE from 'three';
import type { Traffic } from '../sim/Traffic';
import type { World } from '../sim/World';
import { Overlay } from './Overlay';
import { Vehicles } from './Vehicles';

const LEVELS: Array<[number, THREE.Color]> = [
  [0.35, new THREE.Color('#22c55e')],
  [1.0, new THREE.Color('#a3e635')],
  [1.8, new THREE.Color('#facc15')],
  [2.8, new THREE.Color('#f97316')],
  [Infinity, new THREE.Color('#ef4444')],
];

/** Véhicules + vue « trafic » qui colore les routes selon leur encombrement. */
export class TrafficView {
  readonly group = new THREE.Group();
  readonly vehicles: Vehicles;
  private overlay: Overlay;
  private lastRefresh = 0;
  enabled = false;
  onToggle?: (enabled: boolean) => void;

  constructor(private world: World, private traffic: Traffic) {
    this.vehicles = new Vehicles(world, traffic);
    this.overlay = new Overlay(world, { lift: 0.1, opacity: 0.6, pulse: false, inset: 0.02 });
    this.group.add(this.vehicles.group, this.overlay.group);
  }

  toggle(force?: boolean): void {
    this.enabled = force ?? !this.enabled;
    if (!this.enabled) this.overlay.clear();
    this.lastRefresh = 0;
    this.onToggle?.(this.enabled);
  }

  /** Libellé d'encombrement pour une densité donnée. */
  static label(density: number): string {
    if (density < 0.35) return 'Fluide';
    if (density < 1.0) return 'Normal';
    if (density < 1.8) return 'Chargé';
    if (density < 2.8) return 'Dense';
    return 'Embouteillé';
  }

  update(time: number): void {
    this.vehicles.update();
    if (!this.enabled || time - this.lastRefresh < 0.4) return;
    this.lastRefresh = time;
    const layers: number[][] = LEVELS.map(() => []);
    const w = this.world;
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] !== 1) continue;
      const d = this.traffic.density[k];
      layers[LEVELS.findIndex(([max]) => d < max)].push(k);
    }
    this.overlay.set(layers.map((tiles, i) => [tiles, LEVELS[i][1]] as [number[], THREE.Color]));
  }
}
