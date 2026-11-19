import type { MapType } from '../sim/World';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'classic' | 'sandbox';

export interface GameConfig {
  cityName: string;
  mayor: string;
  region: string;
  mapType: MapType;
  seed: number;
  difficulty: Difficulty;
  mode: GameMode;
  /** Mois de départ (0 = janvier). */
  startMonth: number;
  weather: boolean;
}

export const DIFFICULTY: Record<Difficulty, { name: string; money: number; income: number }> = {
  easy: { name: 'Facile', money: 100_000, income: 1.15 },
  normal: { name: 'Normale', money: 50_000, income: 1 },
  hard: { name: 'Difficile', money: 25_000, income: 0.85 },
};

export const defaultConfig = (): GameConfig => ({
  cityName: 'Néoville', mayor: '', region: 'Val-Clair', mapType: 'river', seed: 1337,
  difficulty: 'normal', mode: 'classic', startMonth: 3, weather: true,
});
