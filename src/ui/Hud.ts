import { GAME_NAME } from '../config';
import { BudgetPanel } from './BudgetPanel';
import { BUS_STOP_COST, BUS_UNLOCK, MILESTONES } from '../sim/economy';
import { fmt, type HoverInfo, type ToolId, type ToolManager, type Tooltip } from '../input/ToolManager';
import type { CityStats, Simulation } from '../sim/Simulation';
import { TrafficView } from '../render/TrafficView';
import { VIEW_LABELS, type DataView, type ViewMode } from '../render/DataView';
import { BuildState, LEVEL_NAMES, Zone, ZONE_INFO, ZONES, type ZoneType } from '../sim/zones';
import {
  COVERAGE_NAMES, COVERAGES, SERVICE_INFO, SERVICES, UTILITIES, UTILITY_COLORS, UTILITY_NAMES, UTILITY_SHORT, Utility, type Service,
} from '../sim/services';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  road: '<path d="M7 21L10 3M17 21L14 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
  bulldoze: '<path d="M3 17h11v-5H8l-2 5"/><circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><path d="M14 13l4-4 3 3-4 4z"/>',
  zone: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16" opacity=".5"/>',
  dezone: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><path d="M9 9l6 6M15 9l-6 6"/>',
  utilities: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  transport: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/><circle cx="8.5" cy="14" r="1"/><circle cx="15.5" cy="14" r="1"/><path d="M7 17l-1.5 3M17 17l1.5 3"/>',
  services: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play1: '<path d="M8 5l11 7-11 7z"/>',
  play2: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/>',
  play3: '<path d="M2 5l6 7-6 7zM9 5l6 7-6 7zM16 5l6 7-6 7z"/>',
};

const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

interface ToolDef { id: ToolId; label: string; key?: string; color?: string; zone?: ZoneType; sub?: string; unlock?: number; desc?: string }
type Group = { id: string; label: string; icon: string; key?: string; tools: ToolDef[] };

const ZONE_TOOLS: ToolDef[] = [
  { id: 'zoneR', label: 'Résidentiel', key: '3', zone: Zone.Residential, color: ZONE_INFO[Zone.Residential].color, sub: 'Logements' },
  { id: 'zoneC', label: 'Commercial', key: '4', zone: Zone.Commercial, color: ZONE_INFO[Zone.Commercial].color, sub: 'Boutiques, emplois' },
  { id: 'zoneI', label: 'Industriel', key: '5', zone: Zone.Industrial, color: ZONE_INFO[Zone.Industrial].color, sub: 'Usines, emplois' },
  { id: 'zoneO', label: 'Bureaux', key: '6', zone: Zone.Office, color: ZONE_INFO[Zone.Office].color, sub: 'Emplois qualifiés' },
  { id: 'dezone', label: 'Dézoner', key: '7', color: '#fb923c', sub: 'Retire la zone' },
];
const svcTools = (cat: 'utilities' | 'services' | 'transport'): ToolDef[] =>
  SERVICES.filter((s) => SERVICE_INFO[s].category === cat).map((s) => ({
    id: `svc${s}` as ToolId, label: SERVICE_INFO[s].name, color: SERVICE_INFO[s].color,
    sub: `${fmt(SERVICE_INFO[s].cost)} · ${fmt(SERVICE_INFO[s].upkeep)}/mois`,
    unlock: SERVICE_INFO[s].unlockPop, desc: SERVICE_INFO[s].description,
  }));
const TRANSPORT_TOOLS: ToolDef[] = [
  { id: 'busstop', label: 'Arrêt de bus', color: '#22c55e', sub: `${fmt(BUS_STOP_COST)} · sur une route`, unlock: BUS_UNLOCK, desc: 'Placez des arrêts sur les routes, puis reliez-les par une ligne.' },
  { id: 'busline', label: 'Ligne de bus', color: '#16a34a', sub: `${fmt(60)}/mois par bus`, unlock: BUS_UNLOCK, desc: "Cliquez sur les arrêts dans l'ordre, puis sur le premier pour fermer la boucle." },
  ...svcTools('transport'),
  { id: 'metroline', label: 'Ligne de métro', color: '#c026d3', sub: `${fmt(400)}/mois`, unlock: 3000, desc: "Cliquez sur les stations dans l'ordre, puis sur la première pour fermer la boucle." },
];

