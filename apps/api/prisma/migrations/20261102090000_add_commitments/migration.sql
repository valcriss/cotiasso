-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Commitment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "committedOn" DATE NOT NULL,
    "accountId" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "settledEntryId" UUID,
    "settledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Commitment_projectId_committedOn_idx" ON "Commitment"("projectId", "committedOn");

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_settledEntryId_fkey" FOREIGN KEY ("settledEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Engagement : montant positif, libellé renseigné, état cohérent avec ses pièces (écriture de solde, motif d'annulation).
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_label_not_blank" CHECK (btrim("label") <> '');
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_state_consistent" CHECK (
    ("status" = 'OPEN' AND "settledEntryId" IS NULL AND "settledAt" IS NULL AND "cancelReason" IS NULL)
    OR ("status" = 'SETTLED' AND "settledEntryId" IS NOT NULL AND "settledAt" IS NOT NULL AND "cancelReason" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelReason" IS NOT NULL AND btrim("cancelReason") <> '' AND "cancelledAt" IS NOT NULL
        AND "settledEntryId" IS NULL)
);

-- Ce que l'écriture de solde pèse sur le projet : charges (classe 6) ventilées sur lui, débits moins crédits. C'est la
-- même matière que le réalisé du projet ; un engagement ne se solde que si elle est positive, pour qu'il ne disparaisse
-- jamais des engagements sans apparaître dans le réalisé.
CREATE FUNCTION commitment_entry_weight(entry uuid, project uuid) RETURNS numeric AS $$
    SELECT COALESCE(SUM(CASE WHEN l."debit" > 0 THEN al."amount" ELSE -al."amount" END), 0)
    FROM "AnalyticalAllocation" al
    JOIN "JournalLine" l ON l."id" = al."lineId"
    JOIN "Account" a ON a."id" = l."accountId"
    WHERE l."entryId" = entry AND al."projectId" = project AND left(a."number", 1) = '6';
$$ LANGUAGE sql STABLE;

CREATE FUNCTION commitment_guard() RETURNS trigger AS $$
DECLARE
    entry_status "EntryStatus";
    previous_status "EntryStatus";
    account_number text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Un engagement ne se supprime pas : on l''annule avec un motif';
    END IF;

    IF NEW."accountId" IS NOT NULL THEN
        SELECT "number" INTO account_number FROM "Account" WHERE "id" = NEW."accountId";
        IF left(account_number, 1) <> '6' THEN
            RAISE EXCEPTION 'Un engagement vise un compte de charges (classe 6)';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'OPEN' THEN
            RAISE EXCEPTION 'Un engagement commence toujours ouvert';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."projectId" <> OLD."projectId" THEN
        RAISE EXCEPTION 'Le projet d''un engagement est définitif';
    END IF;

    IF OLD."status" = 'CANCELLED' THEN
        RAISE EXCEPTION 'Un engagement annulé ne change plus';
    END IF;

    -- Montant, libellé, date et compte ne bougent que tant que l'engagement est ouvert.
    IF OLD."status" = 'SETTLED' AND (NEW."label" <> OLD."label" OR NEW."amount" <> OLD."amount"
        OR NEW."committedOn" <> OLD."committedOn" OR NEW."accountId" IS DISTINCT FROM OLD."accountId") THEN
        RAISE EXCEPTION 'Un engagement soldé ne se modifie plus';
    END IF;

    IF NEW."status" = 'SETTLED' THEN
        IF OLD."status" = 'SETTLED' AND NEW."settledEntryId" IS DISTINCT FROM OLD."settledEntryId" THEN
            -- Re-solder par une autre écriture n'est possible que si la première a été contrepassée (il redevenait engagé).
            SELECT "status" INTO previous_status FROM "JournalEntry" WHERE "id" = OLD."settledEntryId";
            IF previous_status <> 'REVERSED' THEN
                RAISE EXCEPTION 'Cet engagement est déjà soldé par une écriture comptabilisée';
            END IF;
        END IF;
        -- Dans tous les cas (y compris la même écriture) : elle doit être comptabilisée et porter une dépense du projet.
        SELECT "status" INTO entry_status FROM "JournalEntry" WHERE "id" = NEW."settledEntryId";
        IF entry_status IS DISTINCT FROM 'POSTED' THEN
            RAISE EXCEPTION 'Seule une écriture comptabilisée peut solder un engagement';
        END IF;
        IF commitment_entry_weight(NEW."settledEntryId", NEW."projectId") <= 0 THEN
            RAISE EXCEPTION 'Cette écriture ne porte aucune dépense ventilée sur le projet : elle ne peut pas solder l''engagement';
        END IF;
    ELSIF NEW."status" = 'CANCELLED' AND OLD."status" = 'SETTLED' THEN
        -- Annuler un engagement soldé n'est possible que si son écriture a été contrepassée (il redevenait engagé).
        SELECT "status" INTO previous_status FROM "JournalEntry" WHERE "id" = OLD."settledEntryId";
        IF previous_status <> 'REVERSED' THEN
            RAISE EXCEPTION 'Un engagement soldé par une écriture comptabilisée ne s''annule pas';
        END IF;
    ELSIF OLD."status" = 'SETTLED' THEN
        RAISE EXCEPTION 'Un engagement soldé ne revient pas en arrière';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Commitment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Commitment"
    FOR EACH ROW EXECUTE FUNCTION commitment_guard();
CREATE TRIGGER "Commitment_no_truncate" BEFORE TRUNCATE ON "Commitment"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
