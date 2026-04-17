# OAG DECISION LAWS
### Obsidian Axis Group | Which Capability to Use for Which Job
**Version:** 1.0 | **Maintainer:** Cedric (Managing Partner, OAG)

---

> **PURPOSE OF THIS DOCUMENT**
> Claude Code reads this as a lookup table. When you need to make a technical decision — where to store data, which model to call, where to run compute, when to upgrade — consult the relevant section below.
>
> **Companion documents:**
> - What each platform CAN do → `OAG_POWER5_CAPABILITY_REFERENCE.md`
> - The non-negotiable rules → `OAG_ARCHITECTURE_LAWS.md`
>
> **How to use this file:** Find the decision type. Read the routing table. Follow the recommendation. If the situation doesn't match any row, escalate to Cedric before building.

---

## DECISION 1: WHERE TO STORE DATA

### Primary Rule
If data matters to the business, it goes in Supabase. Everything else is a cache, mirror, or convenience layer.

### Storage Routing Table

| Data Type | Store In | Why | Example |
|---|---|---|---|
| Business records (contacts, deals, tasks, orders) | **Supabase PostgreSQL** | Source of truth. RLS-protected. Relational. | `contacts`, `deals`, `tasks` tables |
| User accounts and sessions | **Supabase Auth** | Built-in JWT, MFA, OAuth, magic links. Never roll custom auth. | Google OAuth login, email magic link |
| User-uploaded files tied to a record | **Supabase Storage** | S3-compatible. Bucket policies. Tied to the record it belongs to. | Profile photos, invoices, contracts |
| Knowledge base documents (SOPs, FAQs, pricing) | **Cloudflare KV** (text) + **R2** (binary/large) | Sub-millisecond reads for agents. No egress fees for large files. | `sop:onboarding` in KV, `employee-handbook.pdf` in R2 |
| Agent knowledge embeddings (semantic search) | **Cloudflare Vectorize** | Edge-deployed vector search. Powers RAG for knowledge agents. | Chunked SOP embeddings |
| Agent execution logs and audit trail | **Supabase** `agent_runs` table + optionally **D1** for edge audit | Supabase is authoritative. D1 is a fast edge-local copy for low-latency reads. | Every agent run logged |
| Session state, feature flags, config | **Cloudflare KV** | Fast, global, eventually consistent. Perfect for config and flags. | `feature:dark-mode = true` |
| Lightweight edge-local relational data | **Cloudflare D1** | SQLite at the edge. Good for data that needs to be close to compute. | Edge analytics events, cached lookups |
| Public-facing static assets (images, CSS, JS) | **Cloudflare R2** or **Pages** `public/` folder | Zero egress fees. CDN-served globally. | Client brand assets, marketing images |
| Client-readable data mirror | **Google Sheets** (pushed from CF Worker) | Non-technical staff live in Sheets. Read-only mirror. | KPI dashboard, contact list, task board |
| Reference documents for agents to read | **Google Drive** (original) + **CF KV/R2** (cached copy) | Drive is human-editable source. KV/R2 is agent-accessible cache. | Client SOPs, pricing guides |
| Nightly data export (portability archive) | **Client's GitHub repo** (JSON + CSV) | Open format. Client-owned. Git history = full audit trail. | `/exports/2026-04-15/contacts.json` |

### Anti-Patterns (Never Do This)

| Anti-Pattern | Why It's Wrong | Correct Pattern |
|---|---|---|
| Store primary business data in Google Sheets | Sheets have no RLS, no transactions, no referential integrity. Violates Architecture Law 2A. | Store in Supabase. Push a mirror to Sheets. |
| Use Apps Script as the trigger for business logic | Apps Script has 6-min execution limits, no error recovery, no audit trail. | Apps Script calls a CF Worker endpoint. Worker does the work. |
| Put customer-facing forms on Google Forms | Google Forms expose a Google UI to customers. Violates Architecture Law 2C. | Build the form in React on CF Pages. Worker handles submission → writes to Supabase. |
| Store secrets in `wrangler.toml` `[vars]` | Vars are committed to git and visible in the dashboard. | Use `wrangler secret put` for any sensitive value. |
| Cache data in only one location | Single point of failure. | Knowledge in KV/R2 AND Drive. Data in Supabase AND Sheets AND GitHub. |

