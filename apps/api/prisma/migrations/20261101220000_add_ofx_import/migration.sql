-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('ANALYZED', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportLineStatus" AS ENUM ('NEW', 'DUPLICATE', 'PROBABLE_MATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportDecision" AS ENUM ('CREATE', 'LINK', 'SKIP');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'ANALYZED',
    "periodStart" DATE,
    "periodEnd" DATE,
    "ledgerBalance" DECIMAL(14,2),
    "ledgerBalanceDate" DATE,
    "accountHint" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "committedAt" TIMESTAMPTZ(3),
    "committedBy" UUID,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLine" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "fitId" TEXT,
    "operationDate" DATE,
    "amount" DECIMAL(14,2),
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "status" "ImportLineStatus" NOT NULL,
    "errors" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "matchedTransactionId" UUID,
    "decision" "ImportDecision",
    "transactionId" UUID,

    CONSTRAINT "ImportLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_financialAccountId_createdAt_idx" ON "ImportBatch"("financialAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportLine_transactionId_idx" ON "ImportLine"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLine_batchId_position_key" ON "ImportLine"("batchId", "position");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Un même fichier ne se confirme qu'une fois par compte (idempotence par empreinte).
CREATE UNIQUE INDEX "ImportBatch_committed_file_unique" ON "ImportBatch" ("financialAccountId", "fileHash")
    WHERE "status" = 'COMMITTED';
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_hash_format" CHECK ("fileHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_committed_has_date" CHECK (("status" = 'COMMITTED') = ("committedAt" IS NOT NULL));

-- Décision cohérente avec le classement : on ne rattache qu'une ligne à rapprocher, on ne crée jamais un doublon
-- ni une ligne en erreur, et une transaction n'est renseignée que pour une création ou un rattachement.
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_decision_shape" CHECK (
    ("decision" IS NULL AND "transactionId" IS NULL)
    OR ("decision" = 'SKIP' AND "transactionId" IS NULL)
    OR ("decision" = 'CREATE' AND "transactionId" IS NOT NULL AND "status" IN ('NEW', 'PROBABLE_MATCH'))
    OR ("decision" = 'LINK' AND "transactionId" IS NOT NULL AND "status" = 'PROBABLE_MATCH')
);
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_position_positive" CHECK ("position" >= 1);

CREATE FUNCTION import_batch_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un import ne se supprime pas';
    END IF;
    IF NEW."fileHash" <> OLD."fileHash" OR NEW."financialAccountId" <> OLD."financialAccountId"
        OR NEW."fileName" <> OLD."fileName" OR NEW."format" <> OLD."format" THEN
        RAISE EXCEPTION 'Le fichier d''un import ne change pas';
    END IF;
    IF OLD."status" <> 'ANALYZED' THEN
        RAISE EXCEPTION 'Un import confirmé ou annulé ne change plus';
    END IF;
    IF NEW."status" = 'COMMITTED' THEN
        IF EXISTS (SELECT 1 FROM "ImportLine" WHERE "batchId" = OLD."id" AND "decision" IS NULL) THEN
            RAISE EXCEPTION 'Toutes les lignes de l''import doivent avoir une décision';
        END IF;
        IF NEW."committedAt" IS NULL THEN
            NEW."committedAt" := clock_timestamp();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ImportBatch_guard" BEFORE UPDATE OR DELETE ON "ImportBatch"
    FOR EACH ROW EXECUTE FUNCTION import_batch_guard();
CREATE TRIGGER "ImportBatch_no_truncate" BEFORE TRUNCATE ON "ImportBatch"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Ligne : les données brutes et l'analyse ne se réécrivent jamais ; seule la décision se renseigne, tant que l'import
-- n'est ni confirmé ni annulé.
CREATE FUNCTION import_line_guard() RETURNS trigger AS $$
DECLARE
    batch_status "ImportBatchStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une ligne d''import ne se supprime pas';
    END IF;
    IF NEW."batchId" <> OLD."batchId" OR NEW."position" <> OLD."position" OR NEW."raw" <> OLD."raw"
        OR NEW."fitId" IS DISTINCT FROM OLD."fitId" OR NEW."operationDate" IS DISTINCT FROM OLD."operationDate"
        OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."label" <> OLD."label"
        OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."status" <> OLD."status"
        OR NEW."errors" <> OLD."errors" OR NEW."candidates" <> OLD."candidates"
        OR NEW."matchedTransactionId" IS DISTINCT FROM OLD."matchedTransactionId" THEN
        RAISE EXCEPTION 'Les données brutes d''une ligne d''import ne se réécrivent pas';
    END IF;
    SELECT "status" INTO batch_status FROM "ImportBatch" WHERE "id" = OLD."batchId" FOR SHARE;
    IF batch_status <> 'ANALYZED' THEN
        RAISE EXCEPTION 'Un import confirmé ou annulé ne change plus';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ImportLine_guard" BEFORE UPDATE OR DELETE ON "ImportLine"
    FOR EACH ROW EXECUTE FUNCTION import_line_guard();
CREATE TRIGGER "ImportLine_no_truncate" BEFORE TRUNCATE ON "ImportLine"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Transaction : l'identifiant bancaire s'attribue une seule fois (à l'import ou au rattachement d'une saisie manuelle à
-- une ligne de relevé), puis ni lui ni les données financières ne changent, et la transaction ne se supprime plus.
CREATE OR REPLACE FUNCTION transaction_guard() RETURNS trigger AS $$
DECLARE
    account_row "FinancialAccount"%ROWTYPE;
    project_status "ProjectStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."origin" <> 'MANUAL' OR OLD."externalId" IS NOT NULL THEN
            RAISE EXCEPTION 'Une transaction importée ou rattachée à un relevé ne se supprime pas';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."financialAccountId" <> OLD."financialAccountId" OR NEW."origin" <> OLD."origin" THEN
            RAISE EXCEPTION 'Le compte et l''origine d''une transaction ne changent pas';
        END IF;
        IF OLD."externalId" IS NOT NULL AND (NEW."source" IS DISTINCT FROM OLD."source"
            OR NEW."externalId" IS DISTINCT FROM OLD."externalId") THEN
            RAISE EXCEPTION 'L''identifiant bancaire d''une transaction ne change pas';
        END IF;
        IF OLD."externalId" IS NOT NULL AND (NEW."amount" <> OLD."amount" OR NEW."operationDate" <> OLD."operationDate") THEN
            RAISE EXCEPTION 'Les données financières d''une transaction importée ou rattachée à un relevé ne changent pas';
        END IF;
    END IF;

    SELECT * INTO account_row FROM "FinancialAccount" WHERE "id" = NEW."financialAccountId" FOR SHARE;
    IF TG_OP = 'INSERT' AND account_row."archivedOn" IS NOT NULL THEN
        RAISE EXCEPTION 'Le compte financier est archivé';
    END IF;
    IF NEW."operationDate" < account_row."openedOn" THEN
        RAISE EXCEPTION 'La transaction précède l''ouverture du compte financier';
    END IF;
    IF NEW."counterpartAccountId" IS NOT NULL AND NEW."counterpartAccountId" = account_row."accountId" THEN
        RAISE EXCEPTION 'Le compte de contrepartie diffère du compte de trésorerie';
    END IF;
    IF NEW."projectId" IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW."projectId" IS DISTINCT FROM OLD."projectId") THEN
        SELECT "status" INTO project_status FROM "Project" WHERE "id" = NEW."projectId";
        IF project_status = 'ARCHIVED' THEN
            RAISE EXCEPTION 'Un projet archivé ne reçoit plus de transaction';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
