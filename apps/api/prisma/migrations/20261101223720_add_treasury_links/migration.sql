-- CreateEnum
CREATE TYPE "TreasuryMatchStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "TreasuryMatch" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "financialAccountId" UUID NOT NULL,
    "status" "TreasuryMatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TreasuryMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL,
    "outTransactionId" UUID NOT NULL,
    "inTransactionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryMatch_transactionId_idx" ON "TreasuryMatch"("transactionId");

-- CreateIndex
CREATE INDEX "TreasuryMatch_entryId_idx" ON "TreasuryMatch"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_outTransactionId_key" ON "Transfer"("outTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_inTransactionId_key" ON "Transfer"("inTransactionId");

-- AddForeignKey
ALTER TABLE "TreasuryMatch" ADD CONSTRAINT "TreasuryMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMatch" ADD CONSTRAINT "TreasuryMatch_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMatch" ADD CONSTRAINT "TreasuryMatch_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_outTransactionId_fkey" FOREIGN KEY ("outTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_inTransactionId_fkey" FOREIGN KEY ("inTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0017 : liaison transaction → écriture et virements internes. Les garanties sont ici, pas dans l'application.

-- Une liaison active par transaction, et une par écriture et compte financier (un virement porte deux liaisons).
CREATE UNIQUE INDEX "TreasuryMatch_active_transaction" ON "TreasuryMatch"("transactionId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "TreasuryMatch_active_entry_account" ON "TreasuryMatch"("entryId", "financialAccountId") WHERE "status" = 'ACTIVE';

-- Solde net (débit − crédit) d'une écriture sur le compte comptable d'un compte financier.
CREATE FUNCTION treasury_entry_net(p_entry uuid, p_financial_account uuid) RETURNS numeric AS $$
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0)
    FROM "JournalLine" l
    JOIN "FinancialAccount" f ON f."accountId" = l."accountId"
    WHERE l."entryId" = p_entry AND f."id" = p_financial_account;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION treasury_match_guard() RETURNS trigger AS $$
DECLARE
    tx "Transaction"%ROWTYPE;
    entry_row "JournalEntry"%ROWTYPE;
    entry_status "EntryStatus";
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Une liaison naît active';
        END IF;
        SELECT * INTO tx FROM "Transaction" WHERE "id" = NEW."transactionId" FOR SHARE;
        IF tx."financialAccountId" <> NEW."financialAccountId" THEN
            RAISE EXCEPTION 'Le compte financier de la liaison diffère de celui de la transaction';
        END IF;
        SELECT * INTO entry_row FROM "JournalEntry" WHERE "id" = NEW."entryId" FOR SHARE;
        IF entry_row."kind" <> 'NORMAL' OR entry_row."status" NOT IN ('DRAFT', 'POSTED') THEN
            RAISE EXCEPTION 'Seule une écriture ordinaire, en brouillon ou comptabilisée, se lie à une transaction';
        END IF;
        IF treasury_entry_net(NEW."entryId", NEW."financialAccountId") <> tx."amount" THEN
            RAISE EXCEPTION 'La ligne de banque de l''écriture ne correspond pas à la transaction (compte ou montant différent)';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'ENDED' OR NEW."endedAt" IS NULL
            OR NEW."transactionId" <> OLD."transactionId" OR NEW."entryId" <> OLD."entryId"
            OR NEW."financialAccountId" <> OLD."financialAccountId" OR NEW."createdAt" <> OLD."createdAt" THEN
            RAISE EXCEPTION 'Une liaison ne se modifie pas : seule sa fin (contrepassation) est possible';
        END IF;
        RETURN NEW;
    END IF;

    -- DELETE : un brouillon libère la transaction ; une écriture comptabilisée garde sa liaison (historique).
    -- Lors de la suppression d'un brouillon en cascade, l'écriture n'existe déjà plus.
    SELECT "status" INTO entry_status FROM "JournalEntry" WHERE "id" = OLD."entryId";
    IF OLD."status" <> 'ACTIVE' OR (entry_status IS NOT NULL AND entry_status <> 'DRAFT') THEN
        RAISE EXCEPTION 'Une liaison à une écriture comptabilisée ne se supprime pas : contrepassez l''écriture';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TreasuryMatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TreasuryMatch"
    FOR EACH ROW EXECUTE FUNCTION treasury_match_guard();
CREATE TRIGGER "TreasuryMatch_no_truncate" BEFORE TRUNCATE ON "TreasuryMatch"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Comptabilisation : la ligne de banque d'un brouillon relié doit toujours correspondre à sa transaction.
CREATE FUNCTION treasury_entry_posting_check() RETURNS trigger AS $$
DECLARE
    match_row "TreasuryMatch"%ROWTYPE;
    tx_amount numeric;
BEGIN
    FOR match_row IN SELECT * FROM "TreasuryMatch" WHERE "entryId" = NEW."id" AND "status" = 'ACTIVE' LOOP
        SELECT "amount" INTO tx_amount FROM "Transaction" WHERE "id" = match_row."transactionId";
        IF treasury_entry_net(NEW."id", match_row."financialAccountId") <> tx_amount THEN
            RAISE EXCEPTION 'La ligne de banque de l''écriture ne correspond plus à la transaction liée : corrigez l''écriture ou dissociez la transaction';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_treasury_posting_check" BEFORE UPDATE OF "status" ON "JournalEntry"
    FOR EACH ROW WHEN (OLD."status" = 'DRAFT' AND NEW."status" = 'POSTED')
    EXECUTE FUNCTION treasury_entry_posting_check();

-- Contrepassation : la liaison prend fin (historique conservé) et la transaction redevient à comptabiliser.
CREATE FUNCTION treasury_entry_reversed() RETURNS trigger AS $$
BEGIN
    UPDATE "TreasuryMatch" SET "status" = 'ENDED', "endedAt" = now()
    WHERE "entryId" = NEW."id" AND "status" = 'ACTIVE';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_treasury_reversed" AFTER UPDATE OF "status" ON "JournalEntry"
    FOR EACH ROW WHEN (OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED')
    EXECUTE FUNCTION treasury_entry_reversed();

-- Virement interne : sortie et entrée opposées, même date, comptes différents ; il ne s'annule plus dès qu'une de ses
-- transactions est liée à une écriture ou identifiée par la banque.
CREATE FUNCTION transfer_guard() RETURNS trigger AS $$
DECLARE
    out_tx "Transaction"%ROWTYPE;
    in_tx "Transaction"%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Un virement ne se modifie pas';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM "TreasuryMatch" WHERE "transactionId" IN (OLD."outTransactionId", OLD."inTransactionId"))
            OR EXISTS (SELECT 1 FROM "Transaction" WHERE "id" IN (OLD."outTransactionId", OLD."inTransactionId")
                AND "externalId" IS NOT NULL) THEN
            RAISE EXCEPTION 'Un virement lié à une écriture ou à un relevé ne s''annule pas';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO out_tx FROM "Transaction" WHERE "id" = NEW."outTransactionId";
    SELECT * INTO in_tx FROM "Transaction" WHERE "id" = NEW."inTransactionId";
    IF out_tx."financialAccountId" = in_tx."financialAccountId" THEN
        RAISE EXCEPTION 'Un virement relie deux comptes financiers différents';
    END IF;
    IF out_tx."amount" >= 0 OR in_tx."amount" <> -out_tx."amount" THEN
        RAISE EXCEPTION 'Un virement est une sortie et une entrée du même montant';
    END IF;
    IF out_tx."operationDate" <> in_tx."operationDate" THEN
        RAISE EXCEPTION 'Les deux transactions d''un virement ont la même date';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transfer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Transfer"
    FOR EACH ROW EXECUTE FUNCTION transfer_guard();
CREATE TRIGGER "Transfer_no_truncate" BEFORE TRUNCATE ON "Transfer"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Transaction : liée à une écriture (active ou passée) ou membre d'un virement, elle garde son montant et sa date et ne
-- se supprime plus. Reprend la version de l'import OFX et y ajoute ces règles.
CREATE OR REPLACE FUNCTION transaction_guard() RETURNS trigger AS $$
DECLARE
    account_row "FinancialAccount"%ROWTYPE;
    project_status "ProjectStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."origin" <> 'MANUAL' OR OLD."externalId" IS NOT NULL THEN
            RAISE EXCEPTION 'Une transaction importée ou rattachée à un relevé ne se supprime pas';
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
