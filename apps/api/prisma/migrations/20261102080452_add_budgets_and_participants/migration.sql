-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BudgetLineKind" AS ENUM ('CHARGE', 'PRODUCT');

-- CreateTable
CREATE TABLE "ProjectParticipant" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "memberId" UUID,
    "userId" UUID,
    "role" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "ProjectParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMPTZ(3),
    "approvedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "kind" "BudgetLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "accountId" UUID,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectParticipant_projectId_idx" ON "ProjectParticipant"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersion_projectId_number_key" ON "BudgetVersion"("projectId", "number");

-- CreateIndex
CREATE INDEX "BudgetLine_budgetId_idx" ON "BudgetLine"("budgetId");

-- AddForeignKey
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Participants : un membre OU un utilisateur, dates cohérentes, rôle renseigné. Information seulement (aucun droit).
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_one_person"
    CHECK (("memberId" IS NOT NULL AND "userId" IS NULL) OR ("memberId" IS NULL AND "userId" IS NOT NULL));
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_role_not_blank" CHECK (btrim("role") <> '');
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_dates_order"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
CREATE TRIGGER "ProjectParticipant_no_truncate" BEFORE TRUNCATE ON "ProjectParticipant"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Budget : une seule version approuvée par projet ; numéros positifs ; libellé renseigné.
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_number_positive" CHECK ("number" > 0);
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_approval_consistent"
    CHECK (("status" = 'DRAFT' AND "approvedAt" IS NULL) OR ("status" <> 'DRAFT' AND "approvedAt" IS NOT NULL));
CREATE UNIQUE INDEX "BudgetVersion_one_approved" ON "BudgetVersion" ("projectId") WHERE "status" = 'APPROVED';

ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_period_order" CHECK ("periodStart" <= "periodEnd");

-- Version de budget : seul un brouillon se supprime ou se modifie ; le statut n'avance que dans le sens
-- brouillon → approuvé → remplacé ; on n'approuve pas un budget sans ligne ; projet et numéro sont définitifs.
CREATE FUNCTION budget_version_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une version de budget approuvée ne se supprime pas';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."projectId" <> OLD."projectId" OR NEW."number" <> OLD."number" THEN
        RAISE EXCEPTION 'Le projet et le numéro d''une version de budget sont définitifs';
    END IF;
    IF OLD."status" <> 'DRAFT' AND (NEW."label" <> OLD."label" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
        OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy") THEN
        RAISE EXCEPTION 'Une version de budget approuvée ne se modifie plus : créez une nouvelle version';
    END IF;
    IF NEW."status" <> OLD."status" THEN
        IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'APPROVED')
                OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')) THEN
            RAISE EXCEPTION 'Une version de budget ne revient pas en arrière';
        END IF;
        IF NEW."status" = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM "BudgetLine" WHERE "budgetId" = NEW."id") THEN
            RAISE EXCEPTION 'Un budget sans ligne ne s''approuve pas';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BudgetVersion_guard" BEFORE UPDATE OR DELETE ON "BudgetVersion"
    FOR EACH ROW EXECUTE FUNCTION budget_version_guard();
CREATE TRIGGER "BudgetVersion_no_truncate" BEFORE TRUNCATE ON "BudgetVersion"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Ligne de budget : modifiable seulement tant que la version est un brouillon (la suppression en cascade d'un
-- brouillon passe : son parent a déjà disparu) ; une charge vise un compte de classe 6, un produit un compte de classe 7.
CREATE FUNCTION budget_line_guard() RETURNS trigger AS $$
DECLARE
    parent_status "BudgetStatus";
    target_id uuid;
    account_number text;
BEGIN
    target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."budgetId" ELSE NEW."budgetId" END;
    IF TG_OP = 'UPDATE' AND NEW."budgetId" <> OLD."budgetId" THEN
        RAISE EXCEPTION 'Une ligne de budget ne change pas de version';
    END IF;
    SELECT "status" INTO parent_status FROM "BudgetVersion" WHERE "id" = target_id;
    IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Les lignes d''une version de budget approuvée ne se modifient plus : créez une nouvelle version';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF NEW."accountId" IS NOT NULL THEN
        SELECT "number" INTO account_number FROM "Account" WHERE "id" = NEW."accountId";
        IF (NEW."kind" = 'CHARGE' AND left(account_number, 1) <> '6')
           OR (NEW."kind" = 'PRODUCT' AND left(account_number, 1) <> '7') THEN
            RAISE EXCEPTION 'Une charge de budget vise un compte de classe 6, un produit un compte de classe 7';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BudgetLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BudgetLine"
    FOR EACH ROW EXECUTE FUNCTION budget_line_guard();
CREATE TRIGGER "BudgetLine_no_truncate" BEFORE TRUNCATE ON "BudgetLine"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Un seul brouillon à la fois par projet : pas de budgets parallèles qui se contredisent.
CREATE UNIQUE INDEX "BudgetVersion_one_draft" ON "BudgetVersion" ("projectId") WHERE "status" = 'DRAFT';
