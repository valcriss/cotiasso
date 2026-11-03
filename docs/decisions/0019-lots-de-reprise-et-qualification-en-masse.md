# ADR 0019 — Lots de reprise, soldes d'ouverture et qualification en masse

Statut : retenu (2 novembre 2026, lot 2b.6). Applique le cadrage §20 (reprise depuis la création) et l'[ADR 0006](0006-referent-comptable-et-reprise.md) : OFX seul pour la banque, saisie manuelle pour le reste, moins de 1 000 opérations. Le tableau de progression par exercice, compte et anomalie est fait dans l'[ADR 0027](0027-tableau-de-progression-de-la-reprise.md).

## Décisions

1. **Lot de reprise** (`RecoveryBatch`) : un lot **nommé** qui regroupe des **brouillons d'écriture créés en masse** (table `RecoveryBatchItem`, une ligne par écriture, une écriture appartient à un seul lot). États : **en préparation** (`OPEN`), **terminé** (`COMPLETED`, plus aucun brouillon et au moins une écriture comptabilisée), **abandonné** (`ABANDONED`). Un lot terminé ou abandonné ne reçoit plus rien et **ne se supprime jamais** (historique). L'import OFX garde son propre cycle (analyse puis confirmation ou annulation, ADR 0015) ; le lot, lui, prépare les écritures.
2. **Préparer les écritures d'un compte** : pour un compte financier et une période, le lot crée **un brouillon par transaction** *qualifiée* (compte de contrepartie choisi), non encore liée à une écriture, qui n'est pas un côté de virement (le virement a son propre brouillon, ADR 0017), datée dans un exercice **ouvert**. Chaque brouillon est lié à sa transaction (ADR 0017). Les transactions ignorées sont **listées avec leur raison** (compte rendu) : relancer la préparation ne crée **jamais de doublon**.
3. **Solde d'ouverture guidé** : pour un compte financier dont le solde d'ouverture n'est pas nul, le lot prépare un brouillon **banque / compte de capitaux** (débit du compte de trésorerie et crédit du compte choisi si le solde est positif, l'inverse s'il est négatif), daté de l'ouverture du compte, dans le journal d'à-nouveaux. Le compte de contrepartie est **choisi par le trésorier parmi les comptes de classe 1** (fonds associatifs, report à nouveau, réserves…) et l'**origine doit être expliquée** (texte obligatoire, repris dans le libellé de l'écriture). **Aucun compte d'équilibrage automatique** : une information manquante reste visible. Une seule écriture d'ouverture par compte financier (index unique) ; la corriger = abandonner le brouillon, ou contrepasser puis saisir à la main.
4. **Comptabiliser le lot** : les brouillons sont comptabilisés **dans l'ordre chronologique**, **chacun dans sa propre transaction SQL**. Un **compte rendu** dit combien sont passés et, pour chaque refus, pourquoi (exercice fermé, projet obligatoire, ligne de banque qui ne correspond plus…). Les refusés **restent en brouillon dans le lot** : on les corrige puis on relance (reprise après erreur). Le lot passe à « terminé » quand il n'a plus de brouillon.
5. **Abandonner le lot** : supprime **seulement ses brouillons** (leurs liaisons sont libérées, ADR 0017) ; **les écritures déjà comptabilisées restent intactes**, il n'y a **aucun effacement en cascade**. Le lot passe à « abandonné » et indique combien d'écritures comptabilisées sont conservées.
6. **Qualifier la sélection** : on coche des transactions d'un compte (200 au plus) et on leur applique **un compte de contrepartie et/ou un projet** d'un seul geste, **tout ou rien**. Pas de règle automatique par mots du libellé (risque de mauvais classement silencieux) : le trésorier voit ce qu'il applique. **Amendé le 3 novembre 2026 : voir « Amendement — suggestions de classement ».**
7. **Droits** : consulter les lots `entries:view` ; créer, préparer, abandonner `entries:create` **et** `transactions:manage` ; comptabiliser `entries:post` ; qualifier en masse `transactions:manage`.
8. **Interaction avec le rapprochement** (ADR 0018) : l'écriture d'ouverture ne compte pas parmi les « écritures de banque sans transaction » (le solde d'ouverture est déjà le solde de départ du premier rapprochement).
9. **Audit** : `recovery.batch.created`, `recovery.entries.prepared`, `recovery.opening.prepared`, `recovery.batch.posted`, `recovery.batch.abandoned`, `transactions.qualified`.

## Hors de cette tranche

Import CSV d'écritures, règles automatiques de qualification, mode « situation d'ouverture » sans historique, tableau de progression par exercice, compte et anomalie (lot 5.4), reprise des membres, cotisations et subventions (lot 3 et suivants).

## Amendement — suggestions de classement (3 novembre 2026)

Décision de l'utilisateur, à l'issue de l'audit « trésorier débutant » ([ticket #7](https://github.com/valcriss/cotiasso/issues/7)) : classer des dizaines de mouvements importés un par un est le principal coût du quotidien. **On suggère, on n'applique jamais seul.**

**Ce qui change.** Le point 6 interdisait toute « règle automatique par mots du libellé » à cause du risque de mauvais classement silencieux. Ce risque vient de l'**application automatique**, pas de l'aide à la décision. L'interdiction vise désormais l'application sans geste de la personne ; une **suggestion** est autorisée à ces conditions :

1. **Source** : le classement que la personne a elle-même choisi pour un mouvement **du même sens et du même compte financier** dont le libellé normalisé (casse, accents, chiffres, dates et références retirés) est identique. Aucune règle saisie, aucune liste de mots-clés, aucun apprentissage statistique.
2. **Aucune ambiguïté** : si plusieurs classements différents existent pour ce libellé, ou si aucun, **pas de suggestion**. On ne devine jamais.
3. **Jamais appliquée seule** : une suggestion est un affichage (« comme le 12/09 pour *MAIF PRELEVEMENT* ») ; le classement n'est écrit que par un geste explicite (« Accepter » ligne par ligne, ou « Accepter les propositions » sur la sélection), via la qualification existante (200 au plus, **tout ou rien**, audit `transactions.qualified`).
4. **Lecture seule et calculée à la demande** : rien n'est stocké, pas d'audit à l'affichage ; la suggestion disparaît dès que le mouvement est classé.
5. **Droits et portée** : visible pour qui lit les mouvements du compte ; la suggestion ne révèle que la catégorie/le compte de contrepartie et le projet, jamais le libellé d'un mouvement d'un autre compte.
6. **Dit clairement** : l'écran précise que la proposition se base sur les choix précédents et qu'il faut la vérifier.

## Décision connexe — import CSV (3 novembre 2026)

L'**import CSV de relevés n'est pas pris en charge pour le moment** (ticket #6 fermé « non planifié »). L'[ADR 0015](0015-import-ofx.md) reste la seule voie d'import bancaire (OFX) ; sans export OFX, la saisie manuelle (« J'ai reçu / dépensé de l'argent ») reste le recours, et l'écran d'import le dit. Pas de traitement partiel : un fichier CSV est refusé avec un message qui explique quoi faire. À rouvrir si des associations pilotes en ont besoin ; il faudrait alors un ADR (clé d'idempotence déterministe, doublons jamais silencieux).

