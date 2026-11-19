import type { Simulation } from './Simulation';
import { BuildState, Zone } from './zones';
import { Coverage, Service } from './services';
import { DISASTER_LEVELS, type DisasterLevel } from '../game/config';

/**
 * Catastrophes : inondations, feux de forêt, tempêtes (tornades), séismes, accidents industriels,
 * pannes électriques. Prévention (digues, centre d'alerte), évacuation, dégâts, reconstruction.
 */

export type DisasterType = 'flood' | 'forestFire' | 'tornado' | 'earthquake' | 'industrial' | 'blackout';
export const DISASTER_NAMES: Record<DisasterType, string> = {
  flood: 'Inondation', forestFire: 'Feu de forêt', tornado: 'Tempête et tornade',
  earthquake: 'Séisme', industrial: 'Accident industriel', blackout: 'Panne électrique majeure',
};
export const DISASTER_TYPES = Object.keys(DISASTER_NAMES) as DisasterType[];

/** Probabilité de base par jour (avant conditions et réglage de fréquence). */
const BASE_RATE: Record<DisasterType, number> = {
  flood: 0.006, forestFire: 0.004, tornado: 0.0025, earthquake: 0.0012, industrial: 0.002, blackout: 0.002,
};

export interface DisasterRecord {
  id: number;
  type: DisasterType;
  tile: number;
  day: number;
  /** 'warning' : annoncée par le centre d'alerte ; 'active' ; 'over'. */
  status: 'warning' | 'active' | 'over';
  countdown: number;
  daysLeft: number;
  radius: number;
  evacuated: boolean;
  warned: boolean;
  damaged: number;
  destroyed: number;
  casualties: number;
  cost: number;
  aid: number;
  magnitude?: number;
  /** Tornade : trajectoire en cours. */
  path?: { x: number; z: number; dx: number; dz: number; left: number };
  plant?: number;
}

export class Disasters {
  level: DisasterLevel = 'rare';
  list: DisasterRecord[] = [];
  /** Malus temporaire de bonheur après une catastrophe. */
  malus = 0;
  /** Centrales en panne (case -> jours restants). */
  offline = new Map<number, number>();
  private nextId = 1;

  constructor(private sim: Simulation) {}

  get active(): DisasterRecord[] {
    return this.list.filter((d) => d.status !== 'over');
  }

  private get hasWarningCenter(): boolean {
    return this.sim.world.service.some((s) => s === Service.WarningCenter);
  }

  private rand(): number {
    return this.sim.emergency.random();
  }

  /** Tirage quotidien et avancement des catastrophes en cours. */
  daily(): void {
    const rate = DISASTER_LEVELS[this.level].rate;
    const sim = this.sim, env = sim.env;
    this.malus *= 0.97;
    for (const [t, d] of this.offline) { if (d <= 1) this.offline.delete(t); else this.offline.set(t, d - 1); }
    if (rate > 0 && sim.stats.population > 150 && !this.active.some((d) => d.type !== 'blackout')) {
      for (const type of DISASTER_TYPES) {
        let p = BASE_RATE[type] * rate;
        if (type === 'flood') p *= env.weather === 'rain' ? 6 : env.weather === 'storm' ? 10 : 0.1;
        if (type === 'forestFire') p *= env.weather === 'heat' ? 8 : env.weather === 'sun' && env.season(sim.monthIndex) === 1 ? 2 : env.weather === 'rain' || env.weather === 'snow' ? 0 : 0.3;
        if (type === 'tornado') p *= env.weather === 'storm' ? 8 : env.weather === 'wind' ? 3 : 0.05;
        if (this.rand() < p) { this.start(type); break; }
      }
    }
    for (const d of this.active) this.progress(d);
  }

  /** Déclenche une catastrophe (tirage ou demande du joueur). */
  start(type: DisasterType, tile?: number): DisasterRecord | null {
    const t = tile ?? this.pickLocation(type);
    if (t < 0) {
      this.sim.events.emit('notify', { text: `${DISASTER_NAMES[type]} : aucun lieu possible sur cette carte`, kind: 'info' });
      return null;
    }
    const warned = this.hasWarningCenter && type !== 'blackout' && type !== 'industrial';
    const d: DisasterRecord = {
      id: this.nextId++, type, tile: t, day: this.sim.dayCount, status: warned ? 'warning' : 'active',
      countdown: warned ? 2 : 0, daysLeft: 0, radius: 0, evacuated: false, warned,
      damaged: 0, destroyed: 0, casualties: 0, cost: 0, aid: 0,
    };
    this.list.push(d);
    if (this.list.length > 40) this.list.shift();
    this.sim.events.emit('disaster', { id: d.id, phase: warned ? 'warning' : 'start' });
    if (!warned) this.begin(d);
    return d;
  }

