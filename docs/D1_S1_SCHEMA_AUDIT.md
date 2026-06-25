# D1 Sprint 1 — Schema Audit (for Keagan review)

Source schema: `packages/db/prisma/schema.prisma`
Source code reviewed: `apps/api/src/**`, `apps/api/test/**`, `packages/db/src/**`

---

## 1. `@db.Uuid` — every occurrence

Used on every `id` / `tenantId` / FK column (28 total). All become plain `String` on SQLite. `@default(uuid())` already works on SQLite (Prisma generates the UUID in the client via `crypto.randomUUID()`).

| Model | Fields with `@db.Uuid` |
|---|---|
| `Tenant` | `id` |
| `AuditEvent` | `id`, `tenantId`, `actorId` |
| `User` | `id`, `tenantId` |
| `TradingPartner` | `id`, `tenantId` |
| `Alert` | `id`, `tenantId`, `partnerId` |
| `RawFile` | `id`, `tenantId` |
| `Interchange` | `id`, `tenantId`, `rawFileId` |
| `FunctionalGroup` | `id`, `tenantId`, `interchangeId` |
| `Transaction` | `id`, `tenantId`, `functionalGroupId` |
| `Segment` | `id`, `tenantId`, `transactionId` |
| `Element` | `id`, `tenantId`, `segmentId` |

**Required change (SQLite schema only):** drop every `@db.Uuid`. Keep `String` + `@default(uuid())`. No app-code change.

---

## 2. `Json` fields — every occurrence

| Model.field | Default | How it is used |
|---|---|---|
| `Tenant.retention` | `{...}` | whole-object read/write only |
| `TradingPartner.lifecycleFlows` | `[]` | whole-object |
| `TradingPartner.ackCodeOverrides` | `{}` | whole-object |
| `TradingPartner.slaWindows` | `[]` | whole-object |
| `TradingPartner.contacts` | `[]` | whole-object |
| `TradingPartner.connectivity` | `{}` | whole-object |
| `Alert.sourceRef` | `{}` | whole-object (writes spread an existing object once: `notifier.ts:163`) |
| `AuditEvent.payloadDiff` | `{}` | whole-object |
| `Transaction.ackedTxnControls` | `null` | whole-object |

**Verification (S1.2 pass):**
- `grep -rn '\.path' apps/api/src` → **0 matches**
- `grep -rn "mode:\s*['\"]insensitive['\"]" apps/api/src` → **0 matches**
- `grep -rn '\$queryRaw|\$executeRaw' apps/api/src packages/` → **0 matches**
- No `where` clause anywhere narrows on a Json field.

**Required change:** none. Prisma maps `Json` → `TEXT` on SQLite transparently for whole-object read/write. SaaS Postgres behavior is unchanged.

---

## 3. `String[]` arrays — every occurrence + every API site

| Schema field | API read sites | API write sites |
|---|---|---|
| `Tenant.ourIsaIds` | `routes/lifecycle.ts:48`, `services/parsing.ts:364`, `scripts/seed-pilot-tenant.ts:33–34` | `scripts/seed-pilot-tenant.ts:30` |
| `TradingPartner.isaSenderIds` | `services/partners.ts:162,191,194,200–201,311,317,334`, `services/detection.ts:67,121,292` | `routes/partners-config.ts:57,193,253`, `services/partners.ts:191` (validation) |
| `TradingPartner.isaReceiverIds` | `services/partners.ts:163,191,194,203–206,312,317,335`, `services/detection.ts:68,121,292` | `routes/partners-config.ts:58,194,254` |
| `TradingPartner.supportedSets` | `services/partners.ts:167,209–212`, `services/parsing.ts:379` | `routes/partners-config.ts:81–82,198,258` |

### 3a. Whole-array read/write — covered by the D1 Sprint 3 serialization plan
All sites above that simply read the field or write a fresh array can be served by the serialize-on-write / deserialize-on-read middleware described in Sprint 3.