---

## DECISION 2: WHICH AI MODEL TO USE

### Model Selection Table

| Task Type | Model | Why | Cost Estimate |
|---|---|---|---|
| Classification, tagging, routing, quick extraction | **Haiku 4.5** | Fastest, cheapest. Sub-second response. Good enough for binary decisions. | ~$0.001/call |
| CRM summaries, agent task execution, email drafts, analysis, scoring | **Sonnet 4.6** (default) | Best balance of quality and cost. OAG's default for everything unless there's a reason to change. | ~$0.004/call |
| Deep strategic reasoning, complex multi-step planning, architecture decisions, exit scorecard analysis | **Opus 4.6** | Most capable. Use only when Sonnet isn't good enough. Always justify. | ~$0.020/call |
| Nightly bulk operations, batch scoring, mass enrichment | **Sonnet via Batch API** | Same quality as Sonnet, 50% cheaper. Processes within 24 hours. | ~$0.002/call |
| Lightweight edge inference (when Claude API is unavailable) | **CF Workers AI** (Llama/Mistral) | Degraded fallback. Local to the edge. No external API call. Limited quality. | Included in CF plan |

### Cost Optimization Rules

| Technique | When to Use | Savings |
|---|---|---|
| **Prompt Caching** | Any system prompt > 1,024 tokens reused across multiple calls | ~80% reduction on cached portion |
| **Batch API** | Any operation that doesn't need real-time response (nightly, bulk, reports) | 50% cheaper than real-time |
| **Haiku downgrade** | Classification, yes/no routing, simple extraction | ~75% cheaper than Sonnet |
| **Streaming** | All user-facing AI responses | No cost savings, but UX feels instant |
| **Extended Thinking** | Complex reasoning tasks where quality matters more than speed | Additional token cost, but dramatically better outputs |

### Model Selection Decision Tree

```
Is the task real-time and user-facing?
├── YES → Is it complex reasoning (strategy, scoring, multi-step)?
│         ├── YES → Sonnet 4.6 (with Extended Thinking if needed)
│         └── NO → Is it a simple classification or routing decision?
│                   ├── YES → Haiku 4.5
│                   └── NO → Sonnet 4.6 (default)
└── NO → Is it a batch of 50+ calls?
          ├── YES → Sonnet 4.6 via Batch API
          └── NO → Sonnet 4.6 (standard)

Only escalate to Opus when:
- Sonnet has been tried and the quality is measurably insufficient
- The task is a one-off deep analysis (not a repeated operation)
- The task involves multi-document synthesis or complex strategic reasoning
```

---

## DECISION 3: WHERE TO RUN COMPUTE

### Compute Routing Table

| Compute Task | Run On | Why |
|---|---|---|
| REST API endpoints (CRUD, auth, webhooks) | **Cloudflare Workers** (Hono) | Sub-millisecond cold start. Global edge. The API hub. |
| Customer-facing UI rendering | **Cloudflare Pages** (React) | Global CDN. Automatic deploys from GitHub. Custom domains. |
| Agent orchestration (Claude tool-use loops) | **Cloudflare Workers** | Agents are Workers. Claude API calls happen here. Tools execute here. |
| Database queries and mutations | **Supabase** (via CF Worker) | Worker authenticates and calls Supabase REST API or Postgres via Hyperdrive. |
| Nightly data export to GitHub | **Supabase Edge Function** | Runs inside Supabase. Direct database access. No need to route through CF. |
| Scheduled jobs (daily reports, data sync) | **CF Workers Cron Triggers** OR **Supabase pg_cron** | CF cron for jobs that call external APIs. pg_cron for jobs that stay inside the database. |
| Lightweight internal automation (Sheet formatting, team notifications) | **Google Apps Script** | Only for internal Google-ecosystem tasks the client's team self-manages. Never for business logic. |
| Background async processing (email delivery, webhook fan-out) | **Cloudflare Queues** | Guaranteed delivery. Automatic retries. Dead-letter queue. |
| Real-time collaboration / WebSocket state | **Cloudflare Durable Objects** | Strongly consistent. Persistent state. WebSocket management. |
| AI inference (fallback, classification at edge) | **CF Workers AI** | When Claude API is unavailable or task is simple enough for local inference. |

