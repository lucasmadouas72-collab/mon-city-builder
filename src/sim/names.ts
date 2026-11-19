import { rng } from '../core/noise';

/** Noms générés pour les habitants et les entreprises (déterministes par bâtiment). */

const FIRST = ['Léa', 'Hugo', 'Emma', 'Louis', 'Chloé', 'Gabriel', 'Inès', 'Jules', 'Manon', 'Adam', 'Camille', 'Nathan', 'Sarah', 'Théo', 'Jade', 'Lucas', 'Zoé', 'Raphaël', 'Lina', 'Arthur', 'Alice', 'Noah', 'Rose', 'Sacha', 'Yasmine', 'Malik', 'Eva', 'Tom', 'Nina', 'Paul', 'Mila', 'Victor', 'Anaïs', 'Samuel', 'Clara', 'Ethan', 'Lou', 'Mathis', 'Aya', 'Elio'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Benali', 'Nguyen', 'Diallo', 'Rossi', 'Haddad', 'Costa'];
const JOBS_LOW = ['vendeur·se', 'serveur·se', 'livreur·se', 'agent·e d\'entretien', 'caissier·ère', 'manutentionnaire', 'chauffeur·se de bus'];
const JOBS_MID = ['infirmier·ère', 'technicien·ne', 'électricien·ne', 'comptable', 'boulanger·ère', 'mécanicien·ne', 'policier·ère', 'pompier·ère'];
const JOBS_HIGH = ['ingénieur·e', 'médecin', 'architecte', 'développeur·se', 'professeur·e', 'avocat·e', 'chercheur·se', 'urbaniste'];
const SHOPS = ['Boulangerie', 'Épicerie', 'Café', 'Restaurant', 'Pharmacie', 'Librairie', 'Fleuriste', 'Boutique de mode', 'Magasin de sport', 'Supermarché', 'Banque', 'Opticien'];
const FACTORIES = ['Ateliers', 'Usine', 'Logistique', 'Menuiserie', 'Conserverie', 'Plasturgie', 'Métallurgie', 'Imprimerie', 'Électronique'];
const OFFICES = ['Conseil', 'Assurances', 'Informatique', 'Communication', 'Ingénierie', 'Finance', 'Recherche', 'Transports'];

export interface Resident {
  name: string;
  age: number;
  occupation: string;
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export function residentsOf(idx: number, count: number, education: number): Resident[] {
  const r = rng(idx * 7349 + 11);
  const out: Resident[] = [];
  for (let k = 0; k < count; k++) {
    const family = pick(r, LAST);
    const age = Math.floor(r() < 0.25 ? r() * 18 : 18 + r() * 70);
    let occupation: string;
    if (age < 3) occupation = 'bébé';
    else if (age < 11) occupation = 'écolier·ère';
    else if (age < 18) occupation = 'collégien·ne ou lycéen·ne';
    else if (age >= 65) occupation = 'retraité·e';
    else if (age < 24 && r() < 0.4) occupation = 'étudiant·e';
    else if (r() < 0.07) occupation = 'sans emploi';
    else { const e = r(); occupation = pick(r, e < education * 0.6 ? JOBS_HIGH : e < 0.75 ? JOBS_MID : JOBS_LOW); }
    out.push({ name: `${pick(r, FIRST)} ${family}`, age, occupation });
  }
  return out;
}

export function companyName(idx: number, zone: number): string {
  const r = rng(idx * 9157 + 5);
  const owner = pick(r, LAST);
  if (zone === 2) return `${pick(r, SHOPS)} ${owner}`;
  if (zone === 3) return `${pick(r, FACTORIES)} ${owner}`;
  return `${owner} ${pick(r, OFFICES)}`;
}

/** Nom d'un citoyen : nom de famille tiré du foyer, prénom tiré du citoyen. */
export function citizenName(householdSeed: number, seed: number): string {
  return `${FIRST[seed % FIRST.length]} ${LAST[householdSeed % LAST.length]}`;
}
