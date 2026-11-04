
-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('DRAFT', 'IN_CIRCUIT', 'RETURNED', 'REFUSED', 'CANCELLED', 'PAID');

-- CreateTable
CREATE TABLE "ReimbursementRequest" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "projectId" UUID,
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedSnapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReimbursementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementPayment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "ReimbursementPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementRequest_number_key" ON "ReimbursementRequest"("number");

-- CreateIndex
CREATE INDEX "ReimbursementRequest_requesterUserId_idx" ON "ReimbursementRequest"("requesterUserId");

-- CreateIndex
CREATE INDEX "ReimbursementRequest_status_idx" ON "ReimbursementRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementPayment_requestId_key" ON "ReimbursementPayment"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementPayment_transactionId_key" ON "ReimbursementPayment"("transactionId");

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementPayment" ADD CONSTRAINT "ReimbursementPayment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReimbursementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementPayment" ADD CONSTRAINT "ReimbursementPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ADR 0035, tranche 2 : demandes de remboursement. Les garanties sont ici, pas dans l'application.

ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_reason_present" CHECK (length(btrim("reason")) >= 3);

-- Une demande se supprime seulement en brouillon. Montant, date, motif et projet ne changent que tant que la demande
-- est en brouillon ou à corriger : une fois déposée, elle est figée devant ceux qui l'ont acceptée. Le statut n'avance
-- que dans les sens permis, et une demande terminée ne change plus.
CREATE FUNCTION reimbursement_request_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une demande de remboursement commence en brouillon';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une demande de remboursement déposée ne se supprime pas : annulez-la';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."number" <> OLD."number" OR NEW."requesterUserId" <> OLD."requesterUserId"
        OR NEW."memberId" <> OLD."memberId" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'Le demandeur et le numéro d''une demande ne changent pas';
    END IF;
    IF OLD."status" IN ('REFUSED', 'CANCELLED', 'PAID') THEN
        RAISE EXCEPTION 'Cette demande est terminée : elle ne change plus';
    END IF;
    IF NEW."amount" <> OLD."amount" OR NEW."expenseDate" <> OLD."expenseDate" OR NEW."reason" <> OLD."reason"
        OR NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
        IF OLD."status" NOT IN ('DRAFT', 'RETURNED') OR NEW."status" <> OLD."status" THEN
            RAISE EXCEPTION 'Une demande déposée ne se modifie pas : renvoyez-la pour correction ou annulez-la';
        END IF;
    END IF;
    IF NEW."status" <> OLD."status" THEN
        IF NOT (
            (OLD."status" = 'DRAFT' AND NEW."status" = 'IN_CIRCUIT')
            OR (OLD."status" = 'IN_CIRCUIT' AND NEW."status" IN ('RETURNED', 'REFUSED', 'CANCELLED', 'PAID'))
            OR (OLD."status" = 'RETURNED' AND NEW."status" IN ('IN_CIRCUIT', 'CANCELLED'))
        ) THEN
            RAISE EXCEPTION 'Cette demande ne peut pas passer de % à %', OLD."status", NEW."status";
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReimbursementRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ReimbursementRequest"
    FOR EACH ROW EXECUTE FUNCTION reimbursement_request_guard();
CREATE TRIGGER "ReimbursementRequest_no_truncate" BEFORE TRUNCATE ON "ReimbursementRequest"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Le remboursement est une sortie d'argent du même montant que la demande, et il n'y en a qu'un : un mouvement
-- bancaire ne rembourse qu'une demande (index unique) et une demande n'est remboursée qu'une fois.
CREATE FUNCTION reimbursement_payment_guard() RETURNS trigger AS $$
DECLARE
    request_row "ReimbursementRequest"%ROWTYPE;
    movement numeric;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Un remboursement enregistré ne se modifie ni ne se supprime';
    END IF;
    SELECT * INTO request_row FROM "ReimbursementRequest" WHERE "id" = NEW."requestId";
    IF request_row."status" IS DISTINCT FROM 'PAID' THEN
        RAISE EXCEPTION 'Le remboursement s''enregistre quand la demande passe à remboursée';
    END IF;
    SELECT "amount" INTO movement FROM "Transaction" WHERE "id" = NEW."transactionId";
    IF movement IS NULL OR movement <> -request_row."amount" THEN
        RAISE EXCEPTION 'Le mouvement bancaire doit être une sortie d''argent du même montant que la demande';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReimbursementPayment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ReimbursementPayment"
    FOR EACH ROW EXECUTE FUNCTION reimbursement_payment_guard();
CREATE TRIGGER "ReimbursementPayment_no_truncate" BEFORE TRUNCATE ON "ReimbursementPayment"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Une demande « remboursée » a son remboursement, vérifié à la fin de la transaction (le statut est posé avant le paiement).
CREATE FUNCTION reimbursement_paid_check() RETURNS trigger AS $$
BEGIN
    IF NEW."status" = 'PAID' AND NOT EXISTS (SELECT 1 FROM "ReimbursementPayment" WHERE "requestId" = NEW."id") THEN
        RAISE EXCEPTION 'Une demande n''est remboursée qu''avec son remboursement enregistré';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ReimbursementRequest_paid_check" AFTER INSERT OR UPDATE ON "ReimbursementRequest"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reimbursement_paid_check();

-- Nouveaux droits pour les installations existantes : les rôles modèles ne sont jamais réécrits au démarrage, on ajoute
-- ici, une fois, les droits aux rôles modèles du président et du trésorier (sans toucher à ce que l'association a réglé),
-- et le droit de consulter les circuits à ceux qui peuvent déjà les régler.
UPDATE "Role" SET "permissions" = array_append("permissions", 'reimbursements:create')
WHERE "key" IN ('president', 'treasurer', 'board-member', 'project-manager', 'contributor') AND NOT ('reimbursements:create' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'reimbursements:view')
WHERE "key" IN ('president', 'treasurer') AND NOT ('reimbursements:view' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'workflows:view')
WHERE 'workflows:admin' = ANY("permissions") AND NOT ('workflows:view' = ANY("permissions"));
