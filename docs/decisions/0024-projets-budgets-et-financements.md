# ADR 0024 — Projets, budgets et financements

Statut : **proposé** (2 novembre 2026, lot 4) ; **tranches 4.1, 4.2, 4.3a, 4.3b et 4.4 livrées** le 2 novembre 2026 (voir les sections « ce qui a été livré »), la tranche 4.5 reste à valider. Applique le cadrage §14 (projets et suivi analytique), §15 (subventions et financeurs) et le modèle de données §22 (`BudgetVersion`, `BudgetLine`, `Commitment`, `Funder`, `Grant`, `GrantSchedule`, `GrantProjectAllocation`, `FundingExpenseAllocation`). Prolonge l'[ADR 0013](0013-projets-et-ventilation-analytique.md) (noyau projet) et l'[ADR 0022](0022-portee-projet-des-droits.md) (portée projet des droits).

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

- **Engagement** (`Commitment`) : montant promis (devis, bon de commande, convention) sur un projet et un poste, état `OPEN` → `SETTLED` (soldé) / `CANCELLED` (le nom `INVOICED` du projet initial a été remplacé par `SETTLED`, plus général). **Anti double comptage** : un engagement est **soldé** quand une écriture comptabilisée y est rattachée (lien explicite, montant rapproché) ; le « reste disponible » = budget − réalisé comptabilisé − engagements **non soldés**, jamais budget − réalisé − engagé total.
- **Rapport projet** : budget approuvé / engagé / réalisé / reste, **vue globale** (toute la vie du projet) et **vue annuelle** (par exercice), par poste. Un projet sans budget approuvé affiche le réalisé seul, jamais des zéros trompeurs. Export CSV sûr (ADR 0021) ; impression pour le PDF.
- **Coûts communs** : ventilation selon une règle explicite et vérifiable (clé de répartition affichée). **À valider** : livrer en 4.2 ou différer (aujourd'hui la ventilation analytique se fait ligne par ligne).

### 4.3 — Financeurs et subventions

**Livraison en deux temps (décidé avec l'utilisateur) :** **4.3a** financeurs, subventions (états, montants, dates, conditions), répartition sur les projets, reliquat à la clôture, droits et écrans ; **4.3b** échéancier et versements reçus liés aux transactions. Chaque temps est testé, documenté et poussé séparément. Les pièces (documents liés) suivent 4.3a si le lien documentaire le permet sans autre chantier.

- **Financeur** (`Funder`) : nom, type (collectivité, État, fondation, entreprise, autre), contact ; jamais supprimé, archivable. Peut être un **tiers** futur (2.2) ; pas de lien d'écriture tant que les tiers n'existent pas.
- **Subvention** (`Grant`), distincte du projet (cadrage §15) : financeur, référence, objet, montants **demandés** et **accordés**, dates de décision, **période financée**, conditions, obligations de compte rendu (échéances). États : `REQUESTED` → `UNDER_REVIEW` → `GRANTED` / `REFUSED` → `CLOSED`, `CANCELLED` motivée. **Reliquat (décidé avec l'utilisateur) : à la clôture, l'utilisateur choisit obligatoirement le sort du reliquat** (à rembourser au financeur, conservé avec l'accord du financeur, ou nul), avec une note ; le choix est enregistré, audité et affiché, **sans aucune écriture comptable** (fonds dédiés = module 6.5, après avis d'expert-comptable). Le montant accordé est **figé** à la décision ; une modification ultérieure (avenant) crée une ligne d'historique, pas une réécriture.
- **Répartition sur les projets** (`GrantProjectAllocation`) : une subvention finance un ou plusieurs projets. **Décidé avec l'utilisateur : Σ des parts = montant accordé, exigé par la base au moment de l'accord** (passage à `GRANTED`) ; tant que la subvention est seulement demandée ou en instruction, la répartition est libre (aucun total exigé). Après l'accord, la répartition est figée comme le montant (un avenant passe par l'historique).
- **Échéancier** (`GrantSchedule`) : versements **attendus** (date, montant, condition) ; l'attribution et le versement ne sont **pas confondus**. Un **versement reçu** est un lien vers une `Transaction` (encaissement) avec un montant affecté, comme l'affectation de règlement de l'ADR 0023 : somme des affectations ≤ montant de la transaction ; annulation motivée, jamais de suppression. Les versements traversent librement les exercices.
- **Pièces** : la convention et les courriers sont des **documents** (lot 1.6) liés à la subvention (`DocumentLink`, nouveau type d'objet).
- Droits : nouveaux `grants:view` et `grants:manage` dans le catalogue. **Décidé avec l'utilisateur (2 novembre 2026) : un responsable de projet voit en lecture les subventions qui financent son projet, avec leurs montants et leurs versements ; il ne les modifie pas.** `grants:view` devient donc scopable par projet (`PROJECT_SCOPABLE_PERMISSIONS`) : une subvention est visible si l'utilisateur a le droit global, ou un droit sur au moins un des projets qu'elle finance ; le service filtre, une subvention hors portée est introuvable (404). `grants:manage` reste global. Un responsable limité à un projet voit la subvention entière (montant total, autres projets financés compris) : la variante « sa part seulement » a été écartée.

### 4.4 — Affectation des dépenses aux financements et comptes rendus

**Décidé avec l'utilisateur (2 novembre 2026) :**
- **Dépassement du montant accordé : avertir, avec un motif possible.** On n'empêche pas d'affecter plus de dépenses que le montant accordé ; l'avertissement est visible sur la subvention et dans le compte rendu, et un **cofinancement documenté** (motif obligatoire) permet d'expliquer le dépassement.
- **Période financée : avertir.** Une dépense datée hors de la période financée peut être affectée, mais elle est signalée « hors période financée » à l'écran et dans le compte rendu. Sans période renseignée sur la subvention, aucun contrôle.
- **Compte rendu : un modèle générique d'abord**, imprimable (PDF par impression du navigateur) et en CSV sûr : pour une subvention, dépenses affectées regroupées **par poste (compte)**, versements reçus, reliquat, sur la période choisie. Les modèles propres à chaque financeur, et leur paramétrage déclaratif, attendent des conventions réelles (question 4 ci-dessous).
- **Reliquat : calculé et montré, sans écriture.** Reliquat = montant **reçu** − dépenses **affectées** (comptabilisées). Affiché sur la subvention et dans le compte rendu, et proposé comme valeur de départ à la clôture. C'est un suivi de gestion : aucun fonds dédié n'est calculé.

- **Affectation dépense ↔ financement** (`FundingExpenseAllocation`) : rattache une part d'une **ligne de charge ventilée sur un projet** à une subvention. Plafond en base : Σ des affectations d'une ligne ≤ son montant (et ≤ la part du projet) ; au niveau de la subvention, **avertissement** (pas blocage, cadrage §15 : « sauf montage explicitement documenté ») quand le total affecté dépasse le montant accordé ; un **montage de cofinancement documenté** (motif obligatoire) autorise un dépassement du montant de la dépense jusqu'à un plafond saisi. Affectation immuable : annulation motivée.
- **Compte rendu financeur** : état distinct du compte de résultat (cadrage §15) : pour une subvention, dépenses affectées par poste, versements reçus, reliquat, justificatifs liés ; période choisie ; **modèles de restitution** déclaratifs (liste de colonnes et regroupements, pas de script, ADR 0002). Les modèles réels des financeurs sont à recueillir (risque cadrage §24) : livrer **un modèle générique** et rendre le reste configurable.
- **Fonds dédiés** : **non calculés** ici. Le reliquat d'une subvention est un suivi de gestion ; le traitement comptable (fonds dédiés, produits constatés d'avance) reste le module 6.5, après avis externe (ADR 0003 et 0006).

### 4.5 — Droits détaillés par projet sur dossiers et documents

- Héritage des droits documentaires depuis le projet : un document lié à un projet est visible par les utilisateurs ayant `projects:view` sur ce projet ; un document `restricted` garde `documents.restricted:view`. Reprend le reste de la tâche 1.3 (« restrictions documentaires par projet »). Tests de non-régression d'accès (CA-10) sur listes, recherche, exports et téléchargements.

## Tranche 4.1 — ce qui a été livré

Décisions prises à la réalisation (réponses aux questions ouvertes 1 de l'ADR, à relire) :

1. **Périodes de budget = dates explicites** (début et fin de chaque ligne), sans granularité imposée : une ligne peut couvrir un mois, un exercice ou toute la durée du projet. Aucune contrainte de cohérence avec les dates du projet ni avec les exercices (une ligne peut chevaucher deux exercices) ; le rapprochement avec le réalisé par exercice viendra avec la tranche 4.2.
2. **Un seul brouillon à la fois par projet** (index partiel), pour qu'il n'y ait pas deux budgets en préparation qui se contredisent ; créer un brouillon recopie par défaut la dernière version (ou celle choisie). Un brouillon se modifie en **remplaçant l'ensemble de ses lignes** (`PUT /budgets/:id`), se supprime ; une version approuvée ou remplacée **ne se supprime ni ne se modifie** (déclencheurs SQL `budget_version_guard` et `budget_line_guard`, `TRUNCATE` refusé). Un budget **vide ne s'approuve pas**. Approuver remplace la version en vigueur dans la même transaction, sous le verrou du projet (numéros et approbations sérialisés).
3. **Lignes** : charge ou produit, poste libre, compte **facultatif** (classe 6 pour une charge, classe 7 pour un produit, contrôlé en base), montant strictement positif en chaîne décimale. Pas encore de lien avec le réalisé (4.2).
4. **Droits** : lecture `projects:view` (filtrée par la portée projet : un projet hors portée est introuvable, 404), préparation et suppression de brouillon `budgets:update`, approbation `budgets:approve` ; ces deux droits restent **globaux** (non scopables, `PROJECT_SCOPABLE_PERMISSIONS` inchangé). Dans les rôles par défaut, le trésorier prépare et le **membre du bureau approuve** : celui qui prépare n'approuve pas.
5. **Participants** (`ProjectParticipant`) : un membre **ou** un utilisateur (contrainte SQL), rôle libre, dates facultatives, note ; modifiables et **retirables** (information sans effet comptable, retrait audité) ; **aucun droit d'accès** attaché, testé. L'écran propose les **membres actifs** ; le rattachement d'un utilisateur existe dans l'API (`userId`) mais pas encore dans l'écran. Droit `projects:update`, scopable par projet.
6. **Audit** : `budget.created|updated|approved|deleted` et `project.participant.added|updated|removed`, sans montant ni donnée personnelle.
7. **Écrans** : panneaux « Budget prévisionnel » et « Participants » sous la synthèse de la page Projets (`project-budget.ts`, `budget-dialog.ts`, `project-participants.ts`, `participant-dialog.ts`). Le brouillon est affiché d'office quand il existe ; l'approbation montre ses conséquences avant de s'exécuter.

Reste de la fiche projet « complète » (cadrage §14.1) : objectifs, échéances et vue de synthèse regroupant financements et documents, à compléter avec les tranches suivantes.

## Tranche 4.2 — ce qui a été livré

Décisions prises à la réalisation (à relire) :

1. **Engagement** (`Commitment`) : projet, objet, montant promis, date, compte de charges **facultatif** (classe 6, contrôlé en base), note. États `OPEN` → `SETTLED` (soldé) ou `CANCELLED` (annulé **avec motif**). **Jamais supprimé** (déclencheur SQL `commitment_guard`, `TRUNCATE` refusé) ; montant, objet, date et compte ne bougent que tant qu'il est ouvert. Aucune écriture comptable.
2. **Solder = lier une écriture qui pèse réellement sur le projet.** La base refuse de solder si l'écriture n'est pas **comptabilisée**, ou si elle ne porte aucune dépense (classe 6) **ventilée sur ce projet** (`commitment_entry_weight` > 0) : un engagement ne peut donc jamais disparaître des engagements sans apparaître au réalisé (CA-14). Une seule écriture de solde à la fois ; deux soldes simultanés : un seul passe (testé).
3. **Contrepassation de l'écriture de solde** : l'engagement est **rouvert** (état affiché `REOPENED`, dérivé de l'état de l'écriture, pas stocké) et recompte comme engagé, sinon la dépense disparaîtrait des deux côtés. Un engagement rouvert peut être re-soldé par une autre écriture ou annulé (avec motif) ; il ne peut pas être « re-soldé » par la même écriture contrepassée.
4. **Rapport budgétaire** (`GET /projects/:id/budget-report[?fiscalYearId=]` et `/csv`) : budget **en vigueur** (version approuvée), engagé non soldé, réalisé et reste disponible, par poste, **vue globale** ou **par exercice**. Reste des dépenses = budget − réalisé − engagé non soldé ; reste des recettes = budget − encaissé (formule et périmètre affichés avec les chiffres). Sans budget en vigueur : le réalisé seul, **aucun reste**, avertissement (pas de zéros trompeurs).
5. **Rapprochement budget ↔ réalisé** : par **compte**. Les lignes de budget sans compte sont des postes « libres » : montrées avec leur budget mais sans réalisé ligne à ligne ; le réalisé et les engagements sur des comptes que le budget ne mentionne pas apparaissent dans des lignes **« compte non indiqué dans le budget »**, jamais perdus ; les **totaux restent exacts** (toute la matière est comptée).
6. **Vue annuelle** : le réalisé est celui de l'exercice ; une ligne de budget qui déborde l'exercice est répartie **au prorata du nombre de jours** (calcul en centimes entiers, arrondi au plus proche, `budget-proration.ts`, avertissement affiché ; un centime d'écart est possible d'un exercice à l'autre, la vue globale utilise toujours le montant exact) ; un engagement compte dans l'exercice de **sa date**.
7. **Même source que la synthèse** : `loadProjectActuals` (`project-actuals.ts`) sert à la fois `GET /projects/:id/summary` et le rapport (CA-13) ; la synthèse a été refactorée sur cette fonction, ses tests n'ont pas changé.
8. **Droits** : lecture `projects:view` (filtrée par la portée projet, hors portée = 404) ; créer, modifier, annuler `budgets:update` ; **solder et lister les écritures candidates exigent aussi `entries:view`** (le solde lie une écriture comptable). Export CSV sûr (ADR 0021), audité `report.exported` ; PDF par impression du navigateur.
9. **Audit** : `commitment.created|updated|settled|cancelled` (motif d'annulation en justification, jamais de montant dans le détail).
10. **Écrans** : panneaux « Suivi du budget » (période, tableaux dépenses/recettes, formule, avertissements, CSV, impression), « Engagements » (boîtes enregistrer/modifier, solder, annuler) dans la page Projets ; le suivi se recharge quand le budget ou un engagement change.

**Coûts communs** : non traités (question ouverte 2 inchangée) ; la ventilation analytique reste ligne par ligne.

## Tranche 4.3a — ce qui a été livré

Décisions prises à la réalisation, en plus de celles arrêtées avec l'utilisateur (à relire) :

1. **Financeur** (`Funder`) : nom (unique, casse et espaces ignorés), type (collectivité, État, fondation, entreprise, autre), contact, email, téléphone, note. **Jamais supprimé** ; **archivé**, il ne reçoit plus de nouvelle demande et ne se réactive pas (déclencheur `funder_guard`, `TRUNCATE` refusé).
2. **Subvention** (`Grant`) : financeur, référence facultative (unique par financeur), objet, montant demandé, montant accordé, dates de demande et de décision, **période financée**, conditions, note. États `REQUESTED` → `UNDER_REVIEW` → `GRANTED` / `REFUSED` → `CLOSED`, ou `CANCELLED` ; **l'état n'avance que dans un sens** et n'existe qu'avec ses pièces (accord : montant et date ; refus et annulation : motif ; clôture : date et sort du reliquat), garantis par une contrainte et le déclencheur `grant_guard`. Une subvention **accordée** ne peut qu'être **clôturée** (pas annulée) ; **refusée, clôturée ou annulée**, seule sa **note** change. **Jamais supprimée.**
3. **Répartition** (`GrantProjectAllocation`) : libre avant la décision, remplaçable en bloc (`PUT /grants/:id/allocations`) ; **à l'accord la base exige Σ parts = montant accordé et au moins un projet**, puis la répartition est figée (`grant_allocation_guard`). L'accord peut corriger la répartition dans le même appel, dans une seule transaction ; le service refuse d'abord avec un message qui donne les deux totaux.
4. **Avenants : indisponibles, explicitement.** Après l'accord, le montant, les dates, le financeur et la répartition sont figés ; toute tentative de les changer est refusée avec le motif « les avenants ne sont pas encore pris en charge ». L'historique d'avenants mentionné plus haut reste à faire (tranche ultérieure) : on ne l'accepte pas « à moitié ». Restent modifiables après l'accord : objet, référence, conditions, note, date de la demande.
5. **Reliquat** : à la clôture, choix obligatoire entre « à rembourser », « conservé avec l'accord du financeur » et « aucun », avec une **précision obligatoire** dès qu'il y a un reliquat ; enregistré, audité, affiché. **Aucune écriture comptable.** Le montant du reliquat n'est pas calculé ici : il viendra avec les versements (4.3b) et les dépenses affectées (4.4).
6. **Droits** : `grants:view` rejoint `PROJECT_SCOPABLE_PERMISSIONS` ; la lecture passe par `@RequireProjectAccess('grants:view')` et **une subvention n'est visible que si elle finance un projet de la portée** (sinon introuvable, 404). Le responsable de projet la voit **entière** (montant total et autres projets financés compris), comme décidé. `GET /projects/:id/grants` liste celles d'un projet (404 hors portée). **La liste des financeurs reste réservée au droit global** `grants:view` ; l'écriture exige `grants:manage` (global). Conséquence : `/auth/me` renvoie aussi `grants:view` dans `projectPermissions` pour un responsable de projet.
7. **Audit** : `funder.created|updated|archived` et `grant.created|updated|allocations-set|reviewed|granted|refused|cancelled|closed`, sans aucun montant ; motif de refus et d'annulation en justification.
8. **Écrans** : page **Subventions** (`apps/web/src/app/grants/`, route `/subventions`, entrée de menu existante) avec liste filtrable par état, détail et actions selon l'état, panneau des financeurs ; panneau **Financements** en lecture seule dans la page Projets. À l'accord, le bouton reste grisé tant que la répartition ne totalise pas exactement le montant accordé, avec le reste à répartir affiché en direct.
9. **Pièces** : le type d'objet `grant` existe déjà pour les liens documentaires (lot 1.6) ; l'écran de la subvention ne présente pas encore ses documents liés (à ajouter avec 4.3b ou 4.4).

## Tranche 4.3b — ce qui a été livré

Décisions prises à la réalisation (à relire) :

1. **Échéance** (`GrantSchedule`) : un versement attendu (date, montant, condition), seulement pour une subvention **accordée** et pas encore clôturée. **La somme des échéances ne dépasse jamais le montant accordé** (la base le vérifie sous le verrou de la subvention ; le service refuse d'abord avec « il ne reste que X € à planifier »). Modifiable, retirable tant qu'aucun versement n'y est rattaché ; **figée à la clôture**. C'est un plan : aucune écriture.
2. **Versement reçu** (`GrantPayment`) : une part d'une **transaction** (un encaissement, montant positif) rattachée à une subvention accordée, avec en option l'échéance qu'elle règle. **Aucune écriture comptable** : l'encaissement se comptabilise à part (CA-15, testé : deux versements sur deux années, aucune écriture créée). Ne se modifie ni ne se supprime jamais (déclencheur SQL) : on l'**annule avec un motif** (3 caractères au moins), il reste dans l'historique et l'encaissement redevient disponible.
3. **Plafond commun avec les cotisations** : une même transaction peut financer des cotisations et une subvention, mais **jamais plus que son montant au total**. La fonction `transaction_allocated_total` additionne les affectations de cotisations et les versements de subvention actifs ; le garde des affectations de cotisations (`payment_allocation_guard`) et le contrôle de modification du montant d'une transaction l'utilisent désormais (migration `add_grant_schedule_and_payments`), et la liste des encaissements candidats des cotisations aussi. Verrou sur la transaction pour les saisies simultanées.
4. **Après la clôture, plus rien ne bouge** : on n'enregistre ni n'annule plus de versement, on ne touche plus à l'échéancier. **À relire** : un versement qui arriverait après la clôture est refusé avec un message ; il faut alors décider avec le financeur (le reliquat se règle à la clôture, ADR plus haut).
5. **Trop-perçu signalé, jamais masqué** : le total reçu peut dépasser le montant accordé (comme un trop-perçu de cotisation) ; la vue le marque `overReceived` et l'écran l'écrit en toutes lettres.
6. **Vue financière** (`GET /grants/:id/finance`) : accordé, prévu, **reçu**, **reste à recevoir** (accordé − reçu), part non planifiée, échéances avec état dérivé (`PENDING`, `PARTIAL`, `RECEIVED`) et retard (`overdue`, date passée et échéance non entièrement reçue), versements avec la date de l'encaissement et le montant. **Le libellé bancaire n'est pas exposé** ici (un responsable de projet ne consulte pas forcément les comptes) : il n'apparaît que dans la liste des encaissements candidats, qui exige aussi `financial-accounts:view`. `GrantView` porte la somme `received`. Même portée de lecture que la subvention (hors portée : 404).
7. **Droits** : écriture `grants:manage` (comme pour les cotisations, pas de droit sur les transactions en plus) ; lecture `grants:view` filtrée par la portée projet.
8. **Audit** : `grant.schedule.added|updated|removed` et `grant.payment.recorded|cancelled`, sans montant ; motif d'annulation en justification.
9. **Écrans** : panneau « Échéancier et versements » (`grants/grant-finance.ts`, boîtes dans `grant-finance-dialogs.ts`) dans le détail d'une subvention accordée ou clôturée ; colonne « Reçu » dans la liste. L'encaissement choisi propose sa part disponible.

**Reste** : le **montant du reliquat** reste à calculer (reçu − dépenses affectées) avec la tranche 4.4 ; les documents liés à la subvention ne sont toujours pas présentés sur sa fiche.

## Tranche 4.4 — ce qui a été livré

En plus des décisions arrêtées avec l'utilisateur (dépassement et hors-période signalés, compte rendu générique, reliquat calculé), décisions prises à la réalisation (à relire) :

1. **Affectation** (`FundingExpenseAllocation`) : une **part d'une dépense** (une ligne de charge ventilée sur un projet, `AnalyticalAllocation`) affectée à une subvention. Conditions garanties par la base (`funding_expense_guard`) : la subvention est **accordée** (pas clôturée) ; la dépense est un **débit de classe 6** d'une **écriture comptabilisée** ; son projet est **financé par la subvention** ; la somme des affectations d'une dépense, **toutes subventions confondues**, ne dépasse **jamais son montant** (verrou sur la dépense pour les saisies simultanées). Jamais supprimée ni modifiée : **annulée avec un motif** (3 caractères au moins), elle reste dans l'historique et la dépense redevient disponible. Plus aucun changement après la clôture. Aucune écriture comptable.
2. **Plafond de la dépense : pas de dérogation.** L'ADR initial prévoyait qu'un « cofinancement documenté » puisse dépasser le montant de la dépense ; la décision prise avec l'utilisateur place le motif de cofinancement au niveau du **montant accordé** (dépassement signalé, motif possible). Affecter plus qu'une dépense n'a pas coûté n'a pas de sens : ce plafond reste dur.
3. **Avertissements, jamais de blocage** : total affecté > montant accordé (écart chiffré, motif de cofinancement affiché), dépense datée **hors de la période financée** (rien si la subvention n'a pas de période), affectation dont l'**écriture a été contrepassée** depuis (elle **ne compte plus**, état dérivé comme pour les engagements, et le message invite à l'annuler ou à affecter la dépense corrigée).
4. **Vue** `GET /grants/:id/expenses` : dépenses affectées (date, poste, projet, part, drapeaux) et total qui compte ; **le libellé de l'écriture n'est montré** qu'avec un droit global ou pour une dépense d'un projet de la portée de l'utilisateur (sinon montant, poste et projet seulement). `GET /grants/:id/expense-candidates` (charges comptabilisées des projets financés avec leur part libre, 100 au plus) exige `grants:manage` **et** `entries:view`.
5. **Compte rendu** `GET /grants/:id/report?from=&to=` (+ `/csv`, CSV sûr audité `report.exported`, impression pour le PDF) : dépenses affectées **regroupées par poste (compte)**, versements reçus sur la période, **reliquat = reçu − dépenses affectées sur la période**, montant accordé, avertissements, explications de cofinancement. Sans paramètre, aucune borne ; l'écran propose la **période financée** par défaut. Même portée de lecture que la subvention.
6. **Reliquat** : `GET /grants/:id/finance` rend aussi `spent` et `residual` (reçu − dépenses affectées, sur toute la vie) ; la boîte de **clôture** l'affiche comme valeur de départ. Le choix du sort du reliquat reste celui de l'utilisateur ; aucun fonds dédié n'est calculé.
7. **Audit** : `grant.expense.attached|cancelled`, sans montant ni libellé (un drapeau `coFinanced` seulement).
8. **Écrans** : panneaux « Dépenses affectées » (affecter, annuler, avertissements) et « Compte rendu pour le financeur » dans le détail d'une subvention accordée ou clôturée.

**Reste** : les modèles propres à chaque financeur (en attente de conventions réelles), la présentation des **documents justificatifs** liés à une subvention (le lien documentaire de type `grant` existe mais l'écran ne les montre pas), et les avenants.

## Critères d'acceptation ajoutés (à inscrire au jeu de référence)

- **CA-14** : un engagement soldé par une écriture n'est jamais compté deux fois dans le « reste disponible ».
- **CA-15** : une subvention accordée puis versée en plusieurs fois sur deux exercices ne crée aucune écriture à elle seule ; l'écart accordé / reçu / reste à recevoir est exact.
- **CA-16** : une dépense affectée à plusieurs subventions ne dépasse jamais son montant ; un utilisateur limité à un projet ne voit que les subventions qui le financent (entières) et le détail des écritures de ses propres projets.

## Hors de ce lot

- Comptabilisation des subventions (créance, produit, fonds dédiés) : lot 6 et avis d'expert-comptable.
- Tiers sur les lignes d'écriture (2.2) : le financeur reste une entité de gestion.
- Demandes de dépenses et circuits de validation (lot 5).
- Reçus fiscaux et dons.
- Format de restitution propre à un financeur donné : un modèle générique d'abord, les autres sur conventions réelles.

## Questions ouvertes

1. ~~Granularité du budget : annuelle ou mensuelle ?~~ Tranchée en 4.1 : dates explicites par ligne (voir ci-dessus), à relire.
2. Coûts communs : clé de répartition dès 4.2 ou plus tard ? (4.2)
3. ~~Visibilité des subventions pour un responsable de projet.~~ Tranchée avec l'utilisateur : lecture via les projets financés (voir 4.3). Restent hors de ce lot : répartition libre avant l'accord, reliquat sans écriture.
4. Le trésorier pilote peut-il fournir une convention et un compte rendu réels (anonymisés) pour caler les modèles propres à chaque financeur ? (après 4.4 : le modèle générique est livré sans cela)
