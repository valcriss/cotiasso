-- CreateEnum
CREATE TYPE "RecoveryBatchStatus" AS ENUM ('OPEN', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RecoveryItemKind" AS ENUM ('OPENING', 'TRANSACTION');

-- CreateTable
CREATE TABLE "RecoveryBatch" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "status" "RecoveryBatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "abandonedAt" TIMESTAMPTZ(3),
    "abandonedBy" UUID,

    CONSTRAINT "RecoveryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryBatchItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "kind" "RecoveryItemKind" NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryBatchItem_entryId_key" ON "RecoveryBatchItem"("entryId");

-- CreateIndex
CREATE INDEX "RecoveryBatchItem_batchId_idx" ON "RecoveryBatchItem"("batchId");

-- AddForeignKey
ALTER TABLE "RecoveryBatchItem" ADD CONSTRAINT "RecoveryBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RecoveryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryBatchItem" ADD CONSTRAINT "RecoveryBatchItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryBatchItem" ADD CONSTRAINT "RecoveryBatchItem_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0019 : lots de reprise. Les garanties sont ici, pas dans l'application.

-- Une seule écriture d'ouverture par compte financier.
CREATE UNIQUE INDEX "RecoveryBatchItem_one_opening_per_account" ON "RecoveryBatchItem"("financialAccountId") WHERE "kind" = 'OPENING';

CREATE FUNCTION recovery_batch_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un lot de reprise ne se supprime pas : on l''abandonne';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'OPEN' THEN
            RAISE EXCEPTION 'Un lot de reprise naît en préparation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."name" <> OLD."name" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'Le nom d''un lot de reprise ne change pas';
    END IF;
    IF OLD."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'Un lot de reprise terminé ou abandonné ne change plus';
    END IF;
    IF NEW."status" = 'COMPLETED' THEN
        IF NEW."closedAt" IS NULL THEN
            RAISE EXCEPTION 'La fin d''un lot de reprise est datée';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "RecoveryBatchItem" WHERE "batchId" = OLD."id") THEN
            RAISE EXCEPTION 'Un lot de reprise vide ne se termine pas : abandonnez-le';
        END IF;
    ELSIF NEW."status" = 'ABANDONED' THEN
        IF NEW."abandonedAt" IS NULL THEN
            RAISE EXCEPTION 'L''abandon d''un lot de reprise est daté';
        END IF;
    END IF;
    IF NEW."status" IN ('COMPLETED', 'ABANDONED') AND EXISTS (
        SELECT 1 FROM "RecoveryBatchItem" i JOIN "JournalEntry" e ON e."id" = i."entryId"
        WHERE i."batchId" = OLD."id" AND e."status" = 'DRAFT'
    ) THEN
        RAISE EXCEPTION 'Il reste des brouillons dans ce lot de reprise : comptabilisez-les ou supprimez-les d''abord';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RecoveryBatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "RecoveryBatch"
    FOR EACH ROW EXECUTE FUNCTION recovery_batch_guard();
CREATE TRIGGER "RecoveryBatch_no_truncate" BEFORE TRUNCATE ON "RecoveryBatch"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

CREATE FUNCTION recovery_item_guard() RETURNS trigger AS $$
DECLARE
    batch_status "RecoveryBatchStatus";
    entry_status "EntryStatus";
    journal_type "JournalType";
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Un élément de lot de reprise ne se modifie pas';
    END IF;
    IF TG_OP = 'DELETE' THEN
        -- Seule la suppression du brouillon (en cascade) retire l'élément ; l'écriture n'existe alors plus.
        IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE "id" = OLD."entryId") THEN
            RAISE EXCEPTION 'Un élément de lot de reprise ne se retire pas à la main : supprimez le brouillon';
        END IF;
        RETURN OLD;
    END IF;
    SELECT "status" INTO batch_status FROM "RecoveryBatch" WHERE "id" = NEW."batchId" FOR SHARE;
    IF batch_status <> 'OPEN' THEN
        RAISE EXCEPTION 'Ce lot de reprise n''est plus en préparation : il ne reçoit plus d''écriture';
    END IF;
    SELECT e."status", j."type" INTO entry_status, journal_type
        FROM "JournalEntry" e JOIN "Journal" j ON j."id" = e."journalId" WHERE e."id" = NEW."entryId";
    IF entry_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Seul un brouillon entre dans un lot de reprise';
    END IF;
    IF NEW."kind" = 'OPENING' AND journal_type <> 'OPENING' THEN
        RAISE EXCEPTION 'Une écriture d''ouverture se passe dans le journal d''à-nouveaux';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RecoveryBatchItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "RecoveryBatchItem"
    FOR EACH ROW EXECUTE FUNCTION recovery_item_guard();
CREATE TRIGGER "RecoveryBatchItem_no_truncate" BEFORE TRUNCATE ON "RecoveryBatchItem"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
