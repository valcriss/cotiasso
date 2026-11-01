-- CreateTable
CREATE TABLE "SetupToken" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetupToken_tokenHash_key" ON "SetupToken"("tokenHash");

ALTER TABLE "SetupToken" ADD CONSTRAINT "SetupToken_hash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
