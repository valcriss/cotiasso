-- AlterTable
ALTER TABLE "RoleAssignment" ADD COLUMN     "projectId" UUID;

-- CreateIndex
CREATE INDEX "RoleAssignment_projectId_idx" ON "RoleAssignment"("projectId");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0022 : portée projet des attributions de rôle. L'utilisateur, le rôle et le projet d'une attribution ne changent
-- jamais : on la révoque et on en crée une autre (l'historique des droits fait partie de la piste d'audit).
CREATE FUNCTION role_assignment_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW."userId" <> OLD."userId" OR NEW."roleId" <> OLD."roleId" OR NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
        RAISE EXCEPTION 'L''utilisateur, le rôle et le projet d''une attribution ne changent pas : révoquez-la et créez-en une autre';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RoleAssignment_immutable"
    BEFORE UPDATE ON "RoleAssignment"
    FOR EACH ROW EXECUTE FUNCTION role_assignment_immutable();

-- Une seule attribution active d'un même rôle, pour un même utilisateur et une même portée (globale ou un projet donné).
CREATE UNIQUE INDEX "RoleAssignment_one_active_global" ON "RoleAssignment"("userId", "roleId")
    WHERE "revokedAt" IS NULL AND "projectId" IS NULL;
CREATE UNIQUE INDEX "RoleAssignment_one_active_project" ON "RoleAssignment"("userId", "roleId", "projectId")
    WHERE "revokedAt" IS NULL AND "projectId" IS NOT NULL;
