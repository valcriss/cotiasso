# ADR 0003 — Périmètre TVA et modules d'ajustement

Statut : accepté — 31 octobre 2026 (réponses Q4b et Q5b)

## Décisions

1. **TVA (Q4b)** : les trois modes (non assujettie, assujettie, activité mixte) sont dans le périmètre produit et paramétrables par association.
2. **Modules d'ajustement (Q5b)** : les quatre modules sont dans le périmètre produit, activables au choix de l'association : factures non parvenues / dettes, charges et produits constatés d'avance, immobilisations / amortissements, fonds dédiés.
3. **Amortissements** : registre automatisé (fiches d'immobilisations, plans d'amortissement, dotations générées à la clôture).

## Garde-fous

Le cadrage (§3, §12.1) interdit d'annoncer un mode ou un module non vérifié. Donc :

- Un mode de TVA ou un module n'est **activable** que lorsque son implémentation est livrée **et** validée par le référent comptable sur le jeu de référence (cadrage §25.2). Avant cela, il apparaît comme « indisponible ».
- Être dans le périmètre produit ne signifie pas être dans le premier incrément livré : l'ordre de livraison est fixé ci-dessous.
- Chaque module a son propre jeu de cas de référence et ses critères d'acceptation.

## Ordre de livraison (validé le 31 octobre 2026)

| Rang | Livrable | Raison |
| --- | --- | --- |
| 1 | TVA : non assujettie (défaut) | Aucun calcul, sert de base |
| 2 | Factures non parvenues / dettes ; constatés d'avance | Même mécanisme : écriture d'ajustement + contrepassation à l'ouverture |
| 3 | Immobilisations / amortissements (registre) | Fiches, plans linéaires, dotations à la clôture, cessions |
| 4 | TVA assujettie | HT/TVA/TTC, taux historisés, comptes de TVA, arrondis |
| 5 | Fonds dédiés | Dépend des conventions de financement et du module subventions (lot 4) |
| 6 | TVA activité mixte | Déductibilité partielle ; nécessite validation d'un expert |

## Conséquences

- Le périmètre des lots 2 et 5 augmente nettement : nouveau lot dédié « Modules d'ajustement et TVA » (lot 6) ajouté au découpage.
- Le noyau comptable (lot 2a) doit prévoir dès le départ les écritures d'ajustement avec contrepassation automatique et la désactivation de comptes/rubriques par module.
- La clôture (5.5) doit déclencher les contrôles de chaque module actif et ignorer les modules inactifs.
- Aucune date de livraison n'est annoncée avant validation du jeu de référence.
