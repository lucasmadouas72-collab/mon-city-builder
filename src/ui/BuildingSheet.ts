import type { Simulation } from '../sim/Simulation';
import type { ToolManager } from '../input/ToolManager';
import { fmt } from '../input/ToolManager';
import { BuildState, FLOORS, LEVEL_NAMES, STYLE_NAMES, ZONE_INFO, hasHomes, hasJobs, type ZoneId } from '../sim/zones';
import { SERVICE_INFO, UTILITIES, UTILITY_NAMES, Utility, type Service } from '../sim/services';
import { citizenName, companyName } from '../sim/names';
import { STATUS_NAMES } from '../sim/Citizens';
import { venueEvents } from '../sim/Tourism';

/** Mètres par case (pour l'emprise affichée). */
const TILE_M = 16;
const level3 = (v: number) => (v < 0.15 ? 'faible' : v < 0.4 ? 'moyen' : 'fort');

/**
 * Fiche complète d'un bâtiment (§6) : identifiant, catégorie, emprise, coûts, capacité, réseaux,
 * effets, état, niveau et conditions d'évolution, avec les actions possibles.
 */
export class BuildingSheet {
  private el: HTMLElement;
  private timer = 0;
  /** Ouvre l'organisation d'un événement sur ce lieu (fourni par l'interface). */
  onEvent?: (venue: number) => void;

