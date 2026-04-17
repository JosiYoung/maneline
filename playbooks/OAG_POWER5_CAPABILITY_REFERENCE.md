# OAG POWER 5 STACK — CAPABILITY REFERENCE
### Obsidian Axis Group | What Each Platform Can Do
**Version:** 2.0 | **Maintainer:** Cedric (Managing Partner, OAG)

---

> **PURPOSE OF THIS DOCUMENT**
> This is the **capability inventory** for the five platforms OAG builds on. Claude Code reads this document to understand the full surface area of what is available — free tiers, paid tiers, features, limits, and CLI commands.
>
> **This document does NOT cover:**
> - Engagement process or setup sequences → See `CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md`
> - Architecture laws, data flow rules, or redundancy model → See `OAG_ARCHITECTURE_LAWS.md`
> - Which capability to use for which decision → See `OAG_DECISION_LAWS.md`
> - Client-facing pre-flight checklist → See `CLIENT-PRE-FLIGHT-CHECKLIST.md`
> - Full engagement build guide → See `OAG_CLIENT_ENGAGEMENT_MASTER.md`
>
> **How to use this file:** Read it to know what tools are in the toolbox. Consult the Architecture Laws to know the rules. Consult the Decision Laws to know which tool to pick.

---

## SECTION 0: WHY THE POWER 5

OAG runs on what we call the **Power 5 Stack**: GitHub + Supabase + Cloudflare + Claude/Anthropic + Google Native.

The design principle is first principles applied to software infrastructure:

> **"What is the physics of the problem? Build from that, not from convention."**

The physics of a fractional COO practice:
- We need **data persistence** → Supabase (Postgres is the source of truth)
- We need **serverless compute + customer-facing UIs** → Cloudflare (Workers + Pages)
- We need **version control and CI/CD** → GitHub (every line of code lives here first)
- We need **AI reasoning and generation** → Claude API (the cognitive layer)
- We need **a client-team mirror and comms relay** → Google Native (where clients already live)

Total cost for a full engagement environment at free tier: **$0/month**. Upgrading a single production engagement to paid tiers across all five platforms: **~$50–100/month**.

---

## SECTION 1: PLATFORM CAPABILITY DEEP DIVES

---

### 1.1 GITHUB — VERSION CONTROL + CI/CD

**One-line role:** Every artifact we build lives in GitHub first. Code, config, migrations, CI/CD pipelines, and the nightly data export destination.

#### Free Tier (GitHub Free — Personal)
| Feature | Free Limit |
|---|---|
| Public repositories | Unlimited |
| Private repositories | Unlimited |
| Collaborators (private repos) | Unlimited |
| GitHub Actions minutes (public repos) | Unlimited |
| GitHub Actions minutes (private repos) | 2,000 min/month |
| GitHub Packages storage | 500 MB |
| GitHub Pages | Yes (public repos) |
| Codespaces | Limited free hours |
| GitHub Copilot | Free tier — 2,000 completions/month, 50 premium requests/month |
| Issues, Projects, Milestones | Unlimited |
| Branch protection rules | Basic |

#### GitHub Free Org (Teams)
| Feature | Limit |
|---|---|
| Actions minutes | 2,000/month across org |
| Storage | 500 MB |
| Copilot for org members | Requires separate Copilot Business ($19/user/mo) |

#### Paid Tiers
| Plan | Cost | Key Upgrade |
|---|---|---|
| GitHub Pro (individual) | $4/month | 3,000 Actions min, 2 GB storage, advanced insights |
| GitHub Team (org) | $4/user/month | 3,000 Actions min, code owners, draft PRs, required reviews |
| GitHub Enterprise | $21/user/month | SAML SSO, audit log API, 50,000 Actions min, GHES option |
| Copilot Free | $0 | 2,000 completions, 50 chat msgs/month |
| Copilot Pro | $10/month | Unlimited completions, 300 premium requests, agent mode |
| Copilot Pro+ | $39/month | 1,500 premium requests, all models including Claude Opus 4.6 and o3 |
| Copilot Business | $19/user/month | Org management, policy controls |
| Copilot Enterprise | $39/user/month | Full codebase indexing, custom models (requires GitHub Enterprise) |

