# OAG CLIENT ENGAGEMENT — MASTER SETUP GUIDE
### Done-For-You Digital Infrastructure | Built by Obsidian Axis Group
**Version:** 2.0 | **Author Role:** Cedric, Managing Partner — OAG (The Builder)
**Framework:** OIL → Interrogate · Delete · Simplify · Automate
**Audience:** Claude Code — read this before writing a single line of code

---

> ## WHO IS THIS DOCUMENT FOR?
>
> **OAG is the builder. The client is a lower middle market business ($10M–$50M revenue).
> Their customers are the end users who never touch this document.**
>
> This file is dropped into every client engagement repo. It tells Claude Code:
> - What we are building and for whom
> - The exact role of each platform in the client's stack
> - How data moves through the system (and what NEVER touches Google)
> - How to build and wire agents into the client's operations
> - The exact setup sequence from zero to live
>
> **Read this. Internalize the architecture. Then build.**
>
> ---
>
> **Before Day 1 — canonical Pre-Flight sources (not covered in this master doc):**
>
> - Consultant-facing playbook: `CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md` — Intelligence → Phase 0 → Coming Soon arc, Leg A account-creation sequence, verification-code relay protocol.
> - Client-facing deliverable: `CLIENT-PRE-FLIGHT-CHECKLIST.md` — hand to every new client at kickoff before any account is created.
>
> **The credential rule, in one line:** create the client's GitHub first, then use "Continue with GitHub" for Cloudflare and Supabase. Google Workspace is the one exception — the client must invite the consultant. No separate passwords. One identity anchor. Revocable at engagement close with one OAuth click per vendor.

---

## SECTION 0: THE ARCHITECTURE LAW

These rules are non-negotiable on every engagement. They exist because we've seen what breaks first.

```
╔══════════════════════════════════════════════════════════════╗
║              OAG ARCHITECTURE HIERARCHY                      ║
║                                                              ║
║  TIER 1 — CUSTOMER LAYER (External / Client's customers)     ║
║  └─ Cloudflare Pages + React UI                              ║
║     Polished, branded, fast. This is what their customers    ║
║     see. Never a Google product. Never a raw API response.   ║
║                                                              ║
║  TIER 2 — COMPUTE LAYER (The brain)                          ║
║  └─ Cloudflare Workers (Hono API)                            ║
║     All business logic, routing, agent orchestration,        ║
║     and AI calls live here. CF Worker is the hub.            ║
║                                                              ║
║  TIER 3 — DATA LAYER (The source of truth)                   ║
║  └─ Supabase (PostgreSQL)                                    ║
║     Every piece of client data that matters lives here.      ║
║     RLS on every table. Multi-tenant from day one.           ║
║                                                              ║
║  TIER 4 — AI LAYER (The cognitive engine)                    ║
║  └─ Claude / Anthropic API                                   ║
║     Wired into CF Workers. Powers agents, summaries,         ║
║     scoring, drafts, and autonomous ops tasks.               ║
║                                                              ║
║  TIER 5 — CODE LAYER (The record of truth)                   ║
║  └─ GitHub                                                   ║
║     Every line of code, every migration, every config.       ║
║     Deploys to CF on push. Never deploy manually.            ║
║                                                              ║
║  TIER 6 — MIRROR & COMMS LAYER (Internal client team)        ║
║  └─ Google Native (Sheets, Drive, Gmail, Calendar)           ║
║     The client's team lives here. Sheets mirror Supabase     ║
║     data. Agents reference Drive knowledge bases. Gmail      ║
║     is the comms relay. GOOGLE NEVER STORES PRIMARY DATA.    ║
║     Data flows: Supabase/CF → Google. Never Google → DB.     ║
╚══════════════════════════════════════════════════════════════╝
```

### The Three Laws of OAG Data Architecture

**Law 1 — Supabase is the source of truth.**
If data matters to the business, it lives in Supabase. Not in a Sheet. Not in a Drive folder. Not in a KV store. Those are downstream mirrors and caches. Supabase holds the record.

**Law 2 — Google is a display and delivery surface.**
Google Sheets show what Supabase knows. Google Drive stores reference documents that agents can read. Gmail delivers messages that Cloudflare Workers compose and trigger. Google does NOT store business data. Google does NOT receive form submissions that go anywhere except a Cloudflare Worker endpoint first.

**Law 3 — Customers never touch Google.**
Everything a client's customer interacts with — portals, dashboards, forms, apps — is a Cloudflare Pages frontend built in React. Branded. Fast. Professional. The fact that the backend runs on Supabase and CF is invisible to them.

---

## SECTION 1: CLIENT STACK — PLATFORM ROLES

### 1.1 CLOUDFLARE — THE COMPUTE AND CUSTOMER LAYER

**Role:** Runs all business logic. Serves all customer-facing UIs. The center of the architecture.

#### What We Build Here (For the Client)

**Customer-Facing Apps (Cloudflare Pages + React)**
Every app a client's customer sees is built here:
- Client portals and dashboards
- Booking / scheduling interfaces
- Order or intake flows
- Account management UIs
- Public-facing marketing sites
- Branded document delivery (invoices, reports, proposals)

Design standard: **polished, branded, production-grade**. Not a template, not a Squarespace clone. Custom React components, client's color system, smooth interactions. The UX must be indistinguishable from a funded SaaS company.

**API Layer (Cloudflare Workers / Hono)**
Every data operation goes through a Worker:
- REST endpoints for all CRUD operations
- Auth middleware (validates Supabase JWTs)
- Webhook receivers (Stripe, Twilio, third-party integrations)
- Agent runtime (Claude tool-use calls orchestrated in a Worker)
- Cron jobs (scheduled Workers for nightly reports, data sync, etc.)
- Google Sheets sync (CF pushes data TO Sheets on schedule or trigger)

**Knowledge Buckets (CF KV + R2)**
The agent knowledge layer lives in Cloudflare:
- **KV** — Fast key-value lookups. Stores: SOPs, pricing rules, FAQs, config, session state, feature flags. Agents query KV by key. Sub-millisecond reads.
- **R2** — Object storage. Stores: PDF SOPs, training documents, contracts, reports, client uploads. Agents retrieve files from R2 by path. No egress fees.
- **D1** — SQLite at the edge. Stores: lightweight operational data that needs to be close to compute (audit logs, agent action logs, analytics events).
- **Vectorize** — Vector embeddings for semantic search. Agent asks a question → Vectorize finds the closest matching SOP or knowledge article. Powers RAG (Retrieval-Augmented Generation).

#### Free Tier Limits (Cloudflare)
| Resource | Free | Paid ($5/mo Workers) |
|---|---|---|
| Worker requests | 100K/day | 10M/month + $0.30/M |
| CPU per invocation | 10ms | 30 seconds |
| KV reads | 100K/day | 10M/month |
| KV writes | 1K/day | 1M/month |
| KV storage | 1 GB | Unlimited |
| D1 rows read | 5M/day | 25B/month |
| D1 storage | 5 GB | Unlimited |
| R2 storage | 10 GB | 10 GB free, then $0.015/GB |
| R2 egress | Free always | Free always |
| Pages deployments | Unlimited | Unlimited |
| Pages bandwidth | Unlimited | Unlimited |
| Vectorize queries | 30M/month | 50M/month |

> **Upgrade trigger:** Move to Workers Paid ($5/mo) the moment the engagement goes live with real users. The CPU jump from 10ms → 30s is the unlock that makes agent calls possible in a Worker.

---

### 1.2 SUPABASE — THE SOURCE OF TRUTH

**Role:** PostgreSQL database. Every piece of business data that matters to the client lives here. Auth. Storage. Realtime. Webhooks. The foundation.

#### What We Build Here (For the Client)

**Database Schema (Always multi-tenant from day one)**
```sql
-- Core tables present in every engagement
organizations     -- The client's business entity (or their accounts if B2B)
contacts          -- People: customers, leads, vendors, employees
accounts          -- B2B: companies the client sells to
deals / orders    -- Revenue-generating events
tasks             -- Operational tasks (human and agent-generated)
activity_log      -- Every action taken (human or agent), immutable
agent_runs        -- Log of every AI agent execution
documents         -- Metadata for files stored in R2/Storage
notifications     -- Queue for outbound comms (email, SMS, etc.)
```

**Row-Level Security (RLS) — Always On**
Every table has RLS enabled before any data is inserted. The pattern:
```sql
-- Tenants can only see their own data
CREATE POLICY "tenant_isolation" ON contacts
  FOR ALL USING (org_id = auth.jwt() -> 'org_id');
```

**Supabase Auth**
Google OAuth is the primary login method for the client's team. Customers log in via email magic link or password. All auth goes through Supabase — no rolling custom auth.

**Supabase Storage**
Binary files (PDFs, images, docs) that belong to a specific record are stored in Supabase Storage (S3-compatible). Files that are knowledge-base assets or public-facing go to Cloudflare R2.

**Realtime**
Any dashboard that needs live data (order status, agent activity feed, support queue) subscribes to Supabase Realtime channels. The CF Worker writes → Supabase broadcasts → React UI updates.

**Database Webhooks → Cloudflare Workers**
When a record changes in Supabase (new order, task completed, contact updated), a webhook fires to a Cloudflare Worker. The Worker decides what to do next: trigger an agent, send a notification, update Google Sheets, etc.

#### Free Tier Limits (Supabase)
| Resource | Free | Pro ($25/mo/project) |
|---|---|---|
| Database storage | 500 MB | 8 GB + $0.125/GB |
| File storage | 1 GB | 100 GB + $0.021/GB |
| Monthly active users | 50K | 100K |
| Bandwidth | 5 GB | 250 GB |
| Edge function invocations | 500K/month | 2M/month |
| Realtime connections | 200 | 500 |
| Backup retention | 7-day snapshots | Daily backups |
| Auto-pause (inactivity) | After 7 days | Never |
| Support | Community | Email |

