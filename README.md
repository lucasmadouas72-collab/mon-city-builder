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
| Zoner | cliquer-glisser une zone près d'une route |
| Tracer une route | cliquer-glisser |
| Pause | Espace |
| Annuler | Échap |

## Avancement

- [x] **Phase 1** : rendu 3D low-poly, relief avec rivière et lac, forêts, caméra, routes, démolition, budget
- [x] **Phase 2** : zonage (R, C, I, bureaux), demande, bâtiments procéduraux sur 3 niveaux, valeur foncière, impôts
- [ ] Phase 3 : habitants, véhicules, trafic
- [ ] Phase 4 : réseaux (eau, électricité) et services
- [ ] Phase 5 : économie complète, transports en commun, vues de données
- [ ] Phase 6 : jour/nuit, effets, sauvegarde, optimisation

## Organisation du code

- `src/sim/` : règles et données du jeu (indépendantes du rendu)
- `src/render/` : scène 3D (terrain, eau, routes, arbres, surbrillances)
- `src/input/` : caméra et outils
- `src/ui/` : interface
- `src/config.ts` : réglages (nom du jeu, coûts, taille de la carte…)