#### Full Capability Surface
- **GitHub Actions** — Automated CI/CD workflows. Triggered on push, PR, schedule, or webhook. YAML-based workflow definitions. Can deploy to Cloudflare Workers/Pages, run tests, generate docs, notify external services.
- **GitHub Pages** — Static site hosting directly from a repo. Supports custom domains and HTTPS.
- **GitHub Packages** — Private npm, Docker, Maven, NuGet registries hosted inside GitHub.
- **GitHub Codespaces** — Full VS Code environment in the browser. Spin up a cloud dev environment from any repo. Free tier: ~60 hours/month on the smallest machine.
- **GitHub Copilot (2026)** — Multi-model AI assistant (GPT, Claude, Gemini). Inline completions, chat, agent mode (autonomous multi-file editing), issue-to-PR coding agent, code review agent, CLI assistant, and MCP support.
- **GitHub Projects** — Kanban boards, roadmaps, and table views linked directly to issues and PRs. Full project management layer inside GitHub.
- **GitHub Discussions** — Community forum built into any repo. Good for client-facing knowledge bases.
- **GitHub Security** — Dependabot (automated dependency updates), secret scanning, code scanning (SAST), Copilot Autofix for vulnerability patches.
- **GitHub Models** — Experiment with frontier AI models (Claude, GPT, Gemini, Llama) directly in a GitHub-hosted playground.
- **GitHub Spark** (Pro+ / Enterprise) — Natural language app builder. Describe → generate → deploy.
- **GitHub Mobile** — Full GitHub access on iOS/Android.
- **GitHub CLI (`gh`)** — Command-line interface for all GitHub operations. Critical for Claude Code workflows.
- **Webhooks & GitHub Apps** — Event-driven integrations. GitHub can trigger Cloudflare Workers, Supabase functions, external notifications on any repo event.

---

### 1.2 SUPABASE — DATABASE + AUTH + REALTIME

**One-line role:** Persistent data storage (PostgreSQL), authentication, row-level security, real-time subscriptions, file storage, and edge functions.

#### Free Tier (Supabase Free)
| Feature | Free Limit |
|---|---|
| Active projects | 2 |
| PostgreSQL database storage | 500 MB |
| File storage | 1 GB |
| Max file size | 50 MB |
| Monthly active users (auth) | 50,000 |
| Edge Functions invocations | 500,000/month |
| Realtime concurrent connections | 200 |
| API requests | Unlimited |
| Outbound bandwidth | 5 GB/month |
| Database backups | 7-day snapshots |
| Inactivity pause | After 7 days of no activity |
| Shared compute | Shared CPU / 500 MB RAM |

> **CRITICAL:** Free projects pause after 7 days of inactivity. For any engagement in active use, either keep it active with a scheduled ping or upgrade to Pro.

#### Paid Tiers
| Plan | Cost | Key Upgrades |
|---|---|---|
| Pro | $25/month/project | 8 GB DB, 100 GB storage, 100K MAUs, no pausing, daily backups, email support. Includes $10 compute credit. Spend cap available. |
| Team | $599/month | SSO, SOC 2 Type II, audit logs, 14-day backups, org-level billing |
| Enterprise | Custom | HIPAA, dedicated infra, BYO cloud, SLAs, 24/7 support |

