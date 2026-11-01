-- AlterTable
ALTER TABLE "FiscalYear" ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "closedBy" UUID;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "carriesFromId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_carriesFromId_key" ON "JournalEntry"("carriesFromId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_carriesFromId_fkey" FOREIGN KEY ("carriesFromId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un report d'à-nouveaux est une écriture d'ouverture ; un exercice ne se reporte qu'une fois (index unique ci-dessus).
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_carry_is_opening" CHECK ("carriesFromId" IS NULL OR "kind" = 'OPENING');

-- Exercice : l'annulation de la fermeture à la saisie est permise tant que la clôture n'est pas définitive ; le passage
-- à « clôturé » exige l'absence de brouillon, l'exercice précédent clôturé et le report des soldes comptabilisé.
CREATE OR REPLACE FUNCTION fiscal_year_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un exercice ne se supprime pas';
    END IF;
    IF OLD."status" = 'CLOSED' THEN
        RAISE EXCEPTION 'Un exercice clôturé ne se modifie plus';
    END IF;
    IF OLD."status" = 'OPEN' AND NEW."status" = 'CLOSED' THEN
        RAISE EXCEPTION 'Un exercice passe par l''état « en cours de clôture » avant d''être clôturé';
    END IF;
    IF OLD."status" <> 'OPEN' AND NEW."status" <> 'OPEN' AND (NEW."start" <> OLD."start" OR NEW."end" <> OLD."end") THEN
        RAISE EXCEPTION 'Les dates d''un exercice ne changent plus une fois la clôture engagée';
    END IF;
    IF (NEW."start" <> OLD."start" OR NEW."end" <> OLD."end") AND EXISTS (
        SELECT 1 FROM "JournalEntry" e
        WHERE e."fiscalYearId" = OLD."id" AND (e."date" < NEW."start" OR e."date" > NEW."end")
    ) THEN
        RAISE EXCEPTION 'Ces dates excluraient des écritures de l''exercice';
    END IF;

    IF NEW."status" = 'CLOSED' THEN
        IF EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e."fiscalYearId" = OLD."id" AND e."status" = 'DRAFT') THEN
            RAISE EXCEPTION 'Des brouillons subsistent dans l''exercice';
        END IF;
        IF EXISTS (SELECT 1 FROM "FiscalYear" f WHERE f."start" < OLD."start" AND f."status" <> 'CLOSED') THEN
            RAISE EXCEPTION 'Un exercice précédent n''est pas clôturé';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "JournalEntry" e WHERE e."carriesFromId" = OLD."id" AND e."status" = 'POSTED'
        ) THEN
            RAISE EXCEPTION 'Les à-nouveaux de l''exercice suivant ne sont pas comptabilisés';
        END IF;
        IF NEW."closedAt" IS NULL THEN
            NEW."closedAt" := clock_timestamp();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Écritures : un report d'à-nouveaux ne se comptabilise que pendant la clôture de l'exercice reporté, vers l'exercice