const GROUPS: Group[] = [
  { id: 'select', label: 'Sélection', icon: 'select', key: '1', tools: [{ id: 'select', label: 'Sélection' }] },
  { id: 'road', label: 'Route', icon: 'road', key: '2', tools: [{ id: 'road', label: 'Route' }] },
  { id: 'zones', label: 'Zones', icon: 'zone', tools: ZONE_TOOLS },
  { id: 'utilities', label: 'Réseaux', icon: 'utilities', tools: svcTools('utilities') },
  { id: 'services', label: 'Services', icon: 'services', tools: svcTools('services') },
  { id: 'transport', label: 'Transports', icon: 'transport', tools: TRANSPORT_TOOLS },
  { id: 'bulldoze', label: 'Démolir', icon: 'bulldoze', key: '8', tools: [{ id: 'bulldoze', label: 'Démolir' }] },
];

const KEYED: ToolDef[] = [
  { id: 'select', label: '', key: '1' }, { id: 'road', label: '', key: '2' }, ...ZONE_TOOLS, { id: 'bulldoze', label: '', key: '8' },
];

/** Interface en surimpression (HTML) : barre d'état, outils, infos de case, notifications. */
export class Hud {
  private el = (sel: string) => this.root.querySelector(sel) as HTMLElement;
  private openGroup: string | null = null;
  private budget!: BudgetPanel;

