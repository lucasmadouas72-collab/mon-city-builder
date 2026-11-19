import { GAME_NAME } from '../config';
import { fmt, type HoverInfo, type ToolId, type ToolManager, type Tooltip } from '../input/ToolManager';
import type { CityStats, Simulation } from '../sim/Simulation';
import { BuildState, LEVEL_NAMES, Zone, ZONE_INFO, ZONES, type ZoneType } from '../sim/zones';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  road: '<path d="M7 21L10 3M17 21L14 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
  bulldoze: '<path d="M3 17h11v-5H8l-2 5"/><circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><path d="M14 13l4-4 3 3-4 4z"/>',
  zone: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16" opacity=".5"/>',
  dezone: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><path d="M9 9l6 6M15 9l-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play1: '<path d="M8 5l11 7-11 7z"/>',
  play2: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/>',
  play3: '<path d="M2 5l6 7-6 7zM9 5l6 7-6 7zM16 5l6 7-6 7z"/>',
};

const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const TOOLS: Array<{ id: ToolId; label: string; key: string; icon: string; zone?: ZoneType; sep?: boolean }> = [
  { id: 'select', label: 'Sélection', key: '1', icon: 'select' },
  { id: 'road', label: 'Route', key: '2', icon: 'road', sep: true },
  { id: 'zoneR', label: 'Résidentiel', key: '3', icon: 'zone', zone: Zone.Residential },
  { id: 'zoneC', label: 'Commercial', key: '4', icon: 'zone', zone: Zone.Commercial },
  { id: 'zoneI', label: 'Industriel', key: '5', icon: 'zone', zone: Zone.Industrial },
  { id: 'zoneO', label: 'Bureaux', key: '6', icon: 'zone', zone: Zone.Office },
  { id: 'dezone', label: 'Dézoner', key: '7', icon: 'dezone', sep: true },
  { id: 'bulldoze', label: 'Démolir', key: '8', icon: 'bulldoze' },
];

/** Interface en surimpression (HTML) : barre d'état, outils, infos de case, notifications. */
export class Hud {
  private el = (sel: string) => this.root.querySelector(sel) as HTMLElement;

