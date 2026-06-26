# EDI Data Hub — Product Roadmap (v1 Working Draft)

**Owner:** Keagan
**Status:** In active build — Phases **0–10 code-complete in the repo** (Milestones M1, M2, M3, M4, M5 all reached in code). Outstanding before first paying external customer: **production deploy / operator wiring** (`ops/PRE_PRODUCTION_TODO.md`), **UI overhaul** (`PHASE_UI_PLAN.md`, gates open), and **Phase 11 Commercialization + Phase 12 External Pilot**. See **Build Progress** below.
**Build agent:** Claude Opus 4.8
**Initial test environment / free pilot user:** Your employer (internal only)
**Commercial model:** Standalone product, sold by you, independent of OverAI/Perygee

---

## Build Progress  *(living status — updated 2026-06-22)*

**Where we are:** Code for Phases **0 through 10 is in the repo**. Milestones **M1 ("It's real")**, **M2 ("Core value" — lifecycle stitching)**, **M3 ("Internal MVP" — monitoring + alerting)**, **M4 ("Sellable" — multi-tenant, RBAC, audit)**, and **M5 ("Production-ready" — retention, rate limits, load-test harness, runbooks)** are all reached *in code*. **278 automated test cases** across 39 files (183 API + 46 parser + 15 db + 34 web); typecheck, lint, and the web build are all green.

**What "code-complete" does NOT mean:** the production deploy is not done. `ops/PRE_PRODUCTION_TODO.md` is the operator checklist of credentialed / wall-clock work that has to happen before an external customer can use the hub — Terraform applies, Clerk live keys, ECS scheduled tasks, the first restore drill in staging. Code is in; environments are not.

