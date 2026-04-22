# Phase 8 — Tech Debt Ledger

Running list of Phase 8 gaps held out of the live path because Cedric does not
have the secrets/keys/deploy access yet, or because a capability requires a
production environment to verify. Every row here is a blocker to be cleared
before Phase 8 gate (§5 of `docs/phase-8-plan.md`) — either resolved, or
explicitly re-homed to v1.1.

Format: `TECH_DEBT(phase-8:NN)` — module / short-slug / description / unblock.

Status legend: 🔴 blocked on external input · 🟡 work written but not shipped · ⚪ work not yet written.

---

## Module 01 — Barn Calendar

| # | Slug | Description | Unblock |
|---|---|---|---|
| 01-01 | `worker-deploy` | Worker routes for `/api/barn/*` and `/api/public/events/:token` written in `worker.js` but not deployed. Live §F.4–§F.14 verify suite cannot run. 🟡 | `wrangler deploy` with live secrets |
| 01-02 | `pg-cron-reminders` | `pg_cron` job `barn-reminders-tick` every `*/15 * * * *` calling `/api/_internal/barn-reminders-tick` with `X-Internal-Secret`. Scans for T-48h / T-24h / T-2h windows and fires notifications. ⚪ | Worker deploy + `WORKER_INTERNAL_SECRET`; `SELECT cron.schedule(...)` |
| 01-03 | `pg-cron-materialize` | `pg_cron` job `barn-materialize-recurrences` nightly (e.g. `17 3 * * *`) — extends recurrence materialization horizon. ⚪ | same as 01-02 |
| 01-04 | `pg-cron-pro-claim` | `pg_cron` job `pro-claim-email` daily (e.g. `23 14 * * *`) — fires soft-signup "claim your pro account" email after 3 successful responses from the same `pro_contact_id`. ⚪ | same as 01-02 |
| 01-05 | `worker-internal-secret` | `WORKER_INTERNAL_SECRET` not provisioned — all three internal cron endpoints reject with 401. 🔴 | `wrangler secret put WORKER_INTERNAL_SECRET` (32+ random bytes, base64url) |
| 01-06 | `public-app-url` | `PUBLIC_APP_URL` Worker env must be set for external-attendee emails + claim-pro emails (used in `publicEventUrl(token)`). If unset, emails embed a broken link. 🔴 | `wrangler secret put PUBLIC_APP_URL` (e.g. `https://maneline.co`) |
| 01-07 | `per-instance-attendees` | When an RRULE materializes extra instances, only the base event has `barn_event_attendees` rows. Per-instance attendee propagation deferred — counter-propose on instance 7 of a weekly series currently targets the base attendee set. ⚪ | design decision + migration extension; may land in Module 07 drill cleanup |
| 01-08 | `barn-subnav` | ✅ Resolved. `BarnSubNav` (pill NavLinks: Calendar · Health · Facility · Spending) mounted above the header on all four top-level Barn pages. Lives at `app/src/components/owner/BarnSubNav.tsx`. |
| 01-09 | `twilio-sms-opt-in` | External-attendee SMS path written but gated behind Barn Mode entitlement (Module 05). Until Module 05 ships, every call falls through to email-only. 🟡 | Module 05 |
| 01-10 | `ics-attachment-smoke` | External invites include `.ics` but live Resend smoke against a real inbox (Apple Calendar parse, Google Calendar parse) not run. 🟡 | Worker deploy + Resend sandbox sender |

## Module 02 — Herd Health

| # | Slug | Description | Unblock |
|---|---|---|---|
| 02-01 | `pdf-r2-pipeline` | `POST /api/barn/herd-health/report.pdf` reuses the Phase 7 R2 pipeline (`env.BROWSER` Cloudflare Browser Rendering + R2 signed URL). Endpoint implemented, but the HTML template `worker/pdf/templates/herd-health.css` only references existing `worker/pdf-minimal.js` layout — live render not verified. 🟡 | Worker deploy + Browser Rendering binding live |
| 02-02 | `barn-mode-gate` | PDF export returns `402 barn_mode_required` when caller is not on Barn Mode. The gate function `requireBarnModeForHorseCount` / `isBarnModeEntitled` lives in Module 05 — until 05 ships, the gate is a stub that returns `true` for every owner (TODO comment in `worker/barn-mode-gate.js`). ⚪ | Module 05 |
| 02-03 | `scheduler-handoff` | ✅ Resolved client-side. `BarnCalendar` now reads `?prefill=health&animal=<id>&type=<record_type>` from the Schedule button on BarnHealth's cell sheet, auto-opens `CreateEventDialog`, and pre-fills the title (`"<record type> — scheduled"`) + selected animal. Server-side `prefill_source` audit column deferred (not currently in `CreateEventInput`) — SPA wiring is the gate the TECH-DEBT row meant. |

