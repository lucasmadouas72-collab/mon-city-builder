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
  BusDepot = 25,
  TramDepot = 26,
  MetroDepot = 27,
  TrainStation = 28,
  FerryPier = 29,
  TaxiDepot = 30,
  BikeStation = 31,
  Parking = 32,
  Airport = 33,
  Harbor = 34,
  Museum = 35,
  Monument = 36,
  Theater = 37,
  Cinema = 38,
  ConcertHall = 39,
  CongressCenter = 40,
  Stadium = 41,
  Arena = 42,
  Gym = 43,
  Pool = 44,
  SportsField = 45,
  IceRink = 46,
  Zoo = 47,
  Aquarium = 48,
  Beach = 49,
  Promenade = 50,
  AmusementPark = 51,
  TouristInfo = 52,
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
  Leisure = 32,
}
export const COVERAGES = [Coverage.Health, Coverage.Education, Coverage.Police, Coverage.Fire, Coverage.Park, Coverage.Leisure] as const;
export const COVERAGE_NAMES: Record<number, string> = {
  [Coverage.Health]: 'Santé',
  [Coverage.Education]: 'Éducation',
  [Coverage.Police]: 'Police',
  [Coverage.Fire]: 'Pompiers',
  [Coverage.Park]: 'Parcs',
  [Coverage.Leisure]: 'Loisirs',
};

export type ServiceCategory = 'utilities' | 'services' | 'transport' | 'leisure';

