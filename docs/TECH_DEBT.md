# Mane Line — Tech Debt Ledger

**Last refreshed:** 2026-04-24 after commit `f7a1344` (preflight sweep + UAT refresh).
**Scope:** consolidated across all phases; supersedes the now-deleted `docs/phase-8/TECH-DEBT.md` and the pre-sweep `docs/TECH_DEBT.md`.

---

## 1. Marker convention

When we knowingly ship a shortcut, hardcode, placeholder, or deferred follow-up, we annotate the exact spot in source with a grep-friendly marker:

```
TECH_DEBT(<phase>): <one-line description>
```

Examples:

```ts
// TECH_DEBT(phase-1): replace with generated types once supabase CLI is wired.
```

```sql
-- TECH_DEBT(phase-5): admin RLS policies; replace with service-role worker path.
```

```js
// TECH_DEBT(phase-4): Google Apps Script payloads are unsigned — add HMAC
// once we have write access to the script project.
```

**Why this convention:**

1. **Greppable.** `grep -rn "TECH_DEBT"` across the repo gives a complete, sortable list of outstanding shortcuts.
2. **Phase-tagged.** Every marker carries the phase by which the debt should be paid. Phase gates fail if any marker tagged with a prior phase is still present.
3. **No orphan tickets.** The comment IS the ticket. Anything worth tracking separately (design work, UX review) goes in the roadmap doc instead.

**Phase tags in use:** `phase-1` (owner MVP) · `phase-2` (trainer + Stripe) · `phase-3` (Shopify + checkout) · `phase-3.5` (protocols) · `phase-4` (protocol brain + RAG) · `phase-5` (admin + vet + HubSpot) · `phase-6` (onboarding + DO rate limiter) · `phase-7` (invoices + receipts) · `phase-8:NN` (Barn Mode modules) · `phase-9` (trainer paywall + messaging + ratings) · `eventually` (nice-to-have, no committed phase). Use `eventually` sparingly.

**Don't tag:** in-progress feature-branch work (use TODO, clean up before merge), style nitpicks (just fix), or "could be faster" without a measured bottleneck.

When you add a marker, add a row below. When you resolve one, delete the row in the same commit that removes the marker.

---

## 2. Active tech debt (blocks gate)

Status legend: 🔴 blocked on external input · 🟡 work written but not shipped · ⚪ work not yet written · 🟢 resolved in `<sha>` (deletion pending).

### 2.1 Deploy + secret gates

These are `[CONFIG]`-level — the code is written; a `wrangler secret put` or dashboard toggle flips them live.

