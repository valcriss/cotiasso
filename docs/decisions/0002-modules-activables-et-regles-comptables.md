# ADR 0002 — Modules fonctionnels activables et règles comptables

Statut : accepté — 31 octobre 2026 (réponses Q3 à Q6)

## Décisions

1. **Exercice comptable (Q3)** : dates paramétrables dans la configuration de l'association, indépendantes de la campagne de cotisation. Premier exercice de durée libre. Valeurs de l'association pilote à saisir lors de la reprise (inventaire 0.6).
2. **TVA (Q4)** : assujettissement paramétrable. Le mode « non assujettie » est le comportement par défaut.
3. **Ajustements de clôture (Q5)** : chaque famille est un **module activable** par l'association, et non du code figé :
   - Immobilisations et amortissements
   - Charges et produits constatés d'avance
   - Factures non parvenues et dettes
   - Fonds dédiés (subventions conditionnelles)
4. **Cotisations (Q6)** : la cotisation attendue est un suivi non comptable. Le produit est constaté **à l'encaissement**, sans créance comptable. Une activation ultérieure de la comptabilisation en créance reste possible (module distinct).

## Mécanisme des modules

- Un module = un ensemble de fonctions, d'entrées de menu, de permissions et de paramètres, activé ou non pour l'installation.
- Un module **non implémenté** ou **dont les prérequis manquent** est affiché comme indisponible : il ne peut pas être activé avec un traitement incomplet (cf. cadrage §3).
- L'activation est datée et auditée. Elle ne recalcule pas les écritures validées ; une désactivation n'est possible que si aucune donnée en cours n'en dépend, sinon elle est refusée avec explication.
- Les modules sont déclaratifs : aucun script (cadrage §8.3).
- Le noyau comptable (écritures, exercices, clôture) n'est pas un module : il est toujours actif.

## Conséquences

- Nouvel epic au lot 1 : registre des modules et activation (1.4b).
- Le modèle de données de chaque module concerné doit supporter la présence ou l'absence du module sans migration destructrice.
- Les rapports doivent fonctionner module par module (un bilan reste produit si aucun module d'ajustement n'est actif).
- La V1 n'implémente pas forcément tous ces modules : le périmètre livré par module reste à décider (voir `docs/decoupage.md`, Q5b).
