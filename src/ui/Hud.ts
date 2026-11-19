import { GAME_NAME } from '../config';
import { fmt, type HoverInfo, type ToolId, type ToolManager, type Tooltip } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  road: '<path d="M7 21L10 3M17 21L14 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
  bulldoze: '<path d="M3 17h11v-5H8l-2 5"/><circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><path d="M14 13l4-4 3 3-4 4z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play1: '<path d="M8 5l11 7-11 7z"/>',
  play2: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/>',
  play3: '<path d="M2 5l6 7-6 7zM9 5l6 7-6 7zM16 5l6 7-6 7z"/>',
};

const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const TOOLS: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'select', label: 'Sélection', key: '1' },
  { id: 'road', label: 'Route', key: '2' },
  { id: 'bulldoze', label: 'Démolir', key: '3' },
];

/** Interface en surimpression (HTML) : barre d'état, outils, infos de case, notifications. */
export class Hud {
  private el = (sel: string) => this.root.querySelector(sel) as HTMLElement;

  constructor(private root: HTMLElement, private sim: Simulation, tools: ToolManager) {
    root.innerHTML = `
      <header class="topbar panel">
        <div class="brand"><span class="logo"></span>${GAME_NAME}</div>
        <div class="stat"><span class="label">Budget</span><span class="value" id="money"></span></div>
        <div class="stat"><span class="label">Population</span><span class="value">0</span></div>
        <div class="stat"><span class="label">Routes</span><span class="value" id="roads">0</span></div>
        <div class="spacer"></div>
        <div class="date" id="date"></div>
        <div class="speeds" id="speeds">
          ${['pause', 'play1', 'play2', 'play3'].map((n, k) => `<button data-speed="${k}" title="${k === 0 ? 'Pause (Espace)' : `Vitesse ${k}`}">${icon(n)}</button>`).join('')}
        </div>
      </header>
      <nav class="toolbar panel" id="toolbar">
        ${TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.label} (${t.key})">${icon(t.id)}<span>${t.label}</span><kbd>${t.key}</kbd></button>`).join('')}
      </nav>
      <aside class="info panel" id="info" hidden></aside>
      <div class="tooltip" id="tooltip" hidden></div>
      <div class="toasts" id="toasts"></div>
      <div class="help panel" id="help">
        <b>Commandes</b>
        <div><kbd>Clic droit</kbd> tourner · <kbd>Molette</kbd> zoom · <kbd>Clic molette</kbd> déplacer</div>
        <div><kbd>Z Q S D</kbd> / flèches déplacer · <kbd>A</kbd> <kbd>E</kbd> tourner · <kbd>Échap</kbd> annuler</div>
        <div>Route : cliquez-glissez pour tracer · Démolir : cliquez-glissez une zone</div>
        <button id="help-close" aria-label="Fermer">×</button>
      </div>`;

    this.el('#toolbar').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.tool) tools.setTool(b.dataset.tool as ToolId);
    });
    this.el('#speeds').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.speed) sim.setSpeed(Number(b.dataset.speed));
    });
    this.el('#help-close').addEventListener('click', () => this.el('#help').remove());

    let lastSpeed = 1;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (sim.speedIndex > 0) { lastSpeed = sim.speedIndex; sim.setSpeed(0); } else sim.setSpeed(lastSpeed);
      }
      const t = TOOLS.find((t) => e.code === `Digit${t.key}` || e.code === `Numpad${t.key}`);
      if (t) tools.setTool(t.id);
    });

    sim.events.on('moneyChanged', () => this.updateMoney());
    sim.events.on('dateChanged', () => this.updateDate());
    sim.events.on('speedChanged', () => this.updateSpeed());
    sim.events.on('roadsChanged', () => (this.el('#roads').textContent = sim.roadCount.toLocaleString('fr-FR')));
    sim.events.on('notify', (n) => this.toast(n.text, n.kind ?? 'info'));
    tools.onToolChange = (t) => this.updateTool(t);
    tools.onHover = (h) => this.updateInfo(h);
    tools.onTooltip = (t) => this.updateTooltip(t);

    this.updateMoney();
    this.updateDate();
    this.updateSpeed();
    this.updateTool(tools.tool);
  }

  private updateMoney(): void {
    const m = this.el('#money');
    m.textContent = fmt(this.sim.money);
    m.classList.toggle('negative', this.sim.money < 0);
  }

  private updateDate(): void {
    const d = this.sim.date;
    this.el('#date').textContent = `${d.day} ${MONTHS[d.month]} an ${d.year}`;
  }

  private updateSpeed(): void {
    this.root.querySelectorAll<HTMLElement>('#speeds button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.speed) === this.sim.speedIndex));
  }

  private updateTool(tool: ToolId): void {
    this.root.querySelectorAll<HTMLElement>('#toolbar button').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  private updateInfo(h: HoverInfo | null): void {
    const box = this.el('#info');
    if (!h) { box.hidden = true; return; }
    const w = this.sim.world;
    const idx = w.index(h.i, h.j);
    const [lo, hi] = w.tileMinMax(h.i, h.j);
    const kind = w.isRoad(h.i, h.j) ? 'Route' : w.terrainLabel(h.i, h.j);
    box.hidden = false;
    box.innerHTML = `
      <div class="info-title">${kind}</div>
      <dl>
        <dt>Case</dt><dd>${h.i}, ${h.j}</dd>
        <dt>Altitude</dt><dd>${(((lo + hi) / 2) * 10).toFixed(0)} m</dd>
        <dt>Pente</dt><dd>${((hi - lo) * 10).toFixed(0)} m</dd>
        ${w.trees[idx] ? `<dt>Arbres</dt><dd>${w.trees[idx]}</dd>` : ''}
      </dl>`;
  }

  private updateTooltip(t: Tooltip | null): void {
    const el = this.el('#tooltip');
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = t.text;
    el.className = `tooltip ${t.kind}`;
    el.style.transform = `translate(${t.x + 16}px, ${t.y + 18}px)`;
  }

  toast(text: string, kind: string): void {
    const box = this.el('#toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
}