  evacuate(id: number): void {
    const d = this.list.find((x) => x.id === id);
    if (!d || d.status === 'over') return;
    d.evacuated = true;
    this.sim.events.emit('notify', { text: `Évacuation en cours : ${DISASTER_NAMES[d.type].toLowerCase()} annoncé(e)`, kind: 'info', tile: d.tile });
  }

  private pickLocation(type: DisasterType): number {
    const w = this.sim.world, n = w.size;
    const candidates: number[] = [];
    for (let k = 0; k < w.tiles.length; k++) {
      const i = k % n, j = (k - i) / n;
      if (type === 'flood') { if (!w.isWater(i, j) && w.tileMinMax(i, j)[0] < 0.9 && (w.bState[k] === BuildState.Built || w.tiles[k] === 1)) candidates.push(k); }
      else if (type === 'forestFire') { if (w.trees[k] >= 2) candidates.push(k); }
      else if (type === 'industrial') { if (w.bState[k] === BuildState.Built && w.zones[k] === Zone.Industrial) candidates.push(k); }
      else if (type === 'blackout') { if (w.service[k] === Service.PowerPlant || w.service[k] === Service.WindTurbine) candidates.push(k); }
      else if (w.bState[k] === BuildState.Built) candidates.push(k);
    }
    return candidates.length ? candidates[Math.floor(this.rand() * candidates.length)] : -1;
  }

  /** Effets immédiats au début de la catastrophe. */
  private begin(d: DisasterRecord): void {
    const sim = this.sim, w = sim.world, n = w.size;
    const ci = d.tile % n, cj = Math.floor(d.tile / n);
    const prep = d.warned ? 0.75 : 1; // préparation : dégâts réduits
    d.status = 'active';
    switch (d.type) {
      case 'flood': {
        d.radius = 14;
        d.daysLeft = 5;
        const protectedBy = (k: number) => {
          for (let s = 0; s < w.service.length; s++) {
            if (w.service[s] !== Service.Levee) continue;
            if (Math.hypot((s % n) - (k % n), Math.floor(s / n) - Math.floor(k / n)) <= 6) return true;
          }
          return false;
        };
        for (let j = cj - d.radius; j <= cj + d.radius; j++) {
          for (let i = ci - d.radius; i <= ci + d.radius; i++) {
            if (!w.inBounds(i, j) || Math.hypot(i - ci, j - cj) > d.radius || w.isWater(i, j)) continue;
            const k = w.index(i, j);
            if (w.tileMinMax(i, j)[0] > 0.9 || protectedBy(k)) continue;
            // Il faut être proche de l'eau (montée des eaux)
            let near = false;
            for (let b = j - 4; b <= j + 4 && !near; b++) for (let a = i - 4; a <= i + 4; a++) if (w.inBounds(a, b) && w.isWater(a, b)) { near = true; break; }
            if (!near) continue;
            w.flooded[k] = d.daysLeft;
            if (w.bState[k] === BuildState.Built) this.hit(d, k, (25 + this.rand() * 25) * prep);
            if (w.tiles[k] === 1) w.roadDamage[k] = Math.max(w.roadDamage[k], 40);
          }
        }
        break;
      }
      case 'forestFire':
        d.radius = 1;
        d.daysLeft = 12;
        w.forestFire[d.tile] = 6;
        sim.emergency.report('fire', d.tile, sim.dayCount);
        break;
      case 'tornado': {
        const ang = this.rand() * Math.PI * 2;
        d.path = { x: ci + 0.5, z: cj + 0.5, dx: Math.cos(ang), dz: Math.sin(ang), left: 26 + this.rand() * 18 };
        d.radius = 2;
        d.daysLeft = 30;
        break;
      }
      case 'earthquake': {
        const mag = 5 + this.rand() * 2.5;
        d.magnitude = Math.round(mag * 10) / 10;
        d.radius = Math.round(6 + (mag - 5) * 8);
        d.daysLeft = 1;
        for (let j = cj - d.radius; j <= cj + d.radius; j++) {
          for (let i = ci - d.radius; i <= ci + d.radius; i++) {
            if (!w.inBounds(i, j)) continue;
            const dist = Math.hypot(i - ci, j - cj);
            if (dist > d.radius) continue;
            const k = w.index(i, j);
            const f = (1 - dist / d.radius) * (mag - 4.5) / 3;
            if (w.bState[k] === BuildState.Built) this.hit(d, k, f * (40 + w.bLevel[k] * 20) * (0.6 + this.rand() * 0.8) * prep);
            if (w.tiles[k] === 1 && this.rand() < f) w.roadDamage[k] = Math.min(100, w.roadDamage[k] + Math.round(f * 90));
          }
        }
        sim.events.emit('shake', { strength: Math.min(1, (mag - 4.5) / 3) });
        break;
      }
      case 'industrial': {
        d.radius = 4;
        d.daysLeft = 1;
        this.hit(d, d.tile, 100);
        for (let j = cj - 4; j <= cj + 4; j++) for (let i = ci - 4; i <= ci + 4; i++) {
          if (!w.inBounds(i, j)) continue;
          const dist = Math.hypot(i - ci, j - cj);
          if (dist > 4) continue;
          const k = w.index(i, j);
          w.soilPol[k] = Math.min(1, w.soilPol[k] + 0.5 * (1 - dist / 5));
          if (k !== d.tile && w.bState[k] === BuildState.Built && dist < 2.5) this.hit(d, k, 20 + this.rand() * 25);
        }
        const neighbor = [d.tile + 1, d.tile - 1, d.tile + n, d.tile - n].find((k) => w.bState[k] === BuildState.Built);
        if (neighbor !== undefined) sim.igniteBuilding(neighbor);
        break;
      }
      case 'blackout':
        d.daysLeft = 3 + Math.floor(this.rand() * 4);
        d.plant = d.tile;
        this.offline.set(d.tile, d.daysLeft);
        break;
    }
    this.malus = Math.min(0.2, this.malus + 0.05 + d.destroyed * 0.004);
    sim.afterDisasterHit();
    sim.events.emit('disaster', { id: d.id, phase: 'start' });
  }

