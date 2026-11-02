-- CreateEnum
CREATE TYPE "FunderType" AS ENUM ('LOCAL_AUTHORITY', 'STATE', 'FOUNDATION', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'GRANTED', 'REFUSED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GrantResidual" AS ENUM ('REFUND', 'KEPT_WITH_AGREEMENT', 'NONE');

-- CreateTable
CREATE TABLE "Funder" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FunderType" NOT NULL,
    "contactName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" UUID NOT NULL,
    "funderId" UUID NOT NULL,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "grantedAmount" DECIMAL(14,2),
    "requestedOn" DATE,
    "decidedOn" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,
    "conditions" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "GrantStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "closedOn" DATE,
    "residual" "GrantResidual",
    "residualNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantProjectAllocation" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "GrantProjectAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Grant_funderId_idx" ON "Grant"("funderId");

-- CreateIndex
CREATE INDEX "Grant_status_idx" ON "Grant"("status");

-- CreateIndex
CREATE INDEX "GrantProjectAllocation_projectId_idx" ON "GrantProjectAllocation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GrantProjectAllocation_grantId_projectId_key" ON "GrantProjectAllocation"("grantId", "projectId");

-- AddForeignKey
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantProjectAllocation" ADD CONSTRAINT "GrantProjectAllocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantProjectAllocation" ADD CONSTRAINT "GrantProjectAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financeur : nom renseigné et unique (sans tenir compte de la casse) ; jamais supprimé ; archivé, il ne se réactive pas.
ALTER TABLE "Funder" ADD CONSTRAINT "Funder_name_not_blank" CHECK (btrim("name") <> '');
CREATE UNIQUE INDEX "Funder_name_unique" ON "Funder" (lower(btrim("name")));

CREATE FUNCTION funder_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un financeur ne se supprime pas : on l''archive';
    END IF;
    IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NULL THEN
        RAISE EXCEPTION 'Un financeur archivé ne se réactive pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Funder_guard" BEFORE UPDATE OR DELETE ON "Funder"
    FOR EACH ROW EXECUTE FUNCTION funder_guard();
CREATE TRIGGER "Funder_no_truncate" BEFORE TRUNCATE ON "Funder"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Subvention : montants positifs, titre renseigné, dates cohérentes, une référence par financeur, et un état qui n'existe
-- qu'avec ses pièces (décision, motif, clôture et sort du reliquat).
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_title_not_blank" CHECK (btrim("title") <> '');
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_requested_positive" CHECK ("requestedAmount" > 0);
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_granted_positive" CHECK ("grantedAmount" IS NULL OR "grantedAmount" > 0);
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_period_order" CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodStart" <= "periodEnd");
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_decision_after_request" CHECK ("requestedOn" IS NULL OR "decidedOn" IS NULL OR "requestedOn" <= "decidedOn");
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_close_after_decision" CHECK ("closedOn" IS NULL OR "decidedOn" IS NULL OR "decidedOn" <= "closedOn");
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_reference_not_blank" CHECK ("reference" IS NULL OR btrim("reference") <> '');
CREATE UNIQUE INDEX "Grant_funder_reference_unique" ON "Grant" ("funderId", lower(btrim("reference"))) WHERE "reference" IS NOT NULL;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_state_consistent" CHECK (
    ("status" IN ('REQUESTED', 'UNDER_REVIEW') AND "grantedAmount" IS NULL AND "decidedOn" IS NULL AND "reason" IS NULL
        AND "closedOn" IS NULL AND "residual" IS NULL)
    OR ("status" = 'GRANTED' AND "grantedAmount" IS NOT NULL AND "decidedOn" IS NOT NULL AND "reason" IS NULL
        AND "closedOn" IS NULL AND "residual" IS NULL)
    OR ("status" = 'REFUSED' AND "grantedAmount" IS NULL AND "decidedOn" IS NOT NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
        AND "closedOn" IS NULL AND "residual" IS NULL)
    OR ("status" = 'CLOSED' AND "grantedAmount" IS NOT NULL AND "decidedOn" IS NOT NULL AND "reason" IS NULL
        AND "closedOn" IS NOT NULL AND "residual" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "grantedAmount" IS NULL AND "decidedOn" IS NULL AND "reason" IS NOT NULL AND btrim("reason") <> ''
        AND "closedOn" IS NULL AND "residual" IS NULL)
);
ALTER TABLE "GrantProjectAllocation" ADD CONSTRAINT "GrantProjectAllocation_amount_positive" CHECK ("amount" > 0);