| # | Slug | Where | Unblock |
|---|---|---|---|
| `phase-2` | Stripe platform keys | `worker/stripe.js`, `worker.js` (`handleStripeConnect*`) | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via `wrangler secret put`. All `/api/stripe/*` endpoints return `501 stripe_not_configured` until set. 🔴 |
| `phase-2` | Phase 2 verification drill | `docs/phase-2-plan.md` §4 (now deleted; recoverable from git history) | 18-step drill deferred until live Stripe keys + deployed Worker + `sweep-stripe-events` Edge Function + `pg_cron` schedule are wired. Static greps (steps 1, 7, 17) ran clean on 2026-04-17. 🔴 |
| `phase-3` | Shopify sync keys | `supabase-edge/shopify-catalog-sync`, `worker/stripe-checkout.js` | `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN` + `MANELINE_WORKER_URL`; Edge Function deployed v1 on 2026-04-17 (placeholder-safe, returns `{ skipped: 'shopify_not_configured' }` without token). Hourly `pg_cron` schedule must also be wired in SQL Editor. 🔴 |
| `phase-3` | SLH Stripe Connect account id | `worker.js` (`handleShopCheckout`), `worker/stripe-checkout.js` | `SLH_CONNECT_ACCOUNT_ID` — without it, `POST /api/shop/checkout` inserts `orders.status='awaiting_merchant_setup'` and returns `{ status: 'awaiting_merchant_setup' }` without a Stripe session. 🔴 |
| `phase-3` | Stripe + Shopify webhook/inventory | `worker.js` (`handleCheckoutSessionCompleted`, `handleCheckoutSessionAsyncPaymentFailed`), `worker/shopify-admin.js` (`adjustInventory`) | Same Stripe secrets as above + optional `SHOPIFY_ADMIN_API_TOKEN` for inline inventory decrement (hourly storefront sync reconciles within ~1h if the Admin token is absent). 🔴 |
| `phase-4` | Landing hero video + poster | `app/src/components/landing/ScrollHero.tsx`, `app/public/Landing/` | Stock Pexels clips in place. Resolve by (1) commissioning real brand-shot horse footage from the SLH ranch, (2) re-encoding with every-frame keyframes, (3) extracting a proper first-frame poster. If final MP4 > 25 MiB, host on R2 + front with custom domain. 🟡 |
| `phase-5` | HubSpot private-app token | `app/src/integrations/hubspot.ts`, `worker.js` (`/webhooks/hubspot-sync`) | `HUBSPOT_PRIVATE_APP_TOKEN` blocks the sync drain + retry queue. 🔴 |
| `phase-5` | Phase 5 drill residuals | see deleted `docs/phase-5-plan.md` §5.9 | Steps 8 (trainer-reject email — Resend sender wired but `decision==='rejected'` branch at `worker.js:708` not yet calling `sendEmail`), 10–11 (Stripe refund + idempotency), 15–16 (HubSpot drain + dead-letter) still secrets-blocked. Step 14 (strict-429 under burst) code-closed in 6.3 via `RateLimiter` Durable Object; live-traffic verification deferred. 🔴 |
| `phase-8:01-01` | Worker deploy of Barn routes | `worker.js` | `/api/barn/*` + `/api/public/events/:token` code exists; §F.4–§F.14 verify suite cannot run. 🟡 |
| `phase-8:01-02` | `pg_cron` barn-reminders-tick | SQL Editor | `*/15 * * * *` calling `/api/_internal/barn-reminders-tick` with `X-Internal-Secret`. Scans T-48h / T-24h / T-2h windows. ⚪ |
| `phase-8:01-03` | `pg_cron` barn-materialize-recurrences | SQL Editor | Nightly `17 3 * * *` extends recurrence horizon. ⚪ |
| `phase-8:01-04` | `pg_cron` pro-claim-email | SQL Editor | Daily `23 14 * * *` fires soft-signup "claim your pro account" email after 3 successful responses from the same `pro_contact_id`. ⚪ |
| `phase-8:01-05` | `WORKER_INTERNAL_SECRET` | Worker env | All three internal cron endpoints reject with 401 until provisioned. `wrangler secret put WORKER_INTERNAL_SECRET` (32+ random bytes, base64url). 🔴 |
| `phase-8:01-06` | `PUBLIC_APP_URL` | Worker env | External-attendee emails embed a broken link without this. `wrangler secret put PUBLIC_APP_URL` (e.g. `https://maneline.co`). 🔴 |
| `phase-8:01-07` | Per-instance attendees on RRULE | Migration extension | When a recurrence materializes extra instances, only the base event has `barn_event_attendees` rows. Counter-propose on instance 7 of a weekly series currently targets the base attendee set. ⚪ |
| `phase-8:01-09` | Twilio SMS opt-in for external attendees | Worker Barn paths | Gated behind Barn Mode entitlement; falls through to email-only until Module 05 ships. 🟡 |
| `phase-8:01-10` | `.ics` attachment live smoke | Worker + Resend | External-invite `.ics` parse not verified against Apple/Google Calendar inboxes yet. 🟡 |
| `phase-8:02-01` | Herd Health PDF R2 pipeline | `worker/pdf/templates/herd-health.css`, Browser Rendering | `POST /api/barn/herd-health/report.pdf` implemented but live render not verified. 🟡 |
| `phase-8:02-02` | Barn Mode gate stub | `worker/barn-mode-gate.js` | PDF export returns `402 barn_mode_required` when caller is not on Barn Mode; gate is a stub returning `true` for every owner until Module 05 entitlement checks ship end-to-end. ⚪ |
| `phase-8:03-01` | Facility PDF export | `worker.js` | `POST /api/barn/facility/print.pdf` stubs to 501. Reuses Module 02 Browser Rendering pipeline once live. 🟡 |
| `phase-8:03-02` | Stall drag-drop | SPA Barn Facility | Stall assignment uses a pick-list dialog. Full `@dnd-kit` wiring + visual grid with `position_row/col` deferred — core CRUD + RLS verified. ⚪ |
| `phase-8:03-03` | Care matrix fallback scope | SPA Barn Facility | Owners with no stall assignments see "No horses are currently assigned to stalls" — intentional (matrix is barn-staff tool). Drill-step check. ⚪ |
| `phase-8:04-01` | Spending PDF export | `worker.js` | `POST /api/barn/spending/export.pdf` stubs to 501. Same pipeline as 02-01. 🟡 |
| `phase-8:04-02` | Multi-line-item invoice mirror | Trigger `mirror_invoice_to_expense` | Current trigger inserts one `expenses` row per paid invoice, attributed to the first active `animal_access_grants` row between trainer + owner. Multi-horse / multi-line-item mapping deferred. ⚪ |
| `phase-8:04-04` | Receipt upload (Worker redeploy) | Dev SPA | **DB CHECK 🟢 Resolved in migration `00031_r2_kind_expand.sql`** — `r2_objects.kind` now accepts `expense_receipt` + `trainer_logo`. SPA + Worker code was already wired; the deployed Worker was returning `400 bad_kind` + the DB was returning `23514` on commit. Worker redeploy + dev smoke still required to tick this as done. 🟡 |
| `phase-8:05-01` | Stripe Barn-Mode price ids | Stripe dashboard | `STRIPE_PRICE_BARN_MODE_MONTHLY` ($25/mo) mandatory; `STRIPE_PRICE_BARN_MODE_ANNUAL` ($250/yr) optional per decision. 🔴 |
| `phase-8:05-02` | Stripe webhook live verify | `worker/subscription.js` | Code wired (`mirrorBarnModeSubscriptionFromStripe` + `handleCheckoutSessionCompleted` short-circuit) but not verified against live Stripe events. 🟡 |
| `phase-8:05-03` | SLH Shopify token | Worker env | `SILVER_LINING_SHOPIFY_ADMIN_TOKEN` + `SILVER_LINING_SHOPIFY_STORE_DOMAIN` not delivered by SLH ops. 🔴 |
| `phase-8:05-04` | SL verification cron body | `worker.js` (`handleSilverLiningVerifyTick`) | Handler returns 501 with `tech_debt: phase-8:05-04` — Shopify Admin API shape (native `subscription_contracts` vs ReCharge vs Bold) unconfirmed; also requires `pg_cron` schedule once unblocked. ⚪ |
| `phase-8:05-05` | Worker `/api/animals` paywall layer | `worker.js` | DB trigger `enforce_horse_limit` enforces horse-#4 paywall (raises P0001); if a Worker `POST /api/animals` route is ever added it must wrap the same check. Defensive-only. ⚪ |
| `phase-8:05-06` | SL link flow | `worker.js` (`/api/barn/silver-lining/link*`) | Handlers return 501; Stripe SetupIntent side is wired. Blocked on SLH token + 05-04 cron body. ⚪ |
| `phase-8:05-08` | Subscription health counters | `/api/_integrations-health` | Counters listed in 06-01 not yet extended — Module 06 sweep. 🟡 |
| `phase-8:06-01` | Health endpoint extension | `/api/_integrations-health` | Extended with `barn.*`, `health.*`, `facility.*`, `spending.*`, `subscriptions.*`, `silver_lining.*`, `promo_codes.*` counters. Values null/zero until traffic lands. 🟡 |
| `phase-8:06-02` | Nightly backup table list | `nightly-backup/index.ts` | Extended with Phase 7 + 8 tables (manifest `version: "8.0"`). Shipped; next scheduled run picks up the new list. 🟡 |
| `phase-8:06-03` | Health endpoint live verify | Worker curl | Counters verified against `information_schema` at build time; not yet verified against deployed Worker. 🟡 |
| `phase-8:07-01` | Barn Mode 25-step drill | End-to-end | Cannot run without all deploy keys. 🔴 |
| `phase-8:07-02` | Hard paywall live smoke | Dev preview | Free-tier 4th-horse create must surface `BarnModePaywallDialog` (client-side catch of trigger P0001). Code wired; live smoke deferred. 🟡 |

