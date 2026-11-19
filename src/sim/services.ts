/** Bâtiments de service : réseaux (électricité, eau, égouts, déchets) et services publics. */

export const enum Service {
  None = 0,
  PowerPlant = 1,
  WindTurbine = 2,
  WaterPump = 3,
  Sewage = 4,
  Landfill = 5,
  Clinic = 6,
  School = 7,
  Police = 8,
  FireStation = 9,
  Park = 10,
  MetroStation = 11,
  Levee = 12,
  WarningCenter = 13,
  NuclearPlant = 14,
  SolarFarm = 15,
  HydroDam = 16,
  Substation = 17,
  Interconnect = 18,
  WaterTreatment = 19,
  WaterTower = 20,
  Incinerator = 21,
  Recycling = 22,
  Composting = 23,
  LandfillSite = 24,
}

/** Ressources distribuées par le réseau routier. */
export const enum Utility {
  Power = 0,
  Water = 1,
  Sewage = 2,
  Garbage = 3,
}
export const UTILITIES = [Utility.Power, Utility.Water, Utility.Sewage, Utility.Garbage] as const;
export const UTILITY_NAMES = ['Électricité', 'Eau', 'Égouts', 'Déchets'];
export const UTILITY_SHORT = ['Élec', 'Eau', 'Égout', 'Déch'];
export const UTILITY_COLORS = ['#facc15', '#38bdf8', '#a78b6f', '#94a3b8'];

/** Couvertures par rayon (bits). */
export const enum Coverage {
  Health = 1,
  Education = 2,
  Police = 4,
  Fire = 8,
  Park = 16,
}
export const COVERAGES = [Coverage.Health, Coverage.Education, Coverage.Police, Coverage.Fire, Coverage.Park] as const;
export const COVERAGE_NAMES: Record<number, string> = {
  [Coverage.Health]: 'Santé',
  [Coverage.Education]: 'Éducation',
  [Coverage.Police]: 'Police',
  [Coverage.Fire]: 'Pompiers',
  [Coverage.Park]: 'Parcs',
};

export type ServiceCategory = 'utilities' | 'services' | 'transport';

/** Postes budgétaires réglables (50 % à 150 %). */
export type BudgetKey = 'utilities' | 'health' | 'education' | 'police' | 'fire' | 'parks' | 'transport';

export interface ServiceInfo {
  name: string;
  category: ServiceCategory;
  description: string;
  cost: number;
  upkeep: number;
  color: string;
  /** Production d'une ressource réseau. */
  utility?: Utility;
  capacity?: number;
  /** Couverture par rayon (en cases). */
  coverage?: Coverage;
  radius?: number;
  /** Doit être à moins de 2 cases de l'eau. */
  nearWater?: boolean;
  /** Pollue les alentours (baisse la valeur foncière). */
  nuisance?: number;
  /** Poste budgétaire. */
  budget: BudgetKey;
  /** Population nécessaire pour le débloquer. */
  unlockPop: number;
  /** Production électrique : 'solar' (selon l'ensoleillement), 'hydro' (selon le débit), 'wind'. */
  powerSource?: 'thermal' | 'nuclear' | 'solar' | 'hydro' | 'wind' | 'waste';
  /** Capacité de transformation (sous-station) ou de traitement (eau, déchets) par mois. */
  treatment?: number;
  /** Stockage (château d'eau : unités d'eau ; décharge : tonnes de déchets). */
  storage?: number;
  /** Camions de collecte des déchets. */
  trucks?: number;
  /** Filière de traitement des déchets. */
  waste?: 'sorting' | 'recycling' | 'compost' | 'incineration' | 'landfill';
  /** Doit être près du bord de la carte. */
  nearEdge?: boolean;
  /** Pollution de l'air émise (multiplicateur). */
  air?: number;
}