#### Full Capability Surface
- **PostgreSQL Database** — Full-featured relational database. SQL, indexes, triggers, stored procedures, views, functions. pgvector extension for AI/vector similarity search.
- **Supabase Auth** — Email/password, magic links, OAuth (Google, GitHub, Apple, etc.), Phone/SMS, SAML/SSO. Session management, MFA, JWT tokens. RLS enforces data access at the DB level.
- **Row-Level Security (RLS)** — SQL policies that restrict data access per user/role. This is how we build multi-tenant systems on a single database.
- **Auto-generated REST API** — PostgREST auto-generates a REST API from your DB schema. Create a table → get a REST endpoint instantly.
- **Auto-generated GraphQL API** — pg_graphql extension turns your schema into a fully queryable GraphQL API.
- **Supabase Storage** — S3-compatible object storage with bucket-level access policies. CDN-served public assets and signed private URLs.
- **Edge Functions (Deno)** — TypeScript serverless functions deployed globally. Run custom business logic. Invoked via HTTP or triggered by database events.
- **Realtime** — Subscribe to Postgres changes (INSERT, UPDATE, DELETE) in real time. Three channels: Postgres Changes, Broadcast, Presence.
- **Database Webhooks** — Trigger HTTP requests to any endpoint on database events. Connect Supabase to Cloudflare Workers, external services automatically.
- **pg_cron** — Schedule SQL jobs to run on a cron schedule inside the database. Cleanup jobs, report generation, daily rollups, nightly backups.
- **pgvector** — Store and query vector embeddings in Postgres. Semantic search, AI similarity matching, RAG pipelines.
- **Postgres Extensions** — PostGIS (geospatial), uuid-ossp, pg_trgm (fuzzy text search), pg_jsonschema, pg_net (HTTP from SQL), and 50+ more.
- **Supabase CLI** — Local development environment. Run Supabase locally, generate TypeScript types, manage migrations, deploy Edge Functions.
- **Database Migrations** — Versioned SQL migration files. Track and deploy schema changes. Integrates with GitHub Actions.
- **Branching (Pro+)** — Isolated database branches for testing. Like git branches for your database.
- **Read Replicas (Pro+)** — Distribute read traffic globally.
- **Point-in-Time Recovery (Pro+)** — Restore your database to any second within the backup window.
- **Supabase AI / Postgres AI** — Built-in AI assistant in the SQL editor.

---

### 1.3 CLOUDFLARE — EDGE COMPUTE + CDN + STORAGE

**One-line role:** Serverless API hosting, edge functions, customer-facing UI hosting, CDN, DNS, key-value storage, SQL at the edge, object storage, vector search, and global routing.

#### Free Tier (Cloudflare Workers Free)
| Feature | Free Limit |
|---|---|
| Workers requests | 100,000/day |
| Workers CPU time | 10 ms/invocation |
| Workers scripts | Unlimited |
| Worker size | 1 MB (compressed) |
| KV reads | 100,000/day |
| KV writes | 1,000/day |
| KV deletes | 1,000/day |
| KV lists | 1,000/day |
| KV storage | 1 GB |
| D1 (SQLite) rows read | 5 million/day |
| D1 rows written | 100,000/day |
| D1 storage | 5 GB total |
| R2 storage | 10 GB |
| R2 Class A operations (writes) | 1 million/month |
| R2 Class B operations (reads) | 10 million/month |
| R2 egress | Free (no egress fees ever) |
| Cloudflare Pages deployments | Unlimited |
| Pages bandwidth | Unlimited |
| Pages custom domains | Unlimited |
| Durable Objects | Free (SQLite backend only on free tier) |
| Workers AI (inference) | 10,000 neurons/day |
| Vectorize queries | 30M/month |

> **NOTE:** 100,000 Worker requests per day can handle a legitimate production SaaS on the free tier. The primary constraint is the 10ms CPU limit per request.

#### Paid Tier (Workers Paid: $5/month)
| Feature | Paid Limit |
|---|---|
| Worker requests | 10 million included, then $0.30/million |
| CPU time | 30 seconds/invocation (vs 10ms free) |
| KV reads | 10 million/month included |
| KV writes | 1 million/month included |
| D1 rows read | 25 billion/month |
| D1 rows written | 50 million/month |
| Durable Objects | Full access (KV + SQLite backend) |
| Queues | Included |
| Email routing | Included |
| Vectorize queries | 50M/month |

