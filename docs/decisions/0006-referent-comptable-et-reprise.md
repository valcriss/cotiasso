# ADR 0006 — Référent comptable et périmètre de la reprise pilote

Statut : accepté — 31 octobre 2026 (réponses Q2 et Q10)

## Référent comptable (Q2)

Le **trésorier de l'association pilote** valide le plan de comptes, les modèles de rapports et le jeu de référence (cadrage §25.2).

Limite assumée : le trésorier n'est pas forcément comptable de métier. Conséquences :

- Les livrables du lot 0.2/0.3 sont rédigés pour être relus par un non-spécialiste (cas expliqués, écritures attendues commentées).
- Un avis externe (expert-comptable) est à prévoir avant d'activer les modules à risque : **TVA assujettie et mixte, fonds dédiés, amortissements** (ADR 0003). Tant que cet avis n'est pas obtenu, ces modules restent « indisponibles » pour toute installation autre que de test.
- L'application ne revendique aucune conformité (cadrage §1).

## Reprise historique du pilote (Q10)

| Sujet | Décision |
| --- | --- |
| Format des relevés | OFX uniquement ; aucun import CSV/PDF en V1 |
| Autres mouvements (caisse, hors banque) | Saisie manuelle |
| Volume | Petit, moins de 1 000 opérations |

Conséquences :

- Pas d'import CSV bancaire en V1 (hors cadrage actuel) ; à réévaluer si d'autres associations en ont besoin.
- Le volume ne justifie aucun dimensionnement de performance particulier pour la reprise ; l'import en masse (2b.6) reste utile pour l'abandon de lot et la reprise après erreur, pas pour la volumétrie.
- Les pièces manquantes de l'historique sont tracées par note (cadrage §18).
- L'inventaire 0.6 se réduit à : date de création, dates d'exercice, liste des comptes et caisses, disponibilité des fichiers OFX par compte et par période.
