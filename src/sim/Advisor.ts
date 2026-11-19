import type { Simulation } from './Simulation';
import { BuildState, Zone } from './zones';
import { Coverage, SERVICE_INFO, Service, Utility, UTILITY_NAMES } from './services';
import { BUDGET_NAMES } from './economy';

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
    [Utility.Power]: [Service.PowerPlant, Service.WindTurbine], [Utility.Water]: [Service.WaterPump],
    [Utility.Sewage]: [Service.Sewage], [Utility.Garbage]: [Service.Landfill],
  };
  const utilActions: Record<number, string> = {
    [Utility.Power]: 'Construire une centrale au gaz ou des éoliennes (menu Réseaux).',
    [Utility.Water]: "Construire une station de pompage au bord de l'eau (menu Réseaux).",
    [Utility.Sewage]: "Construire une station d'épuration au bord de l'eau (menu Réseaux).",
    [Utility.Garbage]: 'Construire un centre de tri (menu Réseaux).',
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
      causes.push("Ce quartier est sur un réseau routier séparé, qui n'est relié à aucun équipement.");
      actions.push('Relier ce quartier au reste de la ville par une route.');
    }
    if (u <= Utility.Water) actions.push(`Augmenter le budget « ${BUDGET_NAMES.utilities} » pour produire davantage.`);
    out.push({
      id: `util-${u}`, severity: u <= Utility.Water ? (served < 0.8 ? 'critical' : 'serious') : 'warning',
      title: `${UTILITY_NAMES[u]} : ${pct(1 - served)} des bâtiments non desservis`, causes, actions, tile: without, view: utilView[u],
    });
  }
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
      tile: saturated[0]?.[0] ?? firstWithout((k) => w.zones[k] === Zone.Residential && !(ut.coverage[k] & Coverage.Education)), view: 'education',
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
      tile: busy[0]?.[0] ?? firstWithout((k) => w.zones[k] === Zone.Residential && !(ut.coverage[k] & Coverage.Health)), view: 'health',
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
  const polluted = built.filter((k) => w.zones[k] === Zone.Residential && ut.air[k] > 0.35);
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

  if (!out.length) out.push({ id: 'ok', severity: 'good', title: 'Tout fonctionne bien', causes: ['Aucun problème important détecté.'], actions: ['Continuez à développer la ville.'] });
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export { SERVICE_INFO };
