# Mane Line — Product Feature Map & Technical Spec
**Client:** Silver Lining Herbs (a.k.a. Silver Lining)
**App name:** Mane Line (Horse OS)
**Document owner:** Cedric / Obsidian Axis Group (OAG)
**Version:** v0.2 — post-2 PM discovery call
**Date:** 16 April 2026
**Status:** Post-call — v0.2 folds in the Silver Lining leadership answers and locks Phase 0 scope. Phase 0 starts tonight in Claude Code (see §9 for copy-paste prompts).

### Change log — v0.1 → v0.2
- **Brand sovereignty:** CONFIRMED standalone. "Silver Lining" branding is stripped from every portal's chrome. The name appears only inside the marketplace (as the supplement brand you're buying) and inside the protocol copy (as authorship). Mane Line is the standalone app brand.
- **Protocol vocabulary:** Replaced with an AI chatbot backed by **Cloudflare Workers AI + Vectorize** (the "Protocol Brain"). One-click purchase of suggested Silver Lining SKUs from inside the chat. **Now P0.**
- **Open third-party marketplace (non-Silver-Lining sellers) + in-app payments between users:** Deferred to **v1.1 / v2**. Not P0.
- **Trainer vetting:** CONFIRMED — trainers must pass a vetting workflow before going live in the app. Now a P0 workflow.
- **Vet-facing surface:** CONFIRMED — records storage, Coggins storage, animal charts. Ships as a lightweight scoped-magic-link "Vet View" in v1 (not a full portal).
- **Shopify:** Silver Lining's product catalog lives in Shopify. Mane Line marketplace pulls inventory via Shopify Storefront API. Code is scaffolded with `SHOPIFY_STOREFRONT_TOKEN` placeholder.
- **HubSpot:** Every signup, order, and trainer application syncs to HubSpot via the HubSpot CRM API. `HUBSPOT_PRIVATE_APP_TOKEN` placeholder.

---

## 0. How to read this document (plain English)

This is the single source of truth for *what we are building* for Silver Lining Herbs and *why we're building it the way we are*. It has five layers, so you can skim the first one in 3 minutes or read all five in 45.

1. **Section 1 — Why (First Principles):** The irreducible problem we're solving and the lean waste we're removing.
2. **Section 2 — Who (The Three Portals):** Who uses what, and how roles are enforced at the database level.
3. **Section 3 — What (Feature Matrix):** Every confirmed feature organized by portal, release (v1 → v2), and priority. Includes the "known unknowns" we'll fill in during the call.
4. **Section 4 — How (Technical Architecture):** The Power 5 stack mapping, data model, security model, and integration map.
5. **Section 5 — What's next (Open Questions + Wireframe):** The exact list of questions for the 2 PM call plus a text-based wireframe of v1 screens.

> **Team-of-two rule (per your preference):** every major decision in this doc has been cross-referenced against a "second opinion" — either the OAG Architecture Laws, the JPS ATS precedent, or Silver Lining's own brand intelligence. Those references are called out inline as `[Cross-ref: …]`.

> **First-principles rule:** every feature in this doc must answer the question: *"Does this reduce one of the seven lean wastes (motion, inventory, overproduction, waiting, defects, over-processing, unused talent) for the horse owner, the trainer, or Silver Lining?"* If it doesn't, it doesn't ship in v1.

---

## 1. WHY — First Principles & Lean Framing

### 1.1 The one-sentence problem
A horse owner and their trainer today duct-tape together a paper feed chart, a Notes-app vet log, texted farrier pictures, a PDF Coggins, a SmartPak subscription, a WhatsApp thread, a Venmo invoice, and a sticky note on the barn fridge. Every one of those is waste. `[Cross-ref: Intelligence.md §7]`

### 1.2 The irreducible jobs
A horse or dog owner's life contains a finite set of recurring questions. Every one of them is a candidate for Mane Line to own:

1. *Is my animal healthy right now?* — observation, baseline, anomaly
2. *What do I give her / do for her today?* — schedule, dosing, feed, turnout
3. *What happened last time?* — history, records
4. *Who do I call / what do I buy if I need help?* — vet, farrier, trainer, product
5. *Can I prove it?* — records export for vet, buyer, insurance, show
6. *Am I getting better at this?* — trends, performance, cost

A trainer's life adds three more:
7. *Am I getting paid for what I'm doing?* — invoicing, expense tracking per horse
8. *Am I proving my value to the owner?* — updates, photos, session logs
9. *Am I running my business profitably?* — P&L per horse, per ranch

Silver Lining Herbs adds two more:
10. *Are we converting users to customers?* — marketplace funnel, SKU-to-protocol attribution
11. *What do our customers actually need?* — aggregate signals to inform product roadmap

**Mane Line v1 ships a single pane of glass that collapses all 11 of those questions, anchored by the animal — not by the task, not by the human.**

### 1.3 The seven-wastes audit (Lean lens, applied now)
Every v1 feature will be challenged on the table below. If a feature is pure waste reduction, it ships. If not, it goes to v1.1+.

| Waste | Today's pain | Mane Line feature that kills it |
|---|---|---|
| **Motion** | Owner walks to barn, reads sticky note, walks back to phone, texts trainer | One-tap "Today" view on the phone at the barn |
| **Inventory** | Unused half-bags of 7 different supplements in a tack trunk | Auto-reorder only when a protocol is active; usage per horse |
| **Overproduction** | Owner keeps 6 months of paper receipts in case the vet asks | Records export to PDF in one tap |
| **Waiting** | Trainer texts owner with an update, owner reads it 4 hours later | Push notification + in-app acknowledgement thread |
| **Defects** | Wrong horse gets wrong dose because barn help can't read handwriting | Structured per-horse dosing card, checklist in-app |
| **Over-processing** | Trainer sends a monthly invoice that was reassembled from memory | White-label invoice auto-assembled from logged sessions and expenses |
| **Unused talent** | Josi Young's 25-year supplement expertise lives in his head | Codified as "Protocols" in-app (Silver Lining's numbered SKU system → in-app playbooks) |

---

## 2. WHO — The Three Portals

Mane Line is a three-portal app. All three portals ship off a single React codebase, a single Supabase database, and a single set of RLS policies. Role determines which screens are visible and which rows are readable. `[Cross-ref: JPS ATS `00026_client_portal.sql` — same pattern: one `user_profiles` table, `role` column, `client_id`/`owner_id` scoping via RLS.]`

### 2.1 Portal map

| Portal | Who uses it | Role value | Primary route prefix | Analogy to JPS ATS |
|---|---|---|---|---|
| **Admin Portal** (internal name; NOT branded "Silver Lining" in any UI chrome) | SLH leadership (Josi, ops, marketing, CS lead) — hidden from all other users | `silver_lining` | `/admin/*` | Leadership view (sees all) |
| **Trainer Portal** | Vetted professional trainers running their business inside Mane Line | `trainer` | `/trainer/*` | Recruiter view (operator) |
| **Owner Portal** | Horse & dog owners (primary end user) | `owner` | `/app/*` | Client portal (end customer) |
| **Vet View** (scoped-share interface, not a full portal in v1) | Vets a horse owner sends records to | `vet` (token-based, no account required v1) | `/vet/:token` | — (new pattern) |

> **Brand sovereignty note (post-call decision):** Every portal's chrome — logo, footer, color system, emails — says **Mane Line**. Not "Mane Line by Silver Lining." Silver Lining appears only as: (a) the brand of supplements for sale inside the marketplace, and (b) the author attribution inside a Protocol card ("Protocol authored by Silver Lining Herbs"). This preserves the option to onboard additional supplement brands in v2 without a rebrand.

> **Design principle:** A user has **one role** but can be granted **access to multiple animals, ranches, or trainer books of business** via a permissions table (see §4.4). This is how we support edge cases like "the owner is also a trainer" or "two ranches share one trainer" without polluting the role model.

### 2.2 The assignment / consent model (the hard part)

Trainers don't just "see all horses." An **owner must explicitly grant a trainer access to a specific horse (or ranch, or whole animal-roster)**. This mirrors how the real-world handshake works: owner hires trainer, trainer boards horse or shows up to ride it, owner authorizes.

```
OWNER  ──invites──▶  TRAINER  ──accepts──▶  HORSE access granted
  (via email / in-app code)                  (scoped to named horses or ranch)
```

Access types (scope):
- `horse` — a single animal
- `ranch` — every horse at a physical location (barn address)
- `owner_all` — every animal the owner currently has + any added in the future (broad, requires an extra confirmation step from the owner)

