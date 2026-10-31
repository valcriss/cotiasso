# 0.3 — Jeu de référence (brouillon v0.1)

Exercice fictif complet servant de test d'acceptation (cadrage §25.2). **Numéros de comptes indicatifs** (voir [0.2](02-referentiel-comptable.md)). Les écritures et états attendus doivent être relus par le trésorier avant de devenir la référence.

## 1. Contexte fictif

- Association créée le 01/01/2026. Exercice 1 : 01/01/2026 → 31/12/2026. Euro.
- Non assujettie à la TVA. Modules actifs : immobilisations, constatés d'avance.
- Comptes financiers : Banque principale (5121), Livret (5122), Caisse (530). Soldes d'ouverture nuls.
- Projets : **Fonctionnement** (permanent), **Atelier** (01/2026 → 06/2027, pluriannuel).
- Membres : A, B, C.

## 2. Opérations

| # | Date | Événement | Écriture (Dr / Cr) | Projet | Critère |
| --- | --- | --- | --- | --- | --- |
| 1 | 05/01 | Cotisations de A et B, 20 € chacun, un virement de 40 € | 5121 40 / 7561 40 | Fonct. | CA-07 |
| 2 | 05/01 | Cotisation de C, 20 € en espèces | 530 20 / 7561 20 | Fonct. | |
| 3 | 15/02 | Subvention de 3 000 € accordée pour Atelier | 441 3 000 / 74 3 000 | Atelier | Attribution ≠ versement |
| 4 | 20/02 | 1er versement de 2 000 € | 5121 2 000 / 441 2 000 | Atelier | |
| 5 | 01/03 | Achat ordinateur 900 €, payé par virement | 2183 900 / 5121 900 | Fonct. | |
| 6 | 10/03 | Facture fournisseur 400 € (fournitures atelier) | 6064 400 / 401 400 | Atelier | |
| 7 | 15/03 | Paiement partiel 250 € | 401 250 / 5121 250 | Atelier | Paiement partiel |
| 8 | 20/03 | Virement interne 300 € Banque → Livret | 5122 300 / 5121 300 | aucun | CA-05 |
| 9 | 02/04 | Frais avancés par un bénévole 80 € | 625 80 / 467 80 | Fonct. | |
| 10 | 10/04 | Remboursement du bénévole | 467 80 / 5121 80 | Fonct. | Remboursement |
| 11 | 15/04 | Solde du paiement de la facture, 150 € | 401 150 / 5121 150 | Atelier | |
| 12 | 20/09 | 2e versement de 1 000 € | 5121 1 000 / 441 1 000 | Atelier | |
| 13 | 01/10 | Assurance 240 € pour 12 mois, payée par virement | 616 240 / 5121 240 | Fonct. | |
| 14 | 15/12 | Facture de location de salle 300 €, **impayée** | 613 300 / 401 300 | Fonct. | Dette ouverte |
| 15 | 31/12 | Amortissement ordinateur sur 3 ans, 10 mois : 900 / 3 × 10/12 | 6811 250 / 28183 250 | Fonct. | Module immobilisations |
| 16 | 31/12 | Charge constatée d'avance : 240 × 9/12 | 486 180 / 616 180 | Fonct. | Module constatés d'avance |
| 17 | 10/05 | Don de 50 € par virement | 5121 50 / 754 50 | Fonct. | Don, hors cotisation |
| 18 | 15/06 | Recette de buvette en espèces, 120 € | 530 120 / 706 120 | Fonct. | Recette d'activité |
| 19 | 30/06 | Remise de 100 € d'espèces en banque | 5121 100 / 530 100 | aucun | Virement interne caisse → banque, CA-05 |
| 20 | 30/06 | Intérêts du livret, 3 € | 5122 3 / 768 3 | Fonct. | Opération issue du relevé, sans pièce |
| 21 | 31/07 | Frais bancaires prélevés, 12 € | 627 12 / 5121 12 | Fonct. | Opération issue du relevé, sans pièce |
| 22 | 20/08 | Annulation motivée de la cotisation de C, remboursée en espèces 20 € | 7561 20 / 530 20 | Fonct. | Correction reliée à l'écriture 2 |

