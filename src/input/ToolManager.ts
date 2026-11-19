import * as THREE from 'three';
import type { SceneRenderer } from '../render/SceneRenderer';
import { OverlayColor } from '../render/Overlay';
import type { Simulation } from '../sim/Simulation';
import type { CameraController } from './CameraController';
import { Zone, ZONE_INFO, type ZoneType } from '../sim/zones';
import { SERVICE_INFO, Service as Svc, type Service } from '../sim/services';
import { BUS_STOP_COST } from '../sim/economy';
import type { UndoStack } from '../sim/Undo';
import { ROAD_INFO, RoadType } from '../sim/roads';

/** Famille de voie posée par chaque outil de route. */
export const ROAD_TOOL: Partial<Record<string, RoadType>> = {
  road: RoadType.Street, avenue: RoadType.Avenue, highway: RoadType.Highway, pedestrian: RoadType.Pedestrian,
};

export type ToolId = 'select' | 'road' | 'avenue' | 'highway' | 'pedestrian' | 'oneway' | 'lights' | 'zoneR' | 'zoneC' | 'zoneI' | 'zoneO' | 'dezone' | 'bulldoze' | 'busstop' | 'busline' | 'metroline' | 'tUp' | 'tDown' | 'tSmooth' | 'tFlat' | 'tTrees' | `svc${number}`;

const TERRAIN_MODE = { tUp: 'up', tDown: 'down', tSmooth: 'smooth', tFlat: 'flat', tTrees: 'trees' } as const;

/** Équipement placé par un outil `svcN`, ou null. */
export const toolService = (t: ToolId): Service | null => (t.startsWith('svc') ? (Number(t.slice(3)) as Service) : null);

/** Zone appliquée par chaque outil de zonage. */
export const TOOL_ZONE: Partial<Record<ToolId, Zone>> = {
  zoneR: Zone.Residential, zoneC: Zone.Commercial, zoneI: Zone.Industrial, zoneO: Zone.Office, dezone: Zone.None,
};
const svcColors = new Map<string, THREE.Color>();
const serviceColor = (hex: string) => {
  let c = svcColors.get(hex);
  if (!c) { c = new THREE.Color(hex).multiplyScalar(0.7); svcColors.set(hex, c); }
  return c;
};
const zoneColors = new Map<Zone, THREE.Color>();
const zoneColor = (z: Zone) => {
  let c = zoneColors.get(z);
  if (!c) zoneColors.set(z, (c = z === Zone.None ? OverlayColor.demolish.clone() : new THREE.Color(ZONE_INFO[z as ZoneType].color)));
  return c;
};

export interface HoverInfo {
  i: number;
  j: number;
}

export interface Tooltip {
  text: string;
  kind: 'ok' | 'bad' | 'info';
  x: number;
  y: number;
}

/** Gère l'outil actif, le survol des cases et les actions de construction à la souris. */
export class ToolManager {
  tool: ToolId = 'select';
  onToolChange?: (tool: ToolId) => void;
  onHover?: (info: HoverInfo | null) => void;
  onTooltip?: (tip: Tooltip | null) => void;
  /** Aperçu de la ligne de transport en cours de tracé. */
  onDraft?: (kind: 'bus' | 'metro' | null, tiles: number[]) => void;
  private draft: number[] = [];
  /** Pile d'annulation (fournie par le jeu). */
  undo?: UndoStack;
  /** Rayon du pinceau de terrain (en cases). */
  brush = 3;
  private stroke: { end: () => void; flat: number; last: number } | null = null;
  private hitPoint = new THREE.Vector3();

  private get terrainMode() {
    return (TERRAIN_MODE as Record<string, 'up' | 'down' | 'smooth' | 'flat' | 'trees'>)[this.tool] ?? null;
  }

  private act<T>(fn: () => T): T {
    return this.undo ? this.undo.record(fn) : fn();
  }

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hover: HoverInfo | null = null;
  private dragStart: HoverInfo | null = null;
  private pointer = { x: 0, y: 0 };