/** Postes budgétaires réglables (50 % à 150 %). */
export type BudgetKey = 'utilities' | 'health' | 'education' | 'police' | 'fire' | 'parks' | 'transport' | 'maintenance' | 'culture';

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
  /** Emprise en cases (largeur x, profondeur z) pour les grands équipements. */
  footprint?: [number, number];
  /** Doit toucher une voie ferrée / une voie de tram. */
  needsRail?: boolean;
  needsTram?: boolean;
  /** Équipement de loisirs : visiteurs par mois, prix d'entrée, attrait touristique, types d'événements accueillis. */
  leisure?: { capacity: number; ticket: number; appeal: number; kind: 'culture' | 'sport' | 'nature' | 'tourism'; events?: string[] };
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
  [Service.BusDepot]: {
    name: 'Dépôt de bus', category: 'transport', description: 'Nécessaire pour exploiter des lignes de bus sur ce réseau routier (remisage et entretien des bus).',
    cost: 5000, upkeep: 150, color: '#22c55e', budget: 'transport', unlockPop: 1200,
  },
  [Service.TramDepot]: {
    name: 'Dépôt de tramway', category: 'transport', description: 'Nécessaire aux lignes de tram. Doit toucher une voie de tram.',
    cost: 9000, upkeep: 250, color: '#f59e0b', budget: 'transport', unlockPop: 2500, needsTram: true,
  },
  [Service.MetroDepot]: {
    name: 'Dépôt de métro', category: 'transport', description: 'Entretient les rames : sans dépôt, les lignes de métro n’ont que la moitié de leur capacité.',
    cost: 12000, upkeep: 300, color: '#c026d3', budget: 'transport', unlockPop: 3000,
  },
  [Service.TrainStation]: {
    name: 'Gare', category: 'transport', description: 'Gare de voyageurs et de fret. Doit toucher une voie ferrée. Reliée au bord de la carte : trains régionaux, touristes et fret.',
    cost: 15000, upkeep: 320, color: '#0ea5e9', budget: 'transport', unlockPop: 2000, needsRail: true,
  },
  [Service.FerryPier]: {
    name: 'Embarcadère', category: 'transport', description: 'Quai de ferry. Au bord de l’eau ; reliez deux quais par une ligne. Service suspendu par tempête.',
    cost: 6000, upkeep: 120, color: '#38bdf8', budget: 'transport', unlockPop: 1500, nearWater: true,
  },
  [Service.TaxiDepot]: {
    name: 'Station de taxis', category: 'transport', description: 'Flotte de 10 taxis : une partie des trajets se fait en taxi (licences : recette mensuelle).',
    cost: 3000, upkeep: 60, color: '#facc15', budget: 'transport', unlockPop: 800,
  },
  [Service.BikeStation]: {
    name: 'Vélos en libre-service', category: 'transport', description: 'Station de vélos partagés : plus de trajets courts à vélo autour (avec des pistes cyclables).',
    cost: 1200, upkeep: 40, color: '#4ade80', budget: 'transport', unlockPop: 300, radius: 8,
  },
  [Service.Parking]: {
    name: 'Parking', category: 'transport', description: '400 places à 6 cases. Près d’un arrêt de transport : parking relais.',
    cost: 4500, upkeep: 80, color: '#64748b', budget: 'transport', unlockPop: 600, radius: 6,
  },
  [Service.Airport]: {
    name: 'Aéroport', category: 'transport', description: 'Piste et terminal (5 × 3 cases) : touristes, affaires, fret aérien. Très bruyant.',
    cost: 90000, upkeep: 2600, color: '#e2e8f0', budget: 'transport', unlockPop: 8000, footprint: [5, 3], nuisance: 0.25,
  },
  [Service.Harbor]: {
    name: 'Port de commerce', category: 'transport', description: 'Quais et grues (3 × 2 cases) au bord de l’eau : exportations et stockage accrus.',
    cost: 40000, upkeep: 900, color: '#0369a1', budget: 'transport', unlockPop: 3000, footprint: [3, 2], nearWater: true, nuisance: 0.15,
  },
  [Service.Museum]: {
    name: 'Musée', category: 'leisure', description: 'Collections et expositions : attire touristes et scolaires.',
    cost: 14000, upkeep: 320, color: '#c084fc', budget: 'culture', unlockPop: 1500, coverage: Coverage.Leisure, radius: 14,
    leisure: { capacity: 6000, ticket: 6, appeal: 0.06, kind: 'culture' },
  },
  [Service.Monument]: {
    name: 'Monument historique', category: 'leisure', description: 'Place et monument emblématiques, gratuits : forte attractivité.',
    cost: 20000, upkeep: 150, color: '#e9d5ff', budget: 'culture', unlockPop: 2500, coverage: Coverage.Leisure, radius: 10,
    leisure: { capacity: 9000, ticket: 0, appeal: 0.08, kind: 'culture', events: ['market', 'seasonal'] },
  },
  [Service.Theater]: {
    name: 'Théâtre', category: 'leisure', description: 'Spectacles vivants. Accueille des représentations.',
    cost: 12000, upkeep: 280, color: '#f472b6', budget: 'culture', unlockPop: 1200, coverage: Coverage.Leisure, radius: 12,
    leisure: { capacity: 3000, ticket: 15, appeal: 0.03, kind: 'culture', events: ['show'] },
  },
  [Service.Cinema]: {
    name: 'Cinéma', category: 'leisure', description: 'Séances tous les jours : loisir de proximité très fréquenté.',
    cost: 6000, upkeep: 120, color: '#fb7185', budget: 'culture', unlockPop: 600, coverage: Coverage.Leisure, radius: 10,
    leisure: { capacity: 5000, ticket: 9, appeal: 0.01, kind: 'culture' },
  },
  [Service.ConcertHall]: {
    name: 'Salle de concert', category: 'leisure', description: 'Concerts et spectacles musicaux.',
    cost: 16000, upkeep: 300, color: '#a855f7', budget: 'culture', unlockPop: 2500, coverage: Coverage.Leisure, radius: 12,
    leisure: { capacity: 4000, ticket: 25, appeal: 0.04, kind: 'culture', events: ['concert', 'show'] },
  },
  [Service.CongressCenter]: {
    name: 'Centre de congrès', category: 'leisure', description: 'Salons et congrès professionnels (2 × 2 cases) : tourisme d’affaires.',
    cost: 30000, upkeep: 500, color: '#818cf8', budget: 'culture', unlockPop: 4000, coverage: Coverage.Leisure, radius: 8,
    leisure: { capacity: 5000, ticket: 20, appeal: 0.05, kind: 'tourism', events: ['fair'] },
    footprint: [2, 2],
  },
  [Service.Stadium]: {
    name: 'Stade', category: 'leisure', description: 'Grand stade de 30 000 places (3 × 3 cases) : matchs, concerts, compétitions. Gros pics de circulation.',
    cost: 60000, upkeep: 900, color: '#22d3ee', budget: 'culture', unlockPop: 5000, coverage: Coverage.Leisure, radius: 16,
    leisure: { capacity: 30000, ticket: 20, appeal: 0.06, kind: 'sport', events: ['match', 'concert', 'competition', 'festival'] },
    footprint: [3, 3], nuisance: 0.08,
  },
  [Service.Arena]: {
    name: 'Arena', category: 'leisure', description: 'Salle omnisport de 10 000 places (2 × 2 cases) : matchs et concerts.',
    cost: 35000, upkeep: 600, color: '#06b6d4', budget: 'culture', unlockPop: 3000, coverage: Coverage.Leisure, radius: 12,
    leisure: { capacity: 10000, ticket: 18, appeal: 0.04, kind: 'sport', events: ['match', 'concert', 'competition'] },
    footprint: [2, 2],
  },
  [Service.Gym]: {
    name: 'Gymnase', category: 'leisure', description: 'Sports en salle pour les habitants du quartier.',
    cost: 4000, upkeep: 90, color: '#67e8f9', budget: 'culture', unlockPop: 300, coverage: Coverage.Leisure, radius: 8,
    leisure: { capacity: 2000, ticket: 4, appeal: 0, kind: 'sport' },
  },
  [Service.Pool]: {
    name: 'Piscine', category: 'leisure', description: 'Piscine municipale : très appréciée l’été.',
    cost: 7000, upkeep: 160, color: '#38bdf8', budget: 'culture', unlockPop: 600, coverage: Coverage.Leisure, radius: 10,
    leisure: { capacity: 3000, ticket: 4, appeal: 0.01, kind: 'sport', events: ['competition'] },
  },
  [Service.SportsField]: {
    name: 'Terrain de sport', category: 'leisure', description: 'Terrain extérieur gratuit : football, basket.',
    cost: 1500, upkeep: 30, color: '#4ade80', budget: 'culture', unlockPop: 0, coverage: Coverage.Leisure, radius: 6,
    leisure: { capacity: 1500, ticket: 0, appeal: 0, kind: 'sport' },
  },
  [Service.IceRink]: {
    name: 'Patinoire', category: 'leisure', description: 'Patinoire couverte : très fréquentée l’hiver.',
    cost: 9000, upkeep: 220, color: '#bae6fd', budget: 'culture', unlockPop: 1500, coverage: Coverage.Leisure, radius: 10,
    leisure: { capacity: 2000, ticket: 6, appeal: 0.01, kind: 'sport', events: ['competition'] },
  },
  [Service.Zoo]: {
    name: 'Zoo', category: 'leisure', description: 'Parc animalier (3 × 2 cases) : grande attraction familiale.',
    cost: 40000, upkeep: 700, color: '#a3e635', budget: 'culture', unlockPop: 3000, coverage: Coverage.Leisure, radius: 14,
    leisure: { capacity: 15000, ticket: 14, appeal: 0.08, kind: 'nature' },
    footprint: [3, 2],
  },
  [Service.Aquarium]: {
    name: 'Aquarium', category: 'leisure', description: 'Au bord de l’eau : attraction touristique.',
    cost: 22000, upkeep: 380, color: '#2dd4bf', budget: 'culture', unlockPop: 2500, coverage: Coverage.Leisure, radius: 12,
    leisure: { capacity: 8000, ticket: 15, appeal: 0.06, kind: 'nature' },
    nearWater: true,
  },
  [Service.Beach]: {
    name: 'Plage aménagée', category: 'leisure', description: 'Au bord de l’eau : baignade, festivals d’été. Fréquentation selon la saison.',
    cost: 3000, upkeep: 80, color: '#fde68a', budget: 'culture', unlockPop: 0, coverage: Coverage.Leisure, radius: 10,
    leisure: { capacity: 20000, ticket: 0, appeal: 0.07, kind: 'nature', events: ['festival', 'seasonal'] },
    nearWater: true,
  },
  [Service.Promenade]: {
    name: 'Promenade et quais', category: 'leisure', description: 'Au bord de l’eau : marchés et balades.',
    cost: 2500, upkeep: 40, color: '#fcd34d', budget: 'culture', unlockPop: 0, coverage: Coverage.Leisure, radius: 8,
    leisure: { capacity: 6000, ticket: 0, appeal: 0.03, kind: 'nature', events: ['market', 'festival'] },
    nearWater: true,
  },
  [Service.AmusementPark]: {
    name: 'Parc d’attractions', category: 'leisure', description: 'Manèges et spectacles (3 × 3 cases) : attraction majeure, bruyante.',
    cost: 80000, upkeep: 1200, color: '#f97316', budget: 'culture', unlockPop: 6000, coverage: Coverage.Leisure, radius: 16,
    leisure: { capacity: 25000, ticket: 22, appeal: 0.1, kind: 'nature' },
    footprint: [3, 3], nuisance: 0.1,
  },
  [Service.TouristInfo]: {
    name: 'Office de tourisme', category: 'leisure', description: 'Point d’information : +10 % de touristes, meilleure répartition des visiteurs.',
    cost: 3500, upkeep: 90, color: '#fbbf24', budget: 'culture', unlockPop: 800, coverage: Coverage.Leisure, radius: 12,
    leisure: { capacity: 0, ticket: 0, appeal: 0.03, kind: 'tourism' },
  },
};

export const SERVICES = Object.keys(SERVICE_INFO).map(Number) as Array<Exclude<Service, Service.None>>;

/** Consommation d'une ressource par habitant ou emploi. */
export const CONSUMPTION = [1, 1, 1, 0.8];
/** Jours sans électricité ou sans eau avant qu'un bâtiment soit abandonné. */
export const ABANDON_DAYS = 45;
