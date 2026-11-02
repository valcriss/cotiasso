-- Les attributions expirées ou futures cohabitent légitimement avec une attribution en cours : l'unicité d'une attribution
-- active (non révoquée, non expirée) est contrôlée par le service, pas par un index.
DROP INDEX "RoleAssignment_one_active_global";
DROP INDEX "RoleAssignment_one_active_project";