| Phase | Status | What exists now |
|---|---|---|
| 0 — Decisions & Scaffolding | ✅ Substantially done | npm-workspaces monorepo (`api` / `web` / `edi-parser` / `db` / `shared`), TypeScript project refs, ESLint + Prettier, GitHub Actions CI, `docker-compose` (Postgres + MinIO + SFTP). *Still pending: a cloud "hello world" deploy + a formal one-page ADR; **the repo is not yet under git / not pushed to a remote** — fix before next change lands.* |
| 1 — Ingestion Spike | ✅ Complete | `POST /ingest/upload` + SFTP folder-watch over one shared pipeline; raw bytes streamed to S3/MinIO; SHA-256; ISA-control-number dedup; structured logging; S3 retry/backoff; full failure-mode coverage; `/health`. Verified end-to-end against real Postgres + S3 on the pilot machine. |
| 2 — X12 Parser & Structured Storage | ✅ Complete | `@edi/edi-parser` decomposes ISA→GS→ST/SE→segment→element; persisted to `interchanges / functional_groups / transactions / segments / elements`; **850 + 810** typed interpreters + semantic labels + business keys (PO/invoice); deviation tolerance (Z-segments, 5010, CRLF, etc.); per-transaction `PARSE_ERROR` that preserves sibling transactions; idempotent re-parse + `npm run backfill`. |
| 3 — Data Hub UI *(M1)* | ✅ Complete | React + Vite + Tailwind app: filterable/paginated transactions list, detail view (typed header + line items + labeled element tree), **raw-vs-parsed toggle**, global search (PO/invoice/ISA), URL-reflected filters, loading/empty/error states. Read API: list filters, `/partners`, `/raw-files/:id/content`, `/search`, `/transactions/:id`. |
| 4 — Lifecycle Stitching *(M2 · North Star)* | ✅ Code-complete | `services/lifecycle.ts` + `routes/lifecycle.ts` + `LifecyclePage.tsx`; 850/855/856/810 linked by PO; 997 acks linked to their referenced group/transaction; chronological status-aware timeline; missing-document gaps surfaced rather than errored. Covered by `apps/api/test/lifecycle.test.ts` + `apps/web/test/LifecyclePage.test.tsx`. |
| 5 — 997/999 Acknowledgment Intelligence | ✅ Code-complete | `services/ack-decoder.ts` parses AK1/AK2/AK3/AK4/AK5 + IK segments; `services/rejection.ts` exposes per-partner rejection rates; ack-to-original linkage stored on `Transaction` (acked group / transaction controls + status). Covered by `ack-decoder.test.ts`. |
| 6 — Trading Partner Configuration | ✅ Code-complete | `TradingPartner` model + `routes/partners-config.ts` + `services/partners.ts` + `PartnersConfigPage.tsx`: supported sets, SLA windows per transaction type, escalation contacts (email-only — phone/Slack handles deferred to §12), connectivity metadata. Consumed by detection in Phase 7. |
| 7 — Monitoring & Alerting *(M3)* | ✅ Code-complete | `services/detection.ts` + `services/alerts.ts` + `services/notifier.ts` + `routes/alerts.ts` + `AlertsPage.tsx`: missing-ack detection vs. partner SLA; rejection-rate spike detection; email (SES) + Slack webhook delivery; alert history + acknowledgment. **Scheduler is cron / Windows Task Scheduler against `npm run detect`** — BullMQ deferred (see §12). |
| 8 — Outbound Visibility & Second Ingestion Channel | ✅ Code-complete | Outbound `generated → transmitted → confirmed` state surfaced (`OutboundStage.tsx`, `confirmed-at` backfill). Channel registry abstraction: `apps/api/src/channels/{registry,drop-folder,as2,types}.ts`; second channel is **AS2** (OpenAS2 container under `infra/openas2`, covered by `as2.test.ts` + `channels-registry.test.ts`). |
| 9 — Multi-Tenancy, Auth & Security *(M4)* | ✅ Code-complete | `Tenant` + `User` + `AuditEvent` models; `packages/db/src/tenant-extension.ts` enforces tenant scoping on every multi-tenant model; `apps/api/src/plugins/rbac.ts` enforces `viewer/ops/admin`; `services/audit.ts` `withAudit` wraps every mutating route; Clerk integration (`webhooks.ts` + `CLERK_SETUP.md`); secrets via AWS Secrets Manager (`services/secrets.ts` + `infra/secrets.tf`). Covered by `isolation.test.ts`, `route-role-matrix.test.ts`, `audit.test.ts`, `auth.test.ts`, `tenant-context.test.ts`, `tenant-extension.test.ts`. |
| 10 — Production Readiness & Operations *(M5)* | ✅ Code-complete | Retention worker (`services/retention.ts` + `scripts/run-retention.ts`) — per-tenant TTLs on raw files / parsed tree / audit / alerts. Rate limits (`rate-limit.test.ts`, per-tenant + per-IP buckets, `X-RateLimit-*` headers, `429 + Retry-After`). Security headers (`security-headers.test.ts`). Observability: `/internal/metrics` + `/readiness` + CloudWatch log group (`infra/logs.tf`). Backups: `infra/backups.tf` + `infra/backup-task.tf` + `ops/scripts/restore-from-pgdump.sh` + `ops/RESTORE_LOG.md`. Load test harness: `ops/load/k6` + `ops/load/baseline.md`. Runbooks: `ops/RUNBOOKS.md` + `ops/SUPPORT.md`. *Pending: actually applying Terraform, running the first restore drill, running k6 against staging — see `ops/PRE_PRODUCTION_TODO.md`.* |
| UI Overhaul *(cross-phase polish)* | 📝 Draft | `PHASE_UI_PLAN.md` written 2026-06-22, decision gates A/B/C open (accent color, dark mode, component library). Scope rule: must serve lifecycle/alerts readability — not theming for theming's sake. |
| 11 — Commercialization Layer | ⏳ Not started | Stripe billing, subscription tiers, self-serve onboarding, ToS / Privacy / DPA, marketing site. Resolve Gate 4 (self-serve vs. direct sales). |
| 12 — Pilot → First External Customer *(M6)* | ⏳ Not started | Recruit 1–2 non-employer design partners; convert to first paid contract. |

