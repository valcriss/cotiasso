-- CreateTable
CREATE TABLE "GrantSchedule" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "dueOn" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "GrantSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantPayment" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "scheduleId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "GrantPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantSchedule_grantId_dueOn_idx" ON "GrantSchedule"("grantId", "dueOn");

-- CreateIndex
CREATE INDEX "GrantPayment_grantId_idx" ON "GrantPayment"("grantId");

-- CreateIndex
CREATE INDEX "GrantPayment_transactionId_idx" ON "GrantPayment"("transactionId");

-- CreateIndex
CREATE INDEX "GrantPayment_scheduleId_idx" ON "GrantPayment"("scheduleId");

-- AddForeignKey
ALTER TABLE "GrantSchedule" ADD CONSTRAINT "GrantSchedule_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantPayment" ADD CONSTRAINT "GrantPayment_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantPayment" ADD CONSTRAINT "GrantPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantPayment" ADD CONSTRAINT "GrantPayment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "GrantSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0024, tranche 4.3b. Les garanties sont ici, pas dans l'application.
ALTER TABLE "GrantSchedule" ADD CONSTRAINT "GrantSchedule_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "GrantPayment" ADD CONSTRAINT "GrantPayment_amount_positive" CHECK ("amount" > 0);

-- Ce qu'une transaction a déjà donné à des cotisations ET à des subventions : un encaissement ne se distribue qu'une fois.
CREATE FUNCTION transaction_allocated_total(tx uuid) RETURNS numeric AS $$
    SELECT COALESCE((SELECT SUM("amount") FROM "PaymentAllocation" WHERE "transactionId" = tx AND "cancelledAt" IS NULL), 0)
         + COALESCE((SELECT SUM("amount") FROM "GrantPayment" WHERE "transactionId" = tx AND "cancelledAt" IS NULL), 0);
$$ LANGUAGE sql STABLE;

-- Le plafond des affectations de cotisations tient désormais compte des versements de subvention (même transaction).
CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger AS $$
DECLARE
    tx "Transaction"%ROWTYPE;
    membership_status "MembershipStatus";
    allocated numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une affectation de règlement ne se supprime pas : on l''annule avec un motif';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."transactionId" <> OLD."transactionId" OR NEW."membershipId" <> OLD."membershipId" OR NEW."amount" <> OLD."amount"
            OR NEW."kind" <> OLD."kind" OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."createdAt" <> OLD."createdAt" THEN
            RAISE EXCEPTION 'Une affectation de règlement ne se modifie pas : annulez-la et refaites-la';
        END IF;
        IF OLD."cancelledAt" IS NOT NULL THEN
            RAISE EXCEPTION 'Une affectation annulée ne change plus';
        END IF;
        IF NEW."cancelledAt" IS NULL OR NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) < 3 THEN
            RAISE EXCEPTION 'Une annulation d''affectation a un motif et une date';
        END IF;
        RETURN NEW;
    END IF;

    -- INSERT : verrou sur la transaction pour sérialiser les affectations concurrentes d'un même mouvement.
    SELECT * INTO tx FROM "Transaction" WHERE "id" = NEW."transactionId" FOR UPDATE;
    IF NEW."kind" = 'PAYMENT' AND tx."amount" <= 0 THEN
        RAISE EXCEPTION 'Un règlement s''affecte à un encaissement (montant positif)';
    END IF;
    IF NEW."kind" = 'REFUND' AND tx."amount" >= 0 THEN
        RAISE EXCEPTION 'Un remboursement s''affecte à un décaissement (montant négatif)';
    END IF;
    SELECT "status" INTO membership_status FROM "Membership" WHERE "id" = NEW."membershipId";
    IF membership_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Une adhésion annulée ne reçoit plus de règlement';
    END IF;
    allocated := transaction_allocated_total(NEW."transactionId");
    IF allocated + NEW."amount" > abs(tx."amount") THEN
        RAISE EXCEPTION 'Les affectations dépassent le montant de la transaction (% déjà affecté sur %)', allocated, abs(tx."amount");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION transaction_allocation_check() RETURNS trigger AS $$
DECLARE
    allocated numeric;
BEGIN
    allocated := transaction_allocated_total(NEW."id");
    IF allocated > 0 AND (abs(NEW."amount") < allocated OR sign(NEW."amount") <> sign(OLD."amount")) THEN
        RAISE EXCEPTION 'Cette transaction est affectée à des adhésions ou à des subventions pour % : annulez d''abord les affectations avant de changer son montant', allocated;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Échéancier : seulement pour une subvention accordée (pas encore clôturée), et la somme des échéances ne dépasse jamais le
