import { fmt } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';
import {
  BUDGET_KEYS, BUDGET_NAMES, LOAN_OFFERS, MAX_LOANS, MAX_TAX, MIN_TAX, loanPayment,
} from '../sim/economy';
import { ZONE_INFO, ZONES } from '../sim/zones';

const INCOME_NAMES: Record<string, string> = {
  residential: 'Impôts résidentiels',
  commercial: 'Impôts commerciaux',
  industrial: 'Impôts industriels',
  office: 'Impôts des bureaux',
  tickets: 'Billets de transport',
};
const EXPENSE_NAMES: Record<string, string> = { roads: 'Entretien des routes', loans: 'Remboursement des emprunts', reconstruction: 'Réparations et reconstruction', ...BUDGET_NAMES };

/** Fenêtre Budget : impôts, budgets des services, emprunts, lignes de transport, bilan mensuel. */
export class BudgetPanel {
  private wrap: HTMLElement;
  private q = (sel: string) => this.wrap.querySelector(sel) as HTMLElement;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    this.wrap.innerHTML = `
      <div class="modal panel budget">
        <header><h2>Budget de la ville</h2><button class="close" aria-label="Fermer">×</button></header>
        <div class="budget-grid">
          <section>
            <h3>Impôts</h3>
            <p class="hint">Plus d'impôts : plus de recettes, mais moins de demande. Le résidentiel influence aussi le bonheur.</p>
            ${ZONES.map((z) => `<label class="slider" style="--c:${ZONE_INFO[z].color}">
              <span>${ZONE_INFO[z].name}</span>
              <input type="range" id="tax-${z}" min="${MIN_TAX}" max="${MAX_TAX}" step="1" data-tax="${z}">
              <b id="tax-v-${z}"></b></label>`).join('')}
            <h3>Budgets des services</h3>
            <p class="hint">Un budget plus élevé augmente la production des réseaux et le rayon des services.</p>
            ${BUDGET_KEYS.map((k) => `<label class="slider">
              <span>${BUDGET_NAMES[k]}</span>
              <input type="range" id="bud-${k}" min="50" max="150" step="5" data-budget="${k}">
              <b id="bud-v-${k}"></b></label>`).join('')}
          </section>
          <section>
            <h3>Bilan mensuel</h3>
            <table class="ledger" id="ledger"></table>
            <h3>Emprunts</h3>
            <div id="loans"></div>
            <h3>Lignes de transport</h3>
            <div id="lines"></div>
          </section>
        </div>
      </div>`;
    root.appendChild(this.wrap);

    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) this.toggle(false);
      const take = t.closest<HTMLElement>('[data-take]');
      if (take) { sim.takeLoan(Number(take.dataset.take)); this.refresh(); }
      const repay = t.closest<HTMLElement>('[data-repay]');
      if (repay) { sim.repayLoan(Number(repay.dataset.repay)); this.refresh(); }
      const del = t.closest<HTMLElement>('[data-line]');
      if (del) { sim.removeLine(Number(del.dataset.line)); this.refresh(); }
    });
    this.wrap.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.tax) sim.setTax(Number(input.dataset.tax) as never, Number(input.value));
      if (input.dataset.budget) sim.setBudget(input.dataset.budget as never, Number(input.value));
      this.refresh();
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.refresh();
  }

  refresh(): void {
    if (this.wrap.hidden) return;
    const s = this.sim;
    for (const z of ZONES) {
      const input = this.q(`#tax-${z}`) as HTMLInputElement;
      if (document.activeElement !== input) input.value = String(s.taxes[z]);
      this.q(`#tax-v-${z}`).textContent = `${s.taxes[z]} %`;
    }
    for (const k of BUDGET_KEYS) {
      const input = this.q(`#bud-${k}`) as HTMLInputElement;
      if (document.activeElement !== input) input.value = String(s.budgets[k]);
      this.q(`#bud-v-${k}`).textContent = `${s.budgets[k]} %`;
    }

    const st = s.stats;
    const rows = (obj: Record<string, number>, names: Record<string, string>, sign: string) =>
      Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `<tr><td>${names[k] ?? k}</td><td class="${sign === '+' ? 'pos' : 'neg'}">${sign}${fmt(v)}</td></tr>`).join('');
    const net = st.income - st.expenses;
    this.q('#ledger').innerHTML = `
      ${rows(st.incomeBy, INCOME_NAMES, '+') || '<tr><td class="muted">Pas encore de recettes</td><td></td></tr>'}
      ${rows(st.expensesBy, EXPENSE_NAMES, '−')}
      <tr class="total"><td>Solde mensuel</td><td class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</td></tr>`;

    const loans = s.loans.map((l, i) => `<div class="row">
        <div><b>${fmt(l.amount)}</b> à ${l.rate} %<small>${fmt(l.payment)}/mois · encore ${l.remaining} mois</small></div>
        <button data-repay="${i}" class="ghost">Rembourser ${fmt(s.loanBalance(l))}</button></div>`).join('');
    const offers = s.loans.length < MAX_LOANS ? LOAN_OFFERS.map((o, i) => `<div class="row">
        <div><b>${fmt(o.amount)}</b> à ${o.rate} %<small>${o.months} mois · ${fmt(loanPayment(o))}/mois</small></div>
        <button data-take="${i}" class="ghost">Emprunter</button></div>`).join('') : '<p class="hint">Nombre maximal d\'emprunts atteint.</p>';
    this.q('#loans').innerHTML = (loans ? `<div class="sub-title">En cours</div>${loans}` : '') + `<div class="sub-title">Offres de la banque</div>${offers}`;

    const lines = s.transit.lines;
    this.q('#lines').innerHTML = lines.length
      ? lines.map((l) => `<div class="row"><div><i class="swatch" style="background:${l.color}"></i><b>${l.name}</b>
          <small>${l.stops.length} ${l.kind === 'bus' ? 'arrêts' : 'stations'}${l.kind === 'bus' ? ` · ${l.buses} bus` : ''} · ${l.lastMonth.toLocaleString('fr-FR')} voyageurs le mois dernier${l.broken ? ' · <span class="neg">interrompue</span>' : ''}</small></div>
          <button data-line="${l.id}" class="ghost danger">Supprimer</button></div>`).join('')
      : '<p class="hint">Aucune ligne. Menu Transports : placez des arrêts, puis tracez une ligne.</p>';
  }
}
