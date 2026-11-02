# ADR 0022 — Portée projet des droits

Statut : retenu (2 novembre 2026, lot 2.1). Applique le cadrage §6 (« droits globaux et droits par projet ») et prolonge l'[ADR 0008](0008-autorisation-roles-et-permissions.md). Décisions prises en autonomie sur la base des priorités de la [feuille de route](../roadmap.md).

## Décisions

1. **Attribution à portée** : une attribution de rôle (`RoleAssignment`) peut porter un `projectId`. Sans `projectId`, elle est **globale** (comportement d'avant, inchangé). Le projet d'une attribution ne change jamais (déclencheur SQL) ; on révoque et on recrée.
2. **Droits applicables à un projet** : seules les permissions du catalogue marquées **à portée projet** (`PROJECT_SCOPABLE_PERMISSIONS`, aujourd'hui `projects:view` et `projects:update`) s'exercent sur un projet. Une attribution à portée projet **n'accorde que l'intersection** entre les droits du rôle et cette liste : tout autre droit du rôle est **ignoré**, il ne fuit jamais en droit global. Un rôle sans aucun droit applicable à un projet ne peut pas être attribué à portée projet (message explicatif).
3. **Résolution** : `permissionsFor` (droits globaux, base de `@RequirePermission`) **n'inclut plus que les attributions globales**. Les accès par projet se lisent à part (`projectAccessFor`) : pour chaque permission, l'ensemble des projets accessibles. Un droit global vaut pour tous les projets.
4. **Contrôle côté serveur** : nouveau décorateur `@RequireProjectAccess('projects:view')` : la route est ouverte à qui a le droit **globalement** ou **sur au moins un projet** ; le garde pose sur la requête la portée (`all` ou liste de projets) et **le service filtre**. Un projet hors portée est **introuvable (404)**, pas « interdit » : on ne révèle pas son existence. La liste ne renvoie que les projets accessibles. **Créer** un projet reste un droit global (`projects:update` global).
5. **Garde-fous** : les attributions à portée projet **ne comptent pas** pour la règle du dernier administrateur (`users:admin` n'est pas applicable à un projet) ; une attribution révoquée, expirée ou d'un compte désactivé n'accorde rien ; un projet archivé garde ses attributions (lecture seule de fait).
6. **Interface** : `/auth/me` renvoie en plus `projectPermissions` (permission → projets). Le menu « Projets » apparaît pour qui a le droit globalement ou sur un projet ; les boutons de modification d'un projet suivent le droit **sur ce projet**. Attribution d'un rôle : choix « toute l'association » ou « un projet ». **Écran « Accès effectifs »** (API existante, étendue aux portées) : pour chaque droit, le rôle qui l'accorde et sur quels projets.
7. **Audit** : `role.assigned` indique le projet ; la révocation reste `role.revoked`.

## Hors de cette tranche

Droits documentaires par projet et héritage vers les documents (**faits** avec la tranche 4.5 du lot 4, [ADR 0024](0024-projets-budgets-et-financements.md)), droits par projet sur les écritures et transactions (la ventilation analytique reste lisible par les droits comptables globaux), délégation et suppléance (workflows, lot 5).