#### Full Capability Surface
- **Cloudflare Workers** — JavaScript/TypeScript serverless functions running in V8 isolates at 300+ edge locations globally. No cold starts. Sub-millisecond response times. Deploy via Wrangler CLI or GitHub Actions.
- **Cloudflare Pages** — Static site and JAMstack hosting with global CDN. Deploy from GitHub automatically. Custom domains, HTTPS, preview URLs per branch. Pages Functions run Workers-style code in the same deployment.
- **Workers KV** — Global key-value store. Eventually consistent. Good for: session storage, feature flags, configuration, caching, SOPs, FAQs, agent knowledge. Values up to 25 MB each.
- **Cloudflare D1** — Serverless SQLite at the edge. Full SQL with read replicas. Each database up to 10 GB. No egress fees. Good for: per-client databases, agent audit logs, lightweight relational data close to the API.
- **Cloudflare R2** — S3-compatible object storage. Zero egress fees. Stores files, backups, media, exports, knowledge base documents. Accessible from Workers or directly via public URL.
- **Durable Objects** — Strongly consistent stateful compute. Maintains in-memory state and a persistent SQLite database. Perfect for: real-time collaboration, WebSocket connections, payment session management.
- **Cloudflare Queues** — Message queue for async job processing. Produce in one Worker, consume in another. Guaranteed delivery, automatic retries, dead-letter queues.
- **Workers AI** — Run AI inference at the edge using Cloudflare's GPU infrastructure. Models: Llama, Mistral, Phi, Whisper (speech-to-text), image classification, text embeddings. Limited on free tier.
- **Cloudflare AI Gateway** — Proxy and observe all AI API calls (to Claude, OpenAI, etc.). Logs requests, caches responses, rate-limits, enforces cost caps.
- **Vectorize** — Vector database at the edge. Store embeddings, run cosine similarity searches. Powers semantic search, RAG, recommendation engines for agent knowledge bases.
- **Hyperdrive** — Connection pooler for external Postgres databases. Supabase + Hyperdrive = fast Postgres access from Workers without connection exhaustion.
- **Email Routing** — Route incoming email to Workers for processing. Forward, filter, or respond to email programmatically. Free.
- **Workers Cron Triggers** — Schedule Workers to run on a cron schedule. Daily reports, data sync, cleanup jobs, health checks, agent scheduled runs.
- **Analytics Engine** — Time-series data store for custom metrics. Write events from Workers, query with SQL.
- **Cloudflare Tunnel** — Expose local development servers to the internet securely.
- **Zero Trust / Access** — Identity-aware proxy for internal tools. Protect any Worker or Page behind SSO (Google, GitHub, Okta). Free for up to 50 users.
- **Wrangler CLI** — Official local development tool. `wrangler dev` runs locally. `wrangler deploy` pushes to production.
- **Hono Framework** — Lightweight web framework for Workers. Express-like routing, middleware, TypeScript-first. OAG's preferred framework for building API Workers.

---

### 1.4 CLAUDE / ANTHROPIC — AI REASONING + AGENTS

**One-line role:** AI reasoning, content generation, data summarization, task extraction, decision support, code generation, and autonomous agent orchestration.

#### API Pricing (Billed Per Token)
| Model | Input (per 1M tokens) | Output (per 1M tokens) | Use Case |
|---|---|---|---|
| Claude Haiku 4.5 | $0.80 | $4.00 | Fastest, cheapest. Classification, short summaries, routing. |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Best balance. Default for most tasks. |
| Claude Opus 4.6 | $15.00 | $75.00 | Deepest reasoning. Complex analysis, strategy, architecture. |

> **Cost context:** 1M tokens ≈ 750,000 words. A typical CRM summary call (500 input + 200 output tokens) costs ~$0.0045 using Sonnet. 1,000 such calls/month ≈ $4.50/month.

#### Claude.ai Plans (Chat Interface)
| Plan | Cost | Key Features |
|---|---|---|
| Free | $0 | Limited messages/month, Claude Sonnet access |
| Pro | $20/month | 5x more usage, Projects, extended thinking, priority access |
| Team | $30/user/month | Shared Projects, higher limits, admin controls |
| Enterprise | Custom | SSO, audit logs, expanded context, custom usage limits |

#### Claude Code (CLI Tool)
- Standalone agentic coding tool run in terminal
- Uses Anthropic API credits directly (not a flat subscription)
- Can read/write files, run bash commands, deploy code, manage git
- OAG's primary build tool for all Power 5 stack work
- Reads context files (like this document) to understand the engagement