  /** Dégâts sur un bâtiment, avec victimes si la zone n'a pas été évacuée. */
  private hit(d: DisasterRecord, k: number, amount: number): void {
    const sim = this.sim, w = sim.world;
    if (amount <= 0 || w.bState[k] !== BuildState.Built) return;
    const before = w.bDamage[k];
    const people = sim.capacity(k);
    const destroyed = sim.damageBuilding(k, Math.round(amount));
    d.damaged++;
    d.cost += Math.round((Math.min(100, before + amount) - before) * 6 * Math.max(1, w.bLevel[k]));
    if (destroyed) d.destroyed++;
    if (!d.evacuated && w.zones[k] === Zone.Residential) {
      d.casualties += Math.round(people * (destroyed ? 0.05 : amount / 100 * 0.03) * (d.warned ? 0.4 : 1));
    }
  }

  /** Avancement quotidien. */
  private progress(d: DisasterRecord): void {
    const sim = this.sim, w = sim.world, n = w.size;
    if (d.status === 'warning') {
      if (--d.countdown <= 0) this.begin(d);
      return;
    }
    if (d.type === 'forestFire') {
      const burning: number[] = [];
      for (let k = 0; k < w.forestFire.length; k++) if (w.forestFire[k]) burning.push(k);
      const spread = sim.env.weather === 'wind' || sim.env.weather === 'storm' ? 0.55 : sim.env.weather === 'rain' ? 0 : 0.32;
      for (const k of burning) {
        if (sim.env.weather === 'rain' || sim.env.weather === 'snow') { w.forestFire[k] = 0; continue; }
        w.forestFire[k]--;
        if (w.forestFire[k] === 0) { w.trees[k] = 0; continue; }
        const i = k % n, j = (k - i) / n;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (!w.inBounds(a, b)) continue;
          const q = w.index(a, b);
          if (w.trees[q] && !w.forestFire[q] && this.rand() < spread) w.forestFire[q] = 5;
          else if (w.bState[q] === BuildState.Built && !sim.utilities.fire[q] && this.rand() < spread * 0.3) sim.igniteBuilding(q);
        }
        if (this.rand() < 0.15) sim.emergency.report('fire', k, sim.dayCount);
      }
      d.damaged = Math.max(d.damaged, burning.length);
      sim.events.emit('treesChanged', undefined);
      sim.events.emit('firesChanged', undefined);
      if (!burning.length || --d.daysLeft <= 0) { w.forestFire.fill(0); this.end(d); }
      return;
    }
    if (d.type === 'flood') {
      for (let k = 0; k < w.flooded.length; k++) if (w.flooded[k]) w.flooded[k]--;
      sim.events.emit('floodChanged', undefined);
      if (--d.daysLeft <= 0) { w.flooded.fill(0); sim.afterDisasterHit(); this.end(d); }
      return;
    }
    if (d.type === 'tornado') {
      if (!d.path || d.path.left <= 0 || --d.daysLeft <= 0) this.end(d);
      return;
    }
    if (d.type === 'blackout') {
      if (!this.offline.has(d.tile)) this.end(d);
      return;
    }
    this.end(d);
  }

  /** Tornade : avance en continu et frappe ce qu'elle traverse. */
  update(dt: number): void {
    const w = this.sim.world;
    for (const d of this.active) {
      if (d.type !== 'tornado' || d.status !== 'active' || !d.path) continue;
      const p = d.path;
      if (p.left <= 0) continue;
      const step = Math.min(p.left, dt * 2.2);
      p.left -= step;
      // Trajectoire légèrement sinueuse
      const ang = Math.atan2(p.dz, p.dx) + (this.rand() - 0.5) * 0.3 * step;
      p.dx = Math.cos(ang); p.dz = Math.sin(ang);
      p.x += p.dx * step; p.z += p.dz * step;
      if (p.x < 1 || p.z < 1 || p.x > w.size - 1 || p.z > w.size - 1) { p.left = 0; continue; }
      const i0 = Math.floor(p.x), j0 = Math.floor(p.z);
      let hitSomething = false;
      for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) {
        if (!w.inBounds(i, j)) continue;
        const dist = Math.hypot(i + 0.5 - p.x, j + 0.5 - p.z);
        if (dist > 1.8) continue;
        const k = w.index(i, j);
        const f = 1 - dist / 2;
        if (w.trees[k] && this.rand() < f) { w.trees[k] = 0; hitSomething = true; }
        if (w.tiles[k] === 1 && w.roadDamage[k] < 60) { w.roadDamage[k] = Math.max(w.roadDamage[k], Math.round(50 * f)); }
        if (w.bState[k] === BuildState.Built && w.bDamage[k] < 100 && this.rand() < f * step * 1.2) {
          this.hit(d, k, (35 + this.rand() * 60) * f * (d.warned ? 0.75 : 1));
          hitSomething = true;
        }
      }
      if (hitSomething) { this.sim.events.emit('treesChanged', undefined); this.sim.afterDisasterHit(); }
    }
  }

  private end(d: DisasterRecord): void {
    if (d.status === 'over') return;
    d.status = 'over';
    // Aide régionale pour les catastrophes importantes
    if (d.destroyed >= 3 || d.cost > 20000) {
      d.aid = Math.round(d.cost * 0.35);
      if (Number.isFinite(this.sim.money)) { this.sim.money += d.aid; this.sim.events.emit('moneyChanged', this.sim.money); }
    }
    this.sim.events.emit('disaster', { id: d.id, phase: 'end' });
  }

  /** Zone protégée par une digue ? (pour la carte des risques) */
  /** Positions des digues (à calculer une fois avant de tester beaucoup de cases). */
  levees(): number[] {
    const out: number[] = [];
    this.sim.world.service.forEach((s, k) => { if (s === Service.Levee) out.push(k); });
    return out;
  }

  floodRisk(k: number, levees = this.levees()): 0 | 1 | 2 {
    const w = this.sim.world, n = w.size;
    const i = k % n, j = (k - i) / n;
    if (w.isWater(i, j) || w.tileMinMax(i, j)[0] > 0.9) return 0;
    let near = false;
    for (let b = j - 4; b <= j + 4 && !near; b++) for (let a = i - 4; a <= i + 4; a++) if (w.inBounds(a, b) && w.isWater(a, b)) { near = true; break; }
    if (!near) return 0;
    for (const s of levees) if (Math.hypot((s % n) - i, Math.floor(s / n) - j) <= 6) return 2;
    return 1;
  }

  coverageWarning(): boolean {
    return (this.sim.utilities.stats.coverage[Coverage.Fire] ?? 0) < 0.5;
  }
}
