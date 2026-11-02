-- CreateEnum
CREATE TYPE "FrozenReportKind" AS ENUM ('CLOSING', 'CLOSED', 'MANUAL');

-- CreateTable
CREATE TABLE "FrozenReportSet" (
    "id" UUID NOT NULL,
    "fiscalYearId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "FrozenReportKind" NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "label" TEXT NOT NULL,
    "reason" TEXT,
    "supersedesId" UUID,
    "calcVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "FrozenReportSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrozenReportApproval" (
    "id" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "meetingDate" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,

    CONSTRAINT "FrozenReportApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FrozenReportSet_fiscalYearId_number_key" ON "FrozenReportSet"("fiscalYearId", "number");
CREATE UNIQUE INDEX "FrozenReportApproval_setId_key" ON "FrozenReportApproval"("setId");

-- AddForeignKey
ALTER TABLE "FrozenReportSet" ADD CONSTRAINT "FrozenReportSet_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrozenReportSet" ADD CONSTRAINT "FrozenReportSet_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "FrozenReportSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrozenReportApproval" ADD CONSTRAINT "FrozenReportApproval_setId_fkey" FOREIGN KEY ("setId") REFERENCES "FrozenReportSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR 0031 : rapports figés. Un jeu enregistré ne change plus jamais ; les garanties sont ici, pas dans l'application.
CREATE FUNCTION frozen_report_set_guard() RETURNS trigger AS $$
DECLARE
    year_status "FiscalYearStatus";
    last_number integer;
    last_id uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Un jeu de rapports figé ne se modifie ni ne se supprime : figez une nouvelle version.';
    END IF;

    -- Deux figements simultanés d'un même exercice s'attendent : la numérotation reste sans trou ni doublon.
    PERFORM pg_advisory_xact_lock(hashtext('FrozenReportSet'), hashtext(NEW."fiscalYearId"::text));
    SELECT "status" INTO year_status FROM "FiscalYear" WHERE "id" = NEW."fiscalYearId";

    SELECT "number", "id" INTO last_number, last_id
    FROM "FrozenReportSet" WHERE "fiscalYearId" = NEW."fiscalYearId" ORDER BY "number" DESC LIMIT 1;
    IF NEW."number" <> COALESCE(last_number, 0) + 1 THEN
        RAISE EXCEPTION 'Numéro de version inattendu : une autre version a été figée entre-temps. Actualisez puis réessayez.';
    END IF;
    IF NEW."supersedesId" IS DISTINCT FROM last_id THEN
        RAISE EXCEPTION 'Une nouvelle version remplace la version précédente de l''exercice, et elle seule.';
    END IF;

    IF NEW."provisional" <> (year_status <> 'CLOSED') THEN
        RAISE EXCEPTION 'Un jeu est provisoire tant que l''exercice n''est pas clôturé, définitif ensuite.';
    END IF;
    IF NEW."kind" = 'CLOSING' AND year_status <> 'CLOSING' THEN
        RAISE EXCEPTION 'L''arrêté de fermeture se fige quand l''exercice est fermé à la saisie.';
    END IF;
    IF NEW."kind" = 'CLOSED' AND year_status <> 'CLOSED' THEN
        RAISE EXCEPTION 'Le jeu de clôture se fige quand l''exercice est clôturé.';
    END IF;
    IF NEW."number" > 1 AND NEW."kind" = 'MANUAL' AND COALESCE(length(btrim(NEW."reason")), 0) < 5 THEN
        RAISE EXCEPTION 'Une nouvelle version demande un motif (5 caractères au moins) : pourquoi refaire ces rapports ?';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FrozenReportSet_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FrozenReportSet"
    FOR EACH ROW EXECUTE FUNCTION frozen_report_set_guard();
CREATE TRIGGER "FrozenReportSet_no_truncate" BEFORE TRUNCATE ON "FrozenReportSet"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- L'approbation par l'assemblée générale est distincte de la clôture technique : elle porte sur un jeu définitif et
-- encore valable (le plus récent de son exercice), ne se corrige pas et ne se retire pas.
CREATE FUNCTION frozen_report_approval_guard() RETURNS trigger AS $$
DECLARE
    target "FrozenReportSet"%ROWTYPE;
    newest integer;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Une approbation ne se modifie ni ne se retire.';
    END IF;
    SELECT * INTO target FROM "FrozenReportSet" WHERE "id" = NEW."setId";
    IF target."provisional" THEN
        RAISE EXCEPTION 'Seuls des rapports définitifs (exercice clôturé) peuvent être approuvés par l''assemblée générale.';
    END IF;
    SELECT max("number") INTO newest FROM "FrozenReportSet" WHERE "fiscalYearId" = target."fiscalYearId";
    IF target."number" <> newest THEN
        RAISE EXCEPTION 'Ces rapports ont été remplacés par une version plus récente : approuvez la dernière version.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FrozenReportApproval_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FrozenReportApproval"
    FOR EACH ROW EXECUTE FUNCTION frozen_report_approval_guard();
CREATE TRIGGER "FrozenReportApproval_no_truncate" BEFORE TRUNCATE ON "FrozenReportApproval"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
