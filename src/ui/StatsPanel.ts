import { fmt } from '../input/ToolManager';
import type { HistoryPoint, Simulation } from '../sim/Simulation';
import { COHORTS, COHORT_AGES } from '../sim/Population';
import { Coverage, COVERAGE_NAMES } from '../sim/services';
import { DISASTER_NAMES } from '../sim/Disasters';

interface ChartDef {
  key: string;
  title: string;
  value: (h: HistoryPoint) => number;
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => Math.round(v).toLocaleString('fr-FR');
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const CHARTS: ChartDef[] = [
  { key: 'pop', title: 'Population', value: (h) => h.pop, format: num },
  { key: 'jobs', title: 'Emplois', value: (h) => h.jobs, format: num },
  { key: 'money', title: 'Trésorerie', value: (h) => h.money, format: fmt },
  { key: 'balance', title: 'Solde mensuel', value: (h) => h.income - h.expenses, format: fmt },
  { key: 'happy', title: 'Bonheur', value: (h) => h.happiness, format: pct },
  { key: 'unemp', title: 'Chômage', value: (h) => h.unemployment, format: pct },
  { key: 'air', title: "Pollution de l'air", value: (h) => h.air, format: pct },
  { key: 'flow', title: 'Fluidité du trafic', value: (h) => h.flow, format: pct },
];

const W = 260, H = 96, PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 16;

/** Tableau de bord : démographie, économie, environnement, avec l'historique mensuel. */
export class StatsPanel {
  private wrap: HTMLElement;
  private q = (sel: string) => this.wrap.querySelector(sel) as HTMLElement;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    this.wrap.innerHTML = `
      <div class="modal panel stats">
        <header><h2>Statistiques de la ville</h2><button class="close" aria-label="Fermer">×</button></header>
        <div class="kpis" id="kpis"></div>
        <div class="stats-grid">
          <section><h3>Pyramide des âges</h3><div id="cohorts"></div></section>
          <section><h3>Services et société</h3><div id="society"></div></section>
        </div>
        <div class="stats-grid">
          <section><h3>Logement et revenus</h3><div id="housing"></div></section>
          <section><h3>Emploi et entreprises</h3><div id="economy"></div></section>
        </div>
        <h3>Besoins des habitants</h3>
        <div class="needs" id="needs"></div>
        <h3>Catastrophes</h3>
        <div id="disasters"></div>
        <h3>Évolution mensuelle</h3>
        <div class="charts" id="charts"></div>
      </div>`;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) this.toggle(false);
    });
    this.wrap.addEventListener('pointermove', (e) => this.hover(e));
    this.wrap.addEventListener('pointerleave', () => this.wrap.querySelectorAll('.crosshair').forEach((c) => c.setAttribute('opacity', '0')));
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
    sim.events.on('dateChanged', () => { if (!this.wrap.hidden && this.sim.date.day === 1) this.refresh(); });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.refresh();
  }

  refresh(): void {
    const s = this.sim, st = s.stats, d = s.demo, us = s.utilities.stats;
    const rep = d.last;
    this.q('#kpis').innerHTML = [
      ['Habitants', num(st.population)],
      ['Naissances / mois', num(rep.births)],
      ['Décès / mois', num(rep.deaths)],
      ['Migration / mois', `${rep.migration >= 0 ? '+' : ''}${num(rep.migration)}`],
      ['Chômage', pct(st.unemployment)],
      ['Actifs diplômés', pct(d.education)],
    ].map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('');

    const counts = d.counts(st.population);
    const max = Math.max(1, ...counts);
    this.q('#cohorts').innerHTML = COHORTS.map((c, i) => `
      <div class="cohort"><span>${c}<small>${COHORT_AGES[i]}</small></span>
      <div class="cbar"><i style="width:${(counts[i] / max) * 100}%"></i></div><b>${num(counts[i])}</b></div>`).join('');

    const cov = (c: Coverage) => pct(us.coverage[c] ?? 0);
    const us2 = s.utilities.reach, es = s.emergency.stats;
    this.q('#society').innerHTML = `
      <dl class="facts">
        <dt>Actifs</dt><dd>${num(st.workers)}</dd>
        <dt>Emplois</dt><dd>${num(st.totalJobs)}</dd>
        <dt>Élèves et étudiants</dt><dd>${num(d.students(st.population))}</dd>
        <dt>Malades</dt><dd>${num(st.population * d.sick)} (${pct(d.sick)})</dd>
        <dt>Pollution de l'air</dt><dd>${pct(us.air)}</dd>
        <dt>Pollution sonore</dt><dd>${pct(us.noise)}</dd>
        ${[Coverage.Health, Coverage.Education, Coverage.Police, Coverage.Fire, Coverage.Park].map((c) => `<dt>Couverture ${COVERAGE_NAMES[c].toLowerCase()}</dt><dd>${cov(c)}</dd>`).join('')}
        <dt>Trajets en transport en commun</dt><dd>${pct(s.traffic.transitShare)}</dd>
        <dt>Places à l'école</dt><dd>${num(us2.students - us2.unschooled)} / ${num(us2.seats)}</dd>
        <dt>Patients soignés</dt><dd>${num(us2.patients - us2.untreated)} / ${num(us2.patients)}</dd>
        <dt>Délinquance</dt><dd>${pct(s.crimeIndex)}</dd>
        <dt>Intervention pompiers</dt><dd>${es.response.fire ? `${es.response.fire} min` : '–'} · ${es.resolved.fire} réussie(s), ${es.failed.fire} ratée(s)</dd>
        <dt>Intervention ambulances</dt><dd>${es.response.medical ? `${es.response.medical} min` : '–'} · ${es.resolved.medical} / ${es.failed.medical}</dd>
        <dt>Intervention police</dt><dd>${es.response.crime ? `${es.response.crime} min` : '–'} · ${es.resolved.crime} / ${es.failed.crime}</dd>
      </dl>`;

    const soc = s.society, ss = s.lastSociety, b = soc.stats, cz = soc.citizens;
    const eur = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`;
    this.q('#housing').innerHTML = `<dl class="facts">
      <dt>Foyers</dt><dd>${num(ss?.households ?? 0)}</dd>
      <dt>Logements occupés / total</dt><dd>${num(soc.homesTotal - soc.homesFree)} / ${num(soc.homesTotal)}</dd>
      <dt>Logements vacants</dt><dd>${pct(soc.vacancy)}</dd>
      <dt>Revenu moyen par foyer</dt><dd>${eur(ss?.avgIncome ?? 0)} / mois</dd>
      <dt>Loyer moyen</dt><dd>${eur(ss?.avgRent ?? 0)} / mois</dd>
      <dt>Part du loyer dans le revenu</dt><dd>${pct(cz.summaryBurden)}</dd>
      <dt>Coût de la vie</dt><dd>${Math.round(soc.costOfLiving * 100)} (base 100)</dd>
      <dt>Arrivées / départs (mois)</dt><dd>+${num(cz.report.immigrants)} / −${num(cz.report.emigrants)}</dd>
      <dt>Déménagements (mois)</dt><dd>${num(cz.report.moves)}</dd></dl>`;
    const ue = ss?.unemployedByEdu ?? [0, 0, 0, 0];
    this.q('#economy').innerHTML = `<dl class="facts">
      <dt>Actifs occupés</dt><dd>${num(ss?.workers ?? 0)}</dd>
      <dt>Chômeurs (sans dipl. · prim. · second. · sup.)</dt><dd>${ue.map(num).join(' · ')}</dd>
      <dt>Postes vacants (peu qualif. · qualif. · très qualif.)</dt><dd>${b.openJobs.map(num).join(' · ')}</dd>
      <dt>Actifs sous-employés</dt><dd>${num(cz.underemployedCount)}</dd>
      <dt>Entreprises / en difficulté</dt><dd>${num(b.businesses)} / ${num(b.struggling)}</dd>
      <dt>Faillites (mois / total)</dt><dd>${num(b.closedThisMonth)} / ${num(b.closedTotal)}</dd>
      <dt>Locaux sous-utilisés</dt><dd>${num(b.underused)}</dd>
      <dt>Dépenses des ménages</dt><dd>${eur(b.spending)} / mois</dd>
      <dt>Marchandises : besoin / production</dt><dd>${eur(b.goodsDemand)} / ${eur(b.goodsProduced)}</dd>
      <dt>Importations / exportations</dt><dd>${eur(b.imports)} / ${eur(b.exports)}</dd></dl>`;
    this.q('#needs').innerHTML = soc.needs().map(([name, v, detail]) => `
      <div class="need"><span>${name}</span><div class="cbar"><i style="width:${Math.round(v * 100)}%;background:${v < 0.4 ? '#ef4444' : v < 0.65 ? '#facc15' : 'var(--accent)'}"></i></div><b>${Math.round(v * 100)} %</b><small>${detail}</small></div>`).join('');
    const dl = s.disasters.list.filter((d) => d.status === 'over').slice(-8).reverse();
    this.q('#disasters').innerHTML = dl.length ? `<table class="ledger">${dl.map((d) => `<tr><td>${DISASTER_NAMES[d.type]} · ${this.dateLabel(Math.floor(d.day / 30))}</td>
      <td>${d.destroyed} détruit(s) · ${d.casualties} victime(s) · ${Math.round(d.cost).toLocaleString('fr-FR')} €</td></tr>`).join('')}</table>` : '<p class="hint">Aucune catastrophe pour le moment.</p>';
    const hist = s.history;
    this.q('#charts').innerHTML = CHARTS.map((c) => this.chart(c, hist)).join('');
  }

  private dateLabel(month: number): string {
    const m = month + this.sim.env.startMonth;
    return `${MONTHS[m % 12]} an ${1 + Math.floor(m / 12)}`;
  }

  /** Courbe d'une seule série : le titre nomme la série, pas de légende. */
  private chart(c: ChartDef, hist: HistoryPoint[]): string {
    const last = hist.length ? c.format(c.value(hist[hist.length - 1])) : '–';
    if (hist.length < 2) {
      return `<figure class="chart"><figcaption><span>${c.title}</span><b>${last}</b></figcaption>
        <div class="chart-empty">Les données s'affichent après deux mois de jeu.</div></figure>`;
    }
    const vals = hist.map(c.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo > 0 && c.key !== 'balance') lo = 0;
    if (hi === lo) hi = lo + 1;
    const x = (i: number) => PAD_L + (i / (vals.length - 1)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(vals.length - 1).toFixed(1)},${y(lo).toFixed(1)}L${x(0).toFixed(1)},${y(lo).toFixed(1)}Z`;
    const zero = lo < 0 && hi > 0 ? `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : '';
    const lx = x(vals.length - 1), ly = y(vals[vals.length - 1]);
    const data = encodeURIComponent(JSON.stringify(hist.map((h, i) => [this.dateLabel(h.month), c.format(vals[i]), x(i), y(vals[i])])));
    return `<figure class="chart" data-points="${data}"><figcaption><span>${c.title}</span><b>${last}</b></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.title}">
        <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${H - PAD_B}" y2="${H - PAD_B}" class="axis"/>
        ${zero}
        <path d="${area}" class="area"/><path d="${line}" class="line"/>
        <circle cx="${lx}" cy="${ly}" r="4" class="end"/>
        <text x="${PAD_L}" y="${H - 3}" class="tick">${this.dateLabel(hist[0].month)}</text>
        <text x="${W - PAD_R}" y="${H - 3}" class="tick" text-anchor="end">${this.dateLabel(hist[hist.length - 1].month)}</text>
        <g class="crosshair" opacity="0"><line y1="${PAD_T}" y2="${H - PAD_B}"/><circle r="4"/></g>
      </svg><div class="chart-tip" hidden></div></figure>`;
  }

  private hover(e: PointerEvent): void {
    const fig = (e.target as HTMLElement).closest<HTMLElement>('figure.chart[data-points]');
    this.wrap.querySelectorAll<SVGGElement>('.crosshair').forEach((c) => { if (!fig?.contains(c)) c.setAttribute('opacity', '0'); });
    this.wrap.querySelectorAll<HTMLElement>('.chart-tip').forEach((t) => { if (!fig?.contains(t)) t.hidden = true; });
    if (!fig) return;
    const pts = JSON.parse(decodeURIComponent(fig.dataset.points!)) as Array<[string, string, number, number]>;
    const svg = fig.querySelector('svg')!;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[2] - vx) < Math.abs(best[2] - vx)) best = p;
    const g = fig.querySelector('.crosshair')!;
    g.setAttribute('opacity', '1');
    const l = g.querySelector('line')!;
    l.setAttribute('x1', String(best[2])); l.setAttribute('x2', String(best[2]));
    const c = g.querySelector('circle')!;
    c.setAttribute('cx', String(best[2])); c.setAttribute('cy', String(best[3]));
    const tip = fig.querySelector<HTMLElement>('.chart-tip')!;
    tip.hidden = false;
    tip.innerHTML = `<b>${best[1]}</b><span>${best[0]}</span>`;
    const left = (best[2] / W) * r.width;
    tip.style.left = `${Math.min(r.width - 90, Math.max(0, left - 45))}px`;
  }
}
