-- CreateTable
CREATE TABLE "FundingExpenseAllocation" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "coFinancingReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "FundingExpenseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingExpenseAllocation_grantId_idx" ON "FundingExpenseAllocation"("grantId");

-- CreateIndex
CREATE INDEX "FundingExpenseAllocation_allocationId_idx" ON "FundingExpenseAllocation"("allocationId");

-- AddForeignKey
ALTER TABLE "FundingExpenseAllocation" ADD CONSTRAINT "FundingExpenseAllocation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingExpenseAllocation" ADD CONSTRAINT "FundingExpenseAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "AnalyticalAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0024, tranche 4.4. Les garanties sont ici, pas dans l'application.
ALTER TABLE "FundingExpenseAllocation" ADD CONSTRAINT "FundingExpenseAllocation_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "FundingExpenseAllocation" ADD CONSTRAINT "FundingExpenseAllocation_reason_not_blank"
    CHECK ("coFinancingReason" IS NULL OR btrim("coFinancingReason") <> '');

-- Affectation d'une dépense à une subvention : jamais supprimée ni modifiée, seulement annulée avec un motif. À l'ajout :
-- la subvention est accordée (pas clôturée) ; la dépense est une charge (débit de classe 6) d'une écriture comptabilisée ;
-- son projet est financé par la subvention ; et la somme des affectations de cette dépense (toutes subventions confondues)
-- ne dépasse jamais son montant. Le montant accordé n'est volontairement PAS un plafond : le dépassement est signalé.
CREATE FUNCTION funding_expense_guard() RETURNS trigger AS $$
DECLARE
    grant_status "GrantStatus";
    expense RECORD;
    already numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une affectation de dépense ne se supprime pas : on l''annule avec un motif';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."grantId" <> OLD."grantId" OR NEW."allocationId" <> OLD."allocationId" OR NEW."amount" <> OLD."amount"
            OR NEW."coFinancingReason" IS DISTINCT FROM OLD."coFinancingReason" OR NEW."createdAt" <> OLD."createdAt" THEN
            RAISE EXCEPTION 'Une affectation de dépense ne se modifie pas : annulez-la et refaites-la';
        END IF;
        IF OLD."cancelledAt" IS NOT NULL THEN
            RAISE EXCEPTION 'Une affectation annulée ne change plus';
        END IF;
        IF NEW."cancelledAt" IS NULL OR NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) < 3 THEN
            RAISE EXCEPTION 'Une annulation d''affectation a un motif et une date';
        END IF;
        SELECT "status" INTO grant_status FROM "Grant" WHERE "id" = NEW."grantId";
        IF grant_status <> 'GRANTED' THEN
            RAISE EXCEPTION 'Cette subvention est clôturée : ses affectations de dépenses ne changent plus';
        END IF;
        RETURN NEW;
    END IF;

    SELECT "status" INTO grant_status FROM "Grant" WHERE "id" = NEW."grantId";
    IF grant_status <> 'GRANTED' THEN
        RAISE EXCEPTION 'Seule une subvention accordée, pas encore clôturée, reçoit des dépenses';
    END IF;

    -- Verrou de la dépense : deux affectations simultanées de la même dépense passent l'une après l'autre.
    SELECT al."amount" AS amount, al."projectId" AS project_id, l."debit" AS debit, a."number" AS account_number, e."status" AS entry_status
        INTO expense
        FROM "AnalyticalAllocation" al
        JOIN "JournalLine" l ON l."id" = al."lineId"
        JOIN "JournalEntry" e ON e."id" = l."entryId"
        JOIN "Account" a ON a."id" = l."accountId"
        WHERE al."id" = NEW."allocationId"
        FOR UPDATE OF al;
    IF expense.entry_status IS DISTINCT FROM 'POSTED' THEN
        RAISE EXCEPTION 'Seule une dépense comptabilisée peut être affectée à une subvention';
    END IF;
    IF expense.debit <= 0 OR left(expense.account_number, 1) <> '6' THEN
        RAISE EXCEPTION 'Seule une dépense (une charge) peut être affectée à une subvention';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "GrantProjectAllocation" WHERE "grantId" = NEW."grantId" AND "projectId" = expense.project_id) THEN
        RAISE EXCEPTION 'Cette dépense appartient à un projet que la subvention ne finance pas';
    END IF;
    SELECT COALESCE(SUM("amount"), 0) INTO already FROM "FundingExpenseAllocation"
        WHERE "allocationId" = NEW."allocationId" AND "cancelledAt" IS NULL;
    IF already + NEW."amount" > expense.amount THEN
        RAISE EXCEPTION 'Les affectations dépassent le montant de la dépense (% déjà affecté sur %)', already, expense.amount;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FundingExpenseAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FundingExpenseAllocation"
    FOR EACH ROW EXECUTE FUNCTION funding_expense_guard();
CREATE TRIGGER "FundingExpenseAllocation_no_truncate" BEFORE TRUNCATE ON "FundingExpenseAllocation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