> **Hard rule:** Upgrade to Pro ($25/mo) before any client user touches the system. The auto-pause on free tier is a silent killer for production tools.

---

### 1.3 CLAUDE / ANTHROPIC — THE AGENT AND AI LAYER

**Role:** Powers all AI features in the client's stack. Embedded in Cloudflare Workers. Runs agents, generates content, scores records, drafts comms, and executes autonomous ops tasks.

#### Models and When to Use Them

| Model | Cost (Input/Output per 1M tokens) | Use Case |
|---|---|---|
| Claude Haiku 4.5 | $0.80 / $4.00 | Classification, tagging, routing, quick extractions. High volume, low complexity. |
| Claude Sonnet 4.6 | $3.00 / $15.00 | **Default.** CRM summaries, agent task execution, email drafts, analysis, scoring. |
| Claude Opus 4.6 | $15.00 / $75.00 | Deep reasoning tasks only. Complex strategy, multi-step planning, edge cases. |

**Cost reality check:** 1,000 Sonnet calls (avg 600 input + 300 output tokens each) = **~$2.25/month**. The AI layer is not a budget concern until you're at thousands of calls per day.

#### Prompt Caching
Any system prompt longer than 1,024 tokens that gets reused on every call should have caching enabled. Cache reads cost ~10% of normal input price. On APEX-style tools where the system prompt encodes the entire client context, this reduces the AI line item by 70–80%.

#### Batch API
Any AI operation that doesn't need to be real-time (nightly scoring, bulk enrichment, report generation) should use the Batch API — 50% cheaper, processes within 24 hours, up to 10,000 prompts per batch.

---

### 1.4 GITHUB — THE CODE LAYER

**Role:** Source control, CI/CD, and the deployment trigger. Every Worker, every page, every migration is versioned here. Push to `main` → auto-deploy to Cloudflare.

#### Repo Structure (Every Client Engagement)
```
oag-{client-slug}/
├── README.md                    ← What this engagement is
├── ENGAGEMENT.md                ← This file (customized per client)
├── .env.example                 ← All env vars documented (no real values)
├── .gitignore
├── wrangler.toml                ← CF Workers + Pages config
├── package.json
├── tsconfig.json
│
├── src/                         ← Cloudflare Worker (API)
│   ├── index.ts                 ← Hono app entry point
│   ├── routes/
│   │   ├── auth.ts              ← Auth middleware + JWT validation
│   │   ├── contacts.ts          ← Contacts CRUD
│   │   ├── tasks.ts             ← Tasks CRUD
│   │   ├── agents.ts            ← Agent invocation endpoints
│   │   ├── webhooks.ts          ← Inbound webhooks (Stripe, Twilio, etc.)
│   │   └── sync.ts              ← Google Sheets sync endpoint
│   ├── agents/                  ← Agent definitions (see Section 4)
│   │   ├── ops-agent.ts
│   │   ├── comms-agent.ts
│   │   ├── knowledge-agent.ts
│   │   └── crm-agent.ts
│   ├── lib/
│   │   ├── supabase.ts          ← Supabase client (service role)
│   │   ├── claude.ts            ← Anthropic client + streaming helpers
│   │   ├── google.ts            ← Google Sheets API client
│   │   └── kv.ts                ← CF KV knowledge bucket helpers
│   └── types/
│       ├── supabase.ts          ← Auto-generated from schema
│       └── env.ts               ← Worker environment types
│
├── frontend/                    ← Cloudflare Pages (React app)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/          ← Shared UI components
│   │   ├── pages/               ← Route-level page components
│   │   ├── hooks/               ← Custom React hooks
│   │   └── lib/
│   │       ├── api.ts           ← CF Worker API client
│   │       └── supabase.ts      ← Supabase JS client (anon key)
│   └── public/
│       └── assets/              ← Client brand assets
│
├── supabase/
│   ├── migrations/              ← Versioned SQL files
│   ├── seed.sql
│   └── schema.sql               ← Current schema snapshot
│
├── knowledge/                   ← Source documents for agent KB
│   ├── sops/                    ← Standard operating procedures
│   ├── faqs/                    ← Frequently asked questions
│   └── pricing/                 ← Pricing rules and tables
│
├── scripts/
│   ├── setup.sh                 ← One-command env bootstrap
│   ├── seed-kv.sh               ← Load knowledge docs into CF KV
│   └── sync-schema.sh           ← Pull schema + regen types
│
└── .github/
    └── workflows/
        ├── deploy-worker.yml    ← Push main → deploy CF Worker
        └── deploy-pages.yml     ← Push main → deploy CF Pages
```

---

### 1.5 GOOGLE NATIVE — THE MIRROR AND COMMS LAYER

**Role:** The client's internal team lives in Google. Sheets mirror Supabase data for non-technical staff who need to view or reference records. Drive stores knowledge documents that agents can read. Gmail is the outbound comms relay. Apps Script runs lightweight internal automations triggered by the stack — not the other way around.

#### The Data Flow Direction (Non-Negotiable)

```
Supabase / Cloudflare  ──PUSH──►  Google Sheets   (mirror)
Cloudflare Worker      ──SEND──►  Gmail            (comms relay)
Cloudflare Worker      ──WRITE──► Google Drive     (document delivery)
Agent                  ──READ──►  Google Drive     (knowledge reference)
Agent                  ──READ──►  Google Sheets    (operational reference)

❌ NEVER: Google Sheets ──WRITE──► Supabase directly
❌ NEVER: Apps Script   ──is the trigger for── business logic
❌ NEVER: Customer      ──sees──► any Google product
```

#### What Google Does in Each Role

**Google Sheets — The Internal Mirror**
A scheduled Cloudflare Worker (cron trigger) or a Supabase webhook → Worker runs every N minutes and pushes current state to the client's KPI Sheets. The sheet is always a read-only reflection of what Supabase knows. Client managers can view it, reference it, annotate it. They cannot break anything by editing it because Supabase doesn't read from it.

Typical mirrors we push to Sheets:
- Active contacts and deal pipeline
- Task board summary (open / in-progress / done)
- Agent activity log (what the AI did today)
- KPIs and revenue metrics
- Staff performance summaries

**Google Drive — The Knowledge Base**
Client SOPs, pricing guides, product manuals, and policy documents live in Drive. Agents are given read access to a specific folder. When an agent needs to answer a question or execute a task, it can fetch documents from Drive as context. Drive is also used to deliver finished documents to the client (reports, proposals, board decks written by Claude and pushed to Drive).

**Gmail — The Comms Engine**
All outbound communication originates in Cloudflare Workers (composed by Claude, triggered by Supabase events). The Worker calls the Gmail API (or sends via SMTP relay) to deliver the message. Gmail is the pipe, not the brain. Apps Script can handle lightweight internal notification triggers (e.g., "email me when this Sheet hits a threshold") but never touches customer-facing comms.

**Apps Script — Internal Orchestration Only**
Apps Script is acceptable for: internal team notifications, Sheet formatting triggers, Drive file organization, and lightweight internal automation that the client's team self-manages. Apps Script should NEVER be the system of record for business logic. When Apps Script needs to trigger real business logic, it calls a Cloudflare Worker endpoint — it doesn't do the work itself.

#### Free Tier Limits (Google)
| Service | Free Limit | Workspace Upgrade |
|---|---|---|
| Drive storage | 15 GB shared | 30 GB/user ($7.20/user/mo) |
| Apps Script execution | 6 min/run, 90 min/day | 30 min/run, 6 hr/day |
| Apps Script URL Fetch | 20,000 req/day | 100,000 req/day |
| Apps Script email sends | 100/day | 1,500/day |
| Sheets API reads | 300 req/min | 300 req/min (same) |
| Sheets API writes | 300 req/min | 300 req/min (same) |

---

## SECTION 2: FULL ARCHITECTURE MAP

```
                        ┌──────────────────────────┐
                        │    CLIENT'S CUSTOMERS     │
                        │  (browsers, mobile apps)  │
                        └────────────┬─────────────┘
                                     │ HTTPS
                                     ▼
              ┌──────────────────────────────────────────────┐
              │         CLOUDFLARE PAGES (React)             │
              │  Polished branded UI · Customer portal       │
              │  Order flows · Dashboards · Account mgmt     │
              │  Deployed from GitHub on every push to main  │
              └────────────────────┬─────────────────────────┘
                                   │ fetch() to Worker API
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS (Hono API)                     │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  REST API   │  │   AGENTS     │  │    CRON / SCHEDULED      │   │
│  │  (CRUD,     │  │  (Claude     │  │  Nightly KPI push to     │   │
│  │   auth,     │  │   Tool Use   │  │  Sheets · Batch AI runs  │   │
│  │   webhooks) │  │   + MCP)     │  │  · Data sync jobs        │   │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬─────────────┘   │
│         │                │                        │                 │
│  ┌──────▼──────────────────────────────────────── ▼────────────┐   │
│  │              CF KNOWLEDGE LAYER                              │   │
│  │  KV (SOPs, config, FAQs, rules) · R2 (docs, PDFs, reports)  │   │
│  │  D1 (agent logs, audit trail) · Vectorize (semantic search) │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────────┬───────────────────────────────┘
            │ queries / writes          │ AI calls
            ▼                          ▼
┌─────────────────────┐    ┌───────────────────────────────────────┐
│     SUPABASE        │    │         CLAUDE / ANTHROPIC            │
│                     │    │                                       │
│  PostgreSQL (RLS)   │    │  Haiku → fast/cheap classification   │
│  Auth (Google OAuth)│◄───│  Sonnet → default agent model        │
│  Realtime channels  │    │  Opus → deep reasoning only          │
│  Storage (user files│    │  Tool Use → queries DB, KV, Drive    │
│  Webhooks → CF      │    │  Streaming → real-time UI responses  │
└─────────────────────┘    │  Batch → nightly bulk operations     │
            │               └───────────────────────────────────────┘
            │ webhooks
            ▼
┌──────────────────────────────────────────────────────────────┐
│              GOOGLE NATIVE (Internal Mirror Only)            │
│                                                              │
│  Sheets ◄── CF pushes KPI mirrors on schedule               │
│  Drive  ◄── CF writes finished reports · Agents read SOPs   │
│  Gmail  ◄── CF sends comms (Claude-composed, CF-triggered)  │
│  Apps Script ── Internal notifications only                  │
│                                                              │
│  ← Data only flows INTO Google. Never out to production DB. │
└──────────────────────────────────────────────────────────────┘
            ▲
            │ All code versioned + deployed via
┌──────────────────────────────────────────────────────────────┐
│                        GITHUB                                │
│  All source code · Migrations · GitHub Actions CI/CD        │
│  Push main → auto-deploy CF Worker + Pages                  │
└──────────────────────────────────────────────────────────────┘
```

