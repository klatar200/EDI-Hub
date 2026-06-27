-- PS-6/PS-9/PS-10/PS-11 — tenant settings, lifecycle notes, user preferences, segment labels

ALTER TABLE "tenants" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{"staleTrafficWindowHours":6,"slaCountdownEnabled":false,"quietHoursStart":null,"quietHoursEnd":null,"emailDigestEnabled":false,"emailDigestHourUtc":8}';

ALTER TABLE "users" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "trading_partners" ADD COLUMN "segment_label_overrides" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "lifecycle_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "po" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lifecycle_notes_tenant_id_po_idx" ON "lifecycle_notes"("tenant_id", "po");

ALTER TABLE "lifecycle_notes" ADD CONSTRAINT "lifecycle_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lifecycle_notes" ADD CONSTRAINT "lifecycle_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
