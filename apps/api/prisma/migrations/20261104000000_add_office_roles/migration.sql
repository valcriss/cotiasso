-- ADR 0035, tranche 0 : catalogue de fonctions (Président, Trésorier…). Les mandats des membres s'y réfèrent
-- au lieu d'un intitulé libre, pour que les circuits de validation puissent désigner une fonction sans dépendre d'un texte.

-- CreateTable
CREATE TABLE "OfficeRole" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    -- Nom sans casse, sans accents ni espaces superflus : l'unicité se juge dessus (calculé par l'application).
    "nameKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "OfficeRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeRole_nameKey_key" ON "OfficeRole"("nameKey");

-- Reprise des intitulés déjà saisis : une fonction par intitulé distinct à la casse et aux accents près,
-- sous la graphie la plus fréquente (à égalité, l'ordre alphabétique).
INSERT INTO "OfficeRole" ("id", "name", "nameKey")
SELECT gen_random_uuid(), "name", "nameKey"
FROM (
    SELECT DISTINCT ON ("nameKey") "nameKey", "name"
    FROM (
        SELECT
            btrim(regexp_replace("title", '\s+', ' ', 'g')) AS "name",
            lower(replace(replace(translate(btrim(regexp_replace("title", '\s+', ' ', 'g')),
                'ÀÂÄÁÃÅàâäáãåÉÈÊËéèêëÎÏÍÌîïíìÔÖÓÒÕôöóòõÙÛÜÚùûüúÇçÑñŸÿ',
                'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYy'), 'œ', 'oe'), 'Œ', 'OE')) AS "nameKey"
        FROM "MemberOffice"
    ) AS "normalized"
    GROUP BY "nameKey", "name"
    ORDER BY "nameKey", count(*) DESC, "name" ASC
) AS "chosen";

-- AlterTable
ALTER TABLE "MemberOffice" ADD COLUMN "officeRoleId" UUID;

UPDATE "MemberOffice" AS o
SET "officeRoleId" = r."id"
FROM "OfficeRole" AS r
WHERE r."nameKey" = lower(replace(replace(translate(btrim(regexp_replace(o."title", '\s+', ' ', 'g')),
        'ÀÂÄÁÃÅàâäáãåÉÈÊËéèêëÎÏÍÌîïíìÔÖÓÒÕôöóòõÙÛÜÚùûüúÇçÑñŸÿ',
        'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYy'), 'œ', 'oe'), 'Œ', 'OE'));

ALTER TABLE "MemberOffice" ALTER COLUMN "officeRoleId" SET NOT NULL;
ALTER TABLE "MemberOffice" DROP COLUMN "title";

-- CreateIndex
CREATE INDEX "MemberOffice_officeRoleId_idx" ON "MemberOffice"("officeRoleId");

-- AddForeignKey
ALTER TABLE "MemberOffice" ADD CONSTRAINT "MemberOffice_officeRoleId_fkey" FOREIGN KEY ("officeRoleId") REFERENCES "OfficeRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une fonction ne se supprime jamais (les mandats et, plus tard, les circuits s'y réfèrent) : elle s'archive.
CREATE FUNCTION office_role_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une fonction ne se supprime pas : archivez-la';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OfficeRole_guard" BEFORE UPDATE OR DELETE ON "OfficeRole"
    FOR EACH ROW EXECUTE FUNCTION office_role_guard();
CREATE TRIGGER "OfficeRole_no_truncate" BEFORE TRUNCATE ON "OfficeRole"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