---

## DECISION 4: WHEN TO UPGRADE (SCALE-UP TRIGGERS)

### Supabase: Free → Pro ($25/month)

Upgrade when ANY of these are true:
- Engagement has gone live with real users (non-negotiable — free tier auto-pauses)
- Database approaching 400 MB
- Need daily backups instead of 7-day snapshots
- Need email support from Supabase
- Client's customers are using the system

### Cloudflare: Free → Workers Paid ($5/month)

Upgrade when ANY of these are true:
- Engagement goes live with real users (the CPU jump from 10ms → 30s unlocks agents)
- Hitting 100,000 requests/day limit
- Need agent calls in a Worker (agent tool-use loops need > 10ms CPU)
- Need Durable Objects with KV backend
- Need Cloudflare Queues for async processing

### GitHub: Free → Pro/Team

Upgrade when ANY of these are true:
- Need more than 2,000 Actions minutes/month (heavy CI/CD)
- Need advanced branch protection rules (org-level)
- Need code owners or required reviewers
- Team development requires Codespaces

### Google: Personal → Workspace ($7.20/user/month)

Upgrade when ANY of these are true:
- Client needs custom domain email (@company.com)
- Apps Script needs > 90 min/day runtime
- Team needs Shared Drives with admin controls
- Client needs Meet recordings stored in Drive

### Claude API: Usage-Based (Always On)

Optimization triggers:
- **Enable Prompt Caching** when system prompt > 1,024 tokens is reused across calls
- **Switch to Batch API** for any non-real-time operation > 50 calls
- **Downgrade to Haiku** for high-frequency classification/routing tasks
- **Escalate to Opus** only for deep strategic reasoning (justify each use)

---

## DECISION 5: AGENT DEPLOYMENT

### Which Agents to Deploy

| Client Need | Agent | Trigger | Priority |
|---|---|---|---|
| Daily operational awareness | Ops Agent | Cron (daily) | Deploy for every engagement |
| Automated pipeline hygiene | CRM Agent | Supabase webhook (contact/deal change) | Deploy if client has sales pipeline |
| Customer self-service Q&A | Knowledge Agent | On-demand (React UI) | Deploy if client has SOPs/FAQs to serve |
| Automated client communications | Comms Agent | Supabase webhook (event-based) | Deploy if client needs outbound comms |
| Document intake and extraction | Document Agent (custom) | On-demand (file upload) | Deploy if client receives inbound documents |
| Scheduling and calendar ops | Calendar Agent (custom) | On-demand + cron | Deploy if client manages appointments |
| Invoice and billing review | Finance Agent (custom) | Cron (weekly) | Deploy if client has financial review needs |
| Staff performance tracking | HR Agent (custom) | Cron (monthly) | Deploy for clients with teams > 10 |
| Competitive intelligence | Market Agent (custom) | On-demand | Deploy on request |

### Agent Knowledge Source Routing

| Agent Needs To Know... | Query This Source | Tool Name |
|---|---|---|
| Current business state (contacts, deals, tasks) | Supabase PostgreSQL | `query_database` |
| A specific SOP, FAQ, or policy by name | Cloudflare KV | `get_knowledge` |
| The answer to a natural language question | Cloudflare Vectorize | `search_knowledge` |
| Full content of a large reference document | Cloudflare R2 | `get_document` |
| A client's existing document not yet in KV | Google Drive | `read_drive_document` |

---

## DECISION 6: FRONTEND TECHNOLOGY

### Where to Build UI

| UI Type | Build On | Framework | Deploy Via |
|---|---|---|---|
| Customer-facing portal / dashboard | **Cloudflare Pages** | React + Vite | GitHub Actions → CF Pages |
| Customer-facing forms and intake | **Cloudflare Pages** | React | Same — NEVER Google Forms |
| Marketing / landing page | **Cloudflare Pages** | React or static HTML | Same |
| Internal team dashboard (non-technical staff) | **Google Sheets** (mirror) | N/A — pushed from CF Worker | Sheets API from scheduled Worker |
| Internal team BI visualization | **Google Looker Studio** | N/A — connects to Sheets | Manual setup, auto-refreshes |
| Admin / internal tool (technical staff) | **Cloudflare Pages** | React | GitHub Actions → CF Pages |
| Maintenance / fallback page | **Cloudflare Pages** `_maintenance.html` | Static HTML | Committed to repo |

