# ADR 0009 — Structure comptable : exercices, journaux, plan de comptes

Statut : retenu (1er novembre 2026, lot 2a.2). Complète le [modèle de données](../lot0/05-modele-de-donnees.md) §1 et le [référentiel](../lot0/02-referentiel-comptable.md).

## Décisions

1. **Aucun plan de comptes n'est livré.** Les numéros du référentiel 0.2 sont indicatifs et non validés par le trésorier du pilote ; installer un plan reviendrait à affirmer une conformité non vérifiée. Le plan se constitue par import (fichier « numéro;libellé », tout ou rien, idempotent, sans écrasement de l'existant) ou par saisie. Un jeu de départ validé pourra être ajouté plus tard comme import proposé.
2. **Journaux de départ** : AC, PR, OD, AN, installés par la migration. Les journaux de banque (BQ-n) et de caisse arrivent avec les comptes financiers (lot 2b). Le code et le type d'un journal sont définitifs (la numérotation en dépend) ; un journal se désactive.
3. **Exercices** : dates libres, **sans chevauchement garanti en base** (contrainte d'exclusion sur la plage de dates, bornes incluses) en plus du contrôle lisible du service. Les états `OPEN → CLOSING → CLOSED` ne vont que vers l'avant (déclencheur) ; un exercice engagé dans la clôture n'a plus ses dates modifiables, un exercice clôturé ne se modifie plus du tout. Aucun changement d'état n'est exposé par l'API à ce stade : la clôture (contrôles, ouverture suivante) viendra avec 2a.3.
4. **Jamais de suppression** d'un exercice, d'un journal ou d'un compte (déclencheurs SQL) ; le numéro d'un compte ne change pas.
5. **Droits** : lecture sous `entries:view`, écriture sous `settings.accounting:admin`. Toutes les modifications sont auditées (identifiants et noms de champs, pas de valeurs).

## Reste à faire (hors de cette tranche)

Plan de comptes **versionné** (rubriques de rapport versionnées), contrôle « compte utilisé ne se désactive pas sans contrôle », compteur de numérotation `EntryCounter`, écritures et validation atomique (2a.3).
