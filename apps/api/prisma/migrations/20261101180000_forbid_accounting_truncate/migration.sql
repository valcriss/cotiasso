-- TRUNCATE contourne les déclencheurs de ligne : sans protection, il vide un compteur de numérotation (et fait
-- réattribuer des numéros déjà utilisés) ou efface des écritures comptabilisées. Les tables comptables le refusent.
CREATE FUNCTION accounting_forbid_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% ne se vide pas : TRUNCATE refusé', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FiscalYear_no_truncate" BEFORE TRUNCATE ON "FiscalYear"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
CREATE TRIGGER "Journal_no_truncate" BEFORE TRUNCATE ON "Journal"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
CREATE TRIGGER "Account_no_truncate" BEFORE TRUNCATE ON "Account"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
CREATE TRIGGER "JournalEntry_no_truncate" BEFORE TRUNCATE ON "JournalEntry"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
CREATE TRIGGER "JournalLine_no_truncate" BEFORE TRUNCATE ON "JournalLine"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();

-- Le déclencheur de TRUNCATE du compteur appelait la fonction de ligne, qui ne refusait rien dans ce cas.
DROP TRIGGER "EntryCounter_no_truncate" ON "EntryCounter";
CREATE TRIGGER "EntryCounter_no_truncate" BEFORE TRUNCATE ON "EntryCounter"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
