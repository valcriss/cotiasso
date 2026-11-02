-- CreateTable
CREATE TABLE "OpeningSituation" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "OpeningSituation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningSituation_entryId_key" ON "OpeningSituation"("entryId");

-- AddForeignKey
ALTER TABLE "OpeningSituation" ADD CONSTRAINT "OpeningSituation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ADR 0029 : situation d'ouverture. Une seule écriture reprend l'ensemble des soldes de départ ; les garanties sont ici.
CREATE FUNCTION opening_situation_guard() RETURNS trigger AS $$
DECLARE
    journal_type "JournalType";
    entry_date date;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Une situation d''ouverture ne se modifie pas : supprimez son brouillon ou annulez l''écriture, puis refaites-la.';
    END IF;

    -- Une seule situation « vivante » à la fois : deux créations simultanées s'attendent, la seconde est refusée.
    PERFORM pg_advisory_xact_lock(hashtext('OpeningSituation'));
    IF EXISTS (
        SELECT 1 FROM "OpeningSituation" s JOIN "JournalEntry" e ON e."id" = s."entryId"
        WHERE e."status" <> 'REVERSED' AND s."id" <> NEW."id"
    ) THEN
        RAISE EXCEPTION 'Une situation d''ouverture existe déjà : supprimez son brouillon ou annulez l''écriture avant d''en refaire une.';
    END IF;

    SELECT j."type", e."date" INTO journal_type, entry_date
    FROM "JournalEntry" e JOIN "Journal" j ON j."id" = e."journalId" WHERE e."id" = NEW."entryId";
    IF journal_type IS DISTINCT FROM 'OPENING' THEN
        RAISE EXCEPTION 'La situation d''ouverture s''enregistre dans le journal des à-nouveaux.';
    END IF;
    IF entry_date IS DISTINCT FROM NEW."date" THEN
        RAISE EXCEPTION 'La date de la situation d''ouverture doit être celle de son écriture.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OpeningSituation_guard" BEFORE INSERT OR UPDATE ON "OpeningSituation"
    FOR EACH ROW EXECUTE FUNCTION opening_situation_guard();
CREATE TRIGGER "OpeningSituation_no_truncate" BEFORE TRUNCATE ON "OpeningSituation"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
