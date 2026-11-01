-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Garanties au plus près des données : email normalisé, hash argon2id, jamais d'utilisateur supprimé.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254);
ALTER TABLE "User" ADD CONSTRAINT "User_passwordHash_argon2id" CHECK ("passwordHash" LIKE '$argon2id$%');

CREATE FUNCTION user_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'User ne se supprime pas : désactiver le compte à la place';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_no_delete"
    BEFORE DELETE ON "User"
    FOR EACH ROW EXECUTE FUNCTION user_no_delete();
