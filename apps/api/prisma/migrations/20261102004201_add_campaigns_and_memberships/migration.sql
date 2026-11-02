-- CreateEnum
CREATE TYPE "MembershipMode" AS ENUM ('PAYMENT', 'VALIDATION', 'START_DATE');

-- CreateEnum
CREATE TYPE "MembershipOrigin" AS ENUM ('PAYMENT', 'VALIDATION', 'START_DATE', 'EXEMPTION');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'EFFECTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "effectiveMode" "MembershipMode" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "categoryId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "tariffId" UUID,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "exemptionReason" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveOn" DATE,
    "effectiveOrigin" "MembershipOrigin",
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_campaignId_label_key" ON "Tariff"("campaignId", "label");

-- CreateIndex
CREATE INDEX "Membership_campaignId_idx" ON "Membership"("campaignId");

-- CreateIndex
CREATE INDEX "Membership_memberId_idx" ON "Membership"("memberId");

-- AddForeignKey
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MemberCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0023, tranche 3.2 : campagnes, tarifs et adhésions. Les garanties sont ici, pas dans l'application.

-- Deux campagnes ne se chevauchent pas ; une campagne finit après avoir commencé.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_period_valid" CHECK ("endsOn" >= "startsOn");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_no_overlap"
    EXCLUDE USING gist (daterange("startsOn", "endsOn", '[]') WITH &&);
ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_amount_positive" CHECK ("amount" >= 0);
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_amount_positive" CHECK ("expectedAmount" >= 0);

-- Une seule adhésion non annulée par membre et par campagne.
CREATE UNIQUE INDEX "Membership_one_active" ON "Membership"("campaignId", "memberId") WHERE "status" <> 'CANCELLED';

-- Campagne : un mode d'adhésion effective et des dates figés dès qu'une adhésion existe ; jamais supprimée.
CREATE FUNCTION campaign_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une campagne ne se supprime pas';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."startsOn" <> OLD."startsOn" OR NEW."endsOn" <> OLD."endsOn" OR NEW."effectiveMode" <> OLD."effectiveMode")
        AND EXISTS (SELECT 1 FROM "Membership" WHERE "campaignId" = OLD."id") THEN
        RAISE EXCEPTION 'Les dates et le mode d''adhésion d''une campagne ne changent plus dès qu''une adhésion existe';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Campaign_guard" BEFORE UPDATE OR DELETE ON "Campaign"
    FOR EACH ROW EXECUTE FUNCTION campaign_guard();
CREATE TRIGGER "Campaign_no_truncate" BEFORE TRUNCATE ON "Campaign"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Adhésion : montant attendu, membre et campagne figés ; états en attente → effective → annulée ; annulée est définitif ;
-- une adhésion effective a sa date et son origine, une annulée son motif.
CREATE FUNCTION membership_guard() RETURNS trigger AS $$
DECLARE
    campaign_row "Campaign"%ROWTYPE;
    member_row "Member"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une adhésion ne se supprime pas : on l''annule avec un motif';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO member_row FROM "Member" WHERE "id" = NEW."memberId";
        IF member_row."status" <> 'ACTIVE' OR member_row."anonymizedAt" IS NOT NULL THEN
            RAISE EXCEPTION 'Une adhésion se crée pour un membre actuel';
        END IF;
        IF NEW."status" = 'CANCELLED' THEN
            RAISE EXCEPTION 'Une adhésion ne naît pas annulée';
        END IF;
    ELSE
        IF NEW."campaignId" <> OLD."campaignId" OR NEW."memberId" <> OLD."memberId" OR NEW."expectedAmount" <> OLD."expectedAmount"
            OR NEW."tariffId" IS DISTINCT FROM OLD."tariffId" THEN
            RAISE EXCEPTION 'Le membre, la campagne, le tarif et le montant attendu d''une adhésion ne changent pas';
        END IF;
        IF OLD."status" = 'CANCELLED' THEN
            RAISE EXCEPTION 'Une adhésion annulée ne change plus';
        END IF;
        IF OLD."status" = 'EFFECTIVE' AND NEW."status" = 'PENDING' AND OLD."effectiveOrigin" <> 'PAYMENT' THEN
            RAISE EXCEPTION 'Seule une adhésion devenue effective par un règlement redevient en attente (si ce règlement est annulé)';
        END IF;
    END IF;
    IF NEW."status" = 'EFFECTIVE' THEN
        IF NEW."effectiveOn" IS NULL OR NEW."effectiveOrigin" IS NULL THEN
            RAISE EXCEPTION 'Une adhésion effective a sa date d''effet et son origine';
        END IF;
        SELECT * INTO campaign_row FROM "Campaign" WHERE "id" = NEW."campaignId";
        IF NEW."effectiveOn" < campaign_row."startsOn" OR NEW."effectiveOn" > campaign_row."endsOn" THEN
            RAISE EXCEPTION 'La date d''effet doit tomber dans la campagne';
        END IF;
    ELSIF NEW."effectiveOn" IS NOT NULL OR NEW."effectiveOrigin" IS NOT NULL THEN
        RAISE EXCEPTION 'Seule une adhésion effective a une date d''effet';
    END IF;
    IF NEW."status" = 'CANCELLED' AND (NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) < 3 OR NEW."cancelledAt" IS NULL) THEN
        RAISE EXCEPTION 'Une annulation a un motif et une date';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Membership_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Membership"
    FOR EACH ROW EXECUTE FUNCTION membership_guard();
CREATE TRIGGER "Membership_no_truncate" BEFORE TRUNCATE ON "Membership"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
