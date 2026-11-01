-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "requiresMfa" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "mfaVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "MfaCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enabledAt" TIMESTAMPTZ(3),
    "lastUsedStep" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaCredential_userId_key" ON "MfaCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_hash_sha256" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_secret_versioned" CHECK ("secretEncrypted" LIKE 'v1.%');
