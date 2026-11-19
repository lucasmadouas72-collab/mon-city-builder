import { fmt } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';

const pct = (v: number) => `${Math.round(v * 100)} %`;
const MOD_NAMES: Record<string, string> = {
  happiness: 'Bonheur', crime: 'Délinquance', garbage: 'Déchets produits', landValue: 'Valeur foncière', tourism: 'Attrait touristique',
  education: 'Efficacité de l’éducation', health: 'Efficacité de la santé', maintenance: 'Usure du patrimoine', commerce: 'Ventes des commerces', construction: 'Vitesse des chantiers',
};
const NEGATIVE = new Set(['crime', 'garbage', 'maintenance']);

/** Écran de gouvernance (§13) : mandat, popularité, objectifs, plaintes, projets et décisions. */
export class CouncilPanel {
  private wrap: HTMLElement;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) { this.toggle(false); return; }
      const a = t.closest<HTMLElement>('[data-approve]');
      if (a) { this.sim.council.approve(a.dataset.approve!); this.render(); }
      const r = t.closest<HTMLElement>('[data-reject]');
      if (r) { this.sim.council.reject(r.dataset.reject!); this.render(); }
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
    sim.events.on('dateChanged', () => { if (!this.wrap.hidden && this.sim.date.day === 1) this.render(); });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.render();
  }

  private spark(values: number[]): string {
    if (values.length < 2) return '<p class="hint">L’historique apparaîtra au fil des mois.</p>';
    const W = 260, H = 60;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - v * H}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/><polyline points="${pts}"/></svg>`;
  }

  private render(): void {
    const s = this.sim, c = s.council;
    const appr = c.approval;
    const cls = appr >= 0.55 ? 'pos' : appr < 0.45 ? 'neg' : '';
    const proposed = c.projects.filter((p) => p.status === 'proposed');
    const running = c.projects.filter((p) => p.status === 'running');
    const done = c.projects.filter((p) => p.status === 'done').slice(0, 5);
    const last = c.elections[c.elections.length - 1];
    this.wrap.innerHTML = `<div class="modal panel stats council">
      <header><h2>Conseil municipal</h2><button class="close" aria-label="Fermer">×</button></header>
      <div class="kpis">
        <div><span>Popularité</span><b class="${cls}">${pct(appr)}</b></div>
        <div><span>Mandat</span><b>n° ${c.mandate}</b></div>
        <div><span>Prochaines élections</span><b>dans ${c.monthsToElection} mois</b></div>
        <div><span>Dernier scrutin</span><b>${last ? `${pct(last.score)} · ${last.won ? 'réélu' : 'défaite'}` : '–'}</b></div>
      </div>
      <div class="stats-grid">
        <section><h3>Popularité (mois par mois)</h3>${this.spark(c.approvalHistory)}
          <p class="hint">Elle dépend du bonheur, de l’emploi, de la sécurité, des finances, des impôts, des plaintes et des projets réalisés. Sous 50 % aux élections, la majorité est fragilisée.</p></section>
        <section><h3>Objectifs de l’année</h3>
          ${c.objectives.length ? `<ul class="obj">${c.objectives.map((o) => { const now = o.check(s); return `<li class="${now ? 'ok' : ''}"><span>${o.text}</span><em>${fmt(o.reward)}</em></li>`; }).join('')}</ul>` : '<p class="hint">Les objectifs sont fixés en début d’année.</p>'}
          <p class="hint">Bilan en fin d’année : subvention pour chaque objectif atteint.</p></section>
      </div>
      <h3>Décisions à prendre</h3>
      ${proposed.length ? proposed.map((p) => `<div class="proj">
        <div><b>${p.title}</b><small>${p.description}</small>
          <div class="ptags"><span>Coût ${fmt(p.cost)}</span><span>Délai ${p.months} mois</span><span class="eff">Effet : ${p.effect}</span><span class="risk">Risque (${pct(p.riskChance)}) : ${p.risk}</span></div></div>
        <div class="pbtn"><button data-approve="${p.id}" class="primary">Approuver</button><button data-reject="${p.id}" class="ghost">Refuser</button></div></div>`).join('') : '<p class="hint">Aucune proposition pour le moment : le conseil en soumet chaque mois.</p>'}
      ${running.length ? `<h3>Projets en cours</h3>${running.map((p) => `<div class="proj"><div><b>${p.title}</b><small>Fin prévue dans ${Math.max(0, p.end - s.monthIndex)} mois · ${p.effect}</small><div class="pprog"><i style="width:${p.progress * 100}%"></i></div></div></div>`).join('')}` : ''}
      <div class="stats-grid">
        <section><h3>Plaintes des habitants</h3>
          ${c.complaints.length ? `<ul class="compl">${c.complaints.map((q) => `<li>${q.text}<small>${q.count >= 5 ? 'Très fréquente' : 'Fréquente'}${q.district ? ` · ${q.district}` : ''}</small></li>`).join('')}</ul>` : '<p class="hint">Aucune plainte notable ce mois-ci.</p>'}</section>
        <section><h3>Effets en cours</h3>
          ${c.modifiers.length ? `<dl class="facts">${c.modifiers.map((m) => `<dt>${MOD_NAMES[m.key]} <small>(${m.source})</small></dt><dd class="${m.value > 0 ? 'pos' : 'neg'}">${NEGATIVE.has(m.key) ? '−' : m.value > 0 ? '+' : ''}${Math.round(Math.abs(m.value) * 100)} % · ${m.until - s.monthIndex} mois</dd>`).join('')}</dl>` : '<p class="hint">Aucun effet actif.</p>'}
          ${done.length ? `<h3>Projets terminés</h3><dl class="facts">${done.map((p) => `<dt>${p.title}</dt><dd>${p.outcome ?? 'comme prévu'}</dd>`).join('')}</dl>` : ''}</section>
      </div>
    </div>`;
  }
}
