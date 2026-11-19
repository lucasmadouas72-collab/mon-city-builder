import { fmt } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';
import { SERVICE_INFO, Service } from '../sim/services';
import { EVENT_INFO, venueEvents, type CityEvent, type EventKind } from '../sim/Tourism';

type Tab = 'plan' | 'calendar' | 'archive' | 'tourism';
const TABS: Array<[Tab, string]> = [['plan', 'Organiser'], ['calendar', 'Calendrier'], ['archive', 'Archives'], ['tourism', 'Tourisme et fréquentation']];
const n = (v: number) => Math.round(v).toLocaleString('fr-FR');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Gestion des événements (§15) : lieu, date, capacité, type ; estimation, calendrier, archives ; tourisme. */
export class EventsPanel {
  private wrap: HTMLElement;
  private tab: Tab = 'plan';
  private venue = -1;
  private kind: EventKind = 'market';
  private days = 15;
  private capacity = 0;
  /** Centre la caméra sur une case (fourni par l'interface). */
  focus?: (tile: number) => void;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) { this.toggle(false); return; }
      const tab = t.closest<HTMLElement>('[data-tab]');
      if (tab) { this.tab = tab.dataset.tab as Tab; this.render(); return; }
      if (t.closest('[data-act="schedule"]')) {
        const err = this.sim.tourism.schedule(this.venue, this.kind, this.capacity, this.days);
        this.sim.events.emit('notify', { text: err ?? `${EVENT_INFO[this.kind].name} programmé dans ${this.days} jours`, kind: err ? 'warn' : 'info' });
        if (!err) this.tab = 'calendar';
        this.render();
      }
      const c = t.closest<HTMLElement>('[data-cancel]');
      if (c) { this.sim.tourism.cancel(Number(c.dataset.cancel)); this.render(); }
      const f = t.closest<HTMLElement>('[data-focus]');
      if (f) this.focus?.(Number(f.dataset.focus));
    });
    this.wrap.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.dataset.f === 'venue') { this.venue = Number(el.value); this.capacity = 0; }
      if (el.dataset.f === 'kind') this.kind = el.value as EventKind;
      if (el.dataset.f === 'days') this.days = Number(el.value);
      if (el.dataset.f === 'cap') this.capacity = Number(el.value);
      this.render(el.dataset.f);
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
  }

  toggle(force?: boolean, venue?: number): void {
    if (venue !== undefined) { this.venue = venue; this.tab = 'plan'; this.capacity = 0; }
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.render();
  }

  private venues(): number[] {
    const w = this.sim.world, out: number[] = [];
    for (let k = 0; k < w.service.length; k++) if (w.service[k] && venueEvents(w.service[k] as Service).length) out.push(k);
    return out;
  }

  private venueName(k: number): string {
    const w = this.sim.world;
    return `${SERVICE_INFO[w.service[k] as Exclude<Service, 0>]?.name ?? 'Lieu disparu'} (${k % w.size}, ${Math.floor(k / w.size)})`;
  }

  private capOf(k: number): number {
    const svc = this.sim.world.service[k] as Service;
    return svc === Service.Park ? 4000 : SERVICE_INFO[svc as Exclude<Service, 0>]?.leisure?.capacity ?? 1000;
  }

  private dateOf(day: number): string {
    const sim = this.sim, m = Math.floor(day / 30) + sim.env.startMonth;
    return `${(day % 30) + 1} ${MONTHS[m % 12]} an ${1 + Math.floor(m / 12)}`;
  }

  private render(focusField?: string): void {
    const body = this.tab === 'plan' ? this.plan() : this.tab === 'calendar' ? this.calendar() : this.tab === 'archive' ? this.archive() : this.tourismTab();
    this.wrap.innerHTML = `<div class="modal panel stats events">
      <header><h2>Événements et tourisme</h2><button class="close" aria-label="Fermer">×</button></header>
      <nav class="ntabs">${TABS.map(([t, l]) => `<button data-tab="${t}" class="${t === this.tab ? 'active' : ''}">${l}</button>`).join('')}</nav>
      ${body}</div>`;
    if (focusField) (this.wrap.querySelector(`[data-f="${focusField}"]`) as HTMLElement | null)?.focus();
  }

  private plan(): string {
    const venues = this.venues();
    if (!venues.length) return '<p class="hint">Aucun lieu disponible : construisez un stade, une arena, une salle de concert, un théâtre, un centre de congrès, une plage, une promenade, un monument ou un parc (menu Loisirs ou Services).</p>';
    if (!venues.includes(this.venue)) this.venue = venues[0];
    const kinds = venueEvents(this.sim.world.service[this.venue] as Service);
    if (!kinds.includes(this.kind)) this.kind = kinds[0];
    const cap = this.capOf(this.venue);
    if (!this.capacity || this.capacity > cap) this.capacity = Math.round(cap * 0.8);
    const est = this.sim.tourism.estimate(this.venue, this.kind, this.capacity, this.sim.dayCount + this.days);
    const ei = EVENT_INFO[this.kind];
    return `<div class="stats-grid">
      <section>
        <h3>Lieu, type, date, capacité</h3>
        <label class="field"><span>Lieu</span><select data-f="venue">${venues.map((k) => `<option value="${k}" ${k === this.venue ? 'selected' : ''}>${this.venueName(k)}</option>`).join('')}</select></label>
        <label class="field"><span>Type</span><select data-f="kind">${kinds.map((k) => `<option value="${k}" ${k === this.kind ? 'selected' : ''}>${EVENT_INFO[k].name} · ${EVENT_INFO[k].days} j${EVENT_INFO[k].outdoor ? ' · plein air' : ''}</option>`).join('')}</select></label>
        <label class="slider"><span>Dans</span><input type="range" min="3" max="120" step="1" value="${this.days}" data-f="days"><b>${this.days} j</b></label>
        <p class="hint">Date : ${this.dateOf(this.sim.dayCount + this.days)}</p>
        <label class="slider"><span>Capacité</span><input type="range" min="${Math.round(cap * 0.1)}" max="${cap}" step="${Math.max(50, Math.round(cap / 100))}" value="${this.capacity}" data-f="cap"><b>${n(this.capacity)}</b></label>
        <button class="primary" data-act="schedule">Programmer l’événement</button>
      </section>
      <section>
        <h3>Estimation</h3>
        <dl class="facts">
          <dt>Visiteurs attendus</dt><dd>${n(est.visitors)} (${Math.round((est.visitors / Math.max(1, this.capacity)) * 100)} % de la jauge)</dd>
          <dt>Dont touristes</dt><dd>${n(est.tourists)}</dd>
          <dt>Sécurité</dt><dd class="${est.securityAvailable < est.security ? 'neg' : ''}">${est.security} équipe(s) nécessaire(s) · ${est.securityAvailable} disponible(s)</dd>
          <dt>Transports en commun</dt><dd>${Math.round(est.transitShare * 100)} % des visiteurs</dd>
          <dt>Parkings proches</dt><dd>${n(est.parking)} places</dd>
          <dt>Recettes (ville)</dt><dd class="pos">${fmt(est.revenue)}</dd>
          <dt>Coût d’organisation</dt><dd class="neg">${fmt(est.cost)}</dd>
          <dt>Bilan estimé</dt><dd class="${est.revenue - est.cost < 0 ? 'neg' : 'pos'}">${fmt(est.revenue - est.cost)}</dd>
          <dt>Nuisances sonores</dt><dd>${ei.noise > 0.25 ? 'fortes' : ei.noise > 0.1 ? 'moyennes' : 'faibles'}</dd>
        </dl>
        ${est.warnings.map((w) => `<div class="nalert k-warn">${w}</div>`).join('')}
        <p class="hint">Pendant l’événement, une partie des trajets se dirige vers le lieu (embouteillages possibles), le bruit augmente autour. Un succès améliore le bonheur et attire des touristes.</p>
      </section></div>`;
  }

  private row(e: CityEvent, done: boolean): string {
    const r = e.result;
    return `<div class="tline"><div class="thead"><b>${EVENT_INFO[e.kind].name}</b><span class="state ${e.status === 'running' ? 's-ok' : done ? (r && r.satisfaction > 0.5 ? 's-ok' : 's-warn') : ''}">${e.status === 'running' ? 'En cours' : done ? `${Math.round((r?.satisfaction ?? 0) * 100)} % de satisfaits` : 'Programmé'}</span>
      <small>${this.dateOf(e.day)} · <button class="link" data-focus="${e.venue}">${this.venueName(e.venue)}</button> · jauge ${n(e.capacity)}</small></div>
      <div class="tgrid">
        <div><span>Visiteurs</span><b>${n(r?.visitors ?? e.est.visitors)}</b><small>${r ? 'réels' : 'estimés'}</small></div>
        <div><span>Recettes / coût</span><b class="${(r?.revenue ?? e.est.revenue) < (r?.cost ?? e.est.cost) ? 'neg' : 'pos'}">${fmt(r?.revenue ?? e.est.revenue)} / ${fmt(r?.cost ?? e.est.cost)}</b></div>
        <div><span>Sécurité</span><b>${r ? `${r.incidents} incident(s)` : `${e.est.securityAvailable}/${e.est.security} équipes`}</b></div>
        <div><span>Transports</span><b>${Math.round(e.est.transitShare * 100)} %</b><small>des visiteurs</small></div>
      </div>
      <div class="tfoot"><small>${r ? r.notes.join(' · ') || 'Déroulement sans problème' : e.est.warnings.join(' · ')}</small>${!done && e.status === 'planned' ? `<button class="ghost danger" data-cancel="${e.id}">Annuler (20 % du coût)</button>` : ''}</div></div>`;
  }

  private calendar(): string {
    const list = this.sim.tourism.events;
    return list.length ? list.map((e) => this.row(e, false)).join('') : '<p class="hint">Aucun événement programmé. Onglet « Organiser » pour en créer un.</p>';
  }

  private archive(): string {
    const h = this.sim.tourism.history;
    if (!h.length) return '<p class="hint">Les statistiques des événements passés seront archivées ici.</p>';
    const tot = h.reduce((a, e) => [a[0] + (e.result?.visitors ?? 0), a[1] + (e.result?.revenue ?? 0) - (e.result?.cost ?? 0)], [0, 0]);
    return `<div class="kpis"><div><span>Événements</span><b>${h.length}</b></div><div><span>Visiteurs cumulés</span><b>${n(tot[0])}</b></div><div><span>Bilan cumulé</span><b class="${tot[1] < 0 ? 'neg' : 'pos'}">${fmt(tot[1])}</b></div></div>${h.map((e) => this.row(e, true)).join('')}`;
  }

  private tourismTab(): string {
    const t = this.sim.tourism, s = this.sim;
    return `<div class="kpis"><div><span>Touristes / mois</span><b>${n(t.tourists)}</b></div><div><span>Attrait de la ville</span><b>${Math.round(s.tourismAppeal * 100)} %</b></div>
        <div><span>Chambres d’hôtel</span><b>${n(t.hotelRooms)}</b><small>remplies à ${Math.round(t.occupancy * 100)} %</small></div><div><span>Dépenses des touristes</span><b>${fmt(t.spending)}</b><small>par mois, dans les commerces</small></div></div>
      <p class="hint">Les touristes viennent pour les équipements attractifs (musées, monuments, zoo, parc d’attractions, plages…), les parcs, l’aéroport et les trains régionaux. Ils dorment dans les zones Tourisme (hôtels) et font vivre les commerces.</p>
      <h3>Fréquentation des équipements (mois dernier)</h3>
      ${t.facilities.length ? `<table class="ledger cmp"><tr class="grp"><td>Équipement</td><td>Visiteurs</td><td>Remplissage</td><td>Entrées</td></tr>${t.facilities.slice(0, 14).map((f) => `<tr><td><button class="link" data-focus="${f.tile}">${this.venueName(f.tile)}</button></td><td>${n(f.visitors)}</td><td>${f.capacity ? Math.round((f.visitors / f.capacity) * 100) : 0} %</td><td>${fmt(f.revenue)}</td></tr>`).join('')}</table>` : '<p class="hint">Aucun équipement de loisirs (menu Loisirs).</p>'}
      <p class="hint">La fréquentation varie avec la saison : plages et piscines l’été, patinoires l’hiver.</p>`;
  }
}
