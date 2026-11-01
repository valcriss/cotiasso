-- Un exercice clôturé n'accepte plus aucune saisie, pas même un brouillon qui ne pourrait jamais être comptabilisé.
CREATE FUNCTION journal_entry_closed_year_guard() RETURNS trigger AS $$
BEGIN
    IF NEW."status" = 'DRAFT' AND EXISTS (
        SELECT 1 FROM "FiscalYear" f WHERE f."id" = NEW."fiscalYearId" AND f."status" = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'Aucune saisie dans un exercice clôturé';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_closed_year_guard" BEFORE INSERT OR UPDATE ON "JournalEntry"
    FOR EACH ROW EXECUTE FUNCTION journal_entry_closed_year_guard();
