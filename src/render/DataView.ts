import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';
import { BuildState } from '../sim/zones';
import { Coverage, SERVICE_INFO, Service, Utility } from '../sim/services';
import { Overlay } from './Overlay';

export type ViewMode =
  | 'none' | 'traffic' | 'power' | 'water' | 'sewage' | 'garbage'
  | 'health' | 'education' | 'police' | 'fire' | 'park' | 'happiness' | 'land';

export const VIEW_LABELS: Array<[ViewMode, string]> = [
  ['traffic', 'Trafic'],
  ['power', 'Électricité'],
  ['water', 'Eau'],
  ['sewage', 'Égouts'],
  ['garbage', 'Déchets'],
  ['health', 'Santé'],
  ['education', 'Éducation'],
  ['police', 'Police'],
  ['fire', 'Pompiers'],
  ['park', 'Parcs'],
  ['happiness', 'Bonheur'],
  ['land', 'Valeur foncière'],
];

const UTIL: Partial<Record<ViewMode, [Utility, Service[]]>> = {
  power: [Utility.Power, [Service.PowerPlant, Service.WindTurbine]],
  water: [Utility.Water, [Service.WaterPump]],
  sewage: [Utility.Sewage, [Service.Sewage]],
  garbage: [Utility.Garbage, [Service.Landfill]],
};
const COV: Partial<Record<ViewMode, [Coverage, Service]>> = {
  health: [Coverage.Health, Service.Clinic],
  education: [Coverage.Education, Service.School],
  police: [Coverage.Police, Service.Police],
  fire: [Coverage.Fire, Service.FireStation],
  park: [Coverage.Park, Service.Park],
};

const TRAFFIC_LEVELS: Array<[number, string]> = [[0.35, '#22c55e'], [1.0, '#a3e635'], [1.8, '#facc15'], [2.8, '#f97316'], [Infinity, '#ef4444']];
const RAMP = ['#ef4444', '#f97316', '#facc15', '#a3e635', '#22c55e'];

/** Vues de données : colore les cases selon le trafic, les réseaux, la couverture, le bonheur… */
export class DataView {
  readonly overlay: Overlay;
  mode: ViewMode = 'none';
  onChange?: (mode: ViewMode) => void;
  private last = 0;
  private colors = new Map<string, THREE.Color>();

  constructor(private sim: Simulation) {
    this.overlay = new Overlay(sim.world, { lift: 0.1, opacity: 0.58, pulse: false, inset: 0.02 });
  }

  private c(hex: string): THREE.Color {
    let c = this.colors.get(hex);
    if (!c) this.colors.set(hex, (c = new THREE.Color(hex)));
    return c;
  }

  set(mode: ViewMode): void {
    this.mode = this.mode === mode ? 'none' : mode;
    if (this.mode === 'none') this.overlay.clear();
    this.last = 0;
    this.onChange?.(this.mode);
  }

  update(time: number): void {
    if (this.mode === 'none' || time - this.last < 0.5) return;
    this.last = time;
    const w = this.sim.world, ut = this.sim.utilities;
    const layers = new Map<string, number[]>();
    const add = (hex: string, idx: number) => {
      let l = layers.get(hex);
      if (!l) layers.set(hex, (l = []));
      l.push(idx);
    };
    const ramp = (v: number) => RAMP[Math.max(0, Math.min(4, Math.floor(v * 5)))];
    const m = this.mode;
    for (let idx = 0; idx < w.tiles.length; idx++) {
      const built = w.bState[idx] === BuildState.Built;
      if (m === 'traffic') {
        if (w.tiles[idx] === 1) add(TRAFFIC_LEVELS.find(([max]) => this.sim.traffic.density[idx] < max)![1], idx);
      } else if (UTIL[m]) {
        const [u, producers] = UTIL[m]!;
        if (producers.includes(w.service[idx])) add('#ffffff', idx);
        else if (built) add(ut.hasUtility(idx, u) ? '#22c55e' : '#ef4444', idx);
      } else if (COV[m]) {
        const [bit, svc] = COV[m]!;
        if (w.service[idx] === svc) add('#ffffff', idx);
        else if (ut.coverage[idx] & bit) add(SERVICE_INFO[svc as Exclude<Service, 0>].color, idx);
        else if (built) add('#7f1d1d', idx);
      } else if (m === 'happiness') {
        if (built) add(ramp(ut.happiness[idx]), idx);
      } else if (m === 'land') {
        if (w.zones[idx]) add(ramp((this.sim.landValue(idx) - 0.2) / 0.7), idx);
      }
    }
    this.overlay.set([...layers].map(([hex, tiles]) => [tiles, this.c(hex)] as [number[], THREE.Color]));
  }
}
