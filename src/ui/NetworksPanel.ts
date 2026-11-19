import { fmt } from '../input/ToolManager';
import type { Simulation } from '../sim/Simulation';
import { POWER_EXPORT_PRICE, POWER_IMPORT_PRICE, WATER_IMPORT_PRICE } from '../sim/Simulation';

type Tab = 'power' | 'water' | 'sewage' | 'waste' | 'chain';
const TABS: Array<[Tab, string]> = [['power', 'Électricité'], ['water', 'Eau potable'], ['sewage', 'Assainissement'], ['waste', 'Déchets'], ['chain', 'Production']];
const SOURCES: Array<[string, string, string]> = [
  ['thermal', 'Thermique (gaz)', '#facc15'], ['nuclear', 'Nucléaire', '#c4b5fd'], ['hydro', 'Hydraulique', '#0ea5e9'], ['wind', 'Éolien', '#fde68a'],
  ['solar', 'Solaire', '#fbbf24'], ['waste', 'Incinération', '#78716c'], ['import', 'Importée', '#a3e635'],
];
const WASTE: Array<[string, string, string]> = [
  ['sorting', 'Tri', '#94a3b8'], ['recycling', 'Recyclage', '#10b981'], ['compost', 'Compostage', '#84cc16'], ['incineration', 'Incinération', '#78716c'],
];

const n = (v: number) => Math.round(v).toLocaleString('fr-FR');
const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Panneau des réseaux techniques (§10) et des flux de marchandises (§8, §22) :
 * production, consommation, pertes, stockage, traitement, alertes, échanges avec les voisins.
 */