**Sprint plans on disk:** `PHASE_8_SPRINT_PLAN.md`, `PHASE_9_SPRINT_PLAN.md`, `PHASE_10_SPRINT_PLAN.md`, `PHASE_UI_PLAN.md`. *(PHASE_1–7 sprint plans were used in-flight and are no longer kept once the phase shipped; the BUILD_PLAN is the canonical record.)* Parsing deviation catalog: `docs/EDI_DEVIATIONS.md`. Security sign-off list: `SECURITY_CHECKLIST.md`. Operator deploy checklist: `ops/PRE_PRODUCTION_TODO.md`.

**Decisions confirmed so far:** SaaS (not on-prem); AWS (S3, RDS, ECS, ALB, SES, Secrets Manager, CloudWatch) + MinIO locally; passive-copy ingestion (SFTP, authenticated upload, AS2); first sets **850 + 810** parsed end-to-end, 855/856/997 linked through lifecycle + ack decoder; X12 **4010** primary with 5010 tolerated; **multi-tenant** with tenant context + RBAC + audit (Phase 9 retrofit done); auth via **Clerk** (live keys still to be wired per `ops/PRE_PRODUCTION_TODO.md`); detection scheduler is **cron / Task Scheduler** (BullMQ deferred — see §12).

## What's left to do

**1. Foundation gap (do today):** put the repo under git and push to a private remote. Currently no `.git/` directory exists.

**2. Production deploy (operator work, ~1–2 weeks wall-clock):** work through `ops/PRE_PRODUCTION_TODO.md` end-to-end — Terraform applies for VPC/RDS/ALB/S3/Secrets, populate Secrets Manager with live values, wire Clerk live keys + webhook, ECS task definitions for API + retention worker, run the first backup-restore drill in staging, run k6 against the deployed staging URL to confirm load targets. Until this is done, M5 is reached in code only.

**3. UI Overhaul (1–2 sprints):** resolve `PHASE_UI_PLAN.md` decision gates A/B/C, then execute. Hold the scope to lifecycle/alerts readability — apply the anti-drift rule.

**4. Phase 11 — Commercialization (4–6 weeks):** Stripe + tiers, self-serve onboarding flow, customer-facing docs, marketing/landing site, ToS / Privacy / DPA. Resolve **Gate 4** (self-serve vs. direct sales) before starting.

**5. Phase 12 — First external customer:** recruit 1–2 non-employer design partners; structured feedback loop; convert to first paid contract. **M6 — In market.**

**6. Open Questions from §10 that are still open in writing:** **Q7 (data rights / IP ownership re: employer)** and **Q11 (business entity)** — both flagged as blockers in the original plan, both ungated and now eight phases past their stated gate. Resolve and record before commercialization.

**7. Deferred-not-rejected items in §12** — review the list at the start of each Phase 11/12 sprint; some (BullMQ scheduler, per-tenant `OUR_ISA_IDS` if not yet done, PagerDuty, ML rejection-rate detection) may belong in the commercial tier rather than the base build.

---

## 1. The Objective (Do Not Drift From This)

Build an **EDI observability platform** — not an ERP, not EDI middleware, not a VAN. The hub **monitors, views, searches, troubleshoots, and traces** X12 transactions that a company's *existing* systems already send and receive. It ingests **passive copies** of those files (inbound and outbound), decomposes them into structured data, and presents one place to understand what happened across the order-to-invoice loop.

**What this product is NOT:** Customers do **not** use EDI Hub to transmit EDI to trading partners, generate production 855/810 documents for sending, replace their ERP, or sit in the live transmission path. Their ERP, VAN, or AS2/SFTP middleware continues to handle send/receive. The hub only observes copies of that traffic.

**The North Star feature** is *transaction lifecycle stitching*: pull up a PO number and see every related document — the 850, 855, 856, 810, and all 997s — in one chronological, status-aware view. Everything else exists to support monitoring, troubleshooting, alerting, and stability.

**Anti-drift rule:** Before adding any feature not on this roadmap, write one sentence explaining how it serves monitoring, troubleshooting, alerting, or stability. If you can't — or if the feature involves **generating, mapping, translating, or transmitting** EDI — it is out of scope.

---

## 2. Guiding Principles

