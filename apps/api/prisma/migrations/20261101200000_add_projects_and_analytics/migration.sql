-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PREPARATION', 'ACTIVE', 'FINISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PREPARATION',
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE,
    "endDate" DATE,
    "managerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticalAllocation" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "AnalyticalAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "AnalyticalAllocation_projectId_idx" ON "AnalyticalAllocation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticalAllocation_lineId_projectId_key" ON "AnalyticalAllocation"("lineId", "projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalAllocation" ADD CONSTRAINT "AnalyticalAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "JournalLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticalAllocation" ADD CONSTRAINT "AnalyticalAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Projet : code lisible, dates cohérentes, un seul projet permanent, jamais supprimé.
ALTER TABLE "Project" ADD CONSTRAINT "Project_code_format" CHECK ("code" ~ '^[A-Z0-9-]{1,20}$');
ALTER TABLE "Project" ADD CONSTRAINT "Project_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "Project" ADD CONSTRAINT "Project_dates_order" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
CREATE UNIQUE INDEX "Project_one_permanent" ON "Project" ("permanent") WHERE "permanent";

CREATE FUNCTION project_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un projet ne se supprime pas : on l''archive';
    END IF;
    IF NEW."code" <> OLD."code" THEN
        RAISE EXCEPTION 'Le code d''un projet ne change pas';
    END IF;
    IF NEW."permanent" <> OLD."permanent" THEN
        RAISE EXCEPTION 'Le caractère permanent d''un projet ne change pas';
    END IF;
    IF OLD."permanent" AND NEW."status" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Le projet permanent reste actif';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_guard" BEFORE UPDATE OR DELETE ON "Project"
    FOR EACH ROW EXECUTE FUNCTION project_guard();
CREATE TRIGGER "Project_no_truncate" BEFORE TRUNCATE ON "Project"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

INSERT INTO "Project" ("id", "code", "name", "description", "status", "permanent")
VALUES (gen_random_uuid(), 'FONCT', 'Fonctionnement de l''association', 'Opérations générales de l''association.', 'ACTIVE', true);

-- Ventilation : montant positif ; seulement sur une ligne de charge ou de produit (classes 6 et 7), tant que
-- l'écriture est un brouillon, et jamais vers un projet archivé.
ALTER TABLE "AnalyticalAllocation" ADD CONSTRAINT "AnalyticalAllocation_amount_positive" CHECK ("amount" > 0);

CREATE FUNCTION analytical_allocation_guard() RETURNS trigger AS $$
DECLARE
    entry_status "EntryStatus";
    account_number text;
    project_status "ProjectStatus";
    target_line uuid;
BEGIN
    target_line := CASE WHEN TG_OP = 'DELETE' THEN OLD."lineId" ELSE NEW."lineId" END;
    SELECT e."status", a."number" INTO entry_status, account_number
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e."id" = l."entryId"
        JOIN "Account" a ON a."id" = l."accountId"
        WHERE l."id" = target_line;
    -- Ligne absente : suppression en cascade d'un brouillon déjà retiré.
    IF entry_status IS NOT NULL AND entry_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'La ventilation analytique d''une écriture comptabilisée est immuable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF account_number !~ '^[67]' THEN
        RAISE EXCEPTION 'Seules les lignes de charge ou de produit (classes 6 et 7) se ventilent par projet';
    END IF;
    SELECT "status" INTO project_status FROM "Project" WHERE "id" = NEW."projectId" FOR SHARE;
    IF project_status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'Un projet archivé ne reçoit plus de ventilation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AnalyticalAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AnalyticalAllocation"
    FOR EACH ROW EXECUTE FUNCTION analytical_allocation_guard();
CREATE TRIGGER "AnalyticalAllocation_no_truncate" BEFORE TRUNCATE ON "AnalyticalAllocation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Obligation de projet (paramètre « accounting.projectRequired », vrai par défaut en configuration initiale, CA-06),
-- lue à la comptabilisation : la valeur en vigueur est la dernière version datée d'avant maintenant.
CREATE FUNCTION accounting_project_required() RETURNS boolean AS $$
    SELECT COALESCE(
        (SELECT ("payload" ->> 'projectRequired')::boolean
         FROM "SettingsVersion"
         WHERE "section" = 'accounting' AND "effectiveFrom" <= now() AND "payload" ? 'projectRequired'
         ORDER BY "effectiveFrom" DESC, "createdAt" DESC
         LIMIT 1),
        true);
$$ LANGUAGE sql STABLE;

-- Comptabilisation : chaque ligne de charge ou de produit est ventilée à hauteur de son montant, ou refusée si
-- l'obligation de projet est active. Un brouillon, lui, reste toujours possible.
CREATE FUNCTION journal_entry_analytics_guard() RETURNS trigger AS $$
DECLARE
    line_row record;
    allocated numeric;
    required boolean := accounting_project_required();
BEGIN
    IF NOT (TG_OP = 'UPDATE' AND OLD."status" = 'DRAFT' AND NEW."status" = 'POSTED') THEN
        RETURN NEW;
    END IF;
    FOR line_row IN
        SELECT l."id", l."position", l."debit" + l."credit" AS amount, a."number"
        FROM "JournalLine" l JOIN "Account" a ON a."id" = l."accountId"
        WHERE l."entryId" = NEW."id" AND a."number" ~ '^[67]'
        ORDER BY l."position"
    LOOP
        SELECT COALESCE(sum("amount"), 0) INTO allocated FROM "AnalyticalAllocation" WHERE "lineId" = line_row."id";
        IF allocated = 0 THEN
            IF required THEN
                RAISE EXCEPTION 'Projet obligatoire sur la ligne % (compte %)', line_row."position", line_row."number";
            END IF;
        ELSIF allocated <> line_row.amount THEN
            RAISE EXCEPTION 'La ventilation par projet de la ligne % (%) ne correspond pas à son montant (%)',
                line_row."position", allocated, line_row.amount;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_analytics_guard" BEFORE UPDATE ON "JournalEntry"
    FOR EACH ROW EXECUTE FUNCTION journal_entry_analytics_guard();
