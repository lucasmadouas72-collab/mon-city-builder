import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';
import { BuildState, hasHomes } from '../sim/zones';
import { Coverage, SERVICE_INFO, Service, Utility } from '../sim/services';
import { Overlay } from './Overlay';

export type ViewMode =
  | 'none' | 'traffic' | 'power' | 'water' | 'sewage' | 'garbage'
  | 'health' | 'education' | 'police' | 'fire' | 'park' | 'happiness' | 'land' | 'transport' | 'air' | 'noise' | 'crime' | 'waterPol' | 'soil' | 'light' | 'damage' | 'risk' | 'rent' | 'occupancy';

export const VIEW_LABELS: Array<[ViewMode, string]> = [
  ['traffic', 'Trafic'],
  ['transport', 'Transports'],
  ['power', 'Électricité'],
  ['water', 'Eau'],
  ['sewage', 'Égouts'],
  ['garbage', 'Déchets'],
  ['health', 'Santé'],
  ['education', 'Éducation'],
  ['police', 'Police'],
  ['crime', 'Délinquance'],
  ['fire', 'Pompiers'],
  ['park', 'Parcs'],
  ['air', "Pollution de l'air"],
  ['noise', 'Pollution sonore'],
  ['waterPol', "Pollution de l'eau"],
  ['soil', 'Pollution des sols'],
  ['light', 'Pollution lumineuse'],
  ['damage', 'Dégâts et reconstruction'],
  ['risk', 'Risques naturels'],
  ['happiness', 'Bonheur'],
  ['land', 'Valeur foncière'],
  ['rent', 'Loyers'],
  ['occupancy', 'Occupation des bâtiments'],
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
const POLL = ['#fde68a', '#fbbf24', '#f97316', '#dc2626', '#7f1d1d'];
const LOAD = (r: number) => (r < 0.7 ? '#22c55e' : r < 0.95 ? '#facc15' : '#ef4444');

export interface Legend {
  title: string;
  unit: string;
  items: Array<[string, string]>;
  explanation: string;
}

const COVERED_BY = (name: string, color: string, explanation: string): Legend => ({
  title: name, unit: 'portée par la route (temps de trajet)',
  items: [[color, 'Bâtiment desservi'], ['#7f1d1d', 'Bâtiment non desservi'], ['#22c55e', 'Établissement : places libres'], ['#facc15', 'Établissement : presque plein'], ['#ef4444', 'Établissement : complet']],
  explanation,
});

const LEGENDS: Record<Exclude<ViewMode, 'none'>, Legend> = {
  traffic: { title: 'Trafic', unit: 'véhicules par case (moyenne glissante)', items: [['#22c55e', 'Fluide (< 0,35)'], ['#a3e635', 'Normal'], ['#facc15', 'Chargé'], ['#f97316', 'Dense'], ['#ef4444', 'Embouteillé (> 2,8)']], explanation: 'Densité de véhicules sur chaque case de route. Les axes rouges ralentissent tous les trajets, y compris les secours.' },
  transport: { title: 'Transports en commun', unit: 'distance à pied d’un arrêt', items: [['#38bdf8', 'Bâtiment desservi par une ligne']], explanation: 'Bâtiments à moins de 6 cases d’un arrêt de bus ou 9 cases d’une station de métro. Les lignes sont tracées en couleur.' },
  power: { title: 'Électricité', unit: 'raccordement', items: [['#ffffff', 'Centrale, éolienne'], ['#22c55e', 'Alimenté'], ['#ef4444', 'Sans électricité']], explanation: 'L’électricité circule par le réseau routier. Un quartier coupé du réseau ou une production insuffisante laisse des bâtiments sans courant.' },
  water: { title: 'Eau potable', unit: 'raccordement', items: [['#ffffff', 'Station de pompage'], ['#22c55e', 'Alimenté'], ['#ef4444', 'Sans eau']], explanation: 'La capacité des stations de pompage limite le nombre de bâtiments desservis.' },
  sewage: { title: 'Égouts', unit: 'raccordement', items: [['#ffffff', 'Station d’épuration'], ['#22c55e', 'Raccordé'], ['#ef4444', 'Non raccordé']], explanation: 'Sans épuration, les immeubles ne peuvent pas passer au niveau 3.' },
  garbage: { title: 'Déchets', unit: 'collecte', items: [['#ffffff', 'Centre de tri'], ['#22c55e', 'Collecté'], ['#ef4444', 'Non collecté']], explanation: 'Les déchets non collectés réduisent le bonheur.' },
  health: COVERED_BY('Santé', SERVICE_INFO[Service.Clinic].color, 'Chaque clinique accueille un nombre limité de patients. Les malades vont à la clinique accessible la plus proche qui a de la place.'),
  education: COVERED_BY('Éducation', SERVICE_INFO[Service.School].color, 'Chaque école a un nombre de places limité. Les élèves sont affectés selon leur âge, la distance et les places disponibles.'),
  police: COVERED_BY('Police', SERVICE_INFO[Service.Police].color, 'Zone que les patrouilles atteignent à temps par la route. Les embouteillages la réduisent.'),
  fire: COVERED_BY('Pompiers', SERVICE_INFO[Service.FireStation].color, 'Zone que les camions atteignent à temps par la route. Un incendie hors de portée détruit le bâtiment.'),
  park: { title: 'Parcs', unit: 'distance à pied (4 cases)', items: [[SERVICE_INFO[Service.Park].color, 'À proximité d’un parc'], ['#7f1d1d', 'Sans parc']], explanation: 'Les parcs augmentent le bonheur et la valeur foncière, et absorbent une partie de la pollution.' },
  air: { title: 'Pollution de l’air', unit: 'indice 0 à 100 %', items: [['#fde68a', 'Faible'], ['#fbbf24', 'Modérée'], ['#f97316', 'Forte'], ['#dc2626', 'Très forte'], ['#7f1d1d', 'Dangereuse']], explanation: 'Émise par l’industrie, les centrales et le trafic. Elle rend des habitants malades et fait baisser la valeur foncière.' },
  noise: { title: 'Pollution sonore', unit: 'indice 0 à 100 %', items: [['#fde68a', 'Faible'], ['#fbbf24', 'Modérée'], ['#f97316', 'Forte'], ['#dc2626', 'Très forte'], ['#7f1d1d', 'Insupportable']], explanation: 'Due aux routes chargées (surtout les autoroutes), à l’industrie et aux commerces.' },
  crime: { title: 'Délinquance', unit: 'risque 0 à 100 %', items: [['#22c55e', 'Faible'], ['#a3e635', 'Modérée'], ['#facc15', 'Notable'], ['#f97316', 'Forte'], ['#ef4444', 'Très forte']], explanation: 'Calculée à partir du chômage, de la valeur foncière, de la présence de la police et des délits non élucidés.' },
  waterPol: { title: 'Pollution de l’eau', unit: 'indice 0 à 100 % (cases d’eau)', items: [['#fde68a', 'Faible'], ['#f97316', 'Forte'], ['#7f1d1d', 'Très forte'], ['#a855f7', 'Bâtiment recevant une eau contaminée']], explanation: 'Les eaux usées non traitées et l’industrie polluent l’eau. Une station de pompage proche d’une eau polluée distribue une eau contaminée qui rend malade.' },
  soil: { title: 'Pollution des sols', unit: 'indice 0 à 100 % (s’accumule)', items: [['#fde68a', 'Faible'], ['#f97316', 'Forte'], ['#7f1d1d', 'Très forte']], explanation: 'S’accumule lentement autour de l’industrie, des centrales et des centres de tri, et lors des accidents industriels. Elle baisse la valeur foncière et la santé.' },
  light: { title: 'Pollution lumineuse', unit: 'indice 0 à 100 % (la nuit)', items: [['#fef9c3', 'Faible'], ['#facc15', 'Modérée'], ['#f59e0b', 'Forte']], explanation: 'Éclairage des commerces, bureaux et grands axes. Elle gêne le sommeil des habitants voisins.' },
  damage: { title: 'Dégâts', unit: '0 à 100 %', items: [['#facc15', 'Bâtiment légèrement endommagé'], ['#f97316', 'Gravement endommagé'], ['#57534e', 'Gravats (déblaiement en cours)'], ['#fb923c', 'Route abîmée (ralentie)'], ['#3b82c4', 'Inondé']], explanation: 'Les réparations sont automatiques et facturées chaque mois (poste « Réparations et reconstruction »). Le budget Pompiers accélère les réparations.' },
  risk: { title: 'Risques naturels', unit: 'zones exposées', items: [['#3b82c4', 'Zone inondable non protégée'], ['#14b8a6', 'Zone inondable protégée par une digue'], ['#d97706', 'Forêt dense (risque de feu)']], explanation: 'Les cases basses proches de l’eau peuvent être inondées lors des fortes pluies. Une digue protège 6 cases autour d’elle. Les forêts denses brûlent lors des canicules.' },
  rent: { title: 'Loyers', unit: '€ par foyer et par mois', items: [['#22c55e', '< 450 €'], ['#a3e635', '450 à 600 €'], ['#facc15', '600 à 750 €'], ['#f97316', '750 à 900 €'], ['#ef4444', '> 900 €']], explanation: 'Le loyer dépend du niveau du bâtiment, de la valeur foncière et du manque de logements.' },
  occupancy: { title: 'Occupation', unit: 'part des logements ou des postes occupés', items: [['#ef4444', 'Presque vide'], ['#f97316', 'Peu occupé'], ['#facc15', 'À moitié'], ['#a3e635', 'Bien occupé'], ['#22c55e', 'Plein']], explanation: 'Logements habités (résidentiel) ou postes pourvus (entreprises). Un bâtiment vide ne rapporte rien.' },
  happiness: { title: 'Bonheur', unit: '0 à 100 %', items: [['#ef4444', 'Très mécontent'], ['#f97316', 'Mécontent'], ['#facc15', 'Neutre'], ['#a3e635', 'Satisfait'], ['#22c55e', 'Très satisfait']], explanation: 'Combine réseaux, services, pollution, délinquance, espaces verts, impôts et météo.' },
  land: { title: 'Valeur foncière', unit: 'indice relatif', items: [['#ef4444', 'Très basse'], ['#f97316', 'Basse'], ['#facc15', 'Moyenne'], ['#a3e635', 'Élevée'], ['#22c55e', 'Très élevée']], explanation: 'Augmente avec l’eau, la verdure, les services et les voies piétonnes ; baisse près de l’industrie, des autoroutes et de la pollution.' },
};

const RAMP = ['#ef4444', '#f97316', '#facc15', '#a3e635', '#22c55e'];

/** Vues de données : colore les cases selon le trafic, les réseaux, la couverture, le bonheur… */
export class DataView {
  readonly overlay: Overlay;
  mode: ViewMode = 'none';
  onChange?: (mode: ViewMode) => void;
  private last = 0;
  /** Date (texte) de la dernière mise à jour de la carte. */
  updatedAt = '';
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

  private coverCache: Uint8Array | null = null;

  private transitCover(idx: number): boolean {
    return !!this.coverCache?.[idx];
  }

  private buildCover(): void {
    const w = this.sim.world, n = w.size;
    const cover = new Uint8Array(n * n);
    for (const line of this.sim.transit.lines) {
      if (line.broken) continue;
      const r = line.kind === 'bus' ? 6 : 9;
      for (const s of line.stops) {
        const si = s % n, sj = (s - si) / n;
        for (let b = Math.max(0, sj - r); b <= Math.min(n - 1, sj + r); b++)
          for (let a = Math.max(0, si - r); a <= Math.min(n - 1, si + r); a++)
            if (Math.abs(a - si) + Math.abs(b - sj) <= r) cover[b * n + a] = 1;
      }
    }
    this.coverCache = cover;
  }

  get legend(): Legend | null {
    return this.mode === 'none' ? null : LEGENDS[this.mode];
  }

  update(time: number): void {
    if (this.mode === 'transport' && time - this.last >= 0.5) this.buildCover();
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
    const levees = m === 'risk' ? this.sim.disasters.levees() : [];
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
        if (w.service[idx] === svc) {
          const L = ut.loads.get(idx);
          add(L && L.capacity ? LOAD(L.used / L.capacity) : '#ffffff', idx);
        } else if (ut.coverage[idx] & bit) add(SERVICE_INFO[svc as Exclude<Service, 0>].color, idx);
        else if (built) add('#7f1d1d', idx);
      } else if (m === 'waterPol') {
        if (ut.waterPol[idx] > 0.05) add(ut.waterPol[idx] > 0.6 ? '#7f1d1d' : ut.waterPol[idx] > 0.3 ? '#f97316' : '#fde68a', idx);
        else if (built && ut.contaminated[idx]) add('#a855f7', idx);
      } else if (m === 'soil') {
        const v = w.soilPol[idx];
        if (v > 0.05) add(v > 0.5 ? '#7f1d1d' : v > 0.2 ? '#f97316' : '#fde68a', idx);
      } else if (m === 'light') {
        const v = ut.light[idx];
        if (v > 0.05) add(v > 0.4 ? '#f59e0b' : v > 0.2 ? '#facc15' : '#fef9c3', idx);
      } else if (m === 'damage') {
        if (w.flooded[idx]) add('#3b82c4', idx);
        else if (w.rubble[idx]) add('#57534e', idx);
        else if (w.bDamage[idx]) add(w.bDamage[idx] > 50 ? '#f97316' : '#facc15', idx);
        else if (w.roadDamage[idx]) add('#fb923c', idx);
      } else if (m === 'risk') {
        if (w.trees[idx] >= 2) add('#d97706', idx);
        else if (built || w.zones[idx] || w.tiles[idx]) {
          const r = this.sim.disasters.floodRisk(idx, levees);
          if (r) add(r === 2 ? '#14b8a6' : '#3b82c4', idx);
        }
      } else if (m === 'rent') {
        if (built && hasHomes(w.zones[idx])) { const r = this.sim.society.rent(idx); add(r < 450 ? '#22c55e' : r < 600 ? '#a3e635' : r < 750 ? '#facc15' : r < 900 ? '#f97316' : '#ef4444', idx); }
      } else if (m === 'occupancy') {
        if (built) {
          const soc = this.sim.society, cz = soc.citizens;
          const cap = soc.homesOf(idx) + soc.slotsOf(idx, 0) + soc.slotsOf(idx, 1) + soc.slotsOf(idx, 2);
          const used = cz.homesTaken[idx] + cz.employees[idx];
          add(ramp(cap ? used / cap : 0), idx);
        }
      } else if (m === 'crime') {
        if (built) add(RAMP[4 - Math.max(0, Math.min(4, Math.floor(ut.crime[idx] * 5)))], idx);
      } else if (m === 'happiness') {
        if (built) add(ramp(ut.happiness[idx]), idx);
      } else if (m === 'air' || m === 'noise') {
        const v = (m === 'air' ? ut.air : ut.noise)[idx];
        if (v > 0.04) add(POLL[Math.min(4, Math.floor(v * 6))], idx);
      } else if (m === 'transport') {
        if (built && this.transitCover(idx)) add('#38bdf8', idx);
      } else if (m === 'land') {
        if (w.zones[idx]) add(ramp((this.sim.landValue(idx) - 0.2) / 0.7), idx);
      }
    }
    this.overlay.set([...layers].map(([hex, tiles]) => [tiles, this.c(hex)] as [number[], THREE.Color]));
    const d = this.sim.date;
    this.updatedAt = `${d.day}/${d.month + 1} an ${d.year}`;
  }
}