1. **De-risk the hardest thing first.** Ingestion and parsing of real-world (non-textbook) EDI is the biggest technical risk. We attack it in the first 30% of the build, not the last.
2. **Every phase ends in something you can see working.** No phase is "done" until you can demo a tangible result, ideally against real data from your test environment.
3. **Single-tenant value before multi-tenant complexity.** Prove the product is genuinely useful for one company (your pilot) before investing in the SaaS plumbing required to sell it to many.
4. **Never discard the raw file.** Store the original transmission alongside the parsed structure, always. Audits, disputes, and edge-case debugging depend on it.
5. **Passive observability over active interception.** The hub reads *copies* of transactions from drop folders, SFTP, or AS2 inboxes — it never replaces the customer's send/receive stack. Ingestion channels are **read-only observers**, not transmission endpoints.

---

## 3. Flagged Assumptions (Confirm or Correct Each)

| # | Assumption | Affects |
|---|---|---|
| A1 | Deployment is cloud-hosted SaaS (you host; customers access via web), not on-prem/self-hosted installs. | Phases 0, 9, 10, 11 |
| A2 | You validate single-tenant at the pilot first, then add multi-tenancy before selling externally. | Phase 9 placement |
| A3 | Ingestion is passive — you receive a copy of files via SFTP folder / mailbox export, not by intercepting live AS2. | Phases 1, 8 |
| A4 | First transaction sets supported: 850, 855, 856, 810, 997/999 (the core order-to-invoice loop). | Phases 2, 4, 5 |
| A5 | Primary X12 version is 4010 (extendable later). | Phase 2 |
| A6 | Tech stack: React + Tailwind (front end), Node or Python (API), PostgreSQL (structured data), object storage for raw files. | All build phases |
| A7 | You have, or will form, a separate business entity to own and sell this product. | Phase 11, legal |

---

## 4. Recommended Tech Stack

> Selected for solo-builder velocity, TypeScript end-to-end coherence, and strong Opus 4.8 code-gen coverage.

### Frontend
- **React + Vite** — fast dev experience, massive ecosystem
- **Tailwind CSS** — utility-first, pairs naturally with shadcn/ui
- **shadcn/ui** — copy-paste components built on Radix; professional UI without fighting a design system

### Backend / API
- **Node.js + Fastify** — JavaScript end-to-end, less context switching solo; Fastify is faster than Express with better TypeScript support
- **TypeScript throughout** — catches bugs in EDI parsing logic where a mistyped field can silently corrupt data; typed schemas per transaction set (850, 810, etc.)

### Database
- **PostgreSQL** — relational structure for envelope/segment/element hierarchy, strong JSON support for semi-structured storage, mature and well-understood
- **Prisma** (ORM) — excellent TypeScript integration, straightforward migrations, great solo DX

### Raw File Storage
- **AWS S3** (or Cloudflare R2 for cheaper egress) — object storage for raw EDI files, referenced by key in Postgres

### Background Jobs
- **BullMQ** — Redis-backed job queue, Node-native; required for Phase 7 missing-ack detection

### Infrastructure
- **AWS** — ECS (containers), RDS (Postgres), S3, SES (email alerts); broadest EDI ecosystem familiarity, enterprise buyer comfort
- **Terraform** — infrastructure as code from day one; pays off when tenants are added in Phase 9

### Auth
- **Clerk** or **Auth0** — don't build auth. Clerk is faster to integrate with a generous free tier; Auth0 is more enterprise-friendly for SSO. Either works for Phase 0; both support RBAC for Phase 9.

### CI/CD
- **GitHub Actions** — free, zero setup friction, sufficient for solo builds

### Key Decision: TypeScript Everywhere
Use TypeScript throughout — both frontend and backend. EDI parsing is a data transformation problem where a mistyped field produces silent wrong values in production. A typed schema for each transaction set catches these at build time.

---

## 5. Decision Gates

- **Gate 1 (before Phase 0):** SaaS vs. self-hosted.
- **Gate 2 (before Phase 1):** How you physically obtain a copy of EDI traffic in your test environment, and whether you are cleared to use that data.
- **Gate 3 (before Phase 9):** Multi-tenant-from-day-one vs. retrofit after pilot.
- **Gate 4 (before Phase 11):** Self-serve (Stripe checkout) vs. direct/contract sales.

