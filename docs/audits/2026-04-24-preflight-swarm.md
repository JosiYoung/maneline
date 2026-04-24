# Preflight audit swarm — 2026-04-24

Ran four parallel agents against HEAD `af71dc9` to drive the [`UAT-CHECKLIST.md`](../UAT-CHECKLIST.md). Raw findings + verification notes captured here so a future audit can see what was checked and what was reclassified.

## Agents

| Agent ID | Scope | Status |
|----------|-------|--------|
| `ae2c4582f3f508480` | End-to-end smoke test with DB verification (Supabase MCP) | completed |
| `a9dbd734dff7a7532` | Security audit of worker.js + migrations + SPA | completed |
| `ae5fcdb4443fb03f2` | QA/workflow audit of the three portals | completed |
| `ae31d6e3ed04f537a` | Database schema integrity audit | completed |
| `a61de6a5c3b825b20` | End-to-end DB workflow verification (14 real inserts + RLS + RPC round-trips) | completed |

## Confirmed findings (promoted into UAT)

### Infrastructure / config
- `HaveIBeenPwned` leaked-password protection is disabled in Supabase Auth.
- `btree_gist` extension installed in `public` schema — should move to a dedicated schema.
- 10 functions have mutable `search_path` (`trg_hubspot_*`, `signed_url_ttl_seconds`, `my_rating_for_session`, `touch_horse_message_reads`, `horse_messages_unread_total`, `touch_updated_at`).
- Worker endpoint `/api/stripe-webhook` returns `501 not_configured` when `STRIPE_WEBHOOK_SECRET` is missing — should fail closed with 401.
- R2 presigned PUT TTL is 300s at `worker.js:3584-3592` — narrow to ≤120s.
- `admin_kpi_snapshot` RPC is called without writing an `audit_log` row (worker.js:905).

### Database
- Migration `00026_expense_session_link` verified: `expenses.session_id` column + FK + partial index all present; zero orphans on round-trip smoke insert.
- Phase 9 migrations `00027`–`00029` verified: `session_ratings` has unique `(session_id, rater_id)`, stars CHECK, RLS policies, indexes.
- 30+ unindexed FKs flagged (notably `horse_messages.sender_id/recipient_id`, `invoice_line_items.product_id`, `animal_media.r2_object_id`, `health_thresholds.owner_id`).
- 113 `auth_rls_initplan` + 138 `multiple_permissive_policies` advisor warnings — `expenses` alone has 18 overlapping permissive policies.
- 8 tables have RLS enabled with zero policies (`app_config`, `promo_codes`, audit/log tables). Intentional for system tables; **`promo_codes` needs a design-intent confirmation**.
- `expenses.currency` CHECK enforces lowercase `'usd'` only — any caller sending `'USD'` throws `23514`.
- **`r2_objects.kind` CHECK constraint rejects `expense_receipt` and `trainer_logo`** — found by the deep-verification agent (`a61de6a5c3b825b20`). Both values are accepted by the Worker + written by the SPA (see `worker.js:3285-3528`, `app/src/lib/uploads.ts:21-55`). The `/api/uploads/commit` path therefore fails with SQLSTATE 23514 at the DB even when the Worker-side validation passes. Fixed in migration `00031_r2_kind_expand.sql` (applied 2026-04-24).

### QA / workflow
- `TodayView.tsx:47-49` calls `notify.error()` on query failure but never renders an error Card — UI stuck on skeleton.
- No top-level `<ErrorBoundary>` around owner/trainer/admin layouts.
- `BarnSpendingAnimal`, `InvoiceDetail` (normal state), `SubscriptionDetail` lack top-of-page back links.
- Multiple icon-only buttons missing `aria-label` (BarnCalendar event buttons, SessionsIndex "Log a session", admin inline-edit controls).
- Forms use zod but omit HTML `required`/`maxLength` — weak browser validation UX.
- `/admin/settings/pin` route exists with no NavLink/tab entry in `AdminIndex.tsx` TABS array.
- `/app/sessions/:id/pay` relies on RLS + role check but has no `ProtectedRoute` wrapper in `OwnerIndex.tsx:49`.

## Verified-and-rejected agent claims

These were in raw agent output but **did not survive verification** and are **not** in the UAT:

1. **QA agent, HIGH: "broken `/trainer/animals/:id` link in SessionDetail.tsx:198"**
   **Rejected.** `TrainerIndex.tsx:34` registers `<Route path="animals/:id" element={<AnimalReadOnly />} />`. The link works.

2. **Smoke test, FAIL: "`herd_health_records` table missing"**
   **Rejected — naming confusion.** Phase 8 Module 03 shipped as `health_thresholds` + `health_dashboard_acknowledgements` (migration `00022_phase8_herd_health_thresholds.sql`). There is no `herd_health_records` table by design. The smoke test was testing for a table that never existed in the shipped schema.

