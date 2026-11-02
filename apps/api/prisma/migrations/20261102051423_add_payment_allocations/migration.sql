-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "kind" "AllocationKind" NOT NULL DEFAULT 'PAYMENT',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAllocation_transactionId_idx" ON "PaymentAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_membershipId_idx" ON "PaymentAllocation"("membershipId");

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0023, tranche 3.3 : affectations de règlement. Les garanties sont ici, pas dans l'application.
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_positive" CHECK ("amount" > 0);

CREATE FUNCTION payment_allocation_guard() RETURNS trigger AS $$
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
    SELECT COALESCE(SUM("amount"), 0) INTO allocated FROM "PaymentAllocation"
        WHERE "transactionId" = NEW."transactionId" AND "cancelledAt" IS NULL;
    IF allocated + NEW."amount" > abs(tx."amount") THEN
        RAISE EXCEPTION 'Les affectations dépassent le montant de la transaction (% déjà affecté sur %)', allocated, abs(tx."amount");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PaymentAllocation"
    FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();
CREATE TRIGGER "PaymentAllocation_no_truncate" BEFORE TRUNCATE ON "PaymentAllocation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Une transaction affectée garde un montant qui couvre ses affectations actives et son sens (encaissement ou décaissement).
CREATE FUNCTION transaction_allocation_check() RETURNS trigger AS $$
DECLARE
    allocated numeric;
BEGIN
    SELECT COALESCE(SUM("amount"), 0) INTO allocated FROM "PaymentAllocation"
        WHERE "transactionId" = NEW."id" AND "cancelledAt" IS NULL;
    IF allocated > 0 AND (abs(NEW."amount") < allocated OR sign(NEW."amount") <> sign(OLD."amount")) THEN
        RAISE EXCEPTION 'Cette transaction est affectée à des adhésions pour % : annulez d''abord les affectations avant de changer son montant', allocated;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_allocation_check" BEFORE UPDATE OF "amount" ON "Transaction"
    FOR EACH ROW WHEN (NEW."amount" <> OLD."amount")
    EXECUTE FUNCTION transaction_allocation_check();
