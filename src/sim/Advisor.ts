import type { Simulation } from './Simulation';
import { BuildState, Zone, hasHomes } from './zones';
import { Coverage, SERVICE_INFO, Service, Utility, UTILITY_NAMES } from './services';
import { BUDGET_NAMES } from './economy';
import { DISASTER_NAMES } from './Disasters';

/**
 * Diagnostic : chaque problème est accompagné de ses causes probables, des actions possibles,
 * d'une case à montrer et de la carte de données utile.
 */

export type Severity = 'critical' | 'serious' | 'warning' | 'good';
export const SEVERITY_NAMES: Record<Severity, string> = { critical: 'Critique', serious: 'Important', warning: 'À surveiller', good: 'Bon' };
const ORDER: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, good: 3 };

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  causes: string[];
  actions: string[];
  tile?: number;
  view?: string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const n = (v: number) => Math.round(v).toLocaleString('fr-FR');

export function diagnose(sim: Simulation): Issue[] {
  const w = sim.world, ut = sim.utilities, us = ut.stats, st = sim.stats;
  const out: Issue[] = [];
  const built: number[] = [];
  for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Built) built.push(k);
  if (!built.length) {
    out.push({
      id: 'start', severity: 'good', title: 'Votre ville attend ses premiers habitants',
      causes: ['Aucun bâtiment construit pour le moment.'],
      actions: ['Tracez une route, puis zonez du résidentiel le long de la route.', 'Construisez une centrale et une station de pompage, reliées au même réseau routier.'],
    });
    return out;
  }
  const hasService = (s: Service) => w.service.some((v) => v === s);
  const firstWithout = (pred: (k: number) => boolean) => built.find(pred);

  // ----- Réseaux -----
  const producers: Record<number, Service[]> = {
    [Utility.Power]: [Service.PowerPlant, Service.WindTurbine, Service.NuclearPlant, Service.SolarFarm, Service.HydroDam, Service.Incinerator, Service.Interconnect],
    [Utility.Water]: [Service.WaterPump, Service.Interconnect],
    [Utility.Sewage]: [Service.Sewage], [Utility.Garbage]: [Service.Landfill, Service.LandfillSite, Service.Incinerator, Service.Recycling, Service.Composting],
  };
  const utilActions: Record<number, string> = {
    [Utility.Power]: 'Construire une centrale (gaz, solaire, éolien, barrage, nucléaire) ou relier les réseaux par une ligne haute tension (menu Réseaux).',
    [Utility.Water]: "Construire une station de pompage au bord de l'eau (menu Réseaux).",
    [Utility.Sewage]: "Construire une station d'épuration au bord de l'eau (menu Réseaux).",
    [Utility.Garbage]: 'Construire un centre de tri, une décharge ou un centre de recyclage : leurs camions font des tournées (menu Réseaux).',
  };
  const utilView = ['power', 'water', 'sewage', 'garbage'];
  for (const u of [Utility.Power, Utility.Water, Utility.Sewage, Utility.Garbage]) {
    const served = us.served[u];
    if (served >= 0.98) continue;
    const without = firstWithout((k) => !ut.hasUtility(k, u));
    const causes: string[] = [];
    const actions = [utilActions[u]];
    const any = producers[u].some(hasService);
    if (!any) causes.push(`Aucun équipement ne produit ${UTILITY_NAMES[u].toLowerCase() === 'eau' ? "d'eau" : `de ${UTILITY_NAMES[u].toLowerCase()}`}.`);
    else if (us.demand[u] > us.supply[u]) causes.push(`La consommation (${n(us.demand[u])}) dépasse la production (${n(us.supply[u])}).`);
    if (any && without !== undefined && ut.networkOf(without) >= 0 && us.demand[u] <= us.supply[u]) {
      causes.push("Ce quartier est sur un réseau séparé, qui n'est relié à aucun équipement.");
      actions.push(u === Utility.Power ? 'Relier ce quartier par une route ou une ligne haute tension.' : 'Relier ce quartier au reste de la ville par une route.');
    }
    if (u <= Utility.Water) actions.push(`Augmenter le budget « ${BUDGET_NAMES.utilities} » pour produire davantage.`);
    out.push({
      id: `util-${u}`, severity: u <= Utility.Water ? (served < 0.8 ? 'critical' : 'serious') : 'warning',
      title: `${UTILITY_NAMES[u]} : ${pct(1 - served)} des bâtiments non desservis`, causes, actions, tile: without, view: utilView[u],
    });
  }
  // ----- Détails des réseaux (§10) -----
  const ps = us.power, wsx = us.water, sw = us.sewage, wst = sim.waste.stats;
  if (ps.overloaded) out.push({ id: 'overload', severity: 'warning', title: `${ps.overloaded} sous-station(s) en surcharge`, causes: ['La consommation des quartiers dépasse la capacité de transformation : les pertes augmentent.'], actions: ['Construire une sous-station supplémentaire dans le quartier.', 'Augmenter le budget des réseaux.'], view: 'power' });
  const lossShare = ps.consumption ? ps.losses / (ps.consumption + ps.losses) : 0;
  if (lossShare > 0.08 && ps.consumption > 500) out.push({ id: 'losses', severity: 'warning', title: `Pertes en ligne élevées (${pct(lossShare)})`, causes: ['Des quartiers sont loin de toute centrale ou sous-station.'], actions: ['Construire des sous-stations près des quartiers éloignés.'], view: 'power' });
  if (sw.overflow > 0 && sw.collected > 300) out.push({ id: 'sewage-overflow', severity: 'serious', title: `Débordement des eaux usées (${n(sw.overflow)} non traitées)`, causes: ['La capacité d’épuration est dépassée : les eaux usées polluent les rivières.'], actions: ['Construire une station d’épuration supplémentaire.'], view: 'waterPol' });
  if (wsx.lowPressure > 5) out.push({ id: 'pressure', severity: 'warning', title: `${n(wsx.lowPressure)} bâtiment(s) en basse pression d’eau`, causes: ['Trop loin d’une station de pompage ou d’un château d’eau (16 cases pour les tours).'], actions: ['Construire un château d’eau dans le quartier.'], view: 'water' });
  if (wsx.captage > 2000 && wsx.treated < wsx.captage * 0.5 && st.population > 1000) out.push({ id: 'treatment', severity: 'warning', title: 'Eau peu traitée', causes: [`Seulement ${pct(wsx.captage ? wsx.treated / wsx.captage : 0)} de l’eau pompée est traitée : risque de contamination.`], actions: ['Construire une usine de traitement d’eau.'], view: 'water' });
  if (wst.saturated) out.push({ id: 'waste-saturated', severity: 'serious', title: 'Centres de déchets saturés', causes: [`${n(wst.waiting)} t attendent d’être traitées ; les camions ne partent plus.`], actions: ['Construire un incinérateur, un centre de recyclage ou une décharge.'], view: 'garbage' });
  else if (wst.accumulating > built.length * 0.1 && wst.trucks > 0) out.push({ id: 'waste-trucks', severity: 'warning', title: `Collecte insuffisante (${n(wst.accumulating)} bâtiments)`, causes: [`Tous les camions sont en tournée (${wst.trucksBusy}/${wst.trucks}) ou les quartiers sont trop loin des centres.`], actions: ['Construire un centre de collecte plus près des quartiers concernés.', 'Augmenter le budget des réseaux (plus de camions).'], view: 'garbage' });
  if (wst.landfillCap && wst.landfillUsed > wst.landfillCap * 0.85) out.push({ id: 'landfill-full', severity: 'warning', title: `Décharges pleines à ${pct(wst.landfillUsed / wst.landfillCap)}`, causes: ['Les déchets non recyclés ni incinérés s’entassent.'], actions: ['Construire une nouvelle décharge, ou recycler et incinérer davantage.'], view: 'garbage' });
  const chain = sim.society.chain;
  if (chain.unsold > 2000) out.push({ id: 'unsold', severity: 'warning', title: 'Marchandises invendues', causes: ['La production dépasse ce que la ville consomme et peut exporter ou stocker.'], actions: ['Zoner de la logistique (export et stockage).', 'Moins d’industrie, plus de commerces.'] });
  if (chain.rawNeed > 3000 && chain.rawImport > chain.rawNeed * 0.7) out.push({ id: 'raw-import', severity: 'warning', title: 'Matières premières importées', causes: [`${pct(chain.rawImport / chain.rawNeed)} des matières premières de l’industrie sont importées (30 % plus chères).`], actions: ['Zoner de l’agriculture, de la sylviculture ou de l’extraction (carte « Ressources naturelles »).'], view: 'resources' });

  // ----- Entretien du patrimoine -----
  const worn = sim.wornRoads();
  let wornSvc = 0, firstWornSvc: number | undefined;
  for (let k = 0; k < w.service.length; k++) if (w.service[k] && w.condition[k] < 50) { wornSvc++; firstWornSvc ??= k; }
  if (worn.length > 10 || wornSvc) {
    out.push({
      id: 'worn', severity: wornSvc > 2 || worn.length > 80 ? 'serious' : 'warning', title: `Patrimoine usé : ${n(worn.length)} case(s) de route, ${wornSvc} équipement(s) sous 50 %`,
      causes: ['Le trafic use les routes ; les équipements vieillissent.', sim.budgets.maintenance < 100 ? `Budget d’entretien réduit (${sim.budgets.maintenance} %).` : 'Le budget d’entretien ne suffit pas sur les axes les plus chargés.'],
      actions: ['Augmenter le budget « Entretien du patrimoine ».', 'Rénover depuis la fiche d’un équipement ou dans Finances → Entretien.', 'Politique de quartier « Priorité d’entretien ».'],
      tile: firstWornSvc ?? worn[0], view: 'condition',
    });
  }

  // ----- Transports (§12) -----
  const tr = sim.transit;
  const over = tr.lines.filter((l) => tr.info(l).status === 'overloaded');
  if (over.length) out.push({ id: 'lines-full', severity: 'warning', title: `${over.length} ligne(s) surchargée(s)`, causes: [`${over.map((l) => l.name).join(', ')} : capacité atteinte, des voyageurs reprennent la voiture.`], actions: ['Ajouter des véhicules (Transports → Gérer les lignes).', 'Créer une ligne parallèle ou un mode plus capacitaire (tram, métro).'], view: 'transport' });
  const nodepot = tr.lines.filter((l) => l.reason.startsWith('Sans dépôt') || l.reason.startsWith('Aucun dépôt'));
  if (nodepot.length) out.push({ id: 'depot', severity: 'warning', title: 'Lignes sans dépôt', causes: [`${nodepot.map((l) => l.name).join(', ')} : ${nodepot[0].reason.toLowerCase()}.`], actions: ['Construire le dépôt correspondant (menu Transports).'] });
  if (sim.accidentsLastMonth >= 5) out.push({ id: 'accidents', severity: sim.accidentsLastMonth > 12 ? 'serious' : 'warning', title: `${sim.accidentsLastMonth} accidents le mois dernier`, causes: ['Routes saturées et météo défavorable.'], actions: ['Désengorger les axes (voies supplémentaires, transports en commun).', 'Zones 30 dans les quartiers résidentiels.'], view: 'volume' });
  let parkingBad = 0;
  for (let k = 0; k < sim.parkingPressure.length; k++) if (sim.parkingPressure[k] > 1.3) parkingBad++;
  if (parkingBad > 8) out.push({ id: 'parking', severity: 'warning', title: `Stationnement saturé autour de ${parkingBad} commerces ou bureaux`, causes: ['Pas assez de places sur voirie pour les employés et les clients : les ventes baissent.'], actions: ['Construire des parkings (menu Transports).', 'Développer les transports en commun et le vélo.'], view: 'parking' });

  const abandoning = built.filter((k) => ut.problemDays[k] > 0);
  if (abandoning.length) {
    out.push({
      id: 'abandon', severity: 'serious', title: `${n(abandoning.length)} bâtiment(s) menacé(s) d'abandon`,
      causes: ["Ils n'ont pas d'électricité ou d'eau depuis plusieurs jours."],
      actions: ['Rétablir l\'électricité et l\'eau (voir les alertes Réseaux).'], tile: abandoning[0], view: 'power',
    });
  }

  // ----- Écoles et cliniques -----
  const r = ut.reach;
  const saturated = [...ut.loads].filter(([s, L]) => w.service[s] === Service.School && L.capacity && L.used / L.capacity >= 0.95);
  if (r.unschooled > 10 || saturated.length) {
    const causes: string[] = [];
    if (!hasService(Service.School)) causes.push("La ville n'a pas encore d'école.");
    if (r.seats && r.students > r.seats) causes.push(`${n(r.students)} élèves pour ${n(r.seats)} places : la population a augmenté plus vite que les écoles.`);
    else if (r.unschooled > 0) causes.push(`${n(r.unschooled)} élèves habitent trop loin d'une école qui a de la place (mauvaise répartition).`);
    if (saturated.length) causes.push(`${saturated.length} école(s) complète(s).`);
    out.push({
      id: 'school', severity: r.unschooled > r.students * 0.3 ? 'serious' : 'warning',
      title: `${n(r.unschooled)} élève(s) sans place à l'école`, causes,
      actions: ['Construire une école dans les quartiers concernés.', `Augmenter le budget « ${BUDGET_NAMES.education} » (plus de places, plus grande portée).`],
      tile: saturated[0]?.[0] ?? firstWithout((k) => hasHomes(w.zones[k]) && !(ut.coverage[k] & Coverage.Education)), view: 'education',
    });
  }
  const busy = [...ut.loads].filter(([s, L]) => w.service[s] === Service.Clinic && L.wait > 3);
  if (r.untreated > 3 || busy.length) {
    out.push({
      id: 'health', severity: r.untreated > r.patients * 0.3 ? 'serious' : 'warning',
      title: `${n(r.untreated)} malade(s) sans soins${busy.length ? ` · attente de ${busy[0][1].wait.toFixed(0)} jours` : ''}`,
      causes: [!hasService(Service.Clinic) ? "La ville n'a pas de clinique." : r.patients > r.beds ? `${n(r.patients)} patients pour ${n(r.beds)} places.` : 'Certains quartiers sont trop loin d\'une clinique.',
        ...(us.air > 0.15 ? ["La pollution de l'air rend des habitants malades."] : [])],
      actions: ['Construire une clinique près des quartiers concernés.', `Augmenter le budget « ${BUDGET_NAMES.health} ».`, ...(us.air > 0.15 ? ['Éloigner l\'industrie des logements, planter des arbres.'] : [])],
      tile: busy[0]?.[0] ?? firstWithout((k) => hasHomes(w.zones[k]) && !(ut.coverage[k] & Coverage.Health)), view: 'health',
    });
  }

  // ----- Sécurité et secours -----
  const es = sim.emergency.stats;
  const fireCov = us.coverage[Coverage.Fire] ?? 0;
  if (fireCov < 0.75 || es.failed.fire > 0) {
    out.push({
      id: 'fire', severity: fireCov < 0.4 ? 'serious' : 'warning', title: `Pompiers : ${pct(fireCov)} des bâtiments à portée`,
      causes: [fireCov < 0.75 ? 'Des quartiers sont trop loin d\'une caserne par la route.' : '',
        es.failed.fire ? `${es.failed.fire} bâtiment(s) ont brûlé avant l'arrivée des secours.` : '',
        es.response.fire > 14 ? `Les camions mettent en moyenne ${es.response.fire} min : trafic ou casernes trop éloignées.` : ''].filter(Boolean),
      actions: ['Construire une caserne dans les quartiers non couverts.', 'Désengorger les axes empruntés par les secours.', `Augmenter le budget « ${BUDGET_NAMES.fire} » (plus de camions).`],
      tile: firstWithout((k) => !(ut.coverage[k] & Coverage.Fire)), view: 'fire',
    });
  }
  if (sim.crimeIndex > 0.3) {
    let worst = built[0];
    for (const k of built) if (ut.crime[k] > ut.crime[worst]) worst = k;
    const causes: string[] = [];
    if (st.unemployment > 0.1) causes.push(`Le chômage (${pct(st.unemployment)}) pousse à la délinquance.`);
    if ((us.coverage[Coverage.Police] ?? 0) < 0.7) causes.push(`Seulement ${pct(us.coverage[Coverage.Police] ?? 0)} des bâtiments sont à portée d'un commissariat.`);
    if (es.failed.crime) causes.push(`${es.failed.crime} délit(s) non élucidé(s) : la police n'est pas arrivée à temps.`);
    causes.push('Les quartiers à faible valeur foncière sont plus touchés.');
    out.push({
      id: 'crime', severity: sim.crimeIndex > 0.5 ? 'serious' : 'warning', title: `Délinquance élevée (${pct(sim.crimeIndex)})`, causes,
      actions: [sim.isServiceUnlocked(Service.Police) ? 'Construire un commissariat dans les quartiers touchés.' : 'Le commissariat se débloque à 1 200 habitants.', 'Créer des emplois (zones commerciales, industrielles, bureaux).', 'Améliorer le quartier : parcs, services, transports.'],
      tile: worst, view: 'crime',
    });
  }
  if (es.failed.medical > 0) {
    out.push({
      id: 'ambulance', severity: 'warning', title: `${es.failed.medical} urgence(s) médicale(s) sans intervention`,
      causes: ['Les ambulances étaient toutes occupées, trop loin, ou bloquées par le trafic.'],
      actions: ['Construire une clinique supplémentaire.', `Augmenter le budget « ${BUDGET_NAMES.health} » (plus d'ambulances).`], view: 'health',
    });
  }

  // ----- Circulation -----
  const t = sim.traffic;
  if (t.vehicles.length > 30 && t.flow < 0.55) {
    let worst = -1;
    for (let k = 0; k < t.density.length; k++) if (w.tiles[k] === 1 && (worst < 0 || t.density[k] > t.density[worst])) worst = k;
    out.push({
      id: 'traffic', severity: t.flow < 0.35 ? 'serious' : 'warning', title: `Circulation difficile (vitesse moyenne ${pct(t.flow)})`,
      causes: ['Trop de véhicules empruntent les mêmes axes.', worst >= 0 && w.linkCount(worst) >= 3 ? 'Le carrefour le plus chargé est saturé.' : 'La route la plus chargée manque de capacité.',
        t.transitShare < 0.05 ? 'Presque personne ne prend les transports en commun.' : ''].filter(Boolean),
      actions: ['Transformer l\'axe saturé en avenue (plus rapide) ou créer un itinéraire parallèle.', 'Créer une ligne de bus ou de métro sur ce trajet.', 'Mettre en sens unique des rues parallèles, ajouter des feux aux grands carrefours.'],
      tile: worst >= 0 ? worst : undefined, view: 'traffic',
    });
  }

  // ----- Économie -----
  if (st.population > 100 && st.unemployment > 0.12) {
    out.push({
      id: 'unemployment', severity: st.unemployment > 0.25 ? 'serious' : 'warning', title: `Chômage à ${pct(st.unemployment)}`,
      causes: [`${n(st.workers)} actifs pour ${n(st.totalJobs)} emplois.`, sim.taxes[2] > 12 || sim.taxes[3] > 12 ? 'Les impôts des entreprises sont élevés et freinent leur installation.' : ''].filter(Boolean),
      actions: ['Zoner des commerces, de l\'industrie ou des bureaux.', 'Baisser les impôts commerciaux et industriels.'], view: 'land',
    });
  } else if (st.population > 100 && st.totalJobs > st.workers * 1.35) {
    out.push({
      id: 'labor', severity: 'warning', title: 'Les entreprises manquent de main-d\'œuvre',
      causes: [`${n(st.totalJobs)} emplois pour seulement ${n(st.workers)} actifs.`],
      actions: ['Zoner davantage de logements.', 'Améliorer le bonheur pour attirer des habitants.'],
    });
  }
  const balance = st.income - st.expenses;
  if (Number.isFinite(sim.money) && (balance < 0 || sim.money < 0)) {
    const [bigKey, bigVal] = Object.entries(st.expensesBy).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const names: Record<string, string> = { roads: 'l\'entretien des routes', loans: 'les remboursements d\'emprunts', ...Object.fromEntries(Object.entries(BUDGET_NAMES).map(([k, v]) => [k, `le poste « ${v} »`])) };
    out.push({
      id: 'budget', severity: sim.money < 0 ? 'critical' : 'serious', title: sim.money < 0 ? 'La ville est en faillite' : `Budget déficitaire (${n(balance)} € par mois)`,
      causes: [`La plus grosse dépense est ${names[bigKey] ?? bigKey} (${n(bigVal)} € par mois).`, st.income < 500 ? 'Les recettes sont faibles : la ville a peu d\'habitants et d\'entreprises.' : ''].filter(Boolean),
      actions: ['Augmenter légèrement les impôts (B).', 'Réduire les budgets des services peu utilisés.', 'Supprimer les équipements ou lignes inutiles.', 'Faire grandir la ville pour augmenter les recettes.'],
    });
  }

  // ----- Environnement et bonheur -----
  const polluted = built.filter((k) => hasHomes(w.zones[k]) && ut.air[k] > 0.35);
  if (polluted.length > 3) {
    out.push({
      id: 'pollution', severity: 'warning', title: `${n(polluted.length)} logements très pollués`,
      causes: ["L'industrie, les centrales ou les grands axes sont trop proches des habitations."],
      actions: ["Éloigner les zones industrielles des logements.", 'Planter des arbres et créer des parcs entre les deux.', 'Préférer des éoliennes aux centrales au gaz.'],
      tile: polluted[0], view: 'air',
    });
  }
  if (st.population > 50 && us.happiness < 0.5) {
    const factors: Array<[number, string]> = [
      [1 - us.served[Utility.Power], 'manque d\'électricité'], [1 - us.served[Utility.Water], 'manque d\'eau'],
      [1 - (us.coverage[Coverage.Health] ?? 0), 'accès aux soins'], [1 - (us.coverage[Coverage.Education] ?? 0), 'accès à l\'école'],
      [us.air * 2, 'pollution'], [sim.crimeIndex, 'délinquance'], [(sim.taxes[1] - 9) / 10, 'impôts résidentiels élevés'],
      [1 - (us.coverage[Coverage.Park] ?? 0), 'manque d\'espaces verts'],
    ];
    factors.sort((a, b) => b[0] - a[0]);
    out.push({
      id: 'happiness', severity: us.happiness < 0.35 ? 'serious' : 'warning', title: `Habitants mécontents (bonheur ${pct(us.happiness)})`,
      causes: factors.slice(0, 3).filter(([v]) => v > 0.15).map(([, l]) => `Principal facteur : ${l}.`),
      actions: ['Traiter les problèmes listés ci-dessus en priorité.', 'Ajouter parcs et services dans les quartiers les moins satisfaits.'], view: 'happiness',
    });
  }

  // ----- Logement et entreprises -----
  const soc = sim.society, bs = soc.stats, cz = soc.citizens;
  if (st.population > 100 && soc.vacancy < 0.02 && st.demand[Zone.Residential] > 0.2) {
    out.push({
      id: 'housing-shortage', severity: 'warning', title: `Pénurie de logements (${pct(soc.vacancy)} de logements libres)`,
      causes: ['Des ménages veulent s’installer mais il n’y a plus de place.', 'Les loyers augmentent quand les logements manquent.'],
      actions: ['Zoner du résidentiel supplémentaire.', 'Favoriser les immeubles : services et valeur foncière permettent aux maisons de grandir.'], view: 'occupancy',
    });
  }
  if (st.population > 100 && cz.summaryBurden > 0.42) {
    out.push({
      id: 'rent-burden', severity: cz.summaryBurden > 0.55 ? 'serious' : 'warning', title: `Loyers trop chers (${pct(cz.summaryBurden)} des revenus)`,
      causes: ['Les loyers dépassent ce que les ménages peuvent payer : certains déménagent ou quittent la ville.', soc.vacancy < 0.03 ? 'Le manque de logements fait monter les prix.' : 'Les salaires sont bas : peu d’emplois qualifiés.'],
      actions: ['Construire plus de logements.', 'Attirer des emplois qualifiés (bureaux, éducation).'], view: 'rent',
    });
  }
  const ue = sim.lastSociety?.unemployedByEdu ?? [0, 0, 0, 0];
  if (ue[3] + ue[2] > 20 && bs.openJobs[1] + bs.openJobs[2] < (ue[3] + ue[2]) * 0.3) {
    out.push({
      id: 'skills-mismatch', severity: 'warning', title: 'Diplômés sans emploi adapté',
      causes: [`${n(ue[2] + ue[3])} diplômé(s) au chômage pour seulement ${n(bs.openJobs[1] + bs.openJobs[2])} poste(s) qualifié(s) libres.`, `${n(cz.underemployedCount)} actif(s) occupent un poste en dessous de leur niveau.`],
      actions: [sim.isUnlocked(Zone.Office) ? 'Zoner des bureaux, qui recrutent des diplômés.' : 'Les bureaux se débloquent à 600 habitants.', 'Baisser l’impôt des bureaux.'],
    });
  }
  if (bs.businesses > 5 && bs.struggling > bs.businesses * 0.2) {
    const worst = built.find((k) => soc.badMonths[k] >= 2);
    out.push({
      id: 'business', severity: bs.struggling > bs.businesses * 0.4 ? 'serious' : 'warning', title: `${n(bs.struggling)} entreprise(s) en difficulté`,
      causes: [bs.spending < st.jobs[Zone.Commercial] * 2000 ? 'Trop de commerces pour le pouvoir d’achat des habitants.' : '',
        bs.imports > bs.goodsDemand * 0.5 ? 'Les commerces paient cher des marchandises importées : pas assez d’industrie.' : '',
        bs.exports > bs.goodsProduced * 0.5 ? 'L’industrie produit plus que la ville ne consomme et exporte à perte.' : '',
        'Des postes restent vides faute de travailleurs qualifiés.'].filter(Boolean),
      actions: ['Équilibrer les zones : plus d’habitants pour les commerces, plus d’industrie si les importations sont fortes.', 'Baisser temporairement les impôts des entreprises.'],
      tile: worst,
    });
  }

  // ----- Catastrophes, risques et pollutions -----
  for (const d of sim.disasters.active) {
    out.push({
      id: `disaster-${d.id}`, severity: 'critical', title: `${DISASTER_NAMES[d.type]} ${d.status === 'warning' ? `annoncé(e) dans ${d.countdown} jour(s)` : 'en cours'}`,
      causes: [d.status === 'warning' ? 'Le centre d’alerte a détecté le phénomène à l’avance.' : `${d.damaged} bâtiment(s) touché(s) pour l’instant.`],
      actions: d.type === 'forestFire' ? ['Les pompiers interviennent ; construire une caserne près des forêts.'] : d.type === 'blackout' ? ['Construire une seconde source d’électricité pour ne pas dépendre d’une seule centrale.'] : ['Laisser les secours intervenir, puis suivre la reconstruction (carte « Dégâts »).'],
      tile: d.tile, view: d.type === 'flood' || d.type === 'earthquake' || d.type === 'tornado' ? 'damage' : undefined,
    });
  }
  const damaged = built.filter((k) => w.bDamage[k] > 0).length;
  let rubble = 0;
  for (let k = 0; k < w.rubble.length; k++) if (w.rubble[k]) rubble++;
  if (damaged || rubble) {
    out.push({
      id: 'repairs', severity: damaged + rubble > 20 ? 'serious' : 'warning', title: `Reconstruction : ${damaged} bâtiment(s) endommagé(s), ${rubble} parcelle(s) en gravats`,
      causes: ['Conséquences d’une catastrophe ou d’un incendie.', 'Les bâtiments endommagés accueillent moins d’habitants et d’emplois.'],
      actions: [`Augmenter le budget « ${BUDGET_NAMES.fire} » pour réparer plus vite.`, 'Les gravats sont déblayés automatiquement, puis la parcelle se reconstruit.'],
      tile: built.find((k) => w.bDamage[k] > 0), view: 'damage',
    });
  }
  const contaminated = built.filter((k) => ut.contaminated[k]).length;
  if (contaminated) {
    out.push({
      id: 'water-contamination', severity: 'serious', title: `Eau contaminée dans ${contaminated} bâtiment(s)`,
      causes: ['Une station de pompage puise dans une eau polluée par les égouts non traités ou l’industrie.'],
      actions: ['Construire une station d’épuration.', 'Déplacer la station de pompage en amont, loin de l’industrie et des rejets.'],
      tile: built.find((k) => ut.contaminated[k]), view: 'waterPol',
    });
  }
  if (sim.disasters.level !== 'off') {
    const levees = sim.disasters.levees();
    const exposed = built.filter((k) => hasHomes(w.zones[k]) && sim.disasters.floodRisk(k, levees) === 1);
    if (exposed.length > 8) {
      out.push({
        id: 'flood-risk', severity: 'warning', title: `${exposed.length} logements en zone inondable`,
        causes: ['Ces bâtiments sont sur des terrains bas, près de l’eau, sans digue.'],
        actions: ['Construire une digue au bord de l’eau (menu Services).', 'Éviter de zoner les berges basses.'], tile: exposed[0], view: 'risk',
      });
    }
    if (st.population > 1500 && !hasService(Service.WarningCenter)) {
      out.push({
        id: 'warning-center', severity: 'warning', title: 'Aucun centre d’alerte',
        causes: ['Sans alerte, les catastrophes frappent sans prévenir : pas d’évacuation possible.'],
        actions: ['Construire un centre d’alerte (menu Services).'],
      });
    }
    const plants = w.service.filter((s) => s === Service.PowerPlant).length + w.service.filter((s) => s === Service.WindTurbine).length;
    if (st.population > 500 && plants === 1) {
      out.push({
        id: 'blackout-risk', severity: 'warning', title: 'Une seule source d’électricité',
        causes: ['Si elle tombe en panne, toute la ville est privée de courant.'],
        actions: ['Construire une seconde centrale ou des éoliennes.'], view: 'power',
      });
    }
  }

  const abandoned: number[] = [];
  for (let k = 0; k < w.bState.length; k++) if (w.bState[k] === BuildState.Abandoned && w.anchorOf(k) === k) abandoned.push(k);
  if (abandoned.length) {
    const ut2 = sim.utilities;
    const noNet = abandoned.filter((k) => !ut2.hasUtility(k, 0) || !ut2.hasUtility(k, 1)).length;
    const noRoad = abandoned.filter((k) => w.roadDist[k] > 3).length;
    out.push({
      id: 'abandoned', severity: abandoned.length > 5 ? 'serious' : 'warning', title: `${abandoned.length} bâtiment(s) abandonné(s)`,
      causes: [noNet ? `${noNet} sans électricité ou sans eau.` : '', noRoad ? `${noRoad} sans accès routier.` : '', 'Pas assez de demande pour ce type de zone.'].filter(Boolean),
      actions: ['Rétablir les réseaux et l’accès : ils seront réhabilités.', 'Sinon, les démolir (moitié prix) avant qu’ils ne s’effondrent.'],
      tile: abandoned[0],
    });
  }

  if (!out.length) out.push({ id: 'ok', severity: 'good', title: 'Tout fonctionne bien', causes: ['Aucun problème important détecté.'], actions: ['Continuez à développer la ville.'] });
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export { SERVICE_INFO };