-- qui le suit immédiatement, à sa date d'ouverture. Le reste de la fonction est inchangé.
CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger AS $$
DECLARE
    year_row "FiscalYear"%ROWTYPE;
    carried_row "FiscalYear"%ROWTYPE;
    journal_row "Journal"%ROWTYPE;
    original_status "EntryStatus";
    line_count integer;
    total_debit numeric;
    total_credit numeric;
    inactive_account text;
    next_number integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une écriture comptabilisée ne se supprime pas : on la contrepasse';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Une écriture est créée en brouillon, puis comptabilisée';
        END IF;
    ELSIF OLD."status" <> 'DRAFT' THEN
        IF OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED'
            AND ROW(NEW."fiscalYearId", NEW."journalId", NEW."date", NEW."label", NEW."reference", NEW."kind",
                    NEW."number", NEW."postedAt", NEW."postedBy", NEW."reversalOfId", NEW."version")
                IS NOT DISTINCT FROM
                ROW(OLD."fiscalYearId", OLD."journalId", OLD."date", OLD."label", OLD."reference", OLD."kind",
                    OLD."number", OLD."postedAt", OLD."postedBy", OLD."reversalOfId", OLD."version") THEN
            IF NOT EXISTS (
                SELECT 1 FROM "JournalEntry" r WHERE r."reversalOfId" = OLD."id" AND r."status" = 'POSTED'
            ) THEN
                RAISE EXCEPTION 'Une écriture ne passe en « contrepassée » qu''avec sa contrepassation comptabilisée';
            END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Une écriture comptabilisée est immuable : on la contrepasse';
    END IF;

    SELECT * INTO year_row FROM "FiscalYear" WHERE "id" = NEW."fiscalYearId" FOR SHARE;
    IF NOT FOUND OR NEW."date" < year_row."start" OR NEW."date" > year_row."end" THEN
        RAISE EXCEPTION 'La date de l''écriture est hors de l''exercice';
    END IF;

    IF NEW."status" = 'DRAFT' THEN
        RETURN NEW;
    END IF;

    IF NEW."status" <> 'POSTED' THEN
        RAISE EXCEPTION 'Transition d''état d''écriture non permise';
    END IF;
    IF year_row."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'L''exercice n''est pas ouvert';
    END IF;

    IF NEW."carriesFromId" IS NOT NULL THEN
        SELECT * INTO carried_row FROM "FiscalYear" WHERE "id" = NEW."carriesFromId";
        IF carried_row."status" <> 'CLOSING' THEN
            RAISE EXCEPTION 'Les à-nouveaux ne se reportent que pendant la clôture de l''exercice précédent';
        END IF;
        IF NEW."date" <> year_row."start" OR carried_row."end" + 1 <> year_row."start" THEN
            RAISE EXCEPTION 'Les à-nouveaux sont datés du premier jour de l''exercice qui suit immédiatement';
        END IF;
    END IF;

    SELECT * INTO journal_row FROM "Journal" WHERE "id" = NEW."journalId";
    IF NOT journal_row."active" THEN
        RAISE EXCEPTION 'Le journal est désactivé';
    END IF;

    SELECT count(*), COALESCE(sum("debit"), 0), COALESCE(sum("credit"), 0)
        INTO line_count, total_debit, total_credit
        FROM "JournalLine" WHERE "entryId" = NEW."id";
    IF line_count < 2 THEN
        RAISE EXCEPTION 'Une écriture comporte au moins deux lignes';
    END IF;
    IF total_debit <> total_credit THEN
        RAISE EXCEPTION 'Écriture déséquilibrée : débit %, crédit %', total_debit, total_credit;
    END IF;

    SELECT a."number" INTO inactive_account
        FROM "JournalLine" l JOIN "Account" a ON a."id" = l."accountId"
        WHERE l."entryId" = NEW."id" AND NOT a."active" LIMIT 1;
    IF inactive_account IS NOT NULL THEN
        RAISE EXCEPTION 'Le compte % est désactivé', inactive_account;
    END IF;

    IF NEW."reversalOfId" IS NOT NULL THEN
        SELECT "status" INTO original_status FROM "JournalEntry" WHERE "id" = NEW."reversalOfId" FOR UPDATE;
        IF original_status IS DISTINCT FROM 'POSTED' THEN
            RAISE EXCEPTION 'Seule une écriture comptabilisée et non contrepassée peut l''être';
        END IF;
    END IF;

    INSERT INTO "EntryCounter" ("journalId", "fiscalYearId", "lastNumber")
        VALUES (NEW."journalId", NEW."fiscalYearId", 1)
        ON CONFLICT ("journalId", "fiscalYearId")
        DO UPDATE SET "lastNumber" = "EntryCounter"."lastNumber" + 1
        RETURNING "lastNumber" INTO next_number;
    NEW."number" := next_number;
    NEW."postedAt" := clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
