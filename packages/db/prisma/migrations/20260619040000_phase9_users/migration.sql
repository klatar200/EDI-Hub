-- Phase 9 Sprint 2 — Users + RBAC role.
--
-- Users are tenant-scoped. clerkUserId is the unique identity from Clerk;
-- email + displayName are denormalized for convenience (Clerk is the source
-- of truth, but we cache so list/detail views don't round-trip per user).
--
-- Role defaults to 'viewer' — initial admin is promoted by the Clerk webhook
-- when it sees the org creator; subsequent additions default to viewer and
-- can be promoted by an admin via the users CRUD.

CREATE TYPE "UserRole" AS ENUM ('admin', 'ops', 'viewer');

CREATE TABLE "users" (
  "id"            UUID         NOT NULL,
  "tenant_id"     UUID         NOT NULL,
  "clerk_user_id" TEXT         NOT NULL,
  "email"         TEXT         NOT NULL,
  "display_name"  TEXT,
  "role"          "UserRole"   NOT NULL DEFAULT 'viewer',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

-- Clerk's user id is globally unique across organizations, so we enforce a
-- single User row per Clerk user. A user who belongs to multiple Clerk
-- organizations gets multiple User rows (one per tenant) — that's intentional;
-- role and tenant scope live with the User row, not the Clerk identity.
CREATE UNIQUE INDEX "users_tenant_id_clerk_user_id_key"
  ON "users"("tenant_id", "clerk_user_id");

CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");
