-- CreateEnum
CREATE TYPE "OperationUsage" AS ENUM ('MEMBERSHIP', 'GRANT');

-- AlterTable
ALTER TABLE "OperationCategory" ADD COLUMN "usage" "OperationUsage";

-- Au plus une catégorie par rôle particulier ; seule une catégorie d'argent reçu peut en porter un.
CREATE UNIQUE INDEX "OperationCategory_usage_key" ON "OperationCategory"("usage") WHERE "usage" IS NOT NULL;
ALTER TABLE "OperationCategory" ADD CONSTRAINT "OperationCategory_usage_incoming" CHECK ("usage" IS NULL OR "direction" = 'IN');
