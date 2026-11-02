# Découpage du projet — document de travail

Statut : brouillon v0.1 — 31 octobre 2026. Dérive du [cadrage v1.0](../cadrage-gestion-associative.md) (§27). Rien ici n'est validé tant que l'utilisateur ne l'a pas confirmé.

## 1. Constats sur le cadrage

Points à trancher ou à ne pas perdre de vue avant de découper plus finement :

1. **Le lot 2 est surchargé** (comptes, transactions, OFX, moteur comptable, projets minimaux, rapprochement, états). Il concentre l'essentiel du risque. → Le scinder en 3 sous-lots (§3).
2. **Lot 0 = prérequis dur** : le moteur comptable ne peut pas être modélisé sans le plan de comptes, les exercices réels, les cas d'ajustement (§12.2) et un référent compétent en comptabilité associative pour valider le jeu de référence (§25.2).
3. **Dépendance cachée projets ↔ comptabilité** : l'affectation projet est obligatoire à la validation (CA-06) alors que les projets sont au lot 4. Le noyau projet (entité, projet permanent « Fonctionnement », allocation analytique) doit donc être livré avec le moteur comptable.
4. **Droits « anticipés dans le modèle dès le socle »** : le modèle permissions/portées (global/projet) et les contrôles documentaires doivent exister au lot 1, même si les écrans détaillés viennent au lot 4. Tests de non-régression d'accès (CA-10) dès le début.
5. **Documents au lot 1 mais droits documentaires par projet au lot 4** : livrer au lot 1 un modèle de lien/permission générique, sans écran projet.
6. **Cotisations et créances** : règle comptable non définie (§13.3, §29) → bloque la partie comptable du lot 3, pas la partie suivi.
7. **TVA, immobilisations, fonds dédiés, annexe, FEC** : explicitement hors V1 ou à décider ; à ne pas laisser se glisser dans un lot sans décision.
8. **Reprise historique** (retenue pour l'association pilote) est livrée au lot 5 mais conditionne la valeur réelle dès le lot 2 : prévoir l'import en masse et les écritures « en préparation » tôt (lot 2b).

## 2. Principes de découpage

- Tranches verticales livrables et testables ; chaque lot a une condition de sortie vérifiable (cf. §27 du cadrage).
- Le domaine comptable est développé et testé en isolation (sans HTTP ni Prisma) avant son exposition.
- Les critères d'acceptation CA-01 à CA-14 sont rattachés au lot qui les rend vérifiables.
- Pas d'estimation calendaire avant clôture du lot 0.

## 3. Lots et epics proposés

### Lot 0 — Conception (aucun code applicatif) — brouillons dans [docs/lot0](lot0/README.md)

| Epic | Livrable | Sortie |
| --- | --- | --- |
| 0.1 Décisions de stack | ADR : NestJS/Fastify, PostgreSQL, Prisma, Angular, auth, file de tâches, stockage documents | ADR validés |
| 0.2 Référentiel comptable | Plan comptable associatif (ANC 2018-06) de départ, journaux, rubriques bilan/résultat | Validé par référent compta |
| 0.3 Cas métier de référence | Jeu fictif complet (§25.2) avec écritures attendues | Validé par référent compta |
| 0.4 Matrice des droits | Permissions × profils par défaut, règles documentaires, suppléants | Matrice validée |
| 0.5 Modèle de données | Schéma conceptuel affiné (§22) puis SQL des modules socle + compta | Revue |
| 0.6 Inventaire de reprise | Sources, formats, volumes de l'association pilote, dates d'exercices | Inventaire fait |
| 0.7 Gouvernance | Nom du produit, titulaire du copyright, LICENSE, politique de marque | Décidé |
| 0.8 Maquettes | Navigation (§7), écrans clés : transaction + panneau latéral, import OFX, validation écriture | Validées |

### Lot 1 — Socle

1.1 Squelette dépôt, CI, Docker/Compose, migrations, config d'environnement
1.2 Identity & Access : utilisateurs, auth, sessions, récupération, MFA (option), désactivation — conception dans l'[ADR 0007](decisions/0007-authentification-conception.md), 6 tâches. **Faites** : 1 utilisateurs et mots de passe, 2 sessions/CSRF/anti-brute-force, 3 assistant initial, 4 réinitialisation et administration des comptes (API et page web de réinitialisation). Les écrans web d'administration (utilisateurs, rôles, mon compte) sont faits. 5 MFA TOTP est fait (obligation par rôle, codes de secours, réinitialisation par un administrateur, pages web de vérification et d'activation avec QR code). **Reste** : 6 OIDC optionnel
1.3 Permissions : rôles, portées globale/projet, moteur de résolution (§6.2), écran « Accès effectifs » — **tranche 1 faite** ([ADR 0008](decisions/0008-autorisation-roles-et-permissions.md)) : rôles et permissions globaux, refus par défaut, protection du dernier administrateur, API des accès effectifs, menu web filtré. **Portée projet faite** ([ADR 0022](decisions/0022-portee-projet-des-droits.md)) : attributions à portée projet, `@RequireProjectAccess`, filtrage des projets, écran « Accès effectifs ». Droits documentaires par projet **faits** avec le lot 4.5 ([ADR 0024](decisions/0024-projets-budgets-et-financements.md))
1.4 Association : assistant initial, identité, marque blanche, paramètres versionnés — **tranche 1 faite** : paramètres versionnés validés par schéma, identité, marque blanche (contraste imposé), pages web. **Reste** : étapes de l'assistant initial au-delà du premier compte (exercices, référentiel, TVA, cotisations, comptes, projet permanent, rôles, workflows, mode de démarrage), logo (dépend des documents, 1.6)
1.4b Registre des modules activables : activation datée et auditée, modules indisponibles explicites ([ADR 0002](decisions/0002-modules-activables-et-regles-comptables.md)) — **fait** (API et onglet Modules ; aucun module livré)
1.5 Audit : journal d'audit protégé — **fait** : ajout seul, chaîne d'empreintes vérifiable, consultation filtrée et paginée, écran web avec vérification d'intégrité. Reste à envisager : export du journal, et ancrage périodique de l'empreinte hors base (hors périmètre pour l'instant)
1.6 Documents : dépôt, versions immuables, liens génériques, contrôles fichiers — **fait** (API, stockage privé, page web ; reste la portée projet, les empreintes d'altération des fichiers et la détection de contenu à risque selon le déploiement)
1.7 Opérations : sauvegarde cohérente base+fichiers, restauration, santé, version — **fait** (service `backup` chiffré, vérification par restauration en base temporaire, restauration confirmée explicitement, onglet web Exploitation, [procédures](exploitation.md)). **Fait ensuite** ([ADR 0026](decisions/0026-exploitation-copie-hors-site-mise-a-jour-et-notes-de-version.md)) : copie hors site automatique (rclone), script de mise à jour qui sauvegarde et vérifie d'abord, notes de version dans l'écran Exploitation
**Sortie** : instance installable, sauvegardée et restaurée sur instance vierge (CA-14 partiel), CA-10 testable sur le moteur de droits.

### Lot 2a — Noyau comptable

2a.1 Domaine : montants décimaux, arrondis, écriture/lignes, invariants
2a.2 Exercices, journaux, plan de comptes versionné, numérotation concurrente-safe — **tranche 1 faite** ([ADR 0009](decisions/0009-structure-comptable-exercices-journaux-comptes.md)) : exercices sans chevauchement, journaux, plan de comptes par import/saisie, garanties SQL, onglet web. **Reste** : versionnement du plan et des rubriques, compteur de numérotation (avec 2a.3)
2a.3 Validation atomique, contrepassation/correction, verrouillage vs clôture (CA-03, CA-04) — **API et écran de saisie faits** ([ADR 0010](decisions/0010-ecritures-comptabilisation-et-contrepassation.md)) : brouillons, comptabilisation atomique et numérotée, contrepassation, immuabilité, verrou d'exercice testé en concurrence. Clôture d'exercice **faite** ([ADR 0011](decisions/0011-cloture-exercice-et-a-nouveaux.md)) : contrôles, fermeture à la saisie, à-nouveaux automatiques, un seul report garanti (CA-12). **Reste** : rapprochements et états de clôture (lots 2b/2c), ajustements des modules (lot 6), projet/tiers sur les lignes, lien de correction (remplacement après contrepassation)
2a.4 Noyau projet : projet, projet permanent, allocations analytiques (CA-06) — **fait** ([ADR 0013](decisions/0013-projets-et-ventilation-analytique.md)) : projets, ventilation, obligation de projet, synthèse, écrans. **Reste** : tiers sur les lignes (avec les membres, lot 3), participants et budgets
2a.5 Grand livre, balance, journaux (lecture) — **fait** (API, onglets web ; exports PDF/CSV avec le lot 2c.2)

### Lot 2b — Trésorerie

2b.1 Comptes financiers et caisses, soldes initial/calculé/relevé — **fait** ([ADR 0014](decisions/0014-tresorerie-comptes-financiers-et-transactions.md))
2b.2 Transactions : saisie manuelle, ventilation, statuts distincts (§9.2) — **fait** pour la saisie manuelle, les filtres et la qualification ; **reste** : ventilation d'une transaction, statuts de comptabilisation et de rapprochement (avec 2b.4 et 2b.5)
2b.3 Import OFX : analyse sans validation, doublons, idempotence (CA-01, CA-02), parseur sûr — **fait** ([ADR 0015](decisions/0015-import-ofx.md)) ; **reste** : validation sur des exports réels anonymisés des banques de l'association, dépôt du fichier d'origine comme document
2b.4 Virements internes (CA-05), liaison transaction → écriture (TreasuryMatch) — **fait** ([ADR 0017](decisions/0017-virements-internes-et-liaison-transaction-ecriture.md)) : préparation d'un brouillon ou association d'une écriture existante, états de comptabilisation, fin de liaison à la contrepassation, virement en deux transactions et un brouillon banque à banque ; **reste** : paiements partiels ou groupés, compte 580 (à valider), ventilation d'une transaction
2b.5 Rapprochement bancaire avec relevé — **fait** ([ADR 0018](decisions/0018-rapprochement-bancaire.md)) : pointage des transactions sur un relevé, écart nul exigé, transactions pointées comptabilisées, figement, annulation du dernier, avertissement à la clôture ; **reste** : rapprochement sans relevé de clôture, reprise de rapprochements antérieurs (2b.6)
2b.6 Import en masse et lots de reprise abandonnables (§20.2) — **fait** ([ADR 0019](decisions/0019-lots-de-reprise-et-qualification-en-masse.md)) : lots de brouillons préparés en masse avec compte rendu, soldes d'ouverture guidés, comptabilisation chronologique avec reprise après erreur, abandon sans effacer le comptabilisé, qualification en masse ; **reste** : tableau de progression par exercice, compte et anomalie (5.4), règles automatiques de qualification, reprise de rapprochements antérieurs

### Lot 2c — États

2c.1 Bilan et compte de résultat N/N−1, contrôles de comptes non classés — **fait** ([ADR 0020](decisions/0020-etats-de-synthese-bilan-et-compte-de-resultat.md)) : catalogue de rubriques, calcul pur testé, colonne N−1 explicite, contrôle d'équilibre, avertissements, page Rapports ; **reste** : validation des rubriques par le trésorier, rubriques versionnées par exercice
2c.2 Trésorerie, export PDF/CSV/tableur sûr, source de calcul unique (CA-13) — **fait** ([ADR 0021](decisions/0021-etat-de-tresorerie-et-exports-surs.md)) : état de trésorerie par compte avec N−1, CSV sûr (formules neutralisées) pour les six états, PDF par impression ; **reste** : classeur `.xlsx` natif, PDF généré côté serveur

### Lot 3 — Membres et cotisations

3.1 Membres, fonctions, mandats (sans dépendre d'un compte de connexion) — **fait** ([ADR 0023](decisions/0023-membres-adhesions-et-cotisations.md)) : fiches, catégories, fonctions et mandats, sortie et anonymisation, page Membres
3.2 Campagnes (29/09→28/09), tarifs, cotisations attendues (CA-11) — **fait** ([ADR 0023](decisions/0023-membres-adhesions-et-cotisations.md)) : campagnes sans chevauchement, mode d'adhésion effective figé, tarifs, adhésions, validation, annulation motivée, onglet Campagnes
3.3 Affectations de règlement : partiel, groupé, trop-perçu (CA-07) — **fait** ([ADR 0023](decisions/0023-membres-adhesions-et-cotisations.md)) : affectation d'une transaction à une ou plusieurs adhésions, reste dû, trop-perçu signalé, adhésion effective à l'encaissement
3.4 Remboursements/annulations, rappels et reçus simples — **fait** ([ADR 0023](decisions/0023-membres-adhesions-et-cotisations.md)) : remboursement affecté, annulation motivée, liste des cotisations restant dues (CSV sûr), reçu simple imprimable (jamais un reçu fiscal)
3.5 Traitement comptable des cotisations : produit à l'encaissement, sans créance (ADR 0002) ; la créance reste un éventuel module ultérieur

### Lot 4 — Projets et financements

Conception **proposée** dans l'[ADR 0024](decisions/0024-projets-budgets-et-financements.md) (à valider avant la tranche 4.1). Ordre : 4.1 → 4.2 → 4.3 → 4.4 ; 4.5 peut se faire à tout moment après 4.1. Aucune écriture comptable automatique dans ce lot.

4.1 Fiche projet complète (participants), budgets versionnés (version approuvée immuable) — **fait** ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) : participants, budgets en versions (brouillon → approuvé → remplacé), approbation séparée de la préparation, panneaux dans la page Projets. **Reste** : objectifs et échéances de la fiche
4.2 Engagements, rapports projet (global/annuel), absence de double comptage (CA-14) — **fait** ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) : engagements soldés par une écriture qui pèse sur le projet (rouverts si elle est contrepassée), suivi budget / engagé / dépensé / reste global ou par exercice (prorata des jours), CSV et impression. **Reste** : coûts communs (clé de répartition)
4.3 Financeurs, subventions, échéanciers, versements (CA-15) — **4.3a faite** (financeurs, subventions, états, répartition, reliquat, droits par projet, écrans ; avenants indisponibles) ; **4.3b faite** (échéancier, versements reçus liés aux transactions, plafond commun avec les cotisations). Décisions prises ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) : lecture des subventions via les projets financés, Σ des parts = accordé exigé à l'accord, reliquat choisi à la clôture sans écriture ; livraison en deux temps (4.3a financeurs, subventions, répartition ; 4.3b échéancier et versements)
4.4 Affectation dépenses ↔ financements, comptes rendus financeurs (CA-16) — **fait** ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) ; **reste** les modèles propres à chaque financeur et les documents justificatifs sur la fiche. Décisions prises ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) : dépassement et hors-période signalés (cofinancement documenté avec motif), compte rendu générique par poste (imprimable, CSV), reliquat = reçu − dépenses affectées, sans écriture
4.5 Droits détaillés par projet sur dossiers et documents — **fait** ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) ; décisions prises ([ADR 0024](decisions/0024-projets-budgets-et-financements.md)) : `documents:view`/`create` applicables à un projet, lecture et dépôt sur son projet, visibilité par projet ou subvention de la portée (jamais si lié à un membre), panneaux Documents sur les fiches

