import { fmt } from '../input/ToolManager';
import type { LedgerEntry, Simulation } from '../sim/Simulation';
import {
  BUDGET_KEYS, BUDGET_NAMES, EARLY_REPAY_PENALTY, LOAN_OFFERS, MAX_LOANS, MAX_TAX, MIN_TAX, loanInterest, loanPayment, loanSchedule,
} from '../sim/economy';
import { KIND_COLORS, KIND_NAMES, ZONES } from '../sim/zones';
import { SERVICE_INFO, type Service } from '../sim/services';

const INCOME_NAMES: Record<string, string> = {
  residential: 'Impôts résidentiels', commercial: 'Impôts commerciaux', industrial: 'Impôts industriels', office: 'Impôts des bureaux',
  tickets: 'Billets de transport', energy: 'Vente d’électricité', recycling: 'Revente des matériaux recyclés', fees: 'Redevances (stationnement, terrasses)',
};
const EXPENSE_NAMES: Record<string, string> = {
  roads: 'Entretien courant des routes', loans: 'Remboursement des emprunts', reconstruction: 'Réparations et reconstruction', imports: 'Achats d’électricité et d’eau',
  policies: 'Politiques de quartier', ...BUDGET_NAMES,
};
const INVEST_NAMES: Record<string, string> = {
  roads: 'Routes', services: 'Équipements publics', utilities: 'Lignes haute tension', transport: 'Transports', buildings: 'Bâtiments posés ou améliorés',
  terrain: 'Terrassement et plantations', demolition: 'Démolitions', projects: 'Projets du conseil', renovation: 'Rénovations', other: 'Autres',
};
/** Regroupement des comptes (§9). */
const GROUPS: Array<[string, string[]]> = [
  ['Recettes fiscales', ['residential', 'commercial', 'industrial', 'office']],
  ['Recettes de services', ['tickets', 'energy', 'recycling', 'fees']],
  ['Fonctionnement', ['utilities', 'health', 'education', 'police', 'fire', 'parks', 'transport', 'roads', 'maintenance', 'imports', 'policies', 'reconstruction']],
  ['Dette', ['loans']],
];
type Tab = 'budget' | 'compare' | 'loans' | 'invest' | 'upkeep';
const TABS: Array<[Tab, string]> = [['budget', 'Budget'], ['compare', 'Comparer les périodes'], ['loans', 'Emprunts'], ['invest', 'Investissements'], ['upkeep', 'Entretien']];

