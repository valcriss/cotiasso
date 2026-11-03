
-- CreateEnum
CREATE TYPE "WorkflowVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('RUNNING', 'RETURNED', 'COMPLETED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalOutcome" AS ENUM ('APPROVED', 'AUTO_APPROVED', 'REFUSED', 'RETURNED', 'PROCESSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinitionVersion" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "activatedAt" TIMESTAMPTZ(3),
    "activatedBy" UUID,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "WorkflowDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" UUID NOT NULL,
    "definitionVersionId" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "returnedFromNodeId" TEXT,
    "round" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "nodeId" TEXT,
    "outcome" "ApprovalOutcome" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "message" TEXT,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowReassignment" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "designation" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "WorkflowReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_subjectType_key" ON "WorkflowDefinition"("subjectType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinitionVersion_definitionId_number_key" ON "WorkflowDefinitionVersion"("definitionId", "number");

-- CreateIndex
CREATE INDEX "WorkflowInstance_subjectType_subjectId_idx" ON "WorkflowInstance"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_status_idx" ON "WorkflowInstance"("status");

-- CreateIndex
CREATE INDEX "ApprovalDecision_instanceId_idx" ON "ApprovalDecision"("instanceId");

-- CreateIndex
CREATE INDEX "WorkflowReassignment_instanceId_idx" ON "WorkflowReassignment"("instanceId");

-- AddForeignKey
ALTER TABLE "WorkflowDefinitionVersion" ADD CONSTRAINT "WorkflowDefinitionVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionVersionId_fkey" FOREIGN KEY ("definitionVersionId") REFERENCES "WorkflowDefinitionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowReassignment" ADD CONSTRAINT "WorkflowReassignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ADR 0035, tranche 1 : circuits de validation. Les garanties sont ici, pas dans l'application.

ALTER TABLE "WorkflowDefinitionVersion" ADD CONSTRAINT "WorkflowDefinitionVersion_document_object" CHECK (jsonb_typeof("document") = 'object');

-- Une seule version active et un seul brouillon par circuit.
CREATE UNIQUE INDEX "WorkflowDefinitionVersion_one_active" ON "WorkflowDefinitionVersion"("definitionId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "WorkflowDefinitionVersion_one_draft" ON "WorkflowDefinitionVersion"("definitionId") WHERE "status" = 'DRAFT';

-- Une demande en cours par objet : on ne soumet pas deux fois la même demande à un circuit.
CREATE UNIQUE INDEX "WorkflowInstance_one_open" ON "WorkflowInstance"("subjectType", "subjectId") WHERE "status" IN ('RUNNING', 'RETURNED');

-- Une seule décision effective par étape et par passe (cadrage §17.3 : clics concurrents).
CREATE UNIQUE INDEX "ApprovalDecision_one_per_step" ON "ApprovalDecision"("instanceId", "nodeId", "round") WHERE "nodeId" IS NOT NULL AND "outcome" <> 'CANCELLED';

-- Un circuit ne se supprime jamais.
CREATE FUNCTION workflow_definition_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un circuit de validation ne se supprime pas';
    END IF;
    IF NEW."subjectType" <> OLD."subjectType" THEN
        RAISE EXCEPTION 'Le type de demande d''un circuit ne change pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowDefinition_guard" BEFORE UPDATE OR DELETE ON "WorkflowDefinition"
    FOR EACH ROW EXECUTE FUNCTION workflow_definition_guard();
CREATE TRIGGER "WorkflowDefinition_no_truncate" BEFORE TRUNCATE ON "WorkflowDefinition"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Version de circuit : un brouillon se modifie et se supprime ; une version active ou retirée est figée
-- (elle ne fait que passer de ACTIVE à RETIRED).
CREATE FUNCTION workflow_version_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une version de circuit commence en brouillon';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une version de circuit active ou retirée ne se supprime pas : des demandes peuvent en dépendre';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."definitionId" <> OLD."definitionId" OR NEW."number" <> OLD."number" THEN
        RAISE EXCEPTION 'Le numéro et le circuit d''une version ne changent pas';
    END IF;
    IF OLD."status" = 'DRAFT' THEN
        IF NEW."status" = 'RETIRED' THEN
            RAISE EXCEPTION 'Un brouillon s''active ou se supprime, il ne se retire pas';
        END IF;
        IF NEW."status" = 'ACTIVE' AND NEW."activatedAt" IS NULL THEN
            RAISE EXCEPTION 'L''activation d''une version est datée';
        END IF;
        RETURN NEW;
    END IF;
    -- Active ou retirée : le contenu est figé.
    IF NEW."document" IS DISTINCT FROM OLD."document" THEN
        RAISE EXCEPTION 'Une version de circuit active ou retirée ne se modifie pas : préparez une nouvelle version';
    END IF;
    IF OLD."status" = 'ACTIVE' AND NEW."status" = 'RETIRED' THEN
        IF NEW."retiredAt" IS NULL THEN
            RAISE EXCEPTION 'Le retrait d''une version est daté';
        END IF;
        IF NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" OR NEW."activatedBy" IS DISTINCT FROM OLD."activatedBy" THEN
            RAISE EXCEPTION 'La date d''activation d''une version ne change pas';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."status" <> OLD."status" OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" OR NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
        RAISE EXCEPTION 'Cette version de circuit ne change plus d''état';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowDefinitionVersion_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WorkflowDefinitionVersion"
    FOR EACH ROW EXECUTE FUNCTION workflow_version_guard();
CREATE TRIGGER "WorkflowDefinitionVersion_no_truncate" BEFORE TRUNCATE ON "WorkflowDefinitionVersion"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Demande soumise à un circuit : jamais supprimée, rattachée pour toujours à sa version de circuit (CA-09),
-- état qui n'avance que dans les sens permis.
CREATE FUNCTION workflow_instance_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une demande soumise à un circuit ne se supprime pas';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'RUNNING' THEN
            RAISE EXCEPTION 'Une demande commence en cours de validation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "WorkflowDefinitionVersion" v WHERE v."id" = NEW."definitionVersionId" AND v."status" = 'ACTIVE') THEN
            RAISE EXCEPTION 'On ne soumet une demande qu''à la version active d''un circuit';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."definitionVersionId" <> OLD."definitionVersionId" OR NEW."subjectType" <> OLD."subjectType"
        OR NEW."subjectId" <> OLD."subjectId" OR NEW."requesterUserId" <> OLD."requesterUserId" THEN
        RAISE EXCEPTION 'Une demande garde sa version de circuit, son objet et son demandeur';
    END IF;
    IF OLD."status" IN ('COMPLETED', 'REFUSED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cette demande est terminée : elle ne change plus';
    END IF;
    IF OLD."status" = 'RETURNED' AND NEW."status" NOT IN ('RETURNED', 'RUNNING', 'CANCELLED') THEN
        RAISE EXCEPTION 'Une demande renvoyée pour correction reprend ou s''annule';
    END IF;
    IF NEW."round" < OLD."round" THEN
        RAISE EXCEPTION 'Le numéro de passe d''une demande ne diminue pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowInstance_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WorkflowInstance"
    FOR EACH ROW EXECUTE FUNCTION workflow_instance_guard();
CREATE TRIGGER "WorkflowInstance_no_truncate" BEFORE TRUNCATE ON "WorkflowInstance"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Décisions et réaffectations : ajout seul.
CREATE FUNCTION workflow_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'L''historique des décisions d''un circuit est en ajout seul : % refusé', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalDecision_append_only" BEFORE UPDATE OR DELETE ON "ApprovalDecision"
    FOR EACH ROW EXECUTE FUNCTION workflow_append_only();
CREATE TRIGGER "ApprovalDecision_no_truncate" BEFORE TRUNCATE ON "ApprovalDecision"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
CREATE TRIGGER "WorkflowReassignment_append_only" BEFORE UPDATE OR DELETE ON "WorkflowReassignment"
    FOR EACH ROW EXECUTE FUNCTION workflow_append_only();
CREATE TRIGGER "WorkflowReassignment_no_truncate" BEFORE TRUNCATE ON "WorkflowReassignment"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

ALTER TABLE "WorkflowReassignment" ADD CONSTRAINT "WorkflowReassignment_designation_shape" CHECK (
    jsonb_typeof("designation") = 'object' AND "designation"->>'kind' IN ('USER', 'ROLE', 'OFFICE') AND ("designation"->>'id') IS NOT NULL
);