---

## SECTION 3: DATA SOVEREIGNTY — TRIPLE REDUNDANCY PROTECTION

> **The claim we make to every client:**
> *"You own your data. Not in theory — in practice. If you fire us tomorrow, your full operational history is already sitting in your own Google account and your own GitHub repository, in open formats, right now. No export request. No migration fee. No data held hostage. You could hand this to any developer on earth and they could keep building."*
>
> This section defines exactly how we make that claim true. It is a non-negotiable part of every engagement architecture.

---

### 3.0 The Three Layers

The client's data exists in three independently owned and controlled locations simultaneously. Each layer is owned by the **client**, not by OAG. OAG builds and maintains the pipelines — the destinations belong to the client.

```
┌─────────────────────────────────────────────────────────────────────┐
│                 TRIPLE REDUNDANCY DATA MAP                          │
│                                                                     │
│  PRIMARY SOURCE                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SUPABASE — PostgreSQL (OAG-managed, client-credentialed)   │   │
│  │  Live, relational, RLS-protected. Every record, every       │   │
│  │  relationship, every event. The working database.           │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│                       │                                            │
│          ┌────────────┴─────────────┐                              │
│          │                          │                              │
│          ▼                          ▼                              │
│  LAYER 1 — Real-Time Mirror   LAYER 2 — Durable Truth Store        │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐   │
│  │  GOOGLE SHEETS           │  │  CLIENT GITHUB REPO          │   │
│  │  Client's Google account │  │  Client's GitHub account     │   │
│  │                          │  │                              │   │
│  │  Trigger: Supabase DB    │  │  Trigger: Nightly cron       │   │
│  │  webhook → CF Worker     │  │  Supabase Edge Function      │   │
│  │  → Sheets API            │  │  → JSON + CSV → GitHub API   │   │
│  │                          │  │                              │   │
│  │  Latency: seconds        │  │  Latency: ≤ 24 hours         │   │
│  │  Format: Tabular/human   │  │  Format: JSON + CSV (open)   │   │
│  │  Use: Ops visibility     │  │  Use: Portability + audit    │   │
│  │  Owner: Client Google    │  │  Owner: Client GitHub        │   │
│  └──────────────────────────┘  └──────────────────────────────┘   │
│                                                                     │
│  If Supabase goes down → Sheets has the current state              │
│  If OAG disappears → GitHub has the full history in open format    │
│  If both → Client has all three. They are never locked out.        │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3.1 LAYER 1 — Real-Time Human Mirror (Supabase → Google Sheets)

**What it does:** Every meaningful write to Supabase triggers a near-real-time update to a Google Sheet in the **client's own Google account**. The client's ops team has always-current visibility into their data without logging into any OAG-built tool.

**Why it matters operationally:** Non-technical staff, managers, and executives live in Google Sheets. This layer means the Supabase database and the Sheets view are never more than seconds apart. It also means the client has a human-readable, human-editable fallback that requires zero technical knowledge to access.

#### Architecture

```
Supabase table write (INSERT / UPDATE)
         │
         ▼ (Supabase Database Webhook — fires on table event)
Cloudflare Worker /webhooks/supabase
         │
         ├─ Validates webhook signature
         ├─ Determines which Sheet tab to update
         ├─ Formats the payload as a row
         │
         ▼ (Google Sheets API — service account auth)
Google Sheet (CLIENT'S ACCOUNT) — specific tab, specific row range
```

#### Tables Mirrored to Sheets (Standard)

| Supabase Table | Sheet Tab | Update Trigger | Format |
|---|---|---|---|
| `contacts` | `Contacts` | INSERT + UPDATE | One row per contact, key fields |
| `tasks` | `Task Board` | INSERT + UPDATE + status change | Status-grouped view |
| `activity_log` | `Activity Feed` | INSERT only | Chronological, append-only |
| `agent_runs` | `Agent Activity` | INSERT + completed | What the AI did and when |
| `notifications` | `Comms Log` | status = 'sent' | Outbound comms record |
| `deals / orders` | `Pipeline` | INSERT + UPDATE | Deal stage + value |

#### Implementation

```typescript
// src/routes/webhooks.ts — Supabase webhook → Google Sheets mirror

import { Hono } from 'hono';
import { GoogleSheetsClient } from '../lib/google';

const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.post('/supabase', async (c) => {
  const payload = await c.req.json();
  const { table, type, record, old_record } = payload;

  // Only mirror on INSERT and UPDATE (not DELETE — we soft-delete)
  if (!['INSERT', 'UPDATE'].includes(type)) {
    return c.json({ skipped: true });
  }

  const sheets = new GoogleSheetsClient(c.env);
  const sheetId = c.env.GOOGLE_KPI_SHEET_ID;

  // Route to the correct mirror tab based on table name
  switch (table) {
    case 'contacts':
      await sheets.upsertRow(sheetId, 'Contacts', record.id, [
        record.id,
        record.name,
        record.email,
        record.phone,
        record.type,
        record.status,
        record.company,
        new Date(record.updated_at).toLocaleString(),
      ]);
      break;

    case 'tasks':
      await sheets.upsertRow(sheetId, 'Task Board', record.id, [
        record.id,
        record.title,
        record.status,
        record.priority,
        record.assignee_id ?? '—',
        record.due_date ?? '—',
        record.source,          // human | agent
        record.agent_name ?? '—',
        new Date(record.updated_at).toLocaleString(),
      ]);
      break;

    case 'activity_log':
      // Activity log is append-only — always add a new row, never update
      await sheets.appendRow(sheetId, 'Activity Feed', [
        record.id,
        record.actor_type,
        record.actor_id,
        record.action,
        record.entity_type ?? '—',
        record.entity_id ?? '—',
        JSON.stringify(record.details),
        new Date(record.created_at).toLocaleString(),
      ]);
      break;

    case 'agent_runs':
      if (record.status === 'completed') {
        await sheets.upsertRow(sheetId, 'Agent Activity', record.id, [
          record.id,
          record.agent_name,
          record.trigger_type,
          record.task_description.substring(0, 100),
          record.status,
          record.actions_taken?.join(' | ') ?? '—',
          record.tokens_used ?? 0,
          record.duration_ms ? `${Math.round(record.duration_ms / 1000)}s` : '—',
          new Date(record.created_at).toLocaleString(),
        ]);
      }
      break;
  }

  return c.json({ mirrored: true, table, type });
});

export { webhookRoutes };
```

```typescript
// src/lib/google.ts — Google Sheets API client

export class GoogleSheetsClient {
  private accessToken: string | null = null;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  // Upsert a row by a unique ID in column A
  async upsertRow(sheetId: string, tab: string, rowId: string, values: unknown[]) {
    const token = await this.getAccessToken();
    const range = `${tab}!A:A`;

    // Find existing row with this ID
    const searchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json() as { values?: string[][] };
    const rows = searchData.values ?? [];
    const existingRowIndex = rows.findIndex(row => row[0] === rowId);

    if (existingRowIndex >= 0) {
      // Update existing row (1-indexed, +1 for header row)
      const rowNumber = existingRowIndex + 1;
      await this.writeRange(sheetId, `${tab}!A${rowNumber}`, [values], token);
    } else {
      // Append new row
      await this.appendRow(sheetId, tab, values);
    }
  }

  // Append a new row to the bottom of a tab
  async appendRow(sheetId: string, tab: string, values: unknown[]) {
    const token = await this.getAccessToken();
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [values] }),
      }
    );
  }

  private async writeRange(sheetId: string, range: string, values: unknown[][], token: string) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    // Decode and use the service account key to get a JWT → exchange for access token
    const saKey = JSON.parse(atob(this.env.GOOGLE_SERVICE_ACCOUNT_KEY));
    // JWT signing and token exchange implementation
    // Use the google-auth-library pattern or a lightweight CF-compatible JWT lib
    this.accessToken = await exchangeServiceAccountForToken(saKey);
    return this.accessToken!;
  }
}
```

#### Supabase Webhook Configuration (Manual Step)

```
[MANUAL STEP] — Configure in Supabase Dashboard

For each table to mirror:
  Supabase Dashboard → Database → Webhooks → Create Webhook

  Name:     mirror-{table-name}
  Table:    {table_name}
  Events:   ✓ INSERT  ✓ UPDATE  (NOT DELETE)
  URL:      https://oag-{client-slug}-api.workers.dev/webhooks/supabase
  Headers:
    Content-Type: application/json
    x-webhook-secret: {WEBHOOK_SECRET}  ← add as CF Worker secret too

Tables to configure:
  ✓ contacts
  ✓ tasks
  ✓ activity_log
  ✓ agent_runs
  ✓ notifications (on status = 'sent' — use condition filter)
  ✓ deals (if applicable to engagement)
