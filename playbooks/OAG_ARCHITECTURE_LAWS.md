# OAG ARCHITECTURE LAWS
### Obsidian Axis Group | The Non-Negotiable Rules of the Stack
**Version:** 1.0 | **Maintainer:** Cedric (Managing Partner, OAG)

---

> **PURPOSE OF THIS DOCUMENT**
> This is the **law book** for OAG's technical architecture. Claude Code reads this to understand what is allowed, what is forbidden, and why. These rules exist because we've seen what breaks first.
>
> **Companion documents:**
> - What each platform CAN do → `OAG_POWER5_CAPABILITY_REFERENCE.md`
> - Which capability to use for which decision → `OAG_DECISION_LAWS.md`
> - Full engagement build guide → `OAG_CLIENT_ENGAGEMENT_MASTER.md`
>
> **Every rule in this document traces to a first principle.** If a proposed design violates any law below, the design is wrong — not the law. If a genuinely new scenario arises that the laws don't cover, escalate to Cedric before building.

---

## LAW 1: THE ARCHITECTURE HIERARCHY

Every component in the stack has one job. These tiers define what each platform does and — critically — what it does NOT do.

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

---

## LAW 2: THE THREE DATA FLOW LAWS

### Law 2A — Supabase is the source of truth.
If data matters to the business, it lives in Supabase. Not in a Sheet. Not in a Drive folder. Not in a KV store. Those are downstream mirrors and caches. Supabase holds the record.

### Law 2B — Google is a display and delivery surface.
Google Sheets show what Supabase knows. Google Drive stores reference documents that agents can read. Gmail delivers messages that Cloudflare Workers compose and trigger. Google does NOT store primary business data. Google does NOT receive form submissions that bypass the stack.

### Law 2C — Customers never touch Google.
Everything a client's customer interacts with — portals, dashboards, forms, apps — is a Cloudflare Pages frontend built in React. Branded. Fast. Professional. The fact that the backend runs on Supabase and CF is invisible to the customer.

### Permitted Data Flows (The Complete Map)

```
Supabase / Cloudflare  ──PUSH──►  Google Sheets   (mirror)
Cloudflare Worker      ──SEND──►  Gmail            (comms relay)
Cloudflare Worker      ──WRITE──► Google Drive     (document delivery)
Agent                  ──READ──►  Google Drive     (knowledge reference)
Agent                  ──READ──►  Google Sheets    (operational reference)
Customer form submit   ──POST──►  Cloudflare Worker (then Worker writes to Supabase)

❌ NEVER: Google Sheets  ──WRITE──► Supabase directly
❌ NEVER: Apps Script    ──is the trigger for── business logic
❌ NEVER: Customer       ──sees──► any Google product
❌ NEVER: Google Forms   ──is the intake for── customer-facing data
```

**Why these rules exist (first principle):** If data enters through Google, it's unvalidated, unstructured, and outside the security boundary (no RLS, no JWT, no Worker middleware). Every data entry point must pass through a Cloudflare Worker that validates, sanitizes, and writes to Supabase. This is what makes the architecture auditable and secure.

---

## LAW 3: THE STACK INTEGRATION MAP

How the Power 5 components wire together:

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
          │  Deployed from GitHub on every push to main  │
          └────────────────────┬─────────────────────────┘
                               │ fetch() to Worker API
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE WORKERS (Hono API)                    │
│                                                                    │
│  REST API · Agents · Cron / Scheduled · Webhook Receivers         │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │            CF KNOWLEDGE + STORAGE LAYER                   │    │
│  │  KV (SOPs, config, FAQs) · R2 (docs, PDFs, reports)      │    │
│  │  D1 (agent logs, audit) · Vectorize (semantic search)     │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────┬──────────────────────────┬───────────────────────────┘
            │ queries / writes          │ AI calls
            ▼                          ▼
