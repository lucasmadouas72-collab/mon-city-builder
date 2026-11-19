import { fmt } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';
import { KIND_NAMES, PASSENGER_SCALE, type LineStatus } from '../sim/Transit';

const STATUS: Record<LineStatus, [string, string]> = {
  ok: ['En service', 's-ok'], overloaded: ['Surchargée', 's-bad'], underused: ['Sous-utilisée', 's-warn'], deficit: ['Déficitaire', 's-warn'], broken: ['Interrompue', 's-bad'],
};
const n = (v: number) => Math.round(v).toLocaleString('fr-FR');

/** Gestion des lignes (§12) : véhicules ou fréquence, capacité, charge, recettes, coûts, correspondances. */
export class TransportPanel {
  private wrap: HTMLElement;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) { this.toggle(false); return; }
      const b = t.closest<HTMLElement>('button[data-line]');
      if (!b) return;
      const id = Number(b.dataset.line), line = this.sim.transit.lines.find((l) => l.id === id);
      if (!line) return;
      if (b.dataset.act === 'plus') this.sim.transit.setVehicles(id, line.vehicles + 1);
      if (b.dataset.act === 'minus') this.sim.transit.setVehicles(id, Math.max(1, line.vehicles - 1));
      if (b.dataset.act === 'auto') this.sim.transit.setVehicles(id, 0);
      if (b.dataset.act === 'delete') this.sim.removeLine(id);
      this.sim.recomputeStats();
      this.sim.events.emit('transitChanged', undefined);
      this.render();
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.render();
  }

  private render(): void {
    const s = this.sim, tr = s.transit, st = tr.lastMonthStats;
    const total = Object.values(st.byKind).reduce((a, b) => a + b, 0);
    let pressured = 0, biz = 0;
    for (let k = 0; k < s.parkingPressure.length; k++) if (s.parkingPressure[k] > 0) { biz++; if (s.parkingPressure[k] > 1) pressured++; }
    const lines = tr.lines.map((l) => {
      const i = tr.info(l);
      const [label, cls] = STATUS[i.status];
      return `<div class="tline">
        <div class="thead"><i class="swatch" style="background:${l.color}"></i><b>${l.name}</b><span class="state ${cls}">${label}</span>
          <small>${KIND_NAMES[l.kind]} · ${l.stops.length} arrêts · ${i.lengthKm.toFixed(1)} km · tour en ${Math.round(i.roundTripMin)} min${l.regional ? ' · <b>liaison régionale</b>' : ''}</small></div>
        ${l.reason ? `<div class="treason">${l.reason}</div>` : ''}
        <div class="tgrid">
          <div><span>Véhicules</span><b><button data-line="${l.id}" data-act="minus">−</button> ${i.vehicles} <button data-line="${l.id}" data-act="plus">+</button></b><small>${l.target ? `fixé · conseillé ${i.recommended} <button data-line="${l.id}" data-act="auto" class="link">auto</button>` : `automatique (conseillé ${i.recommended})`}</small></div>
          <div><span>Fréquence</span><b>${i.headwayMin ? `${i.headwayMin < 1 ? '< 1' : Math.round(i.headwayMin)} min` : '–'}</b><small>un passage toutes les…</small></div>
          <div><span>Voyageurs / mois</span><b>${n(l.lastMonth)}</b><small>capacité ${n(i.capacity)} · ce mois ${n(l.passengers)}</small><div class="pprog"><i style="width:${Math.min(100, i.load * 100)}%;background:${i.load > 0.95 ? 'var(--bad)' : i.load < 0.15 ? '#facc15' : 'var(--accent)'}"></i></div></div>
          <div><span>Recettes / coûts</span><b class="${i.revenue < i.cost ? 'neg' : 'pos'}">${fmt(i.revenue)} / ${fmt(i.cost)}</b><small>billets / exploitation par mois</small></div>
        </div>
        <div class="tfoot"><small>${i.connections.length ? `Correspondances : ${i.connections.join(', ')}` : 'Aucune correspondance'}</small><button data-line="${l.id}" data-act="delete" class="ghost danger">Supprimer</button></div>
      </div>`;
    }).join('');
    this.wrap.innerHTML = `<div class="modal panel stats transport">
      <header><h2>Transports</h2><button class="close" aria-label="Fermer">×</button></header>
      <div class="kpis">
        <div><span>Transports en commun</span><b>${n(total)}</b><small>voyageurs le mois dernier</small></div>
        <div><span>Avec correspondance</span><b>${n(st.transfers)}</b></div>
        <div><span>À vélo</span><b>${n(st.bike)}</b></div>
        <div><span>En taxi</span><b>${n(st.taxi)}</b></div>
        <div><span>Aéroport</span><b>${n(s.airportPassengers)}</b><small>voyageurs / mois</small></div>
        <div><span>Accidents</span><b>${s.accidentsLastMonth}</b><small>le mois dernier</small></div>
      </div>
      <p class="hint">Part des trajets en transport collectif : ${Math.round(s.traffic.transitShare * 100)} %. Chaque trajet simulé compte pour ${PASSENGER_SCALE} voyageurs. Stationnement : ${pressured} commerce(s) ou bureau(x) sur ${biz} manquent de places (carte « Stationnement »).</p>
      <h3>Lignes</h3>
      ${lines || '<p class="hint">Aucune ligne. Menu Transports : placez des arrêts ou des stations, puis tracez une ligne.</p>'}
      <p class="hint">« Surchargée » : la capacité est atteinte, des voyageurs reprennent la voiture — ajoutez des véhicules. « Sous-utilisée » : moins de 15 % de remplissage. « Déficitaire » : les billets ne couvrent pas l’exploitation.</p>
    </div>`;
  }
}
