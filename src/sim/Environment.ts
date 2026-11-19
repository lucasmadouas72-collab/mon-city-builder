import { rng } from '../core/noise';

/** Heure, saisons et météo. Ces valeurs influencent le trafic, la consommation et l'affichage. */

export const enum Season { Spring = 0, Summer = 1, Autumn = 2, Winter = 3 }
export const SEASON_NAMES = ['Printemps', 'Été', 'Automne', 'Hiver'];

export type Weather = 'sun' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog' | 'heat' | 'frost' | 'wind';
export const WEATHER_NAMES: Record<Weather, string> = {
  sun: 'Ensoleillé', clouds: 'Nuageux', rain: 'Pluie', storm: 'Orage', snow: 'Neige', fog: 'Brouillard', heat: 'Canicule', frost: 'Gel', wind: 'Vent fort',
};

/** Probabilités de chaque météo selon la saison. */
const WEATHER_TABLE: Record<Season, Array<[Weather, number]>> = {
  [Season.Spring]: [['sun', 4], ['clouds', 3], ['rain', 3], ['storm', 1], ['fog', 1], ['wind', 2]],
  [Season.Summer]: [['sun', 6], ['clouds', 2], ['rain', 1], ['storm', 2], ['heat', 2]],
  [Season.Autumn]: [['sun', 2], ['clouds', 4], ['rain', 4], ['storm', 1], ['fog', 3], ['wind', 3]],
  [Season.Winter]: [['sun', 2], ['clouds', 3], ['snow', 4], ['fog', 2], ['frost', 3]],
};
const BASE_TEMP = [14, 25, 12, 1];

/** Durée réelle (s) d'un cycle jour/nuit complet à vitesse 1. */
export const DAY_CYCLE_SECONDS = 150;

export class Environment {
  /** Heure de la journée (0 à 24). */
  hour = 9;
  weather: Weather = 'sun';
  weatherEnabled = true;
  /** Mois de départ (0 à 11) choisi à la création de la partie. */
  startMonth = 3;
  private daysLeft = 4;
  private rand = rng(31337);

  season(month: number): Season {
    const m = (month + this.startMonth) % 12;
    if (m >= 2 && m <= 4) return Season.Spring;
    if (m >= 5 && m <= 7) return Season.Summer;
    if (m >= 8 && m <= 10) return Season.Autumn;
    return Season.Winter;
  }

  /** Mois réel du calendrier, en tenant compte du mois de départ. */
  calendarMonth(month: number): number {
    return (month + this.startMonth) % 12;
  }

  advance(gameSeconds: number): void {
    this.hour = (this.hour + (gameSeconds / DAY_CYCLE_SECONDS) * 24) % 24;
  }

  /** Appelé chaque jour de calendrier ; renvoie true si la météo change. */
  onNewDay(month: number): boolean {
    if (!this.weatherEnabled) { const changed = this.weather !== 'sun'; this.weather = 'sun'; return changed; }
    if (--this.daysLeft > 0) return false;
    this.daysLeft = 3 + Math.floor(this.rand() * 5);
    const table = WEATHER_TABLE[this.season(month)];
    const total = table.reduce((s, [, w]) => s + w, 0);
    let r = this.rand() * total;
    let next: Weather = 'sun';
    for (const [w, p] of table) { if ((r -= p) <= 0) { next = w; break; } }
    const changed = next !== this.weather;
    this.weather = next;
    return changed;
  }

  temperature(month: number): number {
    const base = BASE_TEMP[this.season(month)];
    const daily = Math.sin(((this.hour - 9) / 24) * Math.PI * 2) * 4;
    const w = this.weather;
    const delta = w === 'heat' ? 11 : w === 'frost' ? -8 : w === 'snow' ? -4 : w === 'rain' || w === 'storm' ? -3 : w === 'sun' ? 2 : 0;
    return Math.round(base + daily + delta);
  }

  /** 0 en plein jour, 1 en pleine nuit. */
  get night(): number {
    const h = this.hour;
    if (h >= 7.5 && h <= 18.5) return 0;
    if (h >= 21 || h <= 5) return 1;
    if (h < 7.5) return (7.5 - h) / 2.5;
    return (h - 18.5) / 2.5;
  }

  /** Volume de trafic selon l'heure (pointes le matin et le soir, creux la nuit). */
  get trafficVolume(): number {
    const h = this.hour;
    const rush = Math.exp(-((h - 8) ** 2) / 1.5) * 0.6 + Math.exp(-((h - 18) ** 2) / 2) * 0.55;
    const day = h > 6 && h < 22 ? 0.75 : 0.25;
    return Math.min(1.35, day + rush);
  }

  /** Production des éoliennes selon le vent. */
  get windFactor(): number {
    return this.weather === 'wind' ? 1.5 : this.weather === 'storm' ? 1.2 : this.weather === 'heat' || this.weather === 'fog' ? 0.6 : 1;
  }

  /** Ensoleillement moyen de la journée (centrales solaires) selon la saison et la météo. */
  solarFactor(month: number): number {
    const season = [0.95, 1.15, 0.75, 0.45][this.season(month)];
    const w = this.weather;
    const sky = w === 'sun' || w === 'heat' ? 1 : w === 'clouds' || w === 'wind' || w === 'frost' ? 0.6 : w === 'fog' ? 0.45 : 0.3;
    return season * sky;
  }

  /** Débit des cours d'eau (barrages) : fort au printemps et sous la pluie, faible en canicule. */
  hydroFactor(month: number): number {
    const season = [1.15, 0.85, 1, 0.9][this.season(month)];
    const w = this.weather;
    return season * (w === 'rain' || w === 'storm' ? 1.15 : w === 'heat' ? 0.6 : w === 'frost' ? 0.8 : 1);
  }

  /** Disponibilité de l'eau pour le captage (sécheresse en canicule). */
  get waterFactor(): number {
    return this.weather === 'heat' ? 0.85 : 1;
  }

  /** Vitesse des véhicules selon la météo. */
  get trafficSpeed(): number {
    switch (this.weather) {
      case 'snow': return 0.7;
      case 'frost': return 0.8;
      case 'storm': return 0.8;
      case 'fog': return 0.85;
      case 'rain': return 0.9;
      default: return 1;
    }
  }

  /** Multiplicateurs de consommation [électricité, eau, égouts, déchets]. */
  consumption(month: number): number[] {
    const s = this.season(month);
    let power = s === Season.Winter ? 1.15 : s === Season.Summer ? 1.05 : 1;
    let water = s === Season.Summer ? 1.1 : 1;
    if (this.weather === 'heat') { power += 0.15; water += 0.2; }
    if (this.weather === 'frost' || this.weather === 'snow') power += 0.1;
    const night = this.night;
    power *= 1 + night * 0.05;
    return [power, water, water, 1];
  }

  /** Bonus ou malus de bonheur dû à la météo. */
  get happiness(): number {
    switch (this.weather) {
      case 'sun': return 0.02;
      case 'heat': return -0.05;
      case 'storm': return -0.03;
      case 'frost': return -0.02;
      default: return 0;
    }
  }
}