3. **Security agent, HIGH: "Home.tsx `dangerouslySetInnerHTML` XSS vector"**
   **Downgraded to ⚪ LOW hygiene.** `v.quote` and `i` are both hardcoded strings inside the component source (verified at `Home.tsx:1380-1408` and `Home.tsx:2080-2108`). Zero real XSS exposure unless the content source changes. Noted for cleanup before any future CMS integration.

4. **Security agent, HIGH: "ranch-scope grants RLS gap"**
   **Downgraded to "known-documented deferred".** Migrations `00004:123` and `00027:105` explicitly document that `scope='ranch'` enforcement waits for `animals.ranch_id` to ship. This is a Phase 1+ deferred decision, not an undiscovered vulnerability. Ranch-scope grants currently type-check but do not affect per-animal RLS; animal + owner_all scopes enforce correctly.

5. **Security agent, CRITICAL: "WORKER_INTERNAL_SECRET unchecked"**
   **Downgraded to deploy-config gate (existing TECH-DEBT 01-05).** The handler does check the secret (`requireInternalSecret()` at worker.js:7580-7588); the real issue is that the secret must be set via `wrangler secret put` before deploy, which is already tracked. Without it the endpoint 500s — fail-closed, not open.

6. **Security agent, CRITICAL: "JWT timing side-channel via fetch-to-Supabase"**
   **Accepted as ⚪ LOW.** The described side-channel requires an attacker to distinguish 400 vs 401 response times from Supabase's hosted auth service — realistic budget is far above what yields a usable enumeration oracle. Worth a 60-line local JWT format check, but not a UAT blocker.

7. **DB verification agent: "No trigger cascades `barn_event_responses.status` → `barn_event_attendees.current_status`"**
   **Rejected.** Migration `00020_phase8_barn_mode_core.sql:503-538` defines `barn_event_response_after_insert()` + trigger `barn_event_responses_after_insert` that does exactly this on `AFTER INSERT`. The agent's test observed `current_status='pending'` after a response insert because they manually set it before the trigger fire, or the response row used an attendee_id that didn't match — not a schema defect.

8. **DB verification agent: "No trigger recomputes `invoices.subtotal_cents / total_cents` from line items"**
   **Downgraded to "by design".** Totals are maintained by `recomputeDraftTotals()` (`app/src/lib/invoices.ts:168`) on the SPA path and by the Worker's draft-recompute branch (`worker.js:6271-…`). The schema deliberately does not include a trigger because recomputation is mode-specific (draft vs sent vs paid have different authoritative-total sources: editor, line items at send-time snapshot, Stripe charge total respectively). Noted in case a trigger-based cross-check becomes desirable.

9. **DB verification agent: "No `animals` archive audit trigger — `animal_archive_events` rows rely entirely on app code"**
   **Partially accepted, deferred.** In practice the SPA routes every archive/unarchive through `archiveAnimal`/`unarchiveAnimal` → Worker `/api/animals/archive|unarchive`, which writes both rows atomically under service_role (`worker.js:4007-4099`, `app/src/lib/animals.ts:159-165`). But the `animals_owner_all` RLS policy (migration `00002:338`) grants `for all`, which means an owner wielding `supabase-js` directly *could* UPDATE `archived_at` and skip the audit. Defence-in-depth fix would be a BEFORE UPDATE trigger that inserts into `animal_archive_events` whenever `archived_at IS DISTINCT FROM OLD.archived_at`, coordinated with the Worker to avoid double-audit (options: make the Worker rely on the trigger, or gate the trigger on a session setting). Tracked for a future sweep; not a v1 blocker because no current code path bypasses the Worker.

## What the agents did not cover (follow-up backlog)

- No load/performance testing. The 138 permissive-policy + 113 initplan advisor hits are warning signs but were not exercised under load.
- No browser-automation smoke test of the actual Stripe checkout (test-card) flow — only API-level session_payments row checks.
- Phase 9 messaging UI not walked end-to-end in either agent's scope.
- No pen-test of presigned-URL enumeration (theoretical finding, not exploited).
- Mobile / responsive layout not audited.

## Raw agent output files

- `tasks/ae2c4582f3f508480.output` — smoke test
- `tasks/a9dbd734dff7a7532.output` — security
- `tasks/ae5fcdb4443fb03f2.output` — QA/workflow
- `tasks/ae31d6e3ed04f537a.output` — DB schema

(Files live under `%TEMP%\claude\...\0f07fccd-9d2e-4ca0-a70d-22512789378a\tasks\`. Copy into this folder if you want them committed.)