#### Full Capability Surface
- **Messages API** — Core inference API. Conversation in, response out. Supports system prompts, multi-turn, images (vision), PDFs, and documents.
- **Extended Thinking** — Step-by-step reasoning before responding. Dramatically better on complex problems. Billed on thinking tokens. Use for: strategy analysis, exit scoring, complex SQL generation.
- **Tool Use (Function Calling)** — Define tools Claude can call. Claude decides when to call them and parses results. Powers: database lookups, Supabase queries, Cloudflare Worker triggers, Google Sheets reads, agent orchestration.
- **Vision / Image Input** — Send images, PDFs, documents. Claude reads and analyzes visual content. Invoice parsing, document extraction, screenshot analysis.
- **Streaming** — Stream response token-by-token. All user-facing AI features should stream.
- **Batch API** — Submit up to 10,000 prompts in a single batch. Processes asynchronously within 24 hours. **50% cheaper than real-time API.** Bulk report generation, nightly analysis, scoring large datasets.
- **Prompt Caching** — Cache parts of the prompt (system prompt, long documents). Cache reads cost ~10% of normal input price. Saves significant cost on repeated system prompts.
- **Claude in Chrome** (Beta) — Browse the web with Claude as a co-pilot. Competitive intelligence, market research, prospect profiling.
- **Claude Code** — Agentic terminal-based coding tool. Reads context files, understands the stack, builds features autonomously.
- **MCP (Model Context Protocol)** — Standard protocol for connecting Claude to external data sources and tools. Claude Code connects to Supabase, Cloudflare, GitHub, Google Drive via MCP servers.
- **Anthropic AI Gateway (via Cloudflare)** — Route Claude API calls through Cloudflare's AI Gateway for logging, caching, rate-limiting.
- **Workspaces & Projects (claude.ai)** — Organize conversations by client or project. Persistent context within a Project.
- **Artifacts** — Claude generates rendered web UIs, React components, and interactive tools directly in chat.
- **Memory** — Claude retains information across conversations.

---

### 1.5 GOOGLE NATIVE — CLIENT TEAM MIRROR + COMMS

**One-line role:** Spreadsheet mirrors for non-technical staff (Sheets), document storage and knowledge base (Drive), email delivery (Gmail), calendar (Calendar), and lightweight internal automation (Apps Script).

> **Important:** Google's role in the stack is defined by the Architecture Laws. See `OAG_ARCHITECTURE_LAWS.md` for data flow rules. This section covers only what Google CAN do — the Laws doc covers what it SHOULD do.

#### Free Tier (Google Personal / Gmail)
| Service | Free Limit |
|---|---|
| Google Drive storage | 15 GB (shared across Drive, Gmail, Photos) |
| Google Sheets | Unlimited sheets, 10M cells per sheet |
| Google Docs | Unlimited docs |
| Google Forms | Unlimited forms, unlimited responses |
| Google Slides | Unlimited |
| Google Calendar | Unlimited |
| Gmail | 15 GB (shared) |
| Apps Script executions | 6 min/run, 90 min/day total |
| Apps Script triggers | 20 triggers/user |
| Apps Script URL Fetch | 20,000 requests/day |
| Apps Script email sends | 100/day (consumer) |
| Google Sheets API (read) | 300 requests/min/project |
| Google Sheets API (write) | 300 requests/min/project |
| Google Drive API | 12,500 requests/100 seconds |

#### Google Workspace Paid Plans
| Plan | Cost | Key Upgrades |
|---|---|---|
| Business Starter | $7.20/user/mo | 30 GB storage/user, custom domain email, Meet recordings |
| Business Standard | $14.40/user/mo | 2 TB storage, Meet 150 participants, recording to Drive |
| Business Plus | $21.60/user/mo | 5 TB storage, audit logs, eDiscovery |
| Enterprise | Custom | Unlimited storage, advanced security, dedicated support |

**Apps Script upgrades with Workspace:**
- Execution time: 6 min → 30 min per run
- Daily runtime: 90 min → 6 hours
- Email sends: 100/day → 1,500/day
- URL Fetch: 20,000 → 100,000/day