### Lot 5 — Circuits et finition

5.1 Demandes de dépenses et remboursements (avec/sans workflow, CA-08)
5.2 Moteur de workflows déclaratifs, versionnés, suppléance (CA-09)
5.3 Notifications email
5.4 Reprise complète de l'association pilote et tableau de progression — **tableau fait** ([ADR 0027](decisions/0027-tableau-de-progression-de-la-reprise.md)) ; reste la reprise complète sur données réelles (inventaire du pilote)
5.5 Clôture et ouverture suivante (CA-12), rapports figés
5.6 Durcissement sécurité, documentation de distribution, politique de versions

### Lot 6 — Modules d'ajustement et TVA ([ADR 0003](decisions/0003-perimetre-tva-et-modules-ajustement.md))

6.1 Factures non parvenues / dettes (écriture d'ajustement + contrepassation à l'ouverture)
6.2 Charges et produits constatés d'avance
6.3 Immobilisations : fiches, plans d'amortissement, dotations à la clôture, cessions
6.4 TVA assujettie : taux historisés, comptes, HT/TVA/TTC, arrondis reproductibles
6.5 Fonds dédiés (après lot 4 subventions)
6.6 TVA activité mixte (déductibilité partielle)
Chaque module : jeu de référence validé par le référent compta avant d'être activable. Le mécanisme commun (écritures d'ajustement, contrepassation) est prévu dès le lot 2a.

