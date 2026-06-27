# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EDI Data Hub — an EDI observability platform. Ingests inbound and outbound X12 EDI transactions, decomposes them into structured data, and presents a single hub for monitoring, searching, troubleshooting, and alerting. Read `BUILD_PLAN.md` for the active roadmap; `README.md` for shipped features; `FUTURE_FEATURES.md` for optional/deferred work.

**North Star:** Transaction lifecycle stitching — pull up a PO number and see the 850, 855, 856, 810, and all 997s in one chronological view.

**Anti-drift rule:** Before adding any feature not in the build plan, confirm it serves monitoring, troubleshooting, alerting, or stability. If it doesn't, it's out of scope for v1.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite, Tailwind CSS, shadcn/ui |
| Backend | Node.js + Fastify, TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Raw file storage | AWS S3 (or Cloudflare R2) |
| Background jobs | BullMQ (Redis-backed) |
| Infrastructure | AWS (ECS, RDS, S3, SES), Terraform |
| Auth | Clerk (or Auth0) |
| CI/CD | GitHub Actions |

TypeScript is used throughout — both frontend and backend. This is intentional: EDI parsing is a data transformation problem where type errors at build time are far cheaper than silent wrong values in production.

---

## Intended Architecture

The repo will be a monorepo with three packages:

```
/apps
  /web          # React + Vite frontend
  /api          # Fastify backend
/packages
  /edi-parser   # X12 parsing library (pure TS, no framework deps)
  /db           # Prisma schema + generated client
  /shared       # Shared types (transaction set schemas, envelopes, etc.)
/infra          # Terraform
```

### Key architectural decisions

**Ingestion is passive.** The hub receives *copies* of EDI files (via SFTP drop, authenticated upload endpoint, or folder-watch). It never sits in the live transmission path.

**Raw file is sacred.** Every ingested file is stored verbatim in S3 before any parsing occurs. The S3 key is the primary reference; the database record links to it. Parsing failures never lose the original.

**Parsing is a separate package.** `packages/edi-parser` contains all X12 parsing logic — envelope (ISA/GS/ST/SE/GE/IEA) and transaction-set-specific parsers (850, 855, 856, 810, 997/999). It has no database or HTTP dependencies and can be unit-tested in isolation. This is critical given how much real-world EDI deviates from spec.

**Typed schemas per transaction set.** Each supported transaction set (850, 810, etc.) has a TypeScript type describing its structure. The parser produces values of these types. This catches element-level bugs at compile time.

**Deduplication on ISA control number.** Before any file is parsed or stored as a new record, the ISA control number is checked against the database. Duplicate control numbers are rejected idempotently — same file ingested twice produces one record, not two.

**BullMQ for async work.** Ingestion triggers a job; the job handles S3 upload, deduplication check, and parse. This keeps the HTTP response fast and gives retry/failure handling for free. The same queue will power Phase 7 missing-ack detection jobs.

**Single-tenant for Phase 0–8.** Multi-tenancy is retrofitted in Phase 9. Until then, no tenant isolation logic is needed — keep the schema simple.

---

## Database Schema (intended, not yet implemented)

Core tables:
- `raw_files` — S3 key, hash, ingested_at, source_channel, status
- `interchanges` — ISA envelope fields, linked to raw_file
- `functional_groups` — GS envelope, linked to interchange
- `transactions` — ST/SE, transaction_set_id, linked to functional_group
- `segments` — segment_id, segment_type, position, linked to transaction
- `elements` — element_index, value, semantic_label, linked to segment
- `trading_partners` — ISA sender/receiver IDs, display name, config
- `transaction_links` — cross-reference table linking related transactions by PO number / invoice number / shipment ID (powers lifecycle stitching)

---

## Git workflow (Cursor agents)

**Direct to `main` — no PRs.** All Cursor agent work commits and pushes straight to `main`. Do not create feature branches or pull requests. See `.cursor/rules/direct-to-main.mdc` for the full rule. CI on push to `main` is the quality gate.

---

## Commands

> Commands will be added here as the project is scaffolded. Below are the intended patterns.

```bash
# Install dependencies (from repo root)
npm install

# Run API in dev mode
npm run dev --workspace=apps/api

# Run web in dev mode
npm run dev --workspace=apps/web

# Run all tests
npm test

# Run tests for a single package
npm test --workspace=packages/edi-parser

# Type-check everything
npm run typecheck

# Lint
npm run lint

# Run database migrations
npm run db:migrate --workspace=packages/db

# Generate Prisma client after schema changes
npm run db:generate --workspace=packages/db
```

---