```

---

### 3.2 LAYER 2 — Durable Truth Store (Supabase → Client GitHub Repo)

**What it does:** Every night, a Supabase Edge Function runs a full export of every table in the database, serializes the data as both JSON and CSV, and commits it directly to a **repository in the client's own GitHub account**. By morning, the client has a complete, timestamped snapshot of their entire business database sitting in a repo they own — in open formats that any developer, database tool, or spreadsheet application can read.

**Why it matters for the sales claim:** This is the proof of data ownership. The client doesn't have to ask OAG for an export. They don't have to wait. They don't have to trust that OAG will be around. Their data accumulates in their own GitHub, nightly, automatically. If the entire OAG stack disappeared, the client's last 24 hours of data is the only thing at risk — everything before that is in their repo.

**Zero dependency on OAG:** The GitHub repo belongs to the client. The Supabase project can be handed over to the client. The export format is plain JSON and CSV. Any developer can import this into PostgreSQL, MySQL, SQLite, Airtable, or Excel. There is no proprietary format, no encryption key held by OAG, no migration required.

#### Architecture

```
Supabase Edge Function (nightly cron — 2AM UTC)
         │
         ├─ Connects to Supabase DB (service role)
         ├─ Queries all tables with org_id filter
         ├─ Serializes each table to:
         │     /exports/{YYYY-MM-DD}/{table}.json
         │     /exports/{YYYY-MM-DD}/{table}.csv
         │
         ▼ (GitHub API — client's own PAT)
Client's GitHub repo: {client-org}/{client-data-repo}
         │
         ├─ Creates or updates files via GitHub Contents API
         ├─ Commit message: "nightly export: {date} — {row_count} records"
         └─ Preserves full git history (every nightly export = one commit)
```

#### Export File Structure (In Client's GitHub Repo)

```
{client-data-repo}/
├── README.md                         ← What this repo is and how to use it
├── exports/
│   ├── 2025-01-14/
│   │   ├── contacts.json
│   │   ├── contacts.csv
│   │   ├── tasks.json
│   │   ├── tasks.csv
│   │   ├── activity_log.json
│   │   ├── activity_log.csv
│   │   ├── agent_runs.json
│   │   ├── agent_runs.csv
│   │   └── _manifest.json            ← Row counts, export timestamp, schema version
│   ├── 2025-01-15/
│   │   └── ...
│   └── latest/                       ← Symlinked to most recent export (for easy access)
│       ├── contacts.json
│       └── ...
└── schema/
    └── schema.sql                    ← Current database schema snapshot
```

#### Implementation

```typescript
// supabase/functions/nightly-export/index.ts
// Supabase Edge Function — runs on cron, exports all data to client GitHub

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TABLES_TO_EXPORT = [
  'contacts',
  'tasks',
  'activity_log',
  'agent_runs',
  'notifications',
  'organizations',
  // Add engagement-specific tables here
];

Deno.serve(async (req) => {
  // Verify this is a legitimate cron invocation (not a random HTTP call)
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const exportDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const orgId = Deno.env.get('CLIENT_ORG_ID')!;
  const githubToken = Deno.env.get('CLIENT_GITHUB_PAT')!;
  const githubRepo = Deno.env.get('CLIENT_GITHUB_DATA_REPO')!; // e.g., "acme-corp/acme-data"
  const manifest: Record<string, number> = {};

  for (const table of TABLES_TO_EXPORT) {
    // Fetch all rows for this org
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`Failed to export ${table}:`, error.message);
      continue;
    }

    const rows = data ?? [];
    manifest[table] = rows.length;

    // Serialize to JSON
    const jsonContent = JSON.stringify(rows, null, 2);

    // Serialize to CSV
    const csvContent = rows.length > 0
      ? [
          Object.keys(rows[0]).join(','),
          ...rows.map(row =>
            Object.values(row).map(v =>
              typeof v === 'string'
                ? `"${v.replace(/"/g, '""')}"`
                : v === null ? '' : String(v)
            ).join(',')
          )
        ].join('\n')
      : '';

    // Write both formats to client's GitHub repo
    await writeToGitHub(githubToken, githubRepo, `exports/${exportDate}/${table}.json`, jsonContent, exportDate);
    await writeToGitHub(githubToken, githubRepo, `exports/${exportDate}/${table}.csv`, csvContent, exportDate);
    await writeToGitHub(githubToken, githubRepo, `exports/latest/${table}.json`, jsonContent, exportDate);
    await writeToGitHub(githubToken, githubRepo, `exports/latest/${table}.csv`, csvContent, exportDate);
  }

  // Write manifest
  const manifestContent = JSON.stringify({
    export_date: exportDate,
    export_timestamp: new Date().toISOString(),
    org_id: orgId,
    tables: manifest,
    total_records: Object.values(manifest).reduce((a, b) => a + b, 0),
    schema_version: Deno.env.get('SCHEMA_VERSION') ?? '1.0',
    generated_by: 'OAG Nightly Export — Supabase Edge Function',
  }, null, 2);

  await writeToGitHub(githubToken, githubRepo, `exports/${exportDate}/_manifest.json`, manifestContent, exportDate);

  console.log(`Nightly export complete: ${exportDate}`, manifest);
  return new Response(JSON.stringify({ success: true, date: exportDate, manifest }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

// GitHub Contents API — create or update a file
async function writeToGitHub(
  token: string,
  repo: string,
  path: string,
  content: string,
  exportDate: string
) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;

  // Check if file already exists (need SHA to update)
  const existing = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  });

  let sha: string | undefined;
  if (existing.ok) {
    const data = await existing.json() as { sha: string };
    sha = data.sha;
  }

  // Create or update the file
  await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: `nightly export: ${exportDate}`,
      content: btoa(unescape(encodeURIComponent(content))), // base64 encode
      ...(sha ? { sha } : {}), // Include SHA only when updating
    })
  });
}
```

#### Deploy the Edge Function with Cron

```bash
# supabase/functions/nightly-export/index.ts already written above

# Deploy to Supabase
supabase functions deploy nightly-export

# Set the required secrets on the Edge Function
supabase secrets set CLIENT_ORG_ID={the-client-org-uuid}
supabase secrets set CLIENT_GITHUB_PAT={client-provided-github-pat}
supabase secrets set CLIENT_GITHUB_DATA_REPO={client-org}/{client-data-repo}
supabase secrets set SCHEMA_VERSION=1.0