## 4. Dépendances principales

```
Lot 0 ──► Lot 1 ──► Lot 2a ──► Lot 2b ──► Lot 2c
                      │           │
                      ├──────────►├──► Lot 3
                      └──► Lot 4 ─┴──► Lot 5
```

Le lot 6 dépend de 2a (mécanisme d'ajustement) et de 5.5 (clôture) ; 6.5 dépend aussi du lot 4. Lot 3 et lot 4 peuvent être parallélisés après 2b (fichiers distincts, modules distincts). Lot 5.1/5.2 suppose 3 et 4.

## 5. Questions bloquantes (à trancher en premier)

| # | Question | Bloque |
| --- | --- | --- |
| Q1 | ~~Valides-tu la stack ?~~ **Tranchée** : voir [ADR 0001](decisions/0001-stack-technique.md) | — |
| Q2 | ~~Référent compta~~ **Tranchée** : le trésorier du pilote ; avis externe requis avant TVA, fonds dédiés, amortissements ([ADR 0006](decisions/0006-referent-comptable-et-reprise.md)) | — |
| Q3 | ~~Dates des exercices~~ **Tranchée** : paramétrables ([ADR 0002](decisions/0002-modules-activables-et-regles-comptables.md)). Reste à relever les dates réelles du pilote pour la reprise | 5.4 (inventaire 0.6) |
| Q4 | ~~TVA~~ **Tranchée** : paramétrable. Reste Q4b ci-dessous | — |
| Q4b | ~~Modes de TVA~~ **Tranchée** : les trois modes dans le périmètre, livrés par étapes ([ADR 0003](decisions/0003-perimetre-tva-et-modules-ajustement.md)) | — |
| Q5 | ~~Ajustements de clôture~~ **Tranchée** : 4 modules activables (immobilisations, constatés d'avance, factures non parvenues, fonds dédiés) | — |
| Q5b | ~~Modules d'ajustement~~ **Tranchée** : les quatre dans le périmètre, registre d'immobilisations automatisé, livraison par étapes ([ADR 0003](decisions/0003-perimetre-tva-et-modules-ajustement.md)) | — |
| Q5c | ~~Ordre de livraison du lot 6~~ **Tranchée** : validé ([ADR 0003](decisions/0003-perimetre-tva-et-modules-ajustement.md)) | — |
| Q6 | ~~Créance cotisation~~ **Tranchée** : produit constaté à l'encaissement, pas de créance | — |
| Q6b | ~~Adhésion effective~~ **Tranchée** : trois modes paramétrables ([ADR 0004](decisions/0004-adhesion-effective-et-nom-de-travail.md)) | — |
| Q7 | Nom de travail « cotiasso » retenu ([ADR 0004](decisions/0004-adhesion-effective-et-nom-de-travail.md)). **Reste : nom définitif et titulaire du copyright** | LICENSE, première publication |
| Q8 | ~~Authentification et MFA~~ **Tranchée** : comptes locaux, OIDC optionnel, MFA par rôle ([ADR 0005](decisions/0005-authentification-et-exploitation.md)) | — |
| Q9 | ~~Hébergement et sauvegarde~~ **Tranchée** : VPS, sauvegarde quotidienne, RPO/RTO 24 h ([ADR 0005](decisions/0005-authentification-et-exploitation.md)) | — |
| Q10 | ~~Relevés existants~~ **Tranchée** : OFX, moins de 1 000 opérations ([ADR 0006](decisions/0006-referent-comptable-et-reprise.md)) | — |
| Q11 | Le trésorier peut-il fournir dès maintenant : date de création, dates d'exercice, liste des comptes et caisses, fichiers OFX disponibles par période ? | Inventaire 0.6 |
| Q12 | Nom définitif du produit et titulaire du copyright | Première publication |
