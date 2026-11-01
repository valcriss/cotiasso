-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "TransactionOrigin" AS ENUM ('MANUAL', 'IMPORT');

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "reference" TEXT,
    "accountId" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "openedOn" DATE NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "archivedOn" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" UUID NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "operationDate" DATE NOT NULL,
    "valueDate" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "origin" "TransactionOrigin" NOT NULL DEFAULT 'MANUAL',
    "source" TEXT,
    "externalId" TEXT,
    "projectId" UUID,
    "counterpartAccountId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_accountId_key" ON "FinancialAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAccount_journalId_key" ON "FinancialAccount"("journalId");

-- CreateIndex
CREATE INDEX "BankStatement_financialAccountId_periodEnd_idx" ON "BankStatement"("financialAccountId", "periodEnd");

-- CreateIndex
CREATE INDEX "Transaction_financialAccountId_operationDate_idx" ON "Transaction"("financialAccountId", "operationDate");

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_counterpartAccountId_fkey" FOREIGN KEY ("counterpartAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Compte financier : euro seulement (périmètre initial), compte de trésorerie (classe 5) et journal du bon type, jamais
-- supprimé, rattachements définitifs.
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_currency_eur" CHECK ("currency" = 'EUR');
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_name_not_blank" CHECK (btrim("name") <> '');

CREATE FUNCTION financial_account_guard() RETURNS trigger AS $$
DECLARE
    account_number text;
    journal_type "JournalType";
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un compte financier ne se supprime pas : on l''archive';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT "number" INTO account_number FROM "Account" WHERE "id" = NEW."accountId";
        IF account_number !~ '^5' THEN
            RAISE EXCEPTION 'Un compte financier se rattache à un compte de trésorerie (classe 5)';
        END IF;
        SELECT "type" INTO journal_type FROM "Journal" WHERE "id" = NEW."journalId";
        IF journal_type::text <> NEW."type"::text THEN
            RAISE EXCEPTION 'Le journal d''un compte financier est du même type que lui (banque ou caisse)';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."type" <> OLD."type" OR NEW."accountId" <> OLD."accountId" OR NEW."journalId" <> OLD."journalId"
        OR NEW."currency" <> OLD."currency" THEN
        RAISE EXCEPTION 'Le type, la devise, le compte comptable et le journal d''un compte financier ne changent pas';
    END IF;
    IF OLD."archivedOn" IS NOT NULL AND NEW."archivedOn" IS DISTINCT FROM OLD."archivedOn" THEN
        RAISE EXCEPTION 'Un compte financier archivé ne se réactive pas';
    END IF;
    IF (NEW."openedOn" <> OLD."openedOn" OR NEW."openingBalance" <> OLD."openingBalance")
        AND EXISTS (SELECT 1 FROM "Transaction" WHERE "financialAccountId" = OLD."id") THEN
        RAISE EXCEPTION 'Le solde et la date d''ouverture ne changent plus une fois des transactions enregistrées';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancialAccount_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinancialAccount"
    FOR EACH ROW EXECUTE FUNCTION financial_account_guard();
CREATE TRIGGER "FinancialAccount_no_truncate" BEFORE TRUNCATE ON "FinancialAccount"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Relevé : ajout seul (une correction se fait par un nouveau relevé).
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_period_order" CHECK ("periodStart" <= "periodEnd");

CREATE FUNCTION bank_statement_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Un relevé est en ajout seul : % refusé', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BankStatement_append_only" BEFORE UPDATE OR DELETE ON "BankStatement"
    FOR EACH ROW EXECUTE FUNCTION bank_statement_append_only();
CREATE TRIGGER "BankStatement_no_truncate" BEFORE TRUNCATE ON "BankStatement"
    FOR EACH STATEMENT EXECUTE FUNCTION bank_statement_append_only();

-- Transaction : montant signé non nul, identifiant externe toujours accompagné de sa source et unique par compte
-- (idempotence des imports), jamais sur un compte archivé ni avant son ouverture.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_not_zero" CHECK ("amount" <> 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_external_pair" CHECK (("externalId" IS NULL) = ("source" IS NULL));
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_import_has_external_id" CHECK ("origin" <> 'IMPORT' OR "externalId" IS NOT NULL);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_version_positive" CHECK ("version" >= 1);
CREATE UNIQUE INDEX "Transaction_external_unique" ON "Transaction" ("financialAccountId", "source", "externalId")
    WHERE "externalId" IS NOT NULL;

CREATE FUNCTION transaction_guard() RETURNS trigger AS $$
DECLARE
    account_row "FinancialAccount"%ROWTYPE;
    project_status "ProjectStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."origin" <> 'MANUAL' THEN
            RAISE EXCEPTION 'Une transaction importée ne se supprime pas';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (
        NEW."financialAccountId" <> OLD."financialAccountId" OR NEW."origin" <> OLD."origin"
        OR NEW."source" IS DISTINCT FROM OLD."source" OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
        OR (OLD."origin" = 'IMPORT' AND (NEW."amount" <> OLD."amount" OR NEW."operationDate" <> OLD."operationDate"))
    ) THEN
        RAISE EXCEPTION 'Le compte, l''origine, l''identifiant externe et les données financières d''une transaction importée ne changent pas';
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

CREATE TRIGGER "Transaction_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Transaction"
    FOR EACH ROW EXECUTE FUNCTION transaction_guard();
CREATE TRIGGER "Transaction_no_truncate" BEFORE TRUNCATE ON "Transaction"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
