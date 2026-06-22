# EDI Data Hub — Product Roadmap (v1 Working Draft)

**Owner:** Keagan
**Status:** In active build — Phases 1–3 COMPLETE (Milestone **M1 "It's real"** reached); Phase 4 (North Star) is next. See **Build Progress** below.
**Build agent:** Claude Opus 4.8
**Initial test environment / free pilot user:** Your employer (internal only)
**Commercial model:** Standalone product, sold by you, independent of OverAI/Perygee

---

## Build Progress  *(living status — updated as phases land)*

**Where we are:** Phases **1–3 complete and verified**; Milestone **M1 ("It's real")** reached. Phase **4 — Transaction Lifecycle Stitching** (the North Star, Milestone M2) is planned (`PHASE_4_SPRINT_PLAN.md`) and ready to start. **63 automated tests** passing (58 backend + 5 web); typecheck, lint, and the web build are all green.

| Phase | Status | What exists now |
|---|---|---|
| 0 — Decisions & Scaffolding | ✅ Substantially done | npm-workspaces monorepo (`api` / `web` / `edi-parser` / `db` / `shared`), TypeScript project refs, ESLint + Prettier, GitHub Actions CI, `docker-compose` (Postgres + MinIO + SFTP). *Pending: a cloud "hello world" deploy + a formal one-page ADR (deferred until first deploy is needed).* |
| 1 — Ingestion Spike | ✅ Complete | `POST /ingest/upload` + SFTP folder-watch over one shared pipeline; raw bytes streamed to S3/MinIO; SHA-256; ISA-control-number dedup; structured pino logging; S3 retry/backoff; full failure-mode coverage; `/health`. **Verified end-to-end against real Postgres + S3** (smoke test passed on the pilot machine). |
| 2 — X12 Parser & Structured Storage | ✅ Complete | `@edi/edi-parser` decomposes ISA→GS→ST/SE→segment→element (batched-safe); persisted to `interchanges / functional_groups / transactions / segments / elements`; **850 + 810** typed interpreters + semantic labels + business keys (PO/invoice); deviation tolerance (Z-segments, 5010, CRLF, etc.); per-transaction `PARSE_ERROR` that preserves sibling transactions; idempotent re-parse + `npm run backfill`. |
| 3 — Data Hub UI *(M1)* | ✅ Complete | React + Vite + Tailwind app: filterable/paginated transactions list, detail view (typed header + line items + labeled element tree), **raw-vs-parsed toggle**, global search (PO/invoice/ISA), URL-reflected filters, loading/empty/error states. New read API: list filters, `/partners`, `/raw-files/:id/content`, `/search`, `/transactions/:id`. |
| 4 — Lifecycle Stitching *(M2 · North Star)* | ▶ **Next** | Planned in `PHASE_4_SPRINT_PLAN.md` (link 850/855/856/810 by PO + 997 acks; chronological status-aware timeline). |
| 5 – 12 | ⏳ Not started | Per the phase plan below. |

**Sprint plans:** `PHASE_1_SPRINT_PLAN.md`, `PHASE_2_SPRINT_PLAN.md`, `PHASE_3_SPRINT_PLAN.md`, `PHASE_4_SPRINT_PLAN.md`. Parsing deviation catalog: `docs/EDI_DEVIATIONS.md`.

**Decisions confirmed so far:** SaaS (not on-prem); AWS S3 / MinIO object storage + PostgreSQL; passive-copy ingestion (SFTP / authenticated upload); first sets **850 + 810** parsed (855/856/997 arrive in Phase 4/5); X12 **4010** primary with 5010 tolerated; **single-tenant first** (multi-tenancy in Phase 9); UI **ungated on localhost** for the internal pilot (real auth in Phase 9); parsing runs **inline** for now (BullMQ deferred to Phase 7).

---

## 1. The Objective (Do Not Drift From This)

Build an EDI observability platform that **ingests inbound and outbound EDI transactions, decomposes them into structured data, and presents a single hub** where every transaction can be monitored, searched, troubleshot, and alerted on — so a business can maintain stability across all of its EDI traffic.

**The North Star feature** is *transaction lifecycle stitching*: the ability to pull up a single business transaction (a PO, an invoice, a shipment) and see every related EDI document — the 850, 855, 856, 810, and every 997 — in one chronological, status-aware view. Everything else in this product exists to support that. If a feature does not make the hub more useful for monitoring, troubleshooting, or stability, it is out of scope for v1.

**Anti-drift rule:** Before adding any feature not on this roadmap, write one sentence explaining how it serves monitoring, troubleshooting, alerting, or stability. If you can't, it waits.

---

## 2. Guiding Principles

1. **De-risk the hardest thing first.** Ingestion and parsing of real-world (non-textbook) EDI is the biggest technical risk. We attack it in the first 30% of the build, not the last.
2. **Every phase ends in something you can see working.** No phase is "done" until you can demo a tangible result, ideally against real data from your test environment.
3. **Single-tenant value before multi-tenant complexity.** Prove the product is genuinely useful for one company (your pilot) before investing in the SaaS plumbing required to sell it to many.
4. **Never discard the raw file.** Store the original transmission alongside the parsed structure, always. Audits, disputes, and edge-case debugging depend on it.
5. **Passive observability over active interception.** The hub should read *copies* of transactions, not sit in the live transmission path. This is safer, simpler, and a far easier sell to security-conscious buyers.

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

### Phase 4 — Transaction Lifecycle Stitching *(North Star)*  ▶ NEXT
**Goal:** Link related transactions into one business-transaction view.
**Tangible result:** Enter a PO number → see the 850, 855, 856, 810, and all associated 997s in chronological order, each with a status indicator.
**Exit criteria:** A real PO from your pilot renders a complete, correct lifecycle. Missing-document cases shown as gaps, not errors.
**Effort:** 3–5 weeks.
**Milestone — Core product value achieved.**

### Phase 5 — 997/999 Acknowledgment Intelligence
**Goal:** Turn 997s into an operational signal.
**Tangible result:** A rejected 997 shows exactly which segment and element failed, in plain English.
**Effort:** 2–3 weeks.

### Phase 6 — Trading Partner Configuration Layer
**Goal:** Give the system a definition of "normal" per partner.
**Effort:** ~2 weeks.

### Phase 7 — Monitoring & Alerting
**Goal:** Move from "view what happened" to "tell me when something's wrong."
**Tangible result:** Alert when an expected acknowledgment doesn't arrive within a partner's configured SLA window.
**Effort:** 3–4 weeks.
**Milestone — Internal MVP (M3).**

### Phase 8 — Outbound Visibility & Second Ingestion Channel
**Effort:** 2–4 weeks.

### Phase 9 — Multi-Tenancy, Auth & Security Hardening
**Goal:** Convert a validated single-company tool into a secure product you can sell.
**Effort:** 4–6 weeks.
**Milestone — "Sellable" boundary (M4).**

### Phase 10 — Production Readiness & Operations
**Effort:** 2–4 weeks.
**Milestone — Production-ready (M5).**

### Phase 11 — Commercialization Layer
**Effort:** 4–6 weeks.

### Phase 12 — Pilot → First External Customer
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

- Building a VAN or any transmission capability
- A mapping/translation editor
- Direct ERP connectors
- Deduction/chargeback dispute workflows
- Anything requiring sitting in the live transmission path

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