Access is **revocable at any time** by the owner, with a 30-day read-only grace period so the trainer can export their last invoice / session log before the link is cut. `[Cross-ref: OAG_ARCHITECTURE_LAWS.md Law 7 — security baselines; soft-delete pattern.]`

### 2.3 What each portal sees (the one-minute version)

**Owner Portal (primary end user — most of the userbase)**
- Home = "Today" view for **all their animals**, stacked as cards (horse, horse, dog, dog, etc.)
- Per-animal profile, health log, supplement protocol, vet records, farrier schedule, photo/video timeline
- Trainers assigned to each animal — see their notes, see invoices owed, acknowledge session updates
- Marketplace — shop Silver Lining Herbs, one-tap "add a recommended protocol" when a symptom is logged
- Records export (one tap → PDF of a horse's 12-month record, for vet/show/sale/insurance)
- Billing hub — see every trainer invoice in one place, pay via Stripe

**Trainer Portal (business operator — the "white-label" surface)**
- Home = dashboard across **all the animals and ranches they're assigned to**, filtered by owner
- Per-animal work log — rides, workouts, health sessions, notes, photos, flags to owner
- Invoicing — white-label (their logo, their brand color accents), built on Stripe, auto-assembled from logged sessions + expenses
- Expense tracking per horse — feed, tack, vet visits, board, **one-tap purchase Silver Lining supplements directly from inside the expense form** (marketplace-as-a-feature)
- Owner communications — flag a note to the owner, request an acknowledgement
- Business reports — revenue per horse, per ranch, per month; P&L
- Tax-ready export — annual 1099-friendly report

**Silver Lining Portal (the mothership)**
- Home = aggregate KPIs: WAUs, MAUs, supplement attach rate, protocol conversion, marketplace GMV, trainer retention
- User directory — every owner, every trainer, every horse/dog; search + filter
- Content management — Protocols (the numbered SKU → in-app playbook mapping), Tack Room Talk podcast tie-ins, endorser content, seasonal campaigns
- Marketplace ops — inventory, SKU merchandising, promo codes, subscription management, refunds
- Support inbox — escalated tickets from the in-app help widget
- Audit log — every access grant, every access revoke, every refund, every admin action
- Impersonation (view-only) — an SLH support rep can "view as" an owner or trainer to debug (always logged, never write)

---

## 3. WHAT — Feature Matrix

> **Legend:**
> - **P0** = must-have for v1 launch (no v1 without this)
> - **P1** = ships in v1 if time allows; otherwise v1.1
> - **P2** = v2+ (post-launch)
> - **?** = awaiting confirmation from the 2 PM discovery call

### 3.1 Owner Portal features

| Feature | Priority | Notes / Open Q |
|---|---|---|
| Magic-link signup + horse profile creation | P0 — **shipped** | Already live in `worker.js` |
| "Today" multi-animal dashboard | P0 | Stack of cards, one per animal |
| Per-animal profile (horse + dog cross-species) | P0 | Schema already cross-species-ready; add `species` column to `horses` or rename to `animals` |
| Supplement protocol tracker (daily log, dose confirm) | P0 | Maps to Silver Lining's numbered SKUs |
| Vet records upload + Coggins storage | P0 | R2 for PDFs, signed URLs |
| One-tap records export to PDF | P0 | Big moat — see §1.3 overproduction |
| Ride / workout log (manual entry) | P1 | GPS ingestion in v2 |
| Farrier schedule + reminder | P1 | ? — confirm farrier is in scope for v1 |
| Marketplace (browse + buy Silver Lining Herbs) | P0 | Stripe-integrated, co-branded |
| Stripe payments for trainer invoices | P0 | Owner pays trainers inside the app |
| Trainer access management (grant / revoke) | P0 | Core to the consent model |
| Acknowledge trainer update / note | P0 | Two-way comms loop |
| Push notifications (session logged, supplement reminder, invoice) | P1 | Web push in v1, native push when mobile ships |
| Photo/video timeline per animal | P1 | R2 storage |
| Dog profile parity with horse | P1 | Stretch for v1 |
| Cross-species sharing (show same UI for horse, dog, goat, etc.) | P2 | Data model ready day-one per Intelligence.md §9 #10 |
| Share 30-day summary with vet (email link) | P1 | Viral loop — vets become distribution |
| **"Protocol Brain" AI chatbot** (Cloudflare Workers AI + Vectorize) | **P0** | Post-call confirmed. Owner chats with it in plain English ("my mare is off today, she isn't eating"), bot retrieves matching protocols via Vectorize, suggests Silver Lining SKUs with a **one-click purchase** button inside the chat. See §4.7 for architecture. |
| Symptom logger → protocol recommendation | P1 | Subsumed into Protocol Brain chatbot above |
| Share 12-month record with vet (scoped magic link, read-only) | **P0** | Post-call confirmed. Owner generates a link, vet clicks it, sees Coggins + vaccine + chart — no account required. |
| USEF / show-compliance export | P2 | Validate demand in user research |

### 3.2 Trainer Portal features

| Feature | Priority | Notes / Open Q |
|---|---|---|
| **Trainer vetting workflow** (application → admin review → approve/reject → live) | **P0** | Post-call confirmed. Trainer applies with cert/references/insurance. Admin reviews in `/admin/trainers/pending`. Until approved, trainer sees a "pending review" state and cannot accept owner invites. |
| Trainer signup + KYC verification | P0 | Stripe Connect requires identity verification (separate from the Mane Line vetting above) |
| Trainer profile (logo, brand color, bio, certifications) | P0 | White-label foundation |
| Accept / decline owner invite | P0 | Core to consent model |
| Dashboard across all assigned animals | P0 | Filter by owner / ranch |
| Session logger (ride, workout, bodywork, health session) | P0 | Structured + freeform |
| White-label invoice builder | P0 | Auto-assembled from session log + expenses; trainer's logo; trainer's Stripe account payout |
| Expense tracker per horse | P0 | Category tags: feed, board, farrier, vet, tack, supplement |
| **In-expense-form supplement purchase (Silver Lining SKUs)** | P0 | Explicit ask — marketplace-inside-expenses for one-tap restock |
| Flag note to owner (requires acknowledgement) | P0 | Two-way comms loop |
| Photo/video upload tied to session | P0 | R2 storage |
| Owner-facing weekly summary (auto-generated) | P1 | Modeled after JPS ATS Team Collab weekly snapshot |
| Business P&L by horse, ranch, month | P1 | Aggregation view |
| Ranch management (group horses by physical location) | P1 | Needed if trainer runs multiple ranches |
| Assistant trainer sub-roles (limited-scope access) | P2 | Post-launch |
| Tax-ready annual export (1099-friendly) | P1 | End-of-year feature |
| Schedule / calendar of daily activities | P1 | Integrates with Google Calendar? Needs decision |
| Recurring invoice / monthly board billing | P1 | Common trainer pain |
| Waiver / liability e-sign per client | P2 | Legal surface — validate with counsel |

### 3.3 Silver Lining Portal features

| Feature | Priority | Notes / Open Q |
|---|---|---|
| KPI dashboard (WAU, MAU, GMV, attach rate) | P0 | Sonnet-generated weekly exec summary |
| **Trainer vetting queue** (review, approve, reject, revoke) | **P0** | Queue view with cert docs, references, insurance. Admin clicks approve → trainer goes live. |
| User directory (owners, trainers, animals) | P0 | Search + filter, RLS bypass via service-role calls only from within the Worker |
| **Shopify inventory sync** (Silver Lining catalog → Mane Line marketplace) | **P0** | Storefront API pull on Worker cron, nightly + on-demand. See §4.7 for architecture. |
| Marketplace ops (inventory, SKUs, promos) | P0 | Shopify is the source of truth for product catalog; Supabase caches for performance and adds Mane-Line-only metadata (protocol mapping, featured flag). |
| **HubSpot CRM sync** (signups, orders, trainer applications) | **P0** | Server-side sync. Every `profiles.insert`, `orders.insert`, `trainer_applications.insert` fires a Worker that POSTs to HubSpot. See §4.7. |
| Protocol management (SKU → playbook mapping) | P0 | Core "unused talent" capture (§1.3) |
| Support inbox (escalated tickets) | P0 | In-app help widget → Supabase ticket → Sheets mirror for CS team |
| Content management (blog, podcast tie-ins, endorser content) | P1 | Could defer to a headless CMS |
| Audit log (every admin action, every access grant/revoke) | P0 | Compliance + trust |
| Impersonation / "view as" (read-only) | P1 | Debugging tool, always logged |
| Refund & subscription management | P0 | Stripe dashboard as fallback in v1, native in v1.1 |
| Aggregate anonymous signals → product roadmap feedback | P2 | Ethical aggregation (no individual data leakage) |
| Endorser co-branded onboarding flows (Cervi, Snyder, Baker) | P1 | Zero-CAC launch channel |
| Seasonal campaign push (e.g., "Bug Control Bundle" in May) | P1 | Marketing automation |

### 3.4 Post-call decisions + remaining open questions

**Locked in the 2 PM call (2026-04-16):**
- ✅ Brand sovereignty → standalone Mane Line; strip Silver Lining from UI chrome.
- ✅ Protocol vocabulary → AI chatbot (Cloudflare Workers AI + Vectorize) with one-click SKU purchase from chat.
- ✅ Trainer vetting → required, manual admin review workflow before trainers can go live.
- ✅ Vet-facing record surface → scoped-magic-link "Vet View" (Coggins, vaccine records, animal charts).
- ✅ Silver Lining marketplace → Shopify Storefront API pull; Stripe for checkout.
- ✅ HubSpot → every signup, order, trainer application syncs to HubSpot.
- ⏳ Open third-party marketplace + in-app P2P payments → deferred to **v1.1 / v2**.

**Still open — flag in the next working session:**
- [ ] Subscription / auto-ship for supplements — confirm Shopify Subscription API vs. Stripe Subscriptions; vendor lock implications.
- [ ] Mobile strategy — PWA for v1? Or native wrapper (Capacitor) for v1.1?
- [ ] Offline mode in the Trainer Portal — critical for barn wifi-dead-zones; confirm P0 vs P1.
- [ ] Insurance export format — USEF / Coggins / show requirements vary by state; confirm states of priority.
- [ ] Endorser rollout schedule — Cervi, Snyder, Baker — which protocols each endorses, launch order.
- [ ] Rev-share % with Silver Lining on marketplace sales — confirm platform take-rate for accounting.
- [ ] HubSpot pipeline structure — which deal stages, which custom properties to sync.
- [ ] Shopify store URL + Storefront API token handoff timing (needed before Phase 3).

---

## 4. HOW — Technical Architecture

### 4.1 Stack alignment to OAG Architecture Laws
Every layer below is already locked in by the architecture laws; we're just confirming the mapping for Mane Line specifically. `[Cross-ref: OAG_ARCHITECTURE_LAWS.md §1–§4]`

| Tier | Role | Platform | Status for Mane Line |
|---|---|---|---|
| 1. Customer layer | React UI, three portals, branded | **Cloudflare Pages** (React + Vite + Tailwind) | To build — waitlist worker already live, will evolve |
| 2. Compute layer | API, agents, webhooks, cron | **Cloudflare Workers** (Hono) | `worker.js` already serving waitlist; will split into Hono router |
| 3. Data layer | Source of truth | **Supabase Postgres (RLS on every table)** | Live — `profiles` + `horses` schema ready to extend |
| 4. AI layer | Protocol suggestions, summaries, content gen | **Claude API** (Sonnet default, Haiku classify, Opus reserved) | Not yet wired |
| 5. Code layer | Version control, CI/CD | **GitHub** + **GitHub Actions** → auto-deploy to CF | Pattern proven in JPS ATS; replicate |
| 6. Mirror & comms | Internal SLH team sees data, Gmail for comms | **Google Sheets** (mirror) + **Gmail** (relay) | Waitlist Sheets mirror already live |

**Triple redundancy** (Architecture Law 4): Supabase (L0) + Google Sheets mirror (L1) + nightly GitHub JSON/CSV snapshot (L2). Already operational for `profiles` + `horses`. Will extend to every new table as it ships.

### 4.2 Data model — proposed v1 tables
The existing `profiles` and `horses` tables stay. The new tables below are the v1 blueprint. Final migration files go in `supabase/migrations/` following the JPS ATS numbering convention.

```
user_profiles          — auth.users ↔ role (owner | trainer | silver_lining)
                         extends existing profiles
animals                — rename/extend `horses` to support species (horse, dog, future)
ranches                — physical location; multi-horse grouping
trainer_profiles       — trainer-specific fields: logo URL, brand color, Stripe Connect ID,
                         bio, certifications
animal_access_grants   — owner_id × trainer_id × animal_id | ranch_id, scope,
                         granted_at, revoked_at, grace_period_end
sessions               — rides, workouts, bodywork, health sessions (polymorphic,
                         type column); logged by trainer or owner
session_media          — photos/videos linked to sessions (R2 URLs)
protocols              — Silver Lining's numbered SKU system codified as playbooks
animal_protocols       — per-animal active protocol + start/end date
supplement_doses       — daily dose log per animal × protocol
vet_records            — uploaded documents (R2), tagged type (coggins, vaccine, etc.)
farrier_records        — shoeing / trim history
expenses               — trainer-logged or owner-logged expense per animal
invoices               — trainer invoices, Stripe invoice ID, line items (sessions + expenses)
invoice_line_items     — normalized
orders                 — Silver Lining marketplace orders (Stripe charge ID)
order_line_items       — SKUs purchased
subscriptions          — auto-ship (if confirmed in call)
notifications          — queue of push / email / in-app notifications
audit_log              — every admin action, every access grant/revoke
support_tickets        — in-app help → SLH inbox
```

**Design principles (non-negotiable):**
1. Every table has RLS enabled with at least one policy on day one. `[Cross-ref: OAG Law 7]`
2. No row is ever hard-deleted. Use `status = 'archived'` or `revoked_at` timestamp. `[Cross-ref: OAG Law 8]`
3. Every table is mirrored to Sheets (L1) and snapshotted nightly to GitHub (L2). `[Cross-ref: OAG Law 4]`
4. `animals` is species-polymorphic from day one — do not hard-code horse anywhere. `[Cross-ref: Intelligence §9 #10]`

### 4.3 Role & RLS model (the security backbone)

Roles are stored in `user_profiles.role`. Access to individual animals is via `animal_access_grants`. Sample helper functions (mirroring JPS ATS precedent):

```
get_my_role()          returns 'owner' | 'trainer' | 'silver_lining'
am_i_owner_of(animal_id)     returns boolean
do_i_have_access_to(animal_id) returns boolean   -- owners OR granted trainers
is_silver_lining_admin()     returns boolean
```

**RLS policy examples:**
- Owners can `SELECT` / `UPDATE` rows where `owner_id = auth.uid()`.
- Trainers can `SELECT` rows where `do_i_have_access_to(row.animal_id)` is true.
- Silver Lining admins bypass RLS **only via service-role calls from within a Cloudflare Worker endpoint that logs every access to `audit_log`**. Never via direct client-side queries.

### 4.4 Integrations & third parties

| Service | Purpose | Notes |
|---|---|---|
| **Stripe (Payments + Connect)** | Owner-to-trainer invoicing, marketplace checkout, trainer payouts | Stripe Connect Express for trainers. Mane Line holds platform account. `application_fee_amount` carves platform rake. |
| **Shopify Storefront API** | Source of truth for Silver Lining product catalog + inventory (NEW, post-call) | See §4.7.1. Placeholder env: `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`. |
| **HubSpot CRM API** | Sync contacts, orders, trainer applications to Silver Lining's HubSpot (NEW, post-call) | See §4.7.2. Placeholder env: `HUBSPOT_PRIVATE_APP_TOKEN`. |
| **Cloudflare Workers AI** (Llama 3.3 or similar) | Protocol Brain chatbot (NEW, post-call) | See §4.7.3. Uses `env.AI.run()` binding — no external API key needed. |
| **Cloudflare Vectorize** | Protocol embeddings + Tack Room Talk transcripts for RAG retrieval (NEW, post-call — was v1.1) | Promoted to P0 to power the chatbot. |
| **Anthropic Claude API** | Weekly exec summaries, invoice line-item auto-fill, admin analytics narratives | Sonnet default, Haiku for classification, Opus reserved |
| **Cloudflare R2** | Photos, videos, PDFs (Coggins, vet records, invoices, reports) | Signed URLs, no egress fees |
| **Cloudflare KV** | Feature flags, session state, cached Shopify catalog, cached HubSpot mapping | |
| **Google Sheets** | L1 mirror for SLH CS team to see signups, support tickets, KPIs | Per OAG Law 2 |
| **Gmail API** | Comms relay — magic-link emails, trainer-invoice-sent, vet-view-share | Or Resend as an alternative; pick one in Phase 1 |
| **Twilio (optional)** | SMS notifications for urgent flags (colic, emergency) | v1.1 |
| **Sentry** | Error monitoring | Free tier |
| **Plausible or PostHog** | Product analytics | Privacy-first over Google Analytics |

### 4.5 Data flow diagram (text)

```
  OWNER / TRAINER / SLH STAFF
           │
           ▼  HTTPS
  ┌─────────────────────────────┐
  │  Cloudflare Pages (React)    │   ← polished branded UI, three portals
  │  /app/*   /trainer/*  /admin/*│
  └────────────┬────────────────┘
               │ fetch()
               ▼
  ┌─────────────────────────────┐
  │  Cloudflare Workers (Hono)   │   ← API, webhooks, cron, agents
  │  /api/…                      │
  │  /webhooks/stripe            │
  │  /webhooks/supabase          │
  │  /cron/nightly-snapshot      │
  └──┬────────┬────────┬─────────┘
     │        │        │
     ▼        ▼        ▼
  Supabase  Claude   Stripe
  (Postgres (Sonnet /
  + Auth +  Haiku /
  Storage)  Opus)
     │
     │ webhook
     ▼
  Google Sheets (L1 mirror)   Google Drive (agent knowledge: protocols, SOPs)
     │
     │ nightly cron
     ▼
  GitHub private repo (L2 JSON/CSV snapshot — client-owned)
```

### 4.6 Post-call integration architecture detail

#### 4.6.1 Shopify — Silver Lining product catalog source of truth

**Decision:** Shopify (the Silver Lining D2C store) remains the source of truth for SKU data, pricing, inventory, and images. Mane Line's marketplace pulls from Shopify's Storefront API. Mane Line does NOT duplicate catalog management.

**Data flow:**
```
Shopify admin (Silver Lining editors) ──updates SKU──▶ Shopify
                                                         │
                                              Storefront API (read-only)
                                                         │
  Cloudflare Worker /cron/shopify-sync (hourly) ◄────────┘
                  │
                  ▼
  Supabase `products` table (cached: SKU, title, price, image URL, description, inventory_qty, protocol_mapping)
                  │
                  ▼
  KV cache `shopify:catalog:v1` (fast edge reads for the Owner Portal shop)
```

**Checkout flow:**
- Mane Line shop shows products from the cached Supabase table.
- "Buy Now" → create a Stripe Checkout session with the SKU's price.
- On `checkout.session.completed` webhook → write to Supabase `orders` + fire off Shopify "Create Order" mutation to decrement inventory in Shopify.

**Secrets (to be set in Worker via `wrangler secret put`):**
```
SHOPIFY_STORE_DOMAIN       = <placeholder — silverlining.myshopify.com>
SHOPIFY_STOREFRONT_TOKEN   = <placeholder — get from Shopify admin → Apps → Headless>
SHOPIFY_ADMIN_API_TOKEN    = <placeholder — needed ONLY if we write orders back to Shopify; Phase 3 decision>
```

**Placeholder-first rule:** Phase 0 scaffolds the Shopify module with mocked responses. Real tokens drop in during Phase 3.

---

#### 4.6.2 HubSpot — CRM sync for Silver Lining go-to-market

**Decision:** Silver Lining wants every waitlist signup, every order, and every trainer application reflected in HubSpot so their existing sales/marketing ops continue to work.

**Objects synced (v1):**

| Mane Line event | HubSpot object | Trigger |
|---|---|---|
| `profiles.insert` (new owner) | HubSpot Contact (lifecycle: `subscriber`) | Worker on Supabase webhook |
| `trainer_applications.insert` | HubSpot Contact (lifecycle: `opportunity`) + Deal in "Trainer Pipeline" | Worker on Supabase webhook |
| `orders.insert` (marketplace sale) | HubSpot Contact updated (lifecycle: `customer`) + custom event `maneline_order` | Worker on Stripe webhook |
| `profiles.update` (marketing_opt_in toggle) | HubSpot Contact subscription preference update | Worker on Supabase webhook |

**Data flow:**
```
  Supabase webhook / Stripe webhook
             │
             ▼
  Cloudflare Worker /webhooks/hubspot-sync
             │
             ▼ (HubSpot CRM v3 API)
  HubSpot (contact upsert by email, deal create, event track)
             │
             ▼
  Response stored in Supabase `hubspot_sync_log` (audit trail per OAG Law 8)
```

**Secrets:**
```
HUBSPOT_PRIVATE_APP_TOKEN  = <placeholder — HubSpot → Settings → Private Apps → create app with CRM scopes>
HUBSPOT_PORTAL_ID          = <placeholder — Silver Lining's HubSpot Hub ID>
```

**Failure mode:** If HubSpot is unreachable, event is queued to `pending_hubspot_syncs` table and retried by a Worker cron every 15 min. Never drop events silently (OAG Law 5, Principle 2).

---

#### 4.6.3 Protocol Brain chatbot — Cloudflare Workers AI + Vectorize

**Decision:** Replace the rigid "symptom logger → protocol recommender" with a conversational AI chatbot. Model: Cloudflare Workers AI (runs on CF infra — no external API call). Retrieval: Cloudflare Vectorize storing protocol embeddings + Tack Room Talk transcript chunks.

**Architecture:**
```
  Owner opens chat in /app/chat
         │
         │ user types "my mare is off today, not eating, sweating"
         ▼
  Cloudflare Worker /api/chat
         │
         ├── 1. Embed query → @cf/baai/bge-large-en-v1.5
         │
         ├── 2. Vectorize.query(embedding, topK=5)
         │         │
         │         ▼  returns protocol IDs + SKU IDs
         │
         ├── 3. Fetch full protocol text + linked SKU from Supabase
         │
         ├── 4. Build RAG prompt: system + retrieved context + user message
         │
         ├── 5. env.AI.run("@cf/meta/llama-3.3-70b-instruct", { prompt })
         │
         ▼
  Response streamed back to chat UI with:
    - Natural-language answer
    - Inline "Buy #17 Colic Eaz — $34.99 [Add to cart]" buttons (one-click purchase)
    - Escalation banner: "Not sure? Call your vet" (never replaces vet advice)
```

**Guardrails (non-negotiable):**
- Every chat turn logged to `chatbot_runs` table (OAG Law 8).
- Medical-emergency keywords ("colic," "not breathing," "down and can't get up") trigger a red banner BEFORE the AI response renders: "This sounds serious. Call your vet now. Tap to copy vet contact." No AI output can override this rule.
- The AI never prescribes dosage for non-Silver-Lining products. If asked, it redirects to a vet.
- The AI never makes diagnostic claims. Output is always framed as "owners in similar situations have used …" not "your horse has …"
- Rate-limit: 30 messages/user/day on free tier.

**Model config:**
- Embeddings: `@cf/baai/bge-large-en-v1.5` (runs inside Workers AI)
- Chat model: `@cf/meta/llama-3.3-70b-instruct` (or the current flagship open model on CF AI)
- Vectorize index: `maneline-protocols` (dim 1024)
- Fallback: if Workers AI returns 5xx, degrade to a KV-based keyword match + a canned "our chatbot is warming up" message.

**No API key required** — Workers AI is bound via `wrangler.toml`:
```toml
[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE_PROTOCOLS"
index_name = "maneline-protocols"
```

---

### 4.7 Deployment & environments
`[Cross-ref: JPS ATS `CLAUDE.md` deployment model — same pattern]`

- `main` branch → auto-deploy to production via GitHub Actions → `wrangler deploy`
- `staging` branch → auto-deploy to `staging.maneline.co`
- Feature branches → Cloudflare Pages preview URLs
- Every migration reviewed + applied via `supabase db push` from CI, never manually in production

---

## 5. WHAT'S NEXT — Questions for the 2 PM Call + Wireframe

### 5.1 The clarifying-questions dossier (direct, per your preference)

These are grouped by stakeholder. Silver Lining should be able to answer §5.1a; Owners §5.1b; Trainers §5.1c.

#### 5.1a — Questions for Silver Lining Herbs
1. **Brand sovereignty** — Is Mane Line a **product line of Silver Lining** (co-branded, e.g., "Mane Line by Silver Lining"), a **spin-off** (separate LLC), or a **standalone app** that Silver Lining licenses? This changes how marketing, DNS, and billing are structured.
2. **Brand guide** — Official hex palette, typography, logo lockups. The Intelligence doc has a MED-confidence inferred palette (navy + gold + sage); we need the source of truth.
3. **Protocols vocabulary** — The Intelligence doc proposes that Silver Lining's numbered SKUs become in-app "Protocols" (e.g., "#17 Colic Eaz → Protocol 17: Colic Recovery"). Confirm SLH is comfortable with that framing and licensing terms internally.
4. **Marketplace commercials** — What's the rev-share model on supplements sold inside Mane Line? Is it 1:1 with the D2C site (same price) or is there a Mane Line-only SKU pricing tier?
5. **Subscription model** — Do we ship auto-ship (monthly recurring supplements) in v1 or v1.1?
6. **Trainer vetting** — Does any trainer get to set up shop, or is there an approval / "Silver Lining Certified" badge?
7. **Endorser distribution** — Are Cervi, Snyder, Baker contracted to co-brand onboarding flows? If yes, what's the rollout schedule and which protocols do they each "own"?
8. **Vet channel** — Is a vet-facing surface (even just an email export) in scope for v1?
9. **Dog parity** — When do dog owners onboard? At v1 launch alongside horses, or as a v1.1 toggle?
10. **Human SKU line** — Mane Line marketplace or reserved for silverliningherbs.com only?
11. **Privacy stance** — Any aggregation we do for product-roadmap signals — is SLH comfortable with the ethical framing (anonymous, opt-in)?

#### 5.1b — Questions for Owners (end users)
1. What's the first thing you check when you walk into the barn in the morning?
2. Show me how you currently log a ride / a feed / a vet visit. What's the medium (paper, Notes, text)?
3. How many horses / dogs / animals are you responsible for? Yours? Boarded? Your kids'?
4. Do you work with a trainer? How do you pay them today? How does payment go wrong today?
5. Have you ever needed to pull a Coggins or vet record fast (show, sale, insurance)? What was that like?
6. How do you currently order supplements? Any auto-ship somewhere?
7. How often do you share an update with your vet between visits? What friction stops you?
8. Would you pay a monthly subscription for Mane Line? What price makes it a no-brainer vs. "I'll think about it"?
9. Do you want your data private by default, shared with your trainer by default, or ask-every-time?
10. What feature, if Mane Line did it perfectly, would make you switch from what you use today on day one?

#### 5.1c — Questions for Trainers (business operators)
1. How many horses are in your program today? Across how many ranches / barns?
2. How do you invoice owners today? What % are paid on time? What's your avg days-to-collect?
3. What expense categories matter most to you per horse? (feed, board, vet, farrier, supplement, tack, travel, show fees)
4. Do you currently resell Silver Lining to owners, or do owners buy direct?
5. How do you communicate session updates to owners today? How often do owners actually read them?
6. What tax / accounting software do you use? (QuickBooks Self-Employed? Paper shoebox?)
7. Do you have assistant trainers / working students who need partial access?
8. What's the single biggest admin headache in your week? (If you could delete one hour of your week, what hour is it?)
9. Would you pay a platform fee, a per-invoice fee, or a flat monthly SaaS fee? What price feels fair?
10. Do you need the invoice to be white-label (your logo, your brand) or is "powered by Mane Line" fine?

### 5.2 v1 wireframe — text-based information architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ OWNER PORTAL    (/app)                                            │
│                                                                   │
│   /app                 "Today" — cards per animal, big tap areas  │
│   /app/animals         Grid of animals                            │
│   /app/animals/:id     One animal — tabs:                         │
│                          · Overview (health snapshot)             │
│                          · Protocols (current + past)             │
│                          · Sessions (rides/workouts/bodywork)     │
│                          · Records (vet, farrier, coggins)        │
│                          · Trainers (who has access + history)    │
│                          · Photos/Videos                          │
│                          · Export PDF                             │
│   /app/trainers        Trainer access management                  │
│   /app/shop            Marketplace (Silver Lining SKUs)           │
│   /app/orders          Order history + subscriptions              │
│   /app/invoices        Trainer invoices owed + paid               │
│   /app/settings        Profile, notifications, billing            │
│   /app/help            In-app support                             │
├───────────────────────────────────────────────────────────────────┤
│ TRAINER PORTAL    (/trainer)                                      │
│                                                                   │
│   /trainer             Dashboard — all animals across all owners  │
│   /trainer/animals     Grid by ranch / owner filter               │
│   /trainer/animals/:id Per-animal tabs:                           │
│                          · Session log + new session              │
│                          · Expenses + new expense (incl. buy SLH) │
│                          · Flag note to owner                     │
│                          · Photos/videos upload                   │
│                          · History                                │
│   /trainer/ranches     Ranch management (v1.1 if multi-ranch)     │
│   /trainer/invoices    Invoice builder + sent + paid              │
│   /trainer/expenses    All expenses across all animals            │
│   /trainer/reports     P&L by horse / ranch / month               │
│   /trainer/shop        Marketplace (for personal stock)           │
│   /trainer/settings    Profile (logo, brand color, Stripe Connect)│
│   /trainer/tax-export  Year-end annual report (P1)                │
├───────────────────────────────────────────────────────────────────┤
│ SILVER LINING PORTAL    (/admin)                                  │
│                                                                   │
│   /admin               KPI dashboard (WAU, GMV, attach rate)      │
│   /admin/users         Users (owners + trainers), search/filter   │
│   /admin/animals       All animals                                │
│   /admin/protocols     Protocol catalog (# → playbook mapping)    │
│   /admin/marketplace   SKUs, inventory, promos                    │
│   /admin/orders        Every marketplace order                    │
│   /admin/support       Support inbox (escalated tickets)          │
│   /admin/audit         Audit log (every grant/revoke/refund)      │
│   /admin/content       Blog / podcast tie-ins / endorser content  │
│   /admin/settings      Feature flags, branding, integrations      │
└───────────────────────────────────────────────────────────────────┘
```

### 5.3 The v1 "only-three-screens" stress test
If Mane Line could only ship three screens, the Intelligence doc argues those should answer *"Is my animal OK today?"* `[Cross-ref: Intelligence §9 #2]`. The three-screen v1 is:

1. **`/app`** — "Today" (health snapshot + today's protocol doses + today's sessions).
2. **`/app/animals/:id/export`** — One-tap PDF of the last 12 months (the moat).
3. **`/app/shop`** — Marketplace so a symptom-logged-in-app can convert to an SKU in one tap.

Everything else is v1.1. That is the lean-first-principles shortest path to shipping.

---

## 6. Delivery plan — P0 phased (post-call)

> **Terminology note:** "Pre-flight" (waitlist + triple redundancy) is already complete. Tonight's work is **Phase 0 — Foundation**. The plan below is the full P0 build path. Phases 1–5 are what the new feature map requires. Phases 6–7 are launch.

| Phase | When | Deliverable | Gate to next phase |
|---|---|---|---|
| **Pre-flight** | ✅ Done | Waitlist worker + Supabase + Sheets mirror + nightly GitHub backup | CLIENT-ENGAGEMENT-SETUP-GUIDE.md §7 all green |
| **Phase 0 — Foundation** | **Tonight → tomorrow (2026-04-16 → 2026-04-17)** | Core data model, role-based auth, RLS policies, React+Vite+Tailwind+React Router scaffold, four portal shells (`/app`, `/trainer`, `/admin`, `/vet/:token`) | RLS verification drill passes; each role can log in and land on the right empty portal |
| **Phase 1 — Owner Portal core** | Week of 2026-04-20 | "Today" view, animal CRUD, records upload to R2, records export to PDF, trainer access management (grant/revoke) | Owner can sign up, add a horse, upload a Coggins, export a 12-month PDF, invite a trainer |
| **Phase 2 — Trainer Portal core + vetting** | Week of 2026-04-27 | Trainer application flow, admin approval queue, session log, expense tracker, white-label invoice builder (Stripe Connect) | A vetted trainer sends a real invoice paid by a real owner via Stripe |
| **Phase 3 — Marketplace (Shopify) + Stripe Checkout** | Week of 2026-05-04 | Shopify catalog sync (hourly cron), owner-facing shop page, Stripe Checkout, in-expense trainer purchase shortcut | Owner buys a SKU; Shopify inventory decrements; order appears in HubSpot |
| **Phase 4 — Protocol Brain chatbot** | Week of 2026-05-11 | Vectorize index seeded with protocols, Workers AI chat endpoint, in-chat one-click purchase, medical-emergency guardrails | Chatbot handles 50 test conversations; guardrails pass red-team review |
| **Phase 5 — Admin Portal + Vet View + HubSpot sync** | Week of 2026-05-18 | KPI dashboard, user directory, trainer vetting queue, Vet View scoped-magic-link, HubSpot contact/order/application sync | SLH ops lead runs the full admin drill unassisted; a vet receives and opens a scoped link |
| **Phase 6 — Closed beta** | Weeks of 2026-05-25 and 2026-06-01 | 5 trainers + 20 owners (from Silver Lining's existing list) | NPS > 40, zero P0 bugs, 1 full invoice lifecycle completed |
| **Phase 7 — Public launch** | Week of 2026-06-08 | Endorser-driven launch (Cervi / Snyder / Baker co-branded onboarding flows) | Live |

### 6.1 Phase 0 — what "done" looks like (tonight's scope, precisely)

By end of Phase 0 you should be able to:
1. Open `https://staging.maneline.co` and see a branded login page (no "Silver Lining" in the chrome).
2. Sign up with magic link; the signup form now has a role picker (Owner / Trainer / "I'm with Silver Lining") that writes to `user_profiles.role`.
3. An Owner lands on `/app` (empty "Today" placeholder). A Trainer lands on `/trainer/pending-review` (empty). A Silver Lining admin lands on `/admin` (empty dashboard). Each portal can SELECT nothing from tables it shouldn't see (RLS verified).
4. `wrangler deploy` succeeds with all three new integration bindings declared (Workers AI, Vectorize, Shopify/HubSpot secrets as placeholders).
5. `supabase migration list` shows the new migration files applied.
6. Triple redundancy still works for the new tables — signup flows to Sheets L1 and nightly backup will capture the new tables in L2.

**If any one of those six is red, Phase 1 doesn't start.** Lean discipline.

#### Deferred verifications (must clear before Phase 1)

| # | Item | Why deferred | Unblocker | Verify step |
|---|---|---|---|---|
| D-1 | **Prompt 9.4 — three-path signup verify** | Supabase default SMTP throttles; need custom SMTP for reliable magic-link delivery across three test identities | Custom SMTP provisioning (in progress 2026-04-16) | Run the bash block under Prompt 9.4 for all three roles; confirm `user_profiles.role` matches in the DB for each |

**Rule:** Phase 1 does not start until the Deferred Verifications table is empty. Add rows here for anything else we skip tonight so the Phase-0 → Phase-1 gate stays honest.

---

## 7. What I need from you (Cedric) after the 2 PM call

In priority order:

1. **Confirmed feature list** from Silver Lining, Owners, and Trainers — drop into §3.4.
2. **Brand guide** (hex, typography, logos) — drop into `/client-context/brand-guide/`.
3. **Commercial terms** — marketplace rev-share %, trainer platform fee model.
4. **Endorser scope + rollout schedule** — who launches first, what do they own.
5. **v1 scope lock** — which P1s get promoted to P0, which P0s get deferred. No scope creep after this.
6. **Names** — is "Mane Line" final? Any alternative brandings in play?

Once I have those six, Phase 2 (core data model) starts the next morning.

---

## 8. Glossary (plain English)

- **Portal** — a role-specific web app; same codebase, different screens depending on who you are.
- **RLS (Row-Level Security)** — a Postgres feature that enforces "user A only sees user A's rows" at the database, not the app. Even a buggy frontend cannot leak data across users.
- **Protocol** — Silver Lining's numbered single-SKU system reframed as an in-app playbook (e.g., "Protocol 17: Colic Recovery").
- **Stripe Connect** — Stripe's product for platforms that pay out to third parties (trainers). Mane Line is the platform; trainers are the connected accounts.
- **Triple redundancy** — Mane Line data lives in three client-owned places (Supabase, Google Sheets, GitHub) so no vendor can lock out the customer.
- **White-label** — trainer's invoice shows *their* logo and brand, not Mane Line's. Mane Line is the rails.
- **Consent model** — owners explicitly grant trainers access to named animals; nothing auto-shares.
- **v1 / v1.1 / v2** — release trains. v1 = launch. v1.1 = 30–60 days post-launch. v2 = 6 months out.

---

## 9. Phase 0 Claude Code prompts — copy / paste tonight

> **How to use this section (plain English, per your preference):**
>
> 1. Open a terminal in `C:\Users\cedri\OneDrive\Desktop\Maneline.co`.
> 2. Launch Claude Code: `claude` (if not installed, run `npm install -g @anthropic-ai/claude-code` first).
> 3. Run the prompts in order. Each one is a discrete work unit. Wait for one to finish (Claude Code will show file diffs and ask you to confirm) before pasting the next.
> 4. After each prompt, run the **verify** block in bash. If it fails, paste the failure output into Claude Code and ask it to fix — don't move forward.
> 5. These prompts reference the OAG Architecture Laws in `playbooks/`. Claude Code will read them automatically because you're running in this repo.
>
> **Team-of-two note:** Every prompt below tells Claude Code to consult the OAG Architecture Laws + the Intelligence doc + this feature map before writing code. That's the cross-reference safeguard.

---

### Prompt 9.1 — Orient Claude Code to this repo

Paste this first to prime the session:

```
You are helping me build Mane Line — the Horse OS app for Silver Lining Herbs. Before you write anything, read these files in order and tell me back in 5 bullets what you understand:

1. MANELINE-PRODUCT-FEATURE-MAP.md (THIS repo root — the full product spec, especially §3, §4, and §6.1)
2. playbooks/OAG_ARCHITECTURE_LAWS.md (non-negotiable rules)
3. playbooks/OAG_DECISION_LAWS.md (which tool for which job)
4. client-context/CLIENT-ENGAGEMENT-SETUP-GUIDE.md (triple-redundancy model)
5. README.md (what's already live)
6. worker.js (the current single-file waitlist worker)
7. supabase-schema.sql (the existing profiles + horses tables)

After reading, summarize:
- What's already shipped (pre-flight state)
- What Phase 0 is supposed to deliver tonight (§6.1 of the feature map)
- Any contradictions or gaps you see between the feature map and the existing code

Do NOT write any code yet. Wait for my next prompt.
```

**Verify:** Claude Code should respond with a concise summary. If it misses the triple-redundancy model or the brand-sovereignty rule, say "re-read §4 and §6 of the feature map" before continuing.

---

### Prompt 9.2 — Migration: extend the data model to multi-role + animals

```
Create a new Supabase migration file at supabase/migrations/00002_phase0_multirole_foundation.sql that does the following. Follow OAG_ARCHITECTURE_LAWS §7 (RLS on every table, no hard deletes, soft-archive pattern). Keep the existing profiles + horses tables — do NOT drop them.

1. Create `user_profiles` table:
   - id uuid PK default gen_random_uuid()
   - user_id uuid NOT NULL UNIQUE references auth.users(id) on delete cascade
   - role text NOT NULL CHECK (role in ('owner','trainer','silver_lining'))
   - display_name text NOT NULL
   - email text NOT NULL
   - status text NOT NULL default 'active' CHECK (status in ('active','pending_review','suspended','archived'))
   - created_at, updated_at timestamptz default now()
   - indexes on user_id, role, status

2. Rename `horses` to `animals` via a new table that mirrors columns, with:
   - species text NOT NULL default 'horse' CHECK (species in ('horse','dog'))
   - keep all existing horse columns
   - backfill existing horses into animals with species='horse'
   - do NOT drop `horses` yet (leave it for rollback safety, add a comment: "-- deprecated, will be dropped in Phase 1 after verification")

3. Create `ranches` table:
   - id uuid PK, owner_id FK to profiles, name text, address text, city, state, timestamps

4. Create `animal_access_grants` table (the consent model from §2.2):
   - id uuid PK
   - owner_id uuid NOT NULL FK to profiles
   - trainer_id uuid NOT NULL FK to profiles
   - scope text NOT NULL CHECK (scope in ('animal','ranch','owner_all'))
   - animal_id uuid NULL FK to animals (nullable for scope='ranch' or 'owner_all')
   - ranch_id uuid NULL FK to ranches
   - granted_at timestamptz default now()
   - revoked_at timestamptz NULL
   - grace_period_ends_at timestamptz NULL
   - notes text
   - CHECK constraint so scope='animal' requires animal_id, scope='ranch' requires ranch_id

5. Create `trainer_profiles` table:
   - id uuid PK
   - user_id uuid UNIQUE FK to auth.users
   - logo_url text, brand_hex text, bio text, certifications jsonb
   - stripe_connect_id text
   - application_status text CHECK (application_status in ('submitted','approved','rejected','suspended')) default 'submitted'
   - reviewed_by uuid FK to auth.users NULL
   - reviewed_at timestamptz NULL
   - review_notes text

6. Create `trainer_applications` table:
   - id uuid PK, user_id FK, submitted_at timestamptz
   - application jsonb (holds references, insurance, bio)
   - status text default 'submitted'

7. Create helper functions:
   - get_my_role() returns text (STABLE, security definer)
   - am_i_owner_of(animal_id uuid) returns boolean
   - do_i_have_access_to_animal(animal_id uuid) returns boolean
   - is_silver_lining_admin() returns boolean

8. Enable RLS on all new tables. Write policies:
   - user_profiles: user can SELECT/UPDATE their own row. silver_lining can SELECT all.
   - animals: owner can CRUD rows where owner_id = auth.uid(). trainer can SELECT rows where do_i_have_access_to_animal(id) = true. silver_lining can SELECT all.
   - ranches: owner can CRUD their own. trainer can SELECT if granted via access grants. silver_lining can SELECT all.
   - animal_access_grants: owner can INSERT/UPDATE/DELETE their own grants. trainer can SELECT rows where trainer_id = auth.uid().
   - trainer_profiles: trainer can SELECT/UPDATE own. silver_lining can SELECT/UPDATE all (for vetting).
   - trainer_applications: trainer can INSERT/SELECT own. silver_lining can SELECT/UPDATE all.

9. Add updated_at trigger to every new table using the existing touch_updated_at() function.

10. Update the handle_new_user() trigger to read new signup metadata:
    - raw_user_meta_data->>'role' → user_profiles.role (default 'owner' if missing)
    - raw_user_meta_data->>'display_name' → user_profiles.display_name
    - If role = 'trainer', also INSERT a trainer_profiles row with application_status='submitted' and a trainer_applications row.

IMPORTANT: Test the migration locally first with `supabase db reset` in a branch. Do NOT apply to production until I've reviewed the diff.
```

**Verify (bash):**
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
ls supabase/migrations/
# Should see 00002_phase0_multirole_foundation.sql
cat supabase/migrations/00002_phase0_multirole_foundation.sql | head -40
```

---

### Prompt 9.3 — Scaffold the React + Vite + Tailwind + React Router frontend

```
The current setup is a single worker.js that serves HTML strings. We're graduating to a proper React SPA that's served by the same Cloudflare Worker (Cloudflare Pages Functions pattern, or Worker sites — your call, pick the simpler one and tell me why).

Requirements (see MANELINE-PRODUCT-FEATURE-MAP.md §2.1 and §5.2):
1. Create a Vite React+TypeScript project in a new `app/` subdirectory.
2. Install: react-router-dom, @supabase/supabase-js, tailwindcss, lucide-react, zustand (state), @tanstack/react-query.
3. Configure Tailwind with a Mane Line palette (start with placeholder tokens: --color-primary = #1E3A5F navy, --color-accent = #C9A24C gold, --color-bg = #FAF8F3 cream, --color-sage = #8BA678). Document in app/src/styles/brand.md that these are PLACEHOLDERS pending the real brand guide from Silver Lining.
4. Create a route tree:
   /                 Public home
   /login            Magic-link login
   /signup           Signup with role picker (Owner / Trainer / "I'm with Silver Lining")
   /app/*            Owner portal (protected, role='owner')
   /trainer/*        Trainer portal (protected, role='trainer'; route to /trainer/pending-review if application_status != 'approved')
   /admin/*          Admin portal (protected, role='silver_lining'; NOT branded "Silver Lining" in any chrome)
   /vet/:token       Vet View — no auth required, validates token against vet_share_tokens table (table created in a later phase; for now just show a placeholder)
5. Create an <AuthGate> component that reads user_profiles.role after Supabase session is active and redirects to the right portal root. If no role, redirect to /signup/complete-profile.
6. Build empty placeholder pages for each portal's root — just a header with the portal name, a "you are logged in as {role}" message, and a sign-out button.
7. Critical: "Silver Lining" must not appear in the Owner, Trainer, or Vet portal chrome. It appears only inside marketplace product listings (to be built in Phase 3) and as author attribution on Protocol cards. The app name and logo everywhere else is "Mane Line."
8. Update wrangler.toml to serve the built /app/dist as static assets via the existing Worker.
9. Add a README.md inside app/ with setup commands for a first-time coder (npm install, npm run dev, npm run build).

When you're done, run `npm run build` inside app/ and verify no errors. Do NOT deploy yet — we deploy after Prompt 9.4.
```

**Verify (bash):**
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co/app"
npm install
npm run build
# Look for: "✓ built in" with no errors
ls dist/
# Should show index.html + assets/
```

---

### Prompt 9.4 — Update the signup flow to capture role

```
The existing /join page in worker.js captures email + full_name + horse profile. We need to extend it — BUT keep the existing waitlist functionality working (don't break the live site).

Tasks:
1. In app/src/pages/SignupPage.tsx, build a two-step signup:
   Step 1: Email + full name + phone + "What brings you here?" radio (Horse Owner / Dog Owner / Professional Trainer / Silver Lining staff).
   Step 2 (conditional on role):
     - Owner: location, discipline, optionally first-animal details (existing horse form)
     - Trainer: business name, years training, primary discipline, certifications (textarea), insurance carrier, reference contacts (2 rows), "I agree to vetting review" checkbox
     - Silver Lining staff: just confirm email matches @silverliningherbs.com domain (reject otherwise with a polite error)
2. Call supabase.auth.signInWithOtp with the metadata structured as:
   { full_name, phone, location, role, discipline?, first_animal?, trainer_application? }
   The handle_new_user() trigger (from Prompt 9.2) will read these on account creation.
3. On /check-email, tell the user what to expect by role:
   - Owner: "You're in. Your dashboard will be ready when you click the link."
   - Trainer: "You're in. After you click the link, our team will review your application. You'll hear back within 48 hours."
   - Silver Lining: "You're in. You'll have admin access once you click the link."
4. Keep the existing waitlist Sheets mirror working — don't remove the webhook.
5. Add a feature flag in Cloudflare KV: `feature:signup_v2` = true/false. If false, fall back to the old single-step waitlist. This lets us A/B in beta.

After this, the full Phase 0 signup loop is live: user picks role → magic link → trigger creates user_profiles row → AuthGate routes to the right portal.
```

**Verify (bash):** ⚠️ **DEFERRED — 2026-04-16.** Full three-path signup verify is blocked on custom SMTP provisioning (Supabase default sender throttles after a few magic links and plus-addressing testing needs reliable inbound delivery). Cedric is setting up custom SMTP now. **Must run this verify BEFORE Phase 1 kicks off.** See §6.1 "Deferred verifications" below.

When SMTP is green, run:
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
# Start local dev
cd app && npm run dev
# In a separate terminal:
# Open http://localhost:5173/signup
# Try all three role paths (owner / trainer / silver-lining-staff).
# For each: verify the payload sent to Supabase includes role,
#   click the magic link, confirm landing on the right portal,
#   and confirm user_profiles.role matches in the DB.
# If plus-addressing works on your domain, use cedric+owner@ / cedric+trainer@ / cedric+slh@.
# Otherwise use three distinct real addresses or toggle Supabase "Confirm email" OFF in dev.
```

---

### Prompt 9.5 — Wire the new integrations as bindings + placeholder code

```
We're not hooking up Shopify, HubSpot, or the Protocol Brain in Phase 0 — those come in Phases 3, 4, and 5. But we need to scaffold their skeletons NOW so nothing surprises us later. Placeholder-first.

1. Update wrangler.toml:
   - Add an [ai] binding:   binding = "AI"
   - Add a [[vectorize]] binding:  binding = "VECTORIZE_PROTOCOLS", index_name = "maneline-protocols"
   - Add placeholder secret slots (document what they'll be, don't set values yet):
     SHOPIFY_STORE_DOMAIN
     SHOPIFY_STOREFRONT_TOKEN
     SHOPIFY_ADMIN_API_TOKEN
     HUBSPOT_PRIVATE_APP_TOKEN
     HUBSPOT_PORTAL_ID
     STRIPE_SECRET_KEY
     STRIPE_WEBHOOK_SECRET

2. Create src/integrations/ with one file per integration. Each file exports functions with the right signatures but returns mocked data with a clear comment:
   - src/integrations/shopify.ts → getProducts(), getProduct(sku), createCheckout(lineItems). All return mocked data with `// TODO(Phase 3): replace mock with real Shopify Storefront API call. See FEATURE_MAP §4.6.1`
   - src/integrations/hubspot.ts → upsertContact({ email, lifecycle, props }), trackEvent({ email, eventName, props }). Mocked, with TODO(Phase 5) comments.
   - src/integrations/workers-ai.ts → classifySymptom(text), embedText(text), chatComplete({ system, messages }). Mocked, with TODO(Phase 4) comments.
   - src/integrations/stripe.ts → createCheckoutSession({ sku, priceCents }), createConnectedAccount(trainerId). Mocked, with TODO(Phase 2) comments.

3. Add a /api/_integrations-health endpoint to the Worker that calls each mock and returns { shopify: 'mock', hubspot: 'mock', workersAi: 'mock', stripe: 'mock', env: <non-secret env keys present> }. This becomes our Phase 0 smoke test.

4. Create a docs/INTEGRATIONS.md file explaining the placeholder model in plain English — this is for future me (Cedric) who may be new to each API. Each section should include:
   - What the integration does
   - Where to get the credentials
   - Which env var holds which secret
   - Which Phase we flip from mock to real
   - A test command to verify once real credentials are in

5. Run Prompt 9.1's final summary again to confirm nothing was missed.
```

**Verify (bash):**
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
cat wrangler.toml | grep -E "(AI|VECTORIZE|SHOPIFY|HUBSPOT|STRIPE)"
# Should show all the bindings and secret names.
ls app/src/integrations/
# Should show 4 files: shopify.ts, hubspot.ts, workers-ai.ts, stripe.ts
curl https://<your-worker>.workers.dev/api/_integrations-health
# Should return JSON with all mocks
```

---

### Prompt 9.6 — Extend the nightly GitHub backup to cover the new tables

```
The existing nightly backup at supabase/functions/nightly-backup/index.ts snapshots `profiles` and `horses` only. Extend it to cover every new table from Prompt 9.2's migration:

Add to the snapshot: user_profiles, animals, ranches, animal_access_grants, trainer_profiles, trainer_applications.

For each table:
- Serialize to JSON (full row dump)
- Serialize to CSV (flat columns, JSON values in their own column escaped)
- Commit to the same snapshot folder (YYYY-MM-DD/) in JosiYoung/Databackup

Do NOT change the retention, schedule, or repo target. Keep everything else exactly as-is.

After the change, manually invoke the function once with `supabase functions invoke nightly-backup` and verify the new table files appear in the repo.

This closes the Triple-Redundancy loop for Phase 0's new tables (OAG Architecture Law 4).
```

**Verify (bash):**
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
supabase functions invoke nightly-backup
# Then check GitHub: https://github.com/JosiYoung/Databackup/tree/main/snapshots
# Verify today's folder contains user_profiles.json, animals.json, etc.
```

---

### Prompt 9.7 — Phase 0 verification drill (team-of-two cross-check)

```
Before we call Phase 0 "done," run this verification drill end-to-end and give me a green/red for each step. Do not mark Phase 0 complete until every step is green.

1. [LOGIN] Sign up as a brand-new owner. Receive magic link. Click it. Land on /app.
2. [LOGIN] Sign up as a brand-new trainer. Receive magic link. Click it. Land on /trainer/pending-review.
3. [LOGIN] Sign up with @silverliningherbs.com email as silver_lining. Land on /admin.
4. [RLS] As the owner user, query: supabase.from('animals').select('*'). Should return only the owner's animals. Try to SELECT from user_profiles — should only see self.
5. [RLS] As the trainer user (still in pending_review), query animals. Should return ZERO rows (no access grants yet).
6. [RLS] As the silver_lining user, query animals. Should return ALL animals in the system.
7. [BRAND] Screenshot /app, /trainer/pending-review, /admin. Confirm none of them say "Silver Lining" anywhere in the chrome, header, or footer. (Marketplace not built yet — it's fine for the word to not appear anywhere.)
8. [L1 MIRROR] The new trainer signup should appear in the Google Sheet within 10 seconds.
9. [L2 BACKUP] Run the nightly backup manually. Verify today's folder in github.com/JosiYoung/Databackup contains user_profiles.json with all three test users.
10. [INTEGRATIONS] curl /api/_integrations-health. All four integrations report "mock" with env keys acknowledged.
11. [DEPLOY] `git push origin main`. Cloudflare auto-deploys. Verify https://maneline.co (or the staging URL) is serving the new React app.

Report back with a table:
| Step | Status (🟢 / 🔴) | Notes |
Then tell me what's ready for Phase 1.
```

**Verify (bash) — your manual drill after Claude Code finishes:**
```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
npx wrangler deploy
# Visit the URL and walk through steps 1–11 yourself.
# If any step is red, do NOT proceed to Phase 1.
```

---

### Prompt 9.8 (optional, only if time remains) — Seed a first Protocol catalog

```
While we wait on Silver Lining's official Protocol content, seed a placeholder catalog so Phase 4 (chatbot) has something to index. Create a supabase/seeds/protocols.sql file with 5 rows in a new `protocols` table (create the table too, with RLS: public SELECT, silver_lining INSERT/UPDATE):

#10 Joint Support       | Joint health for performance horses | mapped SKUs: placeholder
#17 Colic Eaz           | Digestive emergency support         | mapped SKUs: placeholder
#33 Calming Care        | Behavior / calm for show nerves     | mapped SKUs: placeholder
Mare Moods              | Hormone support for mares           | mapped SKUs: placeholder
Bug Control Bundle      | Seasonal fly + pest defense         | mapped SKUs: placeholder

Each row should have: number text, name text, description text, use_case text, associated_sku_placeholder text, created_by text default 'Silver Lining Herbs'.

DO NOT commercialize or publish these — they're seed data for Phase 4 testing. Flag the file with a comment header: "// SEED DATA ONLY — replace with official Silver Lining Protocols before Phase 4 launch."
```

---

### Prompt 9.9 — Morning-after: open a Phase 1 work plan

Save this for the morning of 2026-04-17, after Phase 0 is green:

```
Phase 0 is verified. Now draft the Phase 1 (Owner Portal Core) build plan as a markdown file at docs/phase-1-plan.md. Reference MANELINE-PRODUCT-FEATURE-MAP.md §3.1 for the Owner Portal feature priorities.

Phase 1 scope:
- "Today" view (multi-animal card stack, health snapshot per animal)
- Animal CRUD (create, edit, archive — never delete)
- R2 storage for photos + PDFs (signed URLs)
- Records export to PDF (12-month view for vet / show / sale)
- Trainer access management UI (grant, revoke, see grace period)

Break Phase 1 into sub-prompts the same way §9 broke Phase 0 into 9.1 → 9.7. Each sub-prompt should be directly copy-pasteable into Claude Code. Include verify-it bash blocks.

Pause here and wait for my review before starting Phase 1.
```

---

## 10. Appendix — files created tonight (Phase 0)

If Claude Code follows the prompts above faithfully, these files should be new or significantly modified at the end of Phase 0:

```
supabase/migrations/00002_phase0_multirole_foundation.sql   NEW
supabase/functions/nightly-backup/index.ts                  MODIFIED
app/ (entire directory)                                     NEW
app/src/pages/SignupPage.tsx                                NEW
app/src/pages/LoginPage.tsx                                 NEW
app/src/pages/OwnerTodayPage.tsx                            NEW (empty shell)
app/src/pages/TrainerPendingReviewPage.tsx                  NEW (empty shell)
app/src/pages/AdminDashboardPage.tsx                        NEW (empty shell)
app/src/pages/VetViewPage.tsx                               NEW (empty shell)
app/src/components/AuthGate.tsx                             NEW
app/src/components/PortalLayout.tsx                         NEW
app/src/integrations/shopify.ts                             NEW (mocked)
app/src/integrations/hubspot.ts                             NEW (mocked)
app/src/integrations/workers-ai.ts                          NEW (mocked)
app/src/integrations/stripe.ts                              NEW (mocked)
app/src/styles/brand.md                                     NEW (placeholder palette)
docs/INTEGRATIONS.md                                        NEW
wrangler.toml                                               MODIFIED (bindings added)
worker.js                                                   MODIFIED (serves /app build, keeps /webhook/sheets)
README.md                                                   MODIFIED (Phase 0 completion notes)
```

---

*End of document. v0.2 — post-2 PM call. Next revision: 2026-04-17 morning, after Phase 0 verification drill green.*
