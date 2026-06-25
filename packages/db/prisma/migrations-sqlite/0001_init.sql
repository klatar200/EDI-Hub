-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "clerk_org_id" TEXT,
    "our_isa_ids" TEXT NOT NULL DEFAULT '[]',
    "retention" JSONB NOT NULL DEFAULT '{"rawFiles":540,"parsedTree":540,"auditEvents":365,"alerts":365}',
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload_diff" JSONB NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trading_partners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "isa_sender_ids" TEXT NOT NULL DEFAULT '[]',
    "isa_receiver_ids" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "supported_sets" TEXT NOT NULL DEFAULT '[]',
    "lifecycle_flows" JSONB NOT NULL DEFAULT '[]',
    "ack_code_overrides" JSONB NOT NULL DEFAULT '{}',
    "sla_windows" JSONB NOT NULL DEFAULT '[]',
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "connectivity" JSONB NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "trading_partners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "source_ref" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" DATETIME,
    "acknowledged_by" TEXT,
    "suppress_until" DATETIME,
    CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "raw_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "isa_control_number" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "ingested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "interchanges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "raw_file_id" TEXT NOT NULL,
    "isa_control_number" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "declared_group_count" INTEGER,
    "element_separator" TEXT NOT NULL,
    "sub_element_separator" TEXT NOT NULL,
    "segment_terminator" TEXT NOT NULL,
    "parsed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interchanges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "interchanges_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "raw_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "functional_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "interchange_id" TEXT NOT NULL,
    "functional_id_code" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "declared_transaction_count" INTEGER,
    CONSTRAINT "functional_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "functional_groups_interchange_id_fkey" FOREIGN KEY ("interchange_id") REFERENCES "interchanges" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "functional_group_id" TEXT NOT NULL,
    "transaction_set_id" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "declared_segment_count" INTEGER,
    "segment_count" INTEGER NOT NULL,
    "po_number" TEXT,
    "invoice_number" TEXT,
    "purpose" TEXT,
    "shipment_id" TEXT,
    "acked_group_control" TEXT,
    "acked_txn_controls" JSONB,
    "ack_status" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'unknown',
    "config_flag" TEXT,
    "generated_at" DATETIME,
    "transmitted_at" DATETIME,
    "confirmed_at" DATETIME,
    CONSTRAINT "transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transactions_functional_group_id_fkey" FOREIGN KEY ("functional_group_id") REFERENCES "functional_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "segments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "elements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "semantic_label" TEXT,
    CONSTRAINT "elements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "elements_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "run_after" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_clerk_org_id_key" ON "tenants"("clerk_org_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_clerk_user_id_key" ON "users"("tenant_id", "clerk_user_id");

-- CreateIndex
CREATE INDEX "trading_partners_tenant_id_idx" ON "trading_partners"("tenant_id");

-- CreateIndex
CREATE INDEX "trading_partners_status_idx" ON "trading_partners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_dedupe_key_key" ON "alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "alerts_partner_id_idx" ON "alerts"("partner_id");

-- CreateIndex
CREATE INDEX "alerts_type_idx" ON "alerts"("type");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_created_at_idx" ON "alerts"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_files_s3_key_key" ON "raw_files"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "raw_files_isa_control_number_key" ON "raw_files"("isa_control_number");

-- CreateIndex
CREATE INDEX "raw_files_file_hash_idx" ON "raw_files"("file_hash");

-- CreateIndex
CREATE INDEX "raw_files_ingested_at_idx" ON "raw_files"("ingested_at");

-- CreateIndex
CREATE INDEX "raw_files_tenant_id_ingested_at_idx" ON "raw_files"("tenant_id", "ingested_at");

-- CreateIndex
CREATE UNIQUE INDEX "interchanges_raw_file_id_key" ON "interchanges"("raw_file_id");

-- CreateIndex
CREATE INDEX "interchanges_tenant_id_idx" ON "interchanges"("tenant_id");

-- CreateIndex
CREATE INDEX "functional_groups_interchange_id_idx" ON "functional_groups"("interchange_id");

-- CreateIndex
CREATE INDEX "functional_groups_tenant_id_idx" ON "functional_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "transactions_functional_group_id_idx" ON "transactions"("functional_group_id");

-- CreateIndex
CREATE INDEX "transactions_transaction_set_id_idx" ON "transactions"("transaction_set_id");

-- CreateIndex
CREATE INDEX "transactions_po_number_idx" ON "transactions"("po_number");

-- CreateIndex
CREATE INDEX "transactions_invoice_number_idx" ON "transactions"("invoice_number");

-- CreateIndex
CREATE INDEX "transactions_shipment_id_idx" ON "transactions"("shipment_id");

-- CreateIndex
CREATE INDEX "transactions_acked_group_control_idx" ON "transactions"("acked_group_control");

-- CreateIndex
CREATE INDEX "transactions_direction_idx" ON "transactions"("direction");

-- CreateIndex
CREATE INDEX "transactions_config_flag_idx" ON "transactions"("config_flag");

-- CreateIndex
CREATE INDEX "transactions_confirmed_at_idx" ON "transactions"("confirmed_at");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_idx" ON "transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "segments_transaction_id_idx" ON "segments"("transaction_id");

-- CreateIndex
CREATE INDEX "segments_tag_idx" ON "segments"("tag");

-- CreateIndex
CREATE INDEX "segments_tenant_id_idx" ON "segments"("tenant_id");

-- CreateIndex
CREATE INDEX "elements_segment_id_idx" ON "elements"("segment_id");

-- CreateIndex
CREATE INDEX "elements_tenant_id_idx" ON "elements"("tenant_id");

-- CreateIndex
CREATE INDEX "jobs_status_run_after_idx" ON "jobs"("status", "run_after");

