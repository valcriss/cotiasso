-- Liaison fiche de membre <-> compte de connexion : droit dédié et rattrapage des fiches déjà saisies.

-- Rattrapage : une fiche de membre actuel et un compte qui portent la même adresse email (majuscules ignorées) sont reliés,
-- quand ni l'un ni l'autre n'est déjà relié. Ce rattrapage ne s'inscrit pas dans le journal d'audit (il vient de la migration).
UPDATE "Member" AS m
SET "userId" = u."id", "version" = m."version" + 1
FROM "User" AS u
WHERE m."userId" IS NULL
  AND m."status" = 'ACTIVE'
  AND m."anonymizedAt" IS NULL
  AND m."email" IS NOT NULL
  AND lower(m."email") = lower(u."email")
  AND NOT EXISTS (SELECT 1 FROM "Member" AS other WHERE other."userId" = u."id");

-- Nouveau droit : donné au rôle d'administration technique des installations existantes (modifiable ensuite comme tout rôle).
UPDATE "Role" SET "permissions" = array_append("permissions", 'members.account:link')
WHERE "key" = 'technical-admin' AND NOT ('members.account:link' = ANY("permissions"));
