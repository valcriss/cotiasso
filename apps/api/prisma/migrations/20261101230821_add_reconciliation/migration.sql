-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'VALIDATED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reconciliationId" UUID;

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" UUID NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "validatedAt" TIMESTAMPTZ(3),
    "validatedBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reconciliation_financialAccountId_periodEnd_idx" ON "Reconciliation"("financialAccountId", "periodEnd");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0018 : rapprochement bancaire par pointage sur un relevé. Les garanties sont ici, pas dans l'application.

-- Un seul rapprochement en cours par compte ; un seul rapprochement non annulé par relevé.
CREATE UNIQUE INDEX "Reconciliation_one_in_progress" ON "Reconciliation"("financialAccountId") WHERE "status" = 'IN_PROGRESS';
CREATE UNIQUE INDEX "Reconciliation_one_per_statement" ON "Reconciliation"("statementId") WHERE "status" <> 'CANCELLED';

CREATE FUNCTION reconciliation_pointed_total(p_reconciliation uuid) RETURNS numeric AS $$
    SELECT COALESCE(SUM("amount"), 0) FROM "Transaction" WHERE "reconciliationId" = p_reconciliation;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION reconciliation_guard() RETURNS trigger AS $$
DECLARE
    statement_row "BankStatement"%ROWTYPE;
    last_row "Reconciliation"%ROWTYPE;
    account_opening numeric;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'IN_PROGRESS' THEN
            RAISE EXCEPTION 'Un rapprochement naît en cours';
        END IF;
        SELECT * INTO statement_row FROM "BankStatement" WHERE "id" = NEW."statementId";
        IF statement_row."financialAccountId" <> NEW."financialAccountId"
            OR statement_row."periodEnd" <> NEW."periodEnd" OR statement_row."closingBalance" <> NEW."closingBalance" THEN
            RAISE EXCEPTION 'Le rapprochement ne correspond pas au relevé choisi';
        END IF;
        SELECT * INTO last_row FROM "Reconciliation"
            WHERE "financialAccountId" = NEW."financialAccountId" AND "status" = 'VALIDATED'
            ORDER BY "periodEnd" DESC LIMIT 1;
        IF FOUND THEN
            IF NEW."periodEnd" <= last_row."periodEnd" THEN
                RAISE EXCEPTION 'Le relevé doit se terminer après le dernier rapprochement validé du compte';
            END IF;
            IF NEW."openingBalance" <> last_row."closingBalance" THEN
                RAISE EXCEPTION 'Le solde de départ du rapprochement est celui du dernier rapprochement validé';
            END IF;
        ELSE
            SELECT "openingBalance" INTO account_opening FROM "FinancialAccount" WHERE "id" = NEW."financialAccountId";
            IF NEW."openingBalance" <> account_opening THEN
                RAISE EXCEPTION 'Le solde de départ du premier rapprochement est le solde d''ouverture du compte';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'IN_PROGRESS' THEN
            RAISE EXCEPTION 'Un rapprochement validé ou annulé ne se supprime pas : il s''annule';
        END IF;
        -- Abandon : le pointage est libéré (le rapprochement est encore en cours, le déclencheur des transactions l'accepte).
        UPDATE "Transaction" SET "reconciliationId" = NULL WHERE "reconciliationId" = OLD."id";
        RETURN OLD;
    END IF;

    -- UPDATE
    IF NEW."financialAccountId" <> OLD."financialAccountId" OR NEW."statementId" <> OLD."statementId"
        OR NEW."periodEnd" <> OLD."periodEnd" OR NEW."openingBalance" <> OLD."openingBalance"
        OR NEW."closingBalance" <> OLD."closingBalance" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'Le relevé, la période et les soldes d''un rapprochement ne changent pas';
    END IF;
    IF OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'VALIDATED' THEN
        IF NEW."validatedAt" IS NULL THEN
            RAISE EXCEPTION 'La validation d''un rapprochement est datée';
        END IF;
        IF OLD."openingBalance" + reconciliation_pointed_total(OLD."id") <> OLD."closingBalance" THEN
            RAISE EXCEPTION 'Le rapprochement ne tombe pas juste : il reste un écart entre le relevé et les transactions pointées';
        END IF;
        IF EXISTS (
            SELECT 1 FROM "Transaction" t
            WHERE t."reconciliationId" = OLD."id"
              AND NOT EXISTS (
                  SELECT 1 FROM "TreasuryMatch" m JOIN "JournalEntry" e ON e."id" = m."entryId"
                  WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE' AND e."status" = 'POSTED')
        ) THEN
            RAISE EXCEPTION 'Une transaction pointée n''est pas comptabilisée : comptabilisez-la ou retirez-la du pointage';
        END IF;
    ELSIF OLD."status" = 'VALIDATED' AND NEW."status" = 'CANCELLED' THEN
        IF NEW."cancelledAt" IS NULL THEN
            RAISE EXCEPTION 'L''annulation d''un rapprochement est datée';
        END IF;
        IF EXISTS (SELECT 1 FROM "Reconciliation" WHERE "financialAccountId" = OLD."financialAccountId"
            AND "status" = 'VALIDATED' AND "periodEnd" > OLD."periodEnd") THEN
            RAISE EXCEPTION 'Seul le dernier rapprochement validé du compte peut être annulé';
        END IF;
        IF EXISTS (SELECT 1 FROM "Reconciliation" WHERE "financialAccountId" = OLD."financialAccountId"
            AND "status" = 'IN_PROGRESS') THEN
            RAISE EXCEPTION 'Abandonnez d''abord le rapprochement en cours du compte avant d''annuler le dernier rapprochement validé';
        END IF;
    ELSIF NEW."status" <> OLD."status" THEN
        RAISE EXCEPTION 'Ce changement d''état d''un rapprochement n''est pas permis';
    ELSIF NEW."validatedAt" IS DISTINCT FROM OLD."validatedAt" OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
        RAISE EXCEPTION 'Les dates d''un rapprochement ne changent pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Reconciliation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Reconciliation"
    FOR EACH ROW EXECUTE FUNCTION reconciliation_guard();
CREATE TRIGGER "Reconciliation_no_truncate" BEFORE TRUNCATE ON "Reconciliation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Annulation : le pointage est libéré une fois le rapprochement passé à « annulé ».
CREATE FUNCTION reconciliation_cancelled() RETURNS trigger AS $$
BEGIN
    UPDATE "Transaction" SET "reconciliationId" = NULL WHERE "reconciliationId" = NEW."id";
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Reconciliation_cancelled" AFTER UPDATE OF "status" ON "Reconciliation"
    FOR EACH ROW WHEN (OLD."status" = 'VALIDATED' AND NEW."status" = 'CANCELLED')
    EXECUTE FUNCTION reconciliation_cancelled();

-- Contrepassation d'une écriture : refusée tant qu'une transaction qu'elle comptabilise est rapprochée (validé).
CREATE OR REPLACE FUNCTION treasury_entry_reversed() RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "TreasuryMatch" m
        JOIN "Transaction" t ON t."id" = m."transactionId"
        JOIN "Reconciliation" r ON r."id" = t."reconciliationId"
        WHERE m."entryId" = NEW."id" AND m."status" = 'ACTIVE' AND r."status" = 'VALIDATED'
    ) THEN
        RAISE EXCEPTION 'Cette écriture est liée à une transaction déjà rapprochée : annulez d''abord le rapprochement';
    END IF;
    UPDATE "TreasuryMatch" SET "status" = 'ENDED', "endedAt" = now()
    WHERE "entryId" = NEW."id" AND "status" = 'ACTIVE';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Transaction : ajoute le pointage (ADR 0018) aux règles de l'import OFX et de la liaison (ADR 0017).
CREATE OR REPLACE FUNCTION transaction_guard() RETURNS trigger AS $$
DECLARE
    account_row "FinancialAccount"%ROWTYPE;
    project_status "ProjectStatus";
    old_rec "Reconciliation"%ROWTYPE;
    new_rec "Reconciliation"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."origin" <> 'MANUAL' OR OLD."externalId" IS NOT NULL THEN
            RAISE EXCEPTION 'Une transaction importée ou rattachée à un relevé ne se supprime pas';
        END IF;
        IF OLD."reconciliationId" IS NOT NULL THEN
            RAISE EXCEPTION 'Une transaction pointée dans un rapprochement ne se supprime pas';
        END IF;
        IF EXISTS (SELECT 1 FROM "TreasuryMatch" WHERE "transactionId" = OLD."id")
            OR EXISTS (SELECT 1 FROM "Transfer" WHERE OLD."id" IN ("outTransactionId", "inTransactionId")) THEN
            RAISE EXCEPTION 'Une transaction liée à une écriture ou à un virement ne se supprime pas';
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
        IF (NEW."amount" <> OLD."amount" OR NEW."operationDate" <> OLD."operationDate")
            AND (EXISTS (SELECT 1 FROM "TreasuryMatch" WHERE "transactionId" = OLD."id")
                OR EXISTS (SELECT 1 FROM "Transfer" WHERE OLD."id" IN ("outTransactionId", "inTransactionId"))) THEN
            RAISE EXCEPTION 'Le montant et la date d''une transaction liée à une écriture ou à un virement ne changent pas';
        END IF;

        -- Pointage : seulement dans un rapprochement en cours du même compte ; figé une fois validé.
        IF NEW."reconciliationId" IS DISTINCT FROM OLD."reconciliationId" THEN
            IF OLD."reconciliationId" IS NOT NULL THEN
                SELECT * INTO old_rec FROM "Reconciliation" WHERE "id" = OLD."reconciliationId";
                IF old_rec."status" = 'VALIDATED' THEN
                    RAISE EXCEPTION 'Le pointage d''une transaction rapprochée ne change pas : annulez d''abord le rapprochement';
                END IF;
            END IF;
            IF NEW."reconciliationId" IS NOT NULL THEN
                SELECT * INTO new_rec FROM "Reconciliation" WHERE "id" = NEW."reconciliationId";
                IF new_rec."status" <> 'IN_PROGRESS' OR new_rec."financialAccountId" <> NEW."financialAccountId" THEN
                    RAISE EXCEPTION 'Une transaction ne se pointe que dans un rapprochement en cours de son propre compte';
                END IF;
            END IF;
        ELSIF OLD."reconciliationId" IS NOT NULL AND (NEW."amount" <> OLD."amount" OR NEW."operationDate" <> OLD."operationDate") THEN
            SELECT * INTO old_rec FROM "Reconciliation" WHERE "id" = OLD."reconciliationId";
            IF old_rec."status" = 'VALIDATED' THEN
                RAISE EXCEPTION 'Le montant et la date d''une transaction rapprochée ne changent pas';
            END IF;
        END IF;
        IF NEW."reconciliationId" IS NOT NULL THEN
            SELECT * INTO new_rec FROM "Reconciliation" WHERE "id" = NEW."reconciliationId";
            IF NEW."operationDate" > new_rec."periodEnd" THEN
                RAISE EXCEPTION 'Une transaction pointée est datée au plus tard de la fin du relevé';
            END IF;
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