-- montant accordé. Le verrou de la subvention sérialise les ajouts simultanés.
CREATE FUNCTION grant_schedule_guard() RETURNS trigger AS $$
DECLARE
    target uuid;
    g "Grant"%ROWTYPE;
    planned numeric;
BEGIN
    target := CASE WHEN TG_OP = 'DELETE' THEN OLD."grantId" ELSE NEW."grantId" END;
    IF TG_OP = 'UPDATE' AND NEW."grantId" <> OLD."grantId" THEN
        RAISE EXCEPTION 'Une échéance ne change pas de subvention';
    END IF;
    SELECT * INTO g FROM "Grant" WHERE "id" = target FOR UPDATE;
    IF g."status" <> 'GRANTED' THEN
        RAISE EXCEPTION 'L''échéancier ne se modifie que pour une subvention accordée et pas encore clôturée';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    SELECT COALESCE(SUM("amount"), 0) INTO planned FROM "GrantSchedule"
        WHERE "grantId" = target AND (TG_OP = 'INSERT' OR "id" <> NEW."id");
    IF planned + NEW."amount" > g."grantedAmount" THEN
        RAISE EXCEPTION 'Les échéances dépassent le montant accordé (% déjà prévu sur %)', planned, g."grantedAmount";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GrantSchedule_guard" BEFORE INSERT OR UPDATE OR DELETE ON "GrantSchedule"
    FOR EACH ROW EXECUTE FUNCTION grant_schedule_guard();
CREATE TRIGGER "GrantSchedule_no_truncate" BEFORE TRUNCATE ON "GrantSchedule"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Versement reçu : jamais supprimé ni modifié, seulement annulé avec un motif ; ne se rattache qu'à un encaissement et à une
-- subvention accordée ; sa part, ajoutée à celles des cotisations, ne dépasse pas le montant de la transaction.
CREATE FUNCTION grant_payment_guard() RETURNS trigger AS $$
DECLARE
    tx "Transaction"%ROWTYPE;
    grant_status "GrantStatus";
    schedule_grant uuid;
    allocated numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un versement ne se supprime pas : on l''annule avec un motif';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."grantId" <> OLD."grantId" OR NEW."transactionId" <> OLD."transactionId" OR NEW."scheduleId" IS DISTINCT FROM OLD."scheduleId"
            OR NEW."amount" <> OLD."amount" OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."createdAt" <> OLD."createdAt" THEN
            RAISE EXCEPTION 'Un versement ne se modifie pas : annulez-le et refaites-le';
        END IF;
        IF OLD."cancelledAt" IS NOT NULL THEN
            RAISE EXCEPTION 'Un versement annulé ne change plus';
        END IF;
        IF NEW."cancelledAt" IS NULL OR NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) < 3 THEN
            RAISE EXCEPTION 'Une annulation de versement a un motif et une date';
        END IF;
        SELECT "status" INTO grant_status FROM "Grant" WHERE "id" = NEW."grantId";
        IF grant_status <> 'GRANTED' THEN
            RAISE EXCEPTION 'Cette subvention est clôturée : ses versements ne changent plus';
        END IF;
        RETURN NEW;
    END IF;

    -- INSERT : verrou sur la transaction pour sérialiser les affectations concurrentes d'un même mouvement.
    SELECT * INTO tx FROM "Transaction" WHERE "id" = NEW."transactionId" FOR UPDATE;
    IF tx."amount" <= 0 THEN
        RAISE EXCEPTION 'Un versement de subvention s''affecte à un encaissement (montant positif)';
    END IF;
    SELECT "status" INTO grant_status FROM "Grant" WHERE "id" = NEW."grantId";
    IF grant_status <> 'GRANTED' THEN
        RAISE EXCEPTION 'Seule une subvention accordée, pas encore clôturée, reçoit des versements';
    END IF;
    IF NEW."scheduleId" IS NOT NULL THEN
        SELECT "grantId" INTO schedule_grant FROM "GrantSchedule" WHERE "id" = NEW."scheduleId";
        IF schedule_grant IS DISTINCT FROM NEW."grantId" THEN
            RAISE EXCEPTION 'Cette échéance n''appartient pas à cette subvention';
        END IF;
    END IF;
    allocated := transaction_allocated_total(NEW."transactionId");
    IF allocated + NEW."amount" > tx."amount" THEN
        RAISE EXCEPTION 'Les affectations dépassent le montant de la transaction (% déjà affecté sur %)', allocated, tx."amount";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GrantPayment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "GrantPayment"
    FOR EACH ROW EXECUTE FUNCTION grant_payment_guard();
CREATE TRIGGER "GrantPayment_no_truncate" BEFORE TRUNCATE ON "GrantPayment"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
