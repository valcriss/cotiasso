# 0035 — Demandes de remboursement et circuits de validation

Statut : **Retenu** (3 novembre 2026) : les cinq points qui étaient à valider l'ont été avec l'utilisateur (voir « Points tranchés » en fin de document). Applique le cadrage §16 (dépenses et remboursements) et §17 (workflows optionnels et configurables) ; couvre les lots 5.1 (demandes), 5.2 (moteur) et la suite de 5.3 (notifications, après l'[ADR 0034](0034-emails-d-invitation-et-de-reinitialisation.md)). Critères d'acceptation visés : CA-08 (circuit désactivé) et CA-09 (changement de circuit).

## Contexte

Une association veut qu'un membre puisse demander le remboursement d'une avance personnelle (achat réglé de sa poche), que le bureau donne son accord, puis que le trésorier rembourse et enregistre. Le circuit type de l'association pilote : **membre → président → trésorier**. D'autres associations auront d'autres circuits (plusieurs personnes pouvant valider, étapes en plus ou en moins), et le même mécanisme servira un jour à d'autres demandes, avec des **branches** (par exemple selon un montant).

Le public cible reste un trésorier sans formation comptable ([CLAUDE.md](../../CLAUDE.md)) : l'écran parle de « demande de remboursement », de « qui doit donner son accord ? » et de « à rembourser », pas de workflow ni d'instance.

## Décisions

### Périmètre de la première version

- **Un seul type de demande : le remboursement d'une avance personnelle.** Le **bénéficiaire est toujours le demandeur**. Pas d'achat à réaliser ni de facture à payer (le cadrage les distingue, ils viendront ensuite sur le même moteur). Aucun engagement n'est créé automatiquement (lot 4.2 inchangé).
- **Pas de paiement partiel** : on rembourse la totalité du montant demandé, ou rien.
- **Qui peut demander** : toute personne dont le compte est **lié à une fiche membre active** (`Member.userId`). Un compte sans fiche membre (par exemple l'administrateur technique seul) ne peut pas déposer de demande et l'écran lui dit pourquoi.
- **Un circuit par type de demande** dans l'association. Pas de seuil de montant ni de branche en V1 (modèle prêt, voir plus bas).
- **Sans circuit actif, aucune demande de membre n'est possible** (CA-08) : le trésorier continue d'enregistrer lui-même un remboursement par le parcours « J'ai dépensé de l'argent ». La fonction est **activable** par l'association (catalogue de modules, ADR 0002) ; l'activation installe un **circuit de départ** « membre → président → trésorier », modifiable.

### Le circuit

Un **circuit** est une suite de **nœuds** reliés par des **liens**. En V1 :

| Nœud | Rôle |
| --- | --- |
| `START` | Dépôt de la demande |
| `APPROVAL` | Étape de validation : une des personnes désignées donne son accord |
| `PROCESSING` | Étape de traitement : rembourser, associer le mouvement bancaire et enregistrer |
| `END` | Fin (remboursée) |

- Un circuit comporte **de 0 à 3 étapes de validation** puis **une étape de traitement obligatoire et unique**, en dernier. Il n'y a ni branche ni étape parallèle en V1.
- **Qui valide une étape** se désigne **au choix** par : des **personnes nommées** (comptes actifs liés à un membre), un **rôle** (attributions globales actives), ou une **fonction du bureau** (par exemple « Président », d'après les fonctions et mandats en cours des membres). On peut en cumuler plusieurs ; **une seule personne désignée suffit** à valider l'étape. C'est ainsi que se traitent « plusieurs personnes avec le même statut » et la suppléance : pas de mécanisme de suppléance distinct en V1.
- **Le circuit enregistre la désignation, pas les personnes résolues.** Quand la présidence change, le circuit suit sans modification. Une fonction se désigne par son **identifiant dans le catalogue de fonctions** (voir ci-dessous), jamais par un texte : renommer « Président » en « Présidente » ne casse aucun circuit. L'éditeur signale « personne n'occupe actuellement cette fonction ».
- **Catalogue de fonctions** (prérequis, évolution du lot 3.1) : table `OfficeRole` (nom unique sans tenir compte de la casse ni des accents, **jamais supprimée**, archivable ; archiver une fonction utilisée par un circuit actif est refusé avec un message qui nomme le circuit). `MemberOffice` référence désormais une fonction du catalogue (`officeRoleId`) au lieu d'un intitulé libre. La migration crée une entrée par intitulé distinct déjà saisi (comparaison sans casse ni accents) et rattache chaque mandat existant, sans rien perdre ; la page Membres gère le catalogue (état vide qui propose « Président », « Trésorier », « Secrétaire »). Une fonction **n'accorde toujours aucun droit d'accès** par elle-même : elle ne sert qu'à désigner qui peut valider une étape. Ajouter les actions d'audit `office-role.*` à `audit-labels.ts`.
- **Désigner n'accorde aucun droit supplémentaire.** Un validateur peut voir et décider les demandes de son étape, rien d'autre. Pour l'étape de traitement, la personne désignée doit en plus détenir `transactions:manage` et `entries:create` (et `entries:post` pour comptabiliser) : le serveur le vérifie à chaque action.

### Règles d'enchaînement

1. **Dispense du demandeur.** Chaque étape de validation a une option « le demandeur en est dispensé s’il fait partie des personnes désignées » (**active par défaut**). À la soumission, les étapes concernées sont **validées d'office**, une décision `AUTO_APPROVED` étant **enregistrée et visible** (« validée d'office : le demandeur est habilité »). Jamais d'approbation silencieuse. Seules les étapes du demandeur sautent : un trésorier qui demande un remboursement passe bien par le président.
2. **Jamais sa propre validation sans dispense.** Si la dispense est décochée, le demandeur ne peut pas valider sa propre demande. Si une étape n'a alors aucune autre personne désignée, la **soumission est refusée** avec un message qui dit quelle étape est bloquée et qui contacter (jamais une demande qui reste coincée).
3. **Le traitement n'est jamais dispensé.** Par défaut **personne ne traite sa propre demande** ; si aucune autre personne n'est habilitée, le message est le même qu'en 2. Une association à un seul trésorier peut lever cette règle par le réglage `allowSelfProcessing` du circuit (faux par défaut, **versionné et audité** comme le reste du circuit).
4. **Trois décisions à chaque étape de validation** : **accepter**, **refuser** (motif obligatoire, vu du demandeur) et **renvoyer pour correction** (message obligatoire). Le traitement permet de rembourser ou de renvoyer pour correction.
5. **Après un renvoi.** La demande passe à l'état « à corriger ». Le demandeur peut alors modifier motif, justificatif, date, montant et projet, puis la renvoyer. **Si le montant, la date ou le projet ont changé, le circuit repart de la première étape** (les décisions précédentes restent dans l'historique) ; sinon elle reprend **à l'étape qui l'avait renvoyée**.
6. **Hors renvoi, la demande déposée est figée** (montant, date, projet, justificatif). Pour la changer, on la renvoie pour correction, ou on l'annule et on en dépose une autre.
7. **Annulation** par le demandeur tant que rien n'est remboursé, avec motif. Un refus ou une annulation est définitif : on redépose, jamais de suppression. Seul un **brouillon** (demande pas encore soumise) se supprime.

### Versionnement et évolution d'un circuit

- Une **version de circuit** est un document déclaratif (graphe JSON validé par un schéma **zod**, comme les paramètres). Brouillon modifiable, puis **active** (immuable, ajout seul par déclencheur SQL), puis **retirée**. Une seule version active par type de demande.
- **Une demande garde la version de circuit de sa soumission** (CA-09). Une modification ne s'applique qu'aux nouvelles demandes. Aucune migration automatique d'une demande en cours : un administrateur peut seulement **réaffecter l'étape en cours** (ajouter des personnes habilitées pour cette demande), action explicite, motivée et auditée.
- **Désactiver la fonction avec des demandes en cours** exige de choisir leur sort (les laisser finir ou les annuler avec motif) ; jamais d'approbation automatique.
- **Signalements** (à l'édition du circuit puis dans « À faire ») : compte désactivé, personne n'occupe la fonction, étape sans personne habilitée, demandeur seul habilité, demande en attente sans personne pouvant décider.

### Un moteur pensé pour évoluer

- **Le circuit est stocké comme un graphe** (nœuds, liens étiquetés par l'issue) et non comme une liste, pour accueillir plus tard conditions (seuil de montant), branches et étapes parallèles **sans migrer les circuits existants**. Les types de nœud `CONDITION` et `PARALLEL` sont **réservés et explicitement indisponibles** : le schéma les refuse avec un message, jamais d'acceptation partielle. Aucun script, aucun langage d'expression ; chaque type de nœud est connu du code.
- **Le moteur ne connaît pas les remboursements.** Il gère un **objet soumis à circuit** (`subjectType`, `subjectId`) : le remboursement s'enregistre auprès du moteur (démarrage, issue finale, refus, annulation, résumé à afficher). Un nouveau type de demande n'exige pas de toucher au moteur.
- **Cœur pur et testé** : une fonction `advance(circuit, état, décision) → nouvel état + effets` sans HTTP ni base, dans un dossier sans dépendance (`apps/api/src/workflows/engine/`), testée à fond avec Vitest. Ce n'est pas un module de comptabilité, il n'entre donc pas dans `packages/accounting-domain` ; on peut l'extraire en paquet à part si un autre usage apparaît.
- **N'implémenter que ce que la V1 utilise** : le modèle laisse la place, le code ne contient pas de branche spéculative.

### Données (noms de code en anglais)

- `WorkflowDefinition` (type de demande, activée ou non) et `WorkflowDefinitionVersion` (numéro, état `DRAFT`/`ACTIVE`/`RETIRED`, graphe, version de schéma, `allowSelfProcessing`, dates, auteur).
- `WorkflowInstance` (objet soumis, version de circuit **figée**, état), `StepInstance` (nœud, état `PENDING`/`DONE`/`SKIPPED`, personnes ajoutées par réaffectation) et `ApprovalDecision` (**ajout seul**, auteur, issue `APPROVED`/`AUTO_APPROVED`/`REFUSED`/`RETURNED`/`PROCESSED`, message, date).
- `ReimbursementRequest` : demandeur, fiche membre, montant (chaîne décimale, `NUMERIC` en base), date de la dépense, motif, projet (« Fonctionnement » par défaut), état (`DRAFT`, `IN_CIRCUIT`, `RETURNED`, `REFUSED`, `CANCELLED`, `PAID`), instance, numéro de révision, contrôle de version optimiste. « À rembourser » n'est pas un état stocké : c'est la demande dont l'étape de traitement est en cours.
- `ReimbursementPayment` : lie la demande à la **transaction bancaire** de remboursement et à l'écriture ; une transaction ne rembourse qu'une demande et une demande n'est remboursée qu'une fois.
- **Garanties en SQL** (comme les lots précédents) : versions actives et décisions en ajout seul ; `TRUNCATE` refusé ; **une seule décision effective par étape** (index partiel unique + verrou `FOR UPDATE` de l'étape, donc des clics concurrents n'en retiennent qu'une, cadrage §17.3) ; l'état de l'instance n'avance que dans un sens ; une demande n'est modifiable qu'en brouillon ou « à corriger » ; le paiement exige une transaction **sortante**, du **même montant**, non déjà affectée. Les refus de déclencheurs ont un message lisible (`db-refusal.ts`).

### Droits

- Nouvelles permissions du catalogue : `reimbursements:create` (déposer et suivre **ses propres** demandes), `reimbursements:view` (voir **toutes** les demandes, pour le trésorier et le bureau), `workflows:view` et `workflows:admin` (consulter, éditer et activer les circuits).
- **Valider n'est pas une permission** : c'est être désigné pour l'étape en cours (`@Authenticated()` + contrôle dans le service, qui est l'autorité). Un test d'intégration le couvre.
- **Rôle « Membre »** (modifiable) ne contenant que `reimbursements:create`, attribué **à la main** par l'administrateur (`default-roles.ts` l'installe ; les installations existantes le reçoivent à la mise à jour).
- **Confidentialité** : un membre ne voit que **ses** demandes ; un validateur voit celles dont une de ses étapes est en cours ou passée ; `reimbursements:view` voit tout. Une demande hors portée est **introuvable (404)**.

### Justificatif obligatoire

- **Pas de soumission sans au moins un justificatif** (document non archivé relié à la demande). Nouveau type de lien `reimbursement-request` (`LINKABLE_OBJECT_TYPES`).
- Le membre dépose par une **route propre à la demande** qui réutilise le service de documents (liste blanche des formats, empreinte, nettoyage du fichier si l'opération échoue) : il n'a **aucun droit général sur les documents**.
- **Tout nouveau chemin de lecture passe par `DocumentsService.access()`** : un justificatif de demande n'est visible que du demandeur, des validateurs de la demande, du traitement et de `reimbursements:view` ; une personne limitée à un projet ne le voit jamais (il n'est lié à aucun de ses projets). Tests d'accès dédiés (liste, détail, téléchargement, recherche), comme `documents-scope.test.ts`.

### Traitement par le trésorier (réutilise l'existant)

À l'étape « à rembourser », la personne habilitée **choisit la catégorie** (sens « argent qui sort », active), puis soit **associe un mouvement bancaire existant** du même montant, soit **crée l'opération** (compte bancaire, date). L'enregistrement passe par le cœur déjà utilisé (`bookRow`) : le **projet de la demande** est repris (la règle « projet obligatoire » du CA-06 est donc satisfaite dès le dépôt, par défaut « Fonctionnement »), la comptabilisation dépend de `entries:post`. **Tout ou rien en une transaction SQL** : si l'enregistrement est refusé, la demande reste « à rembourser » et le message dit pourquoi. **Aucune règle comptable nouvelle.** Montant bancaire différent du montant demandé : refusé (pas de partiel).

Si l'opération est annulée plus tard (contrepassation), la demande reste « remboursée » mais l'écran signale l'anomalie ; une réouverture automatique n'est pas prévue.

### Écrans

- **Membre** : « Mes demandes de remboursement » (liste, dépôt en boîte de dialogue avec glisser-déposer du justificatif, état en mots courants : « En attente de l'accord du président », « À corriger : <message> », « Remboursée le … », « Refusée : <motif> »). Etat vide qui dit quoi faire.
- **Validateur** : liste « À valider » avec le justificatif lisible dans la boîte de décision ; le résumé de la demande dit ce qui se passera après l'accord (« elle ira au trésorier »).
- **Trésorier** : liste « À rembourser » et boîte de traitement avec l'aperçu « Ce que verra l'expert-comptable ».
- **Vue d'ensemble** : les tâches « demandes à valider » et « demandes à rembourser » apparaissent dans « À faire » **même pour une personne sans autre droit** (le contenu reste filtré par ce que la personne peut décider).
- **Schéma du circuit** : dessiné en SVG par un composant maison (aucune bibliothèque, ni CDN), avec **équivalent texte** pour l'accessibilité. Il s'affiche dans l'éditeur (mise à jour en direct) et sur chaque demande avec l'avancement (faite, en cours, à venir, validée d'office, renvoyée).
- **Éditeur de circuit** : formulaire guidé (« Qui doit donner son accord ? », ajouter une étape, ordre, personnes / rôles / fonctions, options de dispense), pas d'éditeur par glisser-déposer en V1 (inutile sans branches, plus difficile pour un trésorier novice).
- Les libellés d'audit sont à ajouter à `audit-labels.ts`.

### Notifications (tranche 5.3 suite)

- **File d'envoi** : les notifications sont écrites **dans la même transaction SQL que la décision** puis envoyées par un traitement d'arrière-plan avec nouvel essai (pg-boss, [ADR 0001](0001-stack-technique.md) ; reprise annoncée par l'ADR 0034). **Un échec d'envoi ne défait jamais une décision.**
- **Qui reçoit quoi** : les personnes désignées pour l'étape atteinte (« une demande attend votre accord »), le demandeur à chaque décision (acceptée par une étape, refusée, renvoyée, remboursée). Contenu minimal : prénom et nom du demandeur, lien ; ni justificatif ni coordonnées.
- **L'email n'est jamais la source de vérité** : l'état dans l'application fait foi. Le contenu n'est pas journalisé ; l'audit garde le type seulement. Sans SMTP, rien ne change (la fonction fonctionne, les gens consultent « À faire »).
- Pas de rappel automatique d'attente en V1.

### Audit

Événements sans montant ni texte libre : `workflow.version.created`, `workflow.version.activated`, `workflow.step.reassigned`, `reimbursement.submitted`, `reimbursement.approved`, `reimbursement.auto-approved`, `reimbursement.refused`, `reimbursement.returned`, `reimbursement.cancelled`, `reimbursement.paid`.

## Tranches proposées

0. **Catalogue de fonctions** (évolution du lot 3.1) : `OfficeRole`, migration des mandats existants, gestion dans la page Membres. Indépendant du reste et livrable seul.
1. **Moteur et circuits (5.2)** : cœur pur et testé, tables, versions, schéma zod, garanties SQL, API de définitions, circuit de départ, activation. Aucun écran de membre.
2. **Demandes de remboursement (5.1)** : modèle, dépôt, justificatif, décisions, renvoi, traitement, droits, rôle « Membre », « À faire », écrans membre, validateur et trésorier.
3. **Éditeur et schéma du circuit** : formulaire guidé, schéma en lecture, signalements.
4. **Notifications email (5.3)** : file d'envoi, gabarits, préférences minimales.

Chaque tranche : tests unitaires du moteur, tests d'intégration sur la vraie base, entrée dans le `CHANGELOG.md` et mise à jour de la feuille de route.

## Tests d'acceptation visés

- CA-08 : sans circuit actif, le traitement direct reste soumis aux droits et contrôles comptables.
- CA-09 : une demande en cours garde la version de circuit de sa soumission après modification.
- Dispense : le président qui demande saute son étape (décision « validée d'office » visible) ; le trésorier qui demande passe par le président.
- Le demandeur ne traite pas sa propre demande par défaut ; avec le réglage, oui, et c'est audité.
- Deux validateurs cliquent en même temps : une seule décision est retenue.
- Une fonction dont le titulaire change : le nouveau titulaire peut valider, l'ancien non. Renommer la fonction dans le catalogue ne casse pas le circuit ; l'archiver alors qu'un circuit actif l'utilise est refusé.
- Migration du catalogue : des intitulés existants qui ne diffèrent que par la casse ou les accents donnent une seule fonction ; aucun mandat n'est perdu.
- Étape sans personne habilitée : la soumission est refusée avec un message en trois temps.
- Renvoi : montant changé → repart de la première étape ; sinon reprend à l'étape qui a renvoyé.
- Un justificatif de demande est invisible à toute personne non concernée, y compris par la recherche et les listes de documents.
- Traitement : montant bancaire différent → refus lisible ; refus d'enregistrement → rien n'est modifié.

## Hors périmètre (explicitement indisponible)

Seuils de montant, branches, étapes parallèles, quorum, achat à réaliser, facture à payer, paiement partiel, remboursements groupés, rappels automatiques, personnalisation du texte des emails, éditeur de circuit par glisser-déposer.

## Points tranchés avec l'utilisateur (3 novembre 2026)

1. **Catalogue de fonctions** plutôt qu'un intitulé libre (modifie le lot 3.1 : `MemberOffice` référence le catalogue).
2. Après un renvoi, montant, date ou projet modifiés → le circuit repart de la première étape.
3. Moteur dans `apps/api/src/workflows/engine/` plutôt que dans un paquet du dépôt.
4. Fonction activable comme module disponible dès la livraison (aucune règle comptable nouvelle ; la mention de l'[ADR 0003](0003-perimetre-tva-et-modules-ajustement.md) sur la validation du jeu de référence est jugée sans objet ici, à relire si le traitement évolue).
5. Une demande remboursée dont l'opération est annulée reste « remboursée » avec une anomalie signalée.