-- Une subvention ne se supprime pas ; son état n'avance que dans un sens ; à l'accord la somme des parts par projet égale le
-- montant accordé ; une fois accordée, ses montants, ses dates et son financeur ne changent plus (un avenant n'est pas encore
-- pris en charge : il sera explicitement indisponible, jamais accepté à moitié) ; une fois refusée, clôturée ou annulée, seule
-- la note change.
CREATE FUNCTION grant_guard() RETURNS trigger AS $$
DECLARE
    funder_archived timestamptz;
    allocated numeric;
    allocation_count integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une subvention ne se supprime pas : on l''annule avec un motif';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'REQUESTED' THEN
            RAISE EXCEPTION 'Une subvention commence toujours à l''état demandé';
        END IF;
        SELECT "archivedAt" INTO funder_archived FROM "Funder" WHERE "id" = NEW."funderId";
        IF funder_archived IS NOT NULL THEN
            RAISE EXCEPTION 'Ce financeur est archivé : il ne reçoit plus de nouvelle demande';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD."status" IN ('REFUSED', 'CLOSED', 'CANCELLED') THEN
        IF (to_jsonb(NEW) - 'note') IS DISTINCT FROM (to_jsonb(OLD) - 'note') THEN
            RAISE EXCEPTION 'Une subvention refusée, clôturée ou annulée ne change plus (seule la note peut être complétée)';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (
        (OLD."status" = 'REQUESTED' AND NEW."status" IN ('UNDER_REVIEW', 'GRANTED', 'REFUSED', 'CANCELLED'))
        OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('GRANTED', 'REFUSED', 'CANCELLED'))
        OR (OLD."status" = 'GRANTED' AND NEW."status" = 'CLOSED')
    ) THEN
        RAISE EXCEPTION 'Cette subvention ne peut pas passer de l''état % à l''état %', OLD."status", NEW."status";
    END IF;

    IF NEW."funderId" <> OLD."funderId" AND OLD."status" IN ('REQUESTED', 'UNDER_REVIEW') THEN
        SELECT "archivedAt" INTO funder_archived FROM "Funder" WHERE "id" = NEW."funderId";
        IF funder_archived IS NOT NULL THEN
            RAISE EXCEPTION 'Ce financeur est archivé : il ne reçoit plus de nouvelle demande';
        END IF;
    END IF;

    IF OLD."status" = 'GRANTED' AND (NEW."funderId" <> OLD."funderId" OR NEW."requestedAmount" <> OLD."requestedAmount"
        OR NEW."grantedAmount" <> OLD."grantedAmount" OR NEW."decidedOn" <> OLD."decidedOn"
        OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart" OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd") THEN
        RAISE EXCEPTION 'Une subvention accordée ne change plus de montant, de dates ni de financeur (les avenants ne sont pas encore pris en charge)';
    END IF;

    IF NEW."status" = 'GRANTED' AND OLD."status" <> 'GRANTED' THEN
        SELECT COALESCE(SUM("amount"), 0), COUNT(*) INTO allocated, allocation_count FROM "GrantProjectAllocation" WHERE "grantId" = NEW."id";
        IF allocation_count = 0 THEN
            RAISE EXCEPTION 'Indiquez au moins un projet financé avant d''enregistrer l''accord';
        END IF;
        IF allocated <> NEW."grantedAmount" THEN
            RAISE EXCEPTION 'La somme des parts par projet doit être égale au montant accordé';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Grant_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Grant"
    FOR EACH ROW EXECUTE FUNCTION grant_guard();
CREATE TRIGGER "Grant_no_truncate" BEFORE TRUNCATE ON "Grant"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Répartition : libre tant que la subvention est demandée ou en instruction, figée dès qu'elle est décidée.
CREATE FUNCTION grant_allocation_guard() RETURNS trigger AS $$
DECLARE
    parent_status "GrantStatus";
    target uuid;
BEGIN
    target := CASE WHEN TG_OP = 'DELETE' THEN OLD."grantId" ELSE NEW."grantId" END;
    IF TG_OP = 'UPDATE' AND NEW."grantId" <> OLD."grantId" THEN
        RAISE EXCEPTION 'Une part ne change pas de subvention';
    END IF;
    SELECT "status" INTO parent_status FROM "Grant" WHERE "id" = target;
    IF parent_status IS NOT NULL AND parent_status NOT IN ('REQUESTED', 'UNDER_REVIEW') THEN
        RAISE EXCEPTION 'La répartition d''une subvention décidée ne change plus';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GrantProjectAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "GrantProjectAllocation"
    FOR EACH ROW EXECUTE FUNCTION grant_allocation_guard();
CREATE TRIGGER "GrantProjectAllocation_no_truncate" BEFORE TRUNCATE ON "GrantProjectAllocation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
