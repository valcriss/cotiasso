-- CreateTable
CREATE TABLE "BrandLogo" (
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandLogo_pkey" PRIMARY KEY ("sha256")
);

ALTER TABLE "BrandLogo" ADD CONSTRAINT "BrandLogo_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "BrandLogo" ADD CONSTRAINT "BrandLogo_mime_allowed" CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/svg+xml'));
ALTER TABLE "BrandLogo" ADD CONSTRAINT "BrandLogo_size_consistent" CHECK ("size" = octet_length("data") AND "size" > 0);

-- Un logo ne se modifie ni ne se supprime : changer de logo en ajoute un, la section « logo » désigne celui en vigueur.
CREATE FUNCTION brand_logo_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'BrandLogo est en ajout seul : % refusé', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BrandLogo_append_only"
    BEFORE UPDATE OR DELETE ON "BrandLogo"
    FOR EACH ROW EXECUTE FUNCTION brand_logo_append_only();

CREATE TRIGGER "BrandLogo_no_truncate"
    BEFORE TRUNCATE ON "BrandLogo"
    FOR EACH STATEMENT EXECUTE FUNCTION brand_logo_append_only();
