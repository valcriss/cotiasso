-- CreateEnum
CREATE TYPE "PasswordTokenPurpose" AS ENUM ('INVITATION', 'RESET');

-- CreateTable
CREATE TABLE "PasswordToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "PasswordTokenPurpose" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdBy" UUID,

    CONSTRAINT "PasswordToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordToken_tokenHash_key" ON "PasswordToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordToken_userId_idx" ON "PasswordToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordToken" ADD CONSTRAINT "PasswordToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PasswordToken" ADD CONSTRAINT "PasswordToken_hash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PasswordToken" ADD CONSTRAINT "PasswordToken_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
