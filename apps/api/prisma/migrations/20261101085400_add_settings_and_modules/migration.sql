-- CreateTable
CREATE TABLE "SettingsVersion" (
    "id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "SettingsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleActivation" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(3),
    "activatedBy" UUID,
    "deactivatedBy" UUID,

    CONSTRAINT "ModuleActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingsVersion_section_effectiveFrom_idx" ON "SettingsVersion"("section", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleActivation_key_key" ON "ModuleActivation"("key");

ALTER TABLE "SettingsVersion" ADD CONSTRAINT "SettingsVersion_section_format" CHECK ("section" ~ '^[a-z][a-z0-9-]*$');
ALTER TABLE "SettingsVersion" ADD CONSTRAINT "SettingsVersion_payload_object" CHECK (jsonb_typeof("payload") = 'object');
ALTER TABLE "ModuleActivation" ADD CONSTRAINT "ModuleActivation_key_format" CHECK ("key" ~ '^[a-z][a-z0-9-]*$');

-- L'historique des paramètres est en ajout seul : une version ne se modifie ni ne se supprime.
CREATE FUNCTION settings_version_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'SettingsVersion est en ajout seul : % refusé', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SettingsVersion_append_only"
    BEFORE UPDATE OR DELETE ON "SettingsVersion"
    FOR EACH ROW EXECUTE FUNCTION settings_version_append_only();

CREATE TRIGGER "SettingsVersion_no_truncate"
    BEFORE TRUNCATE ON "SettingsVersion"
    FOR EACH STATEMENT EXECUTE FUNCTION settings_version_append_only();
