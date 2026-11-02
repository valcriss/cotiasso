-- CreateEnum
CREATE TYPE "OperationDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "OperationCategory" (
    "id" UUID NOT NULL,
    "direction" "OperationDirection" NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT NOT NULL DEFAULT '',
    "accountId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "OperationCategory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OperationCategory" ADD CONSTRAINT "OperationCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un libellé par sens, sans tenir compte de la casse.
CREATE UNIQUE INDEX "OperationCategory_direction_label_key" ON "OperationCategory"("direction", lower("label"));

ALTER TABLE "OperationCategory" ADD CONSTRAINT "OperationCategory_label_not_blank" CHECK (btrim("label") <> '');

-- Une catégorie ne se supprime pas : elle se désactive.
CREATE FUNCTION "operation_category_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une catégorie ne se supprime pas : désactivez-la.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OperationCategory_guard" BEFORE DELETE ON "OperationCategory"
  FOR EACH ROW EXECUTE FUNCTION "operation_category_guard"();

CREATE TRIGGER "OperationCategory_no_truncate" BEFORE TRUNCATE ON "OperationCategory"
  FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
