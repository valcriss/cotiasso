# 0.4 — Matrice des droits (brouillon v0.1)

Base : cadrage §5 et §6. Les profils sont des **modèles modifiables**, pas des privilèges codés en dur. Refus par défaut.

## 1. Modèle

- Permission = `ressource:action`. Actions : `view`, `create`, `update`, `submit`, `approve`, `post` (comptabiliser), `close`, `export`, `admin`.
- Attribution = rôle × portée (**globale** ou **projet**). Une permission globale s'applique à tous les projets ; une permission projet seulement à ce projet et à ses documents.
- Résolution (cadrage §6.2) : interdictions impératives → permission → restrictions documentaires → règles d'action → refus.

## 2. Matrice par défaut

G = globale. P = portée projet. D = selon délégation. ? = à décider. – = aucune.

| Ressource : action | Président | Trésorier | Bureau | Resp. projet | Contributeur | Lecteur | Admin tech. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Paramètres association : view | G | G | G | – | – | – | G |
| Paramètres association : admin (identité, apparence, accès) | – | – | – | – | – | – | G |
| Paramètres comptables : admin (exercices, plan, TVA, modules) | – | G | – | – | – | – | – |
| Utilisateurs et rôles : view | G | G | – | – | – | – | G |
| Utilisateurs et rôles : admin | – | – | – | – | – | – | G |
| Membres : view | G | G | G | – | – | – | – |
| Membres, cotisations : create/update | – | G | – | – | – | – | – |
| Comptes financiers, transactions : view | G | G | G | P | – | – | – |
| Synthèses de projet : view | G | G | G | P | P | P | – |
| Transactions : create/update | – | G | – | – | – | – | – |
| Import OFX, rapprochement : post | – | G | – | – | – | – | – |
| Écritures : view | G | G | G | P | – | – | – |
| Écritures : create (brouillon) | – | G | – | – | – | – | – |
| Écritures : post | – | G | – | – | – | – | – |
| Exercices : close | – | G | – | – | – | – | – |
| Projets : view | G | G | G | P | P | P | – |
| Projets : update | – | G | – | P | – | – | – |
| Budgets : update | – | G | – | P | – | – | – |
| Budgets : approve | G (si rôle bureau) | – | G | – | – | – | – |
| Subventions : view | G | G | G | P | – | – | – |
| Subventions : create/update | – | G | – | D | – | – | – |
| Demandes de dépense : submit | – | G | G | P | P | – | – |
| Demandes de dépense : approve | selon workflow | selon workflow | selon workflow | D | – | – | – |
| Documents : view | G | G | G | P | P | P | – |
| Documents : create | – | G | G | P | P | – | – |
| Documents restreints : view | G | G | – | – | – | – | – |
| Workflows : admin | G | G | – | – | – | – | – |
| Rapports : view | G | G | G | P | – | – | – |
| Exports de rapports : export | – | G | – | – | – | – | – |
| Export complet des données : export | – | – | – | – | – | – | – (permission dédiée, non attribuée par défaut, auditée) |
| Sauvegarde, restauration : admin | – | – | – | – | – | – | G |
| Audit : view | G | G | – | – | – | – | G |

Cas où le **président** reçoit, via un rôle distinct, des droits comptables : possible mais jamais par défaut (cadrage §5.2).

## 3. Règles transverses

- L'**administrateur technique** gère l'installation et les accès, sans droit métier par défaut. Il peut s'attribuer un rôle métier, ce qui est audité.
- Pas d'**auto-approbation** : un demandeur ne peut pas approuver sa propre demande, sauf règle explicite du workflow.
- Un utilisateur désactivé, un exercice clos ou un état métier incompatible bloquent l'action quel que soit le rôle.
- **Documents** : les restrictions du document priment sur la lecture générale d'un projet. La permission `documents-restreints:view` est distincte et configurable.
- Un **lien** entre objets n'ouvre pas l'accès : accéder à une écriture n'implique pas d'accéder à ses justificatifs.
- Les **agrégats** (rapports, totaux, tableaux de bord) respectent la portée : un lecteur de projet ne voit que les totaux de ses projets.
- Recherche, aperçus, téléchargements et exports passent par la même résolution que les écrans.
- **Mandats** : un rôle peut être lié à une fonction ; la fin du mandat retire le rôle lié sans supprimer l'historique.
- Écran « Accès effectifs » : pour un utilisateur donné, liste des permissions et de leur origine (rôle, portée, mandat).

## 4. Décisions prises (31 octobre 2026)

1. **Lecteur** : synthèses et documents autorisés seulement ; le détail des transactions et écritures exige une permission distincte, non incluse par défaut.
2. **Budgets** : approuvés par le bureau (permission configurable).
3. **Workflows** : administrés par le président et le trésorier.
4. **Paramètres comptables** (exercices, plan, TVA, modules) : administrés par le trésorier, via une permission distincte de l'administration générale (identité, apparence, accès : administrateur technique).
5. **Documents restreints** : président et trésorier par défaut.
6. **Audit** : consultable par le président, le trésorier et l'administrateur technique, en lecture seule.
7. **Séparation des tâches** : un même utilisateur peut créer et comptabiliser une écriture par défaut ; l'association peut activer le mode « quatre yeux ».
8. **Exports** : les exports de rapports par le trésorier ; l'export complet des données est une permission dédiée, non attribuée par défaut et auditée.

## 5. Reste à décider

- Suppléances : durée maximale et audit des délégations (à traiter avec les workflows, lot 5).
- Validation de la matrice complète par le trésorier du pilote.
