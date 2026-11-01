# ADR 0008 — Autorisation : rôles, permissions et refus par défaut

Statut : accepté — 1er novembre 2026. Met en œuvre la [matrice des droits v0.2](../lot0/04-matrice-droits.md) (lot 1.3, première tranche).

## Décisions

| Sujet | Décision |
| --- | --- |
| Modèle | Permissions `ressource:action` définies dans un catalogue versionné avec le code (`apps/api/src/authz/permissions.ts`). Un rôle est un ensemble de permissions stocké en base, modifiable ; le code ne teste jamais un nom de rôle. |
| Attribution | `RoleAssignment` datée (début, fin, révocation), jamais supprimée (déclencheur SQL) : l'historique des droits est conservé. Les droits d'un utilisateur sont l'union de ses attributions actives ; un compte désactivé n'a aucun droit. |
| Refus par défaut | Deux gardes globales. `AuthGuard` exige une session et le jeton CSRF. `PermissionsGuard` refuse toute route qui ne déclare pas explicitement `@Public()`, `@Authenticated()` ou `@RequirePermission(...)`. Un test parcourt tous les contrôleurs et échoue si une route n'est pas déclarée. |
| Rôles par défaut | Installés au démarrage s'ils manquent, sans jamais écraser un rôle modifié : administrateur technique, président, trésorier, membre du bureau, responsable de projet, contributeur, lecteur. L'export complet des données n'est attribué à aucun rôle. |
| Premier compte | L'assistant initial attribue le rôle « Administrateur technique » au premier compte, dans la même transaction. |
| Dernier administrateur | Au moins un compte actif doit détenir `users:admin`. Révoquer une attribution ou modifier un rôle qui retirerait ce droit est refusé (409). Les opérations sont sérialisées par un verrou consultatif PostgreSQL, y compris en concurrence. |
| Accès effectifs | `GET /users/:id/access` liste chaque permission avec le rôle qui l'accorde. |
| Interface | `/auth/me`, `/auth/login` et `/setup` renvoient les permissions. Le menu et les routes web sont filtrés ; le serveur reste la seule autorité. |

## Hors de cette tranche

- **Portée projet** : l'héritage global vers projet, puis projet vers dossiers et documents, arrive avec l'entité Project (lot 2a.4) et les documents (1.6). Les attributions sont globales pour l'instant ; la colonne de portée sera ajoutée par migration.
- **Restrictions documentaires** et `documents.restricted:view` : appliquées avec les documents.
- **Mandats et fonctions** liés aux rôles (cadrage §5) : avec le module Membres.
- **Quatre yeux** : paramètre d'association, avec les paramètres versionnés.
- **Écran web de gestion** des rôles et des attributions, et création d'utilisateurs par un administrateur : à venir.
- **Désactivation d'un compte** : devra appeler `lockLockout` et `assertAdministratorRemains` de `RolesService`.

## Conséquences

- Toute nouvelle route doit déclarer son accès ; l'oubli est détecté en test et refusé en production.
- Les tests qui exigent un état précis des administrateurs tournent sur une base jetable.