export const SERVICE_INFO: Record<Exclude<Service, Service.None>, ServiceInfo> = {
  [Service.PowerPlant]: {
    name: 'Centrale au gaz', category: 'utilities', description: 'Grosse production électrique, mais polluante.',
    cost: 9000, upkeep: 420, color: '#facc15', utility: Utility.Power, capacity: 3000, nuisance: 0.18, powerSource: 'thermal', air: 1,
 budget: 'utilities', unlockPop: 0,
  },
  [Service.WindTurbine]: {
    name: 'Éolienne', category: 'utilities', description: 'Électricité propre, petite production.',
    cost: 2200, upkeep: 70, color: '#fde68a', utility: Utility.Power, capacity: 420, powerSource: 'wind',
 budget: 'utilities', unlockPop: 0,
  },
  [Service.WaterPump]: {
    name: "Station de pompage", category: 'utilities', description: "Pompe l'eau potable. À placer près de l'eau.",
    cost: 4000, upkeep: 200, color: '#38bdf8', utility: Utility.Water, capacity: 2600, nearWater: true,
 budget: 'utilities', unlockPop: 0,
  },
  [Service.Sewage]: {
    name: "Station d'épuration", category: 'utilities', description: "Traite les eaux usées. À placer près de l'eau.",
    cost: 5000, upkeep: 240, color: '#a78b6f', utility: Utility.Sewage, capacity: 2600, nearWater: true, nuisance: 0.1,
 budget: 'utilities', unlockPop: 300,
  },
  [Service.Landfill]: {
    name: 'Centre de tri', category: 'utilities', description: 'Dépôt de 3 camions de collecte ; trie 1 200 t de déchets par mois.',
    cost: 3200, upkeep: 160, color: '#94a3b8', utility: Utility.Garbage, capacity: 2400, nuisance: 0.12, treatment: 1200, trucks: 3, waste: 'sorting',
 budget: 'utilities', unlockPop: 0,
  },
  [Service.Clinic]: {
    name: 'Clinique', category: 'services', description: 'Soigne les habitants du quartier.',
    cost: 4200, upkeep: 260, color: '#f87171', coverage: Coverage.Health, radius: 20,
 budget: 'health', unlockPop: 300,
  },
  [Service.School]: {
    name: 'École', category: 'services', description: 'Nécessaire pour les immeubles résidentiels de niveau 3.',
    cost: 3800, upkeep: 230, color: '#fb923c', coverage: Coverage.Education, radius: 16,
 budget: 'education', unlockPop: 300,
  },
  [Service.Police]: {
    name: 'Commissariat', category: 'services', description: 'Fait baisser la délinquance.',
    cost: 3600, upkeep: 220, color: '#60a5fa', coverage: Coverage.Police, radius: 20,
 budget: 'police', unlockPop: 1200,
  },
  [Service.FireStation]: {
    name: 'Caserne de pompiers', category: 'services', description: 'Évite que les incendies détruisent les bâtiments.',
    cost: 3600, upkeep: 220, color: '#ef4444', coverage: Coverage.Fire, radius: 20,
 budget: 'fire', unlockPop: 0,
  },
  [Service.Park]: {
    name: 'Parc', category: 'services', description: 'Rend le quartier plus agréable.',
    cost: 450, upkeep: 20, color: '#4ade80', coverage: Coverage.Park, radius: 4,
 budget: 'parks', unlockPop: 0,
  },
  [Service.MetroStation]: {
    name: 'Station de métro', category: 'transport', description: 'Reliez les stations par une ligne de métro.',
    cost: 6500, upkeep: 180, color: '#e879f9', budget: 'transport', unlockPop: 3000,
  },
  [Service.Levee]: {
    name: 'Digue', category: 'services', description: 'Protège des inondations les cases basses à moins de 6 cases. À placer au bord de l’eau.',
    cost: 1500, upkeep: 30, color: '#94a3b8', budget: 'utilities', unlockPop: 0, nearWater: true, radius: 6,
  },
  [Service.WarningCenter]: {
    name: 'Centre d’alerte', category: 'services', description: 'Annonce les catastrophes à l’avance : évacuation possible, moins de victimes et de dégâts.',
    cost: 5000, upkeep: 200, color: '#f472b6', budget: 'fire', unlockPop: 600,
  },
  [Service.NuclearPlant]: {
    name: 'Centrale nucléaire', category: 'utilities', description: 'Production énorme sans pollution de l’air. Très chère. Refroidie par l’eau : à placer près de l’eau.',
    cost: 60000, upkeep: 1900, color: '#c4b5fd', utility: Utility.Power, capacity: 12000, nearWater: true, nuisance: 0.06, powerSource: 'nuclear',
    budget: 'utilities', unlockPop: 6000,
  },
  [Service.SolarFarm]: {
    name: 'Centrale solaire', category: 'utilities', description: 'Électricité propre selon l’ensoleillement (saison, météo, région).',
    cost: 5500, upkeep: 60, color: '#fbbf24', utility: Utility.Power, capacity: 900, powerSource: 'solar',
    budget: 'utilities', unlockPop: 600,
  },
  [Service.HydroDam]: {
    name: 'Barrage hydroélectrique', category: 'utilities', description: 'Grosse production propre selon le débit. Sur une rive de cours d’eau ou de lac.',
    cost: 24000, upkeep: 320, color: '#0ea5e9', utility: Utility.Power, capacity: 4500, nearWater: true, powerSource: 'hydro',
    budget: 'utilities', unlockPop: 1500,
  },
  [Service.Substation]: {
    name: 'Sous-station', category: 'utilities', description: 'Transforme le courant pour les quartiers à 14 cases : moins de pertes. Capacité 5 000.',
    cost: 2500, upkeep: 60, color: '#fde047', treatment: 5000, radius: 14,
    budget: 'utilities', unlockPop: 0,
  },
  [Service.Interconnect]: {
    name: 'Interconnexion régionale', category: 'utilities', description: 'Achète ou vend de l’électricité (3 000) et de l’eau (2 000) aux villes voisines. Près du bord de la carte.',
    cost: 8000, upkeep: 150, color: '#a3e635', nearEdge: true,
    budget: 'utilities', unlockPop: 300,
  },
  [Service.WaterTreatment]: {
    name: 'Usine de traitement d’eau', category: 'utilities', description: 'Rend l’eau pompée potable (4 000 par mois) : plus de risque de contamination.',
    cost: 7000, upkeep: 260, color: '#22d3ee', treatment: 4000,
    budget: 'utilities', unlockPop: 1000,
  },
  [Service.WaterTower]: {
    name: 'Château d’eau', category: 'utilities', description: 'Stocke 2 500 unités d’eau (pénuries, pannes) et maintient la pression à 16 cases.',
    cost: 2500, upkeep: 40, color: '#7dd3fc', storage: 2500, radius: 16,
    budget: 'utilities', unlockPop: 300,
  },
  [Service.Incinerator]: {
    name: 'Incinérateur', category: 'utilities', description: 'Brûle 3 000 t de déchets par mois et produit jusqu’à 600 d’électricité. Pollue l’air.',
    cost: 12000, upkeep: 380, color: '#78716c', utility: Utility.Power, capacity: 600, treatment: 3000, trucks: 3, waste: 'incineration', nuisance: 0.15, powerSource: 'waste', air: 0.6,
    budget: 'utilities', unlockPop: 2500,
  },
  [Service.Recycling]: {
    name: 'Centre de recyclage', category: 'utilities', description: 'Recycle 1 800 t par mois et revend les matériaux.',
    cost: 6000, upkeep: 220, color: '#10b981', treatment: 1800, trucks: 2, waste: 'recycling', nuisance: 0.05,
    budget: 'utilities', unlockPop: 1500,
  },
  [Service.Composting]: {
    name: 'Plateforme de compostage', category: 'utilities', description: 'Composte 1 000 t de déchets organiques par mois. Engrais pour l’agriculture.',
    cost: 2500, upkeep: 70, color: '#84cc16', treatment: 1000, trucks: 1, waste: 'compost', nuisance: 0.06,
    budget: 'utilities', unlockPop: 300,
  },
  [Service.LandfillSite]: {
    name: 'Décharge', category: 'utilities', description: 'Stocke 40 000 t de déchets, puis est pleine. Bon marché mais nuisible.',
    cost: 2000, upkeep: 50, color: '#a16207', storage: 40000, trucks: 2, waste: 'landfill', nuisance: 0.2,
    budget: 'utilities', unlockPop: 0,
  },
};

export const SERVICES = Object.keys(SERVICE_INFO).map(Number) as Array<Exclude<Service, Service.None>>;

/** Consommation d'une ressource par habitant ou emploi. */
export const CONSUMPTION = [1, 1, 1, 0.8];
/** Jours sans électricité ou sans eau avant qu'un bâtiment soit abandonné. */
export const ABANDON_DAYS = 45;
