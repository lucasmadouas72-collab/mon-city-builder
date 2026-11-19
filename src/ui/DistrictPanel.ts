import { fmt, type ToolManager } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';
import { POLICIES, POLICY_IDS, type PolicyId } from '../sim/Districts';
import { KIND_COLORS, KIND_NAMES, ZONES, type ZoneType } from '../sim/zones';

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Gestion des quartiers (§13) : liste, nom, politiques publiques, impôts locaux et indicateurs. */
export class DistrictPanel {
  private el: HTMLElement;
  private timer = 0;

  constructor(root: HTMLElement, private sim: Simulation, private tools: ToolManager) {
    this.el = document.createElement('aside');
    this.el.className = 'sheet district-panel panel';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      const id = this.tools.districtId;
      if (b.dataset.act === 'close') { this.toggle(false); return; }
      if (b.dataset.pick) { this.tools.districtId = Number(b.dataset.pick); this.tools.setTool('district'); }
      if (b.dataset.act === 'new') { this.tools.districtId = -1; this.tools.setTool('district'); }
      if (b.dataset.act === 'erase') this.tools.setTool('undistrict');
      if (b.dataset.act === 'delete' && id > 0) { this.sim.districts.remove(id); this.tools.districtId = -1; this.sim.events.emit('districtsChanged', undefined); }
      if (b.dataset.policy && id > 0) { this.sim.districts.togglePolicy(id, b.dataset.policy as PolicyId); this.sim.recomputeStats(); }
      if (b.dataset.tax && id > 0) {
        const k = Number(b.dataset.tax) as ZoneType;
        this.sim.districts.setTax(id, k, (this.sim.districts.get(id)?.tax[k] ?? 0) + Number(b.dataset.d));
        this.sim.recomputeStats();
      }
      this.render();
    });
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'rename') { this.sim.districts.rename(this.tools.districtId, t.value); this.sim.events.emit('districtsChanged', undefined); this.render(); }
    });
    sim.events.on('districtsChanged', () => { if (!this.el.hidden) this.render(); });
  }

  toggle(force?: boolean): void {
    this.el.hidden = !(force ?? this.el.hidden);
    clearInterval(this.timer);
    if (!this.el.hidden) { this.render(); this.timer = window.setInterval(() => { if (document.activeElement?.tagName !== 'INPUT') this.render(); }, 2000); }
  }

  get open(): boolean { return !this.el.hidden; }

  private render(): void {
    const ds = this.sim.districts, id = this.tools.districtId, d = ds.get(id);
    const list = ds.list.map((x) => `<button data-pick="${x.id}" class="dchip ${x.id === id ? 'active' : ''}"><i style="background:${x.color}"></i>${x.name}</button>`).join('');
    let body = '<p class="sub">Choisissez un quartier, ou cliquez sur « Nouveau » puis glissez sur la carte pour en tracer un.</p>';
    if (d) {
      const st = ds.stats(d.id);
      body = `
        <section><b>Nom</b><input class="dname" data-act="rename" value="${d.name.replace(/"/g, '&quot;')}" maxlength="32"></section>
        <section><b>Indicateurs</b><dl>
          <dt>Surface</dt><dd>${st.tiles} cases</dd><dt>Habitants</dt><dd>${st.population.toLocaleString('fr-FR')}</dd><dt>Emplois</dt><dd>${st.jobs.toLocaleString('fr-FR')}</dd>
          <dt>Bonheur</dt><dd>${st.buildings ? pct(st.happiness) : '–'}</dd><dt>Délinquance</dt><dd>${st.buildings ? pct(st.crime) : '–'}</dd>
          <dt>Air / bruit</dt><dd>${st.buildings ? `${pct(st.air)} / ${pct(st.noise)}` : '–'}</dd><dt>Valeur foncière</dt><dd>${st.buildings ? pct(st.landValue) : '–'}</dd>
          <dt>Politiques</dt><dd>${fmt(st.cost)}/mois${st.income ? ` · +${fmt(st.income)}` : ''}</dd>
        </dl></section>
        <section><b>Politiques publiques</b>
          ${POLICY_IDS.map((p) => { const info = POLICIES[p], on = d.policies.includes(p);
            const cost = [info.flat ? `${fmt(info.flat)}/mois` : '', info.perHome ? `${info.perHome} €/logement` : '', info.perBusiness ? `${info.perBusiness} €/entreprise` : '', info.incomePerJob ? `recette ${info.incomePerJob} €/emploi` : ''].filter(Boolean).join(' + ') || 'gratuit';
            return `<button data-policy="${p}" class="pol ${on ? 'on' : ''}" title="${info.theme}"><span class="tg"></span><span><b>${info.name}</b><small>${info.description} · ${cost}</small></span></button>`; }).join('')}
        </section>
        <section><b>Impôts locaux (écart avec la ville)</b>
          ${ZONES.map((k) => { const v = d.tax[k] ?? 0; return `<div class="dtax"><span><i style="background:${KIND_COLORS[k]}"></i>${KIND_NAMES[k]}</span><button data-tax="${k}" data-d="-1">−</button><b>${v > 0 ? '+' : ''}${v} pt · ${this.sim.taxes[k] + v} %</b><button data-tax="${k}" data-d="1">+</button></div>`; }).join('')}
          <p class="sub">Plus d’impôts : plus de recettes, mais moins de nouvelles constructions dans le quartier.</p>
        </section>
        <div class="actions"><button data-act="erase">Retirer des cases</button><button data-act="delete" class="danger">Supprimer le quartier</button></div>`;
    }
    this.el.innerHTML = `<button class="close" data-act="close" aria-label="Fermer">×</button>
      <h3>Quartiers</h3>
      <div class="dlist">${list}<button data-act="new" class="dchip new">+ Nouveau</button></div>
      ${body}`;
  }
}
