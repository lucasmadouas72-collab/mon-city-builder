# Néoville (nom provisoire)

Jeu original de construction et de gestion de ville, jouable dans le navigateur.
TypeScript + Three.js + Vite.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) (version 20 ou plus).

```bash
npm install
npm run dev
```

Puis ouvrir l'adresse affichée (http://localhost:5173).

## Commandes

| Action | Commande |
| --- | --- |
| Tourner la caméra | clic droit, ou A / E |
| Zoomer | molette |
| Déplacer la caméra | clic molette, ou Z Q S D / flèches |
| Outils | 1 Sélection · 2 Route · 3 Résidentiel · 4 Commercial · 5 Industriel · 6 Bureaux · 7 Dézoner · 8 Démolir |
| Routes | menu Routes · tracé Droite (aimanté à 15°, Maj = angle libre), Courbe (3 clics : départ, courbure, arrivée) ou En L · touche C pour changer |
| Caméra | F centrer · V vue de dessus · Retour arrière vue précédente · Alt+1..4 mémoriser · Maj+1..4 rappeler |
| Zoner | cliquer-glisser une zone près d'une route |
| Terrain | menu Terrain, cliquer-glisser · taille du pinceau : - et + |
| Annuler / rétablir | Ctrl+Z / Ctrl+Y |
| Vue trafic | T (autres vues : bouton « Vues ») |
| Budget | B (ou clic sur le budget) |
| Menu (sauvegarder, charger…) | clic sur le nom de la ville, ou F10 |
| Pause | Espace |
| Annuler l'outil | Échap |

## Fonctionnalités

- **Parties** : menu principal, création de partie (nom de la ville, du maire, région, 10 types de cartes, graine, difficulté, mode classique ou bac à sable, saison de départ, météo), plusieurs sauvegardes, sauvegarde automatique, export et import de fichiers.
- **Construction** : routes avec carrefours et passages piétons, zonage R/C/I/bureaux, équipements publics, bus et métro, outils de terrain (élever, abaisser, lisser, aplanir, planter), annuler/rétablir.
- **Simulation** : croissance selon la demande, 3 niveaux de bâtiments, valeur foncière, véhicules individuels avec itinéraires et bouchons, électricité, eau, égouts, déchets, santé, éducation, police, pompiers, parcs, incendies, pollution de l'air et sonore, bonheur, démographie par âges (naissances, décès, migrations, éducation, chômage).
- **Économie** : impôts par zone, budgets des services, emprunts, bilan mensuel, paliers de population avec déblocages et subventions.
- **Temps** : cycle jour/nuit (fenêtres et lampadaires allumés, trafic selon l'heure), 4 saisons (arbres, neige), météo (soleil, nuages, pluie, orage, neige, brouillard, canicule, gel) avec effets sur le trafic, la consommation et le bonheur.
- **Interface** : tableau de bord statistique avec historique, 15 vues de données, journal des événements cliquable, fiches des bâtiments (habitants, entreprises).

## Avancement

- [x] Phase 1 : terrain 3D, caméra, routes, budget
- [x] Phase 2 : zonage, demande, bâtiments
- [x] Phase 3 : véhicules, itinéraires, trafic
- [x] Phase 4 : réseaux et services publics
- [x] Phase 5 : économie, bus, métro, paliers
- [x] Phase 6 : jour/nuit, saisons, météo, pollution, démographie, statistiques, journal, sauvegardes, nouvelle partie, annuler, terrain
- [x] Étape 7 : routes droites à tous les angles, diagonales et courbes, rues / avenues / autoroutes / voies piétonnes, ponts, terrassement automatique, sens uniques, feux tricolores, remplacement de routes, règle « ne pas bloquer le carrefour », caméra (centrer, vue de dessus, retour, positions mémorisées)

### Prochaines étapes (cahier des charges)

- [ ] Routes : tunnels, échangeurs dédiés, routes surélevées, pistes cyclables, nombre de voies réglable
- [ ] Bâtiments sur plusieurs cases, placement manuel et rotation, styles architecturaux
- [ ] Quartiers nommés avec leurs propres règles et impôts
- [ ] Tramway, trains, ports, aéroports, taxis, vélos
- [ ] Industries spécialisées et chaînes de production, import/export
- [ ] Tourisme, loisirs, équipements sportifs, événements
- [ ] Catastrophes (séismes, inondations, tornades) et prévention
- [ ] Capacités réelles des écoles et hôpitaux, véhicules de service bloqués par le trafic
- [ ] Sons et musique, mode photo, caméra au niveau de la rue
- [ ] Éditeurs (cartes, bâtiments) et contenus communautaires

## Organisation du code

- `src/sim/` : règles et données du jeu (indépendantes du rendu) : monde, simulation, trafic, réseaux, transports, économie, environnement, démographie, sauvegarde, annulation
- `src/render/` : scène 3D (terrain, eau, routes, bâtiments, véhicules, ciel, météo, surcouches)
- `src/input/` : caméra et outils
- `src/ui/` : interface (barre, menus, budget, statistiques)
- `src/game/` : paramètres de partie et stockage des sauvegardes
- `src/config.ts` : réglages généraux
