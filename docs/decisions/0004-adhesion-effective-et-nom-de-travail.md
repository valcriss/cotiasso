# ADR 0004 — Adhésion effective et nom de travail

Statut : accepté — 31 octobre 2026 (réponses Q6b et Q7)

## Adhésion effective (Q6b)

Le déclencheur de l'adhésion effective est un **paramètre de l'association**, avec trois modes disponibles :

| Mode | Comportement |
| --- | --- |
| À l'encaissement | Effective quand les règlements affectés couvrent la cotisation due |
| À la validation par le bureau | Effective quand un utilisateur autorisé valide (via workflow si activé) |
| À une date de début | Effective à la date d'effet saisie ou déduite de la campagne |

Règles communes :

- La fin de l'adhésion reste la fin de campagne ; une adhésion tardive ne déplace pas la date de fin (cadrage §13.2).
- Le mode est historisé et applicable aux campagnes futures ; il ne change pas les adhésions déjà émises.
- L'état « effective » est indépendant de la comptabilisation (produit constaté à l'encaissement, ADR 0002).
- La date d'effet et son origine (règlement, validation, date) sont conservées sur l'adhésion.

## Nom de travail (Q7)

Le nom de travail est **« cotiasso »** (code, paquets, dépôt). Il est provisoire : il sera remplacé avant la première publication, et le nom d'affichage reste de toute façon configurable par association (marque blanche).

Titulaire du copyright : **à préciser** avant la première publication. Le fichier LICENSE (MIT) ne sera pas rédigé avec un titulaire inventé. Nommage interne neutre pour faciliter un renommage (préfixe de paquets centralisé dans une seule configuration).
