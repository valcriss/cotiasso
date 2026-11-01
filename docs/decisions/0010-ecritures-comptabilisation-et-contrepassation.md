# ADR 0010 — Écritures : comptabilisation atomique, numérotation, contrepassation

Statut : retenu (1er novembre 2026, lot 2a.3). Applique le [modèle de données](../lot0/05-modele-de-donnees.md) §1 et §9, et les critères CA-03 et CA-04 du cadrage.

## Décisions

1. **La règle est dans la base.** Équilibre, nombre de lignes, comptes et journal actifs, date dans l'exercice, exercice ouvert et numérotation sont appliqués par un déclencheur SQL à la comptabilisation. Le service ne fait qu'un contrôle préalable (messages lisibles, 422 avec la liste des problèmes) puis passe l'écriture à `POSTED` : aucun autre chemin (script, module futur) ne peut contourner la règle.
2. **Numérotation** : table `EntryCounter(journalId, fiscalYearId, lastNumber)`, incrémentée par `INSERT … ON CONFLICT DO UPDATE` sous verrou de ligne dans la transaction de comptabilisation. Un refus ou un rollback ne laisse aucun trou. Le compteur démarre à 1, n'avance que d'un et ne se supprime pas. Unicité `(journal, exercice, numéro)` en filet.
3. **Clôture concurrente (CA-04)** : la comptabilisation prend un verrou partagé sur la ligne de l'exercice avant de lire son état ; le passage à `CLOSING` (une mise à jour) attend la fin des comptabilisations en cours, et une comptabilisation lancée pendant ce passage attend puis est refusée. Résultat : validée avant la fermeture, ou refusée. Testé avec une transaction de clôture maintenue ouverte.
4. **Immuabilité** : une écriture comptabilisée et ses lignes ne changent plus, ne se suppriment plus. Seule transition permise ensuite : `POSTED → REVERSED`, et seulement si sa contrepassation comptabilisée existe. `TRUNCATE` est refusé sur toutes les tables comptables.
5. **Contrepassation** : `POST /entries/:id/reverse` crée en une transaction l'écriture inverse (`kind = REVERSAL`, `reversalOfId`), la comptabilise et marque l'originale `REVERSED`. Une écriture ne se contrepasse qu'une fois (unicité sur `reversalOfId`) ; une contrepassation ne se contrepasse pas ; la date peut tomber dans un autre exercice ouvert (numérotation propre à cet exercice).
6. **Brouillons** : modifiables et supprimables, déséquilibrés permis (CA-06 : le brouillon reste autorisé), avec contrôle de version optimiste. Un brouillon n'a ni numéro ni date de comptabilisation (contrainte CHECK).
7. **Droits** : `entries:view`, `entries:create` (brouillons), `entries:post` (comptabiliser, contrepasser). Pas de « quatre yeux » à ce stade (mode optionnel de la matrice des droits, à venir).

## Hors de cette tranche

Correction = contrepassation puis nouvelle écriture reliée (`CorrectionLink`), projet et tiers sur les lignes (CA-06), obligation de projet, clôture d'exercice et ouverture suivante, écran web de saisie.
