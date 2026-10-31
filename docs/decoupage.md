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
1.2 Identity & Access : utilisateurs, auth, sessions, récupération, MFA (option), désactivation
1.3 Permissions : rôles, portées globale/projet, moteur de résolution (§6.2), écran « Accès effectifs »
1.4 Association : assistant initial, identité, marque blanche, paramètres versionnés
1.4b Registre des modules activables : activation datée et auditée, modules indisponibles explicites ([ADR 0002](decisions/0002-modules-activables-et-regles-comptables.md))
1.5 Audit : journal d'audit protégé
1.6 Documents : dépôt, versions immuables, liens génériques, contrôles fichiers
1.7 Opérations : sauvegarde cohérente base+fichiers, restauration, santé, version
**Sortie** : instance installable, sauvegardée et restaurée sur instance vierge (CA-14 partiel), CA-10 testable sur le moteur de droits.

### Lot 2a — Noyau comptable

2a.1 Domaine : montants décimaux, arrondis, écriture/lignes, invariants
2a.2 Exercices, journaux, plan de comptes versionné, numérotation concurrente-safe
2a.3 Validation atomique, contrepassation/correction, verrouillage vs clôture (CA-03, CA-04)
2a.4 Noyau projet : projet, projet permanent, allocations analytiques (CA-06)
2a.5 Grand livre, balance, journaux (lecture)

### Lot 2b — Trésorerie

2b.1 Comptes financiers et caisses, soldes initial/calculé/relevé
2b.2 Transactions : saisie manuelle, ventilation, statuts distincts (§9.2)
2b.3 Import OFX : analyse sans validation, doublons, idempotence (CA-01, CA-02), parseur sûr
2b.4 Virements internes (CA-05), liaison transaction → écriture (TreasuryMatch)
2b.5 Rapprochement bancaire avec relevé
2b.6 Import en masse et lots de reprise abandonnables (§20.2)

### Lot 2c — États

2c.1 Bilan et compte de résultat N/N−1, contrôles de comptes non classés
2c.2 Trésorerie, export PDF/CSV/tableur sûr, source de calcul unique (CA-13)

### Lot 3 — Membres et cotisations

3.1 Membres, fonctions, mandats (sans dépendre d'un compte de connexion)
3.2 Campagnes (29/09→28/09), tarifs, cotisations attendues (CA-11)
3.3 Affectations de règlement : partiel, groupé, trop-perçu (CA-07)
3.4 Remboursements/annulations, rappels et reçus simples
3.5 Traitement comptable des cotisations : produit à l'encaissement, sans créance (ADR 0002) ; la créance reste un éventuel module ultérieur

### Lot 4 — Projets et financements

4.1 Fiche projet complète, budgets versionnés, engagements
4.2 Rapports projet (global/annuel), absence de double comptage
4.3 Financeurs, subventions, échéanciers, versements
4.4 Affectation dépenses ↔ financements, comptes rendus financeurs
4.5 Droits détaillés par projet sur dossiers et documents

### Lot 5 — Circuits et finition

5.1 Demandes de dépenses et remboursements (avec/sans workflow, CA-08)
5.2 Moteur de workflows déclaratifs, versionnés, suppléance (CA-09)
5.3 Notifications email
5.4 Reprise complète de l'association pilote et tableau de progression
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
