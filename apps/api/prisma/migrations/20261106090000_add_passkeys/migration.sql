-- CreateEnum
CREATE TYPE "WebauthnPurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- CreateTable
CREATE TABLE "PasskeyCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "rpId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PasskeyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebauthnChallenge" (
    "id" UUID NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" "WebauthnPurpose" NOT NULL,
    "userId" UUID,
    "sessionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebauthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasskeyCredential_credentialId_key" ON "PasskeyCredential"("credentialId");

-- CreateIndex
CREATE INDEX "PasskeyCredential_userId_idx" ON "PasskeyCredential"("userId");

-- CreateIndex
CREATE INDEX "WebauthnChallenge_expiresAt_idx" ON "WebauthnChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasskeyCredential" ADD CONSTRAINT "PasskeyCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Clés d'accès (ADR 0036). Une clé ne se supprime jamais : on la révoque, et une clé révoquée ne se réactive pas.
-- Identifiant, clé publique, propriétaire, domaine et type d'appareil sont définitifs ; le compteur ne recule pas.
ALTER TABLE "PasskeyCredential" ADD CONSTRAINT "PasskeyCredential_label_check"
    CHECK (char_length(btrim("label")) BETWEEN 1 AND 60);
ALTER TABLE "PasskeyCredential" ADD CONSTRAINT "PasskeyCredential_counter_check"
    CHECK ("counter" >= 0);

CREATE FUNCTION passkey_credential_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Une clé d''accès ne se supprime pas : on la révoque';
    END IF;
    IF NEW."credentialId" IS DISTINCT FROM OLD."credentialId"
       OR NEW."publicKey" IS DISTINCT FROM OLD."publicKey"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
       OR NEW."rpId" IS DISTINCT FROM OLD."rpId"
       OR NEW."deviceType" IS DISTINCT FROM OLD."deviceType"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'L''identité d''une clé d''accès (identifiant, clé publique, propriétaire, domaine) ne change pas';
    END IF;
    IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
        RAISE EXCEPTION 'Une clé d''accès révoquée ne se réactive pas';
    END IF;
    IF NEW."counter" < OLD."counter" THEN
        RAISE EXCEPTION 'Le compteur d''une clé d''accès ne recule pas';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PasskeyCredential_guard" BEFORE UPDATE OR DELETE ON "PasskeyCredential"
    FOR EACH ROW EXECUTE FUNCTION passkey_credential_guard();
CREATE TRIGGER "PasskeyCredential_no_truncate" BEFORE TRUNCATE ON "PasskeyCredential"
    FOR EACH STATEMENT EXECUTE FUNCTION accounting_forbid_truncate();