## Module 03 — Facility Map + Care Matrix

| # | Slug | Description | Unblock |
|---|---|---|---|
| 03-01 | `pdf-facility-export` | `POST /api/barn/facility/print.pdf` stubs to 501 with `tech_debt: phase-8:03-01`. Reuses Module 02 Browser Rendering pipeline once live. 🟡 | Worker deploy + Browser Rendering binding |
| 03-02 | `stall-drag-drop` | Stall assignment uses a pick-list dialog (select a horse, click Save). Full drag-and-drop `@dnd-kit` wiring + visual grid layout with `position_row`/`position_col` rendering deferred — core CRUD loop + RLS verified. ⚪ | SPA polish pass post-Module 06 |
| 03-03 | `care-matrix-scope` | Care matrix only lists horses with active stall assignments at the ranch. Owners with no assignments see "No horses are currently assigned to stalls" — no fallback to all owner horses. Intentional per spec (matrix is a barn-staff tool) but worth a drill-step check. ⚪ | Module 07 drill verification |

## Module 04 — Barn Spending

| # | Slug | Description | Unblock |
|---|---|---|---|
| 04-01 | `pdf-spending-export` | `POST /api/barn/spending/export.pdf` stubs to 501 with `tech_debt: phase-8:04-01`. Reuses Module 02 Browser Rendering pipeline once live. 🟡 | Worker deploy + Browser Rendering binding |
| 04-02 | `invoice-mirror-single-line` | `mirror_invoice_to_expense()` trigger inserts one expenses row per paid invoice, attributed to the first active `animal_access_grants` row between trainer + owner. Multi-horse / multi-line-item mapping deferred — an invoice covering two horses only mirrors to one. ⚪ | v1.1 line-item table + trigger rework |
| 04-03 | `expense-manual-entry-ui` | ✅ Resolved. Owner manual expense entry now wires through the existing `createExpense` path (direct PostgREST INSERT with `recorder_role='owner'`, RLS-enforced). New `OwnerExpenseDialog` wraps the shared `ExpenseForm`: mounted as a "Log expense" button on both `BarnSpending` (picks animal from dropdown) and `BarnSpendingAnimal` (animal pre-selected). No dedicated Worker route — the Phase 3.7 pattern already enforces ownership at RLS. |

## Module 05 — Pricing + SL comp