  constructor(root: HTMLElement, private sim: Simulation, private tools: ToolManager) {
    this.el = document.createElement('aside');
    this.el.className = 'sheet panel';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      const sel = this.tools.selected;
      if (!b || sel === null) return;
      const act = b.dataset.act;
      if (act === 'close') this.tools.select(null);
      if (act === 'upgrade') { this.tools.undo?.record(() => this.sim.upgradeBuilding(sel)) ?? this.sim.upgradeBuilding(sel); this.render(); }
      if (act === 'rotate') { this.sim.rotateBuilding(sel); this.render(); }
      if (act === 'move') this.tools.startMove(sel);
      if (act === 'renovate') { this.sim.renovate([sel]); this.render(); }
      if (act === 'event') this.onEvent?.(sel);
      if (act === 'delete') this.tools.deleteSelected();
    });
    sim.events.on('buildingsChanged', () => { if (!this.el.hidden) this.render(); });
  }

  show(idx: number | null): void {
    clearInterval(this.timer);
    if (idx === null) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.render();
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  private render(): void {
    const idx = this.tools.selected;
    const w = this.sim.world;
    if (idx === null || !(w.bState[idx] || w.service[idx])) { this.tools.select(null); return; }
    this.el.innerHTML = w.service[idx] ? this.serviceHtml(idx) : this.buildingHtml(w.anchorOf(idx));
  }

  private serviceHtml(idx: number): string {
    const sim = this.sim, w = sim.world, ut = sim.utilities;
    const svc = w.service[idx] as Exclude<Service, 0>;
    const info = SERVICE_INFO[svc];
    const L = ut.loads.get(idx);
    return `<button class="close" data-act="close" aria-label="Fermer">×</button>
      <h3><i style="background:${info.color}"></i>${info.name}</h3>
      <div class="sub">Équipement municipal · case ${idx % w.size}, ${Math.floor(idx / w.size)}</div>
      <section><b>Fiche</b><dl>
        <dt>Catégorie</dt><dd>${info.category === 'utilities' ? 'Réseaux' : info.category === 'transport' ? 'Transport' : 'Service'}</dd>
        <dt>Emprise</dt><dd>1 × 1 case (${TILE_M * TILE_M} m²)</dd>
        <dt>Construction</dt><dd>${fmt(info.cost)}</dd>
        <dt>Entretien</dt><dd>${fmt(info.upkeep)} / mois</dd>
        <dt>Démolition</dt><dd>rembourse ${fmt(info.cost * 0.25)}</dd>
        ${info.capacity ? `<dt>Production</dt><dd>${info.capacity.toLocaleString('fr-FR')}</dd>` : ''}
        ${L?.capacity ? `<dt>Capacité</dt><dd>${L.used} / ${L.capacity}</dd>` : ''}
        ${info.radius ? `<dt>Portée</dt><dd>${info.radius} cases de route</dd>` : ''}
        <dt>Accès routier</dt><dd class="${ut.networkOf(idx) < 0 ? 'bad' : ''}">${ut.networkOf(idx) < 0 ? 'non relié' : 'oui'}</dd>
        <dt>État d’entretien</dt><dd class="${w.condition[idx] < 50 ? 'bad' : ''}">${Math.round(w.condition[idx])} %${w.condition[idx] < 50 ? ' (rendement réduit)' : ''}${sim.disasters.offline.has(idx) ? ' · en panne' : ''}</dd>
        ${w.district[idx] ? `<dt>Quartier</dt><dd>${sim.districts.nameAt(idx)}</dd>` : ''}
      </dl></section>
      ${info.leisure ? (() => { const f = sim.tourism.facilities.find((x) => x.tile === idx); return `<section><b>Fréquentation</b><dl>
        <dt>Visiteurs (mois dernier)</dt><dd>${(f?.visitors ?? 0).toLocaleString('fr-FR')} / ${info.leisure.capacity.toLocaleString('fr-FR')}</dd>
        <dt>Entrée</dt><dd>${info.leisure.ticket ? fmt(info.leisure.ticket) : 'gratuite'}</dd>
        <dt>Recettes (ville)</dt><dd>${fmt(f?.revenue ?? 0)} / mois</dd>
        <dt>Attrait touristique</dt><dd>+${Math.round(info.leisure.appeal * 100)} %</dd>
        <dt>Saison</dt><dd>affluence ×${sim.tourism.seasonFactor(svc).toFixed(1)}</dd></dl></section>`; })() : ''}
      <div class="actions">${venueEvents(svc).length ? '<button data-act="event" class="primary">Organiser un événement</button>' : ''}<button data-act="renovate" ${w.condition[idx] < 99 ? '' : 'disabled'}>Rénover · ${fmt(sim.renovationCost(idx))}</button><button data-act="move">Déplacer (${fmt(info.cost * 0.2)})</button><button data-act="delete" class="danger">Démolir</button></div>`;
  }

  private buildingHtml(a: number): string {
    const sim = this.sim, w = sim.world, ut = sim.utilities, soc = sim.society, c = soc.citizens;
    const zone = w.zones[a] as ZoneId;
    const info = ZONE_INFO[zone];
    const lot = w.lotTiles(a);
    const [gw, gh] = w.lotDims(a);
    const level = Math.max(1, w.bLevel[a]);
    const state = w.bState[a];
    let residents = 0, homeCap = 0, homes = 0, taken = 0, emp = 0, jobCap = 0, rev = 0, profit = 0, dmg = 0, happy = 0, crime = 0;
    for (const t of lot) {
      residents += c.residents[t]; homeCap += sim.homeCapacity(t); homes += soc.homesOf(t); taken += c.homesTaken[t];
      emp += c.employees[t]; jobCap += sim.jobCapacity(t); rev += soc.revenue[t]; profit += soc.profit[t];
      dmg = Math.max(dmg, w.bDamage[t]); happy += ut.happiness[t]; crime += ut.crime[t];
    }
    happy /= lot.length; crime /= lot.length;
    const occupancy = (homeCap + jobCap) ? (residents + emp) / (homeCap + jobCap) : 0;
    // État (§6) : construction, actif, sous-utilisé, endommagé, abandonné
    let stName: string, stCls: string;
    if (state === BuildState.Construction) { stName = 'En construction'; stCls = 's-warn'; }
    else if (state === BuildState.Abandoned) { stName = 'Abandonné'; stCls = 's-bad'; }
    else if (ut.fire[a]) { stName = 'En feu'; stCls = 's-bad'; }
    else if (dmg) { stName = `Endommagé (${dmg} %)`; stCls = 's-bad'; }
    else if (occupancy < 0.5) { stName = 'Sous-utilisé'; stCls = 's-warn'; }
    else { stName = 'Actif'; stCls = 's-ok'; }
    const floors = FLOORS[zone][level - 1];
    const style = STYLE_NAMES[w.styleOf(a)];
    const p = info.pollution;
    const nets = UTILITIES.map((u) => `${UTILITY_NAMES[u]} ${ut.hasUtility(a, u) ? '✓' : '<span class="bad">✗</span>'}`).join(' · ');
    const crit = state === BuildState.Built && level < 3 ? sim.evolutionCriteria(a) : [];
    const canUpgrade = state === BuildState.Built && level < 3 && ut.hasUtility(a, Utility.Power) && ut.hasUtility(a, Utility.Water) && (level < 2 || ut.hasUtility(a, Utility.Sewage));
    // Occupants
    let people = '';
    if (hasHomes(zone) && state === BuildState.Built) {
      const list: string[] = [];
      for (const t of lot) for (const h of c.householdsAt.get(t) ?? []) for (const m of c.members[h]) {
        if (list.length < 3) list.push(`${citizenName(c.hSeed[h], c.seed[m])}, ${Math.floor(c.age[m])} ans · ${STATUS_NAMES[c.status[m]]}`);
      }
      if (list.length) people = `<section><b>Quelques habitants</b>${list.map((l) => `<div class="sub" style="margin:0">${l}</div>`).join('')}</section>`;
    }
    const company = hasJobs(zone) && state === BuildState.Built ? `<section><b>Entreprise · ${companyName(a, zone)}</b><dl>
        <dt>Recettes</dt><dd>${fmt(rev)} / mois</dd>
        <dt>Bénéfice</dt><dd class="${profit < 0 ? 'bad' : ''}">${fmt(profit)} / mois</dd>
        ${zone === 9 || zone === 3 ? '' : `<dt>Visiteurs</dt><dd>≈ ${Math.round(rev / 35).toLocaleString('fr-FR')} / mois</dd>`}
      </dl></section>` : '';
    return `<button class="close" data-act="close" aria-label="Fermer">×</button>
      <h3><i style="background:${info.color}"></i>${info.name}</h3>
      <div class="sub">${info.buildings} · <span class="state ${stCls}">${stName}</span></div>
      <section><b>Identité</b><dl>
        <dt>Identifiant</dt><dd>B-${String(w.bId[a] || 0).padStart(5, '0')}</dd>
        <dt>Catégorie</dt><dd>${info.category}</dd>
        <dt>Style</dt><dd>${style}${w.bStyle[a] ? '' : ' (quartier)'}</dd>
        <dt>Origine</dt><dd>${w.bManual[a] ? 'posé à la main' : 'construit par le marché'}</dd>
        ${w.district[a] ? `<dt>Quartier</dt><dd>${sim.districts.nameAt(a)}</dd>` : ''}
      </dl></section>
      <section><b>Emprise</b><dl>
        <dt>Parcelle</dt><dd>${gw} × ${gh} case(s)</dd>
        <dt>Surface au sol</dt><dd>${(lot.length * TILE_M * TILE_M).toLocaleString('fr-FR')} m²</dd>
        <dt>Hauteur</dt><dd>≈ ${Math.round(floors * 3.2)} m (${floors} niv.)</dd>
      </dl></section>
      <section><b>Coûts</b><dl>
        <dt>Construction</dt><dd>${fmt(sim.constructionCost(zone, level, lot.length))}</dd>
        <dt>Entretien</dt><dd>${fmt(sim.ownerUpkeep(a))} / mois (propriétaire)</dd>
        <dt>Démolition</dt><dd>${fmt(sim.demolishCost(a))}</dd>
        ${level < 3 ? `<dt>Amélioration</dt><dd>${fmt(sim.upgradeCost(a))}</dd>` : ''}
      </dl></section>
      <section><b>Capacité</b><dl>
        ${homeCap || hasHomes(zone) ? `<dt>Habitants</dt><dd>${residents} / ${homeCap}</dd><dt>Logements</dt><dd>${taken} / ${homes}</dd>` : ''}
        ${jobCap || hasJobs(zone) ? `<dt>Employés</dt><dd>${emp} / ${jobCap}</dd>` : ''}
        <dt>Occupation</dt><dd>${Math.round(occupancy * 100)} %</dd>
      </dl></section>
      <section><b>Réseaux</b><div>${nets} · Route ${w.roadDist[a] <= 3 ? '✓' : '<span class="bad">✗</span>'}</div></section>
      <section><b>Effets</b><dl>
        <dt>Attractivité</dt><dd>${Math.round(happy * 100)} %</dd>
        <dt>Pollution émise</dt><dd>${level3((p.air + p.water * 0.5) * level / 3)}</dd>
        <dt>Bruit émis</dt><dd>${level3(p.noise * level / 4)}</dd>
        <dt>Sécurité</dt><dd>${crime > 0.4 ? '<span class="bad">faible</span>' : crime > 0.2 ? 'moyenne' : 'bonne'}</dd>
        <dt>Valeur foncière</dt><dd>${Math.round(sim.landValue(a) * 100)} %</dd>
      </dl></section>
      <section><b>${LEVEL_NAMES[level]}${level < 3 ? ' · conditions d’évolution' : ' · niveau maximal'}</b>
        ${crit.length ? `<ul class="crit">${crit.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${l}</li>`).join('')}</ul>` : ''}
        ${state === BuildState.Abandoned ? '<div class="sub">Rétablissez l’électricité, l’eau et l’accès routier : il sera réhabilité. Sinon il s’effondrera.</div>' : ''}
      </section>
      ${company}${people}
      <div class="sub" style="margin:4px 0 0">${info.rules}</div>
      <div class="actions">
        <button data-act="upgrade" ${canUpgrade ? '' : 'disabled'} title="Financer l’évolution au niveau suivant">Améliorer${level < 3 ? ` · ${fmt(sim.upgradeCost(a))}` : ''}</button>
        <button data-act="rotate" title="Touche R">Pivoter</button>
        <button data-act="move">Déplacer</button>
        <button data-act="delete" class="danger" title="Touche Suppr">Démolir · ${fmt(sim.demolishCost(a))}</button>
      </div>`;
  }
}
