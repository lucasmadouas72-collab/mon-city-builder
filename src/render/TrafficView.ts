import * as THREE from 'three';
import type { Traffic } from '../sim/Traffic';
import type { World } from '../sim/World';
import { Vehicles } from './Vehicles';

/** Véhicules en circulation. */
export class TrafficView {
  readonly group = new THREE.Group();
  readonly vehicles: Vehicles;

  constructor(world: World, traffic: Traffic) {
    this.vehicles = new Vehicles(world, traffic);
    this.group.add(this.vehicles.group);
  }

  /** Libellé d'encombrement pour une densité donnée. */
  static label(density: number): string {
    if (density < 0.35) return 'Fluide';
    if (density < 1.0) return 'Normal';
    if (density < 1.8) return 'Chargé';
    if (density < 2.8) return 'Dense';
    return 'Embouteillé';
  }

  update(): void {
    this.vehicles.update();
  }
}