# Schedule with Supabase cron (pg_cron in the database)
# Run in Supabase SQL Editor:
SELECT cron.schedule(
  'nightly-data-export',
  '0 2 * * *',   -- 2AM UTC every night
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/nightly-export',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

#### Client GitHub Repo Setup (Manual Steps)

```
[MANUAL STEPS — done with client present]

Step 1 — Create the data repo in the CLIENT'S GitHub account (not OAG's)
  - Client logs into their own GitHub
  - Create new private repo: {client-org}/{client-slug}-data
  - Initialize with README.md

Step 2 — Add README to the data repo
  Content:
  "# {Client Name} — Data Export Repository
  
  This repository contains nightly exports of your operational database,
  maintained automatically by your OAG-built systems.
  
  You own this repository. OAG does not have admin access.
  Each folder under /exports/ represents one day's complete snapshot.
  
  Files are available in both JSON (machine-readable) and CSV
  (Excel/Sheets-compatible) format.
  
  To restore data: import any JSON file into PostgreSQL, Supabase, or
  any database tool. To view data: open any CSV in Excel or Google Sheets."

Step 3 — Generate a GitHub Personal Access Token (PAT) in the CLIENT'S account
  - GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained
  - Repository access: Only the {client-slug}-data repo
  - Permissions: Contents → Read and Write
  - Copy the token → add to Supabase as secret: CLIENT_GITHUB_PAT
  - OAG never stores this token — it lives only in Supabase secrets (client-controlled)

Step 4 — Verify first export runs
  - Manually trigger: supabase functions invoke nightly-export
  - Confirm files appear in client's GitHub repo
  - Confirm manifest.json shows correct row counts
  - Walk the client through their repo so they understand what they own
```

---

### 3.3 The Redundancy Matrix — What Survives What

| Failure Scenario | Layer 0 (Supabase) | Layer 1 (Sheets) | Layer 2 (GitHub) | Client Impact |
|---|---|---|---|---|
| OAG stops operating | ❌ May lose access | ✅ Client owns | ✅ Client owns | Max 24hr data loss. Full history recoverable. |
| Supabase outage | ❌ Unavailable | ✅ Last webhook state | ✅ Last nightly export | Read-only ops continue via Sheets |
| Google outage | ✅ Fully operational | ❌ Mirror unavailable | ✅ Available | App continues. Sheets mirror recovers when Google restores. |
| GitHub outage | ✅ Fully operational | ✅ Fully operational | ❌ Export pauses | No operational impact. Exports resume next night. |
| Accidental data deletion | ✅ Soft-delete recoverable | ✅ Captures pre-delete state | ✅ Full history in git log | Full recovery possible from any layer |
| Security breach / data corruption | ✅ Point-in-time restore | ✅ Last clean mirror | ✅ Specific night's export | Multiple clean restore points available |

### 3.4 Data Sovereignty Checklist Items

Add these to the engagement go-live checklist (Section 8):

```
Data Sovereignty — Triple Redundancy
- [ ] Client GitHub data repo created in CLIENT'S account (not OAG)
- [ ] Client GitHub PAT generated with minimum required scope (Contents R/W, single repo)
- [ ] PAT stored as Supabase secret — OAG does NOT retain a copy
- [ ] Supabase webhooks configured for all mirror tables (contacts, tasks, activity_log, agent_runs)
- [ ] Webhook → Google Sheets flow tested end-to-end (write to DB → confirm row appears in Sheet)
- [ ] Nightly export Edge Function deployed and scheduled (pg_cron at 2AM UTC)
- [ ] First manual export triggered and verified — files in client GitHub ✓
- [ ] Client walked through their GitHub data repo — they know where their data lives
- [ ] Client walked through their Sheets mirror — they can read it without OAG access
- [ ] Data sovereignty README committed to client GitHub data repo
- [ ] Schema snapshot (schema.sql) committed to data repo for reference
```

### 3.5 Talking Points — How to Present This to a Client

When presenting the data architecture to a client, these are the exact claims we make and how they're backed:

**Claim:** *"Your data is always in three places you control."*
→ Backed by: Supabase (their credentials), Sheets (their Google), GitHub (their repo)

**Claim:** *"You can fire us and your data is already waiting for you — no export request needed."*
→ Backed by: Nightly export runs to their GitHub automatically. The morning after they cancel, a complete export is already there.

**Claim:** *"Your operational team always has visibility, even if the app is down."*
→ Backed by: Sheets mirror reflects Supabase state within seconds of every write. Sheets require only a Google account to access.

**Claim:** *"Your data is in open formats. Any developer or tool can read it."*
→ Backed by: JSON and CSV are universal. PostgreSQL dump compatible. No OAG-proprietary format. No decryption key. No middleware required.

**Claim:** *"We can prove the data is complete."*
→ Backed by: Every nightly export includes a `_manifest.json` with row counts per table. Client can verify their record counts against the Sheets mirror at any time.

---

## SECTION 4: AGENT ARCHITECTURE

This is where the stack comes alive. Agents are autonomous AI workers that run inside Cloudflare Workers, use Claude's Tool Use capability, and connect to every data source in the stack. They don't just answer questions — they take actions.

### 3.1 What an Agent Is (Technically)

An agent is a Cloudflare Worker that:
1. Receives a trigger (HTTP call, cron, Supabase webhook, or user action)
2. Calls Claude with a system prompt + task description + **tools**
3. Claude decides which tools to call and in what order
4. The Worker executes each tool call (database query, KV read, API call, etc.)
5. Claude receives tool results and continues reasoning
6. Claude produces a final action or response
7. The Worker writes results back to Supabase + optionally to Google Sheets or Gmail

### 3.2 Where Agents Live

**All agents run as Cloudflare Workers.** They are TypeScript functions deployed to Cloudflare's edge. They are invoked via:
- `POST /agents/{agent-name}` — On-demand from the React UI or an API call
- Cron trigger — Scheduled (nightly ops agent, weekly report agent)
- Supabase webhook → Worker → agent triggered by data event
- Another agent (agent chaining / orchestration)

### 3.3 How Agents Access Knowledge

Agents have access to four knowledge sources, each with a different use case:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT KNOWLEDGE SOURCES                      │
│                                                                 │
│  1. SUPABASE (Source of truth)                                  │
│     What: Live business data — contacts, tasks, deals, history  │
│     How: Agent calls `query_database` tool → Worker queries DB  │
│     When: Any time agent needs current state of the business    │
│                                                                 │
│  2. CF KV (Fast config and rules)                               │
│     What: SOPs, pricing rules, FAQs, feature flags, config      │
│     How: Agent calls `get_knowledge` tool → Worker reads KV     │
│     When: Agent needs policy/procedure to execute a task        │
│                                                                 │
│  3. CF R2 (Document store)                                      │
│     What: PDFs, contracts, training docs, large reference files │
│     How: Agent calls `get_document` tool → Worker fetches R2    │
│     When: Agent needs full document content for context         │
│                                                                 │
│  4. CF Vectorize (Semantic search)                              │
│     What: Chunked, embedded knowledge articles and SOPs         │
│     How: Agent calls `search_knowledge` → Vectorize query       │
│     When: Agent has a natural language question, needs closest  │
│           match from the knowledge base without knowing the key │
│                                                                 │
│  5. GOOGLE DRIVE (Reference documents — read-only)             │
│     What: Client's existing docs, SOPs not yet in KV           │
│     How: Agent calls `read_drive_doc` → CF fetches via API      │
│     When: Client has existing docs agents should reference      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Standard Agent Toolkit (Tool Definitions)

Every agent gets a standard set of tools. Define these in the Worker, pass to Claude, and Claude decides when to call them:

```typescript
// src/agents/tools.ts — Standard OAG Agent Toolkit

export const STANDARD_TOOLS = [
  {
    name: "query_database",
    description: "Query the Supabase PostgreSQL database. Use for any question about current business state: contacts, deals, tasks, orders, history. Input is a plain English description of what you need.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "What you need from the database in plain English" },
        table: { type: "string", description: "Primary table to query" },
        filters: { type: "object", description: "Optional: field:value pairs to filter by" },
        limit: { type: "number", description: "Max rows to return (default 50)" }
      },
      required: ["intent", "table"]
    }
  },
  {
    name: "write_database",
    description: "Write or update records in the Supabase database. Use to create tasks, update deal status, log activity, or record agent actions.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        operation: { type: "string", enum: ["insert", "update", "upsert"] },
        data: { type: "object", description: "The data to write" },
        match: { type: "object", description: "For update: field:value to match existing record" }
      },
      required: ["table", "operation", "data"]
    }
  },
  {
    name: "get_knowledge",
    description: "Retrieve a specific SOP, FAQ, pricing rule, or policy document from the knowledge base by key. Use when you know the type of information you need.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Knowledge base key (e.g., 'sop:onboarding', 'faq:refunds', 'pricing:enterprise')" }
      },
      required: ["key"]
    }
  },
  {
    name: "search_knowledge",
    description: "Semantically search the knowledge base with a natural language question. Returns the most relevant SOPs, policies, or procedures. Use when you don't know the exact key.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language question or topic" },
        top_k: { type: "number", description: "Number of results to return (default 3)" }
      },
      required: ["query"]
    }
  },
  {
    name: "send_notification",
    description: "Send an email or internal notification. Use for: alerting the client team, sending a customer update, or delivering a generated report.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        type: { type: "string", enum: ["email", "internal_alert"] }
      },
      required: ["to", "subject", "body", "type"]
    }
  },
  {
    name: "update_google_sheet",
    description: "Push data to a Google Sheet mirror. Use after completing analysis or when a task completion should be reflected in the client's internal dashboard.",
    input_schema: {
      type: "object",
      properties: {
        sheet_id: { type: "string" },
        tab: { type: "string" },
        range: { type: "string", description: "A1 notation of the range to update" },
        values: { type: "array", description: "2D array of values to write" }
      },
      required: ["sheet_id", "tab", "range", "values"]
    }
  },
  {
    name: "read_drive_document",
    description: "Read the contents of a Google Drive document by ID. Use when the agent needs context from an existing client document, SOP, or reference file stored in Drive.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Google Drive document ID" },
        summary_only: { type: "boolean", description: "If true, return a brief summary instead of full content" }
      },
      required: ["document_id"]
    }
  },
  {
    name: "log_agent_action",
    description: "ALWAYS call this at the end of any task. Log what the agent did, what it decided, and what it changed. This is how we maintain auditability.",
    input_schema: {
      type: "object",
      properties: {
        agent_name: { type: "string" },
        task: { type: "string" },
        actions_taken: { type: "array", items: { type: "string" } },
        outcome: { type: "string" },
        records_modified: { type: "array", items: { type: "string" } }
      },
      required: ["agent_name", "task", "actions_taken", "outcome"]
    }
  }
];
```

### 3.5 The Four Standard OAG Agents

Every engagement gets these four agents as a starting point. Extend or add domain-specific agents per client.

---

#### AGENT 1: OPS AGENT
**Trigger:** Cron (daily at 6AM) or on-demand  
**Job:** Reviews the client's operational state each morning. Flags overdue tasks, identifies bottlenecks, generates a priority list for the day, and pushes a briefing to Google Sheets and Gmail.

```typescript
// src/agents/ops-agent.ts

export const OPS_AGENT_SYSTEM_PROMPT = `
You are an operations agent for {CLIENT_NAME}, a {CLIENT_INDUSTRY} business.
Your job is to analyze the current operational state and produce a clear, prioritized morning briefing.

You have access to:
- The task database (open, overdue, in-progress)
- The deals/pipeline database
- The client's SOPs via the knowledge base
- The ability to send notifications and update the internal dashboard

Your output style: Direct. No filler. Executive-grade. Flag problems, not opinions.

When you run:
1. Query open and overdue tasks
2. Query the deal pipeline for anything stalled > 7 days
3. Check for any flagged contacts or escalations
4. Search the knowledge base for any relevant SOP context for flagged items
5. Compose a briefing: Top 3 priorities for the day, flagged issues, recommended actions
6. Update the Google Sheet dashboard
7. Send the briefing to the client team via email
8. Log your actions
`.trim();
```

---

#### AGENT 2: CRM AGENT
**Trigger:** On-demand (from the React UI) or Supabase webhook (new contact created)  
**Job:** When a new contact is added or a deal changes, the CRM agent enriches the record, generates a relationship summary, suggests next actions, and creates follow-up tasks.

```typescript
// src/agents/crm-agent.ts

export const CRM_AGENT_SYSTEM_PROMPT = `
You are a CRM agent for {CLIENT_NAME}.
You analyze contact and deal records and take structured actions to keep the pipeline healthy.

When triggered on a contact or deal:
1. Read the full record and recent activity log
2. Search the knowledge base for relevant sales process or account type rules
3. Generate a relationship summary (who are they, where are they in the journey, what's the risk)
4. Identify the single most important next action
5. Create a task in the database with a due date and assignee
6. If the deal is stalled, draft a re-engagement email for human review (do not send automatically)
7. Update the record with your summary and suggested next step
8. Log your actions

Never send outbound emails autonomously. Drafts only — a human approves and sends.
`.trim();
```

---

#### AGENT 3: KNOWLEDGE AGENT
**Trigger:** On-demand API call from the React UI (customer portal or internal tool)  
**Job:** Answers questions from the client's team or customers using the knowledge base. Searches Vectorize for relevant SOPs, fetches supporting documents from R2/Drive, and composes a grounded, accurate answer. Cites its sources.

```typescript
// src/agents/knowledge-agent.ts

export const KNOWLEDGE_AGENT_SYSTEM_PROMPT = `
You are a knowledge assistant for {CLIENT_NAME}.
You answer questions by searching the knowledge base — SOPs, FAQs, policies, pricing, procedures.

Rules:
- Only answer based on knowledge base content. Do not invent policies.
- Always cite which document or SOP your answer comes from.
- If you cannot find a relevant answer, say so clearly and suggest who to contact.
- Search semantically first, then retrieve the specific document if needed.
- Keep answers concise and actionable.

Audience: {AUDIENCE_TYPE} — calibrate language accordingly.
`.trim();
```

---

#### AGENT 4: COMMS AGENT
**Trigger:** Supabase webhook (event-based) or cron (for batched outreach)  
**Job:** Drafts and (with approval) sends outbound communications. Triggered by business events: new order confirmed, task completed and client needs update, scheduled check-in, or escalation alert.

```typescript
// src/agents/comms-agent.ts

export const COMMS_AGENT_SYSTEM_PROMPT = `
You are a communications agent for {CLIENT_NAME}.
You draft professional, on-brand outbound communications triggered by business events.

For every communication:
1. Read the triggering event and relevant record from the database
2. Check the knowledge base for any relevant communication guidelines or templates
3. Draft the communication — match the tone and brand voice of {CLIENT_NAME}
4. Save the draft to the notifications table with status: 'pending_review'
5. Alert the designated approver via internal notification
6. NEVER send a customer-facing communication without a human approval step unless explicitly configured for auto-send (transactional only: order confirmations, password resets)
7. Log all drafts and their approval status

Brand voice for {CLIENT_NAME}: {BRAND_VOICE_DESCRIPTION}
`.trim();
```

### 3.6 Agent Runtime — Full Worker Pattern

```typescript
// src/routes/agents.ts — How to invoke any agent from the API

import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { STANDARD_TOOLS } from '../agents/tools';
import { executeToolCall } from '../agents/executor';

const agentRoutes = new Hono<{ Bindings: Env }>();

agentRoutes.post('/:agentName', async (c) => {
  const { agentName } = c.req.param();
  const { task, context } = await c.req.json();
  const env = c.env;

  // Load the appropriate system prompt
  const systemPrompt = await getAgentSystemPrompt(agentName, env);
  
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: task }
  ];

  let response: Anthropic.Message;
  let iterationCount = 0;
  const MAX_ITERATIONS = 10; // Safety limit on agentic loops

  // Agentic loop — Claude keeps calling tools until task is done
  while (iterationCount < MAX_ITERATIONS) {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: STANDARD_TOOLS,
      messages,
    });

    iterationCount++;

    // If Claude is done reasoning (no more tool calls), break
    if (response.stop_reason === 'end_turn') break;

    // Process tool calls
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolUse.type !== 'tool_use') continue;
        
        // Execute the tool call in the Worker (queries DB, reads KV, etc.)
        const result = await executeToolCall(toolUse.name, toolUse.input, env);
        
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add Claude's response + tool results to message history
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }
  }

  // Return the final text response
  const finalText = response!.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('\n');

  return c.json({ 
    agent: agentName, 
    result: finalText,
    iterations: iterationCount 
  });
});

export { agentRoutes };
```

### 3.7 Where and How to Create Agents (Step-by-Step)

#### Option A — Claude API + Cloudflare Workers (OAG Standard)
This is what we build. Full code control, runs at the edge, connects to the full stack.

```bash
# 1. Add agent system prompt to src/agents/{agent-name}.ts
# 2. Register the route in src/index.ts:
app.route('/agents', agentRoutes);

# 3. Add any new tool handlers to src/agents/executor.ts
# 4. Test locally:
wrangler dev
curl -X POST http://localhost:8787/agents/ops-agent \
  -H "Content-Type: application/json" \
  -d '{"task": "Run morning operations briefing"}'

# 5. Deploy:
wrangler deploy
```

#### Option B — Claude.ai Projects (No-Code Agent Context)
For lightweight agents that don't need to write to databases:
- Create a Project in claude.ai
- Upload SOPs, pricing sheets, FAQs as knowledge
- Set a system prompt defining the agent's role and rules
- Share the Project link with the client team
- Best for: internal Q&A agents, document review, meeting prep

**Limitation:** No tool use, no database writes, no automation. Use for human-in-the-loop tasks only.

#### Option C — MCP Servers (Agent Data Connectivity)
MCP (Model Context Protocol) lets Claude Code and Claude Desktop connect to live data sources. For Claude Code sessions working on a client engagement:

```json
// claude_desktop_config.json — MCP servers for this engagement
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest",
               "--supabase-url", "{SUPABASE_URL}",
               "--service-role-key", "{SERVICE_ROLE_KEY}"]
    },
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@cloudflare/mcp-server-cloudflare"],
      "env": { "CLOUDFLARE_API_TOKEN": "{CF_API_TOKEN}" }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{GITHUB_TOKEN}" }
    },
    "google-drive": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-gdrive"]
    }
  }
}
```

This lets Claude Code query the database, deploy Workers, read Drive docs, and manage the repo — all from a single Claude Code session.

#### Option D — Scheduled Agents (Cron Workers)
For autonomous agents that run on a schedule without human trigger:

```toml
# wrangler.toml — add cron trigger
[[triggers]]
crons = ["0 6 * * *"]  # Daily at 6AM UTC
```

```typescript
// src/index.ts — handle the scheduled event
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runOpsAgent(env));
  },
  async fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  }
};
```

### 3.8 Agent Knowledge Base Setup

Before agents can reference knowledge, you have to load it. This is done once at setup and updated whenever SOPs change.

```bash
# scripts/seed-kv.sh — Load knowledge documents into CF KV

# SOPs go in as key:value pairs
wrangler kv:key put --binding=KNOWLEDGE "sop:onboarding" "$(cat knowledge/sops/onboarding.md)"
wrangler kv:key put --binding=KNOWLEDGE "sop:returns" "$(cat knowledge/sops/returns.md)"
wrangler kv:key put --binding=KNOWLEDGE "faq:pricing" "$(cat knowledge/faqs/pricing.md)"
wrangler kv:key put --binding=KNOWLEDGE "pricing:enterprise" "$(cat knowledge/pricing/enterprise.md)"

# Large documents go to R2
wrangler r2 object put {CLIENT-SLUG}-knowledge/employee-handbook.pdf \
  --file knowledge/docs/employee-handbook.pdf

# For semantic search — embed and load into Vectorize
# (Run this script to chunk, embed, and index all knowledge docs)
npx tsx scripts/vectorize-knowledge.ts
```

```typescript
// scripts/vectorize-knowledge.ts — Embed knowledge docs for semantic search
import { readdir, readFile } from 'fs/promises';

const docs = await readdir('./knowledge', { recursive: true });
for (const doc of docs) {
  const content = await readFile(`./knowledge/${doc}`, 'utf-8');
  const chunks = chunkText(content, 512); // ~512 token chunks
  
  for (const chunk of chunks) {
    // Generate embedding using CF Workers AI or OpenAI
    const embedding = await generateEmbedding(chunk);
    
    // Insert into Vectorize
    await vectorize.insert([{
      id: `${doc}-${chunk.index}`,
      values: embedding,
      metadata: { source: doc, content: chunk.text }
    }]);
  }
}
```

---

## SECTION 5: ENVIRONMENT SETUP PROTOCOL

> **FOR CLAUDE CODE:** Execute these phases in order. Do not skip. Flag every manual step. This section is your build checklist.

---

### PHASE 1: GITHUB — CODE LAYER

```bash
# 1.1 — Create private engagement repo
gh repo create oag-{client-slug} --private \
  --description "OAG Done-For-You Engagement: {Client Name}"

# 1.2 — Clone and scaffold
git clone https://github.com/obsidian-axis/oag-{client-slug}.git
cd oag-{client-slug}

# 1.3 — Create full directory structure
mkdir -p src/{routes,agents,lib,types} \
         frontend/src/{components,pages,hooks,lib} \
         frontend/public/assets \
         supabase/migrations \
         knowledge/{sops,faqs,pricing,docs} \
         scripts \
         .github/workflows

# 1.4 — Create .gitignore
cat > .gitignore << 'EOF'
.env
.env.local
.dev.vars
node_modules/
dist/
.wrangler/
*.local
.DS_Store
EOF

# 1.5 — Initial commit
git add . && git commit -m "chore: initial scaffold — {Client Name} engagement"
git push origin main
git checkout -b dev && git push origin dev
```

---

### PHASE 2: SUPABASE — DATA LAYER

```bash
# 2.1 — Install CLI
npm install -g supabase

# [MANUAL STEP] 2.2 — Create Supabase project
# https://supabase.com/dashboard → New Project
# Name: oag-{client-slug} | Region: us-east-1
# Save: Project URL, anon key, service_role key, project ref

# 2.3 — Link and init
supabase init
supabase link --project-ref {PROJECT_REF}

# 2.4 — Write base migration
cat > supabase/migrations/001_base_schema.sql << 'EOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector"; -- For pgvector if using Supabase for embeddings

-- ── ORGANIZATIONS ──────────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  industry TEXT,
  tier TEXT DEFAULT 'standard',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ── CONTACTS ────────────────────────────────────────────────
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'customer', -- customer | lead | vendor | employee
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  status TEXT DEFAULT 'active',
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON contacts FOR ALL
  USING (org_id IN (SELECT id FROM organizations WHERE id = (auth.jwt()->>'org_id')::UUID));

-- ── TASKS ───────────────────────────────────────────────────
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open', -- open | in_progress | done | blocked | cancelled
  priority TEXT DEFAULT 'medium', -- low | medium | high | urgent
  assignee_id UUID,
  contact_id UUID REFERENCES contacts(id),
  due_date TIMESTAMPTZ,
  source TEXT DEFAULT 'human', -- human | agent
  agent_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ── ACTIVITY LOG (Immutable) ─────────────────────────────────
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  actor_type TEXT NOT NULL, -- human | agent
  actor_id TEXT NOT NULL,  -- user_id or agent_name
  action TEXT NOT NULL,
  entity_type TEXT,        -- contact | task | deal | etc.
  entity_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
-- Activity log is append-only — no UPDATE or DELETE policies

-- ── AGENT RUNS ──────────────────────────────────────────────
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  agent_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- cron | webhook | user | agent
  task_description TEXT NOT NULL,
  status TEXT DEFAULT 'running', -- running | completed | failed
  actions_taken TEXT[] DEFAULT '{}',
  records_modified TEXT[] DEFAULT '{}',
  output TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL, -- email | sms | internal
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending_review', -- pending_review | approved | sent | failed
  approved_by UUID,
  sent_at TIMESTAMPTZ,
  agent_run_id UUID REFERENCES agent_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
EOF

# 2.5 — Apply migration
supabase db push

# 2.6 — Generate TypeScript types
supabase gen types typescript --project-id {PROJECT_REF} > src/types/supabase.ts

# 2.7 — Enable Google OAuth
# [MANUAL STEP] Supabase Dashboard → Authentication → Providers → Google
# Add Google OAuth client ID and secret
# Redirect URL: https://{your-worker}.workers.dev/auth/callback
```

---

### PHASE 3: CLOUDFLARE — COMPUTE + CUSTOMER LAYER

```bash
# 3.1 — Install Wrangler
npm install -g wrangler

# [MANUAL STEP] 3.2 — Authenticate
wrangler login

# 3.3 — Install dependencies
npm init -y
npm install hono @supabase/supabase-js @anthropic-ai/sdk
npm install -D wrangler typescript @cloudflare/workers-types

# 3.4 — Create wrangler.toml
cat > wrangler.toml << 'EOF'
name = "oag-{client-slug}-api"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# Scheduled agent (daily 6AM UTC)
[[triggers]]
crons = ["0 6 * * *"]

# KV — Knowledge buckets
[[kv_namespaces]]
binding = "KNOWLEDGE"
id = "{KV_NAMESPACE_ID}"  # wrangler kv:namespace create "KNOWLEDGE"

# D1 — Agent audit log (edge SQLite)
[[d1_databases]]
binding = "AGENT_LOG"
database_name = "oag-{client-slug}-agents"
database_id = "{D1_DATABASE_ID}"  # wrangler d1 create oag-{client-slug}-agents

# R2 — Document store / knowledge files
[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "oag-{client-slug}-docs"  # wrangler r2 bucket create oag-{client-slug}-docs

[vars]
ENVIRONMENT = "production"
CLIENT_NAME = "{Client Name}"
CLIENT_SLUG = "{client-slug}"
EOF

# 3.5 — Create KV namespace
wrangler kv:namespace create "KNOWLEDGE"
# Copy the ID into wrangler.toml

# 3.6 — Create D1 database
wrangler d1 create oag-{client-slug}-agents
# Copy the ID into wrangler.toml

# 3.7 — Create R2 bucket
wrangler r2 bucket create oag-{client-slug}-docs

# 3.8 — Add secrets (never in wrangler.toml)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_SHEETS_ID
wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY

# 3.9 — Build base Hono API
cat > src/index.ts << 'WORKER'
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { agentRoutes } from './routes/agents';
import { contactRoutes } from './routes/contacts';
import { taskRoutes } from './routes/tasks';
import { syncRoutes } from './routes/sync';
import { webhookRoutes } from './routes/webhooks';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*' }));

// Health check
app.get('/', (c) => c.json({
  status: 'ok',
  client: c.env.CLIENT_NAME,
  timestamp: new Date().toISOString()
}));

// Routes
app.route('/agents', agentRoutes);
app.route('/contacts', contactRoutes);
app.route('/tasks', taskRoutes);
app.route('/sync', syncRoutes);
app.route('/webhooks', webhookRoutes);

// Scheduled agent (cron)
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const { runOpsAgent } = await import('./agents/ops-agent');
    ctx.waitUntil(runOpsAgent(env));
  }
};
WORKER

# 3.10 — Test locally
wrangler dev

# 3.11 — Deploy
wrangler deploy
```

---

### PHASE 4: REACT FRONTEND — CUSTOMER LAYER

```bash
# 4.1 — Create Vite React app in /frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install @supabase/supabase-js react-router-dom

# 4.2 — Cloudflare Pages project
# [MANUAL STEP] Cloudflare Dashboard → Workers & Pages → Create → Pages
# Connect to GitHub repo → Build command: npm run build → Output: dist
# Or via CLI:
wrangler pages project create oag-{client-slug}-app

# 4.3 — Add Pages deploy to GitHub Actions (see Phase 5)

# 4.4 — Set Pages environment variables
# [MANUAL STEP] Cloudflare Dashboard → Pages Project → Settings → Env Variables
# VITE_SUPABASE_URL = your supabase project URL
# VITE_SUPABASE_ANON_KEY = your supabase anon key
# VITE_API_URL = https://oag-{client-slug}-api.{account}.workers.dev
```

---

### PHASE 5: GITHUB ACTIONS — CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy Engagement Stack

on:
  push:
    branches: [main]

jobs:
  deploy-worker:
    name: Deploy Cloudflare Worker (API)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}

  deploy-pages:
    name: Deploy Cloudflare Pages (React UI)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: cd frontend && npm ci && npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy frontend/dist --project-name=oag-{client-slug}-app
```

```bash
# [MANUAL STEP] Add GitHub Secrets
# Repo → Settings → Secrets → Actions → New repository secret
# CLOUDFLARE_API_TOKEN — from CF Dashboard → Profile → API Tokens → Create Token
#   Permissions: Workers Edit, Pages Edit, D1 Edit, KV Edit, R2 Edit
```

---

### PHASE 6: GOOGLE NATIVE — MIRROR + COMMS SETUP

```
[ALL MANUAL STEPS — these require Google account access]

Step 6.1 — Internal Drive Structure (Client Team)
  Create folder: "OAG | {Client Name} — Internal"
  Subfolders:
    /KPI_Mirrors         ← Sheets pushed from Supabase/CF
    /Knowledge_Base      ← SOPs, FAQs, pricing docs (agent-readable)
    /Reports             ← AI-generated reports delivered here
    /Comms_Archive       ← Log of sent communications
    /Discovery           ← Intake docs from engagement start

Step 6.2 — KPI Mirror Sheet
  Create Google Sheet: "{Client Name} — Operations Mirror"
  Tabs: Dashboard | Contacts | Tasks | Agent_Activity | KPI_Trends
  IMPORTANT: This sheet is READ-ONLY for the team.
  Data comes from Cloudflare Worker → Google Sheets API (on schedule).
  Share: Client team gets View + Comment access. No Edit.

Step 6.3 — Knowledge Base Folder
  Folder: /Knowledge_Base
  Upload: Client's existing SOPs, FAQs, pricing sheets, policy docs
  These are the source documents that get loaded into CF KV + Vectorize.
  Agents can also reference these directly via the `read_drive_document` tool.
  Format: Google Docs preferred (agents can read via API). PDFs also work (stored in R2).

Step 6.4 — Google Service Account (for API access from CF Worker)
  [MANUAL] Google Cloud Console → IAM → Service Accounts → Create
  Name: oag-{client-slug}-worker@{project}.iam.gserviceaccount.com
  Role: Editor on the specific Sheets and Drive folder (not org-wide)
  Download JSON key → base64 encode → add as CF Worker secret: GOOGLE_SERVICE_ACCOUNT_KEY
  Share the KPI Mirror Sheet and Knowledge_Base folder with the service account email

Step 6.5 — Gmail Integration (Comms Relay)
  Option A: Gmail API via Service Account with domain-wide delegation (Workspace only)
  Option B: SMTP relay via SendGrid/Mailgun (simpler, preferred for most LMM clients)
  Option C: Apps Script as a mail relay (free, limited to 100/day consumer)
  Recommendation: Use SendGrid for all transactional/agent-triggered email.
               Use Gmail + Apps Script only for internal team notifications.
```

---

## SECTION 6: MASTER ENVIRONMENT VARIABLES

```env
# ── SUPABASE (Server — never expose to browser) ───────────
SUPABASE_URL=https://{project-ref}.supabase.co
SUPABASE_ANON_KEY=eyJ...                # Safe: used in React frontend
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Secret: CF Worker only
SUPABASE_PROJECT_REF=abcdef123456

# ── CLOUDFLARE ────────────────────────────────────────────
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=                   # Workers + Pages + D1 + KV + R2 edit
CF_WORKER_URL=https://oag-{slug}-api.{account}.workers.dev

# ── ANTHROPIC ─────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...            # CF Worker secret. Never in frontend.
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6
ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5
ANTHROPIC_OPUS_MODEL=claude-opus-4-6

# ── GITHUB ────────────────────────────────────────────────
GITHUB_TOKEN=ghp_...
GITHUB_REPO=obsidian-axis/oag-{client-slug}

# ── GOOGLE ────────────────────────────────────────────────
GOOGLE_KPI_SHEET_ID=                    # The Sheets mirror spreadsheet ID
GOOGLE_KNOWLEDGE_FOLDER_ID=            # Drive folder ID for knowledge base
GOOGLE_SERVICE_ACCOUNT_EMAIL=          # SA email for API auth
GOOGLE_SERVICE_ACCOUNT_KEY=            # Base64-encoded JSON key

# ── EMAIL / COMMS ─────────────────────────────────────────
SENDGRID_API_KEY=SG....                 # Or Mailgun, Postmark, etc.
FROM_EMAIL=noreply@{client-domain}.com
ADMIN_EMAIL={client-team-lead}@{domain}.com

# ── DATA SOVEREIGNTY ──────────────────────────────────────
CLIENT_ORG_ID=                          # UUID of client's org in Supabase
CLIENT_GITHUB_PAT=ghp_...              # Client's own PAT — minimum scope, stored in Supabase secrets only
CLIENT_GITHUB_DATA_REPO={client-org}/{client-slug}-data  # Client-owned repo
WEBHOOK_SECRET=                         # Shared secret to validate Supabase webhooks
SCHEMA_VERSION=1.0                      # Bump when schema changes for export manifest

# ── CLIENT CONFIG ─────────────────────────────────────────
CLIENT_NAME={Full Client Business Name}
CLIENT_SLUG={client-slug}
CLIENT_INDUSTRY={industry}
ENGAGEMENT_TIER=2
ENVIRONMENT=production
```

---

## SECTION 7: AGENT DEPLOYMENT DECISION GUIDE

Use this to determine which agents to deploy for a given client:

| If the client needs... | Deploy this agent | Trigger type |
|---|---|---|
| Daily operational awareness | Ops Agent | Cron (6AM daily) |
| Automated pipeline hygiene | CRM Agent | Supabase webhook (contact/deal change) |
| Customer self-service Q&A | Knowledge Agent | On-demand (React UI) |
| Automated client communications | Comms Agent | Supabase webhook (event-based) |
| Document intake and extraction | Custom: Document Agent | On-demand (file upload webhook) |
| Scheduling and calendar ops | Custom: Calendar Agent | On-demand + cron |
| Invoice and billing review | Custom: Finance Agent | Cron (weekly) |
| Staff performance tracking | Custom: HR Agent | Cron (monthly) |
| Competitive intelligence | Custom: Market Agent | On-demand |

### Escalation and Human-in-the-Loop Rules
Every agent must follow these rules — they are not optional:

```
ALWAYS log to agent_runs table — every execution, every iteration
ALWAYS require human approval for:
  - Any customer-facing communication (except transactional)
  - Any financial transaction or record
  - Any deletion or archive operation
  - Any action that cannot be undone

NEVER auto-send marketing or relationship emails
NEVER delete or overwrite records without a soft-delete pattern
NEVER take financial actions autonomously
NEVER expose raw database structure or IDs to customers
```

---

## SECTION 8: ENGAGEMENT CHECKLIST

### Pre-Build (Day 0)
- [ ] Signed contract in Drive `/99_Admin`
- [ ] Client details filled in throughout this file
- [ ] Engagement tier assigned (1–4)
- [ ] Stack cost estimate confirmed with client (if applicable)
- [ ] Brand assets received (logo, colors, fonts)

### Environment Setup
- [ ] GitHub repo created (`oag-{client-slug}`)
- [ ] Supabase project created, schema migrated, RLS confirmed
- [ ] TypeScript types generated and committed
- [ ] Cloudflare Worker deployed, health check returning 200
- [ ] KV namespace, D1 database, and R2 bucket created
- [ ] Cloudflare Pages project created, React app deploying
- [ ] Google Drive folder structure created
- [ ] KPI Mirror Sheet created (read-only for client)
- [ ] Knowledge Base folder created, initial docs uploaded
- [ ] Google Service Account created and shared with sheet + folder
- [ ] GitHub Actions CI/CD live (push → deploy working)
- [ ] All secrets configured (CF, GitHub, no `.env` files committed)

### Agent Deployment
- [ ] Required agents identified (from Section 6 decision guide)
- [ ] System prompts customized with client name, industry, brand voice
- [ ] Knowledge base loaded into CF KV (`scripts/seed-kv.sh`)
- [ ] Knowledge base embedded into Vectorize (`scripts/vectorize-knowledge.ts`)
- [ ] Each agent tested with a sample task before go-live
- [ ] Agent run logs appearing in `agent_runs` table
- [ ] Approval workflows for comms confirmed with client team

### Data Sovereignty — Triple Redundancy
- [ ] Client GitHub data repo created in **CLIENT'S** account (not OAG's)
- [ ] Client GitHub PAT generated — minimum scope (Contents R/W, single repo only)
- [ ] PAT stored as Supabase secret — OAG retains no copy
- [ ] Supabase webhooks configured for all mirror tables (contacts, tasks, activity_log, agent_runs, notifications)
- [ ] Webhook → Google Sheets flow tested (write to DB → row appears in Sheet within seconds)
- [ ] Sheet mirror is read-only for client team (no edit access)
- [ ] Nightly export Edge Function deployed (`supabase functions deploy nightly-export`)
- [ ] pg_cron scheduled at 2AM UTC in Supabase SQL Editor
- [ ] First manual export triggered and verified (`supabase functions invoke nightly-export`)
- [ ] Export files confirmed in client's GitHub repo (JSON + CSV + manifest)
- [ ] Client walked through GitHub data repo — they know where their data lives
- [ ] Client walked through Sheets mirror — they can read it without logging into OAG tools
- [ ] Data sovereignty README committed to client data repo
- [ ] `schema.sql` snapshot committed to client data repo

### Go-Live
- [ ] Supabase upgraded to Pro
- [ ] Cloudflare upgraded to Workers Paid ($5/mo)
- [ ] Custom domain configured in Cloudflare DNS
- [ ] Auth flow tested end-to-end (Google OAuth → Supabase → React app)
- [ ] KPI Sheet mirror tested (CF Worker → Google Sheets push)
- [ ] Client team onboarded to the React portal
- [ ] Client team shown the Sheets mirror and how to read it
- [ ] Handoff documentation written (`supabase/schema.sql` + `README.md`)

---

## SECTION 9: QUICK COMMAND REFERENCE

```bash
# ── GITHUB ──────────────────────────────────────
gh repo create oag-{slug} --private
gh secret set CLOUDFLARE_API_TOKEN --body "your-token"
git checkout -b feature/{module} && git push origin feature/{module}

# ── SUPABASE ────────────────────────────────────
supabase db push                         # Apply pending migrations
supabase db pull                         # Pull remote schema changes
supabase gen types typescript --project-id {ref} > src/types/supabase.ts
supabase functions deploy {name}         # Deploy an Edge Function

# ── CLOUDFLARE ──────────────────────────────────
wrangler dev                             # Local dev (port 8787)
wrangler deploy                          # Deploy Worker to production
wrangler tail                            # Stream live logs from production
wrangler secret put {SECRET_NAME}        # Add/update a secret
wrangler kv:key put --binding=KNOWLEDGE "sop:onboarding" "$(cat file.md)"
wrangler kv:key get --binding=KNOWLEDGE "sop:onboarding"
wrangler r2 object put {bucket}/{key} --file ./path/to/file
wrangler d1 execute {db-name} --command "SELECT * FROM agent_runs LIMIT 10"
wrangler pages deploy frontend/dist --project-name oag-{slug}-app

# ── AGENT TESTING ────────────────────────────────
# Test ops agent locally
curl -X POST http://localhost:8787/agents/ops-agent \
  -H "Content-Type: application/json" \
  -d '{"task": "Run the morning operations briefing for today"}'

# Test knowledge agent
curl -X POST http://localhost:8787/agents/knowledge-agent \
  -H "Content-Type: application/json" \
  -d '{"task": "What is our refund policy for enterprise customers?"}'

# ── CLAUDE CODE ──────────────────────────────────
claude                                   # Start session (reads this file)
claude --continue                        # Resume last session
claude "read ENGAGEMENT.md then scaffold the CRM agent for this client"
```

---

## SECTION 10: ENGAGEMENT LOG

> Claude Code updates this section at the start of each work session.

### Client: {CLIENT NAME}
**Industry:** {INDUSTRY} | **Phase:** {PHASE} | **Tier:** {TIER}
**Start Date:** {DATE} | **Target Go-Live:** {DATE}

#### Environment Status
| Platform | Status | Reference |
|---|---|---|
| GitHub | ⬜ Pending | github.com/obsidian-axis/oag-{slug} |
| Supabase | ⬜ Pending | {ref}.supabase.co |
| CF Worker (API) | ⬜ Pending | oag-{slug}-api.workers.dev |
| CF Pages (UI) | ⬜ Pending | oag-{slug}-app.pages.dev |
| Custom Domain | ⬜ Pending | {client-domain}.com |
| Google Drive | ⬜ Pending | drive.google.com/... |
| KPI Mirror Sheet | ⬜ Pending | docs.google.com/spreadsheets/... |
| Knowledge Base (KV) | ⬜ Pending | — |
| Knowledge Base (Vectorize) | ⬜ Pending | — |

#### Active Agents
| Agent | Status | Trigger | Last Run |
|---|---|---|---|
| Ops Agent | ⬜ Not deployed | Cron 6AM | — |
| CRM Agent | ⬜ Not deployed | Webhook | — |
| Knowledge Agent | ⬜ Not deployed | On-demand | — |
| Comms Agent | ⬜ Not deployed | Webhook | — |

#### Build Log
| Date | Feature / Module | Status | Notes |
|---|---|---|---|
| {DATE} | Initial scaffold | ⬜ | |

---

*Built by OAG — Obsidian Axis Group. Maintained by Cedric, Managing Partner.*
*For questions about this engagement stack, reference this file first. Then ask Claude Code.*