## EDI Domain Notes

- **X12 envelope hierarchy:** ISA (interchange) → GS (functional group) → ST/SE (transaction set). Always parse outer-in.
- **Primary X12 version:** 4010. 5010 may appear — the parser should surface the version from GS08 and handle gracefully.
- **Transaction sets in scope (v1):** 850 (Purchase Order), 855 (PO Acknowledgment), 856 (Ship Notice/ASN), 810 (Invoice), 997/999 (Functional Acknowledgment).
- **997 AK segments:** AK1 (group ack), AK2 (transaction ack), AK3 (segment error), AK4 (element error), AK5 (transaction ack detail). These are the error-detail segments — parse them carefully; they power Phase 5.
- **Real-world EDI is messy.** Trading partners routinely use non-standard delimiters, omit optional segments, repeat segments the spec calls non-repeating, and send proprietary Z-segments. The parser must fail gracefully on anything it can't handle — log the error, store the raw file, move on. Never crash the ingestion pipeline on a malformed file.
- **Delimiters are defined in ISA.** Element separator is ISA[3] (position 3 of the ISA segment), sub-element separator is ISA[16], segment terminator is the character immediately after ISA[16]. Do not hardcode `*`, `~`, or `:`.

---

## Phase 9 — Working in a Multi-Tenant Codebase

After Phase 9 the app is multi-tenant. Every change in this codebase must
preserve four invariants. Violating any of them is a security bug, even if
the code compiles and the test suite is green.

### 1. Every multi-tenant table carries `tenantId`

When adding a new model to `schema.prisma`:

1. Add `tenantId String @map("tenant_id") @db.Uuid` and a relation to `Tenant`.
2. Add the model name to `MULTI_TENANT_MODELS` in `packages/db/src/tenant-extension.ts`.
3. Add a `@@index([tenantId])` (or `[tenantId, createdAt]` if reads sort by date).

If a model genuinely should NOT carry `tenantId` (system tables, feature
flags), add it to `TENANT_EXEMPT_MODELS` with a comment explaining why.
The schema-drift test (`packages/db/test/tenant-extension.test.ts`) fails
fast if a new model isn't classified — that's the safety net.

### 2. Every query runs inside a tenant context

The Prisma extension throws if `tenantContext.current()` is unset. Routes
get the context automatically from `tenantPlugin` (it calls
`tenantContext.enterWith(...)` in the auth `onRequest` hook).

Scripts, background jobs, and tests that DON'T go through Fastify must
wrap their work in `tenantContext.run({ tenantId }, async () => { ... })`
or call `tenantContext.bypass(...)` explicitly for cross-tenant work
(only audit-log writes and admin bootstrap qualify).

### 3. Every data-mutating route emits an audit row

Pattern (see `apps/api/src/services/audit.ts`):

```ts
import { withAudit } from '../services/audit.js';

const updated = await withAudit(
  app.prisma,
  { action: 'partner.update', targetType: 'tradingPartner', actorId: request.auth?.userId ?? null },
  (tx) => tx.tradingPartner.update({ where: { id }, data: { ... } }),
  (row) => ({ targetId: row.id, before: existing, after: row }),
);
```

The audit insert happens in the same `$transaction` as the write, so a
failed audit insert rolls back the data write. Don't write a route that
mutates data without wrapping it.

### 4. Every route declares a `requiredRole`

Use `requiresRole('viewer' | 'ops' | 'admin')` from `apps/api/src/plugins/rbac.js`:

```ts
app.get('/things', requiresRole('viewer'), async (req, reply) => { ... });
```

`apps/api/test/route-role-matrix.test.ts` enumerates every route and
fails if a registered route isn't in the expected matrix. Adding a route
means adding an `EXPECTED[…]` entry there.

### Cross-tenant probes return 404, not 403

We never confirm the existence of a foreign-tenant row. The Prisma
extension's `where`-injection naturally produces 404 (because the filtered
findUnique returns null). Routes that catch P2025 ("Record to update not
found") should also surface NOT_FOUND, not FORBIDDEN.

### Secrets

Production reads secrets from AWS Secrets Manager via
`apps/api/src/services/secrets.ts`. Adding a new secret means: extend
`applySecretsFromManager`, add an `aws_secretsmanager_secret` entry in
`infra/secrets.tf` (under the project KMS CMK), document it in the
deploy README. Never inline secret values anywhere.

### When in doubt

Read `BUILD_PLAN.md` §12 (Security checklist) — it's the current sign-off list. Every item
points at the file or test that proves it. If your change might affect one
of those items, the corresponding test/checklist entry needs an update.
