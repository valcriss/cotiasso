-- CreateEnum
CREATE TYPE "ThirdPartyKind" AS ENUM ('MEMBER', 'FUNDER', 'SUPPLIER', 'OTHER');

-- CreateTable
CREATE TABLE "ThirdParty" (
    "id" UUID NOT NULL,
    "kind" "ThirdPartyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "memberId" UUID,
    "funderId" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "ThirdParty_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN "thirdPartyId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ThirdParty_memberId_key" ON "ThirdParty"("memberId");
CREATE UNIQUE INDEX "ThirdParty_funderId_key" ON "ThirdParty"("funderId");
CREATE INDEX "JournalLine_thirdPartyId_idx" ON "JournalLine"("thirdPartyId");

-- AddForeignKey
ALTER TABLE "ThirdParty" ADD CONSTRAINT "ThirdParty_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ThirdParty" ADD CONSTRAINT "ThirdParty_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "ThirdParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0030 : tiers. Les garanties sont ici, pas dans l'application.
-- Un tiers fournisseur ou autre a un nom unique (sans tenir compte de la casse) ; un adhérent ou un financeur n'a qu'une fiche.
CREATE UNIQUE INDEX "ThirdParty_name_unique" ON "ThirdParty" (lower("name")) WHERE "kind" IN ('SUPPLIER', 'OTHER');

ALTER TABLE "ThirdParty" ADD CONSTRAINT "ThirdParty_kind_consistent" CHECK (
    ("kind" = 'MEMBER'   AND "memberId" IS NOT NULL AND "funderId" IS NULL)
 OR ("kind" = 'FUNDER'   AND "funderId" IS NOT NULL AND "memberId" IS NULL)
 OR ("kind" IN ('SUPPLIER', 'OTHER') AND "memberId" IS NULL AND "funderId" IS NULL)
);

CREATE FUNCTION third_party_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un tiers ne se supprime pas : archivez-le (il reste lisible dans les écritures déjà saisies).';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."kind" <> OLD."kind" OR NEW."memberId" IS DISTINCT FROM OLD."memberId" OR NEW."funderId" IS DISTINCT FROM OLD."funderId" THEN
            RAISE EXCEPTION 'Le type d''un tiers et son lien avec un adhérent ou un financeur ne changent pas.';
        END IF;
        IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
            RAISE EXCEPTION 'Un tiers archivé ne se réactive pas : créez-en un nouveau si besoin.';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ThirdParty_guard" BEFORE UPDATE OR DELETE ON "ThirdParty"
    FOR EACH ROW EXECUTE FUNCTION third_party_guard();
CREATE TRIGGER "ThirdParty_no_truncate" BEFORE TRUNCATE ON "ThirdParty"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