#### Full Capability Surface
- **Google Sheets** — Spreadsheet engine. Formulas, pivot tables, charts, conditional formatting, named ranges. For OAG: used as read-only mirrors of Supabase data for non-technical client staff.
- **Apps Script** — JavaScript-based automation platform. Can: read/write Sheets, send Gmail, create Calendar events, call external APIs (UrlFetchApp), create triggers, build sidebar UIs, interact with Drive.
- **Google Drive** — File storage and sharing. Folder-based organization. Team Drives for multi-user collaboration. Used for: knowledge base documents agents can read, report delivery, client reference files.
- **Google Forms** — Form builder with automatic Sheets integration. Responses flow directly into a spreadsheet. Good for: internal survey data, internal intake (NOT customer-facing forms — those go through Cloudflare).
- **Google Calendar** — Calendar and scheduling. Apps Script can create events, set reminders, check availability.
- **Gmail + Mail Merge** — Comms relay. Apps Script mail merge sends personalized bulk emails from Sheets data. Good for: internal team notifications (NOT customer-facing comms — those go through Cloudflare Workers).
- **Google Looker Studio (free)** — BI and dashboard tool. Connects to Sheets, BigQuery, GA, and 800+ data sources. Drag-and-drop visualization.
- **Google Sites** — Free website builder. Good for: simple internal knowledge bases.
- **Google AppSheet (no-code apps)** — Build mobile and web apps directly from Sheets data. No code required.
- **Connected Sheets (Workspace)** — Connect BigQuery datasets directly to Sheets.
- **Google Meet** — Video conferencing. API allows embedding and recording management.
- **Google Workspace Add-ons** — Build sidebar panels inside Docs, Sheets, Gmail using Apps Script.
- **Google Cloud Run / BigQuery** — For heavy data workloads beyond Sheets. BigQuery: petabyte-scale SQL analytics.
- **Google OAuth 2.0** — Authenticate users with Google accounts. Supabase Auth supports Google OAuth natively.

---

## SECTION 2: QUICK COMMAND REFERENCE

```bash
# ── GITHUB ────────────────────────────────────────────────
gh repo create {repo-name} --private
gh secret set {SECRET_NAME}
gh workflow run deploy.yml
git checkout -b feature/{name}
git push origin feature/{name}

# ── SUPABASE ──────────────────────────────────────────────
supabase init
supabase link --project-ref {ref}
supabase db push                          # Apply migrations
supabase db pull                          # Pull remote schema changes
supabase gen types typescript --project-id {ref} > src/types/supabase.ts
supabase functions deploy {function-name}
supabase status

# ── CLOUDFLARE ────────────────────────────────────────────
wrangler dev                              # Local dev server
wrangler deploy                           # Deploy to production
wrangler secret put {SECRET_NAME}
wrangler kv:namespace create "NAMESPACE_NAME"
wrangler kv:key put --binding=BINDING "key" "value"
wrangler kv:key get --binding=BINDING "key"
wrangler d1 create {db-name}
wrangler d1 execute {db-name} --file=schema.sql
wrangler r2 bucket create {bucket-name}
wrangler r2 object put {bucket}/{key} --file ./path
wrangler tail                             # Live log streaming
wrangler pages project create {project-name}
wrangler pages deploy ./dist --project-name {name}

# ── CLAUDE CODE ───────────────────────────────────────────
claude                                    # Start session
claude --continue                         # Resume last session

# ── GOOGLE (Apps Script CLI — clasp) ─────────────────────
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "{project-name}"
clasp push
clasp deploy
```

---

## SECTION 3: PLAYBOOK INDEX — WHERE TO GO NEXT

This document told you what each platform CAN do. The following documents tell you how to USE them:

| Document | What It Covers |
|---|---|
| `OAG_ARCHITECTURE_LAWS.md` | Data flow rules, architecture hierarchy, triple redundancy model, system resilience, the non-negotiable laws of the stack |
| `OAG_DECISION_LAWS.md` | Which capability to use for which job — model selection, storage routing, compute placement, upgrade triggers |
| `OAG_CLIENT_ENGAGEMENT_MASTER.md` | Full engagement build guide — schema, agents, implementation code, CI/CD, go-live checklist |
| `CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md` | Intelligence → Phase 0 → Coming Soon arc, Leg A–G setup sequence, custody model, verification drills |
| `CLIENT-PRE-FLIGHT-CHECKLIST.md` | Client-facing checklist — what the client needs to do before we start building |

**Read order for a new engagement:**
1. This file (capability reference — know your tools)
2. Architecture Laws (know the rules)
3. Decision Laws (know which tool to reach for)
4. Phase 0 Pre-Flight (execute the setup)
5. Engagement Master (build the product)

---

*Document maintained by OAG. Version 2.0 — refactored from original Power 5 Master to serve as pure capability reference. Process, architecture laws, and decision guidance moved to dedicated documents.*