### 2.2 Preflight-sweep residuals (2026-04-24)

From the audit swarm + deep DB-verification agent at commit `cd65205`:

| # | Slug | Where | Unblock |
|---|---|---|---|
| `phase-8:presign-ttl` | R2 presigned PUT TTL too long | `worker.js:3584-3592` | Current 300s; narrow to ≤120s. 🟡 |
| `phase-8:stripe-webhook-501` | `STRIPE_WEBHOOK_SECRET` absence returns 501 | `worker.js:6613-6616` | Should return 401 (fail-closed, no reconnaissance signal). 🟡 |
| `phase-5` | `btree_gist` extension in `public` schema | Advisor lint | Move to `extensions` schema. Requires superuser migration. 🟡 |
| `phase-8:kpi-audit` | `admin_kpi_snapshot` skips audit_log | `worker.js:905` | Every other admin endpoint writes to `audit_log`; add a row here for parity. 🟡 |
| `phase-8:admin-pin-nav` | `/admin/settings/pin` missing nav entry | `AdminIndex.tsx` TABS array | Route exists but no NavLink. 🟡 |
| `phase-8:today-error-card` | `TodayView` stuck on skeleton on error | `app/src/pages/app/TodayView.tsx:47-49` | Currently calls `notify.error()` but never renders an error Card. 🟡 |
| `phase-8:owner-pay-protect` | `/app/sessions/:id/pay` missing `<ProtectedRoute>` | `app/src/pages/owner/OwnerIndex.tsx:49` | RLS + role check cover; add route wrapper for defence-in-depth. 🟡 |
| `phase-8:a11y-iconbuttons` | Icon-only buttons missing `aria-label` | `BarnCalendar.tsx:270`, `SessionsIndex`, admin inline-edits | A11y. 🟡 |
| `phase-8:back-links` | Missing top-of-page back links | `BarnSpendingAnimal`, `InvoiceDetail` (normal state), `SubscriptionDetail`, `/trainer/invoices/recurring` | Dead-ends if sub-nav fails. 🟡 |
| `phase-8:error-boundary` | No top-level `<ErrorBoundary>` | `OwnerLayout`, `TrainerLayout`, `AdminLayout` | Child crash nukes whole portal. 🟡 |
| `phase-8:invoice-detail-errors` | Raw `(err as Error).message` in `InvoiceDetail` | `app/src/pages/trainer/InvoiceDetail.tsx` | Wrap with `mapSupabaseError()` for friendly copy. 🟡 |
| `phase-8:sessions-loading` | `SessionsIndex` bare loading text | `app/src/pages/trainer/SessionsIndex.tsx` | Replace with skeleton. 🟡 |
| `phase-8:form-html-validation` | zod-only form validation | Various owner/admin forms | Add HTML `required` + `maxLength` so browser UX catches before submit. 🟡 |
| `phase-8:home-dangerouslysethtml` | `dangerouslySetInnerHTML` on hardcoded strings | `Home.tsx:1400`, `Home.tsx:2107` | Safe today (hardcoded `&mdash;` / `&rsquo;`); comment or replace with helper before any CMS sourcing. ⚪ |
| `phase-9` | Animals archive DB trigger (defence-in-depth) | `animals` table | Worker `/api/animals/archive|unarchive` writes `animal_archive_events` atomically; `animals_owner_all` RLS grants `for all`, so a direct `supabase-js` UPDATE could bypass the audit. Add a BEFORE UPDATE trigger that inserts into `animal_archive_events` when `archived_at IS DISTINCT FROM OLD.archived_at`, coordinated with the Worker to avoid double-audit. No current code path bypasses the Worker. ⚪ |
| `phase-9` | Unused-index re-audit | `pg_stat_user_indexes` | 91 of 92 `unused_index` advisor hits retained because `idx_scan=0` reflects zero production traffic, not genuine waste. Re-audit ~2 weeks post-launch. ⚪ |