### 3b. **⚠ Array query operators — NOT covered by Sprint 3 as written**

Two production call sites use Prisma's native-array operators (`has`, `hasSome`). These translate to Postgres `&&` / `= ANY` and do **not** work against a JSON-encoded `String` column on SQLite:

| File | Line | Code |
|---|---|---|
| `services/partners.ts` | 323 | `isaSenderIds: { hasSome: sender }` |
| `services/partners.ts` | 324 | `isaReceiverIds: { hasSome: receiver }` |
| `services/partners.ts` | 379 | `isaSenderIds: { has: c.id }` / `isaReceiverIds: { has: c.id }` |

The two enclosing functions are:
- `assertNoIsaOverlap` (lines 306–339) — overlap check when a partner is created/updated.
- `resolvePartnerByIsa` (lines 360–384) — called once per ingested interchange to attach a partner record.

**Three options. Recommendation: A.**

- **(A) App-side filtering. Recommended.** Drop the `where` predicate, `findMany` all partners for the tenant (the tenant extension makes that tenant-scoped), then filter in JS using the same `Set`/`.includes` logic already present in the function. Tenants have a handful to a few hundred partners; cost is negligible. Works identically on both providers, no provider branching. The two existing tests at `apps/api/test/partners-config.test.ts:58–63` and `audit.test.ts:116–121` already mock these operators with JS filtering — switching production to JS filtering removes the gap rather than widening it.
- **(B) Provider-branched raw SQL.** `SELECT … WHERE json_each.value IN (…)` on SQLite, native ops on Postgres. Adds a code path the team has to remember; the schema-drift safety net does not protect raw SQL.
- **(C) Junction table.** New `partner_isa_id` model (`partnerId`, `value`, `side`) replacing the arrays entirely. Cleanest long-term, but a much larger change — touches the schema, the routes, the resolver, the partner detail UI, and migration of existing data. Out of scope for D1.

---

## 4. Enums

8 enums: `RawFileStatus`, `SourceChannel`, `Direction`, `PartnerStatus`, `UserRole`, `AlertType`, `AlertStatus`, `AlertSeverity`. Prisma maps each to a `TEXT` column with `CHECK` constraints on SQLite automatically. **No change required.**

---

## 5. DateTime / Timezone

- No `@db.Timestamptz`, `@db.Date`, or `@db.Time` anywhere in the schema (confirmed by grep).
- All `DateTime` columns are plain. Prisma stores ISO-8601 `TEXT` on SQLite and parses back to JS `Date`. **Acceptable for v1.** Existing comparisons (`runAfter <= now`, `createdAt` ordering) are lexicographic on ISO-8601, which is order-preserving.

---

## 6. Summary of changes the SQLite schema (`schema.sqlite.prisma`) will need

1. `datasource db` provider → `sqlite`.
2. Remove `@db.Uuid` from all 28 columns.
3. Convert the 4 `String[]` columns to `String @default("[]")` (semantics: JSON-serialized array).
4. Leave all `Json`, enum, and `DateTime` columns unchanged.
5. Verify after generation: `prisma migrate dev --schema=schema.sqlite.prisma` on a fresh file completes; check that enums emit CHECK constraints rather than raw `TEXT`.

## 7. Code changes required outside the schema (Sprint 3+)

1. JSON serialization middleware for the 4 array fields, gated on `DATABASE_PROVIDER=sqlite` (per Sprint 3 plan).
2. **Plus the unscoped item: rewrite `assertNoIsaOverlap` and `resolvePartnerByIsa` in `services/partners.ts` to app-side filtering** so they work on both providers without the array operators. Recommendation is to do this in Sprint 3 alongside the serialization middleware, since both edits live in the same code area.

---

## Open question for Keagan

Sprint 3 as written says "serialize on write, deserialize on read" but does not address the `hasSome` / `has` operators in `services/partners.ts`. Approve **option A (app-side filtering)** as part of Sprint 3 scope, or pick another option?
