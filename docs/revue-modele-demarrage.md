# Fiche de relecture du modèle de démarrage (pour l'expert-comptable)

Statut : à relire (2 novembre 2026). Ce document accompagne le **modèle de démarrage proposé** de l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md) (`apps/api/src/guided/starter-template.ts`). Il est généré à la main à partir du code et **vérifié par un test** : chaque compte et chaque catégorie du code doit y figurer, sinon le test échoue.

**L'application n'affirme aucune conformité comptable.** Le modèle est une proposition de plan de comptes associatif simple, pour une association **sans salarié, sans TVA, sans immobilisation ni fonds dédiés** (ces fonctions sont des modules indisponibles tant qu'elles ne sont pas validées, ADR 0003 et 0006). Il n'est jamais appliqué sans action explicite, ne remplace pas un plan existant et n'écrase rien.

## Ce qu'on vous demande

Pour chaque ligne des tableaux : **valider**, **corriger le numéro ou le libellé**, ou **retirer**. Les questions ouvertes sont en fin de document. Merci de répondre par écrit dans ce fichier ou dans une copie.

## 1. Comptes installés

| Numéro | Libellé proposé | Avis (OK / à corriger / à retirer) | Remarque |
| --- | --- | --- | --- |
| 102 | Fonds associatifs sans droit de reprise | | |
| 110 | Report à nouveau | | |
| 120 | Résultat de l'exercice (excédent) | | |
| 129 | Résultat de l'exercice (déficit) | | |
| 401 | Fournisseurs (factures à payer) | | |
| 411 | Adhérents et usagers (sommes à recevoir) | | |
| 441 | Subventions à recevoir | | |
| 467 | Autres comptes débiteurs ou créditeurs | | |
| 512 | Banque | | |
| 530 | Caisse | | |
| 606 | Achats non stockés (fournitures, petit matériel) | | |
| 613 | Locations | | |
| 615 | Entretien et réparations | | |
| 616 | Primes d'assurance | | |
| 622 | Honoraires et intervenants extérieurs | | |
| 623 | Publicité et communication | | |
| 625 | Déplacements, missions et réceptions | | |
| 626 | Frais postaux et de télécommunications | | |
| 627 | Services bancaires | | |
| 658 | Charges diverses de gestion courante | | |
| 706 | Prestations de services | | |
| 707 | Ventes de marchandises | | |
| 740 | Subventions d'exploitation | | |
| 754 | Dons et libéralités | | |
| 756 | Cotisations | | |
| 758 | Produits divers de gestion courante | | |
| 768 | Autres produits financiers (intérêts) | | |

## 2. Catégories en langage courant

Une catégorie est le mot que voit le trésorier (« Assurance »). Elle désigne **un seul compte de charges (6…) pour l'argent dépensé, ou de produits (7…) pour l'argent reçu**. L'écriture générée est toujours : banque (ou caisse) d'un côté, ce compte de l'autre.

| Sens | Catégorie | Compte | Rôle particulier | Aide affichée | Avis |
| --- | --- | --- | --- | --- | --- |
| Argent dépensé | Fournitures et petit matériel | 606 — Achats non stockés (fournitures, petit matériel) |  | Papeterie, consommables, petit équipement. | |
| Argent dépensé | Location de salle ou de matériel | 613 — Locations |  | Salle prêtée contre loyer, matériel loué pour un évènement. | |
| Argent dépensé | Entretien et réparations | 615 — Entretien et réparations |  | Remise en état de matériel ou de locaux. | |
| Argent dépensé | Assurance | 616 — Primes d'assurance |  | Prime d'assurance de l'association. | |
| Argent dépensé | Intervenant ou prestataire extérieur | 622 — Honoraires et intervenants extérieurs |  | Facture d'une personne ou d'une société qui a travaillé pour vous. | |
| Argent dépensé | Communication et publicité | 623 — Publicité et communication |  | Affiches, impressions, site internet, publicité. | |
| Argent dépensé | Déplacements, repas et réceptions | 625 — Déplacements, missions et réceptions |  | Transport, hébergement, repas lors d'un évènement. | |
| Argent dépensé | Courrier et téléphone | 626 — Frais postaux et de télécommunications |  | Timbres, envois postaux, abonnements téléphone et internet. | |
| Argent dépensé | Frais bancaires | 627 — Services bancaires |  | Commissions et frais de tenue de compte. | |
| Argent dépensé | Autre dépense | 658 — Charges diverses de gestion courante |  | À utiliser si aucune autre catégorie ne convient. | |
| Argent reçu | Cotisations des adhérents | 756 — Cotisations | cotisations | Argent reçu pour une adhésion. L'affectation à un adhérent se fait ensuite dans « Membres ». | |
| Argent reçu | Dons | 754 — Dons et libéralités |  | Argent donné sans contrepartie. | |
| Argent reçu | Subvention | 740 — Subventions d'exploitation | subventions | Argent versé par une collectivité, un organisme ou une fondation. | |
| Argent reçu | Participation à une activité ou billetterie | 706 — Prestations de services |  | Entrées, inscriptions, stages, prestations payés par le public. | |
| Argent reçu | Vente (buvette, objets…) | 707 — Ventes de marchandises |  | Ventes de produits : buvette, vide-grenier, objets. | |
| Argent reçu | Intérêts bancaires | 768 — Autres produits financiers (intérêts) |  | Intérêts versés par la banque sur un livret. | |
| Argent reçu | Autre recette | 758 — Produits divers de gestion courante |  | À utiliser si aucune autre catégorie ne convient. | |

Le **rôle particulier** désigne la catégorie proposée d'office quand on rattache un règlement de cotisation (« cotisations ») ou un versement de subvention (« subventions ») à l'argent reçu : une seule catégorie par rôle.

## 2 bis. Lignes de la « situation d'ouverture » (ADR 0029)

Quand une association repart d'une situation de départ au lieu de reprendre son historique, le trésorier indique, en mots courants, ce qu'on lui doit (créances, au débit) et ce qu'elle doit (dettes, au crédit). Chaque phrase renvoie à un compte ci-dessus ; le reste (argent, fonds de l'association) est calculé et se confirme.