| # | Slug | Description | Unblock |
|---|---|---|---|
| 05-01 | `stripe-price-ids` | `STRIPE_PRICE_BARN_MODE_MONTHLY` ($25/mo) must be created in Stripe dashboard. `STRIPE_PRICE_BARN_MODE_ANNUAL` ($250/yr) optional per decision #1. 🔴 | Cedric creates price in Stripe dashboard |
| 05-02 | `stripe-webhook-live-verify` | Stripe webhook extension routes `checkout.session.completed` (mode=subscription + metadata.ml_source=barn_mode_subscription), `customer.subscription.created/updated/deleted`, `invoice.payment_failed` into `subscriptions` + `barn_mode_entitlement_events`. Code written (worker/subscription.js `mirrorBarnModeSubscriptionFromStripe` + handler short-circuit in `handleCheckoutSessionCompleted`). Not verified against live Stripe events. 🟡 | Worker deploy + `STRIPE_PRICE_BARN_MODE_MONTHLY` created + test transaction |
| 05-03 | `silver-lining-token` | `SILVER_LINING_SHOPIFY_ADMIN_TOKEN` + `SILVER_LINING_SHOPIFY_STORE_DOMAIN` not delivered by SLH. Dependency #6 + #7 of Phase 8 plan. 🔴 | SLH ops hand-off |
| 05-04 | `sl-sns-verify-cron-body` | Internal cron endpoint `/api/_internal/sl-verify-tick` registered but handler returns 501 with `tech_debt: phase-8:05-04` — Shopify Admin API call body is not written because the SLH backend shape (native `subscription_contracts` vs ReCharge vs Bold) is unconfirmed. Also requires `pg_cron` schedule once unblocked. ⚪ | SLH token + confirm backend vendor → implement fetch + stamp `subscriptions.comp_source='silver_lining_sns'` + comp_expires_at rolling |
| 05-05 | `hard-paywall-db-trigger` | Horse #4 paywall enforced at the DB layer (trigger `enforce_horse_limit` raising P0001 `barn_mode_required: ...`). SPA wraps supabase-js error into `BarnModeRequiredError` and shows `BarnModePaywallDialog`. No Worker middleware layer — createAnimal is a direct PostgREST call. If we ever add a Worker `POST /api/animals` route it must wrap the same check. ⚪ | N/A unless Worker /api/animals route is added |
| 05-06 | `silver-lining-link-flow` | `POST /api/barn/silver-lining/link` + `/link-confirm` handlers return 501 `tech_debt: phase-8:05-04` — link creation requires a verified Shopify customer lookup (same SLH token dependency). Stripe SetupIntent side is wired (createSetupIntent / retrieveSetupIntent). ⚪ | SLH token + 05-04 cron body |
| 05-07 | `admin-promo-codes-ui` | ✅ Resolved. `app/src/pages/admin/PromoCodesIndex.tsx` ships at `/admin/promo-codes` — campaign filter with datalist autocomplete, table of existing codes with status badge (Available/Redeemed/Expired), copy-to-clipboard per row, and a mint-batch dialog (campaign / months 1–36 / count 1–500 / single-use / expires / notes) that on success renders a multiline list of minted codes for handoff. Silver-lining role gate inherited from App.tsx ProtectedRoute. |
| 05-08 | `subscription-health-metrics` | `/api/_integrations-health` not yet extended with the subscription counters listed in 06-01 — left for Module 06 sweep. 🟡 | Module 06 |

## Module 06 — Observability + backup

| # | Slug | Description | Unblock |
|---|---|---|---|
| 06-01 | `health-endpoint-extend` | `/api/_integrations-health` extended with `barn.*`, `health.*`, `facility.*`, `spending.*`, `subscriptions.*`, `silver_lining.*`, `promo_codes.*` blocks. Shipped; counters run against live Supabase via service_role. Values will stay null / zero until traffic lands — not a blocker. 🟡 | Worker deploy |
| 06-02 | `nightly-backup-tables` | `nightly-backup/index.ts` TABLES list extended with all Phase 7 + Phase 8 tables (22 adds). Manifest `version: "8.0"`. Code shipped; next scheduled nightly run will pick up the new list. 🟡 | Next scheduled nightly backup firing |
| 06-03 | `health-endpoint-live-verify` | The new counters use table + column names verified against live `information_schema` at build time (care_matrix_entries, professional_contacts, barn_event_responses.responder_user_id, expenses.source_invoice_id, health_dashboard_acknowledgements). Not yet verified end-to-end against the deployed Worker. 🟡 | Worker deploy → curl `/api/_integrations-health` |

## Module 07 — Barn Mode drill

| # | Slug | Description | Unblock |
|---|---|---|---|
| 07-01 | `drill-25-steps` | End-to-end verification across Modules 01–05 + subscription + SL comp + hard paywall. Mirrors Phase 6/7 drill style. Cannot run without all deploy keys. 🔴 | full Phase 8 stack deployed |
| 07-02 | `hard-paywall-live-smoke` | Free-tier owner creating a 4th horse must surface the `BarnModePaywallDialog` (client-side catch of DB trigger P0001). Smoke against dev project: seed 3 horses for a test owner, try `POST` via the SPA, verify dialog appears with `currentHorseCount=3`. Code path wired; live smoke deferred. 🟡 | dev preview + 3-horse fixture owner |
| 07-03 | `barn-subnav-live` | ✅ Superseded by 01-08 resolution. Sub-nav ships with Module 04 complete; a drill pass across all four sub-surfaces can now verify the UX end-to-end once 07-01 unblocks. |

---

**How this ledger is used:** every time a Phase 8 module ships without a
capability that belongs in scope, the capability goes here with a concrete
unblock step. Phase 8 gate (§5 of plan) is not green until every row is either
resolved or explicitly re-homed to v1.1 with justification.
