# ADR 0020 — États de synthèse : compte de résultat et bilan

Statut : retenu (2 novembre 2026, lot 2c.1). Décisions prises en autonomie sur la base des priorités de la [feuille de route](../roadmap.md) ; **à faire relire par le trésorier du pilote** (rubriques et rattachements indicatifs, ADR 0006). Aucune conformité réglementaire n'est affirmée (cadrage §1).

## Décisions

1. **Une seule source de calcul** (CA-13) : les états lisent les lignes d'écritures **comptabilisées ou contrepassées** d'**un exercice** (jamais un brouillon), comme les états de lecture (grand livre, balance). Le nombre de brouillons de l'exercice est indiqué, non pris en compte.
2. **Catalogue de rubriques en code** (`statements.ts`), pas de script : chaque rubrique a un code, un libellé en langage courant et les préfixes de comptes qu'elle regroupe. Le rattachement **par défaut** se fait au numéro de compte (préfixe le plus long) ; les comptes de classe 6 et 7 sans préfixe connu tombent dans « autres charges » ou « autres produits ». Le champ `reportLine` d'un compte peut **imposer** un code de rubrique pour le compte de résultat ; il est ignoré s'il ne correspond à aucun code.
3. **Compte de résultat** : produits et charges **d'exploitation**, **financiers**, **exceptionnels**, report de ressources non utilisées et engagements (fonds dédiés, modules à venir), impôts ; résultats intermédiaires (exploitation, financier, exceptionnel) et **résultat de l'exercice** (excédent ou déficit).
4. **Bilan** : le solde net de chaque compte des classes 1 à 5 donne sa rubrique ; pour les comptes de **tiers (4) et de trésorerie (5)** le **sens du solde** décide (solde débiteur à l'actif, créditeur au passif : créance ou dette, disponibilités ou découvert) ; les comptes de régularisation (48) suivent la même règle. Le **résultat de l'exercice** (classes 6 et 7) figure aux fonds propres. Les amortissements (28, 29) viennent en déduction de l'actif immobilisé. Le total de l'actif doit égaler celui du passif : l'état affiche ce **contrôle d'équilibre**.
5. **Colonnes N et N−1** : N−1 est l'exercice **précédent** (le dernier qui se termine avant le début de N). **S'il n'existe pas, la colonne est explicitement absente** (jamais des zéros trompeurs).
6. **Contrôles de rubrique** : les comptes utilisés **sans rubrique choisie** sont listés (« classement par défaut selon le numéro ») ; les comptes **qu'aucune rubrique n'accueille** (classe 8, contributions volontaires hors périmètre) sont listés en **non classés** et rendent l'état explicitement incomplet. L'avertissement de clôture `UNCLASSIFIED_ACCOUNTS` reprend le premier cas.
7. **Droits** : `reports:view` (ces états sont des synthèses, ils ne détaillent pas les écritures) ; les états de lecture gardent `entries:view`.
8. **Présentation** : page **Rapports** (compte de résultat, bilan) avec choix d'exercice et phrase d'explication sous chaque rubrique ; montants au format français, jamais de flottant pour l'argent.

## Hors de cette tranche

État de trésorerie et exports PDF/CSV/tableur (lot 2c.2), annexe, FEC, rubriques versionnées par exercice (`ReportTemplateVersion`), comptes de classe 8.
