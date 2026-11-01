-- Chaîne d'intégrité du journal d'audit : chaque événement porte l'empreinte du précédent.
ALTER TABLE "AuditEvent" ADD COLUMN "seq" BIGSERIAL NOT NULL, ADD COLUMN "hash" TEXT, ADD COLUMN "previousHash" TEXT;

CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_hash_sha256" CHECK ("hash" IS NULL OR "hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_previous_hash_sha256" CHECK ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$');