/** Fenêtre Finances : impôts, budgets, comptes par rubrique, comparaison, dette, investissements, entretien. */
export class BudgetPanel {
  private wrap: HTMLElement;
  private tab: Tab = 'budget';
  private schedule = -1;
  private q = (sel: string) => this.wrap.querySelector(sel) as HTMLElement | null;

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
      const take = t.closest<HTMLElement>('[data-take]');
      if (take) { sim.takeLoan(Number(take.dataset.take)); this.render(); }
      const sch = t.closest<HTMLElement>('[data-schedule]');
      if (sch) { this.schedule = this.schedule === Number(sch.dataset.schedule) ? -1 : Number(sch.dataset.schedule); this.render(); }
      const repay = t.closest<HTMLElement>('[data-repay]');
      if (repay) { sim.repayLoan(Number(repay.dataset.repay)); this.render(); }
      const del = t.closest<HTMLElement>('[data-line]');
      if (del) { sim.removeLine(Number(del.dataset.line)); this.render(); }
      if (t.closest('[data-renovate-roads]')) { sim.renovate(sim.wornRoads()); this.render(); }
      const rs = t.closest<HTMLElement>('[data-renovate]');
      if (rs) { sim.renovate([Number(rs.dataset.renovate)]); this.render(); }
    });
    this.wrap.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.tax) sim.setTax(Number(input.dataset.tax) as never, Number(input.value));
      if (input.dataset.budget) sim.setBudget(input.dataset.budget as never, Number(input.value));
      const lbl = input.parentElement?.querySelector('b');
      if (lbl) lbl.textContent = `${input.value} %`;
      const led = this.q('#ledger');
      if (led) led.innerHTML = this.ledgerHtml();
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.render();
  }

  refresh(): void {
    if (!this.wrap.hidden && !(document.activeElement instanceof HTMLInputElement)) this.render();
  }

  private render(): void {
    const body = this.tab === 'budget' ? this.budget() : this.tab === 'compare' ? this.compare() : this.tab === 'loans' ? this.loans() : this.tab === 'invest' ? this.invest() : this.upkeep();
    const s = this.sim, net = s.stats.income - s.stats.expenses;
    this.wrap.innerHTML = `<div class="modal panel budget finances">
      <header><h2>Finances de la ville</h2><button class="close" aria-label="Fermer">×</button></header>
      <div class="kpis"><div><span>Trésorerie</span><b class="${s.money < 0 ? 'neg' : ''}">${Number.isFinite(s.money) ? fmt(s.money) : 'illimitée'}</b></div>
        <div><span>Solde du mois</span><b class="${net < 0 ? 'neg' : 'pos'}">${net >= 0 ? '+' : ''}${fmt(net)}</b></div>
        <div><span>Dette restante</span><b>${fmt(s.debt)}</b></div>
        <div><span>Investi ce mois</span><b>${fmt(Object.entries(s.investMonth).filter(([k]) => k !== 'debt').reduce((a, [, v]) => a + v, 0))}</b></div></div>
      <nav class="ntabs">${TABS.map(([t, l]) => `<button data-tab="${t}" class="${t === this.tab ? 'active' : ''}">${l}</button>`).join('')}</nav>
      ${body}</div>`;
  }

  private ledgerHtml(): string {
    const st = this.sim.stats;
    const all: Record<string, [number, number]> = {};
    for (const [k, v] of Object.entries(st.incomeBy)) all[k] = [v, 1];
    for (const [k, v] of Object.entries(st.expensesBy)) all[k] = [v, -1];
    let html = '';
    for (const [title, keys] of GROUPS) {
      const rows = keys.filter((k) => all[k]?.[0]).map((k) => `<tr><td>${INCOME_NAMES[k] ?? EXPENSE_NAMES[k] ?? k}</td><td class="${all[k][1] > 0 ? 'pos' : 'neg'}">${all[k][1] > 0 ? '+' : '−'}${fmt(all[k][0])}</td></tr>`).join('');
      if (rows) html += `<tr class="grp"><td colspan="2">${title}</td></tr>${rows}`;
    }
    const net = st.income - st.expenses;
    return `${html || '<tr><td class="muted">Pas encore de recettes</td><td></td></tr>'}
      <tr class="total"><td>Solde mensuel</td><td class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</td></tr>`;
  }

  /** Causes d'un déficit : postes qui ont le plus évolué par rapport au mois précédent. */
  private causes(): string {
    const s = this.sim, prev = s.ledger[s.ledger.length - 1];
    const net = s.stats.income - s.stats.expenses;
    if (!prev) return '';
    const deltas: Array<[string, number]> = [];
    for (const [k, v] of Object.entries(s.stats.expensesBy)) deltas.push([EXPENSE_NAMES[k] ?? k, -(v - (prev.expensesBy[k] ?? 0))]);
    for (const [k, v] of Object.entries(s.stats.incomeBy)) deltas.push([INCOME_NAMES[k] ?? k, v - (prev.incomeBy[k] ?? 0)]);
    const worst = deltas.filter(([, d]) => d < -50).sort((a, b) => a[1] - b[1]).slice(0, 3);
    if (!worst.length && net >= 0) return '';
    const big = Object.entries(s.stats.expensesBy).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${EXPENSE_NAMES[k] ?? k} (${fmt(v)})`);
    return `<div class="nalert ${net < 0 ? 'k-bad' : 'k-warn'}"><b>${net < 0 ? 'Pourquoi ce déficit ?' : 'À surveiller'}</b><br>
      ${worst.length ? `Par rapport au mois dernier : ${worst.map(([n, d]) => `${n} ${fmt(d)}`).join(' · ')}.<br>` : ''}
      Plus gros postes : ${big.join(', ')}.</div>`;
  }

  private budget(): string {
    const s = this.sim;
    const lines = s.transit.lines;
    return `${this.causes()}<div class="budget-grid">
      <section>
        <h3>Impôts (taux de la ville)</h3>
        <p class="hint">Plus d'impôts : plus de recettes, mais moins de demande et de popularité. Les quartiers peuvent les ajuster localement.</p>
        ${ZONES.map((z) => `<label class="slider" style="--c:${KIND_COLORS[z]}"><span>${KIND_NAMES[z]}</span>
          <input type="range" min="${MIN_TAX}" max="${MAX_TAX}" step="1" data-tax="${z}" value="${s.taxes[z]}"><b>${s.taxes[z]} %</b></label>`).join('')}
        <h3>Enveloppes des services</h3>
        <p class="hint">Le financement change la production des réseaux, la portée et les véhicules des services, et la vitesse d’usure du patrimoine.</p>
        ${BUDGET_KEYS.map((k) => `<label class="slider"><span>${BUDGET_NAMES[k]}</span>
          <input type="range" min="50" max="150" step="5" data-budget="${k}" value="${s.budgets[k]}"><b>${s.budgets[k]} %</b></label>`).join('')}
      </section>
      <section>
        <h3>Comptes du mois (estimation)</h3>
        <table class="ledger" id="ledger">${this.ledgerHtml()}</table>
        <h3>Lignes de transport</h3>
        ${lines.length ? lines.map((l) => `<div class="row"><div><i class="swatch" style="background:${l.color}"></i><b>${l.name}</b>
          <small>${l.stops.length} ${l.kind === 'bus' ? 'arrêts' : 'stations'}${l.kind === 'bus' ? ` · ${l.buses} bus` : ''} · ${l.lastMonth.toLocaleString('fr-FR')} voyageurs le mois dernier${l.broken ? ' · <span class="neg">interrompue</span>' : ''}</small></div>
          <button data-line="${l.id}" class="ghost danger">Supprimer</button></div>`).join('') : '<p class="hint">Aucune ligne.</p>'}
      </section></div>`;
  }

  private compare(): string {
    const L = this.sim.ledger;
    if (!L.length) return '<p class="hint">La comparaison sera disponible après le premier mois complet.</p>';
    const cur = L[L.length - 1], prev = L[L.length - 2], year = L[L.length - 13];
    const sum = (arr: LedgerEntry[], f: (e: LedgerEntry) => number) => arr.reduce((a, e) => a + f(e), 0);
    const last12 = L.slice(-12), prev12 = L.slice(-24, -12);
    // Flèche verte si l'évolution est favorable (recettes en hausse, dépenses en baisse)
    const cell = (v: number | undefined, ref?: number, cost = false) => {
      if (v === undefined) return '<td class="muted">–</td>';
      const d = ref !== undefined && ref !== 0 ? (v - ref) / Math.abs(ref) : null;
      const good = d !== null && (d > 0) !== cost;
      return `<td>${fmt(v)}${d !== null && Math.abs(d) >= 0.01 ? ` <small class="${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.round(Math.abs(d) * 100)} %</small>` : ''}</td>`;
    };
    const keys = new Set<string>();
    for (const e of [cur, prev, year]) if (e) { Object.keys(e.incomeBy).forEach((k) => keys.add(`i:${k}`)); Object.keys(e.expensesBy).forEach((k) => keys.add(`e:${k}`)); }
    const val = (e: LedgerEntry | undefined, key: string) => { if (!e) return undefined; const [t, k] = key.split(':'); return (t === 'i' ? e.incomeBy : e.expensesBy)[k] ?? 0; };
    const rows = [...keys].filter((k) => [cur, prev, year].some((e) => val(e, k))).sort((a, b) => (a[0] === b[0] ? (val(cur, b) ?? 0) - (val(cur, a) ?? 0) : a[0] === 'i' ? -1 : 1)).map((k) => {
      const [t, n] = k.split(':');
      return `<tr><td>${t === 'i' ? '＋ ' : '－ '}${(t === 'i' ? INCOME_NAMES[n] : EXPENSE_NAMES[n]) ?? n}</td>${cell(val(cur, k), val(prev, k), t === 'e')}${cell(val(prev, k))}${cell(val(year, k))}</tr>`;
    }).join('');
    const mname = (e?: LedgerEntry) => (e ? `Mois ${e.month}` : '–');
    return `<table class="ledger cmp"><tr class="grp"><td>Poste</td><td>${mname(cur)} (dernier)</td><td>${mname(prev)}</td><td>Il y a un an</td></tr>
        ${rows}
        <tr class="total"><td>Recettes</td>${cell(cur.income, prev?.income)}${cell(prev?.income)}${cell(year?.income)}</tr>
        <tr class="total"><td>Dépenses</td>${cell(cur.expenses, prev?.expenses, true)}${cell(prev?.expenses)}${cell(year?.expenses)}</tr>
        <tr class="total"><td>Investissements</td>${cell(cur.investTotal, prev?.investTotal)}${cell(prev?.investTotal)}${cell(year?.investTotal)}</tr>
        <tr class="total"><td>Dette en fin de mois</td>${cell(cur.debt, prev?.debt, true)}${cell(prev?.debt)}${cell(year?.debt)}</tr></table>
      <h3>Sur 12 mois</h3>
      <table class="ledger cmp"><tr class="grp"><td></td><td>12 derniers mois</td><td>12 mois précédents</td></tr>
        <tr><td>Recettes</td>${cell(sum(last12, (e) => e.income), prev12.length ? sum(prev12, (e) => e.income) : undefined)}${prev12.length ? cell(sum(prev12, (e) => e.income)) : '<td class="muted">–</td>'}</tr>
        <tr><td>Dépenses de fonctionnement</td>${cell(sum(last12, (e) => e.expenses), prev12.length ? sum(prev12, (e) => e.expenses) : undefined, true)}${prev12.length ? cell(sum(prev12, (e) => e.expenses)) : '<td class="muted">–</td>'}</tr>
        <tr><td>Investissements</td>${cell(sum(last12, (e) => e.investTotal))}${prev12.length ? cell(sum(prev12, (e) => e.investTotal)) : '<td class="muted">–</td>'}</tr>
      </table>
      <h3>Trésorerie</h3>${this.chart(L.map((e) => e.money))}`;
  }

  private chart(values: number[]): string {
    if (values.length < 2) return '';
    const W = 600, H = 90, min = Math.min(0, ...values), max = Math.max(...values, 1);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - ((v - min) / (max - min)) * H}`).join(' ');
    const zero = H - ((0 - min) / (max - min)) * H;
    return `<svg viewBox="0 0 ${W} ${H}" class="spark wide" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="mid"/><polyline points="${pts}"/></svg>`;
  }

  private loans(): string {
    const s = this.sim, cap = s.borrowingCapacity, debt = s.debt;
    const current = s.loans.map((l, i) => {
      const bal = s.loanBalance(l);
      const rows = loanSchedule(l).slice(l.months - l.remaining, l.months - l.remaining + 12);
      return `<div class="row"><div><b>${fmt(l.amount)}</b> à ${l.rate} % sur ${l.months} mois
          <small>${fmt(l.payment)}/mois · encore ${l.remaining} mois · capital restant ${fmt(bal)} · intérêts restants ${fmt(l.payment * l.remaining - bal)}</small></div>
          <div class="pbtn"><button data-schedule="${i}" class="ghost">Échéancier</button><button data-repay="${i}" class="ghost" title="Pénalité de ${EARLY_REPAY_PENALTY * 100} %">Rembourser ${fmt(bal * (1 + EARLY_REPAY_PENALTY))}</button></div></div>
        ${this.schedule === i ? `<table class="ledger sched"><tr class="grp"><td>Échéance</td><td>Mensualité</td><td>Intérêts</td><td>Capital</td><td>Reste dû</td></tr>
          ${rows.map((r) => `<tr><td>${r.month}</td><td>${fmt(r.payment)}</td><td>${fmt(r.interest)}</td><td>${fmt(r.principal)}</td><td>${fmt(r.balance)}</td></tr>`).join('')}</table>` : ''}`;
    }).join('');
    const offers = LOAN_OFFERS.map((o, i) => {
      const ok = s.loans.length < MAX_LOANS && debt + o.amount <= cap;
      return `<div class="row"><div><b>${fmt(o.amount)}</b> à ${o.rate} % sur ${o.months} mois
        <small>${fmt(loanPayment(o))}/mois · coût total ${fmt(o.amount + loanInterest(o))} (dont ${fmt(loanInterest(o))} d’intérêts) · remboursement anticipé : pénalité ${EARLY_REPAY_PENALTY * 100} %</small></div>
        <button data-take="${i}" class="ghost" ${ok ? '' : 'disabled'}>Emprunter</button></div>`;
    }).join('');
    return `<div class="kpis"><div><span>Dette restante</span><b>${fmt(debt)}</b></div><div><span>Capacité d’emprunt</span><b>${fmt(Math.max(0, cap - debt))}</b></div>
        <div><span>Mensualités</span><b>${fmt(s.loans.reduce((a, l) => a + l.payment, 0))}</b></div><div><span>Emprunts</span><b>${s.loans.length} / ${MAX_LOANS}</b></div></div>
      <p class="hint">La capacité d’emprunt totale vaut 18 mois de recettes moyennes (au moins 40 000 €).</p>
      ${current ? `<h3>Emprunts en cours</h3>${current}` : ''}
      <h3>Offres de la banque</h3>${offers}`;
  }

  private invest(): string {
    const s = this.sim, L = s.ledger;
    const cur = s.investMonth;
    const year: Record<string, number> = {};
    for (const e of L.slice(-12)) for (const [k, v] of Object.entries(e.invest)) if (k !== 'debt') year[k] = (year[k] ?? 0) + v;
    const keys = [...new Set([...Object.keys(cur), ...Object.keys(year)])].filter((k) => k !== 'debt');
    return `<p class="hint">Dépenses ponctuelles : constructions, extensions, grands projets. Chaque outil affiche son coût initial et son entretien mensuel avant construction.</p>
      <table class="ledger cmp"><tr class="grp"><td>Poste</td><td>Mois en cours</td><td>12 derniers mois</td></tr>
        ${keys.length ? keys.map((k) => `<tr><td>${INVEST_NAMES[k] ?? k}</td><td>${fmt(cur[k] ?? 0)}</td><td>${fmt(year[k] ?? 0)}</td></tr>`).join('') : '<tr><td class="muted">Aucun investissement</td><td></td><td></td></tr>'}
        <tr class="total"><td>Total</td><td>${fmt(keys.reduce((a, k) => a + (cur[k] ?? 0), 0))}</td><td>${fmt(keys.reduce((a, k) => a + (year[k] ?? 0), 0))}</td></tr></table>
      <h3>Investissements mois par mois</h3>${this.chart(L.map((e) => e.investTotal))}`;
  }

  private upkeep(): string {
    const s = this.sim, w = s.world;
    const worn = s.wornRoads();
    const roadCost = worn.reduce((a, k) => a + s.renovationCost(k), 0);
    let roads = 0, sum = 0;
    for (let k = 0; k < w.tiles.length; k++) if (w.tiles[k] === 1) { roads++; sum += w.condition[k]; }
    const svcs: number[] = [];
    for (let k = 0; k < w.service.length; k++) if (w.service[k]) svcs.push(k);
    svcs.sort((a, b) => w.condition[a] - w.condition[b]);
    return `<div class="kpis"><div><span>État moyen des routes</span><b>${roads ? Math.round(sum / roads) : 100} %</b></div><div><span>Routes usées (&lt; 50 %)</span><b>${worn.length}</b></div>
        <div><span>Budget d’entretien</span><b>${s.budgets.maintenance} %</b></div><div><span>Coût mensuel</span><b>${fmt(s.stats.expensesBy.maintenance ?? 0)}</b></div></div>
      <p class="hint">Le trafic use les routes, le temps use les équipements. Sous 50 %, les routes ralentissent et les équipements produisent moins ; sous 20 %, ils tombent en panne. Réglez l’enveloppe « Entretien du patrimoine » dans l’onglet Budget.</p>
      <div class="row"><div><b>Rénover toutes les routes usées</b><small>${worn.length} case(s)</small></div><button data-renovate-roads class="ghost" ${worn.length ? '' : 'disabled'}>Rénover · ${fmt(roadCost)}</button></div>
      <h3>Équipements les plus usés</h3>
      ${svcs.slice(0, 8).map((k) => `<div class="row"><div><b>${this.svcName(k)}</b><small>État ${Math.round(w.condition[k])} %${s.disasters.offline.has(k) ? ' · <span class="neg">en panne</span>' : ''}</small></div>
        <button data-renovate="${k}" class="ghost" ${w.condition[k] < 99 ? '' : 'disabled'}>Rénover · ${fmt(s.renovationCost(k))}</button></div>`).join('') || '<p class="hint">Aucun équipement.</p>'}`;
  }

  private svcName(k: number): string {
    const n = this.sim.world.size;
    return `${SERVICE_INFO[this.sim.world.service[k] as Exclude<Service, 0>].name} (${k % n}, ${Math.floor(k / n)})`;
  }
}
