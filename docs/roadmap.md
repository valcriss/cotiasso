# Feuille de route

Statut : état au 2 novembre 2026. Synthèse lisible de ce qui est **fait** et de ce qui **reste**, classé par **priorité**. Le détail des lots, des dépendances et des questions ouvertes est dans [decoupage.md](decoupage.md) ; chaque décision structurante a son ADR dans [decisions/](decisions/). Ce document n'est pas une promesse de calendrier : aucune estimation n'est donnée avant la validation du lot 0 par le trésorier du pilote.

**Repères de lecture**

- **Fait** : livré, testé (tests unitaires, tests d'intégration sur la vraie base, CI verte) et décrit dans `CLAUDE.md`.
- **Priorité 1** : nécessaire pour qu'une association réelle puisse tenir ses comptes de bout en bout.
- **Priorité 2** : important, mais l'application est utilisable sans.
- **Priorité 3** : fonctions associatives complètes, à livrer ensuite.
- **Priorité 4** : différé, soit parce qu'il dépend d'un avis externe (expert-comptable), soit parce que le besoin n'est pas avéré.

Le public cible est celui des trésorier·ères bénévoles sans formation comptable ([CLAUDE.md](../CLAUDE.md), [design.md](../design.md)) : toute fonction restante est à concevoir avec ce critère (langage courant, aide, erreurs en trois temps).

---

## 1. Ce qui est en place

### Socle (lot 1) — fait pour l'essentiel

| Domaine | Livré | Référence |
| --- | --- | --- |
| Dépôt et exploitation | Monorepo npm (domaine comptable, API NestJS, web Angular), CI GitHub Actions, images Docker `api` / `web` / `backup`, Compose de production | ADR 0001 |
| Comptes et sécurité | Comptes locaux (argon2id), sessions avec protection CSRF, anti-force-brute, assistant d'installation à jeton unique, invitation et réinitialisation par lien, double authentification TOTP (obligation par rôle, codes de secours) | ADR 0005, 0007 |
| Droits | Rôles modifiables, refus par défaut vérifié à chaque route, protection du dernier administrateur, menu filtré | ADR 0008 |
| Association | Paramètres versionnés, identité, marque blanche (contraste imposé), registre de modules activables (aucun module livré) | ADR 0002, 0003 |
| Audit | Journal en ajout seul, chaîné par empreintes, vérification d'intégrité, écran de consultation | cadrage §11.2 |
| Documents | Dépôt en flux, versions immuables, liens génériques, liste blanche de formats, documents restreints | cadrage §18 |
| Opérations | Sauvegarde cohérente base + fichiers chiffrée, vérification par restauration, restauration confirmée, onglet Exploitation, procédures | [exploitation.md](exploitation.md) |

### Noyau comptable (lot 2a) — fait

| Domaine | Livré | Référence |
| --- | --- | --- |
| Structure | Exercices sans chevauchement, journaux, plan de comptes (import « numéro;libellé » ou saisie), garanties en SQL | ADR 0009 |
| Écritures | Brouillons, comptabilisation atomique et numérotée sans trou, contrepassation reliée, immuabilité, verrou d'exercice testé en concurrence (CA-03, CA-04) | ADR 0010 |
| Clôture | Fermeture à la saisie, clôture définitive, à-nouveaux automatiques, un seul report possible (CA-12) | ADR 0011 |
| Projets | Projet permanent « Fonctionnement », ventilation analytique par ligne de charge ou de produit, obligation de projet (CA-06), synthèse par projet | ADR 0013 |
| États de lecture | Grand livre, balance, livre-journal d'un exercice, avec garde-fou de taille | cadrage §11 |

### Trésorerie (lot 2b) — fait

| Domaine | Livré | Référence |
| --- | --- | --- |
| Comptes et transactions | Banques et caisses, trois soldes distincts (ouverture, calculé, comptable), relevés en ajout seul, transactions manuelles, qualification (contrepartie, projet) | ADR 0014 |
| Import OFX | Analyseur écrit à la main (OFX 1.x et 2.x), analyse sans rien créer, doublons, rapprochement avec les saisies, confirmation tout ou rien, idempotence (CA-01, CA-02) | ADR 0015 |
| Liaison à la comptabilité | Préparer un brouillon depuis une transaction ou associer une écriture existante, états « à comptabiliser / en cours / comptabilisée », fin de liaison à la contrepassation | ADR 0017 |
| Virements internes | Deux transactions reliées et un brouillon banque à banque, sans charge ni produit (CA-05) | ADR 0017 |
| Rapprochement bancaire | Pointage des transactions sur un relevé, écart nul exigé, figement, annulation du dernier, avertissement à la clôture | ADR 0018 |
| État de trésorerie et exports (lot 2c.2) | État de trésorerie par compte avec exercice précédent ; export CSV sûr (formules neutralisées, audité) des états de synthèse et de lecture ; PDF par impression du navigateur | ADR 0021 |
| Portée projet des droits | Attributions de rôle limitées à un projet (intersection avec les droits applicables à un projet), accès filtrés côté serveur, écran « Accès effectifs » | ADR 0022 |
| États de synthèse (lot 2c.1) | Compte de résultat et bilan avec exercice précédent en regard, contrôle d'équilibre, avertissements (comptes sans rubrique, exercice précédent non clôturé) ; page Rapports | ADR 0020 |
| Reprise | Lots de brouillons préparés en masse, soldes d'ouverture guidés (origine expliquée), comptabilisation chronologique avec compte rendu et reprise après erreur, abandon sans effacer le comptabilisé, qualification en masse | ADR 0019 |

### Interface

| Domaine | Livré | Référence |
| --- | --- | --- |
| Conception | Guide `design.md` : en-tête avec description, barre d'outils, formulaires en boîtes de dialogue, succès en bandeau, cartes et boutons homogènes ; appliqué à **toutes** les pages | ADR 0016 |
| Apparence | Thème clair, sombre ou système, densité confortable ou compacte (choix de l'utilisateur), accent de l'association, jetons de couleur | ADR 0012 |
| Pédagogie | Libellés en langage courant, états vides utiles, messages d'erreur en trois temps, conséquences montrées avant les actions irréversibles (comptabiliser, valider un rapprochement, comptabiliser un lot) | CLAUDE.md |

---

## 2. Ce qui reste, par priorité

### Priorité 1 — pour tenir une comptabilité réelle de bout en bout

| # | Élément | Pourquoi maintenant | Dépend de |
| --- | --- | --- | --- |
| 1.1 | **Validation du lot 0 par le trésorier du pilote** : plan de comptes, rubriques de bilan et de résultat, jeu de référence, cas d'ajustement | Tout le code comptable repose sur des brouillons non validés ; aucune affirmation de conformité n'est possible sans cette relecture. C'est le principal risque restant | Disponibilité du trésorier (Q2, ADR 0006) |
| 1.2 | **États de synthèse (lot 2c)** : ~~bilan et compte de résultat N / N−1~~ **fait** (ADR 0020, rubriques à faire relire) ; **état de trésorerie fait aussi** (ADR 0021) | C'est l'aboutissement du travail déjà fait et ce dont l'assemblée générale a besoin. Les écritures, la clôture et les rapprochements existent : il manque ce qu'on en lit | 1.1 pour les rubriques ; source de calcul unique avec les états de lecture (CA-13) |
| 1.3 | ~~**Exports sûrs**~~ **fait** (ADR 0021) : CSV neutralisé et PDF par impression, pour les états et les états de lecture ; reste, au besoin, un `.xlsx` natif et un PDF serveur | Une comptabilité qu'on ne peut pas remettre à l'assemblée ni à l'expert-comptable ne sert pas | 1.2 |
| 1.4 | **Validation de l'import OFX sur des exports réels anonymisés** des banques de l'association | Seules des fixtures fictives sont testées ; les exports réels varient d'une banque à l'autre | Fichiers fournis par le trésorier (Q11) |
| 1.5 | **Inventaire de reprise du pilote** : date de création, dates d'exercice, liste des comptes et caisses, fichiers OFX disponibles | Les lots de reprise sont prêts ; sans cet inventaire on ne peut pas les exécuter sur des données réelles | Trésorier (Q11, lot 0.6) |

### Priorité 2 — importants, l'application reste utilisable sans

| # | Élément | Pourquoi | Dépend de |
| --- | --- | --- | --- |
| 2.1 | ~~**Portée projet des droits**~~ **fait** (ADR 0022) ; reste l'héritage vers les documents, avec le lot 4 | Droit retenu au cadrage (« droits globaux et par projet »), encore non implémenté : tout est global aujourd'hui | Projet existant (ADR 0013) |
| 2.2 | **Tiers sur les lignes d'écriture** | Prérequis des membres, des financeurs et d'un suivi propre des créances et dettes | Arrive avec le lot 3 |
| 2.3 | ~~**Écrans d'administration des droits**~~ **fait** : « Voir les accès » et attributions avec portée | L'API existe ; manque la vue qui permet de comprendre qui peut quoi | 2.1 |
| 2.4 | **Étapes de l'assistant initial** au-delà du premier compte : exercices, plan de comptes, comptes bancaires, projet permanent, rôles, mode de démarrage | Aujourd'hui ces réglages se font un par un dans Paramètres ; l'assistant guiderait un trésorier débutant | 1.1 |
| 2.5 | **Exploitation** : copie hors site automatique, sauvegarde automatique avant mise à jour, notes de version | Les sauvegardes existent mais restent sur le serveur | [exploitation.md](exploitation.md) |
| 2.6 | **Dépôt du fichier OFX d'origine comme document** (preuve jointe à l'import) | Complète la traçabilité des imports | Documents (lot 1.6) |
| 2.7 | **Suites de la comptabilité** : versionnement du plan de comptes et des rubriques, lien de correction (remplacement après contrepassation), ventilation d'une transaction | Améliorations de fond identifiées pendant les lots 2a et 2b | 1.1 |

### Priorité 3 — fonctions associatives complètes

| # | Élément | Contenu | Dépend de |
| --- | --- | --- | --- |
| 3.1 | **Membres et cotisations (lot 3)** : membres, fonctions et mandats, campagnes (29/09 → 28/09), tarifs, cotisations attendues (CA-11), affectations de règlement partiel, groupé, trop-perçu (CA-07), remboursements, reçus simples | Fonction centrale d'une association ; règle comptable déjà tranchée : produit constaté à l'encaissement, sans créance (ADR 0002, 0004) | 2.2 |
| 3.2 | **Projets et financements (lot 4)** : fiche projet complète, budgets versionnés, rapports sans double comptage, financeurs, subventions, échéanciers, comptes rendus financeurs | Peut se faire en parallèle du lot 3 | 2.1 |
| 3.3 | **Tableau de progression de la reprise** par exercice, compte et anomalie (5.4) | Donne une vue d'ensemble de ce qui reste à reprendre | Lots de reprise (ADR 0019) |
| 3.4 | **Rapports figés** à la clôture et ouverture suivante complète (5.5) | S'appuie sur la clôture déjà livrée | 1.2 |
| 3.5 | **Authentification OIDC optionnelle** | Décidée comme optionnelle (ADR 0005) | — |
| 3.6 | **Export du journal d'audit** | Besoin de contrôle ou d'archivage hors application | — |

### Priorité 4 — différé

| # | Élément | Pourquoi différé |
| --- | --- | --- |
| 4.1 | **Demandes de dépenses, remboursements et circuits de validation** (5.1 à 5.3) : moteur de workflows déclaratifs, suppléance, notifications email | Suppose les lots 3 et 4 ; optionnel et configurable (cadrage §15) |
| 4.2 | **Modules d'ajustement (lot 6)** : factures non parvenues, charges et produits constatés d'avance, immobilisations et amortissements, fonds dédiés | **Avis d'un expert-comptable requis avant activation** (ADR 0006) ; chaque module reste « indisponible » tant qu'il n'est pas validé sur le jeu de référence (ADR 0003) |
| 4.3 | **TVA** assujettie puis activité mixte | Même règle : avis externe et jeu de référence validé (ADR 0003) |
| 4.4 | **Durcissement et distribution (5.6)** : revue de sécurité, documentation d'installation, politique de versions | Utile avant d'ouvrir à d'autres associations |
| 4.5 | **Gouvernance** : nom définitif du produit, titulaire du copyright, LICENSE, politique de marque (Q7, Q12) | Nécessaire avant une première publication, pas avant un usage par le pilote |
| 4.6 | **Améliorations de confort** : règles automatiques de qualification par mots du libellé, rapprochement sans relevé de clôture, paiements partiels ou groupés, compte 580 pour les virements | Besoins non avérés, ou points comptables à faire valider ; écartés volontairement des tranches livrées |
| 4.7 | **Migration vers TypeScript 7** de tout le dépôt en une fois | Bloquée tant qu'Angular ne la supporte pas (versions alignées sur 6.0.3) |

---

## 3. Ordre conseillé

1. **Obtenir du trésorier** la relecture du lot 0 et l'inventaire de reprise (1.1, 1.5) : c'est la seule étape qui ne dépend pas du code et qui conditionne la confiance dans tout le reste. À lancer sans attendre.
2. **Livrer les états de synthèse puis les exports** (1.2, 1.3) : ils rendent le travail déjà fait visible pour l'assemblée générale et l'expert-comptable.
3. **Essayer la reprise sur des données réelles** (1.4, avec les exports fournis) : c'est le premier vrai test des lots de reprise et de l'import OFX.
4. **Droits par projet puis tiers** (2.1, 2.2), qui ouvrent les lots 3 et 4.
5. **Membres et cotisations**, en parallèle des **projets et financements** (3.1, 3.2).
6. **Circuits, modules d'ajustement et TVA** en dernier (4.1 à 4.3), et seulement après avis externe pour ces deux derniers.

Les éléments de priorité 2 et 3 sans dépendance forte (2.5, 2.6, 3.5, 3.6) peuvent se glisser entre deux lots, quand la place se présente.

## 4. Points ouverts

- **Q11** : le trésorier peut-il fournir la date de création, les dates d'exercice, la liste des comptes et caisses, et les fichiers OFX disponibles par période ? (bloque 1.4, 1.5)
- **Q7 / Q12** : nom définitif du produit et titulaire du copyright (bloque la première publication).
- **Compte 580** : usage pour les virements internes à valider avec un expert-comptable ; sans lui, les virements sont enregistrés banque à banque (ADR 0017).
- **Validation externe** requise avant d'activer TVA assujettie ou mixte, fonds dédiés et amortissements (ADR 0006).
