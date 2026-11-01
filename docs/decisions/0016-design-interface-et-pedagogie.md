# ADR 0016 — Design de l'interface et pédagogie

Statut : retenu (1er novembre 2026). Détail et textes dans [design.md](../../design.md).

## Décisions

1. **Public cible** : des trésorier·ères d'association **sans connaissance comptable**. La rigueur comptable est celle du logiciel ; la facilité de prise en main et la compréhension sont la responsabilité de chaque écran (principes pédagogiques de `design.md` §1, repris dans `CLAUDE.md`).
2. **Structure de page** : chaque page a un **en-tête** (titre + une phrase de description) et une **barre d'action** (bouton principal unique + actions secondaires) ; composants partagés `PageHeader` et `ActionBar`. Les pages à onglets portent l'en-tête de la zone et une barre d'action par onglet.
3. **Formulaires de création et d'édition en boîte de dialogue** (patron `FormDialog`) : fermeture seulement au succès, erreurs serveur dans la boîte, confirmation d'abandon, largeurs normalisées, plein écran sur mobile. Restent dans la page : filtres, paramètres de réglage, détails en lecture.
4. **Deux exceptions en page dédiée** : la saisie d'une écriture et l'import d'un relevé OFX (trop vastes pour une boîte).
5. **Retour de succès** par **bandeau temporaire** (snackbar), non par un message dans la page. Les erreurs bloquantes restent dans la boîte ou la page concernée.
6. **Descriptions de page** : proposées dans `design.md` §3, ajustables à l'usage.

## Conséquences

Chantier d'interface seul (droits, règles comptables et API inchangés). Il précède la tranche 2b.4 afin que ses nouveaux formulaires naissent en boîtes de dialogue. Coût principal : adapter les spécifications web qui interrogent des formulaires en page, d'où un utilitaire de test commun.
