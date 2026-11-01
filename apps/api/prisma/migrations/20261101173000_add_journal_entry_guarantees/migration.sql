-- Garanties comptables des écritures, écrites en SQL pour qu'aucun chemin (API, script, autre module) ne les contourne.

-- Lignes : montants positifs, un seul côté renseigné.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amounts_sign" CHECK ("debit" >= 0 AND "credit" >= 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side" CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0));
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_position_positive" CHECK ("position" >= 1);

-- Écritures : un brouillon n'a ni numéro ni date de comptabilisation, une écriture comptabilisée a les deux ;
-- une contrepassation référence son original et inversement.
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_draft_has_no_number" CHECK (
    ("status" = 'DRAFT' AND "number" IS NULL AND "postedAt" IS NULL AND "postedBy" IS NULL)
    OR ("status" <> 'DRAFT' AND "number" IS NOT NULL AND "number" >= 1 AND "postedAt" IS NOT NULL)
);
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversal_link" CHECK (("kind" = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_version_positive" CHECK ("version" >= 1);

-- Compteur : démarre à 1 et n'avance que d'un, jamais supprimé (pas de trou, pas de retour en arrière).
ALTER TABLE "EntryCounter" ADD CONSTRAINT "EntryCounter_positive" CHECK ("lastNumber" >= 1);

CREATE FUNCTION entry_counter_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un compteur de numérotation ne se supprime pas';
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW."lastNumber" <> 1 THEN
            RAISE EXCEPTION 'Un compteur de numérotation démarre à 1';
        END IF;
    ELSIF NEW."lastNumber" <> OLD."lastNumber" + 1
        OR NEW."journalId" <> OLD."journalId"
        OR NEW."fiscalYearId" <> OLD."fiscalYearId" THEN
        RAISE EXCEPTION 'Un compteur de numérotation n''avance que d''un numéro';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EntryCounter_guard" BEFORE INSERT OR UPDATE OR DELETE ON "EntryCounter"
    FOR EACH ROW EXECUTE FUNCTION entry_counter_guard();

CREATE TRIGGER "EntryCounter_no_truncate" BEFORE TRUNCATE ON "EntryCounter"
    FOR EACH STATEMENT EXECUTE FUNCTION entry_counter_guard();

-- Écritures : cycle de vie et comptabilisation atomique.
CREATE FUNCTION journal_entry_guard() RETURNS trigger AS $$
DECLARE
    year_row "FiscalYear"%ROWTYPE;
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
        -- Comptabilisée : seul le passage à « contrepassée » est permis, rien d'autre ne change.
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

    -- Brouillon (création, modification ou comptabilisation) : la date est dans l'exercice.
    SELECT * INTO year_row FROM "FiscalYear" WHERE "id" = NEW."fiscalYearId" FOR SHARE;
    IF NOT FOUND OR NEW."date" < year_row."start" OR NEW."date" > year_row."end" THEN
        RAISE EXCEPTION 'La date de l''écriture est hors de l''exercice';
    END IF;

    IF NEW."status" = 'DRAFT' THEN
        RETURN NEW;
    END IF;

    -- Comptabilisation. Le verrou partagé sur l'exercice (ci-dessus) bloque le passage concurrent à « en cours de
    -- clôture » jusqu'à la fin de cette transaction : résultat cohérent, validée avant la fermeture ou refusée.
    IF NEW."status" <> 'POSTED' THEN
        RAISE EXCEPTION 'Transition d''état d''écriture non permise';
    END IF;
    IF year_row."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'L''exercice n''est pas ouvert';
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

    -- Numéro : incrément sous verrou de ligne, dans cette transaction (un rollback ne laisse aucun trou).
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

CREATE TRIGGER "JournalEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry"
    FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

-- Lignes : modifiables seulement tant que l'écriture est un brouillon.
CREATE FUNCTION journal_line_guard() RETURNS trigger AS $$
DECLARE
    parent_status "EntryStatus";
    parent_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."entryId" <> OLD."entryId" THEN
        RAISE EXCEPTION 'Une ligne ne change pas d''écriture';
    END IF;
    parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
    SELECT "status" INTO parent_status FROM "JournalEntry" WHERE "id" = parent_id FOR SHARE;
    -- Écriture absente : suppression en cascade d'un brouillon déjà retiré.
    IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Les lignes d''une écriture comptabilisée sont immuables';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
    FOR EACH ROW EXECUTE FUNCTION journal_line_guard();

-- Un exercice ne peut plus être raccourci au point d'exclure une écriture qu'il contient.
CREATE OR REPLACE FUNCTION fiscal_year_guard() RETURNS trigger AS $$
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
    IF (NEW."start" <> OLD."start" OR NEW."end" <> OLD."end") AND EXISTS (
        SELECT 1 FROM "JournalEntry" e
        WHERE e."fiscalYearId" = OLD."id" AND (e."date" < NEW."start" OR e."date" > NEW."end")
    ) THEN
        RAISE EXCEPTION 'Ces dates excluraient des écritures de l''exercice';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