---

## 6. Phase Plan

> Effort estimates assume **15–25 hrs/week, solo, with Opus 4.8 accelerating code generation**.

### Phase 0 — Decisions & Scaffolding  ✅ *(substantially complete)*
**Goal:** Lock architecture decisions and stand up a skeleton you can build on.
**Tangible result:** A deployed "hello world" app on your chosen host, a live repo with CI, and a one-page Architecture Decision Record (ADR) capturing Gates 1–4.
**Key tasks:** Resolve Gate 1; choose stack and host; set up repo, CI/CD, dev + staging environments; write the ADR; set up secrets management from the start.
**Exit criteria:** App deploys automatically on push; ADR signed off; dev/staging live.
**Effort:** 1–2 weeks.

### Phase 1 — Ingestion Spike *(hardest risk, attacked early)*  ✅ COMPLETE
**Goal:** Prove you can reliably get a real EDI file from your test environment into the system, for ONE method and ONE transaction set.
**Tangible result:** A real 850 from your pilot lands in the system; the raw file is stored, deduplicated, and viewable.
**Key tasks:** Resolve Gate 2; build the smallest viable ingestion (likely SFTP folder-watch or authenticated upload); raw file storage; duplicate detection on control numbers; ingestion logging + retry.
**Exit criteria:** Files ingest reliably and idempotently; raw is stored and retrievable; failures are logged, not silent.
**Effort:** 2–3 weeks.

### Phase 2 — X12 Parser & Structured Storage  ✅ COMPLETE
**Goal:** Decompose ingested files to the segment/element level and persist them in PostgreSQL.
**Tangible result:** An ingested 850 is queryable down to individual segments and elements in the database, and renders in a basic table.
**Key tasks:** Envelope parsing (ISA/GS/ST/SE/GE/IEA); transaction-set parsing for chosen sets; relational schema; graceful handling of malformed input; semantic labeling.
**Exit criteria:** Chosen sets parse correctly including envelope; malformed input fails gracefully; raw-to-parsed linkage intact.
**Effort:** 3–4 weeks.

### Phase 3 — The Data Hub UI (Read-Only Browser)  ✅ COMPLETE *(M1 reached)*
**Goal:** Build the core viewing experience.
**Tangible result:** Log in and browse every ingested transaction, filter by partner/type/date, drill into any one down to the segment level with a raw-vs-parsed toggle.
**Exit criteria:** List, detail, raw/parsed toggle, and basic search all functional against pilot data.
**Effort:** 3–4 weeks.
**Milestone — "It's real."**

### Phase 4 — Transaction Lifecycle Stitching *(North Star)*  ✅ CODE-COMPLETE *(M2 reached)*
**Goal:** Link related transactions into one business-transaction view.
**Tangible result:** Enter a PO number → see the 850, 855, 856, 810, and all associated 997s in chronological order, each with a status indicator.
**Exit criteria:** A real PO from your pilot renders a complete, correct lifecycle. Missing-document cases shown as gaps, not errors.
**Effort:** 3–5 weeks.
**Milestone — Core product value achieved.**

### Phase 5 — 997/999 Acknowledgment Intelligence  ✅ CODE-COMPLETE
**Goal:** Turn 997s into an operational signal.
**Tangible result:** A rejected 997 shows exactly which segment and element failed, in plain English.
**Effort:** 2–3 weeks.

### Phase 6 — Trading Partner Configuration Layer  ✅ CODE-COMPLETE
**Goal:** Give the system a definition of "normal" per partner.
**Effort:** ~2 weeks.

### Phase 7 — Monitoring & Alerting  ✅ CODE-COMPLETE *(M3 reached)*
**Goal:** Move from "view what happened" to "tell me when something's wrong."
**Tangible result:** Alert when an expected acknowledgment doesn't arrive within a partner's configured SLA window.
**Effort:** 3–4 weeks.
**Milestone — Internal MVP (M3).**

