import { rng } from '../core/noise';
import type { Traffic, Vehicle } from './Traffic';
import { VehicleKind } from './Traffic';
import type { World } from './World';
import { Service } from './services';
import { FACILITY_VEHICLES } from './ServiceReach';

/** Interventions d'urgence : incendies, urgences médicales, délits. */

export type IncidentType = 'fire' | 'medical' | 'crime';
export const INCIDENT_NAMES: Record<IncidentType, string> = { fire: 'Incendie', medical: 'Urgence médicale', crime: 'Délit' };

const STATION: Record<IncidentType, Service> = { fire: Service.FireStation, medical: Service.Clinic, crime: Service.Police };
const KIND: Record<IncidentType, VehicleKind> = { fire: VehicleKind.FireTruck, medical: VehicleKind.Ambulance, crime: VehicleKind.Police };
/** Délai (secondes simulées, même échelle que les trajets) au-delà duquel l'intervention est ratée. */
const TIMEOUT: Record<IncidentType, number> = { fire: 9999, medical: 35, crime: 40 };

export interface Incident {
  id: number;
  type: IncidentType;
  tile: number;
  /** Instant de l'appel (secondes simulées) et jour de calendrier. */
  at: number;
  day: number;
  status: 'waiting' | 'dispatched' | 'resolved' | 'failed';
  station: number;
}

export interface EmergencyStats {
  /** Temps moyen d'intervention (minutes affichées) par type, sur les 20 dernières. */
  response: Record<IncidentType, number>;
  resolved: Record<IncidentType, number>;
  failed: Record<IncidentType, number>;
  active: number;
}

export class Emergency {
  incidents: Incident[] = [];
  private nextId = 1;
  private clock = 0;
  private inUse = new Map<number, number>();
  private times: Record<IncidentType, number[]> = { fire: [], medical: [], crime: [] };
  private rand = rng(555);
  resolved: Record<IncidentType, number> = { fire: 0, medical: 0, crime: 0 };
  failed: Record<IncidentType, number> = { fire: 0, medical: 0, crime: 0 };
  /** Appelé quand les pompiers arrivent sur un incendie. */
  onFireReached?: (tile: number) => void;
  /** Facteur de budget par type de service (nombre de véhicules). */
  budget: (s: Service) => number = () => 1;

  constructor(private world: World, private traffic: Traffic) {
    traffic.onMission = (v) => this.onArrive(v);
  }

  update(dt: number): void {
    this.clock += dt;
  }

  /** Véhicules disponibles dans un établissement. */
  available(station: number): number {
    const type = this.world.service[station] as Service;
    const total = Math.max(1, Math.round((FACILITY_VEHICLES[type] ?? 0) * this.budget(type)));
    return total - (this.inUse.get(station) ?? 0);
  }

  inService(station: number): number {
    return this.inUse.get(station) ?? 0;
  }

  report(type: IncidentType, tile: number, day: number): Incident {
    const inc: Incident = { id: this.nextId++, type, tile, at: this.clock, day, status: 'waiting', station: -1 };
    this.incidents.push(inc);
    this.dispatch(inc);
    return inc;
  }

  private dispatch(inc: Incident): boolean {
    const w = this.world, n = w.size;
    const target = this.traffic.roadAccess(inc.tile);
    if (target < 0) return false;
    const ti = inc.tile % n, tj = Math.floor(inc.tile / n);
    const candidates: Array<[number, number]> = [];
    for (let s = 0; s < w.service.length; s++) {
      if (w.service[s] !== STATION[inc.type] || this.available(s) <= 0) continue;
      candidates.push([s, Math.hypot((s % n) - ti, Math.floor(s / n) - tj)]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    let best: number[] | null = null, station = -1;
    for (const [s] of candidates.slice(0, 3)) {
      const from = this.traffic.roadAccess(s);
      if (from < 0) continue;
      const path = from === target ? [from, target] : this.traffic.findPath(from, target);
      if (path && (!best || path.length < best.length)) { best = path; station = s; }
    }
    if (!best) return false;
    if (best[0] === best[1]) best = [best[0]];
    this.inUse.set(station, (this.inUse.get(station) ?? 0) + 1);
    inc.station = station;
    inc.status = 'dispatched';
    if (best.length < 2) { this.resolve(inc); this.release(station); return true; }
    this.traffic.addMissionVehicle(best, KIND[inc.type], inc.id);
    return true;
  }

  private release(station: number): void {
    this.inUse.set(station, Math.max(0, (this.inUse.get(station) ?? 1) - 1));
  }

  private resolve(inc: Incident): void {
    inc.status = 'resolved';
    this.resolved[inc.type]++;
    const t = this.times[inc.type];
    t.push(this.clock - inc.at);
    if (t.length > 20) t.shift();
    if (inc.type === 'fire') this.onFireReached?.(inc.tile);
  }

  private onArrive(v: Vehicle): void {
    const arrived = v.seg >= v.path.length - 1;
    if (v.mission < 0) { this.release(-v.mission - 1); return; }
    const inc = this.incidents.find((i) => i.id === v.mission);
    if (!inc) return;
    if (!arrived) {
      // Route coupée : le véhicule rentre et l'incident sera repris
      this.release(inc.station);
      inc.status = 'waiting';
      return;
    }
    if (inc.status === 'dispatched') this.resolve(inc);
    // Retour à la base
    const home = this.traffic.roadAccess(inc.station);
    const back = home >= 0 ? this.traffic.findPath(v.path[v.path.length - 1], home) : null;
    if (back && back.length > 1) this.traffic.addMissionVehicle(back, v.kind, -(inc.station + 1));
    else this.release(inc.station);
  }

  /** Une fois par jour : relance des appels en attente, abandon des interventions trop tardives. */
  daily(day: number): void {
    for (const inc of this.incidents) {
      if (inc.status === 'waiting') this.dispatch(inc);
      if ((inc.status === 'waiting' || inc.status === 'dispatched') && this.clock - inc.at > TIMEOUT[inc.type]) {
        inc.status = 'failed';
        this.failed[inc.type]++;
      }
    }
    this.incidents = this.incidents.filter((i) => i.status === 'waiting' || i.status === 'dispatched' || day - i.day < 30);
  }

  /** L'incendie s'est éteint de lui-même ou le bâtiment a brûlé. */
  closeFire(tile: number, burnt: boolean): void {
    for (const inc of this.incidents) {
      if (inc.type !== 'fire' || inc.tile !== tile || (inc.status !== 'waiting' && inc.status !== 'dispatched')) continue;
      inc.status = burnt ? 'failed' : 'resolved';
      if (burnt) this.failed.fire++;
    }
  }

  random(): number {
    return this.rand();
  }

  get stats(): EmergencyStats {
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 2) : 0);
    return {
      response: { fire: avg(this.times.fire), medical: avg(this.times.medical), crime: avg(this.times.crime) },
      resolved: { ...this.resolved },
      failed: { ...this.failed },
      active: this.incidents.filter((i) => i.status === 'waiting' || i.status === 'dispatched').length,
    };
  }
}
