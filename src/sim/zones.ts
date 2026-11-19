/** Types de zones et paramètres des bâtiments associés. */
export const enum Zone {
  None = 0,
  Residential = 1,
  Commercial = 2,
  Industrial = 3,
  Office = 4,
}

export const ZONES = [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as const;
export type ZoneType = (typeof ZONES)[number];

export const enum BuildState {
  Empty = 0,
  Construction = 1,
  Built = 2,
}

export interface ZoneInfo {
  name: string;
  short: string;
  color: string;
  /** Habitants (résidentiel) ou emplois (autres), par niveau 1 à 3. */
  capacity: [number, number, number];
  /** Impôt mensuel par habitant ou par emploi. */
  tax: number;
  /** Population minimale pour débloquer la zone. */
  unlockPop: number;
}

export const ZONE_INFO: Record<ZoneType, ZoneInfo> = {
  [Zone.Residential]: { name: 'Résidentiel', short: 'R', color: '#4ade80', capacity: [6, 22, 64], tax: 1.6, unlockPop: 0 },
  [Zone.Commercial]: { name: 'Commercial', short: 'C', color: '#60a5fa', capacity: [4, 12, 32], tax: 2.2, unlockPop: 0 },
  [Zone.Industrial]: { name: 'Industriel', short: 'I', color: '#facc15', capacity: [8, 20, 46], tax: 1.8, unlockPop: 0 },
  [Zone.Office]: { name: 'Bureaux', short: 'B', color: '#c084fc', capacity: [12, 34, 90], tax: 2.8, unlockPop: 600 },
};

export const LEVEL_NAMES = ['', 'Niveau 1', 'Niveau 2', 'Niveau 3'];
/** Distance maximale (en cases) entre une zone et une route. */
export const ZONE_DEPTH = 3;
/** Pente maximale pour construire un bâtiment. */
export const MAX_BUILD_SLOPE = 0.6;