  constructor(
    private sim: Simulation,
    private view: SceneRenderer,
    private cam: CameraController,
    private dom: HTMLElement,
  ) {
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('pointerleave', () => { if (!this.dragStart) this.setHover(null); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.dragStart) this.cancelDrag();
        else if (this.draft.length) { this.draft = []; this.refresh(); }
        else this.setTool('select');
      }
      if (e.code === 'Enter' && this.draft.length >= 2) this.finishLine();
      if (this.terrainMode && (e.code === 'BracketLeft' || e.code === 'Minus' || e.code === 'NumpadSubtract')) { this.brush = Math.max(1, this.brush - 1); this.refresh(); }
      if (this.terrainMode && (e.code === 'BracketRight' || e.code === 'Equal' || e.code === 'NumpadAdd')) { this.brush = Math.min(8, this.brush + 1); this.refresh(); }
    });
    sim.events.on('roadsChanged', () => this.refresh());
    sim.events.on('moneyChanged', () => this.refresh());
    sim.events.on('zonesChanged', () => this.refresh());
    sim.events.on('servicesChanged', () => this.refresh());
    sim.events.on('transitChanged', () => this.refresh());
  }

  private get lineKind(): 'bus' | 'metro' | null {
    return this.tool === 'busline' ? 'bus' : this.tool === 'metroline' ? 'metro' : null;
  }

  private isStop(idx: number): boolean {
    const w = this.sim.world;
    return this.lineKind === 'bus' ? w.busStop[idx] === 1 : w.service[idx] === Svc.MetroStation;
  }

  private finishLine(): void {
    const kind = this.lineKind;
    if (kind && this.draft.length >= 2) { const stops = [...this.draft]; this.act(() => this.sim.createLine(kind, stops)); }
    this.draft = [];
    this.refresh();
  }

  private lineClick(idx: number): void {
    if (!this.isStop(idx)) {
      this.sim.events.emit('notify', { text: this.lineKind === 'bus' ? 'Cliquez sur un arrêt de bus' : 'Cliquez sur une station de métro', kind: 'warn' });
      return;
    }
    if (this.draft.length >= 2 && idx === this.draft[0]) { this.finishLine(); return; }
    if (this.draft[this.draft.length - 1] !== idx) this.draft.push(idx);
    this.refresh();
  }

  setTool(tool: ToolId): void {
    this.draft = [];
    this.tool = tool;
    this.cancelDrag();
    this.cam.setLeftPan(tool === 'select');
    this.dom.style.cursor = tool === 'select' ? 'grab' : 'crosshair';
    this.onToolChange?.(tool);
    this.refresh();
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.refresh();
  }

  private pick(e: PointerEvent): HoverInfo | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.view.camera);
    const hit = this.raycaster.intersectObject(this.view.terrain, false)[0];
    if (!hit) return null;
    this.hitPoint.copy(hit.point);
    const w = this.sim.world;
    const i = Math.floor(hit.point.x), j = Math.floor(hit.point.z);
    return w.inBounds(i, j) ? { i, j } : null;
  }

  private setHover(h: HoverInfo | null): void {
    const changed = h?.i !== this.hover?.i || h?.j !== this.hover?.j;
    this.hover = h;
    if (changed) {
      this.onHover?.(h);
      this.refresh();
    }
  }

  private onMove(e: PointerEvent): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    if (e.buttons & 6) return; // rotation / déplacement caméra en cours
    this.setHover(this.pick(e));
    this.updateTooltipPosition();
    if (this.stroke) this.paint(performance.now());
  }

  private paint(now: number): void {
    const mode = this.terrainMode;
    if (!mode || !this.stroke || now - this.stroke.last < 60) return;
    this.stroke.last = now;
    this.sim.terraform(this.hitPoint.x, this.hitPoint.z, mode, this.brush, this.stroke.flat);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.tool === 'select') return;
    const h = this.pick(e);
    if (!h) return;
    if (this.terrainMode) {
      this.stroke = {
        end: this.undo ? this.undo.begin() : () => {},
        flat: this.sim.world.heightAt(this.hitPoint.x, this.hitPoint.z),
        last: 0,
      };
      this.paint(performance.now());
      this.holdTimer = window.setInterval(() => this.paint(performance.now()), 70);
      return;
    }
    this.dragStart = h;
    this.refresh();
  }

  private holdTimer = 0;

  private onUp(e: PointerEvent): void {
    if (e.button === 0 && this.stroke) {
      clearInterval(this.holdTimer);
      this.stroke.end();
      this.stroke = null;
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const tiles = this.currentSelection();
    this.dragStart = null;
    if (tiles && this.lineKind) {
      this.lineClick(tiles[0]);
    } else if (tiles && this.tool === 'busstop') {
      this.act(() => this.sim.placeBusStop(tiles[0]));
    } else if (tiles) {
      const zone = TOOL_ZONE[this.tool];
      this.act(() => {
        if (ROAD_TOOL[this.tool]) this.sim.buildRoads(tiles, ROAD_TOOL[this.tool]);
        else if (this.tool === 'oneway') this.sim.setOneway(tiles);
        else if (this.tool === 'lights') this.sim.toggleLights(tiles[tiles.length - 1]);
        else if (this.tool === 'bulldoze') this.sim.bulldoze(tiles);
        else if (zone !== undefined) this.sim.applyZone(tiles, zone);
        else if (toolService(this.tool)) this.sim.placeService(tiles[0], toolService(this.tool)!);
      });
    }
    this.refresh();
  }

  /** Cases concernées par l'action en cours (glisser) ou par le survol. */
  private currentSelection(): number[] | null {
    const end = this.hover;
    const start = this.dragStart ?? end;
    if (!start || !end) return null;
    const w = this.sim.world;
    const out: number[] = [];
    if (ROAD_TOOL[this.tool] || this.tool === 'oneway') {
      // Tracé en L : d'abord l'axe dominant
      const dx = end.i - start.i, dz = end.j - start.j;
      const sx = Math.sign(dx), sz = Math.sign(dz);
      let i = start.i, j = start.j;
      out.push(w.index(i, j));
      const stepX = () => { while (i !== end.i) { i += sx; out.push(w.index(i, j)); } };
      const stepZ = () => { while (j !== end.j) { j += sz; out.push(w.index(i, j)); } };
      if (Math.abs(dx) >= Math.abs(dz)) { stepX(); stepZ(); } else { stepZ(); stepX(); }
    } else if (this.tool === 'bulldoze' || TOOL_ZONE[this.tool] !== undefined) {
      const [i0, i1] = [Math.min(start.i, end.i), Math.max(start.i, end.i)];
      const [j0, j1] = [Math.min(start.j, end.j), Math.max(start.j, end.j)];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(w.index(i, j));
    } else {
      out.push(w.index(end.i, end.j));
    }
    return out;
  }

  private tip: Omit<Tooltip, 'x' | 'y'> | null = null;

  private updateTooltipPosition(): void {
    this.onTooltip?.(this.tip ? { ...this.tip, x: this.pointer.x, y: this.pointer.y } : null);
  }

  /** Met à jour la surbrillance et l'infobulle selon l'outil et la sélection. */
  refresh(): void {
    const ov = this.view.overlay;
    const tiles = this.currentSelection();
    this.tip = null;
    if (!this.lineKind) this.onDraft?.(null, []);
    if (!tiles) {
      ov.clear();
    } else if (this.tool === 'oneway') {
      const roads = tiles.filter((t) => this.sim.world.tiles[t] === 1);
      ov.set([[roads, OverlayColor.valid], [tiles.filter((t) => this.sim.world.tiles[t] !== 1), OverlayColor.invalid]]);
      this.tip = { text: tiles.length < 2 ? 'Glissez le long d\'une route dans le sens voulu (refaire = double sens)' : `Sens unique sur ${roads.length} case(s)`, kind: 'info' };
    } else if (this.tool === 'lights') {
      const w = this.sim.world, t = tiles[tiles.length - 1];
      const ok = w.tiles[t] === 1 && w.roadMask(t % w.size, Math.floor(t / w.size)).toString(2).split('1').length - 1 >= 3;
      ov.set([[[t], ok ? OverlayColor.valid : OverlayColor.invalid]]);
      const on = w.lights[t] === 1 || w.lights[t] === 2;
      this.tip = ok ? { text: on ? 'Cliquez pour retirer les feux' : 'Cliquez pour installer des feux', kind: 'ok' } : { text: 'Choisissez un carrefour', kind: 'bad' };
    } else if (ROAD_TOOL[this.tool]) {
      const type = ROAD_TOOL[this.tool]!;
      const est = this.sim.estimateRoads(tiles, type);
      const tooExpensive = est.cost > this.sim.money;
      const blocked = est.invalid.length > 0;
      ov.set([[est.valid, tooExpensive || blocked ? OverlayColor.invalid : OverlayColor.valid], [est.invalid, OverlayColor.invalid]]);
      if (blocked && est.reason) {
        this.tip = { text: est.reason, kind: 'bad' };
      } else if (est.valid.length) {
        const w = this.sim.world;
        const bridges = est.valid.filter((t) => w.isWater(t % w.size, Math.floor(t / w.size))).length;
        const upgrades = est.valid.filter((t) => w.tiles[t] === 1).length;
        const extra = [bridges ? `${bridges} de pont` : '', upgrades ? `${upgrades} remplacée(s)` : ''].filter(Boolean).join(', ');
        this.tip = { text: `${ROAD_INFO[type].name} · ${est.valid.length} case(s)${extra ? ` (${extra})` : ''} · ${fmt(est.cost)}`, kind: tooExpensive ? 'bad' : 'ok' };
      }
    } else if (this.tool === 'bulldoze') {
      const est = this.sim.estimateBulldoze(tiles);
      ov.set([[tiles, OverlayColor.demolish]]);
      if (est.tiles.length) {
        const net = est.refund - est.cost;
        this.tip = { text: net >= 0 ? `Démolir · +${fmt(net)}` : `Défricher · ${fmt(-net)}`, kind: 'info' };
      }
    } else if (this.terrainMode) {
      const w = this.sim.world;
      const end = tiles[tiles.length - 1];
      const ci = end % w.size, cj = Math.floor(end / w.size);
      const area: number[] = [];
      for (let b = cj - this.brush; b <= cj + this.brush; b++) for (let a = ci - this.brush; a <= ci + this.brush; a++) {
        if (w.inBounds(a, b) && Math.hypot(a - ci, b - cj) <= this.brush) area.push(w.index(a, b));
      }
      ov.set([[area, this.terrainMode === 'trees' ? OverlayColor.valid : OverlayColor.hover]]);
      const labels = { up: 'Élever', down: 'Abaisser', smooth: 'Lisser', flat: 'Aplanir', trees: 'Planter des arbres' };
      this.tip = { text: `${labels[this.terrainMode]} · rayon ${this.brush} (touches - et +)`, kind: 'info' };
    } else if (this.tool === 'busstop') {
      const w = this.sim.world;
      const idx = tiles[0];
      const ok = this.sim.busUnlocked && w.tiles[idx] === 1 && !w.busStop[idx];
      ov.set([[[idx], ok ? OverlayColor.valid : OverlayColor.invalid]]);
      this.tip = !this.sim.busUnlocked ? { text: 'Bus débloqués à 1 200 habitants', kind: 'bad' }
        : w.busStop[idx] ? { text: 'Arrêt déjà présent', kind: 'bad' }
        : ok ? { text: `Arrêt de bus · ${fmt(BUS_STOP_COST)}`, kind: 'ok' } : { text: 'Un arrêt se place sur une route', kind: 'bad' };
    } else if (this.lineKind) {
      const kind = this.lineKind;
      const idx = tiles[0];
      const hoverStop = this.isStop(idx);
      const seq = hoverStop && this.draft[this.draft.length - 1] !== idx ? [...this.draft, idx] : [...this.draft];
      let preview: number[] = seq;
      if (kind === 'bus' && seq.length >= 2) preview = this.sim.transit.routeFor(seq, false) ?? [];
      this.onDraft?.(kind, preview);
      ov.set([[this.draft, OverlayColor.valid], [[idx], hoverStop ? OverlayColor.hover : OverlayColor.invalid]]);
      const unlocked = kind === 'bus' ? this.sim.busUnlocked : this.sim.isServiceUnlocked(Svc.MetroStation);
      const what = kind === 'bus' ? 'arrêt' : 'station';
      this.tip = !unlocked ? { text: kind === 'bus' ? 'Bus débloqués à 1 200 habitants' : 'Métro débloqué à 3 000 habitants', kind: 'bad' }
        : kind === 'bus' && seq.length >= 2 && !preview.length ? { text: 'Arrêts non reliés par la route', kind: 'bad' }
        : this.draft.length === 0 ? { text: `Cliquez sur le premier ${what}`, kind: 'info' }
        : this.draft.length >= 2 && idx === this.draft[0] ? { text: 'Cliquez pour fermer la ligne', kind: 'ok' }
        : { text: `${this.draft.length} ${what}(s) · Entrée pour terminer, Échap pour annuler`, kind: 'info' };
    } else if (toolService(this.tool)) {
      const type = toolService(this.tool)!;
      const info = SERVICE_INFO[type as Exclude<Service, 0>];
      const idx = tiles[0];
      const est = this.sim.estimateService(idx, type);
      const layers: Array<[number[], THREE.Color]> = [];
      if (info.radius) {
        const w = this.sim.world;
        const i = idx % w.size, j = Math.floor(idx / w.size), r = info.radius;
        const ring: number[] = [];
        for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) {
          if (w.inBounds(a, b) && (a - i) ** 2 + (b - j) ** 2 <= r * r && (a !== i || b !== j)) ring.push(w.index(a, b));
        }
        layers.push([ring, serviceColor(info.color)]);
      }
      layers.push([[idx], est.ok ? OverlayColor.valid : OverlayColor.invalid]);
      ov.set(layers);
      this.tip = est.ok
        ? { text: `${info.name} · ${fmt(info.cost)} · ${fmt(info.upkeep)}/mois`, kind: 'ok' }
        : { text: est.reason ?? '', kind: 'bad' };
    } else if (TOOL_ZONE[this.tool] !== undefined) {
      const zone = TOOL_ZONE[this.tool]!;
      const est = this.sim.estimateZone(tiles, zone);
      ov.set([[est.valid, zoneColor(zone)], [est.invalid, OverlayColor.invalid]]);
      if (est.valid.length) {
        const label = zone === Zone.None ? 'Dézoner' : ZONE_INFO[zone as ZoneType].name;
        this.tip = { text: `${label} · ${est.valid.length} case(s)`, kind: 'ok' };
      } else if (est.reason) {
        this.tip = { text: est.reason, kind: 'bad' };
      }
    } else {
      ov.set([[tiles, OverlayColor.hover]]);
    }
    this.updateTooltipPosition();
  }
}

export const fmt = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`;