| Sens | Phrase proposée | Compte | Avis | Remarque |
| --- | --- | --- | --- | --- |
| On vous doit | Cotisation ou participation pas encore reçue | 411 | | |
| On vous doit | Subvention accordée, pas encore versée | 441 | | |
| On vous doit | Autre somme qu'on vous doit | 467 | | |
| Vous devez | Facture reçue, pas encore payée | 401 | | |
| Vous devez | Autre somme que vous devez | 467 | | |

## 3. Ce que le logiciel fait avec ces comptes (à vérifier)

- **Saisie guidée** (« J'ai reçu / J'ai dépensé de l'argent ») : une écriture à deux lignes, banque/caisse et catégorie ; le projet « Fonctionnement » est mis par défaut sur les lignes de charges et de produits ; l'écriture est comptabilisée immédiatement si la personne en a le droit, sinon laissée en brouillon.
- **Compte du résultat à la clôture** : excédent proposé sur **120**, déficit sur **129**, à défaut **110** (report à nouveau). L'écriture d'à-nouveaux reprend les soldes des classes 1 à 5 et le résultat des classes 6-7 ; l'affectation par l'assemblée générale reste une écriture à saisir à la main.
- **Comptes de banque et de caisse** : 512 (puis 5121, 5122… pour un second compte bancaire) et 530 (puis 5301…), un compte du plan par compte financier.
- **Virements entre comptes de l'association** : écriture de banque à banque, **sans** compte de virements internes (580) ; à valider (ADR 0017).
- **Cotisations** : produit constaté à l'**encaissement**, sans créance (ADR 0002 et 0004). Les comptes 411 et 441 ne servent **qu'à la situation d'ouverture** : aucune créance n'est constatée ailleurs.
- **Situation d'ouverture** : une **seule écriture** du journal des à-nouveaux, à la date de départ des comptes : banque et caisse (soldes de départ), sommes à recevoir (débit), sommes à payer (crédit), et le **fonds de l'association** (écart calculé) au compte de capitaux choisi (102 proposé, sinon 110), avec l'origine écrite par le trésorier. Aucun compte d'équilibrage automatique.

## 4. Questions ouvertes

1. Le plan est-il **adapté à une petite association** (recettes : cotisations, dons, subventions, billetterie, ventes, intérêts) ? Quels comptes manquent pour un cas courant (dons manuels 7541 ? mécénat ? contributions volontaires en nature classe 8 ?).
2. Les numéros **754 « Dons et libéralités »**, **756 « Cotisations »** et **740 « Subventions d'exploitation »** conviennent-ils, ou faut-il des sous-comptes (7541, 7561…) ?
3. Les comptes de **tiers** 411, 401, 441 et 467 sont maintenant installés **uniquement pour la situation d'ouverture** (sommes à recevoir et à payer au jour du départ). Conviennent-ils, ou faut-il d'autres comptes (4141, 4091, 448…) ? Pour le reste, **aucune créance** n'est constatée : le produit apparaît à l'encaissement.
4. Les **catégories de dépenses** couvrent-elles les postes habituels ? (Absents volontairement : salaires et charges sociales, impôts et taxes, amortissements, fonds dédiés — modules à valider.)
5. Les rubriques par défaut du **compte de résultat et du bilan** (`Account.reportLine`, catalogue en code, ADR 0020) sont-elles cohérentes avec ces numéros ?
6. Les intitulés sont-ils acceptables **face à un commissaire aux comptes ou à un financeur** ? Lesquels remplacer ?

## 5. Suites

Une fois relu : le modèle est corrigé dans `starter-template.ts` et ce document est mis à jour (le test le garde synchronisé), la mention « proposition à faire relire » reste affichée tant qu'aucune validation n'est consignée dans l'ADR 0028.