### Phase 8 — Outbound Visibility & Second Ingestion Channel  ✅ CODE-COMPLETE
Second channel landed as **AS2** (OpenAS2). Outbound state model: generated → transmitted → confirmed.
**Effort:** 2–4 weeks.

### Phase 9 — Multi-Tenancy, Auth & Security Hardening  ✅ CODE-COMPLETE *(M4 reached)*
**Goal:** Convert a validated single-company tool into a secure product you can sell.
Tenant context + Prisma extension, RBAC (`viewer/ops/admin`), audit log on every mutation, Clerk auth, AWS Secrets Manager. Isolation, role-matrix, and audit tests in place.
**Effort:** 4–6 weeks.
**Milestone — "Sellable" boundary (M4).**

### Phase 10 — Production Readiness & Operations  ✅ CODE-COMPLETE *(M5 reached in code)*
Retention worker, rate limits, security headers, observability endpoints, CloudWatch log group, backups + restore script, k6 load harness, runbooks. **Deploy / drill work tracked in `ops/PRE_PRODUCTION_TODO.md`** — until that is signed off, M5 is reached in code only.
**Effort:** 2–4 weeks.
**Milestone — Production-ready (M5).**

### UI Overhaul *(cross-phase polish)*  📝 DRAFT
`PHASE_UI_PLAN.md` written 2026-06-22. Decision gates A (accent color), B (dark-mode timing), C (component library) are open. Scope must serve lifecycle/alerts readability — anti-drift rule applies.

### Phase 11 — Commercialization Layer  ⏳ NOT STARTED
Stripe + tiers, self-serve onboarding, customer-facing docs, marketing site, ToS / Privacy / DPA. Resolve Gate 4 (self-serve vs. direct sales) first.
**Effort:** 4–6 weeks.

### Phase 12 — Pilot → First External Customer  ⏳ NOT STARTED
**Milestone — In market (M6).**

---

## 7. Milestone Summary

| Milestone | Reached after | What it proves |
|---|---|---|
| **M1 — It's real** | Phase 3 | Real transactions visible and searchable |
| **M2 — Core value** | Phase 4 | Lifecycle view exists; this is the actual product |
| **M3 — Internal MVP** | Phase 7 | Monitoring, troubleshooting, and alerting work for your pilot |
| **M4 — Sellable** | Phase 9 | Secure, multi-tenant; safe to put in another company's hands |
| **M5 — Production-ready** | Phase 10 | Survivable, recoverable, performant |
| **M6 — In market** | Phase 12 | A paying external customer |

---

## 8. Realistic Calendar Expectation

At 15–25 hrs/week, solo, with Opus 4.8:

- **Internal MVP (M3):** ~4–6 months
- **Sellable + production-ready (M4–M5):** add ~3–5 months
- **First external customer (M6):** total ~9–14 months from start

---

## 9. Explicitly Out of Scope for v1

**EDI transmission and production document generation (never in scope for this product):**