  constructor(private root: HTMLElement, private sim: Simulation, private tools: ToolManager, views: DataView) {
    root.innerHTML = `
      <header class="topbar panel">
        <div class="brand"><span class="logo"></span>${GAME_NAME}</div>
        <button class="stat stat-btn" id="budget-btn" title="Ouvrir le budget (B)"><span class="label">Budget</span><span class="value" id="money"></span></button>
        <div class="stat"><span class="label">Solde / mois</span><span class="value" id="balance"></span></div>
        <div class="stat"><span class="label">Population</span><span class="value" id="pop">0</span></div>
        <div class="stat"><span class="label">Emplois</span><span class="value" id="jobs">0</span></div>
        <div class="stat" title="Satisfaction moyenne des habitants"><span class="label">Bonheur</span><span class="value" id="happy">–</span></div>
        <div class="stat" title="Vitesse moyenne des véhicules par rapport à leur vitesse normale"><span class="label">Trafic</span><span class="value" id="flow">–</span></div>
        <div class="demand" id="demand" title="Demande de la ville par type de zone">
          ${ZONES.map((z) => `<div class="bar" data-zone="${z}" style="--c:${ZONE_INFO[z].color}"><div class="track"><i></i></div><span>${ZONE_INFO[z].short}</span></div>`).join('')}
        </div>
        <div class="spacer"></div>
        <div class="milestone" id="milestone" title=""><span class="ms-name"></span><div class="ms-bar"><i></i></div></div>
        <div class="views">
          <button id="views-btn" title="Vues de données (T : trafic)">${icon('layers')}<span id="views-label">Vues</span></button>
          <div class="views-menu panel" id="views-menu" hidden>
            ${VIEW_LABELS.map(([m, l]) => `<button data-view="${m}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="date" id="date"></div>
        <div class="speeds" id="speeds">
          ${['pause', 'play1', 'play2', 'play3'].map((n, k) => `<button data-speed="${k}" title="${k === 0 ? 'Pause (Espace)' : `Vitesse ${k}`}">${icon(n)}</button>`).join('')}
        </div>
      </header>
      <aside class="status panel" id="status">
        <div class="status-title">Réseaux</div>
        ${UTILITIES.map((u) => `<div class="util" data-u="${u}" style="--c:${UTILITY_COLORS[u]}">
          <div class="util-head"><span>${UTILITY_NAMES[u]}</span><b></b></div><div class="util-bar"><i></i></div></div>`).join('')}
        <div class="status-title">Services</div>
        <div class="cov">${COVERAGES.map((c) => `<div data-c="${c}"><span>${COVERAGE_NAMES[c]}</span><b>–</b></div>`).join('')}</div>
      </aside>
      <div class="flyout panel" id="flyout" hidden></div>
      <nav class="toolbar panel" id="toolbar">
        ${GROUPS.map((g) => `<button data-group="${g.id}" title="${g.label}${g.key ? ` (${g.key})` : ''}">${icon(g.icon)}<span>${g.label}</span>${g.key ? `<kbd>${g.key}</kbd>` : ''}</button>`).join('')}
      </nav>
      <aside class="info panel" id="info" hidden></aside>
      <div class="tooltip" id="tooltip" hidden></div>
      <div class="modal-wrap" id="ms-popup" hidden><div class="modal panel ms-modal"><div class="ms-kicker">Nouveau palier</div><h2 id="ms-title"></h2><p id="ms-text"></p><button class="primary" id="ms-ok">Continuer</button></div></div>
      <div class="toasts" id="toasts"></div>
      <div class="help panel" id="help">
        <b>Pour bien démarrer</b>
        <div>1. Tracez des routes · 2. Zonez le long des routes · 3. Menu <b>Réseaux</b> : une centrale (ou des éoliennes) et une station de pompage près de l'eau, reliées au même réseau routier.</div>
        <div><kbd>Clic droit</kbd> tourner · <kbd>Molette</kbd> zoom · <kbd>Z Q S D</kbd> déplacer · <kbd>A</kbd> <kbd>E</kbd> tourner · <kbd>T</kbd> trafic</div>
        <button id="help-close" aria-label="Fermer">×</button>
      </div>`;

    this.el('#toolbar').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      const g = GROUPS.find((g) => g.id === b?.dataset.group);
      if (!g) return;
      if (g.tools.length === 1) { this.openGroup = null; tools.setTool(g.tools[0].id); }
      else this.openGroup = this.openGroup === g.id ? null : g.id;
      this.renderFlyout();
    });
    this.el('#flyout').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.tool) tools.setTool(b.dataset.tool as ToolId);
    });
    this.el('#speeds').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.speed) sim.setSpeed(Number(b.dataset.speed));
    });
    this.el('#help-close').addEventListener('click', () => this.el('#help').remove());
    this.el('#views-btn').addEventListener('click', () => (this.el('#views-menu').hidden = !this.el('#views-menu').hidden));
    this.el('#views-menu').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.view) { views.set(b.dataset.view as ViewMode); this.el('#views-menu').hidden = true; }
    });
    views.onChange = (m) => this.updateViews(m);
    this.budget = new BudgetPanel(root, sim);
    this.el('#budget-btn').addEventListener('click', () => this.budget.toggle());
    this.el('#ms-ok').addEventListener('click', () => (this.el('#ms-popup').hidden = true));
    sim.events.on('milestone', ({ index }) => {
      const ms = MILESTONES[index];
      this.el('#ms-title').textContent = ms.name;
      this.el('#ms-text').innerHTML = `Votre ville atteint ${ms.pop.toLocaleString('fr-FR')} habitants.<br>Débloqué : <b>${ms.unlocks}</b>.<br>Subvention : <b>+${fmt(ms.reward)}</b>.`;
      this.el('#ms-popup').hidden = false;
    });
    setInterval(() => this.updateTraffic(), 500);

    let lastSpeed = 1;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (sim.speedIndex > 0) { lastSpeed = sim.speedIndex; sim.setSpeed(0); } else sim.setSpeed(lastSpeed);
      }
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'KeyT') views.set('traffic');
      if (e.code === 'KeyB') this.budget.toggle();
      const t = KEYED.find((t) => e.code === `Digit${t.key}` || e.code === `Numpad${t.key}`);
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

  private groupOf(tool: ToolId): Group | undefined {
    return GROUPS.find((g) => g.tools.some((t) => t.id === tool));
  }

  private renderFlyout(): void {
    const fly = this.el('#flyout');
    const g = GROUPS.find((g) => g.id === this.openGroup);
    this.root.querySelectorAll<HTMLElement>('#toolbar button').forEach((b) => {
      const active = b.dataset.group === this.groupOf(this.tools.tool)?.id;
      b.classList.toggle('active', active);
      b.classList.toggle('open', b.dataset.group === this.openGroup);
    });
    if (!g) { fly.hidden = true; return; }
    fly.hidden = false;
    fly.innerHTML = `<div class="fly-title">${g.label}</div>` + g.tools.map((t) => {
      const locked = t.zone ? !this.sim.isUnlocked(t.zone) : t.unlock ? this.sim.maxPop < t.unlock : false;
      const unlockAt = t.zone ? ZONE_INFO[t.zone].unlockPop : t.unlock ?? 0;
      const desc = t.desc ?? t.sub ?? '';
      return `<button data-tool="${t.id}" class="${t.id === this.tools.tool ? 'active' : ''} ${locked ? 'locked' : ''}" style="--c:${t.color}" title="${desc}">
        <i></i><span class="name">${t.label}${t.key ? ` <kbd>${t.key}</kbd>` : ''}</span>
        <span class="sub">${locked ? `Débloqué à ${unlockAt.toLocaleString('fr-FR')} hab.` : t.sub ?? ''}</span></button>`;
    }).join('');
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

    // Réseaux et services
    const us = this.sim.utilities.stats;
    const happy = this.el('#happy');
    if (st.population) {
      const h = Math.round(us.happiness * 100);
      happy.textContent = `${h} %`;
      happy.className = `value ${h >= 65 ? 'positive' : h < 45 ? 'negative' : ''}`;
    } else { happy.textContent = '–'; happy.className = 'value'; }
    this.root.querySelectorAll<HTMLElement>('#status .util').forEach((row) => {
      const u = Number(row.dataset.u) as Utility;
      const sup = us.supply[u], dem = us.demand[u];
      row.querySelector('b')!.textContent = `${n(dem)} / ${n(sup)}`;
      const fill = row.querySelector('i') as HTMLElement;
      fill.style.width = `${sup ? Math.min(100, (dem / sup) * 100) : dem ? 100 : 0}%`;
      row.classList.toggle('short', dem > sup);
    });
    this.root.querySelectorAll<HTMLElement>('#status .cov div').forEach((row) => {
      const v = us.coverage[Number(row.dataset.c)] ?? 0;
      row.querySelector('b')!.textContent = st.buildings ? `${Math.round(v * 100)} %` : '–';
    });
    if (this.openGroup) this.renderFlyout();
    const mi = this.sim.milestone, cur = MILESTONES[mi], next = MILESTONES[mi + 1];
    const msEl = this.el('#milestone');
    msEl.querySelector('.ms-name')!.textContent = cur.name;
    const pct = next ? Math.min(1, (this.sim.maxPop - cur.pop) / (next.pop - cur.pop)) : 1;
    (msEl.querySelector('i') as HTMLElement).style.width = `${pct * 100}%`;
    msEl.title = next ? `Prochain palier : ${next.name} à ${next.pop.toLocaleString('fr-FR')} habitants (${next.unlocks})` : 'Palier maximal atteint';
    this.budget.refresh();
  }

  private updateViews(mode: ViewMode): void {
    const label = VIEW_LABELS.find(([m]) => m === mode)?.[1];
    this.el('#views-label').textContent = label ?? 'Vues';
    this.el('#views-btn').classList.toggle('active', mode !== 'none');
    this.root.querySelectorAll<HTMLElement>('#views-menu button').forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
  }

  private updateTraffic(): void {
    const t = this.sim.traffic;
    const el = this.el('#flow');
    if (!t.vehicles.length) { el.textContent = '–'; el.className = 'value'; return; }
    const pct = Math.round(t.flow * 100);
    el.textContent = `${pct} %`;
    el.className = `value ${pct >= 70 ? 'positive' : pct < 45 ? 'negative' : ''}`;
    el.parentElement!.title = `${t.vehicles.length} véhicules en circulation · ${t.tripsCompleted} trajets terminés`;
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
    const g = this.groupOf(tool);
    if (g && g.tools.length > 1) this.openGroup = g.id;
    else if (g) this.openGroup = null;
    this.renderFlyout();
  }

  private updateInfo(h: HoverInfo | null): void {
    const box = this.el('#info');
    if (!h) { box.hidden = true; return; }
    const w = this.sim.world, ut = this.sim.utilities;
    const idx = w.index(h.i, h.j);
    const [lo, hi] = w.tileMinMax(h.i, h.j);
    const zone = w.zones[idx] as ZoneType | 0;
    const state = w.bState[idx];
    const svc = w.service[idx] as Service;
    let kind = w.isRoad(h.i, h.j) ? 'Route' : w.terrainLabel(h.i, h.j);
    let extra = '';
    if (w.isRoad(h.i, h.j)) {
      const d = this.sim.traffic.density[idx];
      extra = `<dt>Circulation</dt><dd>${TrafficView.label(d)}</dd><dt>Véhicules</dt><dd>${d.toFixed(1)}</dd>`;
    }
    if (svc) {
      const info = SERVICE_INFO[svc as Exclude<Service, 0>];
      kind = `<span class="dot" style="background:${info.color}"></span>${info.name}`;
      if (info.utility !== undefined) extra += `<dt>Production</dt><dd>${info.capacity!.toLocaleString('fr-FR')}</dd>`;
      if (info.radius) extra += `<dt>Rayon</dt><dd>${info.radius} cases</dd>`;
      extra += `<dt>Entretien</dt><dd>${fmt(info.upkeep)}/mois</dd>`;
      if (ut.networkOf(idx) < 0) extra += `<dt>État</dt><dd class="bad">Pas relié aux routes</dd>`;
    }
    if (zone) {
      const info = ZONE_INFO[zone];
      kind = `<span class="dot" style="background:${info.color}"></span>${info.name}`;
      if (state === BuildState.Construction) extra = `<dt>État</dt><dd>Chantier (${w.bTimer[idx]} j)</dd>`;
      else if (state === BuildState.Built) {
        const cap = this.sim.capacity(idx);
        const okU = (u: Utility) => ut.hasUtility(idx, u);
        const icons = UTILITIES.map((u) => `<span class="u ${okU(u) ? 'ok' : 'ko'}" title="${UTILITY_NAMES[u]}" style="--c:${UTILITY_COLORS[u]}">${UTILITY_SHORT[u]}</span>`).join('');
        extra = `<dt>Bâtiment</dt><dd>${LEVEL_NAMES[w.bLevel[idx]]}</dd>
          <dt>${zone === Zone.Residential ? 'Habitants' : 'Emplois'}</dt><dd>${cap}</dd>
          <dt>Réseaux</dt><dd>${icons}</dd>
          <dt>Bonheur</dt><dd>${Math.round(ut.happiness[idx] * 100)} %</dd>
          ${ut.fire[idx] ? '<dt>État</dt><dd class="bad">En feu !</dd>' : ''}
          ${ut.problemDays[idx] ? `<dt>Abandon dans</dt><dd class="bad">${45 - ut.problemDays[idx]} j</dd>` : ''}`;
      } else {
        const miss = ut.missing(idx);
        extra = `<dt>État</dt><dd>${w.roadDist[idx] > 3 ? 'Sans accès routier' : miss.length ? `Manque ${miss.map((u) => UTILITY_NAMES[u].toLowerCase()).join(', ')}` : 'Terrain libre'}</dd>`;
      }
      extra += `<dt>Valeur foncière</dt><dd>${Math.round(this.sim.landValue(idx) * 100)} %</dd>`;
    }
    box.hidden = false;
    box.innerHTML = `
      <div class="info-title">${kind}</div>
      <dl>${extra}
        <dt>Case</dt><dd>${h.i}, ${h.j}</dd>
        <dt>Altitude</dt><dd>${(((lo + hi) / 2) * 10).toFixed(0)} m</dd>
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
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4000);
  }
}