  constructor(private root: HTMLElement, private sim: Simulation, tools: ToolManager) {
    root.innerHTML = `
      <header class="topbar panel">
        <div class="brand"><span class="logo"></span>${GAME_NAME}</div>
        <div class="stat"><span class="label">Budget</span><span class="value" id="money"></span></div>
        <div class="stat"><span class="label">Solde / mois</span><span class="value" id="balance"></span></div>
        <div class="stat"><span class="label">Population</span><span class="value" id="pop">0</span></div>
        <div class="stat"><span class="label">Emplois</span><span class="value" id="jobs">0</span></div>
        <div class="demand" id="demand" title="Demande de la ville par type de zone">
          ${ZONES.map((z) => `<div class="bar" data-zone="${z}" style="--c:${ZONE_INFO[z].color}"><div class="track"><i></i></div><span>${ZONE_INFO[z].short}</span></div>`).join('')}
        </div>
        <div class="spacer"></div>
        <div class="date" id="date"></div>
        <div class="speeds" id="speeds">
          ${['pause', 'play1', 'play2', 'play3'].map((n, k) => `<button data-speed="${k}" title="${k === 0 ? 'Pause (Espace)' : `Vitesse ${k}`}">${icon(n)}</button>`).join('')}
        </div>
      </header>
      <nav class="toolbar panel" id="toolbar">
        ${TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.label} (${t.key})" class="${t.sep ? 'sep' : ''}" ${t.zone ? `style="--zc:${ZONE_INFO[t.zone].color}"` : ''}>${icon(t.icon)}<span>${t.label}</span><kbd>${t.key}</kbd></button>`).join('')}
      </nav>
      <aside class="info panel" id="info" hidden></aside>
      <div class="tooltip" id="tooltip" hidden></div>
      <div class="toasts" id="toasts"></div>
      <div class="help panel" id="help">
        <b>Commandes</b>
        <div><kbd>Clic droit</kbd> tourner · <kbd>Molette</kbd> zoom · <kbd>Clic molette</kbd> déplacer</div>
        <div><kbd>Z Q S D</kbd> / flèches déplacer · <kbd>A</kbd> <kbd>E</kbd> tourner · <kbd>Échap</kbd> annuler</div>
        <div>Tracez des routes, puis zonez le long des routes : les bâtiments poussent selon la demande (jauges R C I B).</div>
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
    sim.events.on('statsChanged', (st) => this.updateStats(st));
    sim.events.on('notify', (n) => this.toast(n.text, n.kind ?? 'info'));
    tools.onToolChange = (t) => this.updateTool(t);
    tools.onHover = (h) => this.updateInfo(h);
    tools.onTooltip = (t) => this.updateTooltip(t);

    this.updateMoney();
    this.updateStats(sim.stats);
    this.updateDate();
    this.updateSpeed();
    this.updateTool(tools.tool);
  }

  private updateMoney(): void {
    const m = this.el('#money');
    m.textContent = fmt(this.sim.money);
    m.classList.toggle('negative', this.sim.money < 0);
  }

  private updateStats(st: CityStats): void {
    const n = (v: number) => v.toLocaleString('fr-FR');
    this.el('#pop').textContent = n(st.population);
    this.el('#jobs').textContent = n(st.totalJobs);
    const bal = st.income - st.expenses;
    const b = this.el('#balance');
    b.textContent = (bal >= 0 ? '+' : '') + fmt(bal);
    b.classList.toggle('negative', bal < 0);
    b.classList.toggle('positive', bal > 0);
    this.root.querySelectorAll<HTMLElement>('#demand .bar').forEach((bar) => {
      const z = Number(bar.dataset.zone) as ZoneType;
      const d = st.demand[z];
      const fill = bar.querySelector('i') as HTMLElement;
      fill.style.height = `${Math.abs(d) * 50}%`;
      fill.style.bottom = d >= 0 ? '50%' : `${50 - Math.abs(d) * 50}%`;
      fill.classList.toggle('neg', d < 0);
      bar.classList.toggle('locked', !this.sim.isUnlocked(z));
    });
    this.root.querySelectorAll<HTMLElement>('#toolbar button').forEach((btn) => {
      const t = TOOLS.find((t) => t.id === btn.dataset.tool);
      if (t?.zone) {
        const locked = !this.sim.isUnlocked(t.zone);
        btn.classList.toggle('locked', locked);
        btn.title = locked ? `${t.label} : débloqué à ${ZONE_INFO[t.zone].unlockPop} habitants` : `${t.label} (${t.key})`;
      }
    });
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
    const zone = w.zones[idx] as ZoneType | 0;
    const state = w.bState[idx];
    let kind = w.isRoad(h.i, h.j) ? 'Route' : w.terrainLabel(h.i, h.j);
    let extra = '';
    if (zone) {
      const info = ZONE_INFO[zone];
      kind = `<span class="dot" style="background:${info.color}"></span>${info.name}`;
      if (state === BuildState.Construction) extra = `<dt>État</dt><dd>Chantier (${w.bTimer[idx]} j)</dd>`;
      else if (state === BuildState.Built) {
        const cap = this.sim.capacity(idx);
        extra = `<dt>Bâtiment</dt><dd>${LEVEL_NAMES[w.bLevel[idx]]}</dd>
          <dt>${zone === Zone.Residential ? 'Habitants' : 'Emplois'}</dt><dd>${cap}</dd>`;
      } else extra = `<dt>État</dt><dd>${w.roadDist[idx] <= 3 ? 'Terrain libre' : 'Sans accès routier'}</dd>`;
      extra += `<dt>Valeur foncière</dt><dd>${Math.round(this.sim.landValue(idx) * 100)} %</dd>`;
    }
    box.hidden = false;
    box.innerHTML = `
      <div class="info-title">${kind}</div>
      <dl>${extra}
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