Les opérations 17 à 22 ont été ajoutées après les premières ; l'ordre d'écriture n'est pas chronologique, les dates font foi.

Contrepassation automatique de l'écriture 16 au 01/01/2027 (hors exercice 2026, vérifiée au contrôle d'ouverture).

## 3. États attendus au 31/12/2026

**Soldes de trésorerie** : Banque 1 258 € ; Livret 303 € ; Caisse 20 € ; total 1 581 €.

**Compte de résultat**

| Rubrique | Montant |
| --- | --- |
| Produits : cotisations (7561) 60 − 20 | 40 |
| Produits : subventions (74) | 3 000 |
| Produits : dons (754) | 50 |
| Produits : buvette (706) | 120 |
| Produits financiers (768) | 3 |
| **Total produits** | **3 213** |
| Charges : fournitures atelier (6064) | 400 |
| Charges : location (613) | 300 |
| Charges : assurance (616) 240 − 180 | 60 |
| Charges : frais bénévole (625) | 80 |
| Charges : frais bancaires (627) | 12 |
| Charges : dotation aux amortissements (6811) | 250 |
| **Total charges** | **1 102** |
| **Résultat (excédent)** | **2 111** |

**Bilan**

| Actif | Montant | Passif | Montant |
| --- | --- | --- | --- |
| Immobilisations nettes (900 − 250) | 650 | Résultat de l'exercice | 2 111 |
| Charges constatées d'avance | 180 | Dettes fournisseurs (401) | 300 |
| Trésorerie | 1 581 | | |
| **Total** | **2 411** | **Total** | **2 411** |

Balance : total débits = total crédits sur l'ensemble des comptes.

**Projet Atelier** : subvention 3 000, versée 3 000, charges 400, reste de subvention à affecter 2 600 (à présenter sans conclure à un fonds dédié, module non actif).

## 4. Scénarios de contrôle (rattachés aux CA du cadrage)

| ID | Vérification sur ce jeu |
| --- | --- |
| CA-01 | Réimport du même OFX des opérations 1, 4, 5, 7… : aucun doublon |
| CA-02 | Opération 13 saisie manuellement puis importée : rapprochement proposé |
| CA-03 | Écriture 6 saisie avec 400 au débit et 390 au crédit : refusée |
| CA-05 | Opérations 8 et 19 : aucune charge ni produit |
| CA-07bis | Opération 22 : annulation reliée à l'écriture 2 ; produit net de cotisations 40 € |
| Import | Opérations 20 et 21 importées sans pièce : transactions à qualifier avant comptabilisation, projet Fonctionnement |
| CA-06 | Opération 9 sans projet : brouillon possible, validation bloquée |
| CA-07 | Opérations 1 et 2 : trois cotisations, un paiement groupé, une recette par cotisation |
| CA-12 | Clôture 2026 puis ouverture 2027 : reports corrects, aucun double report |
| CA-13 | États exportés = états à l'écran |

## 5. Extensions prévues

- Exercice 2 incluant la fin de l'Atelier (pluriannuel) et la contrepassation.
- Cas fonds dédiés, TVA assujettie, TVA mixte : jeux séparés au lot 6, validés avant activation.
- Cas d'erreur d'import OFX (variantes, doublons légitimes de même montant).

## 6. À faire valider

- Subvention : produit constaté à l'attribution avec créance 441 (retenu pour ce jeu, décision du 31 octobre 2026) ; confirmer que c'est la pratique de l'association.
- Le trésorier reconnaît-il ces cas comme représentatifs ? Encore absents : prêt ou emprunt, bénévolat valorisé, vente avec facture client.
- Exercice 2027 volontairement reporté ; à ajouter avant de valider CA-12.
- Choix du compte de produit pour les subventions et sous-comptes de cotisations.