┌─────────────────────┐    ┌───────────────────────────────────────┐
│     SUPABASE        │    │         CLAUDE / ANTHROPIC            │
│                     │    │                                       │
│  PostgreSQL (RLS)   │    │  Haiku → fast/cheap classification   │
│  Auth (Google OAuth)│◄───│  Sonnet → default agent model        │
│  Realtime channels  │    │  Opus → deep reasoning only          │
│  Storage (user files)│   │  Tool Use → queries DB, KV, Drive    │
│  Webhooks → CF      │    │  Streaming → real-time UI responses  │
└─────────────────────┘    │  Batch → nightly bulk operations     │
            │               └───────────────────────────────────────┘
            │ webhooks (push mirrors)
            ▼
┌──────────────────────────────────────────────────────────────┐
│              GOOGLE NATIVE (Internal Mirror Only)            │
│                                                              │
│  Sheets ◄── CF pushes KPI mirrors on schedule               │
│  Drive  ◄── CF writes reports · Agents read SOPs            │
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
│  Client-owned data repo (nightly exports, L2 archive)       │
└──────────────────────────────────────────────────────────────┘
```

### Key Integration Wires
1. **GitHub → Cloudflare** — GitHub Actions deploys Workers + Pages on every push to `main`
2. **Cloudflare → Supabase** — Workers call Supabase REST or direct Postgres (via Hyperdrive)
3. **Cloudflare → Claude** — Workers call Anthropic API for AI features, routed via AI Gateway
4. **Supabase → Cloudflare** — Database Webhooks trigger Workers on table events
5. **Cloudflare → Google Sheets** — Workers push mirror data to Sheets on schedule or event
6. **Cloudflare → Gmail** — Workers send comms via Gmail API or SMTP relay
7. **Agents → Google Drive** — Agents read knowledge base documents from Drive (read-only)
8. **Supabase → Client GitHub** — Edge Function nightly export to client-owned repo

---

## LAW 4: DATA SOVEREIGNTY — TRIPLE REDUNDANCY

Every client's data exists in three independently owned and controlled locations simultaneously. Each location is owned by the **client**, not by OAG.

### The Three Layers

| Layer | System | Purpose | Update Cadence | Format |
|---|---|---|---|---|
| **L0 — Source of Truth** | Supabase PostgreSQL | Live database, RLS-enforced, server-authoritative | Real-time | Relational SQL |
| **L1 — Real-Time Human Mirror** | Google Sheets (client's account) | Operational visibility for non-technical staff | Seconds (webhook → Worker → Sheets API) | Tabular / human-readable |
| **L2 — Durable Truth Store** | Private GitHub repo (client's account) | Portable, open-format archive. Zero vendor lock-in. | Nightly (Supabase Edge Function → GitHub API) | JSON + CSV |

### Data Flow for Triple Redundancy

```
Supabase table write (INSERT / UPDATE)
         │
         ├──────────────────────────► L0: Data lives in Supabase (immediate)
         │
         ▼ (Supabase Database Webhook)
Cloudflare Worker /webhooks/supabase
         │
         ▼ (Google Sheets API)
         ├──────────────────────────► L1: Row appears in client's Google Sheet (seconds)
         
Supabase Edge Function (nightly cron)
         │
         ├─ Queries all tables
         ├─ Serializes to JSON + CSV
         │
         ▼ (GitHub Contents API)
         └──────────────────────────► L2: Snapshot committed to client's GitHub repo (nightly)
