-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'FORMER');

-- CreateTable
CREATE TABLE "MemberCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "MemberCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "categoryId" UUID,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedOn" DATE,
    "leftOn" DATE,
    "userId" UUID,
    "note" TEXT,
    "anonymizedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberOffice" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "MemberOffice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberCategory_name_key" ON "MemberCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_lastName_firstName_idx" ON "Member"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "MemberOffice_memberId_idx" ON "MemberOffice"("memberId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MemberCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberOffice" ADD CONSTRAINT "MemberOffice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0023, tranche 3.1 : membres. Les garanties sont ici, pas dans l'application.

-- Un membre ne se supprime jamais : l'historique des adhésions et des règlements s'y réfère.
CREATE FUNCTION member_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un membre ne se supprime pas : on le marque sorti, puis on peut l''anonymiser';
    END IF;
    IF NEW."leftOn" IS NOT NULL AND NEW."joinedOn" IS NOT NULL AND NEW."leftOn" < NEW."joinedOn" THEN
        RAISE EXCEPTION 'La date de sortie précède la date d''entrée';
    END IF;
    IF NEW."status" = 'FORMER' AND NEW."leftOn" IS NULL THEN
        RAISE EXCEPTION 'Un membre sorti a une date de sortie';
    END IF;
    IF NEW."status" = 'ACTIVE' AND NEW."leftOn" IS NOT NULL THEN
        RAISE EXCEPTION 'Un membre actif n''a pas de date de sortie';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."anonymizedAt" IS NOT NULL THEN
        IF NEW."anonymizedAt" IS NULL THEN
            RAISE EXCEPTION 'L''anonymisation d''un membre est irréversible';
        END IF;
        IF NEW."firstName" <> OLD."firstName" OR NEW."lastName" <> OLD."lastName" OR NEW."email" IS DISTINCT FROM OLD."email"
            OR NEW."phone" IS DISTINCT FROM OLD."phone" OR NEW."addressLine" IS DISTINCT FROM OLD."addressLine"
            OR NEW."note" IS DISTINCT FROM OLD."note" THEN
            RAISE EXCEPTION 'Un membre anonymisé ne reçoit plus de données personnelles';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."anonymizedAt" IS NOT NULL AND OLD."anonymizedAt" IS NULL AND OLD."status" <> 'FORMER' THEN
        RAISE EXCEPTION 'Seul un membre sorti peut être anonymisé';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Member_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Member"
    FOR EACH ROW EXECUTE FUNCTION member_guard();
CREATE TRIGGER "Member_no_truncate" BEFORE TRUNCATE ON "Member"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Un email n'existe qu'une fois parmi les membres non anonymisés (insensible à la casse).
CREATE UNIQUE INDEX "Member_email_unique" ON "Member"(lower("email")) WHERE "email" IS NOT NULL AND "anonymizedAt" IS NULL;

-- Un mandat finit après avoir commencé.
ALTER TABLE "MemberOffice" ADD CONSTRAINT "MemberOffice_period_valid" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");

-- Une catégorie utilisée ne se supprime pas (clé étrangère) ; elle se désactive.
