# ADR 0011 — Clôture d'exercice et à-nouveaux

Statut : retenu (1er novembre 2026, lot 2a.3). Applique le cadrage §11.4 et CA-04 / CA-12. Aucune affirmation de conformité comptable : les classes de comptes utilisées ici (1 à 5 = bilan, 6 et 7 = résultat) sont la convention générale du plan comptable français, à faire valider sur le jeu de référence du pilote.

## Décisions

1. **Deux temps.** *Fermer à la saisie* (`OPEN → CLOSING`) gèle l'exercice : plus aucune comptabilisation (verrou d'exercice de l'ADR 0010). Cette fermeture **s'annule** (`CLOSING → OPEN`) tant que la clôture n'est pas définitive. *Clôturer* (`CLOSING → CLOSED`) est définitif : **pas de réouverture** (la réouverture exceptionnelle du cadrage n'est pas retenue à ce stade).
2. **Ajustements avant la fermeture.** Amortissements, charges à payer, etc. se comptabilisent tant que l'exercice est ouvert. Pas d'exception pour les écritures d'ajustement pendant la fermeture (règle de verrouillage unique, déjà testée en concurrence).
3. **À-nouveaux automatiques.** La clôture génère, dans l'exercice qui suit *immédiatement* (date de début = lendemain de la fin), une écriture `OPENING` sur le journal d'à-nouveaux actif :
   - un solde net par compte de classes 1 à 5 (écritures comptabilisées **et** contrepassées, qui s'annulent entre elles) ;
   - le **résultat** (produits − charges, classes 7 et 6) sur un compte de bilan choisi à la clôture : excédent au crédit, déficit au débit. Aucune écriture de solde des classes 6-7.
   - L'**affectation du résultat** par l'assemblée générale est une écriture distincte, saisie ensuite à la main (cadrage §11.4 : clôture technique, affectation et approbation sont distinguées).
4. **Un seul report, garanti en base.** `JournalEntry.carriesFromId` (unique, réservé aux écritures `OPENING`) désigne l'exercice reporté : un second report du même exercice est impossible. Le passage à `CLOSED` est refusé par la base s'il reste un brouillon dans l'exercice, si un exercice antérieur n'est pas clôturé, ou si les à-nouveaux ne sont pas comptabilisés ; un à-nouveaux ne se comptabilise que pendant la fermeture de l'exercice reporté.
5. **Tout ou rien.** Création et comptabilisation des à-nouveaux puis clôture se font dans une transaction sous verrou exclusif de l'exercice ; au moindre refus (compte de résultat manquant, soldes non équilibrés, exercice suivant absent), rien n'est écrit.
6. **Clôture dans l'ordre.** Un exercice ne se clôture qu'après les précédents (cadrage : « clôturer chronologiquement »).
7. **Contrôles.** Bloquants : brouillons restants, exercice précédent non clôturé, exercice suivant absent ou non ouvert, pas de journal d'à-nouveaux actif, report déjà fait. Avertissement : comptes utilisés sans rubrique de rapport. Les contrôles de rapprochement et des modules actifs (ADR 0003) s'ajouteront avec leurs lots.
8. **Aucune saisie dans un exercice clôturé**, brouillons compris. Une écriture d'un exercice clôturé peut encore être *contrepassée* : la contrepassation est comptabilisée dans un exercice ouvert (l'original passe à « contrepassée » sans changer ses montants).
9. Droits : tout est sous `fiscal-years:close`, lecture des contrôles comprise. Chaque étape est auditée.

## Limites connues

Un exercice sans aucune écriture comptabilisée ne peut pas être clôturé (rien à reporter). Le report suppose les écritures de classe 8 soldées entre elles ; sinon la clôture est refusée avec un message explicite. Les états de clôture (bilan, compte de résultat) viennent avec le lot 2c.
