-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "comment" TEXT,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" UUID,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_category_idx" ON "Document"("category");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentVersion_sha256_idx" ON "DocumentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "DocumentVersion"("documentId", "number");

-- CreateIndex
CREATE INDEX "DocumentLink_objectType_objectId_idx" ON "DocumentLink"("objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_objectType_objectId_key" ON "DocumentLink"("documentId", "objectType", "objectId");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Document" ADD CONSTRAINT "Document_category_format" CHECK ("category" ~ '^[a-z][a-z-]*$');
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_number_positive" CHECK ("number" >= 1);
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_size_positive" CHECK ("size" > 0);

-- Les versions sont immuables et les documents ne se suppriment pas : on archive, on ne détruit pas.
CREATE FUNCTION document_version_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'DocumentVersion est immuable : % refusé', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DocumentVersion_immutable"
    BEFORE UPDATE OR DELETE ON "DocumentVersion"
    FOR EACH ROW EXECUTE FUNCTION document_version_immutable();

CREATE FUNCTION document_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Document ne se supprime pas : l''archiver à la place';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Document_no_delete"
    BEFORE DELETE ON "Document"
    FOR EACH ROW EXECUTE FUNCTION document_no_delete();