### 2.3 Long-standing stragglers

| # | Slug | Where | Unblock |
|---|---|---|---|
| `phase-1` | Hand-rolled DB types | `app/src/lib/database.types.ts` | Replace with `supabase gen types` output. 🟡 |
| `phase-2` | Gmail relay hook | `worker.js:4716` | Wire Gmail relay; placeholder until then. ⚪ |
| `phase-2.5` | Owner one-tap confirm email | `worker.js:7524` | Email owner a one-tap confirm link before auto-actions. ⚪ |
| `phase-4` | Google Apps Script HMAC | `supabase-edge/apps-script/*` (future) | Sign payloads once we have write access to the script project. ⚪ |
| `phase-4` | Dev-stub Joint Formula product | `products` row `JOINT-001`, `protocols` Protocol #10 | Delete stub + populate real `linked_sku_codes` from SLH CSV after Shopify sync lands. ⚪ |
| `phase-5` | Ranch-scope in grants RLS | `supabase/migrations/00004:123`, `00027:105` | Deferred until `animals.ranch_id` ships. Ranch-scope grants type-check but do not affect per-animal RLS; owner + animal + owner_all scopes are fully enforced. ⚪ |
| `phase-5` | Admin RLS policy superseded | `supabase/migrations/00002_phase0_multirole_foundation.sql` | REVISIT block superseded by drop in 00004. Cleanup-only. ⚪ |
| `phase-5` | KV rate-limiter fallback | `worker.js` (`rateLimitKv`) | Best-effort under burst (KV per-key write cap + 60s read cache). Migrated hot paths to the `RateLimiter` Durable Object in Phase 6.3; legacy KV path still exists for non-hot callers. ⚪ |

