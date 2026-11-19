/** Familles de voies : coût, vitesse, accès aux parcelles et effets. */

export const enum RoadType {
  Street = 1,
  Avenue = 2,
  Highway = 3,
  Pedestrian = 4,
}

export interface RoadInfo {
  name: string;
  description: string;
  cost: number;
  upkeep: number;
  /** Multiplicateur de vitesse des véhicules. */
  speed: number;
  /** Les voitures peuvent-elles y circuler ? */
  cars: boolean;
  /** Donne accès aux parcelles voisines (zonage, équipements). */
  access: boolean;
  /** Vitesse affichée (km/h). */
  kmh: number;
  color: string;
  unlockPop: number;
}

export const ROAD_INFO: Record<RoadType, RoadInfo> = {
  [RoadType.Street]: { name: 'Rue', description: 'Desserte des quartiers, trottoirs, 30 km/h.', cost: 15, upkeep: 0.6, speed: 1, cars: true, access: true, kmh: 30, color: '#9ca3af', unlockPop: 0 },
  [RoadType.Avenue]: { name: 'Avenue', description: 'Axe urbain rapide avec terre-plein, feux automatiques, 50 km/h.', cost: 32, upkeep: 1.2, speed: 1.45, cars: true, access: true, kmh: 50, color: '#e5e7eb', unlockPop: 0 },
  [RoadType.Highway]: { name: 'Autoroute', description: 'Transit rapide sans accès aux parcelles, bruyante, 110 km/h.', cost: 70, upkeep: 2.5, speed: 2.4, cars: true, access: false, kmh: 110, color: '#60a5fa', unlockPop: 600 },
  [RoadType.Pedestrian]: { name: 'Voie piétonne', description: 'Sans voitures, valorise le quartier, dessert les parcelles.', cost: 20, upkeep: 0.5, speed: 1, cars: false, access: true, kmh: 0, color: '#d6c7a1', unlockPop: 0 },
};

export const ROAD_TYPES = [RoadType.Street, RoadType.Avenue, RoadType.Highway, RoadType.Pedestrian] as const;

/** Les ponts coûtent plus cher. */
export const BRIDGE_COST_MUL = 5;
/** Hauteur minimale du tablier (au-dessus du niveau de l'eau). */
export const BRIDGE_Y = 0.45;
/** Durée d'une phase de feu (secondes simulées). */
export const LIGHT_PHASE = 4;