---

## DECISION 7: COMMUNICATION AND NOTIFICATION ROUTING

### Outbound Comms Routing

| Message Type | Send Via | Trigger | Human Approval? |
|---|---|---|---|
| Transactional (order confirmation, password reset) | SendGrid / Mailgun via CF Worker | Supabase webhook | No — auto-send |
| Relationship (follow-up, check-in, re-engagement) | CF Worker drafts → `notifications` table → human approves → Worker sends | Agent or cron | **Yes — always** |
| Internal team notification | Apps Script or Gmail API via CF Worker | Supabase webhook or cron | No — internal |
| Marketing / bulk outreach | CF Worker drafts → `notifications` table → human reviews batch → Worker sends | Cron (batched) | **Yes — always** |
| System alert (error, threshold breach) | CF Worker → admin email | Worker error handler or cron | No — auto-send |

---

## DECISION 8: DATABASE SCHEMA PATTERNS

### Standard Tables (Every Engagement)

| Table | Purpose | RLS Pattern |
|---|---|---|
| `organizations` | Multi-tenant root | Admin-only access |
| `contacts` | People: customers, leads, vendors, employees | `org_id` isolation |
| `tasks` | Operational tasks (human + agent-generated) | `org_id` isolation |
| `activity_log` | Immutable audit trail | Append-only, `org_id` isolation |
| `agent_runs` | Every AI agent execution logged | `org_id` isolation |
| `notifications` | Outbound comms queue | `org_id` isolation |

### Optional Tables (Per Engagement)

| Table | Deploy When | Purpose |
|---|---|---|
| `deals` / `orders` | Client has a sales pipeline or order flow | Revenue-generating events |
| `accounts` | Client is B2B (sells to companies) | Company-level records |
| `documents` | Client stores or receives files | Metadata for files in R2/Storage |
| `products` / `services` | Client has a catalog | What the client sells |
| `invoices` | Client manages billing | Financial records |
| `appointments` | Client does scheduling | Calendar-integrated bookings |

### RLS: The Non-Negotiable Pattern

```sql
-- Every table gets this before any data is inserted:
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

-- Tenant isolation (most common):
CREATE POLICY "tenant_isolation" ON {table_name}
  FOR ALL USING (org_id = (auth.jwt()->>'org_id')::UUID);

-- User-scoped (for profiles):
CREATE POLICY "user_owns_row" ON profiles
  FOR ALL USING (id = auth.uid());
```

**Verify via SQL, never the UI badge:**
```sql
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind = 'r';
```
Every table must show `rls_enabled = true` AND `policy_count > 0`.

---

## DECISION 9: NAMING CONVENTIONS

Every asset follows a consistent naming pattern. Claude Code uses this table when creating any new resource.

| Asset Type | Pattern | Example |
|---|---|---|
| GitHub repo (engagement) | `oag-{client-slug}` | `oag-gortin-group` |
| GitHub repo (client data export) | `{client-org}/{client-slug}-data` | `gortin-group/gortin-data` |
| Cloudflare Worker (API) | `oag-{client-slug}-api` | `oag-gortin-group-api` |
| Cloudflare Pages (frontend) | `oag-{client-slug}-app` | `oag-gortin-group-app` |
| Supabase project | `oag-{client-slug}` | `oag-gortin-group` |
| D1 database | `oag-{client-slug}-agents` | `oag-gortin-group-agents` |
| R2 bucket (knowledge/docs) | `oag-{client-slug}-docs` | `oag-gortin-group-docs` |
| R2 bucket (client assets) | `oag-{client-slug}-assets` | `oag-gortin-group-assets` |
| KV namespace | `KNOWLEDGE` (binding name) | Bound in `wrangler.toml` |
| Google Drive folder | `OAG \| {Client Full Name} — Internal` | `OAG \| Gortin Group — Internal` |
| Google Sheet (KPI mirror) | `{Client Name} — Operations Mirror` | `Gortin Group — Operations Mirror` |
| Google Service Account | `oag-{client-slug}-worker@{project}.iam.gserviceaccount.com` | — |
| Git branches | `main` (production), `dev` (active), `feature/{name}` | `feature/crm-agent` |

