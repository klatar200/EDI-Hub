-- W1.2 — ISA control numbers are unique per tenant, not globally.
-- Different tenants (and different partners) routinely reuse the same ISA13.

DROP INDEX IF EXISTS "raw_files_isa_control_number_key";

CREATE UNIQUE INDEX "raw_files_tenant_id_isa_control_number_key"
  ON "raw_files"("tenant_id", "isa_control_number");
