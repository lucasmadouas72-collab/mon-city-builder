/** Réglages globaux du jeu. Changer GAME_NAME suffit pour renommer le jeu partout. */
export const GAME_NAME = 'Néoville';

export const MAP_SIZE = 128; // nombre de cases par côté
export const SEA_LEVEL = 0;
export const MAX_ROAD_SLOPE = 0.9; // dénivelé max accepté sur une case de route

export const START_MONEY = 50_000;
export const ROAD_COST = 15; // par case
export const ROAD_REFUND = 0.5; // part remboursée à la démolition
export const ROAD_UPKEEP_MONTH = 0.6; // entretien mensuel par case
export const TREE_CLEAR_COST = 2;

export const SIM_STEP = 1 / 20; // pas fixe de simulation (s)
export const SECONDS_PER_DAY = 1.5; // durée réelle d'un jour de jeu à vitesse 1
export const SPEEDS = [0, 1, 2, 4] as const;