```

### The Redundancy Matrix — What Survives What

| Failure Scenario | L0 (Supabase) | L1 (Sheets) | L2 (GitHub) | Client Impact |
|---|---|---|---|---|
| OAG stops operating | ❌ May lose access | ✅ Client owns | ✅ Client owns | Max 24hr data loss. Full history recoverable. |
| Supabase outage | ❌ Unavailable | ✅ Last webhook state | ✅ Last nightly export | Read-only ops via Sheets |
| Google outage | ✅ Fully operational | ❌ Mirror unavailable | ✅ Available | App continues. Mirror recovers when Google restores. |
| GitHub outage | ✅ Fully operational | ✅ Fully operational | ❌ Export pauses | No operational impact. Exports resume next night. |
| Accidental data deletion | ✅ Soft-delete recoverable | ✅ Captures pre-delete state | ✅ Full history in git log | Full recovery from any layer |
| Security breach | ✅ Point-in-time restore | ✅ Last clean mirror | ✅ Specific night's export | Multiple clean restore points |

### The Ownership Guarantee

> **The claim we make to every client:**
> *"Your data is in your account, on your infrastructure, under your credentials. If our tech partner disappears tomorrow, nothing changes for you."*

This claim is enforced by architecture, not promises:
- L0 (Supabase) project is in the client's Supabase org
- L1 (Sheets) mirror is in the client's Google account
- L2 (GitHub) repo is in the client's GitHub account
- All three layers use open formats (SQL, CSV, JSON) — zero OAG-proprietary encoding

**The deletable-consultant test:** Mentally remove OAG from every credential. Can the client still access all three layers? If no for any layer, the architecture is not done.

### Triple redundancy is non-negotiable.
A Phase 0 engagement that ships with only one or two of the three data layers is not Phase 0 — it's a half-built product and the ownership claim is unenforceable. Every engagement must pass the verification drill defined in `CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md §8`.

---

## LAW 5: SYSTEM RESILIENCE — CROSS-PLATFORM BACKUP

Beyond the triple redundancy for client data (Law 4), each Power 5 platform has a backup strategy that leverages the other platforms. No single platform failure should stop operations entirely.

### Platform Failure Recovery Map

| If This Fails... | Immediate Impact | Recovery Path | Backup Platform |
|---|---|---|---|
| **Supabase** (database down) | App can't read/write live data | Cloudflare D1 holds edge cache of critical records. R2 holds latest nightly export. Google Sheets has real-time mirror. | CF D1 + R2 + Google Sheets |
| **Cloudflare Workers** (compute down) | API endpoints unavailable, agents can't run | Supabase Edge Functions can serve as emergency API. Supabase Realtime still works for connected clients. GitHub Pages can serve static fallback. | Supabase Edge Functions |
| **Cloudflare Pages** (frontend down) | Customer-facing UI unavailable | GitHub Pages can serve a static maintenance page. Supabase Auth still works for direct API access. | GitHub Pages (static fallback) |
| **Claude API** (AI unavailable) | Agents can't reason, AI features degraded | Cloudflare Workers AI provides local inference fallback (Llama, Mistral) for simple classification and routing. Complex tasks queue for retry. | CF Workers AI (degraded) |
| **GitHub** (code hosting down) | Can't deploy new code, CI/CD paused | Last deployed Workers/Pages continue running (already at the edge). Supabase migrations are already applied. Local git copies exist. | Edge-deployed code persists |
| **Google** (Sheets/Drive/Gmail down) | Mirror unavailable, no outbound comms, agents can't read Drive docs | App and database fully operational. Agent knowledge cached in CF KV and R2. Comms queue in Supabase `notifications` table until Gmail restores. | CF KV + R2 + Supabase queue |

### Resilience Design Principles

**Principle 1: Cache at the edge, source from the center.**
Critical data that agents or Workers need should be cached in Cloudflare KV or D1. If Supabase is briefly unavailable, the edge cache serves stale-but-usable data. When Supabase recovers, the cache refreshes.

**Principle 2: Queue, don't fail.**
If an outbound action fails (Sheets write, Gmail send, GitHub export), write the action to a Supabase `pending_actions` table or Cloudflare Queue. A retry Worker processes the queue when the target recovers. Never drop actions silently.

**Principle 3: Static fallback for customer UIs.**
Every Cloudflare Pages deployment should include a `_maintenance.html` that can be served if the Worker API is unreachable. The customer sees "we're performing maintenance" instead of a blank page or error.

**Principle 4: Knowledge lives in two places.**
Agent knowledge base documents should exist in both Google Drive (human-editable source) AND Cloudflare KV/R2 (agent-accessible cache). If Drive is down, agents still have their knowledge. When Drive is updated, a sync Worker refreshes the CF copy.

**Principle 5: Every nightly export is an insurance policy.**
The L2 nightly GitHub export (Law 4) is not just for the client's ownership claim — it's a disaster recovery snapshot. If Supabase data is corrupted or lost, the last clean nightly export can be imported back into a fresh Supabase project.

---

## LAW 6: CUSTODY AND ACCOUNT OWNERSHIP

### The Rule
Every production account, credential, and asset is registered to the **client**, not to OAG. OAG is a user on client accounts — never the owner.

### The GitHub-First SSO Chain
1. Create the client's **GitHub** account first (business email)
2. Sign into **Cloudflare** with "Continue with GitHub" (OAuth)
3. Sign into **Supabase** with "Continue with GitHub" (OAuth)
4. **Google Workspace** — client invites consultant (only exception to OAuth chain)

One identity anchor (GitHub) → three vendor logins. At engagement close, the client revokes one OAuth grant per vendor. No passwords to rotate.

### The Deletable-Consultant Guarantee
After setup, OAG must be removable from every production credential without the client losing access to their data. If that isn't true, setup isn't done.

> **Full custody procedures, verification code relay protocol, and the custody matrix template live in `CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md`.**

---

## LAW 7: SECURITY BASELINES

These apply to every engagement, no exceptions:

### Database Security
- **RLS on every table from day one.** No table exists without Row-Level Security enabled AND at least one policy defined.
- **Verify RLS via SQL, not the UI.** The Supabase dashboard badge is unreliable. Use the `pg_class.relrowsecurity` query.
- **Service role key never in frontend code.** The anon key is safe for client-side use. The service role key lives only in Worker secrets.

### Secret Management
- **No `.env` files committed to git.** Ever. `.gitignore` blocks `.env`, `.dev.vars`, and any `*Logins*` file.
- **Secrets go in platform secret stores:** `wrangler secret put` for CF Workers, GitHub Secrets for Actions, `supabase secrets set` for Edge Functions, Script Properties for Apps Script.
- **Client credentials are never stored by OAG.** OAuth tokens can be revoked. Passwords are never written to any file.

### Deployment
- **Never deploy manually.** Push to `main` → GitHub Actions → Cloudflare. Manual `wrangler deploy` is for local dev only.
- **Every repo has `.env.example`** documenting all required variables with placeholder values. Real values go nowhere near version control.

---

## LAW 8: AGENT GOVERNANCE

All AI agents operating in a client's stack follow these rules:

### Logging
- Every agent execution logs to the `agent_runs` table. Every single one. No silent agents.
- Actions taken, records modified, tokens used, and duration are recorded.

### Human-in-the-Loop
- **Require human approval for:** customer-facing communications (except transactional), financial transactions, deletions, and any irreversible action.
- **NEVER auto-send** marketing or relationship emails. Drafts only — a human approves.
- **NEVER delete** records without soft-delete pattern. `status = 'archived'`, not `DELETE FROM`.

### Safety Limits
- Agent loops are capped at 10 iterations maximum. If an agent hasn't completed its task in 10 tool-use rounds, it stops and logs the incomplete state.
- Cost guardrails: agents default to Sonnet. Opus is invoked only for explicitly flagged deep-reasoning tasks. Haiku for high-volume classification.

---

## QUICK REFERENCE: ALL LAWS IN ONE TABLE

| Law | One-Line Summary |
|---|---|
| 1 — Architecture Hierarchy | Six tiers. Customer UI on CF Pages. Compute on CF Workers. Data in Supabase. AI via Claude. Code in GitHub. Mirror in Google. |
| 2 — Data Flow Laws | Supabase is source of truth. Google is display-only. Customers never touch Google. All data enters through CF Workers. |
| 3 — Integration Map | The wiring diagram. GitHub deploys to CF. CF queries Supabase. CF calls Claude. Supabase webhooks trigger CF. CF pushes to Google. |
| 4 — Triple Redundancy | Client data in three places: Supabase (L0), Google Sheets (L1), client GitHub (L2). All client-owned. Open formats. |
| 5 — System Resilience | Each platform backs up the others. Cache at edge. Queue, don't fail. Static fallbacks. Knowledge in two places. |
| 6 — Custody | Client owns all accounts. GitHub-first SSO chain. OAG is deletable. |
| 7 — Security | RLS always. No secrets in git. Never deploy manually. Verify via SQL. |
| 8 — Agent Governance | Always log. Always require human approval for risky actions. Cap loops. Default to Sonnet. |

---

*Document maintained by OAG — Obsidian Axis Group. Version 1.0. These laws are canonical — all other documents reference them, none override them.*
