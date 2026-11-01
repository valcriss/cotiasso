-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('BANK', 'CASH', 'PURCHASES', 'REVENUE', 'MISC', 'OPENING');

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "JournalType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reportLine" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Journal_code_key" ON "Journal"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_number_key" ON "Account"("number");

-- Exercice : dates cohérentes, aucun chevauchement (bornes incluses), jamais supprimé.
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_dates_order" CHECK ("start" <= "end");
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_no_overlap"
    EXCLUDE USING gist (daterange("start", "end", '[]') WITH &&);

CREATE FUNCTION fiscal_year_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un exercice ne se supprime pas';
    END IF;
    IF OLD."status" = 'CLOSED' THEN
        RAISE EXCEPTION 'Un exercice clôturé ne se modifie plus';
    END IF;
    IF OLD."status" = 'CLOSING' AND NEW."status" = 'OPEN' THEN
        RAISE EXCEPTION 'Un exercice en cours de clôture ne se rouvre pas ici';
    END IF;
    IF OLD."status" = 'OPEN' AND NEW."status" = 'CLOSED' THEN
        RAISE EXCEPTION 'Un exercice passe par l''état « en cours de clôture » avant d''être clôturé';
    END IF;
    IF OLD."status" <> 'OPEN' AND (NEW."start" <> OLD."start" OR NEW."end" <> OLD."end") THEN
        RAISE EXCEPTION 'Les dates d''un exercice ne changent plus une fois la clôture engagée';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FiscalYear_guard" BEFORE UPDATE OR DELETE ON "FiscalYear"
    FOR EACH ROW EXECUTE FUNCTION fiscal_year_guard();

-- Journal : code lisible et stable, jamais supprimé.
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_code_format" CHECK ("code" ~ '^[A-Z0-9-]{1,10}$');
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_label_not_blank" CHECK (btrim("label") <> '');

CREATE FUNCTION journal_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un journal ne se supprime pas : on le désactive';
    END IF;
    IF NEW."code" <> OLD."code" OR NEW."type" <> OLD."type" THEN
        RAISE EXCEPTION 'Le code et le type d''un journal ne changent pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Journal_guard" BEFORE UPDATE OR DELETE ON "Journal"
    FOR EACH ROW EXECUTE FUNCTION journal_guard();

-- Compte : numéro de 3 à 8 chiffres (classes 1 à 8), définitif, jamais supprimé.
ALTER TABLE "Account" ADD CONSTRAINT "Account_number_format" CHECK ("number" ~ '^[1-8][0-9]{2,7}$');
ALTER TABLE "Account" ADD CONSTRAINT "Account_label_not_blank" CHECK (btrim("label") <> '');

CREATE FUNCTION account_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un compte ne se supprime pas : on le désactive';
    END IF;
    IF NEW."number" <> OLD."number" THEN
        RAISE EXCEPTION 'Le numéro d''un compte ne change pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Account_guard" BEFORE UPDATE OR DELETE ON "Account"
    FOR EACH ROW EXECUTE FUNCTION account_guard();

-- Journaux de départ, sans lien avec un compte financier (BQ-n et CA arrivent avec les comptes financiers).
INSERT INTO "Journal" ("id", "code", "label", "type") VALUES
    (gen_random_uuid(), 'AC', 'Achats', 'PURCHASES'),
    (gen_random_uuid(), 'PR', 'Produits', 'REVENUE'),
    (gen_random_uuid(), 'OD', 'Opérations diverses', 'MISC'),
    (gen_random_uuid(), 'AN', 'À-nouveaux', 'OPENING');
