# 0.2 — Référentiel comptable (brouillon v0.1)

Base : plan comptable associatif (ANC 2018-06). **Numéros indicatifs, à vérifier contre le règlement avant implémentation.** Le plan livré est un jeu de départ versionné et personnalisable (cadrage §11.3).

## 1. Journaux par défaut

| Code | Journal | Usage |
| --- | --- | --- |
| BQ-n | Banque (un par compte bancaire) | Écritures de trésorerie liées aux transactions |
| CA | Caisse | Mouvements en espèces |
| AC | Achats | Factures fournisseurs |
| PR | Produits | Cotisations, subventions, ventes |
| OD | Opérations diverses | Ajustements, amortissements, corrections |
| AN | À-nouveaux | Report des soldes à l'ouverture d'un exercice |

La numérotation est attribuée à la validation, par journal et par exercice (cadrage §11.2).

## 2. Comptes de départ (extrait)

| Classe | Comptes | Libellé |
| --- | --- | --- |
| 1 | 102, 106, 110/119, 120/129 | Fonds associatifs, réserves, report à nouveau, résultat |
| 1 | 19x | Fonds dédiés (module) |
| 2 | 21x, 28x | Immobilisations et amortissements (module) |
| 4 | 401, 408 | Fournisseurs, factures non parvenues (module) |
| 4 | 411, 441 | Créances usagers, subventions à recevoir |
| 4 | 467 | Autres débiteurs/créditeurs (ex. remboursements de frais) |
| 4 | 4456/4457 | TVA déductible / collectée (module TVA) |
| 4 | 486, 487 | Charges / produits constatés d'avance (module) |
| 5 | 5121, 5122… | Comptes bancaires (un compte comptable par compte financier) |
| 5 | 530 | Caisse |
| 5 | 580 | Virements internes (si usage retenu) |
| 6 | 60 à 66 | Charges d'exploitation et financières |
| 6 | 6811 | Dotations aux amortissements (module) |
| 6 | 689 | Engagements à réaliser sur ressources affectées (module fonds dédiés) |
| 7 | 706, 74x, 7561 | Prestations, subventions, cotisations |
| 7 | 789 | Report de ressources non utilisées (module fonds dédiés) |
| 8 | 86x, 87x | Contributions volontaires en nature (hors périmètre initial) |

Règles : un compte utilisé ne se supprime pas, il se désactive ; un compte non classé dans un rubrique de rapport déclenche un contrôle visible.

## 3. Rubriques de rapport

Les affectations compte → rubrique sont centralisées et versionnées (`ReportTemplateVersion`). Un seul jeu de rubriques alimente écran, PDF et tableur.

- **Compte de résultat** : produits d'exploitation (cotisations, subventions, autres), charges d'exploitation (achats, services extérieurs, personnel, dotations), résultat financier, résultat exceptionnel, résultat de l'exercice.
- **Bilan** : actif (immobilisé, circulant, trésorerie, comptes de régularisation), passif (fonds propres, fonds dédiés, dettes, comptes de régularisation).
- Colonnes N et N−1 ; N−1 absent traité explicitement.

## 4. Mécanisme d'ajustement commun (ADR 0003)

Prévu dès le noyau comptable pour les modules du lot 6 :

1. Écriture d'ajustement datée à la clôture, journal OD, reliée à son événement source.
2. Contrepassation automatique à l'ouverture de l'exercice suivant, reliée à l'original.
3. Activation/désactivation par module sans toucher aux écritures validées.

## 5. Exercices

Dates paramétrables, premier exercice de durée libre, indépendants des campagnes de cotisation ([ADR 0002](../decisions/0002-modules-activables-et-regles-comptables.md)). Clôture : contrôles, rapprochements, ajustements, états, clôture technique, ouverture suivante avec report unique des comptes de bilan et affectation du résultat distincte de la clôture.

## 6. Points à faire valider

- Liste exacte des comptes et sous-comptes du jeu de départ.
- Usage du compte 580 pour les virements internes, ou compte de banque à banque direct.
- Rubriques exactes du bilan et du compte de résultat associatifs.
- Traitement du résultat (affectation en AG) : écriture automatique ou manuelle.
