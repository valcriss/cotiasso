# ADR 0018 — Rapprochement bancaire par pointage sur un relevé

Statut : retenu (2 novembre 2026, lot 2b.5). Applique le cadrage §10.3 et complète les [ADR 0014](0014-tresorerie-comptes-financiers-et-transactions.md) et [ADR 0017](0017-virements-internes-et-liaison-transaction-ecriture.md). Le rapprochement bancaire reste distinct de l'affectation de paiement et du lettrage.

## Décisions

1. **Un rapprochement part d'un relevé** (`BankStatement`, solde de clôture à une date) et **pointe des transactions** : le trésorier coche celles qui figurent sur le relevé. Le **solde rapproché** = solde rapproché précédent (ou solde d'ouverture du compte pour le premier) + somme des transactions pointées ; l'**écart** = solde du relevé − solde rapproché. Les transactions non pointées à la date du relevé sont les **opérations en circulation** (chèque pas encore débité…) : elles expliquent l'écart entre le relevé et le solde calculé. Un rapprochement est **en cours** (`IN_PROGRESS`), **validé** (`VALIDATED`) ou **annulé** (`CANCELLED`, conservé en historique).
2. **Chaîne des soldes** : un seul rapprochement en cours par compte ; le relevé choisi doit se terminer **après** le dernier rapprochement validé ; le solde d'ouverture du rapprochement est celui du dernier validé (ou le solde d'ouverture du compte). Un relevé donne au plus un rapprochement non annulé.
3. **Pointage** : une transaction se pointe dans un seul rapprochement, du même compte, datée au plus tard à la date du relevé. Le bouton « pointer les transactions importées » **propose** de pointer d'un coup celles qui viennent du fichier de la banque (elles sont par nature sur un relevé) ; rien n'est pointé sans geste du trésorier.
4. **Validation** : exige un **écart exactement nul** et que **chaque transaction pointée soit comptabilisée** (écriture comptabilisée liée, ADR 0017) : bloquants. Les **écritures comptabilisées sur le compte de banque sans transaction** de la période sont listées en **avertissement** (frais saisis directement, écriture à la main…). Les contrôles sont revérifiés **par la base** à la validation.
5. **Figement** : une fois validé, le pointage ne bouge plus ; les transactions pointées gardent montant et date et ne se suppriment pas ; l'écriture liée à une transaction rapprochée **ne se contrepasse pas** (annuler d'abord le rapprochement). **Annulation** : seulement du **dernier** rapprochement validé du compte, et seulement s'il n'y en a pas un en cours ; elle libère les transactions et est **auditée**. Un rapprochement en cours s'**abandonne** (la ligne disparaît, le pointage est libéré).
6. **Clôture d'exercice** : un **avertissement non bloquant** signale tout compte financier actif, ouvert avant la fin de l'exercice, dont le dernier rapprochement validé n'atteint pas la date de fin (code `UNRECONCILED_ACCOUNT`).
7. **Présentation** : le compte affiche « rapproché jusqu'au … » **seulement** pour un rapprochement validé ; un solde non contrôlé n'est jamais présenté comme rapproché (cadrage §9.1). Droit : `imports:post` (« importer des relevés et rapprocher »), consultation `financial-accounts:view`.
8. **Audit** : `reconciliation.started`, `reconciliation.validated`, `reconciliation.cancelled`, `reconciliation.abandoned`, `reconciliation.points.changed` (nombre de transactions pointées ou dépointées).

## Hors de cette tranche

Rapprochement sans relevé, rapprochement d'une période partielle sans relevé de clôture, import de relevés au format PDF, reprise de rapprochements antérieurs (2b.6), annulation d'un rapprochement qui n'est pas le dernier.
