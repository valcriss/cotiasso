# ADR 0024 — Projets, budgets et financements

Statut : **proposé** (2 novembre 2026, lot 4), à valider avec l'utilisateur avant la tranche 4.1. Applique le cadrage §14 (projets et suivi analytique), §15 (subventions et financeurs) et le modèle de données §22 (`BudgetVersion`, `BudgetLine`, `Commitment`, `Funder`, `Grant`, `GrantSchedule`, `GrantProjectAllocation`, `FundingExpenseAllocation`). Prolonge l'[ADR 0013](0013-projets-et-ventilation-analytique.md) (noyau projet) et l'[ADR 0022](0022-portee-projet-des-droits.md) (portée projet des droits).

Les points marqués **À valider** ne sont pas tranchés par le cadrage : ne pas les traiter comme acquis.

## Principes

1. **Quatre notions qui ne se mélangent jamais** (cadrage §14.3) : le **budget** (prévu), l'**engagement** (promis, pas encore comptabilisé), le **réalisé comptable** (écritures comptabilisées, ventilées par projet : source déjà livrée par l'ADR 0013) et les **flux de trésorerie** (transactions). Chaque écran dit laquelle il montre.
2. **Aucune écriture automatique.** Un budget, un engagement, une subvention accordée ou un versement attendu ne créent **aucune écriture comptable**. La comptabilisation d'une subvention (produit, créance, fonds dédiés) relève d'un avis d'expert-comptable (ADR 0006) ; tant qu'elle n'est pas tranchée, le suivi des financements est un **suivi de gestion**, et l'écran le dit.
3. **Pas de seconde source de calcul.** Le réalisé d'un projet vient des mêmes lignes comptabilisées que `GET /projects/:id/summary` et les états du lot 2c (CA-13).
4. **Historique conservé.** Budgets et subventions ne se suppriment pas une fois utilisés : versions, états `ANNULÉ`/`ARCHIVÉ`, motif obligatoire. Garanties en SQL (déclencheurs, tests d'intégration), comme pour les lots précédents.
5. **Public cible** : un trésorier sans formation comptable doit comprendre « prévu / engagé / dépensé / reste » et « accordé / reçu / reste à recevoir » sans aide orale. Chaque formule de « reste disponible » est **affichée avec son périmètre** (cadrage §14.3).

## Tranches

### 4.1 — Fiche projet complète et budgets versionnés

- **Fiche projet** : ajout des **participants** (`ProjectParticipant` : un membre ou un utilisateur, un rôle libre, dates ; information, **aucun droit d'accès attaché**, les droits restent dans les rôles et la portée projet), des objectifs et d'une page de synthèse regroupant budget, financements, documents et échéances.
- **Budget** : `BudgetVersion` (projet, numéro, libellé, date d'approbation facultative, état `DRAFT` → `APPROVED` → `SUPERSEDED`), `BudgetLine` (poste libre ou compte/classe, **sens** charge ou produit, période, montant). Une version approuvée est **immuable** (déclencheur SQL) ; modifier le budget crée une **nouvelle version** reprise de la précédente. Une seule version `APPROVED` en vigueur par projet (index partiel).
- **Périodes** : par exercice ou par intervalle de dates explicite (projet pluriannuel) ; **À valider** : granularité mensuelle ou seulement annuelle.
- Droits : lecture `projects:view`, écriture `projects:update` (déjà scopables par projet).

### 4.2 — Engagements et rapports projet

- **Engagement** (`Commitment`) : montant promis (devis, bon de commande, convention) sur un projet et un poste, état `OPEN` → `INVOICED` / `CANCELLED`. **Anti double comptage** : un engagement est **soldé** quand une écriture comptabilisée y est rattachée (lien explicite, montant rapproché) ; le « reste disponible » = budget − réalisé comptabilisé − engagements **non soldés**, jamais budget − réalisé − engagé total.
- **Rapport projet** : budget approuvé / engagé / réalisé / reste, **vue globale** (toute la vie du projet) et **vue annuelle** (par exercice), par poste. Un projet sans budget approuvé affiche le réalisé seul, jamais des zéros trompeurs. Export CSV sûr (ADR 0021) ; impression pour le PDF.
- **Coûts communs** : ventilation selon une règle explicite et vérifiable (clé de répartition affichée). **À valider** : livrer en 4.2 ou différer (aujourd'hui la ventilation analytique se fait ligne par ligne).

### 4.3 — Financeurs et subventions

- **Financeur** (`Funder`) : nom, type (collectivité, État, fondation, entreprise, autre), contact ; jamais supprimé, archivable. Peut être un **tiers** futur (2.2) ; pas de lien d'écriture tant que les tiers n'existent pas.
- **Subvention** (`Grant`), distincte du projet (cadrage §15) : financeur, référence, objet, montants **demandés** et **accordés**, dates de décision, **période financée**, conditions, obligations de compte rendu (échéances). États : `REQUESTED` → `UNDER_REVIEW` → `GRANTED` / `REFUSED` → `CLOSED` (clôture avec traitement explicite du **reliquat**), `CANCELLED` motivée. Le montant accordé est **figé** à la décision ; une modification ultérieure (avenant) crée une ligne d'historique, pas une réécriture.
- **Répartition sur les projets** (`GrantProjectAllocation`) : une subvention finance un ou plusieurs projets ; Σ des parts = montant accordé (contrôle en base à l'attribution).
- **Échéancier** (`GrantSchedule`) : versements **attendus** (date, montant, condition) ; l'attribution et le versement ne sont **pas confondus**. Un **versement reçu** est un lien vers une `Transaction` (encaissement) avec un montant affecté, comme l'affectation de règlement de l'ADR 0023 : somme des affectations ≤ montant de la transaction ; annulation motivée, jamais de suppression. Les versements traversent librement les exercices.
- **Pièces** : la convention et les courriers sont des **documents** (lot 1.6) liés à la subvention (`DocumentLink`, nouveau type d'objet).
- Droits : nouveaux `grants:view` et `grants:manage` dans le catalogue ; **À valider** : une subvention est-elle scopable par projet (un responsable de projet voit-il les montants des financements de son projet ?). Position proposée : oui en lecture, via les projets qu'elle finance.

### 4.4 — Affectation des dépenses aux financements et comptes rendus

- **Affectation dépense ↔ financement** (`FundingExpenseAllocation`) : rattache une part d'une **ligne de charge ventilée sur un projet** à une subvention. Plafond en base : Σ des affectations d'une ligne ≤ son montant (et ≤ la part du projet) ; au niveau de la subvention, **avertissement** (pas blocage, cadrage §15 : « sauf montage explicitement documenté ») quand le total affecté dépasse le montant accordé ; un **montage de cofinancement documenté** (motif obligatoire) autorise un dépassement du montant de la dépense jusqu'à un plafond saisi. Affectation immuable : annulation motivée.
- **Compte rendu financeur** : état distinct du compte de résultat (cadrage §15) : pour une subvention, dépenses affectées par poste, versements reçus, reliquat, justificatifs liés ; période choisie ; **modèles de restitution** déclaratifs (liste de colonnes et regroupements, pas de script, ADR 0002). Les modèles réels des financeurs sont à recueillir (risque cadrage §24) : livrer **un modèle générique** et rendre le reste configurable.
- **Fonds dédiés** : **non calculés** ici. Le reliquat d'une subvention est un suivi de gestion ; le traitement comptable (fonds dédiés, produits constatés d'avance) reste le module 6.5, après avis externe (ADR 0003 et 0006).

### 4.5 — Droits détaillés par projet sur dossiers et documents

- Héritage des droits documentaires depuis le projet : un document lié à un projet est visible par les utilisateurs ayant `projects:view` sur ce projet ; un document `restricted` garde `documents.restricted:view`. Reprend le reste de la tâche 1.3 (« restrictions documentaires par projet »). Tests de non-régression d'accès (CA-10) sur listes, recherche, exports et téléchargements.

## Critères d'acceptation ajoutés (à inscrire au jeu de référence)

- **CA-14** : un engagement soldé par une écriture n'est jamais compté deux fois dans le « reste disponible ».
- **CA-15** : une subvention accordée puis versée en plusieurs fois sur deux exercices ne crée aucune écriture à elle seule ; l'écart accordé / reçu / reste à recevoir est exact.
- **CA-16** : une dépense affectée à plusieurs financements ne dépasse jamais son montant sans cofinancement documenté ; un utilisateur limité à un projet ne voit ni les montants ni les financements d'un autre projet.

## Hors de ce lot

- Comptabilisation des subventions (créance, produit, fonds dédiés) : lot 6 et avis d'expert-comptable.
- Tiers sur les lignes d'écriture (2.2) : le financeur reste une entité de gestion.
- Demandes de dépenses et circuits de validation (lot 5).
- Reçus fiscaux et dons.
- Format de restitution propre à un financeur donné : un modèle générique d'abord, les autres sur conventions réelles.

## Questions ouvertes

1. Granularité du budget : annuelle ou mensuelle ? (4.1)
2. Coûts communs : clé de répartition dès 4.2 ou plus tard ? (4.2)
3. Visibilité des subventions pour un responsable de projet. (4.3)
4. Le trésorier pilote peut-il fournir une convention et un compte rendu réels (anonymisés) pour caler le modèle générique ? (4.4)
