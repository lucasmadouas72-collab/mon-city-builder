import {
  ROAD_COST, ROAD_REFUND, ROAD_UPKEEP_MONTH, SECONDS_PER_DAY, SIM_STEP, SPEEDS, START_MONEY, TREE_CLEAR_COST,
} from '../config';
import { Emitter, type GameEvents } from '../core/Events';
import { Tile, World } from './World';

const DAYS_PER_MONTH = 30;

export interface CostEstimate {
  cost: number;
  valid: number[];
  invalid: number[];
  reason: string | null;
}

/** État de la partie et règles du jeu. Ne dépend pas du rendu. */
export class Simulation {
  readonly events = new Emitter<GameEvents>();
  readonly world: World;
  money = START_MONEY;
  speedIndex = 1;
  /** Jours écoulés depuis le début de la partie. */
  dayCount = 0;
  private dayProgress = 0;
  private accumulator = 0;
  roadCount = 0;

  constructor(world: World) {
    this.world = world;
  }

  get speed(): number {
    return SPEEDS[this.speedIndex];
  }

  setSpeed(index: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    this.events.emit('speedChanged', this.speedIndex);
  }

  get date() {
    const month = Math.floor(this.dayCount / DAYS_PER_MONTH);
    return { day: (this.dayCount % DAYS_PER_MONTH) + 1, month: month % 12, year: 1 + Math.floor(month / 12) };
  }

  /** Avance la simulation d'un temps réel dt (s), par pas fixes. */
  update(dt: number): void {
    this.accumulator += Math.min(dt, 0.25) * this.speed;
    while (this.accumulator >= SIM_STEP) {
      this.accumulator -= SIM_STEP;
      this.tick(SIM_STEP);
    }
  }

  private tick(step: number): void {
    this.dayProgress += step / SECONDS_PER_DAY;
    while (this.dayProgress >= 1) {
      this.dayProgress -= 1;
      this.dayCount++;
      if (this.dayCount % DAYS_PER_MONTH === 0) this.onNewMonth();
      this.events.emit('dateChanged', this.date);
    }
  }

  private onNewMonth(): void {
    const upkeep = Math.round(this.roadCount * ROAD_UPKEEP_MONTH);
    if (upkeep > 0) this.spend(upkeep);
  }

  private spend(amount: number): void {
    this.money -= amount;
    this.events.emit('moneyChanged', this.money);
  }

  // ---------- Construction ----------

  estimateRoads(path: number[]): CostEstimate {
    const w = this.world;
    const out: CostEstimate = { cost: 0, valid: [], invalid: [], reason: null };
    for (const idx of path) {
      const i = idx % w.size, j = Math.floor(idx / w.size);
      if (w.tiles[idx] === Tile.Road) continue;
      const block = w.roadBlocker(i, j);
      if (block) {
        out.invalid.push(idx);
        out.reason ??= block;
      } else {
        out.valid.push(idx);
        out.cost += ROAD_COST + w.trees[idx] * TREE_CLEAR_COST;
      }
    }
    return out;
  }

  buildRoads(path: number[]): boolean {
    const est = this.estimateRoads(path);
    if (est.invalid.length) {
      this.events.emit('notify', { text: est.reason ?? 'Construction impossible', kind: 'warn' });
      return false;
    }
    if (est.valid.length === 0) return false;
    if (est.cost > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' });
      return false;
    }
    let treesRemoved = false;
    for (const idx of est.valid) {
      this.world.tiles[idx] = Tile.Road;
      if (this.world.trees[idx]) {
        this.world.trees[idx] = 0;
        treesRemoved = true;
      }
    }
    this.roadCount += est.valid.length;
    this.spend(est.cost);
    this.events.emit('roadsChanged', { tiles: est.valid });
    if (treesRemoved) this.events.emit('treesChanged', undefined);
    return true;
  }

  estimateBulldoze(area: number[]): { refund: number; cost: number; tiles: number[] } {
    const w = this.world;
    let refund = 0, cost = 0;
    const tiles: number[] = [];
    for (const idx of area) {
      if (w.tiles[idx] === Tile.Road) {
        refund += Math.round(ROAD_COST * ROAD_REFUND);
        tiles.push(idx);
      } else if (w.trees[idx]) {
        cost += w.trees[idx] * TREE_CLEAR_COST;
        tiles.push(idx);
      }
    }
    return { refund, cost, tiles };
  }

  bulldoze(area: number[]): void {
    const w = this.world;
    const est = this.estimateBulldoze(area);
    if (!est.tiles.length) return;
    if (est.cost - est.refund > this.money) {
      this.events.emit('notify', { text: 'Fonds insuffisants', kind: 'error' });
      return;
    }
    const roads: number[] = [];
    let trees = false;
    for (const idx of est.tiles) {
      if (w.tiles[idx] === Tile.Road) {
        w.tiles[idx] = Tile.Empty;
        roads.push(idx);
      } else if (w.trees[idx]) {
        w.trees[idx] = 0;
        trees = true;
      }
    }
    this.roadCount -= roads.length;
    this.spend(est.cost - est.refund);
    if (roads.length) this.events.emit('roadsChanged', { tiles: roads });
    if (trees) this.events.emit('treesChanged', undefined);
  }
}
