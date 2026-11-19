import type { GameConfig } from '../game/config';
import type { Simulation } from './Simulation';
import { World } from './World';

/** Sauvegarde complète d'une partie, au format JSON (tableaux encodés en base64). */

const VERSION = 1;
const ARRAYS = ['heights', 'tiles', 'trees', 'zones', 'bState', 'bLevel', 'bVariant', 'bTimer', 'service', 'busStop', 'roadType', 'oneway', 'lights', 'links'] as const;
/** Tableaux ajoutés après la première version (absents des anciennes sauvegardes). */
const OPTIONAL = new Set(['roadType', 'oneway', 'lights', 'links']);
type ArrayKey = (typeof ARRAYS)[number];

function toB64(arr: ArrayBufferView): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string, target: ArrayBufferView): void {
  const s = atob(b64);
  const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
  if (s.length !== bytes.length) throw new Error('Taille de données inattendue');
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
}

export interface CameraState { target: [number, number, number]; position: [number, number, number] }

export interface SaveFile {
  version: number;
  config: GameConfig;
  world: Record<ArrayKey, string> & { seed: number; mapType: string };
  sim: Record<string, unknown>;
  camera?: CameraState;
}

export function serialize(sim: Simulation, config: GameConfig, camera?: CameraState): string {
  const w = sim.world;
  const world = { seed: w.seed, mapType: w.mapType } as SaveFile['world'];
  for (const k of ARRAYS) world[k] = toB64(w[k]);
  const file: SaveFile = {
    version: VERSION,
    config,
    world,
    sim: {
      money: Number.isFinite(sim.money) ? Math.round(sim.money) : null,
      dayCount: sim.dayCount,
      taxes: sim.taxes,
      budgets: sim.budgets,
      loans: sim.loans,
      maxPop: sim.maxPop,
      milestone: sim.milestone,
      history: sim.history,
      env: { hour: sim.env.hour, weather: sim.env.weather },
      demo: { shares: sim.demo.shares, education: sim.demo.education },
      lines: sim.transit.lines.map((l) => ({ kind: l.kind, stops: l.stops, color: l.color, name: l.name })),
    },
    camera,
  };
  return JSON.stringify(file);
}

export function parseSave(data: string): SaveFile {
  const file = JSON.parse(data) as SaveFile;
  if (!file || file.version !== VERSION || !file.world || !file.config) throw new Error("Ce fichier n'est pas une sauvegarde valide");
  return file;
}

/** Recrée le monde d'une sauvegarde (sans régénérer le terrain). */
export function worldFromSave(file: SaveFile): World {
  const w = new World(file.world.seed, file.world.mapType as World['mapType'], false);
  for (const k of ARRAYS) { if (file.world[k]) fromB64(file.world[k], w[k]); else if (!OPTIONAL.has(k)) throw new Error('Sauvegarde incomplète'); }
  w.computeRoadDist();
  return w;
}

/** Restaure l'état de la simulation après création du monde. */
export function applySave(sim: Simulation, file: SaveFile): void {
  const s = file.sim as Record<string, any>;
  if (s.money !== null && s.money !== undefined) sim.money = s.money;
  sim.dayCount = s.dayCount ?? 0;
  Object.assign(sim.taxes, s.taxes ?? {});
  Object.assign(sim.budgets, s.budgets ?? {});
  sim.loans = s.loans ?? [];
  sim.maxPop = s.maxPop ?? 0;
  sim.milestone = s.milestone ?? 0;
  sim.history = s.history ?? [];
  if (s.env) { sim.env.hour = s.env.hour; sim.env.weather = s.env.weather; }
  if (s.demo) { sim.demo.shares = s.demo.shares; sim.demo.education = s.demo.education; }
  sim.transit.budget = (sim.budgets.transport ?? 100) / 100;
  sim.afterLoad();
  for (const l of s.lines ?? []) {
    const line = sim.transit.addLine(l.kind, l.stops);
    if (line) { line.color = l.color; line.name = l.name; sim.transit.refreshLine(line); }
  }
  sim.recomputeStats();
}