export class NetworksPanel {
  private wrap: HTMLElement;
  private tab: Tab = 'power';

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('.close')) { this.toggle(false); return; }
      const b = t.closest<HTMLElement>('[data-tab]');
      if (b) { this.tab = b.dataset.tab as Tab; this.render(); }
    });
    this.wrap.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.policy) {
        (this.sim.utilities.policy as Record<string, boolean>)[el.dataset.policy] = el.checked;
        this.sim.recomputeStats();
        this.render();
      }
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.wrap.hidden) this.toggle(false); });
    sim.events.on('statsChanged', () => { if (!this.wrap.hidden) this.render(); });
  }

  toggle(force?: boolean, tab?: Tab): void {
    if (tab) this.tab = tab;
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.render();
  }

  private bar(parts: Array<[number, string, string]>, total: number): string {
    const t = Math.max(1, total);
    return `<div class="nbar">${parts.filter(([v]) => v > 0).map(([v, c, l]) => `<i style="width:${(v / t) * 100}%;background:${c}" title="${l} : ${n(v)}"></i>`).join('')}</div>`;
  }

  private alert(cond: boolean, kind: 'bad' | 'warn' | 'ok', text: string): string {
    return cond ? `<div class="nalert k-${kind}">${text}</div>` : '';
  }

  private render(): void {
    const body = this.tab === 'power' ? this.power() : this.tab === 'water' ? this.water() : this.tab === 'sewage' ? this.sewage() : this.tab === 'waste' ? this.waste() : this.chain();
    this.wrap.innerHTML = `<div class="modal panel stats networks">
      <header><h2>Réseaux et production</h2><button class="close" aria-label="Fermer">×</button></header>
      <nav class="ntabs">${TABS.map(([t, l]) => `<button data-tab="${t}" class="${t === this.tab ? 'active' : ''}">${l}</button>`).join('')}</nav>
      ${body}</div>`;
  }

  private power(): string {
    const p = this.sim.utilities.stats.power, pol = this.sim.utilities.policy;
    const pot = this.sim.world.energyPotential();
    const prod = SOURCES.reduce((a, [k]) => a + (p.production[k] ?? 0), 0);
    const demand = p.consumption + p.losses;
    const subs = [...this.sim.utilities.substations.values()];
    return `
      ${this.alert(p.deficit > 0, 'bad', `Déficit de ${n(p.deficit)} : des bâtiments sont privés de courant. Construisez une centrale, reliez les réseaux par une ligne haute tension ou autorisez les achats.`)}
      ${this.alert(p.overloaded > 0, 'warn', `${p.overloaded} sous-station(s) en surcharge : pertes accrues. Ajoutez une sous-station à proximité.`)}
      ${this.alert(p.deficit === 0 && prod > 0 && prod < demand * 1.1, 'warn', 'Marge de production faible (moins de 10 %).')}
      <div class="kpis"><div><span>Production</span><b>${n(prod)}</b></div><div><span>Consommation</span><b>${n(p.consumption)}</b></div>
        <div><span>Pertes en ligne</span><b>${n(p.losses)} (${pct(demand ? p.losses / demand : 0)})</b></div><div><span>Bilan</span><b class="${prod - demand < 0 ? 'neg' : ''}">${n(prod - demand)}</b></div></div>
      <h3>Production par source</h3>
      ${this.bar(SOURCES.map(([k, l, c]) => [p.production[k] ?? 0, c, l]), Math.max(prod, demand))}
      <dl class="facts">${SOURCES.filter(([k]) => (p.production[k] ?? 0) > 0).map(([k, l, c]) => `<dt><i class="sw" style="background:${c}"></i>${l}</dt><dd>${n(p.production[k])}</dd>`).join('') || '<dt>Aucune centrale</dt><dd>–</dd>'}</dl>
      <div class="stats-grid">
        <section><h3>Distribution</h3><dl class="facts">
          <dt>Sous-stations</dt><dd>${p.substations}</dd>
          ${subs.slice(0, 6).map(([load, cap], k) => `<dt>Sous-station ${k + 1}</dt><dd class="${load > cap ? 'neg' : ''}">${n(load)} / ${n(cap)}</dd>`).join('')}
          <dt>Pertes</dt><dd>2 % près d’une centrale ou d’une sous-station (14 cases), jusqu’à 25 % au loin</dd>
        </dl></section>
        <section><h3>Échanges avec les villes voisines</h3>
          <label class="ncheck"><input type="checkbox" data-policy="importPower" ${pol.importPower ? 'checked' : ''}> Acheter en cas de déficit (${POWER_IMPORT_PRICE} € l’unité)</label>
          <label class="ncheck"><input type="checkbox" data-policy="exportPower" ${pol.exportPower ? 'checked' : ''}> Vendre le surplus (${POWER_EXPORT_PRICE} € l’unité)</label>
          <dl class="facts"><dt>Achats</dt><dd>${n(p.imported)} · ${fmt(p.imported * POWER_IMPORT_PRICE)}/mois</dd><dt>Ventes</dt><dd>${n(p.exported)} · ${fmt(p.exported * POWER_EXPORT_PRICE)}/mois</dd></dl>
          <p class="hint">Il faut une interconnexion régionale (près du bord de la carte) reliée au réseau.</p>
        </section>
      </div>
      <h3>Potentiel énergétique de la région</h3>
      <dl class="facts"><dt>Éolien</dt><dd>${pct(pot.wind)}</dd><dt>Solaire</dt><dd>${pct(pot.solar)} · aujourd’hui ${pct(this.sim.utilities.solarFactor)}</dd><dt>Hydraulique</dt><dd>${pct(pot.hydro)} · débit ${pct(this.sim.utilities.hydroFactor)}</dd></dl>`;
  }

  private water(): string {
    const ws = this.sim.utilities.stats.water, pol = this.sim.utilities.policy;
    let contaminated = 0;
    for (let k = 0; k < this.sim.utilities.contaminated.length; k++) contaminated += this.sim.utilities.contaminated[k];
    const supply = ws.captage + ws.imported;
    const treatedShare = ws.captage ? ws.treated / ws.captage : 1;
    const stage = (name: string, v: number, sub: string, ok: boolean) => `<div class="nstage ${ok ? '' : 'bad'}"><span>${name}</span><b>${n(v)}</b><small>${sub}</small></div>`;
    return `
      ${this.alert(ws.deficit > 0, 'bad', `Pénurie de ${n(ws.deficit)} : des bâtiments n’ont pas d’eau. Ajoutez une station de pompage, un château d’eau ou autorisez les achats.`)}
      ${this.alert(contaminated > 0, 'bad', `${contaminated} bâtiment(s) reçoivent une eau contaminée (carte « Pollution de l’eau »). Une usine de traitement et l’épuration des eaux usées règlent le problème.`)}
      ${this.alert(ws.lowPressure > 0, 'warn', `${ws.lowPressure} bâtiment(s) en basse pression : trop loin d’une station ou d’un château d’eau.`)}
      <h3>Cycle de l’eau</h3>
      <div class="nchain">
        ${stage('Captage', ws.captage, 'stations de pompage', ws.captage > 0)}<i>→</i>
        ${stage('Traitement', ws.treated, `${pct(treatedShare)} de l’eau traitée`, treatedShare > 0.5 || ws.captage === 0)}<i>→</i>
        ${stage('Stockage', ws.storage, `sur ${n(ws.storageCap)} · ${n(ws.fromStorage)} puisés`, ws.storageCap === 0 || ws.storage > ws.storageCap * 0.2)}<i>→</i>
        ${stage('Distribution', ws.consumption, `demande · ${ws.lowPressure} en basse pression`, ws.deficit === 0)}
      </div>
      <div class="kpis"><div><span>Disponible</span><b>${n(supply)}</b></div><div><span>Demande</span><b>${n(ws.consumption)}</b></div><div><span>Achetée</span><b>${n(ws.imported)}</b></div><div><span>Bâtiments contaminés</span><b>${contaminated}</b></div></div>
      <h3>Achats aux villes voisines</h3>
      <label class="ncheck"><input type="checkbox" data-policy="importWater" ${pol.importWater ? 'checked' : ''}> Acheter de l’eau en cas de pénurie (${WATER_IMPORT_PRICE} € l’unité, ${fmt(ws.imported * WATER_IMPORT_PRICE)}/mois)</label>
      <p class="hint">La capacité de chaque étape limite le débit : une eau non traitée se contamine plus facilement, un château d’eau couvre les pénuries passagères et assure la pression à 16 cases (les tours en ont besoin).</p>`;
  }

  private sewage(): string {
    const s = this.sim.utilities.stats.sewage;
    return `
      ${this.alert(s.overflow > 0, 'bad', `Débordement : ${n(s.overflow)} d’eaux usées rejetées sans traitement dans la nature. Construisez une station d’épuration.`)}
      <div class="kpis"><div><span>Eaux usées collectées</span><b>${n(s.collected)}</b></div><div><span>Capacité d’épuration</span><b>${n(s.capacity)}</b></div><div><span>Rejets non traités</span><b class="${s.overflow ? 'neg' : ''}">${n(s.overflow)}</b></div><div><span>Taux d’épuration</span><b>${pct(s.collected ? Math.min(1, s.capacity / s.collected) : 1)}</b></div></div>
      ${this.bar([[Math.min(s.collected, s.capacity), '#a78b6f', 'Épuré'], [s.overflow, '#ef4444', 'Rejeté']], s.collected)}
      <p class="hint">Les rejets non traités polluent les rivières et les lacs ; une station de pompage en aval distribue alors une eau contaminée. Sans épuration, les immeubles ne passent pas au niveau 3.</p>`;
  }

  private waste(): string {
    const st = this.sim.waste.stats;
    const total = WASTE.reduce((a, [k]) => a + (st.processed[k] ?? 0), 0) + st.landfilled;
    return `
      ${this.alert(st.saturated, 'bad', 'Saturation : les centres ne peuvent plus traiter les déchets apportés, les camions restent au dépôt. Ajoutez des capacités de traitement ou une décharge.')}
      ${this.alert(st.accumulating > 0, 'warn', `Accumulation : ${st.accumulating} bâtiment(s) attendent la collecte depuis plus de 10 jours (carte « Déchets »).`)}
      ${this.alert(st.landfillCap > 0 && st.landfillUsed > st.landfillCap * 0.85, 'warn', `Les décharges sont pleines à ${pct(st.landfillUsed / st.landfillCap)}.`)}
      <div class="kpis"><div><span>Production</span><b>${n(st.produced)} t/mois</b></div><div><span>Collecté ce mois</span><b>${n(st.collected)} t</b></div><div><span>En attente</span><b>${n(st.waiting)} t</b></div><div><span>Camions en tournée</span><b>${st.trucksBusy} / ${st.trucks}</b></div></div>
      <h3>Traitement ce mois-ci</h3>
      ${this.bar([...WASTE.map(([k, l, c]) => [st.processed[k] ?? 0, c, l] as [number, string, string]), [st.landfilled, '#a16207', 'Décharge']], total)}
      <dl class="facts">${WASTE.map(([k, l, c]) => `<dt><i class="sw" style="background:${c}"></i>${l}</dt><dd>${n(st.processed[k] ?? 0)} t</dd>`).join('')}
        <dt><i class="sw" style="background:#a16207"></i>Décharge</dt><dd>${n(st.landfilled)} t</dd>
        <dt>Capacité de traitement</dt><dd>${n(st.capacity)} t/mois</dd>
        <dt>Décharges</dt><dd>${n(st.landfillUsed)} / ${n(st.landfillCap)} t</dd>
        <dt>Recettes du recyclage</dt><dd>${fmt(st.recyclingIncome)}</dd></dl>
      <p class="hint">Les camions partent des centres de tri, décharges, incinérateurs, centres de recyclage et de compostage, et collectent autour des quartiers les plus chargés. Recyclage : recettes ; compost : meilleur rendement agricole ; incinération : électricité.</p>`;
  }

  private chain(): string {
    const c = this.sim.society.chain, soc = this.sim.society;
    const box = (title: string, rows: Array<[string, number, string?]>) => `<div class="nbox"><b>${title}</b>${rows.map(([l, v, cls]) => `<div class="${cls ?? ''}"><span>${l}</span><em>${fmt(v)}</em></div>`).join('')}</div>`;
    return `
      ${this.alert(c.unsold > 0, 'warn', `${fmt(c.unsold)} de marchandises invendues ce mois : capacités d’export et de stockage dépassées. Zonez de la logistique.`)}
      ${this.alert(c.rawNeed > 0 && c.rawImport > c.rawNeed * 0.6, 'warn', 'L’industrie importe l’essentiel de ses matières premières (plus cher) : zonez de l’agriculture, de la sylviculture ou des mines.')}
      <div class="nflow">
        ${box('Secteur primaire', [['Cultures', c.crops], ['Bois', c.wood], ['Minerai', c.ore]])}<i>→</i>
        ${box('Matières premières', [['Besoin de l’industrie', c.rawNeed], ['Fournies localement', c.rawLocal], ['Importées (+30 %)', c.rawImport, c.rawImport ? 'neg' : ''], ['Exportées', c.rawExport]])}<i>→</i>
        ${box('Industrie', [['Production', c.produced], ['Vendue en ville', c.goodsLocal], ['Exportée', c.goodsExport], ['Biens importés', c.goodsImport, c.goodsImport ? 'neg' : '']])}<i>→</i>
        ${box('Commerces et ménages', [['Alimentation demandée', c.foodDemand], ['dont produite ici', c.foodLocal], ['Biens demandés', c.manufDemand], ['Coût de la vie', 0]]).replace(`<em>${fmt(0)}</em>`, `<em>${Math.round(soc.costOfLiving * 100)}</em>`)}
      </div>
      <div class="stats-grid">
        <section><h3>Stocks et logistique</h3><dl class="facts">
          <dt>Stock de biens</dt><dd>${fmt(c.goodsStock)}</dd><dt>Stock de matières premières</dt><dd>${fmt(c.rawStock)}</dd>
          <dt>Capacité de stockage</dt><dd>${fmt(c.storageCap)}</dd><dt>Capacité d’export</dt><dd>${fmt(c.exportCap)} / mois</dd>
          <dt>Flux pris en charge par la logistique</dt><dd>${pct(soc.logisticsShare)}</dd><dt>Invendus</dt><dd>${fmt(c.unsold)}</dd>
        </dl></section>
        <section><h3>Rendements</h3><dl class="facts">
          <dt>Bonus de la recherche (industrie)</dt><dd>+${pct(soc.innovation)}</dd><dt>Bonus du compost (agriculture)</dt><dd>+${pct(this.sim.waste.compostBoost)}</dd>
          <dt>Terres fertiles</dt><dd>×1,3 sur la carte « Ressources »</dd><dt>Mines hors gisement</dt><dd>impossibles</dd>
        </dl></section>
      </div>
      <p class="hint">Valeurs en euros par mois. Les camions de marchandises circulent entre producteurs, entrepôts et commerces selon ces flux.</p>`;
  }
}
