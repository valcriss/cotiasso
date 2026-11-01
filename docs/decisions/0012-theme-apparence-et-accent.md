# ADR 0012 — Thème, apparence et accent de l'association

Statut : retenu (1er novembre 2026). Remplace le thème Material « brut » des premiers écrans.

## Constat

Panneaux gris (`surface-container-low`) portant des champs sans fond : gris sur gris, les champs ressemblaient à des champs désactivés. Une seule teinte de marque (le menu), des boutons toujours azur, aucun relief, aucun mode sombre.

## Décisions

1. **Surfaces** : page légèrement teintée (`--app-bg`), cartes blanches (anthracite en sombre) avec bordure fine et ombre douce à trois niveaux (`--app-shadow-xs/sm/md`). Un panneau dans un panneau devient une section séparée par un filet, pas une seconde carte. Les tableaux ont un en-tête teinté et un survol de ligne.
2. **Champs** : contour net (`--app-field-border`), fond de la surface qui les porte, focus de 2 px à la couleur d'accent ; seul un champ réellement désactivé est grisé.
3. **Jetons** : toutes les couleurs de l'application passent par des variables CSS en `light-dark()` ; `color-scheme: light dark` suit le système, les classes `theme-light` / `theme-dark` imposent le choix de l'utilisateur.
4. **Mode et densité = préférences de l'utilisateur pour cet écran**, conservées dans le navigateur (`localStorage`, `ThemeService`), pas côté serveur pour l'instant. Valeurs inconnues ignorées, stockage refusé toléré. Densité compacte : espacements réduits et `density: -3` Material pour les champs. Un réglage par compte serveur pourra venir plus tard.
5. **Accent de l'association** : `branding.accentColor` (bleu par défaut `#005cbb`) pilote les couleurs principales du thème. Le serveur impose un contraste d'au moins 4,5 avec du texte blanc (boutons). En mode sombre l'accent est éclairci et porte du texte foncé. Le menu reste teinté par la couleur de l'association (mélangée à un fond sombre en mode sombre).
6. **Icônes** : icônes Material (jeu « outlined », hébergées localement) sur les onglets, titres de page et de panneau et boutons d'action principaux ; décoratives (`aria-hidden`), le libellé texte reste présent.
7. **Petits écrans** : marges réduites, en-têtes qui passent à la ligne, tableaux défilants dans leur cadre.

## Hors périmètre

Réglage d'apparence enregistré côté serveur par utilisateur ; thème de la page de connexion distinct ; logo (dépend des documents) ; contrôle automatique du contraste des couleurs dérivées de l'accent en mode sombre (calculées par mélange, à vérifier visuellement pour les accents extrêmes).
