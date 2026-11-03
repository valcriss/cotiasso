# ADR 0032 — Corriger un montant par un mouvement de régularisation

Statut : retenu (3 novembre 2026), décision déléguée à l'assistant par l'utilisateur (ticket #42, « prends les décisions qui te semblent les plus logiques »). **À faire relire par le trésorier du pilote et l'expert-comptable.**

## Contexte

Une erreur de montant sur une opération déjà enregistrée n'avait aucune issue complète : `transaction_guard` (ADR 0017) fige montant et date d'un mouvement dès qu'il a été relié à une écriture, même après contrepassation ; un mouvement relié ne se supprime plus ; « Annuler l'opération » laissait le mouvement au mauvais montant dans le solde « d'après vos enregistrements » ; « Corriger… » (#17) ne change que catégorie, projet et description. C'est pourtant l'erreur la plus fréquente d'un trésorier débutant.

## Options étudiées

1. **Mouvement de régularisation** de l'écart (aucune règle SQL relâchée).
2. Retirer un mouvement manuel dont l'écriture est contrepassée (nouvel état « annulé » à exclure des soldes, de la liste, du rapprochement).
3. Relâcher `transaction_guard` pour un mouvement manuel non identifié par la banque.

## Décision : option 1

- **« Corriger le montant… »** ajoute un mouvement de l'écart, dans le **même compte financier, la même catégorie (compte de contrepartie) et le même projet**, libellé « Correction : <libellé d'origine> », enregistré aussitôt (comptabilisé si la personne a `entries:post`, sinon brouillon). L'original n'est ni modifié, ni contrepassé : le net des deux opérations donne le bon montant.
- La personne indique **le montant juste** (positif) et la date de la correction ; le logiciel calcule l'écart et son sens, et **l'annonce avant d'agir** (« Une correction de 9,00 € "argent reçu" sera ajoutée »).
- Pourquoi pas les options 2 et 3 : elles touchent une garantie posée en base et le calcul des soldes, à valider avec un expert-comptable ; l'option 1 n'ajoute aucune règle comptable (elle compose `bookRow`, la saisie guidée et les déclencheurs existants). Elle fonctionne aussi pour un mouvement **importé** (identifiant bancaire), pour lequel les autres options étaient exclues.
- **Refus** (messages à trois temps) : mouvement non enregistré (le classer directement), opération en brouillon (modifier le brouillon), membre d'un virement (annuler le virement), sans catégorie, compte archivé, montant identique, date hors de tout exercice ou dans un exercice fermé.
- **Tout ou rien** : si l'enregistrement de la correction est refusé, le mouvement de correction créé juste avant (non relié, donc supprimable) est retiré.
- Une opération déjà vérifiée avec la banque peut être corrigée : la correction est un **nouveau** mouvement, à pointer lors du prochain rapprochement.
- **La date ne se corrige pas** : une erreur de date n'a pas la même nature (période concernée). Elle reste à traiter en annulant l'opération (contrepassation) puis en la saisissant à nouveau si le mouvement est manuel ; pour un mouvement importé, la date est celle de la banque. À reprendre si le besoin se confirme.

## Mise en œuvre

`POST /transactions/:id/adjust-amount` (`transactions:manage` + `entries:create`), `OperationsService.adjustAmount`. Audit `operation.amount-adjusted` (sans montant). Web : « Corriger le montant… » dans le menu de l'opération (`treasury/adjust-amount-dialog.ts`). Tests : `guided.test.ts` (API) et `accounts.page.spec.ts` (web).