- Sending or receiving EDI on behalf of the customer (no VAN, no AS2/SFTP **outbound** delivery to partners)
- Generating production 850/855/856/810/997 documents for transmission (that is the ERP/middleware's job)
- Replacing or competing with ERP, WMS, or EDI translation/mapping middleware
- Sitting in the live transmission path between trading partners
- A mapping/translation editor
- Direct ERP connectors (beyond passive file copies)
- Deduction/chargeback dispute workflows

**The EDI pipeline stop point:** Ingest copy → store raw file → parse → persist → search/lifecycle/alert. **Full stop.** No step after that produces or delivers EDI to a partner. Desktop "drop folders" and SaaS ingestion channels exist only to **receive copies for observation** (including copies of outbound documents the customer's other systems already sent).

---

## 10. Open Questions

**Blocking — Architecture & Deployment**
1. SaaS you host, or self-hosted/on-prem?
2. Cloud provider preference (AWS, Azure, GCP, Cloudflare)?
3. Multi-tenant from day one, or single-tenant first?

**Blocking — Ingestion**
4. How do transactions physically arrive and leave today (VAN mailbox, AS2, SFTP, ERP-managed)?
5. Can the hub receive a *copy* (passive), or must it sit in the live path?
6. Are files raw X12, or wrapped/transformed by an ERP layer?

**Blocking — Data Rights**
7. Are you cleared to use your employer's real EDI data to build and test a product you personally own?

**Scope**
8. Confirm first transaction sets: 850, 855, 856, 810, 997/999.
9. Confirm primary X12 version: 4010. Any 5010 traffic?
10. Inbound + outbound from the start, or inbound first?

**Business & Resourcing**
11. Do you have a business entity, or plan to form one?
12. Target for first external paying customer — date or value-driven?
13. Comfort level with cloud/devops, multi-tenant auth, Stripe billing, front-end at scale?
14. Rough monthly infrastructure budget during the build?
15. End goal: side income alongside 9-5, or a path to replacing it?

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Real trading-partner data deviates from spec | High | High | Attack parsing early (Phase 2); store raw always; fail gracefully |
| Ingestion access harder than expected | Medium | High | Phase 1 is a dedicated spike to prove it before building on top |
| IP/data-rights complication | Medium | High | Resolve Section 10 before Phase 1; use synthetic data early |
| Scope creep into adjacent products | High | Medium | Anti-drift rule; strict v1 exclusions |
| Security/multi-tenancy underestimated | Medium | High | Treat Phase 9 as large, less-compressible; isolation verified not assumed |
| Solo + 9-5 burnout / stall | Medium | Medium | Every phase ends in a demoable win to sustain momentum |
| Pilot data doesn't generalize to other buyers | Medium | Medium | Recruit a non-employer design partner early in Phase 12 |

---

## 12. Future Features (deferred but tracked)

Items we've explicitly chosen not to build right now, but that we've agreed
should land later. This is *deferred-not-rejected* — distinct from Section 9
("Out of Scope for v1") which is "we will never build this in v1." Living
list; add to it whenever a decision gate defers something concrete.

### From Phase 6 (Trading Partner Configuration)

- **Richer escalation contacts** — phone numbers, Slack handles, on-call
  rotations alongside the email-only model. (Phase 6 Q9.) Likely lands when
  alerting (Phase 7) calls for paging.
- **Calendar-aware SLAs** — business hours, weekday-only, holiday windows
  layered on the flat `withinMinutes` model. (Phase 6 Q7.) Defer until the
  pilot has lived with the flat model and surfaced a false-alert pattern.
- **Per-partner dictionary override UI** — Phase 6 captures the override
  schema and reads it; the editor for it stays "edit JSON in the partner
  profile" until ops wants a structured form.

### From Phase 5 (Ack Intelligence)

- **999 IK3/IK4 deep parsing** — pilot is 997-only; light up when a 5010
  partner needs it.

### Carried forward from earlier phases

- **Per-tenant `OUR_ISA_IDS`** — currently a single global env var.
  Phase 9 (Multi-Tenancy) replaces with per-tenant config.

### How to add to this list

When a sprint plan defers something concrete, drop a one-line bullet here
with the originating gate/question and a phrase about when it likely lands.
Keep it short — sprint plans are the source of truth for *why*; this section
is just the index.
### From Phase 7 (Monitoring & Alerting)

- **BullMQ + Redis scheduler** — Phase 7 Sprint 2 was originally planning
  this, but pilot uses cron / Windows Task Scheduler against `npm run detect`
  instead. Move to BullMQ when sub-minute cadence or queue-style observability
  becomes worth the Redis dependency.
- **Stale-traffic alert** — fires when a partner's last ingestion is older
  than 2x their highest SLA. Useful as the underlying signal when a
  connectivity outage is the root cause. Deferred from Phase 7 Sprint 3 Q10.
- **PagerDuty / Opsgenie integration** — beyond email + Slack.
- **Escalation chains** — notify A, then B if not acked in N minutes.
- **Calendar-aware quiet hours** for delivery (alongside the calendar-aware
  SLAs already on this list).
- **ML-based anomaly detection on rejection rate** — beyond the flat
  threshold in Phase 7 Gate D.