---

## DECISION 10: CODE STANDARDS AND CONVENTIONS

### Language and Framework
- **Language:** TypeScript everywhere (Workers, Pages functions, scripts, Edge Functions)
- **API Framework:** Hono on Cloudflare Workers. Never raw Request/Response handlers.
- **Database Client:** Always `@supabase/supabase-js`. Never raw SQL from Workers — use Supabase REST or RPC.
- **Auth:** Supabase Auth with Google OAuth as primary method. Never roll custom auth.
- **Error handling:** All API routes return structured JSON errors: `{ error: string, code: string }`
- **Logging:** `console.log` in Workers for structured logs. Tag with client slug.

### Git Commit Message Standards
```
feat: add contact creation endpoint
fix: correct RLS policy for multi-tenant isolation
chore: update wrangler.toml with D1 binding
docs: update ENGAGEMENT.md with week 2 status
ai: add Claude summary generation for deal records
refactor: extract Google Sheets client to shared lib
```
Prefix is required on every commit. Use `ai:` for any commit that adds or modifies Claude/agent functionality.

### OIL Gate — Pre-Build Validation

Every feature must pass the OIL gate before code is written. Copy this template into a comment or design doc:

```markdown
## OIL Gate: {Feature Name}

**Interrogate:** What is the actual business problem this solves?
- Problem: ___
- Who is impacted: ___
- Current state: ___
- Target state: ___

**Delete:** What can we eliminate?
- Manual steps removed: ___
- Systems consolidated: ___
- Data duplication eliminated: ___

**Simplify:** What is the simplest version that works?
- MVP definition: ___
- What we're NOT building: ___

**Automate:** What triggers this, and what does it trigger?
- Trigger: ___
- Output/action: ___
- Downstream: ___
```

If you can't fill out the OIL Gate, the feature isn't ready to build. Go back to the client conversation.

### AI Prompt Standards (OAG System Prompt Template)
```typescript
const OAG_SYSTEM_PROMPT = `
You are an AI assistant embedded in OAG's (Obsidian Axis Group) operational platform.
OAG is a fractional COO firm serving lower middle market companies ($10M–$50M revenue).

Your role: ${role}
Engagement: ${engagementName}
Client context: ${clientContext}

OAG Frameworks:
- OIL Framework: Interrogate → Delete → Simplify → Automate
- DefaultFail Protocol: Assume failure first, build for resilience
- First 100 Days: LAND → DIAGNOSE → EXECUTE → PROVE & INSTITUTIONALIZE

Output format: ${outputFormat}
Tone: Direct, data-driven, executive-appropriate. No filler. No fluff.
`.trim();
```

### AI Model Tiering Pattern (for system prompts)
```
Tier 1 (Haiku): Classification, routing, simple extraction, short descriptions
Tier 2 (Sonnet): CRM summaries, task generation, OIL scoring, email drafts, deal analysis
Tier 3 (Opus): Exit scorecard reasoning, strategy memos, complex architecture decisions
Batch: Nightly scoring runs, bulk contact enrichment, report generation
Caching: System prompts for repeated calls cached to reduce cost by ~80%
Streaming: All user-facing interactions stream responses
```

---

## QUICK REFERENCE: DECISION SUMMARY

| Decision | Default Answer |
|---|---|
| Where to store business data? | Supabase PostgreSQL |
| Where to store agent knowledge? | CF KV (text) + R2 (binary) + Vectorize (embeddings) |
| Where to store files? | Supabase Storage (user files) or R2 (public/knowledge) |
| Which AI model? | Sonnet 4.6 (always start here) |
| Where to run API logic? | Cloudflare Workers (Hono) |
| Where to build UI? | Cloudflare Pages (React) |
| Where to mirror data for the client team? | Google Sheets (pushed from CF Worker) |
| How to send email? | CF Worker → SendGrid/Mailgun (transactional) or CF Worker → notifications table → human approval (relationship) |
| When to upgrade Supabase? | Before any real user touches the system |
| When to upgrade CF? | Before any agent runs in production |

---

*Document maintained by OAG — Obsidian Axis Group. Version 1.0. Consult the Capability Reference to know what's available. Consult the Architecture Laws to know the rules. This document tells you which tool to pick.*