---

## 3. Resolved in `cd65205` (preflight sweep, 2026-04-24)

Kept here for one cycle so auditors can see what just landed; drop in the next sweep.

| Was | Resolution |
|---|---|
| 🔴 `r2_objects.kind` CHECK rejected `expense_receipt` + `trainer_logo` — every `/api/uploads/commit` for those kinds 500'd with SQLSTATE `23514` (found by deep DB-verification agent `a61de6a5c3b825b20`). | Migration `00031_r2_kind_expand.sql`. |
| 🔴 `worker/facility.js` `getOwnerRanch` + `listOwnerRanches` referenced nonexistent `ranches.archived_at` + `ranches.address_line1` — every Barn Facility endpoint 500'd. | Column is `address`; `archived_at` filter removed. |
| 🔴 `professional_contacts.role` CHECK rejected 4 of 8 SPA categories (nutritionist, bodyworker, boarding, hauler). | Migration `00035_pro_contacts_roles_expand.sql` + Worker `BARN_CONTACT_ROLES` expanded 5→9. |
| 🔴 Barn Calendar RSVP payload schema mismatch between SPA and Worker — every decline + counter 400'd (`response`→`status`, `countered_*`→`counter_start_at`/`response_note`, etc.). | `app/src/lib/barn.ts` realigned to DB shape; 4 pages updated (BarnContacts, BarnCalendar, PublicEventAccept, MySchedule). |
| 🔴 Owner "Mark confirmed/declined on attendee" silently no-op'd — handler ignored `body.attendee_id` and looked up the caller's own row. | `worker.js handleBarnEventRespond` now honours `attendee_id` with ownership verification; audit tags `on_behalf=true`. |
| 🟡 `promo_codes` had RLS enabled with zero policies (advisor `rls_enabled_no_policy`). | Migration `00030_audit_hardening.sql` §3 adds explicit silver-lining-admin SELECT policy. |
| 🟡 138 `multiple_permissive_policies` (expenses: 18, supplement_doses: 12). | Migration `00033_rls_permissive_consolidation.sql`. |
| 🟡 113 `auth_rls_initplan` warnings. | Migration `00032_rls_initplan_optimize.sql` — `auth.uid()` wrapped in `(select …)`. |
| 🟡 30+ unindexed FKs (horse_messages, invoice_line_items, animal_media, health_thresholds, etc.). | Migration `00030_audit_hardening.sql` §2 (hot paths) + `00034_fk_indexes_sweep.sql` (full sweep, 31 partial indexes). |
| 🟡 10 functions with mutable `search_path`. | Migration `00030_audit_hardening.sql` §1 — `set search_path = public, pg_temp` via `ALTER FUNCTION`. |
| 🟡 Admin promo-code archive/restore missing. | New `archiveAdminPromoCode` / `unarchiveAdminPromoCode` endpoints + UI toggle in `PromoCodesIndex`. |
| 🟡 `@supabase/supabase-js` stale. | Bumped 2.103.3 → 2.104.1. 0 prod vulns. |
| 🟡 `horse_messages_animal_idx` strictly redundant (strict prefix of composite). | Migration `00036_drop_redundant_horse_messages_index.sql`. |

---

**Gate rule:** every 🔴 / 🟡 row in §2 must be either resolved or explicitly re-homed to v1.1 before calling the build "launch-ready." ⚪ rows can ship to closed beta if the owner of the row accepts the risk; they cannot ship to public launch.
