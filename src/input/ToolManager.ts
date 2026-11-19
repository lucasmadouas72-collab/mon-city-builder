import * as THREE from 'three';
import type { SceneRenderer } from '../render/SceneRenderer';
import { OverlayColor } from '../render/Overlay';
import type { Simulation } from '../sim/Simulation';
import type { CameraController } from './CameraController';
import { Zone, ZONE_INFO, type ZoneType } from '../sim/zones';

export type ToolId = 'select' | 'road' | 'zoneR' | 'zoneC' | 'zoneI' | 'zoneO' | 'dezone' | 'bulldoze';

/** Zone appliquée par chaque outil de zonage. */
export const TOOL_ZONE: Partial<Record<ToolId, Zone>> = {
  zoneR: Zone.Residential, zoneC: Zone.Commercial, zoneI: Zone.Industrial, zoneO: Zone.Office, dezone: Zone.None,
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
        else this.setTool('select');
      }
    });
    sim.events.on('roadsChanged', () => this.refresh());
    sim.events.on('moneyChanged', () => this.refresh());
    sim.events.on('zonesChanged', () => this.refresh());
  }

  setTool(tool: ToolId): void {
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
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.tool === 'select') return;
    const h = this.pick(e);
    if (!h) return;
    this.dragStart = h;
    this.refresh();
  }

  private onUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.dragStart) return;
    const tiles = this.currentSelection();
    this.dragStart = null;
    if (tiles) {
      const zone = TOOL_ZONE[this.tool];
      if (this.tool === 'road') this.sim.buildRoads(tiles);
      else if (this.tool === 'bulldoze') this.sim.bulldoze(tiles);
      else if (zone !== undefined) this.sim.applyZone(tiles, zone);
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
    if (this.tool === 'road') {
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
    if (!tiles) {
      ov.clear();
    } else if (this.tool === 'road') {
      const est = this.sim.estimateRoads(tiles);
      const tooExpensive = est.cost > this.sim.money;
      const blocked = est.invalid.length > 0;
      ov.set([[est.valid, tooExpensive || blocked ? OverlayColor.invalid : OverlayColor.valid], [est.invalid, OverlayColor.invalid]]);
      if (blocked && est.reason) {
        this.tip = { text: est.reason, kind: 'bad' };
      } else if (est.valid.length) {
        this.tip = { text: `${est.valid.length} case(s) · ${fmt(est.cost)}`, kind: tooExpensive ? 'bad' : 'ok' };
      }
    } else if (this.tool === 'bulldoze') {
      const est = this.sim.estimateBulldoze(tiles);
      ov.set([[tiles, OverlayColor.demolish]]);
      if (est.tiles.length) {
        const net = est.refund - est.cost;
        this.tip = { text: net >= 0 ? `Démolir · +${fmt(net)}` : `Défricher · ${fmt(-net)}`, kind: 'info' };
      }
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
