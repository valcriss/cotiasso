# 0.5 — Modèle de données conceptuel (brouillon v0.1)

Base : cadrage §22. Noms indicatifs ; pas de SQL à ce stade. Conventions : identifiants techniques UUID, montants `NUMERIC` (ADR 0001), dates métier en `date`, horodatages en UTC, `version` entière pour le contrôle optimiste, aucune suppression physique des objets utilisés.

## 1. Noyau comptable

| Entité | Champs clés | Contraintes à garantir en base |
| --- | --- | --- |
| FiscalYear | start, end, status (open, closing, closed) | Pas de chevauchement ; start ≤ end |
| Journal | code, type, financialAccountId? | Code unique |
| Account | number, label, active, reportLine | Numéro unique ; désactivable, non supprimable |
| JournalEntry | fiscalYearId, journalId, date, label, reference, kind (normal, adjustment, reversal, opening), sourceRef?, status (draft, posted, reversed), number, postedAt, postedBy, reversalOfId? | `(journalId, fiscalYearId, number)` unique ; date comprise dans l'exercice ; posted ⇒ immuable |
| JournalLine | entryId, accountId, debit, credit, thirdPartyId?, label | debit ≥ 0, credit ≥ 0, un seul des deux non nul |
| CorrectionLink | originalEntryId, correctingEntryId, reason | Lien non supprimable |
| TreasuryMatch | journalLineId, transactionId, amount | Σ montants rapprochés ≤ montant de la transaction et de la ligne |

**Équilibre** : débit total = crédit total, vérifié à la validation par une contrainte différée ou un déclencheur dans la transaction de validation, jamais par un simple contrôle applicatif (cadrage §21.3).
**Numérotation** : séquence par journal et exercice, attribuée à la validation ; unicité garantie en base, verrou ciblé en concurrence.
**Verrou exercice/clôture** : une validation lit l'état de l'exercice sous verrou ; le passage à `closing` prend le verrou exclusif (CA-04).

## 2. Trésorerie

| Entité | Champs clés | Notes |
| --- | --- | --- |
| FinancialAccount | name, type (bank, cash), currency, accountId (compte comptable), openedOn, archivedOn | Archivé, jamais supprimé |
| BankStatement | financialAccountId, periodStart, periodEnd, closingBalance, fileDocumentId | Preuve du solde |
| ImportBatch | financialAccountId, fileHash, status, summary | Idempotence par empreinte et compte |
| ImportLine | batchId, raw (JSON brut inchangé), externalId, status | Données brutes conservées sans réécriture |
| Transaction | financialAccountId, operationDate, valueDate?, amount (signé), label, reference, origin, externalId?, memberId?, projectId?, statuts distincts | Unique `(financialAccountId, source, externalId)` quand `externalId` existe |
| Transfer | fromTransactionId, toTransactionId | Deux transactions liées, aucun produit ni charge |
| Reconciliation | financialAccountId, statementId, period, status | Rapprochement bancaire seulement |

Statuts de transaction, dimensions **séparées** : présence sur relevé, qualification, comptabilisation (aucune, partielle, totale), rapprochement.

## 3. Droits et accès

User (lié à Member, optionnel), Role (modèle modifiable), Permission, GlobalRoleAssignment, ProjectRoleAssignment, Function, Mandate (début, fin, rôles liés). Contraintes : attribution datée, historique conservé, changements audités.

## 4. Membres et cotisations

| Entité | Remarque |
| --- | --- |
| Member | Coordonnées minimales, statut, entrée/sortie ; pas de compte de connexion obligatoire |
| MembershipCampaign | Dates explicites, non recalculées ; règles historisées |
| Fee | Cotisation attendue, tarif figé à l'émission (CA-11) ; pas de créance comptable (ADR 0002) |
| Membership | Bénéficiaire, mode d'effectivité et date d'effet (ADR 0004) |
| PaymentAllocation | transactionId ou journalLineId → Fee, montant ; Σ affecté ≤ montant disponible, payeur ≠ bénéficiaire possible |

## 5. Projets et financements

Project (code unique, statut, permanent oui/non), BudgetVersion, BudgetLine, Commitment, AnalyticalAllocation (ligne de charge/produit → projet, montants dont la somme égale la ligne), Funder, Grant, GrantSchedule, GrantProjectAllocation, FundingExpenseAllocation (alerte si Σ > dépense). Un projet utilisé n'est pas supprimé.

## 6. Dépenses, documents, workflows

ExpenseClaim, ExpenseLine, Settlement. Document (logique), DocumentVersion (immuable, empreinte), DocumentLink (objet cible), DocumentAccessRule. WorkflowDefinitionVersion, WorkflowInstance (référence figée), StepInstance, ApprovalDecision (unique par étape et approbateur).

## 7. Configuration, modules, exploitation

- AssociationSettings + SettingsVersion : paramètres datés ; Branding.
- **ModuleActivation** : module, statut, activé le, par qui ; refus si prérequis absents (ADR 0002).
- AuditEvent : auteur, action, objet, horodatage, justification ; ajout seul, sans secrets.
- BackgroundJob (pg-boss), BackupRecord, ExportJob, ReportTemplateVersion, ReportSnapshot.

## 8. Règles de modélisation transverses

1. Pas de cascade de suppression vers les écritures validées.
2. Toute table modifiable porte `version`, `createdAt`, `createdBy`, `updatedAt`.
3. Les modules optionnels ajoutent des tables ; le noyau ne dépend pas d'elles.
4. Les clés d'idempotence sont des contraintes d'unicité, pas des contrôles applicatifs seuls.
5. Les modules ne modifient pas les écritures directement : ils passent par le service de comptabilité (cadrage §21.2).

## 9. Décisions prises (31 octobre 2026)

1. **Tiers** : comptes collectifs (ex. 401, 467) et champ `thirdPartyId` sur chaque `JournalLine` ; la balance auxiliaire est calculée. Pas de sous-compte par membre ni par fournisseur. `ThirdParty` référence un `Member`, un `Funder` ou un fournisseur.
2. **Numérotation** : table `EntryCounter(journalId, fiscalYearId, lastNumber)` incrémentée sous verrou de ligne dans la transaction de validation ; pas de `SEQUENCE` PostgreSQL. Un rollback ne laisse aucun trou. Contrainte d'unicité `(journalId, fiscalYearId, number)` en filet de sécurité.
3. **Ajustements** : une seule table `JournalEntry`, avec `kind` (normal, adjustment, reversal, opening) et `sourceRef` (type + identifiant de l'objet producteur : fiche d'immobilisation, constaté d'avance…). La contrepassation référence l'original via `reversalOfId`. Les modules appellent le service de comptabilité, jamais la table.
4. **Paramètres versionnés** : `SettingsVersion(section, effectiveFrom, payload JSON, createdBy)` ; le JSON est validé par un schéma côté serveur avant écriture et relu avec la version applicable à la date métier. Les objets structurants (`FiscalYear`, `MembershipCampaign`, `Fee`, `BudgetVersion`) restent des tables typées.

## 10. Reste à instruire

- Schéma de validation des paramètres : un schéma par section, versionné avec l'application ; que faire d'un ancien payload après migration du schéma.
- Définition de `ThirdParty` : entité propre ou lien polymorphe vers Member/Funder/fournisseur ; fournisseurs : entité à créer.
- Verrouillage exact de la validation face à une clôture (ordre des verrous exercice puis compteur).
- Index et contraintes de recherche (transactions par période, montant, libellé).
