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
| Outils | 1 Sélection · 2 Route · 3 Résidentiel moyen · 4 Commerce local · 5 Industrie · 6 Bureaux · 7 Dézoner · 8 Démolir · 9 Bibliothèque de bâtiments |
| Bâtiments | clic sur un bâtiment : fiche complète · R pivoter · Suppr démolir · menu Bâtiments : placer un modèle, déplacer |
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
- [x] Étape 8 : capacités des écoles et cliniques (élèves affectés par âge, distance et places ; temps d'attente), couverture des services calculée par la route avec les embouteillages, pompiers / ambulances / police en véhicules pris dans le trafic, délinquance et délits, conseiller (gravité, causes probables, actions, « Voir sur la carte »), légendes des cartes de données, indicateurs cliquables
- [x] Étape 9 : catastrophes (inondations, feux de forêt, tempêtes et tornades, séismes, accidents industriels, pannes électriques), fréquence réglable ou désactivable, digues et centre d'alerte, évacuation, bâtiments endommagés, gravats, réparations facturées, aide régionale, pollution de l'eau (eau contaminée), des sols et lumineuse, vent, cartes Dégâts et Risques
- [x] Étape 10 : habitants individuels et foyers (âge, éducation, statut, emploi, revenus, santé, bonheur) mis à jour par lots, cycle de vie (naissances, études, emploi, retraite, décès, départ du foyer), immigration et émigration, déménagements, marché du logement (loyers, logements vacants, coût de la vie), emplois par qualification, entreprises (recettes, coûts, bénéfice, effectif selon les ventes, licenciements, faillites), marchandises importées/exportées, impôts sur les revenus et les bénéfices, 9 besoins, cartes Loyers et Occupation
- [x] Étape 11 : 12 types de zones (résidentiel faible, moyen, fort ; commerce local et dense ; bureaux ; industrie ; zone mixte ; agriculture, logistique, recherche, tourisme), parcelles découpées selon la façade, la profondeur et la pente, bâtiments de 1×1 à 3×3, 4 styles architecturaux selon la région et le quartier, bibliothèque de bâtiments (placement manuel, rotation, déplacement, vérification du terrain), état abandonné et réhabilitation, fiche bâtiment complète, évolutions annoncées sans bloquer
- [x] Étape 12 : électricité (gaz, nucléaire, solaire, barrage, éolien, incinération, achats et ventes aux voisins), lignes haute tension, sous-stations et pertes en ligne, surcharge ; eau (captage, traitement, châteaux d'eau, pression, achats), débordement des eaux usées ; déchets (accumulation, tournées de camions, tri, recyclage, compostage, incinération, décharges) ; ressources naturelles (terres fertiles, minerai, forêts, potentiel énergétique), zones sylviculture et extraction ; chaînes de production (matières premières, industrie, commerces, stocks, export limité par la logistique) ; camions de marchandises ; panneau Réseaux et production

### Prochaines étapes (cahier des charges)

- [ ] Routes : tunnels, échangeurs dédiés, routes surélevées, pistes cyclables, nombre de voies réglable
- [ ] Quartiers nommés avec leurs propres règles et impôts
- [ ] Tramway, trains, ports, aéroports, taxis, vélos
- [ ] Tourisme, loisirs, équipements sportifs, événements
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
