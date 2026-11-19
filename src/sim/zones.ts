/**
 * Types de zones (densités, zones spécialisées et mixtes) et paramètres des bâtiments associés (§5, §6).
 * Chaque zone appartient à une « famille » économique (résidentiel, commerce, industrie, bureaux)
 * qui porte la demande et l'impôt. Les valeurs 1 à 4 sont celles des anciennes sauvegardes.
 */
export const enum Zone {
  None = 0,
  /** Résidentiel densité moyenne (ancien « Résidentiel »). */
  Residential = 1,
  /** Commerce local (ancien « Commercial »). */
  Commercial = 2,
  Industrial = 3,
  Office = 4,
  ResidentialLow = 5,
  ResidentialHigh = 6,
  CommercialDense = 7,
  Mixed = 8,
  Agriculture = 9,
  Logistics = 10,
  Research = 11,
  Tourism = 12,
  Forestry = 13,
  Mining = 14,
}

/** Familles économiques (demande, impôts). */
export const ZONES = [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as const;
export type ZoneType = (typeof ZONES)[number];
/** Toutes les zones constructibles. */
export const ALL_ZONES = [
  Zone.ResidentialLow, Zone.Residential, Zone.ResidentialHigh, Zone.Commercial, Zone.CommercialDense, Zone.Office,
  Zone.Industrial, Zone.Mixed, Zone.Agriculture, Zone.Forestry, Zone.Mining, Zone.Logistics, Zone.Research, Zone.Tourism,
] as const;
export type ZoneId = (typeof ALL_ZONES)[number];

export const enum BuildState {
  Empty = 0,
  Construction = 1,
  Built = 2,
  /** Bâtiment abandonné : vide, délabré, à réhabiliter ou démolir. */
  Abandoned = 3,
}

/** Taille d'une parcelle : façade (le long de la route) × profondeur, en cases. */
export type LotShape = [front: number, depth: number, weight: number];

export interface ZoneInfo {
  name: string;
  short: string;
  color: string;
  /** Famille économique. */
  kind: ZoneType;
  /** Catégorie affichée sur la fiche du bâtiment. */
  category: string;
  /** Habitants par case, niveaux 1 à 3. */
  homes: [number, number, number];
  /** Emplois par case, niveaux 1 à 3. */
  jobs: [number, number, number];
  /** Formes de parcelle possibles et leur fréquence. */
  lots: LotShape[];
  /** Pente maximale tolérée sur la parcelle. */
  maxSlope: number;
  /** Nuisances produites (multiplicateurs). */
  pollution: { air: number; noise: number; water: number; light: number };
  /** Bruit maximal toléré pour qu'un bâtiment s'y construise (0 à 1). */
  noiseTolerance: number;
  /** Règles affichées (nuisances, horaires, desserte). */
  rules: string;
  /** Bâtiments attendus. */
  buildings: string;
  /** Coût de construction par case et par niveau (pour le placement manuel et les améliorations). */
  cost: number;
  unlockPop: number;
  /** Impôt indicatif (conservé pour compatibilité). */
  tax: number;
  /** Capacité principale (compatibilité : habitants ou emplois). */
  capacity: [number, number, number];
}

const P = (air: number, noise: number, water: number, light: number) => ({ air, noise, water, light });

const make = (z: Omit<ZoneInfo, 'capacity'>): ZoneInfo => ({ ...z, capacity: z.homes[0] ? z.homes : z.jobs });

export const ZONE_INFO: Record<ZoneId, ZoneInfo> = {
  [Zone.ResidentialLow]: make({
    name: 'Résidentiel faible densité', short: 'R1', color: '#86efac', kind: Zone.Residential, category: 'Logement',
    homes: [4, 6, 9], jobs: [0, 0, 0], lots: [[1, 1, 8], [2, 1, 2]], maxSlope: 0.6, pollution: P(0, 0, 0, 0), noiseTolerance: 0.35,
    rules: 'Calme exigé (bruit faible). Accès par une rue ou une avenue.', buildings: 'Maisons individuelles, petits jardins', cost: 900, unlockPop: 0, tax: 1.6,
  }),
  [Zone.Residential]: make({
    name: 'Résidentiel densité moyenne', short: 'R2', color: '#4ade80', kind: Zone.Residential, category: 'Logement',
    homes: [12, 22, 34], jobs: [0, 0, 0], lots: [[1, 1, 6], [2, 1, 3], [2, 2, 1]], maxSlope: 0.6, pollution: P(0, 0, 0, 0), noiseTolerance: 0.5,
    rules: 'Bruit modéré toléré. Accès par une rue ou une avenue.', buildings: 'Maisons mitoyennes, petits immeubles', cost: 1600, unlockPop: 0, tax: 1.6,
  }),
  [Zone.ResidentialHigh]: make({
    name: 'Résidentiel forte densité', short: 'R3', color: '#16a34a', kind: Zone.Residential, category: 'Logement',
    homes: [30, 60, 100], jobs: [0, 0, 0], lots: [[1, 1, 3], [2, 1, 2], [2, 2, 3], [3, 2, 1]], maxSlope: 0.45, pollution: P(0, 0.01, 0, 0.01), noiseTolerance: 0.65,
    rules: 'Bruit urbain toléré. Desserte forte : avenue ou transports conseillés.', buildings: 'Immeubles collectifs et tours', cost: 3200, unlockPop: 800, tax: 1.6,
  }),
  [Zone.Commercial]: make({
    name: 'Commerce local', short: 'C1', color: '#60a5fa', kind: Zone.Commercial, category: 'Commerce',
    homes: [0, 0, 0], jobs: [4, 10, 18], lots: [[1, 1, 8], [2, 1, 2]], maxSlope: 0.6, pollution: P(0, 1, 0, 1), noiseTolerance: 1,
    rules: 'Ouvert 8 h – 20 h. Bruit léger. Accès piéton apprécié.', buildings: 'Boutiques, cafés, restaurants, services', cost: 1400, unlockPop: 0, tax: 2.2,
  }),
  [Zone.CommercialDense]: make({
    name: 'Commerce dense', short: 'C2', color: '#2563eb', kind: Zone.Commercial, category: 'Commerce',
    homes: [0, 0, 0], jobs: [10, 22, 40], lots: [[1, 1, 1], [2, 2, 4], [3, 2, 2], [3, 3, 1]], maxSlope: 0.4, pollution: P(0, 1.6, 0, 1.6), noiseTolerance: 1,
    rules: 'Ouvert 9 h – 21 h. Trafic de livraisons et de clients. Avenue conseillée.', buildings: 'Grandes surfaces et pôles commerciaux', cost: 2600, unlockPop: 1200, tax: 2.2,
  }),
  [Zone.Office]: make({
    name: 'Bureaux', short: 'B', color: '#c084fc', kind: Zone.Office, category: 'Bureaux',
    homes: [0, 0, 0], jobs: [12, 34, 90], lots: [[1, 1, 5], [2, 1, 1], [2, 2, 2]], maxSlope: 0.5, pollution: P(0, 0.3, 0, 1), noiseTolerance: 1,
    rules: 'Horaires de bureau. Peu de nuisances. Besoin de diplômés.', buildings: 'Bureaux, sièges, activités tertiaires', cost: 3000, unlockPop: 600, tax: 2.8,
  }),
  [Zone.Industrial]: make({
    name: 'Industrie générale', short: 'I', color: '#facc15', kind: Zone.Industrial, category: 'Industrie',
    homes: [0, 0, 0], jobs: [8, 20, 46], lots: [[1, 1, 4], [2, 1, 3], [2, 2, 3], [3, 2, 1]], maxSlope: 0.45, pollution: P(1, 1, 1, 0.3), noiseTolerance: 1,
    rules: 'Activité jour et nuit. Pollution et bruit : éloigner des logements.', buildings: 'Ateliers, usines, entrepôts', cost: 2000, unlockPop: 0, tax: 1.8,
  }),
  [Zone.Mixed]: make({
    name: 'Zone mixte', short: 'M', color: '#2dd4bf', kind: Zone.Residential, category: 'Logement et commerce',
    homes: [6, 12, 22], jobs: [3, 6, 10], lots: [[1, 1, 6], [2, 1, 2]], maxSlope: 0.55, pollution: P(0, 0.4, 0, 0.5), noiseTolerance: 0.55,
    rules: 'Commerces au rez-de-chaussée (8 h – 20 h), logements aux étages. Pas d’industrie bruyante à proximité. Rue ou avenue, pas d’autoroute.',
    buildings: 'Immeubles avec boutiques en pied', cost: 2000, unlockPop: 300, tax: 1.6,
  }),
  [Zone.Agriculture]: make({
    name: 'Agriculture', short: 'A', color: '#a3a33a', kind: Zone.Industrial, category: 'Agriculture',
    homes: [0, 0, 0], jobs: [3, 5, 7], lots: [[1, 1, 1], [2, 2, 4], [3, 2, 2], [3, 3, 3]], maxSlope: 0.35, pollution: P(0.05, 0.1, 0.4, 0), noiseTolerance: 1,
    rules: 'Terrain plat requis. Produit des denrées. Pollue un peu l’eau (engrais).', buildings: 'Fermes, champs, serres, silos', cost: 700, unlockPop: 0, tax: 1.8,
  }),
  [Zone.Logistics]: make({
    name: 'Logistique', short: 'L', color: '#f97316', kind: Zone.Industrial, category: 'Logistique',
    homes: [0, 0, 0], jobs: [6, 12, 20], lots: [[2, 1, 2], [2, 2, 3], [3, 2, 2]], maxSlope: 0.4, pollution: P(0.1, 1.2, 0, 0.6), noiseTolerance: 1,
    rules: 'Activité 24 h/24, nombreux camions. Réduit le coût des importations. Proche d’une avenue ou d’une autoroute.', buildings: 'Entrepôts, plateformes de fret', cost: 1800, unlockPop: 500, tax: 1.8,
  }),
  [Zone.Research]: make({
    name: 'Recherche', short: 'Rx', color: '#e879f9', kind: Zone.Office, category: 'Recherche',
    homes: [0, 0, 0], jobs: [8, 20, 44], lots: [[1, 1, 3], [2, 1, 1], [2, 2, 3]], maxSlope: 0.5, pollution: P(0, 0.2, 0, 0.8), noiseTolerance: 0.6,
    rules: 'Exige une école à portée et des diplômés. Rend l’industrie plus productive.', buildings: 'Laboratoires, campus technologiques', cost: 3500, unlockPop: 2000, tax: 2.8,
  }),
  [Zone.Tourism]: make({
    name: 'Tourisme', short: 'T', color: '#f472b6', kind: Zone.Commercial, category: 'Tourisme',
    homes: [0, 0, 0], jobs: [5, 12, 26], lots: [[1, 1, 4], [2, 1, 2], [2, 2, 2]], maxSlope: 0.6, pollution: P(0, 0.6, 0, 1), noiseTolerance: 0.6,
    rules: 'Attire des visiteurs selon les parcs, l’eau proche et la valeur foncière. Ouvert toute l’année.', buildings: 'Hôtels, auberges, résidences de vacances', cost: 2400, unlockPop: 1000, tax: 2.2,
  }),
  [Zone.Forestry]: make({
    name: 'Sylviculture', short: 'F', color: '#15803d', kind: Zone.Industrial, category: 'Sylviculture',
    homes: [0, 0, 0], jobs: [3, 5, 8], lots: [[2, 2, 3], [3, 2, 2], [3, 3, 2], [2, 1, 1]], maxSlope: 0.6, pollution: P(0, 0.4, 0.05, 0), noiseTolerance: 1,
    rules: 'Produit du bois pour l’industrie. Plus productive près des forêts. Bruit de scierie.', buildings: 'Scieries, parcelles de plantation, stocks de grumes', cost: 800, unlockPop: 0, tax: 1.8,
  }),
  [Zone.Mining]: make({
    name: 'Extraction minière', short: 'X', color: '#78716c', kind: Zone.Industrial, category: 'Extraction',
    homes: [0, 0, 0], jobs: [6, 12, 18], lots: [[1, 1, 2], [2, 2, 3], [3, 2, 1]], maxSlope: 0.9, pollution: P(0.5, 1, 0.6, 0.2), noiseTolerance: 1,
    rules: 'Uniquement sur un gisement de minerai (carte Ressources). Pollue l’air, l’eau et les sols.', buildings: 'Chevalements, carrières, terrils', cost: 1500, unlockPop: 0, tax: 1.8,
  }),
};

/** Nom des familles économiques (impôts, demande). */
export const KIND_NAMES: Record<ZoneType, string> = {
  [Zone.Residential]: 'Résidentiel', [Zone.Commercial]: 'Commercial', [Zone.Industrial]: 'Industriel', [Zone.Office]: 'Bureaux',
};
export const KIND_SHORT: Record<ZoneType, string> = { [Zone.Residential]: 'R', [Zone.Commercial]: 'C', [Zone.Industrial]: 'I', [Zone.Office]: 'B' };
export const KIND_COLORS: Record<ZoneType, string> = { [Zone.Residential]: '#4ade80', [Zone.Commercial]: '#60a5fa', [Zone.Industrial]: '#facc15', [Zone.Office]: '#c084fc' };

export const zoneInfo = (z: number): ZoneInfo | undefined => ZONE_INFO[z as ZoneId];
/** Famille économique d'une zone (0 si aucune). */
export const kindOf = (z: number): ZoneType | 0 => ZONE_INFO[z as ZoneId]?.kind ?? 0;
/** La zone comporte-t-elle des logements ? */
export const hasHomes = (z: number): boolean => (ZONE_INFO[z as ZoneId]?.homes[0] ?? 0) > 0;
/** La zone comporte-t-elle des emplois ? */
export const hasJobs = (z: number): boolean => (ZONE_INFO[z as ZoneId]?.jobs[0] ?? 0) > 0;
/** Famille économique des emplois de la zone (commerce pour la zone mixte). */
export const jobKind = (z: number): ZoneType | 0 => (z === Zone.Mixed ? Zone.Commercial : hasJobs(z) ? kindOf(z) : 0);

export const LEVEL_NAMES = ['', 'Niveau 1', 'Niveau 2', 'Niveau 3'];
export const STATE_NAMES = ['Terrain libre', 'En construction', 'Actif', 'Abandonné'];
/** Distance maximale (en cases) entre une zone et une route. */
export const ZONE_DEPTH = 3;
/** Pente maximale pour construire un bâtiment. */
export const MAX_BUILD_SLOPE = 0.6;

/** Styles architecturaux (§6) : choisis selon la région et le quartier. */
export const STYLE_NAMES = ['Classique', 'Moderne', 'Méditerranéen', 'Montagnard'];

/** Nombre d'étages indicatif par zone et niveau (hauteur sur la fiche : 3,2 m par étage). */
export const FLOORS: Record<ZoneId, [number, number, number]> = {
  [Zone.ResidentialLow]: [1, 2, 2], [Zone.Residential]: [2, 4, 5], [Zone.ResidentialHigh]: [6, 12, 20],
  [Zone.Commercial]: [1, 3, 4], [Zone.CommercialDense]: [1, 2, 3], [Zone.Office]: [4, 9, 18],
  [Zone.Industrial]: [1, 2, 3], [Zone.Mixed]: [2, 4, 6], [Zone.Agriculture]: [1, 1, 2],
  [Zone.Logistics]: [1, 1, 2], [Zone.Research]: [2, 4, 7], [Zone.Tourism]: [3, 6, 12],
  [Zone.Forestry]: [1, 1, 2], [Zone.Mining]: [2, 3, 4],
};
