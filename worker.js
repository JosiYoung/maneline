/**
 * Mane Line — Cloudflare Worker entry point.
 *
 * Thin edge in front of the React SPA in `./app`. Owns these routes:
 *
 *   POST /webhook/sheets          — forwards Supabase DB webhooks to Apps
 *                                   Script so the L1 Google Sheets mirror
 *                                   stays warm. Uses constant-time compare
 *                                   on the shared secret header.
 *   GET  /api/flags               — returns feature flags read from FLAGS KV.
 *   POST /api/has-pin             — [Phase 0 hardening] proxies
 *                                   check_has_pin() via service_role with
 *                                   per-IP rate limiting. Replaces the
 *                                   anon-callable RPC the SPA used to hit
 *                                   directly.
 *   GET  /api/admin/*             — service_role admin endpoints. Every
 *                                   successful read writes an audit_log
 *                                   row. Requires the caller to hold a
 *                                   valid Supabase session AND be a
 *                                   silver_lining admin (status=active).
 *   POST /api/uploads/sign        — [Phase 1] returns a 5-minute presigned
 *                                   R2 PUT URL plus the object_key the
 *                                   browser must send back to /commit.
 *   POST /api/uploads/commit      — [Phase 1] Worker HEADs R2 to confirm
 *                                   the PUT actually landed, then writes
 *                                   r2_objects + the typed row
 *                                   (vet_records or animal_media).
 *   GET  /api/uploads/read-url    — [Phase 1] returns a 5-minute presigned
 *                                   R2 GET URL for an object the caller
 *                                   is authorized to read.
 *   POST /api/animals/archive     — [Phase 1] atomic soft-archive:
 *                                   animals.archived_at = now() plus a
 *                                   row in animal_archive_events. Reason
 *                                   is required (OAG §8).
 *   POST /api/animals/unarchive   — [Phase 1] reverse of the above.
 *   POST /api/records/export-pdf  — [Phase 1] server-side renders a
 *                                   12-month records PDF, stores it in
 *                                   R2 under kind='records_export', and
 *                                   returns a 15-min signed GET URL.
 *   POST /api/access/grant        — [Phase 1] owner grants a trainer
 *                                   access (scope=animal|ranch|owner_all).
 *                                   Looks up the trainer by email (must
 *                                   be approved) and writes
 *                                   animal_access_grants via service_role.
 *   POST /api/access/revoke       — [Phase 1] owner revokes a grant; sets
 *                                   revoked_at + grace_period_ends_at so
 *                                   the trainer keeps read access for N
 *                                   days (default 7, max 30).
 *   GET  /api/_integrations-health — Phase 0 smoke test.
 *   GET  /healthz                 — trivial liveness probe.
 *   GET  /join                    — 301 → /signup (legacy waitlist form
 *                                   retired; SPA has a v1 fallback flag).
 *
 * Every other request is handed to the Workers Assets binding which
 * serves the built SPA from `app/dist`.
 *
 * Env expected:
 *   SUPABASE_URL, SUPABASE_ANON_KEY            (public vars)
 *   SUPABASE_WEBHOOK_SECRET                    (secret)
 *   SUPABASE_SERVICE_ROLE_KEY                  (secret, NEW in 00004)
 *   GOOGLE_APPS_SCRIPT_URL / _SECRET           (secrets)
 *   R2_ACCOUNT_ID                              (secret, Phase 1)
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY    (secrets, Phase 1)
 *   FLAGS                                      (KV namespace binding)
 *   ML_RL                                      (KV — rate-limit buckets)
 *   ASSETS                                     (Workers Assets binding)
 *   MANELINE_R2                                (R2 bucket binding, Phase 1)
 */
import { presignPut, presignGet } from './worker/r2-presign.js';
import { renderRecordsPdf } from './worker/records-export.js';
import {
  createAccountLink,
  createConnectCustomer,
  createConnectInvoice,
  createConnectInvoiceItem,
  createExpressAccount,
  createPaymentIntent,
  createRefund,
  finalizeConnectInvoice,
  isStripeConfigured,
  retrieveAccount,
  retrieveConnectInvoice,
  retrievePaymentIntent,
  sendConnectInvoice,
  updateConnectAccount,
  uploadStripeFileForAccount,
  voidConnectInvoice,
} from './worker/stripe.js';
import { verifyStripeSignature } from './worker/stripe-webhook.js';
import { createCheckoutSession, retrieveCheckoutSession } from './worker/stripe-checkout.js';
import { adjustInventory } from './worker/shopify-admin.js';
import {
  fetchProductByHandle,
  shopifyConfigured,
  shopifyNodeToProductRow,
} from './worker/shopify.js';
import {
  CHAT_MODEL,
  EMBED_DIMS,
  embedText,
  queryProtocolVectors,
  upsertProtocolVector,
} from './worker/workers-ai.js';
import {
  FALLBACK_CANNED_MESSAGE,
  RAG_TOP_K,
  composeMessages,
  detectEmergency,
  getOrCreateConversation,
  getRecentHistory,
  hydrateProtocols,
  incrementDailyRateLimit,
  insertChatbotRun,
  kvKeywordFallback,
  nextTurnIndex,
  runChatModelWithTimeout,
  teeAndAccumulate,
  touchConversation,
} from './worker/chat.js';
import {
  isHubspotConfigured,
  sendBehavioralEvent,
  toHubspotPayload,
  upsertContact,
} from './worker/hubspot.js';
import {
  adminInvitationsArchive,
  adminInvitationsBulk,
  adminInvitationsCreate,
  adminInvitationsList,
  adminInvitationsResend,
  claimInvite,
  dismissWelcomeTour,
  invitationLookup,
} from './worker/invitations.js';
import {
  adminOnCallArchive,
  adminOnCallCreate,
  adminOnCallList,
  adminSmsDispatchesList,
  dispatchEmergencyPage,
  handleTwilioStatusCallback,
} from './worker/on-call.js';
import {
  adminSubscriptionsCancel,
  adminSubscriptionsGet,
  adminSubscriptionsList,
  adminSubscriptionsPause,
  adminSubscriptionsResume,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleSubscriptionLifecycle,
} from './worker/stripe-subscriptions.js';
import { adminInvoicesList } from './worker/admin-invoices.js';
import {
  generatePublicToken,
  deriveTokenExpiry,
  isEmail,
  isE164,
  isUuid,
  lookupUserByEmail,
  srInsertReturning as barnSrInsertReturning,
  srInsertMany as barnSrInsertMany,
  srSelect as barnSrSelect,
  srPatchReturning as barnSrPatchReturning,
  srArchive as barnSrArchive,
  parseRruleMinimal,
  materializeRecurrenceDates,
  resolveAttendeeForCreate,
  logBarnNotification,
  publicEventUrl,
} from './worker/barn.js';
import {
  HERD_HEALTH_RECORD_TYPES,
  HERD_HEALTH_RECORD_TYPE_SET,
  HERD_HEALTH_DEFAULTS,
  isHerdHealthRecordType,
  listOrSeedThresholds,
  upsertThreshold,
  resetThresholdsToDefaults,
  computeHerdHealth,
  listOwnerAnimals as hhListOwnerAnimals,
  insertAcknowledgement as hhInsertAcknowledgement,
  listAnimalVetRecords as hhListAnimalVetRecords,
  getOwnerAnimal as hhGetOwnerAnimal,
} from './worker/herd-health.js';
import {
  CARE_MATRIX_COLUMNS,
  getOwnerRanch as fmGetOwnerRanch,
  listOwnerRanches as fmListOwnerRanches,
  insertRanch as fmInsertRanch,
  readFacilityMap as fmReadFacilityMap,
  getOwnerStall as fmGetOwnerStall,
  getOwnerTurnoutGroup as fmGetOwnerTurnoutGroup,
  insertStall as fmInsertStall,
  patchStall as fmPatchStall,
  archiveStall as fmArchiveStall,
  assignStall as fmAssignStall,
  insertTurnoutGroup as fmInsertTurnoutGroup,
  patchTurnoutGroup as fmPatchTurnoutGroup,
  archiveTurnoutGroup as fmArchiveTurnoutGroup,
  addTurnoutMembers as fmAddTurnoutMembers,
  removeTurnoutMember as fmRemoveTurnoutMember,
  listCareMatrix as fmListCareMatrix,
  batchUpsertCareMatrix as fmBatchUpsertCareMatrix,
} from './worker/facility.js';
import {
  EXPENSE_CATEGORIES,
  DISPOSITION_VALUES,
  listOwnerExpensesForYear as spListExpensesYear,
  listOwnerAnimalRanchMap as spListRanchMap,
  listOwnerAnimalsWithBasis as spListAnimalsBasis,
  getOwnerAnimalBasis as spGetAnimalBasis,
  sumAnimalSpend as spSumAnimalSpend,
  patchAnimalBasis as spPatchAnimalBasis,
} from './worker/spending.js';
import {
  isStripePlatformConfigured,
  getSubscriptionForOwner,
  insertSubscriptionRow,
  patchSubscription,
  listEntitlementEvents,
  insertEntitlementEvent,
  countOwnerHorses,
  ownerHasBarnMode,
  getSilverLiningLinkForOwner,
  getActiveLinkByCustomerId,
  getAnyLinkByCustomerId,
  insertSilverLiningLink,
  patchSilverLiningLink,
  findPromoByCode,
  markPromoRedeemed,
  listPromoCodes,
  insertPromoCodesBulk,
  archivePromoCode,
  unarchivePromoCode,
  generatePromoCode,
  ensurePlatformStripeCustomer,
  createBarnModeCheckoutSession,
  createBillingPortalSession,
  handleBarnModeCheckoutCompleted,
  isTrainerProConfigured,
  getSubscriptionForTrainer,
  countTrainerDistinctHorses,
  trainerHasPro,
  createTrainerProCheckoutSession,
  ensurePlatformTrainerStripeCustomer,
} from './worker/subscription.js';
import { sendEmail as sendResendEmail, isResendConfigured } from './worker/resend.js';

// Phase 6.3 — Durable Object rate limiter. Class MUST be re-exported
// from the Worker entry so `[[durable_objects.bindings]]` can resolve
// it by name. env.RATE_LIMITER is the DO namespace binding.
export { RateLimiter } from './worker/durable-objects/rate-limiter.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/webhook/sheets') {
        return handleSheetsWebhook(request, env);
      }
      if (url.pathname === '/api/flags') {
        return handleFlags(request, env);
      }
      if (url.pathname === '/api/has-pin') {
        return handleHasPin(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/admin/')) {
        return handleAdmin(request, env, url);
      }
      if (url.pathname === '/api/uploads/sign') {
        return handleUploadSign(request, env);
      }
      if (url.pathname === '/api/uploads/commit') {
        return handleUploadCommit(request, env);
      }
      if (url.pathname === '/api/uploads/read-url') {
        return handleUploadReadUrl(request, env, url);
      }
      if (url.pathname === '/api/animals/archive') {
        return handleAnimalArchive(request, env);
      }
      if (url.pathname === '/api/animals/unarchive') {
        return handleAnimalUnarchive(request, env);
      }
      if (url.pathname === '/api/sessions/archive') {
        return handleSessionArchive(request, env);
      }
      if (url.pathname === '/api/expenses/archive') {
        return handleExpenseArchive(request, env);
      }
      if (url.pathname === '/api/sessions/approve') {
        return handleSessionApprove(request, env);
      }
      if (url.pathname === '/api/stripe/sessions/pay') {
        return handleSessionPay(request, env);
      }
      if (url.pathname === '/api/stripe/webhook') {
        return handleStripeWebhook(request, env);
      }
      if (url.pathname === '/api/stripe/sweep/process') {
        return handleStripeSweepProcess(request, env);
      }
      if (url.pathname === '/api/invoices/finalize') {
        return handleInvoiceFinalize(request, env);
      }
      if (url.pathname === '/api/invoices/send') {
        return handleInvoiceSend(request, env);
      }
      if (url.pathname === '/api/invoices/void') {
        return handleInvoiceVoid(request, env);
      }
      if (url.pathname === '/api/cron/run-once') {
        return handleCronRunOnce(request, env);
      }
      if (url.pathname === '/api/trainer/branding/sync') {
        return handleTrainerBrandingSync(request, env);
      }
      if (url.pathname === '/api/records/export-pdf') {
        return handleRecordsExport(request, env);
      }
      if (url.pathname === '/api/access/grant') {
        return handleAccessGrant(request, env);
      }
      if (url.pathname === '/api/access/revoke') {
        return handleAccessRevoke(request, env);
      }
      // --- Phase 8 Barn Mode — Module 01 (calendar + contacts) ---
      if (url.pathname === '/api/barn/pro-contacts') {
        if (request.method === 'GET')  return handleProContactsList(request, env, url);
        if (request.method === 'POST') return handleProContactCreate(request, env, ctx);
        return new Response('method not allowed', { status: 405 });
      }
      if (url.pathname.startsWith('/api/barn/pro-contacts/')) {
        const rest = url.pathname.slice('/api/barn/pro-contacts/'.length);
        const [id, action] = rest.split('/');
        if (!isUuid(id)) return json({ error: 'bad_id' }, 400);
        if (!action && request.method === 'PATCH') {
          return handleProContactUpdate(request, env, id, ctx);
        }
        if (action === 'archive' && request.method === 'POST') {
          return handleProContactArchive(request, env, id, ctx);
        }
        return new Response('not found', { status: 404 });
      }
      if (url.pathname === '/api/barn/events') {
        if (request.method === 'GET')  return handleBarnEventsList(request, env, url);
        if (request.method === 'POST') return handleBarnEventCreate(request, env, ctx);
        return new Response('method not allowed', { status: 405 });
      }
      if (url.pathname.startsWith('/api/barn/events/')) {
        const rest = url.pathname.slice('/api/barn/events/'.length);
        const [id, action] = rest.split('/');
        if (!isUuid(id)) return json({ error: 'bad_id' }, 400);
        if (!action) {
          if (request.method === 'GET')   return handleBarnEventGet(request, env, id);
          if (request.method === 'PATCH') return handleBarnEventUpdate(request, env, id, ctx);
          return new Response('method not allowed', { status: 405 });
        }
        if (action === 'cancel'  && request.method === 'POST') return handleBarnEventCancel(request, env, id, ctx);
        if (action === 'archive' && request.method === 'POST') return handleBarnEventArchive(request, env, id, ctx);
        if (action === 'respond' && request.method === 'POST') return handleBarnEventRespond(request, env, id, ctx);
        return new Response('not found', { status: 404 });
      }
      if (url.pathname.startsWith('/api/public/events/')) {
        const rest = url.pathname.slice('/api/public/events/'.length);
        const [token, action] = rest.split('/');
        if (!token || token.length < 10) return json({ error: 'bad_token' }, 400);
        if (!action && request.method === 'GET') return handlePublicEventGet(request, env, token);
        if (action === 'respond' && request.method === 'POST') return handlePublicEventRespond(request, env, token, ctx);
        if (action === 'revoke'  && request.method === 'POST') return handlePublicEventRevoke(request, env, token, ctx);
        return new Response('not found', { status: 404 });
      }
      if (url.pathname === '/api/_internal/barn-reminders-tick' && request.method === 'POST') {
        return handleBarnRemindersTick(request, env, ctx);
      }
      if (url.pathname === '/api/_internal/barn-materialize-recurrences' && request.method === 'POST') {
        return handleBarnMaterializeRecurrences(request, env, ctx);
      }
      if (url.pathname === '/api/_internal/pro-claim-email' && request.method === 'POST') {
        return handleBarnProClaimEmail(request, env, ctx);
      }
      // --- Phase 8 Barn Mode — Module 02 (herd health dashboard) ---
      if (url.pathname === '/api/barn/herd-health' && request.method === 'GET') {
        return handleHerdHealthGet(request, env, ctx);
      }
      if (url.pathname === '/api/barn/herd-health/thresholds' && request.method === 'PATCH') {
        return handleHerdHealthThresholdsPatch(request, env, ctx);
      }
      if (url.pathname === '/api/barn/herd-health/thresholds/reset' && request.method === 'POST') {
        return handleHerdHealthThresholdsReset(request, env, ctx);
      }
      if (url.pathname === '/api/barn/herd-health/acknowledge' && request.method === 'POST') {
        return handleHerdHealthAcknowledge(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/barn/herd-health/animals/') && request.method === 'GET') {
        const id = url.pathname.slice('/api/barn/herd-health/animals/'.length);
        if (!isUuid(id)) return json({ error: 'bad_id' }, 400);
        return handleHerdHealthAnimalDetail(request, env, id, ctx);
      }
      if (url.pathname === '/api/barn/herd-health/report.pdf' && request.method === 'POST') {
        return handleHerdHealthReportPdf(request, env, ctx);
      }
      // --- Phase 8 Barn Mode — Module 03 (facility map + care matrix) ---
      if (url.pathname === '/api/barn/facility/ranches' && request.method === 'GET') {
        return handleFacilityRanches(request, env, ctx);
      }
      if (url.pathname === '/api/barn/facility/ranches' && request.method === 'POST') {
        return handleFacilityRanchCreate(request, env, ctx);
      }
      if (url.pathname === '/api/barn/facility/map' && request.method === 'GET') {
        return handleFacilityMap(request, env, url, ctx);
      }
      if (url.pathname === '/api/barn/facility/stalls' && request.method === 'POST') {
        return handleStallCreate(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/barn/facility/stalls/')) {
        const rest = url.pathname.slice('/api/barn/facility/stalls/'.length);
        const [stallId, action] = rest.split('/');
        if (!isUuid(stallId)) return json({ error: 'bad_id' }, 400);
        if (!action && request.method === 'PATCH') {
          return handleStallPatch(request, env, stallId, ctx);
        }
        if (action === 'archive' && request.method === 'POST') {
          return handleStallArchive(request, env, stallId, ctx);
        }
        if (action === 'assign' && request.method === 'POST') {
          return handleStallAssign(request, env, stallId, ctx);
        }
      }
      if (url.pathname === '/api/barn/facility/turnout-groups' && request.method === 'POST') {
        return handleTurnoutGroupCreate(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/barn/facility/turnout-groups/')) {
        const rest = url.pathname.slice('/api/barn/facility/turnout-groups/'.length);
        const parts = rest.split('/');
        const groupId = parts[0];
        if (!isUuid(groupId)) return json({ error: 'bad_id' }, 400);
        if (parts.length === 1 && request.method === 'PATCH') {
          return handleTurnoutGroupPatch(request, env, groupId, ctx);
        }
        if (parts[1] === 'archive' && request.method === 'POST') {
          return handleTurnoutGroupArchive(request, env, groupId, ctx);
        }
        if (parts[1] === 'members' && parts.length === 2 && request.method === 'POST') {
          return handleTurnoutGroupMembersAdd(request, env, groupId, ctx);
        }
        if (parts[1] === 'members' && parts.length === 3 && request.method === 'DELETE') {
          const animalId = parts[2];
          if (!isUuid(animalId)) return json({ error: 'bad_id' }, 400);
          return handleTurnoutGroupMemberRemove(request, env, groupId, animalId, ctx);
        }
      }
      if (url.pathname === '/api/barn/facility/care-matrix' && request.method === 'GET') {
        return handleCareMatrixGet(request, env, url, ctx);
      }
      if (url.pathname === '/api/barn/facility/care-matrix' && request.method === 'POST') {
        return handleCareMatrixBatchUpsert(request, env, ctx);
      }
      if (url.pathname === '/api/barn/facility/print.pdf' && request.method === 'POST') {
        return handleFacilityPrintPdf(request, env, ctx);
      }
      // --- Phase 8 Barn Mode — Module 04 (barn spending) ---
      if (url.pathname === '/api/barn/spending' && request.method === 'GET') {
        return handleSpendingGet(request, env, url, ctx);
      }
      if (url.pathname === '/api/barn/spending/export.csv' && request.method === 'GET') {
        return handleSpendingCsv(request, env, url, ctx);
      }
      if (url.pathname === '/api/barn/spending/export.pdf' && request.method === 'GET') {
        return handleSpendingPdf(request, env, url, ctx);
      }
      if (url.pathname.startsWith('/api/barn/spending/animals/')) {
        const rest = url.pathname.slice('/api/barn/spending/animals/'.length);
        const [animalId, leaf] = rest.split('/');
        if (!isUuid(animalId)) return json({ error: 'bad_id' }, 400);
        if (leaf === 'cost-basis' && request.method === 'GET') {
          return handleAnimalCostBasisGet(request, env, animalId, ctx);
        }
        if (leaf === 'cost-basis' && request.method === 'PATCH') {
          return handleAnimalCostBasisPatch(request, env, animalId, ctx);
        }
      }
      // --- Phase 8 Barn Mode — Module 05 (subscription + SL comp + promo) ---
      if (url.pathname === '/api/barn/subscription' && request.method === 'GET') {
        return handleSubscriptionGet(request, env, ctx);
      }
      if (url.pathname === '/api/barn/subscription/checkout' && request.method === 'POST') {
        return handleSubscriptionCheckout(request, env, ctx);
      }
      if (url.pathname === '/api/barn/subscription/portal' && request.method === 'POST') {
        return handleSubscriptionPortal(request, env, ctx);
      }
      // --- Phase 9 — Trainer Pro subscription ---
      if (url.pathname === '/api/trainer/subscription' && request.method === 'GET') {
        return handleTrainerSubscriptionGet(request, env, ctx);
      }
      if (url.pathname === '/api/trainer/subscription/checkout' && request.method === 'POST') {
        return handleTrainerSubscriptionCheckout(request, env, ctx);
      }
      if (url.pathname === '/api/trainer/subscription/portal' && request.method === 'POST') {
        return handleTrainerSubscriptionPortal(request, env, ctx);
      }
      if (url.pathname === '/api/barn/promo-codes/redeem' && request.method === 'POST') {
        return handlePromoRedeem(request, env, ctx);
      }
      if (url.pathname === '/api/barn/silver-lining/link' && request.method === 'POST') {
        return handleSilverLiningLink(request, env, ctx);
      }
      if (url.pathname === '/api/barn/silver-lining/link/confirm' && request.method === 'POST') {
        return handleSilverLiningLinkConfirm(request, env, ctx);
      }
      if (url.pathname === '/api/barn/silver-lining/status' && request.method === 'GET') {
        return handleSilverLiningStatus(request, env, ctx);
      }
      if (url.pathname === '/api/barn/silver-lining/unlink' && request.method === 'POST') {
        return handleSilverLiningUnlink(request, env, ctx);
      }
      if (url.pathname === '/api/_internal/silver-lining-verify-tick' && request.method === 'POST') {
        return handleSilverLiningVerifyTick(request, env, ctx);
      }
      if (url.pathname === '/api/admin/promo-codes' && request.method === 'GET') {
        return handleAdminPromoCodesList(request, env, url, ctx);
      }
      if (url.pathname === '/api/admin/promo-codes' && request.method === 'POST') {
        return handleAdminPromoCodesCreate(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/admin/promo-codes/') && request.method === 'POST') {
        const rest = url.pathname.slice('/api/admin/promo-codes/'.length);
        const m = rest.match(/^([0-9a-f-]{36})\/(archive|unarchive)$/i);
        if (m) {
          return handleAdminPromoCodeArchiveToggle(request, env, ctx, m[1], m[2] === 'archive');
        }
      }
      if (url.pathname === '/api/stripe/connect/onboard') {
        return handleStripeConnectOnboard(request, env, url);
      }
      if (url.pathname === '/api/stripe/connect/refresh') {
        return handleStripeConnectRefresh(request, env);
      }
      if (url.pathname === '/api/stripe/connect/return') {
        return handleStripeConnectReturn(request, env, url);
      }
      if (url.pathname === '/api/shop/products') {
        return handleShopProductsList(request, env);
      }
      if (url.pathname.startsWith('/api/shop/products/')) {
        const handle = url.pathname.slice('/api/shop/products/'.length);
        return handleShopProductByHandle(request, env, handle);
      }
      if (url.pathname === '/api/_internal/shop/cache-invalidate') {
        return handleShopCacheInvalidate(request, env);
      }
      if (url.pathname === '/api/shop/checkout') {
        return handleShopCheckout(request, env, url);
      }
      if (url.pathname === '/api/orders') {
        return handleOrdersList(request, env);
      }
      if (url.pathname.startsWith('/api/orders/')) {
        const rest = url.pathname.slice('/api/orders/'.length);
        if (rest && !rest.includes('/')) {
          return handleOrderGet(request, env, rest);
        }
      }
      if (url.pathname === '/api/_internal/hubspot-drain') {
        return handleHubspotDrain(request, env);
      }
      if (url.pathname === '/api/ai/embed') {
        return handleAiEmbed(request, env);
      }
      if (url.pathname === '/api/protocols/embed-index') {
        return handleProtocolEmbedIndex(request, env);
      }
      if (url.pathname === '/api/chat') {
        return handleChat(request, env, ctx);
      }
      if (url.pathname === '/api/support-tickets') {
        return handleSupportTicketCreate(request, env, ctx);
      }
      if (url.pathname === '/webhooks/twilio-status') {
        return handleTwilioStatusCallback(request, env);
      }
      if (url.pathname === '/api/vet-share-tokens') {
        if (request.method === 'POST') return handleVetShareCreate(request, env, ctx);
        if (request.method === 'GET')  return handleVetShareList(request, env, url);
        return new Response('method not allowed', { status: 405 });
      }
      if (url.pathname.startsWith('/api/vet-share-tokens/')) {
        const rest = url.pathname.slice('/api/vet-share-tokens/'.length);
        const m = /^([0-9a-f-]{36})\/revoke$/i.exec(rest);
        if (m) return handleVetShareRevoke(request, env, m[1], ctx);
      }
      if (url.pathname.startsWith('/api/vet/')) {
        const token = url.pathname.slice('/api/vet/'.length);
        if (token && !token.includes('/')) {
          return handleVetTokenGet(request, env, token, ctx);
        }
      }
      if (url.pathname === '/api/invitations/lookup' && request.method === 'GET') {
        return invitationLookup(env, url);
      }
      if (url.pathname === '/api/auth/claim-invite' && request.method === 'POST') {
        return handleClaimInvite(request, env);
      }
      if (url.pathname === '/api/profiles/dismiss-welcome-tour' && request.method === 'POST') {
        return handleDismissWelcomeTour(request, env);
      }
      if (url.pathname === '/api/_integrations-health') {
        return handleIntegrationsHealth(request, env);
      }
      if (url.pathname === '/healthz') {
        return new Response('ok', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      if (url.pathname === '/join') {
        // Legacy waitlist retired in Phase 0 hardening. SPA /signup renders
        // the v1 form when feature:signup_v2 = false.
        return Response.redirect(new URL('/signup', url).toString(), 301);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: 'Server error', detail: err?.message ?? 'unknown' }, 500);
    }
  },

  /**
   * Cloudflare Cron Trigger entry — fires on the schedule(s) declared
   * in wrangler.toml [[triggers]].
   *
   * KILL SWITCH: Reads feature flag `cron:enabled` from env.FLAGS KV.
   * If the value is anything other than "true" (including missing), the
   * handler returns immediately. Default is OFF until launch.
   *
   * Flip:
   *   npx wrangler kv key put --binding=FLAGS cron:enabled true  --remote
   *   npx wrangler kv key put --binding=FLAGS cron:enabled false --remote
   *   npx wrangler kv key delete --binding=FLAGS cron:enabled    --remote
   *
   * Per-job flags (`cron:auto_finalize`, `cron:recurring`) let us
   * enable jobs individually during smoke tests — if the master flag
   * is on and a per-job flag is explicitly "false", that job no-ops.
   */
  async scheduled(event, env, ctx) {
    const master = await env.FLAGS.get('cron:enabled');
    if (master !== 'true') {
      console.log('[cron] master kill switch off — skipping', event.cron);
      return;
    }
    ctx.waitUntil(runScheduledJobs(env, { cron: event.cron, scheduledTime: event.scheduledTime }));
  },
};

async function runScheduledJobs(env, meta) {
  const started = Date.now();
  const results = {};

  const recurringOn = (await env.FLAGS.get('cron:recurring')) !== 'false';
  if (recurringOn) {
    try {
      results.recurring = await materializeRecurringItems(env);
    } catch (err) {
      console.error('[cron] materializeRecurringItems failed', err);
      results.recurring = { ok: false, error: String(err?.message ?? err) };
    }
  } else {
    results.recurring = { ok: true, skipped: true };
  }

  const autoFinalizeOn = (await env.FLAGS.get('cron:auto_finalize')) !== 'false';
  if (autoFinalizeOn) {
    try {
      results.auto_finalize = await autoFinalizeDueDrafts(env);
    } catch (err) {
      console.error('[cron] autoFinalizeDueDrafts failed', err);
      results.auto_finalize = { ok: false, error: String(err?.message ?? err) };
    }
  } else {
    results.auto_finalize = { ok: true, skipped: true };
  }

  console.log('[cron] ran', meta.cron, 'in', Date.now() - started, 'ms', JSON.stringify(results));
  return results;
}

/* =============================================================
   Crypto / request helpers
   ============================================================= */

/**
 * Constant-time string compare. Returns false fast on length mismatch
 * (length is not a secret), then XORs every byte so timing is a
 * function of input length alone, not matching-prefix length.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// Phase 6.3 — the legacy FLAGS-backed rateLimit() used by /api/has-pin
// has been folded into the unified rateLimit() dispatcher further down
// (see rateLimit / rateLimitDO / rateLimitKv). The DO path now handles
// every rate-limited endpoint, including has-pin, so scripted enumeration
// from a single IP hits a deterministic 429 instead of a best-effort cap.

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/* =============================================================
   Supabase REST helpers (used by /api/has-pin and /api/admin/*)
   ============================================================= */

async function supabaseRpc(env, fnName, body, { serviceRole = false, userJwt = null } = {}) {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : (userJwt ?? env.SUPABASE_ANON_KEY);
  if (!key) throw new Error('Supabase key missing for request');

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseSelect(env, table, query, { serviceRole = false, userJwt = null } = {}) {
  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : (userJwt ?? env.SUPABASE_ANON_KEY);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: {
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseInsert(env, table, row, { serviceRole = true } = {}) {
  const key = serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status };
}

/* =============================================================
   /api/has-pin  — replaces the anon-callable check_has_pin() RPC
   -------------------------------------------------------------
   Shape:
     POST /api/has-pin  { "email": "user@example.com" }
     → 200 { "has_pin": true|false }
     → 429 { "error": "rate_limited", "retry_after": <seconds> }
   Rate: 10 req / 60s per IP (see RATE).
   ============================================================= */
const HAS_PIN_RATE = { limit: 10, windowSec: 60 };

async function handleHasPin(request, env /* ctx */) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    // If the service role secret isn't set, we never want to silently
    // fall back to the old anon-callable path.
    return json({ error: 'not_configured' }, 500);
  }

  const ip = clientIp(request);
  const rl = await rateLimit(env, `ratelimit:haspin:${ip}`, HAS_PIN_RATE);
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  // We deliberately do NOT validate email format here. The RPC returns
  // `false` for any input that isn't a real row, which is the same
  // response an enumeration attacker would get for a miss. Returning
  // 400 for malformed input would leak that distinction.
  if (!email) {
    return json({ has_pin: false });
  }

  const { ok, data } = await supabaseRpc(env, 'check_has_pin', { p_email: email }, { serviceRole: true });
  if (!ok) {
    return json({ has_pin: false }, 200);
  }
  // RPC returns a literal boolean.
  return json({ has_pin: data === true });
}

/* =============================================================
   /api/admin/*  — service_role admin surface (B2)
   -------------------------------------------------------------
   Every endpoint:
     1. Verifies the caller's Supabase session JWT.
     2. Confirms user_profiles.role = 'silver_lining' AND status = 'active'.
     3. Performs the privileged read via service_role.
     4. Writes an audit_log row (best-effort — failure does not abort
        the response, but is logged).
   ============================================================= */

async function handleAdmin(request, env, url) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 1. Resolve the caller by asking Supabase who this JWT belongs to.
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!who.ok) {
    return json({ error: 'unauthorized' }, 401);
  }
  const whoData = await who.json().catch(() => null);
  const actorId = whoData?.id;
  if (!actorId) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 2. Confirm silver_lining + active.
  const profileRes = await supabaseSelect(
    env,
    'user_profiles',
    `select=role,status&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const profile = Array.isArray(profileRes.data) ? profileRes.data[0] : null;
  if (!profile || profile.role !== 'silver_lining' || profile.status !== 'active') {
    return json({ error: 'forbidden' }, 403);
  }

  // 3. Dispatch.
  const tail = url.pathname.slice('/api/admin/'.length);
  let response;
  let action;
  let targetTable = null;
  let metadata = null;

  if (tail === 'ping' && request.method === 'GET') {
    action = 'admin.ping';
    response = json({ ok: true });
  } else if (tail === 'kpis' && request.method === 'GET') {
    action = 'admin.kpis.read';
    const r = await supabaseRpc(env, 'admin_kpi_snapshot', {}, { serviceRole: true });
    if (!r.ok) {
      response = json({ error: 'kpi_snapshot_failed' }, 500);
      metadata = { ok: false, status: r.status };
    } else {
      response = json({ kpis: r.data });
      metadata = { ok: true };
    }
  } else if (tail === 'fees' && request.method === 'GET') {
    action = 'admin.read.platform_fees';
    targetTable = 'platform_settings';
    response = await adminFeesGet(env);
  } else if (tail === 'fees/default' && request.method === 'POST') {
    action = 'admin.update.platform_fees_default';
    targetTable = 'platform_settings';
    response = await adminFeesSetDefault(request, env, actorId);
  } else if (tail === 'fees/trainer' && request.method === 'POST') {
    action = 'admin.update.platform_fees_trainer_override';
    targetTable = 'stripe_connect_accounts';
    response = await adminFeesSetTrainerOverride(request, env, actorId);
  } else if (tail === 'invitations' && request.method === 'GET') {
    action = 'admin.read.invitations';
    targetTable = 'invitations';
    response = await adminInvitationsList(env, url);
    metadata = { status: (url.searchParams.get('status') || '').trim() || 'all' };
  } else if (tail === 'invitations' && request.method === 'POST') {
    action = 'admin.invitation.create';
    targetTable = 'invitations';
    response = await adminInvitationsCreate(env, request, actorId);
  } else if (tail === 'invitations/bulk' && request.method === 'POST') {
    action = 'admin.invitation.bulk_create';
    targetTable = 'invitations';
    response = await adminInvitationsBulk(env, request, actorId);
  } else if (
    request.method === 'POST' &&
    tail.startsWith('invitations/') &&
    (tail.endsWith('/resend') || tail.endsWith('/archive'))
  ) {
    const m = tail.match(/^invitations\/([^/]+)\/(resend|archive)$/);
    if (!m) {
      return json({ error: 'not_found' }, 404);
    }
    const id = m[1];
    const verb = m[2];
    action = verb === 'resend' ? 'admin.invitation.resend' : 'admin.invitation.archive';
    targetTable = 'invitations';
    metadata = { id };
    response = verb === 'resend'
      ? await adminInvitationsResend(env, request, actorId, id)
      : await adminInvitationsArchive(env, actorId, id);
  } else if (tail === 'on-call' && request.method === 'GET') {
    action = 'admin.read.on_call_schedule';
    targetTable = 'on_call_schedule';
    response = await adminOnCallList(env, url);
  } else if (tail === 'on-call' && request.method === 'POST') {
    action = 'admin.on_call.create';
    targetTable = 'on_call_schedule';
    response = await adminOnCallCreate(env, request, actorId);
  } else if (
    request.method === 'POST' &&
    tail.startsWith('on-call/') &&
    tail.endsWith('/archive')
  ) {
    const m = tail.match(/^on-call\/([^/]+)\/archive$/);
    if (!m) return json({ error: 'not_found' }, 404);
    action = 'admin.on_call.archive';
    targetTable = 'on_call_schedule';
    metadata = { id: m[1] };
    response = await adminOnCallArchive(env, actorId, m[1]);
  } else if (tail === 'sms-dispatches' && request.method === 'GET') {
    action = 'admin.read.sms_dispatches';
    targetTable = 'sms_dispatches';
    response = await adminSmsDispatchesList(env, url);
    metadata = {
      ticket_id: (url.searchParams.get('ticket_id') || '').trim() || null,
      status:    (url.searchParams.get('status') || '').trim() || null,
    };
  } else if (tail === 'invoices' && request.method === 'GET') {
    action = 'admin.read.invoices';
    targetTable = 'invoices';
    response = await adminInvoicesList(env, url);
    metadata = { status: (url.searchParams.get('status') || '').trim() || 'all' };
  } else if (tail === 'subscriptions' && request.method === 'GET') {
    action = 'admin.read.subscriptions';
    targetTable = 'stripe_subscriptions';
    response = await adminSubscriptionsList(env, url);
    metadata = { status: (url.searchParams.get('status') || '').trim() || 'all' };
  } else if (
    request.method === 'GET' &&
    tail.startsWith('subscriptions/') &&
    !tail.endsWith('/cancel') &&
    !tail.endsWith('/pause') &&
    !tail.endsWith('/resume')
  ) {
    const m = tail.match(/^subscriptions\/([A-Za-z0-9_]+)$/);
    if (!m) return json({ error: 'not_found' }, 404);
    action = 'admin.read.subscription';
    targetTable = 'stripe_subscriptions';
    metadata = { id: m[1] };
    response = await adminSubscriptionsGet(env, m[1]);
  } else if (
    request.method === 'POST' &&
    tail.startsWith('subscriptions/') &&
    (tail.endsWith('/cancel') || tail.endsWith('/pause') || tail.endsWith('/resume'))
  ) {
    const m = tail.match(/^subscriptions\/([A-Za-z0-9_]+)\/(cancel|pause|resume)$/);
    if (!m) return json({ error: 'not_found' }, 404);
    const [, subId, verb] = m;
    action = `admin.subscription.${verb}`;
    targetTable = 'stripe_subscriptions';
    metadata = { id: subId };
    if (verb === 'cancel')      response = await adminSubscriptionsCancel(env, request, actorId, subId);
    else if (verb === 'pause')  response = await adminSubscriptionsPause(env, request, actorId, subId);
    else                        response = await adminSubscriptionsResume(env, request, actorId, subId);
  } else if (tail === 'trainer-applications' && request.method === 'GET') {
    action = 'admin.read.trainer_applications';
    targetTable = 'trainer_applications';
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const parts = [
      'select=id,user_id,submitted_at,status,application',
      'order=submitted_at.desc',
      'limit=200',
    ];
    if (['submitted', 'approved', 'rejected', 'withdrawn', 'archived'].includes(statusFilter)) {
      parts.push(`status=eq.${statusFilter}`);
    }
    const apps = await supabaseSelect(env, 'trainer_applications', parts.join('&'), { serviceRole: true });
    const appRows = apps.ok && Array.isArray(apps.data) ? apps.data : [];
    let rows = [];
    if (appRows.length) {
      const ids = [...new Set(appRows.map((a) => a.user_id))];
      const inList = ids.map((i) => `"${i}"`).join(',');
      const [usersRes, profilesRes] = await Promise.all([
        supabaseSelect(
          env,
          'user_profiles',
          `select=user_id,email,display_name,status&user_id=in.(${inList})`,
          { serviceRole: true }
        ),
        supabaseSelect(
          env,
          'trainer_profiles',
          `select=user_id,application_status,reviewed_by,reviewed_at,review_notes&user_id=in.(${inList})`,
          { serviceRole: true }
        ),
      ]);
      const userMap = new Map(
        (usersRes.ok && Array.isArray(usersRes.data) ? usersRes.data : []).map((u) => [u.user_id, u])
      );
      const profMap = new Map(
        (profilesRes.ok && Array.isArray(profilesRes.data) ? profilesRes.data : []).map((p) => [p.user_id, p])
      );
      rows = appRows.map((a) => {
        const u = userMap.get(a.user_id) || {};
        const p = profMap.get(a.user_id) || {};
        return {
          id: a.id,
          user_id: a.user_id,
          submitted_at: a.submitted_at,
          status: a.status,
          application: a.application,
          email: u.email || null,
          display_name: u.display_name || null,
          user_status: u.status || null,
          application_status: p.application_status || null,
          reviewed_by: p.reviewed_by || null,
          reviewed_at: p.reviewed_at || null,
          review_notes: p.review_notes || null,
        };
      });
    }
    response = json({ rows });
    metadata = { status: statusFilter || null, rows: rows.length };
  } else if (
    request.method === 'POST' &&
    (tail.endsWith('/approve') || tail.endsWith('/reject')) &&
    tail.startsWith('trainer-applications/')
  ) {
    const match = tail.match(/^trainer-applications\/([^/]+)\/(approve|reject)$/);
    if (!match) {
      return json({ error: 'not_found' }, 404);
    }
    const id = match[1];
    const decision = match[2] === 'approve' ? 'approved' : 'rejected';
    action = decision === 'approved' ? 'admin.trainer.approve' : 'admin.trainer.reject';
    targetTable = 'trainer_applications';
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const reviewNotes = typeof body?.review_notes === 'string' && body.review_notes.trim()
      ? body.review_notes.trim().slice(0, 2000)
      : null;
    const r = await supabaseRpc(
      env,
      'admin_decide_trainer',
      { app_id: id, decision, reviewer: actorId, p_review_notes: reviewNotes },
      { serviceRole: true }
    );
    if (!r.ok) {
      const errText = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      if (/app_not_found/.test(errText)) {
        response = json({ error: 'not_found' }, 404);
      } else if (/bad_decision/.test(errText)) {
        response = json({ error: 'bad_decision' }, 400);
      } else {
        response = json({ error: 'decision_failed' }, 500);
      }
      metadata = { ok: false, decision, app_id: id, status: r.status };
    } else {
      const decisionPayload = r.data || {};
      // Enqueue HubSpot sync (best-effort; drained by 5.6 cron)
      try {
        await supabaseInsert(env, 'pending_hubspot_syncs', {
          event_name: 'maneline_trainer_decision',
          payload: {
            application_id: id,
            user_id: decisionPayload.user_id,
            email: decisionPayload.email,
            display_name: decisionPayload.display_name,
            decision: decisionPayload.decision,
            review_notes: decisionPayload.review_notes,
            decided_by: actorId,
            decided_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.warn('[hubspot] enqueue failed:', err?.message);
      }
      response = json({ application: decisionPayload });
      metadata = {
        ok: true,
        decision,
        app_id: id,
        user_id: decisionPayload.user_id,
        has_notes: !!reviewNotes,
      };
    }
  } else if (
    request.method === 'POST' &&
    (tail.endsWith('/revoke') || tail.endsWith('/ban')) &&
    tail.startsWith('trainer-applications/')
  ) {
    // Companion to approve/reject above, but for already-approved
    // trainers. Notes are required (RPC raises bad_notes otherwise);
    // we surface that as a 400 so the SPA can keep the dialog open.
    const match = tail.match(/^trainer-applications\/([^/]+)\/(revoke|ban)$/);
    if (!match) {
      return json({ error: 'not_found' }, 404);
    }
    const id = match[1];
    const actionKind = match[2]; // 'revoke' | 'ban'
    action = actionKind === 'revoke' ? 'admin.trainer.revoke' : 'admin.trainer.ban';
    targetTable = 'trainer_applications';
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const reviewNotes = typeof body?.review_notes === 'string' && body.review_notes.trim()
      ? body.review_notes.trim().slice(0, 2000)
      : null;
    if (!reviewNotes) {
      return json({ error: 'bad_notes', message: 'Notes are required to revoke or ban a trainer.' }, 400);
    }
    const r = await supabaseRpc(
      env,
      'admin_revoke_or_ban_trainer',
      { app_id: id, action_kind: actionKind, reviewer: actorId, p_review_notes: reviewNotes },
      { serviceRole: true }
    );
    if (!r.ok) {
      const errText = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      if (/app_not_found/.test(errText)) {
        response = json({ error: 'not_found' }, 404);
      } else if (/bad_action/.test(errText)) {
        response = json({ error: 'bad_action' }, 400);
      } else if (/bad_notes/.test(errText)) {
        response = json({ error: 'bad_notes' }, 400);
      } else {
        response = json({ error: 'decision_failed' }, 500);
      }
      metadata = { ok: false, action_kind: actionKind, app_id: id, status: r.status };
    } else {
      const decisionPayload = r.data || {};
      // Mirror the approve/reject HubSpot enqueue so the marketing
      // pipeline sees access removals too. Best-effort, drained by
      // the existing 5.6 cron.
      try {
        await supabaseInsert(env, 'pending_hubspot_syncs', {
          event_name: 'maneline_trainer_decision',
          payload: {
            application_id: id,
            user_id: decisionPayload.user_id,
            email: decisionPayload.email,
            display_name: decisionPayload.display_name,
            decision: decisionPayload.decision,
            review_notes: decisionPayload.review_notes,
            decided_by: actorId,
            decided_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.warn('[hubspot] enqueue failed:', err?.message);
      }
      response = json({ application: decisionPayload });
      metadata = {
        ok: true,
        action_kind: actionKind,
        app_id: id,
        user_id: decisionPayload.user_id,
        has_notes: true,
      };
    }
  } else if (tail === 'support-tickets' && request.method === 'GET') {
    action = 'admin.read.support_tickets';
    targetTable = 'support_tickets';
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const parts = [
      'select=id,owner_id,contact_email,category,subject,body,status,assignee_id,first_response_at,resolved_at,archived_at,created_at,updated_at',
      'order=created_at.desc',
      'limit=200',
    ];
    if (['open', 'claimed', 'resolved', 'archived'].includes(statusFilter)) {
      parts.push(`status=eq.${statusFilter}`);
    } else {
      // Default queue view: hide archived.
      parts.push('archived_at=is.null');
    }
    const r = await supabaseSelect(env, 'support_tickets', parts.join('&'), { serviceRole: true });
    const tickets = r.ok && Array.isArray(r.data) ? r.data : [];
    // Hydrate owner_id + assignee_id → email + display_name via user_profiles.
    const ids = [...new Set(
      tickets.flatMap((t) => [t.owner_id, t.assignee_id]).filter(Boolean)
    )];
    let userMap = new Map();
    if (ids.length) {
      const inList = ids.map((i) => `"${i}"`).join(',');
      const usersRes = await supabaseSelect(
        env,
        'user_profiles',
        `select=user_id,email,display_name&user_id=in.(${inList})`,
        { serviceRole: true }
      );
      userMap = new Map(
        (usersRes.ok && Array.isArray(usersRes.data) ? usersRes.data : []).map((u) => [u.user_id, u])
      );
    }
    const rows = tickets.map((t) => ({
      ...t,
      owner_email: t.owner_id ? userMap.get(t.owner_id)?.email || null : null,
      owner_display_name: t.owner_id ? userMap.get(t.owner_id)?.display_name || null : null,
      assignee_email: t.assignee_id ? userMap.get(t.assignee_id)?.email || null : null,
      assignee_display_name: t.assignee_id ? userMap.get(t.assignee_id)?.display_name || null : null,
    }));
    response = json({ rows });
    metadata = { status: statusFilter || 'active', rows: rows.length };
  } else if (
    request.method === 'POST' &&
    tail.startsWith('support-tickets/') &&
    (tail.endsWith('/claim') || tail.endsWith('/resolve'))
  ) {
    const m = tail.match(/^support-tickets\/([^/]+)\/(claim|resolve)$/);
    if (!m) {
      return json({ error: 'not_found' }, 404);
    }
    const ticketId = m[1];
    const verb = m[2];
    action = verb === 'claim' ? 'admin.support.claim' : 'admin.support.resolve';
    targetTable = 'support_tickets';
    const now = new Date().toISOString();
    const patch = verb === 'claim'
      ? { status: 'claimed', assignee_id: actorId, first_response_at: now, updated_at: now }
      : { status: 'resolved', resolved_at: now, updated_at: now };
    const r = await supabaseUpdateReturning(
      env,
      'support_tickets',
      `id=eq.${encodeURIComponent(ticketId)}`,
      patch
    );
    if (!r.ok) {
      response = json({ error: 'update_failed' }, 500);
      metadata = { ok: false, ticket_id: ticketId, verb, status: r.status };
    } else if (!r.data) {
      response = json({ error: 'not_found' }, 404);
      metadata = { ok: false, ticket_id: ticketId, verb, reason: 'not_found' };
    } else {
      response = json({ ticket: r.data });
      metadata = { ok: true, ticket_id: ticketId, verb };
    }
  } else if (tail === 'shop/sync' && request.method === 'POST') {
    action = 'admin.shop.sync_trigger';
    targetTable = 'products';
    response = await adminShopSync(env);
  } else if (tail === 'users' && request.method === 'GET') {
    action = 'admin.user.search';
    targetTable = 'user_profiles';
    const q = (url.searchParams.get('q') || '').trim();
    const roleFilter = (url.searchParams.get('role') || '').trim();
    const page = Math.max(0, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0);
    const limit = 50;
    const offset = page * limit;
    const parts = ['select=user_id,role,status,display_name,email,created_at'];
    if (q) parts.push(`email=ilike.*${encodeURIComponent(q)}*`);
    if (roleFilter && ['owner', 'trainer', 'silver_lining'].includes(roleFilter)) {
      parts.push(`role=eq.${roleFilter}`);
    }
    parts.push('order=created_at.desc', `limit=${limit}`, `offset=${offset}`);
    const r = await adminCountedSelect(env, 'user_profiles', parts.join('&'));
    response = json({ rows: r.rows, total: r.total, page, limit });
    metadata = { q, role: roleFilter || null, page, rows: r.rows.length, total: r.total };
  } else if (tail === 'users.csv' && request.method === 'GET') {
    action = 'admin.user.export_csv';
    targetTable = 'user_profiles';
    const cap = 10000;
    const r = await supabaseSelect(
      env,
      'user_profiles',
      `select=user_id,role,status,display_name,email,created_at&order=created_at.desc&limit=${cap}`,
      { serviceRole: true }
    );
    const rows = r.ok && Array.isArray(r.data) ? r.data : [];
    const csv = toCsv(
      ['user_id', 'role', 'status', 'display_name', 'email', 'created_at'],
      rows
    );
    response = new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="users.csv"',
        'cache-control': 'no-store',
      },
    });
    metadata = { rows: rows.length, cap };
  } else if (tail === 'orders' && request.method === 'GET') {
    action = 'admin.read.orders';
    targetTable = 'orders';
    const q = (url.searchParams.get('q') || '').trim();
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const page = Math.max(0, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0);
    const limit = 50;
    const offset = page * limit;
    const parts = [
      'select=id,owner_id,status,source,subtotal_cents,tax_cents,shipping_cents,total_cents,currency,created_at',
      'order=created_at.desc',
      `limit=${limit}`,
      `offset=${offset}`,
    ];
    if (['pending_payment', 'paid', 'failed', 'refunded', 'awaiting_merchant_setup'].includes(statusFilter)) {
      parts.push(`status=eq.${statusFilter}`);
    }
    const listed = await adminCountedSelect(env, 'orders', parts.join('&'));
    let orderRows = listed.rows;
    // Email-scoped search: resolve email → owner_ids and filter.
    if (q) {
      const usersRes = await supabaseSelect(
        env,
        'user_profiles',
        `select=user_id,email,display_name&email=ilike.*${encodeURIComponent(q)}*&limit=200`,
        { serviceRole: true }
      );
      const ownerIds = new Set((usersRes.ok && Array.isArray(usersRes.data) ? usersRes.data : []).map((u) => u.user_id));
      orderRows = orderRows.filter((o) => ownerIds.has(o.owner_id));
    }
    // Hydrate owner_id → email / display_name.
    const ownerIds = [...new Set(orderRows.map((o) => o.owner_id).filter(Boolean))];
    let ownerMap = new Map();
    if (ownerIds.length) {
      const inList = ownerIds.map((i) => `"${i}"`).join(',');
      const ownersRes = await supabaseSelect(
        env,
        'user_profiles',
        `select=user_id,email,display_name&user_id=in.(${inList})`,
        { serviceRole: true }
      );
      ownerMap = new Map(
        (ownersRes.ok && Array.isArray(ownersRes.data) ? ownersRes.data : []).map((u) => [u.user_id, u])
      );
    }
    const hydrated = orderRows.map((o) => ({
      ...o,
      owner_email: ownerMap.get(o.owner_id)?.email || null,
      owner_display_name: ownerMap.get(o.owner_id)?.display_name || null,
    }));
    response = json({ rows: hydrated, total: listed.total, page, limit });
    metadata = { q: q || null, status: statusFilter || null, page, rows: hydrated.length, total: listed.total };
  } else if (request.method === 'GET' && /^orders\/[^/]+$/.test(tail)) {
    // GET /api/admin/orders/:id — detail
    const orderId = tail.slice('orders/'.length);
    action = 'admin.read.order';
    targetTable = 'orders';
    metadata = { order_id: orderId };
    const orderRes = await supabaseSelect(
      env,
      'orders',
      `select=id,owner_id,status,source,subtotal_cents,tax_cents,shipping_cents,total_cents,currency,created_at,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_receipt_url,failure_code,failure_message&id=eq.${encodeURIComponent(orderId)}&limit=1`,
      { serviceRole: true }
    );
    const order = Array.isArray(orderRes.data) ? orderRes.data[0] : null;
    if (!order) {
      response = json({ error: 'not_found' }, 404);
    } else {
      const [linesRes, refundsRes, ownerRes] = await Promise.all([
        supabaseSelect(
          env,
          'order_line_items',
          `select=id,product_id,shopify_variant_id,sku_snapshot,title_snapshot,unit_price_cents,quantity,line_total_cents&order_id=eq.${encodeURIComponent(orderId)}&order=created_at.asc`,
          { serviceRole: true }
        ),
        supabaseSelect(
          env,
          'order_refunds',
          `select=id,order_id,stripe_refund_id,amount_cents,reason,refunded_by,stripe_status,last_error,created_at,updated_at&order_id=eq.${encodeURIComponent(orderId)}&order=created_at.desc`,
          { serviceRole: true }
        ),
        supabaseSelect(
          env,
          'user_profiles',
          `select=user_id,email,display_name&user_id=eq.${encodeURIComponent(order.owner_id)}&limit=1`,
          { serviceRole: true }
        ),
      ]);
      const owner = Array.isArray(ownerRes.data) ? ownerRes.data[0] : null;
      response = json({
        order: {
          ...order,
          owner_email: owner?.email || null,
          owner_display_name: owner?.display_name || null,
        },
        line_items: Array.isArray(linesRes.data) ? linesRes.data : [],
        refunds: Array.isArray(refundsRes.data) ? refundsRes.data : [],
      });
    }
  } else if (tail.startsWith('orders/') && tail.endsWith('/refund') && request.method === 'POST') {
    const match = tail.match(/^orders\/([^/]+)\/refund$/);
    if (!match) {
      return json({ error: 'not_found' }, 404);
    }
    const orderId = match[1];
    action = 'admin.order.refund';
    targetTable = 'orders';
    response = await adminOrderRefund(request, env, actorId, orderId);
    metadata = { order_id: orderId, status: response.status };
  } else {
    return json({ error: 'not_found' }, 404);
  }

  // 4. Audit (best-effort; don't fail the request if the log write fails).
  try {
    await supabaseInsert(env, 'audit_log', {
      actor_id: actorId,
      actor_role: 'silver_lining',
      action,
      target_table: targetTable,
      metadata: metadata || {},
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
    });
  } catch (err) {
    console.warn('[audit] insert failed:', err?.message);
  }

  return response;
}

// PostgREST "count=exact" wrapper — returns { rows, total } by parsing the
// Content-Range header. Worker-side pagination for the admin directory.
async function adminCountedSelect(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  const text = await res.text();
  let rows = [];
  try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
  const range = res.headers.get('content-range') || '';
  const total = Number.parseInt(range.split('/').pop() || '0', 10) || 0;
  return { rows: Array.isArray(rows) ? rows : [], total };
}

/* =============================================================
   Phase 5.5 — Admin refund action
   -------------------------------------------------------------
   POST /api/admin/orders/:id/refund { amount_cents, reason }

   Shop orders are destination charges (PaymentIntent has
   transfer_data.destination → Silver Lining Connect account), so
   the refund is created on the platform with reverse_transfer +
   refund_application_fee. Idempotency-Key is keyed to
   refund:{order_id}:{attempt_n} so SPA retries don't double-charge.

   Minimum refund is $1 (100 cents, Stripe's floor for USD).
   Partial refunds are allowed; the orders row flips to status=
   'refunded' only once the cumulative refund equals the order total.
   ============================================================= */
async function adminOrderRefund(request, env, actorId, orderId) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const amountCentsRaw = body?.amount_cents;
  const amountCents = Number.isFinite(amountCentsRaw) ? Math.trunc(amountCentsRaw) : 0;
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (amountCents < 100) {
    return json({ error: 'amount_below_minimum' }, 400);
  }
  if (!reasonRaw) {
    return json({ error: 'reason_required' }, 400);
  }
  const reason = reasonRaw.slice(0, 2000);

  const orderRes = await supabaseSelect(
    env,
    'orders',
    `select=id,owner_id,status,total_cents,stripe_payment_intent_id,stripe_charge_id&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { serviceRole: true }
  );
  const order = Array.isArray(orderRes.data) ? orderRes.data[0] : null;
  if (!order) {
    return json({ error: 'not_found' }, 404);
  }
  if (!order.stripe_payment_intent_id && !order.stripe_charge_id) {
    return json({ error: 'order_not_charged' }, 409);
  }
  if (order.status !== 'paid' && order.status !== 'refunded') {
    return json({ error: 'order_not_refundable', status: order.status }, 409);
  }

  // Compute remaining refundable amount from prior succeeded/pending rows.
  const existingRes = await supabaseSelect(
    env,
    'order_refunds',
    `select=id,amount_cents,stripe_status&order_id=eq.${encodeURIComponent(orderId)}`,
    { serviceRole: true }
  );
  const existing = Array.isArray(existingRes.data) ? existingRes.data : [];
  const alreadyRefunded = existing
    .filter((r) => r.stripe_status === 'succeeded' || r.stripe_status === 'pending')
    .reduce((s, r) => s + (Number.isFinite(r.amount_cents) ? r.amount_cents : 0), 0);
  const remaining = Math.max(0, order.total_cents - alreadyRefunded);
  if (amountCents > remaining) {
    return json({ error: 'amount_exceeds_remaining', remaining_cents: remaining }, 400);
  }

  const attemptNumber = existing.length + 1;
  const idempotencyKey = `refund:${orderId}:${attemptNumber}`;
  const stripeRes = await createRefund(env, {
    paymentIntentId: order.stripe_payment_intent_id || null,
    chargeId:        order.stripe_payment_intent_id ? null : order.stripe_charge_id,
    amountCents,
    idempotencyKey,
    metadata: {
      ml_order_id:   orderId,
      ml_refunded_by: actorId,
      ml_reason:     reason.slice(0, 500),
    },
  });

  if (!stripeRes.ok) {
    if (stripeRes.error === 'stripe_not_configured') {
      return json({ error: 'stripe_not_configured' }, 501);
    }
    // Record the failed attempt so the admin has an audit trail.
    await supabaseInsertReturning(env, 'order_refunds', {
      order_id:        orderId,
      amount_cents:    amountCents,
      reason,
      refunded_by:     actorId,
      stripe_status:   'failed',
      last_error:      (stripeRes.message || stripeRes.error || 'stripe_error').slice(0, 500),
    });
    return json({
      error: 'stripe_refund_failed',
      code: stripeRes.error,
      message: stripeRes.message || null,
    }, stripeRes.status >= 400 && stripeRes.status < 600 ? stripeRes.status : 502);
  }

  const refund = stripeRes.data || {};
  const stripeStatus = refund.status === 'succeeded'
    ? 'succeeded'
    : refund.status === 'failed' || refund.status === 'canceled'
      ? refund.status
      : 'pending';

  const ins = await supabaseInsertReturning(env, 'order_refunds', {
    order_id:         orderId,
    stripe_refund_id: refund.id || null,
    amount_cents:     amountCents,
    reason,
    refunded_by:      actorId,
    stripe_status:    stripeStatus,
    last_error:       stripeStatus === 'failed' ? (refund.failure_reason || null) : null,
  });
  if (!ins.ok) {
    return json({ error: 'refund_insert_failed', status: ins.status }, 500);
  }

  // Flip orders.status='refunded' only when fully refunded (succeeded + pending
  // both count against remaining so we don't over-refund mid-pending).
  const newTotal = alreadyRefunded + (stripeStatus !== 'failed' ? amountCents : 0);
  if (stripeStatus !== 'failed' && newTotal >= order.total_cents && order.status !== 'refunded') {
    await supabaseUpdateReturning(
      env,
      'orders',
      `id=eq.${encodeURIComponent(orderId)}`,
      { status: 'refunded' }
    );
  }

  // Best-effort HubSpot enqueue (drained by 5.6 cron).
  try {
    await supabaseInsert(env, 'pending_hubspot_syncs', {
      event_name: 'maneline_refund_issued',
      payload: {
        order_id:     orderId,
        owner_id:     order.owner_id,
        refund_id:    ins.data?.id || null,
        stripe_refund_id: refund.id || null,
        amount_cents: amountCents,
        reason,
        refunded_by:  actorId,
        refunded_at:  new Date().toISOString(),
        stripe_status: stripeStatus,
      },
    });
  } catch (err) {
    console.warn('[hubspot] refund enqueue failed:', err?.message);
  }

  return json({ refund: ins.data });
}

// RFC-4180 CSV; quotes fields containing comma, quote, CR or LF.
function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n');
  return rows.length ? `${header}\n${body}\n` : `${header}\n`;
}

/* =============================================================
   Phase 5.4 — Support inbox (public POST)
   -------------------------------------------------------------
   POST /api/support-tickets { category, subject, body, contact_email? }

   Auth is optional: if the caller carries a valid Supabase JWT, we
   stamp owner_id; if not (anon landing widget), the category is
   restricted to 'bug' | 'feature_request'. Rate limited 10/hour
   per user id (authed) or per source IP (anon). On insert we
   best-effort enqueue the HubSpot `maneline_support_ticket_opened`
   event — drained by 5.6 cron.
   ============================================================= */
const SUPPORT_TICKET_RATE = { limit: 10, windowSec: 3600 };
const SUPPORT_TICKET_CATEGORIES = new Set([
  'account', 'billing', 'bug', 'feature_request', 'emergency_followup',
]);
const SUPPORT_TICKET_ANON_CATEGORIES = new Set(['bug', 'feature_request']);

async function handleSupportTicketCreate(request, env, ctx) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  // Resolve optional JWT → actorId. Missing / invalid tokens fall back to anon.
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  let actorId = null;
  if (jwt) {
    const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (who.ok) {
      const whoData = await who.json().catch(() => null);
      actorId = whoData?.id || null;
    }
  }

  const ip = clientIp(request);
  const bucket = actorId ? `ratelimit:support_ticket:uid:${actorId}` : `ratelimit:support_ticket:ip:${ip}`;
  const rl = await rateLimit(env, bucket, SUPPORT_TICKET_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const ticketBody = typeof body.body === 'string' ? body.body.trim() : '';
  const contactEmailRaw = typeof body.contact_email === 'string' ? body.contact_email.trim() : '';

  if (!SUPPORT_TICKET_CATEGORIES.has(category)) {
    return json({ error: 'bad_category' }, 400);
  }
  if (!actorId && !SUPPORT_TICKET_ANON_CATEGORIES.has(category)) {
    return json({ error: 'login_required_for_category' }, 401);
  }
  if (subject.length < 1 || subject.length > 200) {
    return json({ error: 'bad_subject' }, 400);
  }
  if (ticketBody.length < 1 || ticketBody.length > 10000) {
    return json({ error: 'bad_body' }, 400);
  }
  // Anon callers must provide a contact email so we can reply.
  let contactEmail = contactEmailRaw || null;
  if (!actorId) {
    const emailOk = !!contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
    if (!emailOk) {
      return json({ error: 'bad_contact_email' }, 400);
    }
  }

  const row = {
    owner_id: actorId,
    contact_email: contactEmail,
    category,
    subject: subject.slice(0, 200),
    body: ticketBody.slice(0, 10000),
    source_ip: ip,
    user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
  };

  const ins = await supabaseInsertReturning(env, 'support_tickets', row);
  if (!ins.ok) {
    return json({ error: 'insert_failed' }, 500);
  }
  const ticket = ins.data || {};

  // Best-effort HubSpot enqueue (drained by 5.6 cron).
  try {
    await supabaseInsert(env, 'pending_hubspot_syncs', {
      event_name: 'maneline_support_ticket_opened',
      payload: {
        ticket_id: ticket.id || null,
        owner_id: actorId,
        contact_email: contactEmail,
        category,
        subject: subject.slice(0, 200),
        created_at: ticket.created_at || new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[hubspot] support enqueue failed:', err?.message);
  }

  // Append-only audit row (actor may be null for anon).
  try {
    await supabaseInsert(env, 'audit_log', {
      actor_id: actorId,
      actor_role: actorId ? 'user' : 'anon',
      action: 'support.ticket.create',
      target_table: 'support_tickets',
      target_id: ticket.id || null,
      metadata: { category, anon: !actorId },
      ip,
      user_agent: request.headers.get('user-agent') || null,
    });
  } catch (err) {
    console.warn('[audit] support_ticket insert failed:', err?.message);
  }

  // Phase 6.4 — emergency_followup pages the on-call admin via Twilio.
  // Fire-and-forget so the ticket POST returns immediately; dispatch
  // writes its own sms_dispatches + audit rows. dispatchEmergencyPage
  // catches all errors internally (the ticket still lands in
  // /admin/support via the existing pipeline on any Twilio hiccup).
  if (category === 'emergency_followup' && ticket.id) {
    const ownerEmail = contactEmail || await lookupProfileEmail(env, actorId);
    const pageTicket = {
      id:            ticket.id,
      subject:       subject.slice(0, 200),
      owner_email:   ownerEmail,
      contact_email: contactEmail,
    };
    const task = dispatchEmergencyPage(env, pageTicket);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
    } else {
      task.catch(() => { /* already logged */ });
    }
  }

  return json({ ticket: { id: ticket.id, status: ticket.status, created_at: ticket.created_at } }, 201);
}

/**
 * Lookup user_profiles.email by user_id via service_role. Used by the
 * emergency-page body builder when the caller didn't supply a
 * contact_email (authed path — owner_id is always set for
 * emergency_followup). Returns null on miss.
 */
async function lookupProfileEmail(env, userId) {
  if (!userId) return null;
  try {
    const r = await supabaseSelect(
      env,
      'user_profiles',
      `select=email&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { serviceRole: true },
    );
    if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0].email || null;
  } catch (err) {
    console.warn('[support] profile email lookup failed:', err?.message);
  }
  return null;
}

/* =============================================================
   Phase 5.7 — Vet View scoped magic link
   -------------------------------------------------------------
   Four endpoints:

     POST /api/vet-share-tokens          (owner-auth'd) — create
     GET  /api/vet-share-tokens          (owner-auth'd) — list own
     POST /api/vet-share-tokens/:id/revoke (owner-auth'd) — revoke
     GET  /api/vet/:token                (anon, rate-limited) — read

   Policy:
     - Expiry options 24h / 7d / 14d / 30d (default 14d).
     - Scope: records always on; media optional; sessions OFF for v1.
     - Token = 32 random bytes base64url-encoded (URL-safe, no
       padding, 43 chars). Uniqueness enforced at the DB level.
     - Anon /api/vet/:token rate-limited to 60/min per token via
       KV (ML_RL). Each read increments view_count and appends an
       audit_log row (action='vet_view.record.read').
     - "12-month record" means vet_records within 365d of
       share-create time — freezes the window so a long-lived link
       doesn't retroactively surface newer data.
   ============================================================= */

const VET_SHARE_DEFAULT_DAYS = 14;
const VET_SHARE_ALLOWED_DAYS = new Set([1, 7, 14, 30]);
const VET_SHARE_WINDOW_DAYS  = 365;
const VET_READ_RATE          = { limit: 60, windowSec: 60 };
const VET_GET_URL_TTL_SEC    = 300;

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateVetToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function handleVetShareCreate(request, env, ctx) {
  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const animalId = typeof body.animal_id === 'string' ? body.animal_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(animalId)) {
    return json({ error: 'bad_animal_id' }, 400);
  }

  const rawDays = Number(body.expires_in_days);
  const days = VET_SHARE_ALLOWED_DAYS.has(rawDays) ? rawDays : VET_SHARE_DEFAULT_DAYS;

  const scopeIn = body.scope && typeof body.scope === 'object' ? body.scope : {};
  const scope = {
    records:  scopeIn.records !== false,
    media:    scopeIn.media === true,
    sessions: false,
  };
  if (!scope.records && !scope.media) {
    return json({ error: 'bad_scope', detail: 'at least one of records or media must be true' }, 400);
  }

  // Ownership check — owner must own the animal (RLS + RPC double-check).
  const ownership = await supabaseRpc(env, 'am_i_owner_of', { animal_id: animalId }, { userJwt: jwt });
  if (!ownership.ok || ownership.data !== true) {
    return json({ error: 'forbidden' }, 403);
  }

  const token = generateVetToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const row = {
    owner_id:   actorId,
    animal_id:  animalId,
    token,
    scope,
    expires_at: expiresAt,
  };
  const ins = await supabaseInsertReturning(env, 'vet_share_tokens', row);
  if (!ins.ok || !ins.data) {
    return json({ error: 'insert_failed' }, 500);
  }

  const shareUrl = `${new URL(request.url).origin}/vet/${token}`;

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'vet_share.create',
    target_table: 'vet_share_tokens',
    target_id: ins.data.id,
    metadata: { animal_id: animalId, expires_at: expiresAt, scope },
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({
    id:         ins.data.id,
    token,
    url:        shareUrl,
    animal_id:  animalId,
    scope,
    expires_at: expiresAt,
    created_at: ins.data.created_at,
  }, 201);
}

async function handleVetShareList(request, env, url) {
  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  const animalId = (url.searchParams.get('animal_id') || '').trim();
  let query = `select=id,animal_id,token,scope,expires_at,viewed_at,view_count,revoked_at,created_at&owner_id=eq.${actorId}&archived_at=is.null&order=created_at.desc&limit=50`;
  if (animalId) {
    if (!/^[0-9a-f-]{36}$/i.test(animalId)) {
      return json({ error: 'bad_animal_id' }, 400);
    }
    query += `&animal_id=eq.${encodeURIComponent(animalId)}`;
  }

  // Owner JWT + RLS: vet_share_tokens_owner_select enforces owner_id = auth.uid().
  const r = await supabaseSelect(env, 'vet_share_tokens', query, { userJwt: jwt });
  if (!r.ok) {
    return json({ error: 'list_failed' }, 500);
  }
  const rows = Array.isArray(r.data) ? r.data : [];

  // Don't echo the raw token on list responses — shoulder-surf risk.
  // Callers that need the URL again should revoke + re-create.
  const tokens = rows.map((row) => ({
    id:          row.id,
    animal_id:   row.animal_id,
    token_hint:  typeof row.token === 'string' ? `${row.token.slice(0, 6)}…` : null,
    scope:       row.scope,
    expires_at:  row.expires_at,
    viewed_at:   row.viewed_at,
    view_count:  row.view_count,
    revoked_at:  row.revoked_at,
    created_at:  row.created_at,
  }));

  return json({ tokens });
}

async function handleVetShareRevoke(request, env, tokenId, ctx) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  // Ownership check — use service_role so a just-created token is
  // visible even if the owner's JWT cache hasn't caught up with RLS
  // propagation. We still verify owner_id === actorId ourselves below,
  // so there's no authz regression.
  const own = await supabaseSelect(
    env,
    'vet_share_tokens',
    `select=id,owner_id,revoked_at&id=eq.${encodeURIComponent(tokenId)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(own.data) ? own.data[0] : null;
  if (!row) {
    return json({ error: 'not_found' }, 404);
  }
  if (row.owner_id !== actorId) {
    return json({ error: 'forbidden' }, 403);
  }
  if (row.revoked_at) {
    return json({ ok: true, already_revoked: true });
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null;

  const upd = await supabaseUpdateReturning(
    env,
    'vet_share_tokens',
    `id=eq.${encodeURIComponent(tokenId)}`,
    { revoked_at: new Date().toISOString(), revoked_reason: reason }
  );
  if (!upd.ok) {
    return json({ error: 'revoke_failed' }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'vet_share.revoke',
    target_table: 'vet_share_tokens',
    target_id: tokenId,
    metadata: { reason },
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({ ok: true, revoked_at: upd.data?.revoked_at ?? null });
}

async function handleVetTokenGet(request, env, token, ctx) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  // Shape-check the token so obviously-bad inputs are cheap to reject
  // and don't burn DB round-trips. base64url w/ no padding, length 43
  // for 32 random bytes.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return json({ error: 'bad_token' }, 400);
  }

  const rl = await rateLimit(env, `ratelimit:vet_token:${token}`, VET_READ_RATE);
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  const tokenQ = await supabaseSelect(
    env,
    'vet_share_tokens',
    `select=id,owner_id,animal_id,scope,expires_at,viewed_at,view_count,revoked_at,archived_at,created_at&token=eq.${encodeURIComponent(token)}&limit=1`,
    { serviceRole: true }
  );
  const share = Array.isArray(tokenQ.data) ? tokenQ.data[0] : null;
  if (!share) {
    return json({ error: 'not_found' }, 404);
  }
  if (share.archived_at) {
    return json({ error: 'not_found' }, 404);
  }
  if (share.revoked_at) {
    return json({ error: 'revoked' }, 410);
  }
  if (Date.parse(share.expires_at) <= Date.now()) {
    return json({ error: 'expired' }, 410);
  }

  // Animal metadata — scoped to the single shared animal.
  const animalQ = await supabaseSelect(
    env,
    'animals',
    `select=id,owner_id,species,barn_name,breed,sex,year_born,discipline&id=eq.${encodeURIComponent(share.animal_id)}&limit=1`,
    { serviceRole: true }
  );
  const animal = Array.isArray(animalQ.data) ? animalQ.data[0] : null;
  if (!animal || animal.owner_id !== share.owner_id) {
    // Owner transferred or deleted — treat as revoked.
    return json({ error: 'not_found' }, 404);
  }

  // 12-month record window anchored to share creation.
  const windowStart = new Date(
    new Date(share.created_at).getTime() - VET_SHARE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let records = [];
  if (share.scope?.records) {
    const recsQ = await supabaseSelect(
      env,
      'vet_records',
      `select=id,record_type,issued_on,expires_on,issuing_provider,notes,created_at,r2_object_id` +
        `&animal_id=eq.${encodeURIComponent(share.animal_id)}` +
        `&archived_at=is.null` +
        `&created_at=gte.${encodeURIComponent(windowStart)}` +
        `&order=issued_on.desc.nullslast`,
      { serviceRole: true }
    );
    records = Array.isArray(recsQ.data) ? recsQ.data : [];
  }

  let media = [];
  if (share.scope?.media) {
    const medQ = await supabaseSelect(
      env,
      'animal_media',
      `select=id,kind,caption,taken_on,created_at,r2_object_id` +
        `&animal_id=eq.${encodeURIComponent(share.animal_id)}` +
        `&archived_at=is.null` +
        `&created_at=gte.${encodeURIComponent(windowStart)}` +
        `&order=created_at.desc`,
      { serviceRole: true }
    );
    media = Array.isArray(medQ.data) ? medQ.data : [];
  }

  // Resolve r2_objects in one lookup per batch, then presign GETs.
  const objectIds = [
    ...records.map((r) => r.r2_object_id),
    ...media.map((m) => m.r2_object_id),
  ].filter(Boolean);
  const objectsById = new Map();
  if (objectIds.length > 0) {
    const uniq = Array.from(new Set(objectIds));
    const inList = uniq.map((id) => encodeURIComponent(id)).join(',');
    const objQ = await supabaseSelect(
      env,
      'r2_objects',
      `select=id,bucket,object_key,content_type,byte_size&id=in.(${inList})`,
      { serviceRole: true }
    );
    if (Array.isArray(objQ.data)) {
      for (const row of objQ.data) objectsById.set(row.id, row);
    }
  }

  const presignOne = async (r2Id) => {
    const row = objectsById.get(r2Id);
    if (!row || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      return null;
    }
    try {
      const url = await presignGet({
        bucket:      row.bucket,
        key:         row.object_key,
        accountId:   env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretKey:   env.R2_SECRET_ACCESS_KEY,
        expiresSec:  VET_GET_URL_TTL_SEC,
      });
      return { url, content_type: row.content_type, size_bytes: row.byte_size };
    } catch {
      return null;
    }
  };

  const recordsOut = await Promise.all(records.map(async (r) => ({
    id:                r.id,
    record_type:       r.record_type,
    issued_on:         r.issued_on,
    expires_on:        r.expires_on,
    issuing_provider:  r.issuing_provider,
    notes:             r.notes,
    created_at:        r.created_at,
    file:              await presignOne(r.r2_object_id),
  })));
  const mediaOut = await Promise.all(media.map(async (m) => ({
    id:          m.id,
    kind:        m.kind,
    caption:     m.caption,
    taken_on:    m.taken_on,
    created_at:  m.created_at,
    file:        await presignOne(m.r2_object_id),
  })));

  // Bump view_count + viewed_at, append audit row. Both are side-effects
  // we want to outlive the response, so wrap in waitUntil — otherwise
  // the runtime can discard the pending promises once we return.
  const bump = supabaseUpdateReturning(
    env,
    'vet_share_tokens',
    `id=eq.${encodeURIComponent(share.id)}`,
    { viewed_at: new Date().toISOString(), view_count: (share.view_count ?? 0) + 1 }
  ).catch((err) => console.warn('[vet] view_count bump failed:', err?.message));
  if (ctx?.waitUntil) ctx.waitUntil(bump);

  ctx_audit(env, {
    actor_id: null,
    actor_role: 'anon',
    action: 'vet_view.record.read',
    target_table: 'vet_share_tokens',
    target_id: share.id,
    metadata: {
      animal_id: share.animal_id,
      records_count: recordsOut.length,
      media_count: mediaOut.length,
    },
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({
    share: {
      expires_at: share.expires_at,
      scope: share.scope,
      issued_at: share.created_at,
    },
    animal: {
      id: animal.id,
      species: animal.species,
      barn_name: animal.barn_name,
      breed: animal.breed,
      sex: animal.sex,
      year_born: animal.year_born,
      discipline: animal.discipline,
    },
    records: recordsOut,
    media: mediaOut,
  });
}

/* =============================================================
   Feature flags
   ============================================================= */
async function handleFlags(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  let signupV2 = true;
  let chatV1   = true;
  try {
    if (env.FLAGS) {
      const [signupRaw, chatRaw] = await Promise.all([
        env.FLAGS.get('feature:signup_v2'),
        env.FLAGS.get('feature:chat_v1'),
      ]);
      if (signupRaw !== null && signupRaw !== undefined) {
        signupV2 = String(signupRaw).trim().toLowerCase() !== 'false';
      }
      if (chatRaw !== null && chatRaw !== undefined) {
        chatV1 = String(chatRaw).trim().toLowerCase() !== 'false';
      }
    }
  } catch (err) {
    console.warn('[flags] KV read failed, defaulting all-on:', err?.message);
  }

  return new Response(
    JSON.stringify({ signup_v2: signupV2, chat_v1: chatV1 }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30',
      },
    }
  );
}

/* =============================================================
   Supabase -> Google Sheets webhook forwarder (L0 -> L1 mirror)
   ============================================================= */
async function handleSheetsWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const got = request.headers.get('x-webhook-secret') || '';
  if (!env.SUPABASE_WEBHOOK_SECRET || !timingSafeEqual(got, env.SUPABASE_WEBHOOK_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const record = body.record || {};
  const event = (body.type || 'insert').toLowerCase();

  if (!env.GOOGLE_APPS_SCRIPT_URL) {
    return new Response('apps script url not configured', { status: 500 });
  }

  const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: env.GOOGLE_APPS_SCRIPT_SECRET || '',
      event,
      row: {
        id: record.id,
        email: record.email,
        full_name: record.full_name,
        phone: record.phone,
        location: record.location,
        discipline: record.discipline,
        marketing_opt_in: record.marketing_opt_in,
      },
    }),
  });

  const text = await res.text();
  return new Response(text, { status: res.ok ? 200 : 502 });
}

/* =============================================================
   /api/_integrations-health — Phase 0 smoke test
   ============================================================= */
/* =============================================================
   Phase 3.2 — Shop catalog read path
   -------------------------------------------------------------
   GET  /api/shop/products
   GET  /api/shop/products/:handle
   POST /api/_internal/shop/cache-invalidate   (service_role)
   POST /api/admin/shop/sync                    (silver_lining,
                                                 via handleAdmin)

   Reads are served from KV (5-min TTL) when warm; cold reads go
   through anon+RLS against public.products. Write path is the
   shopify-catalog-sync Edge Function (service_role) which busts
   the KV keys at the end of each run.
   ============================================================= */
const SHOP_LIST_CACHE_KEY = 'shop:v1:list';
const SHOP_HANDLE_CACHE_PREFIX = 'shop:v1:handle:';
const SHOP_CACHE_TTL_SEC = 5 * 60;

function shopHandleIsValid(handle) {
  return typeof handle === 'string' && /^[a-z0-9][a-z0-9-]{0,120}$/i.test(handle);
}

async function handleShopProductsList(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  // Require a signed-in caller. We don't care about role here —
  // both owners and trainers can browse. RLS on public.products
  // already restricts anon.
  let caller;
  try {
    caller = await requireOwner(request, env);
  } catch (res) {
    return res instanceof Response ? res : json({ error: 'unauthorized' }, 401);
  }

  // KV cache (warm path). Stored as the final JSON body string.
  if (env.FLAGS) {
    const cached = await env.FLAGS.get(SHOP_LIST_CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-ml-cache': 'hit',
        },
      });
    }
  }

  // Cold path — read via caller JWT so RLS enforces the
  // authenticated-only policy.
  const r = await supabaseSelect(
    env,
    'products',
    'select=id,shopify_variant_id,handle,sku,title,description,image_url,price_cents,currency,category,inventory_qty,available,last_synced_at&archived_at=is.null&order=available.desc,title.asc&limit=500',
    { userJwt: caller.jwt }
  );
  if (!r.ok) {
    return json({ error: 'products_read_failed', status: r.status }, 500);
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  const categories = Array.from(
    new Set(rows.map((row) => row.category).filter((c) => typeof c === 'string'))
  ).sort();

  const body = JSON.stringify({ products: rows, categories });
  if (env.FLAGS) {
    await env.FLAGS.put(SHOP_LIST_CACHE_KEY, body, { expirationTtl: SHOP_CACHE_TTL_SEC });
  }
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-ml-cache': 'miss',
    },
  });
}

async function handleShopProductByHandle(request, env, rawHandle) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const handle = decodeURIComponent(rawHandle || '');
  if (!shopHandleIsValid(handle)) {
    return json({ error: 'bad_handle' }, 400);
  }

  let caller;
  try {
    caller = await requireOwner(request, env);
  } catch (res) {
    return res instanceof Response ? res : json({ error: 'unauthorized' }, 401);
  }

  const cacheKey = `${SHOP_HANDLE_CACHE_PREFIX}${handle.toLowerCase()}`;
  if (env.FLAGS) {
    const cached = await env.FLAGS.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-ml-cache': 'hit',
        },
      });
    }
  }

  // Cold cache: read the local row via caller JWT (RLS).
  const r = await supabaseSelect(
    env,
    'products',
    `select=id,shopify_variant_id,handle,sku,title,description,image_url,price_cents,currency,category,inventory_qty,available,last_synced_at&handle=eq.${encodeURIComponent(handle)}&archived_at=is.null&limit=1`,
    { userJwt: caller.jwt }
  );

  let product = Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null;

  // On-demand fallback: deep link to a handle the sync hasn't seen
  // yet. If Shopify is configured, fetch once and return without
  // persisting (the next sync will pick it up).
  if (!product && shopifyConfigured(env)) {
    try {
      const node = await fetchProductByHandle(env, handle);
      if (node) {
        const row = shopifyNodeToProductRow(node);
        if (row) {
          product = {
            id: null,
            shopify_variant_id: row.shopify_variant_id,
            handle: row.handle,
            sku: row.sku,
            title: row.title,
            description: row.description,
            image_url: row.image_url,
            price_cents: row.price_cents,
            currency: row.currency,
            category: row.category,
            inventory_qty: row.inventory_qty,
            available: row.available,
            last_synced_at: row.last_synced_at,
          };
        }
      }
    } catch {
      // Fall through — we just return 404 below.
    }
  }

  if (!product) {
    return json({ error: 'not_found' }, 404);
  }

  const body = JSON.stringify({ product });
  if (env.FLAGS) {
    await env.FLAGS.put(cacheKey, body, { expirationTtl: SHOP_CACHE_TTL_SEC });
  }
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-ml-cache': 'miss',
    },
  });
}

async function handleShopCacheInvalidate(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }
  const authz = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (!timingSafeEqual(authz, expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!env.FLAGS) {
    return json({ ok: true, skipped: 'no_kv_binding' });
  }

  // Blow the list key; per-handle keys self-expire within 5 min,
  // which is fine because a handle's price/inventory rarely flips
  // independent of the full catalog.
  await env.FLAGS.delete(SHOP_LIST_CACHE_KEY);

  return json({ ok: true, invalidated: [SHOP_LIST_CACHE_KEY] });
}

/* =============================================================
   /api/shop/checkout  — Phase 3.4
   -------------------------------------------------------------
   Owner-only. Body: { items: [{ variant_id, qty }] }.
   Flow:
     1. Resolve every variant_id against public.products via
        service_role (the Worker is the single source of price
        truth; the SPA never sets price or fee).
     2. Reject out-of-stock items fast (fail before creating a
        Stripe session).
     3. INSERT orders row with status='pending_payment' and a
        provisional subtotal/total.
     4. If SLH_CONNECT_ACCOUNT_ID is unset, we skip Stripe entirely
        and stamp status='awaiting_merchant_setup' instead. The
        order is still visible in /app/orders so the owner can see
        the attempt. (Phase 2 precedent for awaiting_trainer_setup.)
     5. Otherwise mint a hosted Checkout Session with
        Idempotency-Key = shop_checkout:<order_id>, and record
        stripe_checkout_session_id on the row.
   ============================================================= */
const SHOP_CHECKOUT_RATE = { limit: 10, windowSec: 60 };

async function handleShopCheckout(request, env, url) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:shop_checkout:${actorId}`,
    SHOP_CHECKOUT_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) {
    return json({ error: 'bad_items' }, 400);
  }

  // Optional Phase 3.8 payload. When present the orders row is tagged
  // `source='in_expense'` and the webhook auto-creates the matching
  // `expenses` row on `checkout.session.completed`. Honored only when
  // items.length === 1 — see phase-3-plan.md §3.8 edge cases.
  const expenseDraftRaw = body?.expense_draft && typeof body.expense_draft === 'object'
    ? body.expense_draft
    : null;
  let expenseDraft = null;
  if (expenseDraftRaw) {
    if (items.length !== 1) {
      return json({ error: 'expense_draft_requires_single_item' }, 400);
    }
    const animalId = typeof expenseDraftRaw.animal_id === 'string' ? expenseDraftRaw.animal_id : '';
    const recorderRole = expenseDraftRaw.recorder_role === 'trainer' ? 'trainer' : 'owner';
    const category = typeof expenseDraftRaw.category === 'string' ? expenseDraftRaw.category : '';
    const occurredOn = typeof expenseDraftRaw.occurred_on === 'string' ? expenseDraftRaw.occurred_on : '';
    const notesRaw = typeof expenseDraftRaw.notes === 'string' ? expenseDraftRaw.notes : '';
    if (!/^[0-9a-f-]{36}$/i.test(animalId)) return json({ error: 'bad_animal_id' }, 400);
    if (category !== 'supplement') return json({ error: 'bad_expense_category' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return json({ error: 'bad_occurred_on' }, 400);

    // Access check. Owners must own the animal; trainers must hold an
    // active grant via do_i_have_access_to_animal. Both verified with
    // the caller's JWT (RLS is the backstop but we want a clean 403
    // before minting a Stripe session that can't be reconciled).
    if (recorderRole === 'owner') {
      const r = await supabaseSelect(
        env,
        'animals',
        `select=id&id=eq.${encodeURIComponent(animalId)}&owner_id=eq.${encodeURIComponent(actorId)}&limit=1`,
        { userJwt: jwt }
      );
      if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) {
        return json({ error: 'expense_draft_forbidden' }, 403);
      }
    } else {
      const ok = await supabaseRpc(
        env,
        'do_i_have_access_to_animal',
        { animal_id: animalId },
        { userJwt: jwt }
      );
      if (!ok.ok || ok.data !== true) {
        return json({ error: 'expense_draft_forbidden' }, 403);
      }
    }

    // Trim notes to leave room under Stripe's 500-char metadata cap.
    // JSON-encoded draft with full shape fits under ~450 chars with
    // ~200 chars of notes; cap defensively.
    const notes = notesRaw.trim().slice(0, 200);
    expenseDraft = {
      animal_id:     animalId,
      recorder_role: recorderRole,
      recorder_id:   actorId,
      category,
      occurred_on:   occurredOn,
      notes:         notes || null,
    };
  }

  // Normalize, dedupe by variant_id (SPA might send the same SKU
  // twice; we collapse to one line with summed qty).
  const byVariant = new Map();
  for (const raw of items) {
    const variantId = typeof raw?.variant_id === 'string' ? raw.variant_id.trim() : '';
    const qty = Math.floor(Number(raw?.qty));
    if (!variantId || !Number.isFinite(qty) || qty <= 0 || qty > 99) {
      return json({ error: 'bad_items' }, 400);
    }
    byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + qty);
  }
  const variantIds = Array.from(byVariant.keys());

  // Server-side price + availability resolution. service_role so
  // we see every row regardless of the requesting JWT's RLS view.
  const filter = variantIds
    .map((v) => `"${v.replace(/"/g, '\\"')}"`)
    .join(',');
  const lookup = await supabaseSelect(
    env,
    'products',
    `select=id,shopify_variant_id,handle,sku,title,image_url,price_cents,available,archived_at&shopify_variant_id=in.(${encodeURIComponent(filter)})`,
    { serviceRole: true }
  );
  if (!lookup.ok) {
    return json({ error: 'products_read_failed' }, 500);
  }
  const rows = Array.isArray(lookup.data) ? lookup.data : [];
  const productsByVariant = new Map(rows.map((r) => [r.shopify_variant_id, r]));

  const resolvedLines = [];
  for (const variantId of variantIds) {
    const p = productsByVariant.get(variantId);
    if (!p || p.archived_at) {
      return json({ error: 'item_not_found', variant_id: variantId }, 409);
    }
    if (!p.available) {
      return json({ error: 'out_of_stock', variant_id: variantId }, 409);
    }
    const qty = byVariant.get(variantId);
    const unit = Number(p.price_cents);
    if (!Number.isFinite(unit) || unit <= 0) {
      return json({ error: 'price_invalid', variant_id: variantId }, 500);
    }
    resolvedLines.push({
      product: p,
      variantId,
      qty,
      unitAmountCents: unit,
      lineTotalCents: unit * qty,
    });
  }

  const subtotalCents = resolvedLines.reduce((s, l) => s + l.lineTotalCents, 0);
  if (subtotalCents <= 0) {
    return json({ error: 'empty_order' }, 400);
  }

  const connectAccountId = env.SLH_CONNECT_ACCOUNT_ID || null;
  const stripeReady = isStripeConfigured(env) && Boolean(connectAccountId);
  const initialStatus = stripeReady ? 'pending_payment' : 'awaiting_merchant_setup';
  const orderSource = expenseDraft ? 'in_expense' : 'shop';

  // Create the order row first so we can key Stripe idempotency off its uuid.
  const ordersIns = await supabaseInsertReturning(env, 'orders', {
    owner_id:       actorId,
    subtotal_cents: subtotalCents,
    total_cents:    subtotalCents,
    currency:       'usd',
    status:         initialStatus,
    source:         orderSource,
  });
  if (!ordersIns.ok || !ordersIns.data?.id) {
    return json({ error: 'order_insert_failed', status: ordersIns.status }, 500);
  }
  const orderId = ordersIns.data.id;

  // Audit — we intentionally log BEFORE minting the Stripe session so
  // a failure between insert and webhook is still traceable.
  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'order.create',
    target_table: 'orders',
    target_id:    orderId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata: {
      source:       orderSource,
      line_count:   resolvedLines.length,
      total_cents:  subtotalCents,
      awaiting:     initialStatus === 'awaiting_merchant_setup',
      ...(expenseDraft
        ? { expense_draft_animal_id: expenseDraft.animal_id }
        : {}),
    },
  });

  // Path A — SLH not set up yet: park the order, no Stripe call.
  if (!stripeReady) {
    return json({
      order_id: orderId,
      status:   'awaiting_merchant_setup',
    });
  }

  // Path B — mint Checkout Session.
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  const whoData = who.ok ? await who.json().catch(() => null) : null;
  const email = whoData?.email || null;

  const origin = new URL(request.url).origin;
  const session = await createCheckoutSession(env, {
    ownerId: actorId,
    orderId,
    email,
    successUrl: `${origin}/app/orders/${orderId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  `${origin}/app/orders/${orderId}?checkout=cancel`,
    connectAccountId,
    idempotencyKey: `shop_checkout:${orderId}`,
    source: orderSource,
    expenseDraftJson: expenseDraft ? JSON.stringify(expenseDraft) : null,
    lineItems: resolvedLines.map((l) => ({
      title:             l.product.title,
      sku:               l.product.sku,
      shopifyVariantId:  l.variantId,
      productId:         l.product.id,
      imageUrl:          l.product.image_url || null,
      unitAmountCents:   l.unitAmountCents,
      quantity:          l.qty,
    })),
  });
  if (!session.ok || !session.data?.id || !session.data?.url) {
    // Roll the order to failed so retries don't stack pending_payment rows.
    await supabaseUpdateReturning(
      env,
      'orders',
      `id=eq.${encodeURIComponent(orderId)}`,
      {
        status:          'failed',
        failure_code:    session.error || 'stripe_session_failed',
        failure_message: session.message ?? null,
      }
    );
    return json({
      error:   session.error || 'stripe_session_failed',
      message: session.message ?? null,
    }, 502);
  }

  await supabaseUpdateReturning(
    env,
    'orders',
    `id=eq.${encodeURIComponent(orderId)}`,
    { stripe_checkout_session_id: session.data.id }
  );

  return json({
    order_id: orderId,
    status:   'pending_payment',
    url:      session.data.url,
  });
}

async function adminShopSync(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/functions/v1/shopify-catalog-sync`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: '{}',
    }
  );

  let body;
  try { body = await res.json(); } catch { body = { ok: res.ok }; }
  return json(body, res.ok ? 200 : 502);
}

async function handleIntegrationsHealth(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const PUBLIC_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const SECRET_KEYS = [
    'SUPABASE_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_APPS_SCRIPT_URL',
    'GOOGLE_APPS_SCRIPT_SECRET',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_STOREFRONT_TOKEN',
    'SHOPIFY_ADMIN_API_TOKEN',
    'HUBSPOT_PRIVATE_APP_TOKEN',
    'HUBSPOT_PORTAL_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'RESEND_API_KEY',
  ];

  const publicEnv = {};
  for (const k of PUBLIC_ENV_KEYS) {
    publicEnv[k] = typeof env[k] === 'string' && env[k].length > 0;
  }
  const secretsPresent = {};
  for (const k of SECRET_KEYS) {
    secretsPresent[k] = typeof env[k] === 'string' && env[k].length > 0;
  }

  // R2 status is 'live' when the binding exists AND all three S3-compat
  // secrets are populated. Presign-only paths would technically work
  // without the binding, but /api/uploads/commit does a binding-side HEAD,
  // so we require both halves to call it live.
  const r2BindingPresent = Boolean(env.MANELINE_R2);
  const r2CredsPresent =
    secretsPresent.R2_ACCOUNT_ID &&
    secretsPresent.R2_ACCESS_KEY_ID &&
    secretsPresent.R2_SECRET_ACCESS_KEY;
  const r2 = r2BindingPresent && r2CredsPresent ? 'live' : 'mock';

  // Shopify is "live" only when (a) storefront secrets set AND
  // (b) shopify_sync_cursor.last_ok_at is within the last 2 h.
  // Otherwise we report "mock" even if the tokens are present —
  // stale catalog is indistinguishable from no catalog from a
  // consumer perspective.
  const shopifyTokensPresent =
    secretsPresent.SHOPIFY_STORE_DOMAIN && secretsPresent.SHOPIFY_STOREFRONT_TOKEN;
  let shopify = 'mock';
  if (shopifyTokensPresent && env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = await supabaseSelect(
      env,
      'shopify_sync_cursor',
      'select=last_ok_at&id=eq.1&limit=1',
      { serviceRole: true }
    );
    const last = Array.isArray(r.data) && r.data[0] ? r.data[0].last_ok_at : null;
    if (last) {
      const ageMs = Date.now() - new Date(last).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 2 * 60 * 60 * 1000) {
        shopify = 'live';
      }
    }
  }

  // Phase 4.9 — Protocol Brain observability. All three metrics are read
  // from Supabase with service_role (per OAG Law 2 — admin reads route
  // through the Worker). Any failure degrades to null; the health
  // endpoint should never 500 because of a metrics query.
  let chatP50LatencyMs = null;
  let emergencyRate1h  = null;
  let chatRuns1h       = 0;
  let protocolsIndexed = null;
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const runsQ =
        `select=latency_ms,emergency_triggered&role=eq.assistant` +
        `&created_at=gte.${encodeURIComponent(sinceIso)}`;
      const runs = await supabaseSelect(env, 'chatbot_runs', runsQ, { serviceRole: true });
      if (runs.ok && Array.isArray(runs.data)) {
        chatRuns1h = runs.data.length;
        const lats = runs.data
          .map((r) => r.latency_ms)
          .filter((x) => typeof x === 'number' && x >= 0)
          .sort((a, b) => a - b);
        if (lats.length > 0) chatP50LatencyMs = lats[Math.floor(lats.length / 2)];
        if (chatRuns1h > 0) {
          const em = runs.data.filter((r) => r.emergency_triggered === true).length;
          emergencyRate1h = em / chatRuns1h;
        }
      }
    } catch { /* ignore — metric stays null */ }
    try {
      const protosResp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/protocols?select=id&embed_status=eq.synced&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        }
      );
      const cr = protosResp.headers.get('content-range');
      if (cr) {
        const m = cr.match(/\/(\d+|\*)$/);
        if (m && m[1] !== '*') protocolsIndexed = Number(m[1]);
      }
    } catch { /* ignore */ }
  }

  // Workers AI is 'live' when we have *any* chat run in the last hour with
  // non-null latency (i.e., the model actually returned). Empty window =
  // still 'mock' until traffic proves the binding answers.
  const workersAiLive = chatP50LatencyMs !== null;
  const vectorizeLive = Boolean(env.VECTORIZE_PROTOCOLS) && (protocolsIndexed ?? 0) > 0;

  // Phase 5.6 — HubSpot health. 'live' iff (a) private-app token
  // set AND (b) at least one successful sync_log row within 24h.
  // queue_depth counts pending rows older than 15 min (healthy
  // drains keep this ≤ 5). dead_letter_count_24h is the loud
  // alarm — anything > 0 should be investigated.
  const hubspotTokenPresent = secretsPresent.HUBSPOT_PRIVATE_APP_TOKEN;
  let hubspotStatus = 'mock';
  let hubspotQueueDepth = null;
  let hubspotDeadLetter24h = null;
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since15m = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      if (hubspotTokenPresent) {
        const logResp = await fetch(
          `${env.SUPABASE_URL}/rest/v1/hubspot_sync_log?select=id&created_at=gte.${encodeURIComponent(since24h)}&limit=1`,
          {
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        if (logResp.ok) {
          const rows = await logResp.json().catch(() => []);
          if (Array.isArray(rows) && rows.length > 0) hubspotStatus = 'live';
        }
      }

      const qResp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/pending_hubspot_syncs?select=id&status=eq.pending&created_at=lte.${encodeURIComponent(since15m)}&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        }
      );
      if (qResp.ok) {
        const cr = qResp.headers.get('content-range');
        const m = cr ? cr.match(/\/(\d+|\*)$/) : null;
        if (m && m[1] !== '*') hubspotQueueDepth = Number(m[1]);
      }

      const dlResp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/pending_hubspot_syncs?select=id&status=eq.dead_letter&updated_at=gte.${encodeURIComponent(since24h)}&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        }
      );
      if (dlResp.ok) {
        const cr = dlResp.headers.get('content-range');
        const m = cr ? cr.match(/\/(\d+|\*)$/) : null;
        if (m && m[1] !== '*') hubspotDeadLetter24h = Number(m[1]);
      }
    } catch { /* metrics stay null */ }
  }

  // Phase 5.8 — admin + vet observability. Proves the audit pipeline is
  // actually writing (admin reads every admin endpoint should stamp a
  // row) and that the vet-share surface is being used.
  let adminAuditWrites24h = null;
  let vetScopedReads24h = null;
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const aResp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/audit_log?select=id&action=like.admin.*&occurred_at=gte.${encodeURIComponent(since24h)}&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        }
      );
      if (aResp.ok) {
        const cr = aResp.headers.get('content-range');
        const m = cr ? cr.match(/\/(\d+|\*)$/) : null;
        if (m && m[1] !== '*') adminAuditWrites24h = Number(m[1]);
      }
    } catch { /* metric stays null */ }
    try {
      const vResp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/audit_log?select=id&action=eq.vet_view.record.read&occurred_at=gte.${encodeURIComponent(since24h)}&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        }
      );
      if (vResp.ok) {
        const cr = vResp.headers.get('content-range');
        const m = cr ? cr.match(/\/(\d+|\*)$/) : null;
        if (m && m[1] !== '*') vetScopedReads24h = Number(m[1]);
      }
    } catch { /* metric stays null */ }
  }

  // Phase 6.7 — Twilio emergency paging + Stripe subscriptions + closed-beta
  // onboarding metrics. Every query is service-role (Law §2) and degrades
  // to null on failure so the endpoint never 500s due to a metric read.
  const twilioCredsPresent =
    secretsPresent.TWILIO_ACCOUNT_SID && secretsPresent.TWILIO_AUTH_TOKEN;
  let twilioDispatches24h = null;
  let twilioDeliveryFailures24h = null;
  let twilioLastDispatchAt = null;
  let subsActiveCount = null;
  let subsPastDueCount = null;
  let invitedCount = null;
  let activatedCount = null;
  // Phase 8 counters — default to null so a metric-read failure never
  // shows up as a misleading zero.
  let barnEventsCreated7d = null;
  let barnExternalResponses7d = null;
  let barnClaimProEmails7d = null;
  let healthOverdueCount = null;
  let healthPdfExports7d = null;
  let facilityCareMatrixEntries7d = null;
  let spendingInvoiceMirrors7d = null;
  let subsBarnModePaidCount = null;
  let subsBarnModeCompCount = null;
  let silverLiningLinkedCount = null;
  let silverLiningLastVerificationAt = null;
  let silverLiningFailures24h = null;
  let promoCodesRedeemed24h = null;
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const countFrom = async (path) => {
      try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
          },
        });
        if (!r.ok) return null;
        const cr = r.headers.get('content-range');
        const m = cr ? cr.match(/\/(\d+|\*)$/) : null;
        if (m && m[1] !== '*') return Number(m[1]);
        return null;
      } catch { return null; }
    };
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    twilioDispatches24h = await countFrom(
      `sms_dispatches?select=id&created_at=gte.${encodeURIComponent(since24h)}&limit=1`,
    );
    twilioDeliveryFailures24h = await countFrom(
      `sms_dispatches?select=id&status=in.(failed,undelivered)&created_at=gte.${encodeURIComponent(since24h)}&limit=1`,
    );
    try {
      const r = await supabaseSelect(
        env,
        'sms_dispatches',
        'select=created_at&order=created_at.desc&limit=1',
        { serviceRole: true },
      );
      if (r.ok && Array.isArray(r.data) && r.data[0]?.created_at) {
        twilioLastDispatchAt = r.data[0].created_at;
      }
    } catch { /* ignore */ }

    subsActiveCount = await countFrom(
      'stripe_subscriptions?select=id&status=in.(active,trialing)&archived_at=is.null&limit=1',
    );
    subsPastDueCount = await countFrom(
      'stripe_subscriptions?select=id&status=in.(past_due,unpaid)&archived_at=is.null&limit=1',
    );

    invitedCount = await countFrom(
      'invitations?select=id&archived_at=is.null&limit=1',
    );
    activatedCount = await countFrom(
      'invitations?select=id&accepted_at=not.is.null&archived_at=is.null&limit=1',
    );

    // Phase 8 — Barn Mode observability.
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    barnEventsCreated7d = await countFrom(
      `barn_events?select=id&created_at=gte.${encodeURIComponent(since7d)}&archived_at=is.null&limit=1`,
    );
    // External responder = public-token flow (responder_user_id is null).
    barnExternalResponses7d = await countFrom(
      `barn_event_responses?select=id&created_at=gte.${encodeURIComponent(since7d)}&responder_user_id=is.null&limit=1`,
    );
    barnClaimProEmails7d = await countFrom(
      `professional_contacts?select=id&claim_email_sent_at=gte.${encodeURIComponent(since7d)}&limit=1`,
    );
    // Herd Health "overdue" isn't a stored status — it's derived. Count
    // active acknowledgements instead (each row is an owner flagging a
    // cell); the herd-health dashboard aggregate tells the full story.
    healthOverdueCount = await countFrom(
      `health_dashboard_acknowledgements?select=id&archived_at=is.null&limit=1`,
    );
    // PDF exports + invoice mirrors are proven via audit_log rows. Each
    // path writes one on success so we reuse audit rather than add
    // bespoke counters.
    healthPdfExports7d = await countFrom(
      `audit_log?select=id&action=eq.barn.herd_health.pdf&occurred_at=gte.${encodeURIComponent(since7d)}&limit=1`,
    );
    facilityCareMatrixEntries7d = await countFrom(
      `care_matrix_entries?select=id&updated_at=gte.${encodeURIComponent(since7d)}&archived_at=is.null&limit=1`,
    );
    // Trainer-invoice → expense mirror rows carry source_invoice_id.
    spendingInvoiceMirrors7d = await countFrom(
      `expenses?select=id&source_invoice_id=not.is.null&created_at=gte.${encodeURIComponent(since7d)}&archived_at=is.null&limit=1`,
    );

    subsBarnModePaidCount = await countFrom(
      `subscriptions?select=id&tier=eq.barn_mode&status=in.(active,trialing)&comp_source=is.null&archived_at=is.null&limit=1`,
    );
    subsBarnModeCompCount = await countFrom(
      `subscriptions?select=id&comp_source=not.is.null&status=in.(active,trialing)&archived_at=is.null&limit=1`,
    );

    silverLiningLinkedCount = await countFrom(
      `silver_lining_links?select=id&archived_at=is.null&limit=1`,
    );
    try {
      const r = await supabaseSelect(
        env,
        'silver_lining_links',
        'select=last_verified_at&archived_at=is.null&order=last_verified_at.desc.nullsfirst&limit=1',
        { serviceRole: true },
      );
      if (r.ok && Array.isArray(r.data) && r.data[0]?.last_verified_at) {
        silverLiningLastVerificationAt = r.data[0].last_verified_at;
      }
    } catch { /* ignore */ }
    silverLiningFailures24h = await countFrom(
      `silver_lining_links?select=id&last_verification_status=in.(error,not_found)&last_verified_at=gte.${encodeURIComponent(since24h)}&limit=1`,
    );
    promoCodesRedeemed24h = await countFrom(
      `promo_codes?select=id&redeemed_at=gte.${encodeURIComponent(since24h)}&limit=1`,
    );
  }

  // Twilio is 'live' when credentials are set AND (either zero dispatches
  // ever OR the most recent dispatch is within the last 7 days). A long
  // gap in dispatches points to a broken integration even if the keys are
  // configured — better to show 'mock' and get a visible signal.
  let twilio = 'mock';
  if (twilioCredsPresent) {
    if (!twilioLastDispatchAt) {
      twilio = 'live';
    } else {
      const ageMs = Date.now() - new Date(twilioLastDispatchAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000) {
        twilio = 'live';
      }
    }
  }

  // Stripe live if the secret is present. Refunds + subscriptions both
  // route through /api/admin/..., so a present key means the panel works.
  const stripeLive = !!secretsPresent.STRIPE_SECRET_KEY;

  const body = {
    shopify,
    hubspot: {
      status:                   hubspotStatus,
      queue_depth:              hubspotQueueDepth,
      dead_letter_count_24h:    hubspotDeadLetter24h,
    },
    admin: {
      audit_writes_24h:         adminAuditWrites24h,
    },
    vet_view: {
      scoped_reads_24h:         vetScopedReads24h,
    },
    workersAi: {
      status: workersAiLive ? 'live' : 'mock',
      chat_p50_latency_ms: chatP50LatencyMs,
      emergency_rate_1h:   emergencyRate1h,
      runs_1h:             chatRuns1h,
    },
    vectorize: {
      status: vectorizeLive ? 'live' : 'mock',
      protocols_indexed: protocolsIndexed,
    },
    twilio: {
      status:                   twilio,
      dispatches_24h:           twilioDispatches24h,
      delivery_failures_24h:    twilioDeliveryFailures24h,
      last_dispatch_at:         twilioLastDispatchAt,
    },
    stripe: {
      status:                   stripeLive ? 'live' : 'mock',
      subscriptions_active_count:   subsActiveCount,
      subscriptions_past_due_count: subsPastDueCount,
    },
    onboarding: {
      invited_count:            invitedCount,
      activated_count:          activatedCount,
    },
    // Phase 8 — Barn Mode observability block.
    barn: {
      events_created_7d:        barnEventsCreated7d,
      external_responses_7d:    barnExternalResponses7d,
      claim_pro_emails_sent_7d: barnClaimProEmails7d,
    },
    health: {
      overdue_count:            healthOverdueCount,
      pdf_exports_7d:           healthPdfExports7d,
    },
    facility: {
      care_matrix_entries_7d:   facilityCareMatrixEntries7d,
    },
    spending: {
      invoice_mirrors_7d:       spendingInvoiceMirrors7d,
    },
    subscriptions: {
      barn_mode_paid_count:     subsBarnModePaidCount,
      barn_mode_comp_count:     subsBarnModeCompCount,
    },
    silver_lining: {
      linked_count:                  silverLiningLinkedCount,
      last_verification_run_at:      silverLiningLastVerificationAt,
      verification_failures_24h:     silverLiningFailures24h,
    },
    promo_codes: {
      redeemed_24h:             promoCodesRedeemed24h,
    },
    r2,
    rate_limiter: {
      // Phase 6.3 — 'durable_object' (post-migration default) serialises
      // per-bucket reads via the RateLimiter DO; 'kv' falls back to the
      // legacy best-effort KV counter. Flag lives in wrangler.toml [vars].
      mode:             rateLimiterMode(env),
      do_binding_ready: Boolean(env.RATE_LIMITER),
    },
    bindings: {
      FLAGS:               Boolean(env.FLAGS),
      ML_RL:               Boolean(env.ML_RL),
      RATE_LIMITER:        Boolean(env.RATE_LIMITER),
      ASSETS:              Boolean(env.ASSETS),
      AI:                  Boolean(env.AI),
      VECTORIZE_PROTOCOLS: Boolean(env.VECTORIZE_PROTOCOLS),
      MANELINE_R2:         r2BindingPresent,
    },
    env: publicEnv,
    secrets_present: secretsPresent,
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* =============================================================
   Phase 1 — R2 uploads
   -------------------------------------------------------------
   Three endpoints, all authenticated via Supabase JWT:

     POST /api/uploads/sign       — browser gets a presigned PUT URL
     POST /api/uploads/commit     — Worker verifies PUT + writes rows
     GET  /api/uploads/read-url   — browser gets a presigned GET URL

   The signed PUT URL is bound to the caller's user id via the
   object_key convention (<user_id>/<kind>/<uuid>.<ext>); commit
   re-checks ownership before inserting r2_objects and the typed row.
   ============================================================= */

const UPLOAD_SIGN_RATE       = { limit: 20, windowSec: 60 };
const UPLOAD_READ_URL_RATE   = { limit: 60, windowSec: 60 };

// Allowed content types per upload kind. We intentionally whitelist —
// no "/*" wildcards — to keep the bucket boring and predictable.
const ALLOWED_CONTENT_TYPES = {
  vet_record: {
    'application/pdf':  'pdf',
    'image/jpeg':       'jpg',
    'image/png':        'png',
    'image/heic':       'heic',
    'image/webp':       'webp',
  },
  animal_photo: {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/heic': 'heic',
    'image/webp': 'webp',
  },
  animal_video: {
    'video/mp4':        'mp4',
    'video/quicktime':  'mov',
  },
  // Phase 7 — trainer invoice-branding logo. Stored in the private records
  // bucket (served to the trainer via the same read-url signed GET as other
  // records; the PDF exporter reads the bytes directly via the R2 binding).
  trainer_logo: {
    'image/png':  'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  },
  // Phase 8 — expense receipt. Owner or trainer with animal-access can
  // attach a receipt file to an expense. The FK lives on
  // expenses.receipt_r2_object_id; commit inserts only r2_objects.
  expense_receipt: {
    'application/pdf': 'pdf',
    'image/jpeg':      'jpg',
    'image/png':       'png',
    'image/heic':      'heic',
    'image/webp':      'webp',
  },
};

// Logos are kept small so the invoice PDF header renders fast. 2 MB is
// plenty for a reasonable bitmap/PNG at print resolution.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Max bytes we'll presign for. Hard cap here and at commit time so a
// leaked signed URL can't be used to dump a 2 GB file into the bucket.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Resolve the Supabase JWT on the request to a user id. Returns
 * { actorId, jwt } on success; throws a `Response` on any failure so
 * the caller can `return err` directly.
 */
async function handleClaimInvite(request, env) {
  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (res) {
    return res;
  }
  return claimInvite(env, request, actorId, jwt);
}

async function handleDismissWelcomeTour(request, env) {
  let actorId;
  try {
    ({ actorId } = await requireOwner(request, env));
  } catch (res) {
    return res;
  }
  return dismissWelcomeTour(env, actorId);
}

async function requireOwner(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw json({ error: 'not_configured' }, 500);
  }
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    throw json({ error: 'unauthorized' }, 401);
  }

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!who.ok) {
    throw json({ error: 'unauthorized' }, 401);
  }
  const whoData = await who.json().catch(() => null);
  const actorId = whoData?.id;
  if (!actorId) {
    throw json({ error: 'unauthorized' }, 401);
  }
  return { actorId, jwt };
}

/**
 * Phase 6.3 — unified rate-limit entry point. Dispatches to the
 * Durable Object implementation by default, or falls back to the
 * legacy KV counter when `env.RATE_LIMITER_MODE === 'kv'` (or the DO
 * binding isn't wired yet — covers local dev against a wrangler.toml
 * that hasn't been updated). Every call site in this Worker routes
 * through here so flipping the flag only touches one line.
 *
 * Returns `{ ok, remaining, resetSec }` — same shape callers already
 * consume. resetSec is derived from the DO's resetMs so existing
 * Retry-After math (seconds) keeps working unchanged.
 */
async function rateLimit(env, bucketKey, { limit, windowSec }) {
  const mode = rateLimiterMode(env);
  if (mode === 'durable_object' && env.RATE_LIMITER) {
    return rateLimitDO(env, bucketKey, { limit, windowSec });
  }
  return rateLimitKv(env.ML_RL, bucketKey, { limit, windowSec });
}

/**
 * Active rate-limiter mode. Drives both the dispatcher above and the
 * `rate_limiter.mode` field on /api/_integrations-health. Treats an
 * unset var as 'durable_object' so a fresh deploy after 6.3 defaults
 * to the DO path without needing an explicit [vars] entry.
 */
function rateLimiterMode(env) {
  const raw = (env.RATE_LIMITER_MODE || '').toString().trim().toLowerCase();
  if (raw === 'kv') return 'kv';
  return 'durable_object';
}

/**
 * Durable Object rate limit. One DO instance per bucket key via
 * `idFromName`, so a hot key serializes against itself and nothing
 * else. blockConcurrencyWhile inside the DO ensures a burst gets a
 * deterministic split (limit × 200, rest × 429) with no slip-through.
 *
 * The DO speaks JSON over a fetch() RPC — we just wrap the response
 * back into the legacy `{ ok, remaining, resetSec }` shape.
 */
async function rateLimitDO(env, bucketKey, { limit, windowSec }) {
  const windowMs = Math.max(1000, windowSec * 1000);
  try {
    const id   = env.RATE_LIMITER.idFromName(bucketKey);
    const stub = env.RATE_LIMITER.get(id);
    const resp = await stub.fetch('https://ratelimiter.internal/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit, windowMs }),
    });
    if (!resp.ok) {
      // DO itself failed — fail-open so a DO outage can't 500 every
      // rate-limited path. Log so we notice via `wrangler tail`.
      console.warn('[rate] DO responded non-2xx, failing open:', resp.status);
      return { ok: true, remaining: limit, resetSec: windowSec };
    }
    const body = await resp.json();
    return {
      ok:        Boolean(body.ok),
      remaining: Number.isFinite(body.remaining) ? body.remaining : 0,
      resetSec:  Math.max(1, Math.ceil((Number(body.resetMs) || 0) / 1000)),
    };
  } catch (err) {
    console.warn('[rate] DO dispatch threw, failing open:', err?.message);
    return { ok: true, remaining: limit, resetSec: windowSec };
  }
}

/**
 * KV-bound rate limit (mirror of the older rateLimit() helper, but
 * keyed off whichever KV binding the caller passes — we use ML_RL for
 * upload paths so the bucket doesn't contend with feature-flag reads).
 *
 * Retained as a fallback when RATE_LIMITER_MODE='kv'. Phase 6.9 deletes
 * this once the DO path has burned in for 24h under real traffic.
 */
async function rateLimitKv(kv, bucketKey, { limit, windowSec }) {
  if (!kv) return { ok: true, remaining: limit, resetSec: windowSec };

  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(bucketKey);
  let state = raw ? safeParse(raw) : null;

  if (!state || typeof state.resetAt !== 'number' || state.resetAt <= now) {
    state = { count: 0, resetAt: now + windowSec };
  }
  state.count += 1;
  const ok = state.count <= limit;

  // Workers KV enforces a 60-second minimum on expirationTtl; anything
  // lower throws `KV PUT failed: 400 Invalid expiration_ttl`. Clamp up
  // so a short rate-limit window near its boundary can't explode the
  // request handler.
  const ttl = Math.max(state.resetAt - now + 60, 60);
  // KV has a 1-write/sec-per-key cap. Under burst, kv.put throws
  // `429 Too Many Requests` — which is itself evidence the key is hot
  // and we're rate-limiting correctly. Swallow it: the in-request
  // `ok` decision (state.count vs limit) is still right. The counter
  // can fall a bit behind real traffic, but that's fine for a best-
  // effort per-minute limit — if we cared about exactness we'd use a
  // Durable Object. See TECH_DEBT(phase-5) for the upgrade path.
  try {
    await kv.put(bucketKey, JSON.stringify(state), { expirationTtl: ttl });
  } catch (err) {
    console.warn('[rate] kv.put failed (burst hot key):', err?.message);
  }

  return {
    ok,
    remaining: Math.max(0, limit - state.count),
    resetSec: Math.max(1, state.resetAt - now),
  };
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback — Workers runtime has randomUUID, but keep this safe.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * Thin Worker-side ownership check. Calls am_i_owner_of(animal_id) via
 * RPC with the CALLER's JWT so RLS and the function's own security
 * barrier do the work for us. Returns true/false; throws `Response` on
 * auth failure so callers can bail cleanly.
 */
async function assertCallerOwnsAnimal(env, userJwt, animalId) {
  const r = await supabaseRpc(
    env,
    'am_i_owner_of',
    { animal_id: animalId },
    { userJwt }
  );
  if (!r.ok) {
    throw json({ error: 'ownership_check_failed' }, 500);
  }
  return r.data === true;
}

/**
 * POST /api/uploads/sign
 *   Body: { kind, content_type, byte_size_estimate, animal_id? }
 *   Resp: { put_url, object_key, expires_in }
 */
async function handleUploadSign(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const kind        = String(body?.kind || '');
  const contentType = String(body?.content_type || '').toLowerCase();
  const byteEstimate = Number(body?.byte_size_estimate || 0);
  const animalId    = body?.animal_id ? String(body.animal_id) : null;

  const kindTypes = ALLOWED_CONTENT_TYPES[kind];
  if (!kindTypes) {
    return json({ error: 'bad_kind', detail: 'kind must be vet_record, animal_photo, animal_video, trainer_logo, or expense_receipt' }, 400);
  }
  const ext = kindTypes[contentType];
  if (!ext) {
    return json({ error: 'bad_content_type', detail: `content_type ${contentType} not allowed for kind ${kind}` }, 415);
  }
  if (!Number.isFinite(byteEstimate) || byteEstimate <= 0 || byteEstimate > MAX_UPLOAD_BYTES) {
    return json({ error: 'bad_byte_size', detail: `byte_size_estimate must be 1..${MAX_UPLOAD_BYTES}` }, 413);
  }

  // Records uploads must always attach to an animal the caller owns;
  // /sign rejects early so we don't waste a signature on an orphan object.
  // trainer_logo and records_export are animal-less by design.
  // expense_receipt widens to trainers with an active grant on the animal,
  // mirroring the expense INSERT policies.
  if (animalId) {
    if (kind === 'expense_receipt') {
      const ok = await supabaseRpc(
        env,
        'do_i_have_access_to_animal',
        { animal_id: animalId },
        { userJwt: jwt }
      );
      if (!ok.ok || ok.data !== true) {
        return json({ error: 'forbidden', detail: 'no access to that animal' }, 403);
      }
    } else {
      const ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
      if (!ownsIt) {
        return json({ error: 'forbidden', detail: 'not the owner of that animal' }, 403);
      }
    }
  } else if (kind !== 'records_export' && kind !== 'trainer_logo') {
    return json({ error: 'bad_request', detail: 'animal_id required for this kind' }, 400);
  }

  // Logo uploads cap at 2 MB — tighter than the 25 MB records ceiling.
  if (kind === 'trainer_logo' && byteEstimate > MAX_LOGO_BYTES) {
    return json({ error: 'bad_byte_size', detail: `trainer_logo max is ${MAX_LOGO_BYTES} bytes` }, 413);
  }

  const rl = await rateLimit(env, `ratelimit:upload_sign:${actorId}`, UPLOAD_SIGN_RATE);
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  const objectId  = uuidv4();
  const objectKey = `${actorId}/${kind}/${objectId}.${ext}`;

  let putUrl;
  try {
    putUrl = await presignPut({
      bucket: 'maneline-records',
      key: objectKey,
      contentType,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      // 120s covers a normal presign→PUT round trip with slack for
      // mobile uploads. Narrower than the previous 300s to reduce
      // the window where a leaked URL (DevTools, MITM, log scrape)
      // can be replayed by an attacker to upload arbitrary content
      // under the actor's prefix. GET presign at line 3913 stays at
      // 300s because embedded signed <img> URLs need to survive
      // between page load and render.
      expiresSec: 120,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  // Audit-log the signing intent. If the browser never follows through
  // with a PUT, r2_objects stays empty — this row is how we reconcile.
  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'upload.sign',
    target_table: 'r2_objects',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { kind, object_key: objectKey, animal_id: animalId, content_type: contentType },
  });

  return json({ put_url: putUrl, object_key: objectKey, expires_in: 300 });
}

/**
 * POST /api/uploads/commit
 *   Body: { object_key, kind, animal_id?, record_type?, issued_on?,
 *           expires_on?, issuing_provider?, caption?, taken_on? }
 *   Resp: { id, r2_object_id }
 *
 * The Worker HEADs the object via the R2 binding (not via the signed
 * URL — we trust the binding and it doesn't need SigV4). If present,
 * we write r2_objects + the typed row in two service_role inserts.
 */
async function handleUploadCommit(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.MANELINE_R2) {
    return json({ error: 'r2_not_configured' }, 500);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const objectKey = String(body?.object_key || '');
  const kind      = String(body?.kind || '');
  const animalId  = body?.animal_id ? String(body.animal_id) : null;

  if (!objectKey || !ALLOWED_CONTENT_TYPES[kind]) {
    return json({ error: 'bad_request' }, 400);
  }
  // object_key is <actorId>/<kind>/<uuid>.<ext> — enforce the actor prefix
  // so a caller can't commit someone else's upload.
  if (!objectKey.startsWith(`${actorId}/${kind}/`)) {
    return json({ error: 'forbidden', detail: 'object_key does not belong to caller' }, 403);
  }

  if (animalId) {
    if (kind === 'expense_receipt') {
      const ok = await supabaseRpc(
        env,
        'do_i_have_access_to_animal',
        { animal_id: animalId },
        { userJwt: jwt }
      );
      if (!ok.ok || ok.data !== true) return json({ error: 'forbidden' }, 403);
    } else {
      const ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
      if (!ownsIt) return json({ error: 'forbidden' }, 403);
    }
  } else if (kind !== 'records_export' && kind !== 'trainer_logo') {
    return json({ error: 'bad_request', detail: 'animal_id required' }, 400);
  }

  // HEAD via binding — confirms the PUT succeeded and gives us the real
  // byte_size + content_type (don't trust the browser's self-report).
  const head = await env.MANELINE_R2.head(objectKey);
  if (!head) {
    return json({ error: 'not_uploaded', detail: 'object not in R2; PUT first' }, 409);
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    // Belt-and-suspenders — presign already caps, but if an attacker
    // finds a way to upload more, we still refuse to record it.
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'too_large' }, 413);
  }
  if (kind === 'trainer_logo' && head.size > MAX_LOGO_BYTES) {
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'too_large' }, 413);
  }
  const contentType = head.httpMetadata?.contentType || 'application/octet-stream';

  // 1. Insert r2_objects (service_role — clients are revoked INSERT).
  const r2Insert = await supabaseInsertReturning(env, 'r2_objects', {
    owner_id:     actorId,
    bucket:       'maneline-records',
    object_key:   objectKey,
    kind,
    content_type: contentType,
    byte_size:    head.size,
  });
  if (!r2Insert.ok || !r2Insert.data?.id) {
    return json({ error: 'db_write_failed', detail: r2Insert.data || 'r2_objects insert' }, 500);
  }
  const r2ObjectId = r2Insert.data.id;

  // 2. Insert the typed row.
  let typedInsert = { ok: true, data: null };
  if (kind === 'vet_record') {
    const recordType = String(body?.record_type || '');
    const allowed = ['coggins', 'vaccine', 'dental', 'farrier', 'other'];
    if (!allowed.includes(recordType)) {
      // Rollback r2_objects so we don't leave orphans.
      await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
      await env.MANELINE_R2.delete(objectKey).catch(() => {});
      return json({ error: 'bad_record_type' }, 400);
    }
    typedInsert = await supabaseInsertReturning(env, 'vet_records', {
      owner_id:         actorId,
      animal_id:        animalId,
      r2_object_id:     r2ObjectId,
      record_type:      recordType,
      issued_on:        body?.issued_on || null,
      expires_on:       body?.expires_on || null,
      issuing_provider: body?.issuing_provider || null,
      notes:            body?.notes || null,
    });
  } else if (kind === 'animal_photo' || kind === 'animal_video') {
    typedInsert = await supabaseInsertReturning(env, 'animal_media', {
      owner_id:     actorId,
      animal_id:    animalId,
      r2_object_id: r2ObjectId,
      kind:         kind === 'animal_photo' ? 'photo' : 'video',
      caption:      body?.caption || null,
      taken_on:     body?.taken_on || null,
    });
  } else if (kind === 'trainer_logo') {
    // Phase 7 branding: no typed row — the logo pointer lives on
    // trainer_profiles. Swap the key and best-effort delete the old
    // object so we don't leak bytes on re-upload.
    const prior = await supabaseSelect(
      env,
      'trainer_profiles',
      `select=invoice_logo_r2_key&user_id=eq.${actorId}&limit=1`,
      { serviceRole: true }
    );
    const priorKey = Array.isArray(prior.data) ? prior.data[0]?.invoice_logo_r2_key : null;

    const upd = await supabaseUpdateReturning(
      env,
      'trainer_profiles',
      `user_id=eq.${actorId}`,
      { invoice_logo_r2_key: objectKey }
    );
    if (!upd.ok) {
      await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
      await env.MANELINE_R2.delete(objectKey).catch(() => {});
      return json({ error: 'db_write_failed', detail: 'trainer_profiles update' }, 500);
    }
    // If the trainer had no trainer_profiles row yet (signup trigger
    // skipped, or manual demo-seed path), UPDATE returns 200 with an
    // empty array — PostgREST's idea of "no rows matched." Fall back to
    // an INSERT so the logo pointer actually lands somewhere. user_id has
    // a unique constraint, so this is safe against concurrent uploads.
    if (!upd.data) {
      const ins = await supabaseInsertReturning(env, 'trainer_profiles', {
        user_id: actorId,
        invoice_logo_r2_key: objectKey,
      });
      if (!ins.ok || !ins.data?.id) {
        await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
        await env.MANELINE_R2.delete(objectKey).catch(() => {});
        return json({ error: 'db_write_failed', detail: 'trainer_profiles insert' }, 500);
      }
    }

    if (priorKey && priorKey !== objectKey) {
      await env.MANELINE_R2.delete(priorKey).catch(() => {});
      await supabaseDelete(
        env,
        'r2_objects',
        `owner_id=eq.${actorId}&object_key=eq.${encodeURIComponent(priorKey)}`
      );
    }

    ctx_audit(env, {
      actor_id: actorId,
      actor_role: 'trainer',
      action: 'branding.logo_upload',
      target_table: 'trainer_profiles',
      target_id: actorId,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
      metadata: { r2_object_id: r2ObjectId, object_key: objectKey, prior_key: priorKey },
    });

    return json({ id: actorId, r2_object_id: r2ObjectId });
  } else if (kind === 'expense_receipt') {
    // No typed row — the FK lives on expenses.receipt_r2_object_id and
    // is set by the subsequent createExpense call. The r2_objects row is
    // the durable handle; orphaning is OK (owner never saved the expense).
    ctx_audit(env, {
      actor_id: actorId,
      actor_role: 'owner',
      action: 'expense.receipt_upload',
      target_table: 'r2_objects',
      target_id: r2ObjectId,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
      metadata: { r2_object_id: r2ObjectId, object_key: objectKey, animal_id: animalId },
    });
    return json({ id: r2ObjectId, r2_object_id: r2ObjectId });
  }

  if (!typedInsert.ok || !typedInsert.data?.id) {
    await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'db_write_failed', detail: typedInsert.data || 'typed insert' }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'records.upload',
    target_table: kind === 'vet_record' ? 'vet_records' : 'animal_media',
    target_id: typedInsert.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { r2_object_id: r2ObjectId, object_key: objectKey, kind },
  });

  return json({ id: typedInsert.data.id, r2_object_id: r2ObjectId });
}

/**
 * GET /api/uploads/read-url?object_key=<url-encoded>
 *   Resp: { get_url, expires_in }
 */
async function handleUploadReadUrl(request, env, url) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  const objectKey = url.searchParams.get('object_key') || '';
  if (!objectKey) {
    return json({ error: 'bad_request', detail: 'object_key required' }, 400);
  }

  const rl = await rateLimit(env, `ratelimit:read_url:${actorId}`, UPLOAD_READ_URL_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });
  }

  // Resolve the r2_objects row (service_role — lets us reach both
  // owner-owned and trainer-accessible objects in one query).
  const r = await supabaseSelect(
    env,
    'r2_objects',
    `select=id,owner_id,kind,bucket,object_key&object_key=eq.${encodeURIComponent(objectKey)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) {
    return json({ error: 'not_found' }, 404);
  }

  // Access check. Owners pass trivially. Trainers must hold an active
  // grant on the linked animal — we look up the animal via the typed
  // table and call do_i_have_access_to_animal() with the caller's JWT.
  let allowed = row.owner_id === actorId;
  if (!allowed) {
    let animalId = null;
    if (row.kind === 'vet_record') {
      const vr = await supabaseSelect(
        env,
        'vet_records',
        `select=animal_id&r2_object_id=eq.${row.id}&limit=1`,
        { serviceRole: true }
      );
      animalId = Array.isArray(vr.data) ? vr.data[0]?.animal_id : null;
    } else if (row.kind === 'animal_photo' || row.kind === 'animal_video') {
      const am = await supabaseSelect(
        env,
        'animal_media',
        `select=animal_id&r2_object_id=eq.${row.id}&limit=1`,
        { serviceRole: true }
      );
      animalId = Array.isArray(am.data) ? am.data[0]?.animal_id : null;
    } else if (row.kind === 'expense_receipt') {
      const ex = await supabaseSelect(
        env,
        'expenses',
        `select=animal_id&receipt_r2_object_id=eq.${row.id}&limit=1`,
        { serviceRole: true }
      );
      animalId = Array.isArray(ex.data) ? ex.data[0]?.animal_id : null;
    }
    if (animalId) {
      const ok = await supabaseRpc(
        env,
        'do_i_have_access_to_animal',
        { animal_id: animalId },
        { userJwt: jwt }
      );
      allowed = ok.ok && ok.data === true;
    }
  }
  if (!allowed) {
    return json({ error: 'forbidden' }, 403);
  }

  let getUrl;
  try {
    getUrl = await presignGet({
      bucket: row.bucket,
      key: row.object_key,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      expiresSec: 300,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: row.owner_id === actorId ? 'owner' : 'trainer',
    action: 'records.read_url',
    target_table: 'r2_objects',
    target_id: row.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { object_key: row.object_key, kind: row.kind },
  });

  return json({ get_url: getUrl, expires_in: 300 });
}

/* =============================================================
   Supabase helpers — returning inserts + delete + audit
   (The basic select/insert/rpc variants are defined earlier.)
   ============================================================= */

async function supabaseInsertReturning(env, table, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { ok: res.ok, status: res.status, data };
}

async function supabaseDelete(env, table, filterQuery) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return { ok: res.ok, status: res.status };
}

/**
 * Fire-and-forget audit_log insert. Does not block the response path —
 * failures are logged but never surface to the client.
 */
function ctx_audit(env, row, ctx) {
  const p = supabaseInsert(env, 'audit_log', row).catch((err) =>
    console.warn('[audit] insert failed:', err?.message)
  );
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

async function supabaseUpdateReturning(env, table, filterQuery, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { ok: res.ok, status: res.status, data };
}

/* =============================================================
   /api/animals/archive   and   /api/animals/unarchive
   -------------------------------------------------------------
   Atomic archive toggle + audit event, so animals.archived_at
   and animal_archive_events never diverge. OAG §8.

   Flow:
     1. requireOwner — caller must hold a valid Supabase JWT.
     2. assertCallerOwnsAnimal — RPC check (am_i_owner_of) so
        trainers/other owners can't toggle archive state.
     3. service_role UPDATE animals.archived_at (= now() | null).
     4. service_role INSERT animal_archive_events row.
     5. audit_log fire-and-forget.
   ============================================================= */
const ARCHIVE_RATE = { limit: 10, windowSec: 60 };

async function handleAnimalArchive(request, env) {
  return handleAnimalArchiveToggle(request, env, 'archive');
}

async function handleAnimalUnarchive(request, env) {
  return handleAnimalArchiveToggle(request, env, 'unarchive');
}

async function handleAnimalArchiveToggle(request, env, action) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:animal_archive:${actorId}`,
    ARCHIVE_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const animalId = typeof body?.animal_id === 'string' ? body.animal_id : '';
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!animalId) {
    return json({ error: 'animal_id required' }, 400);
  }
  if (action === 'archive' && reasonRaw.length === 0) {
    // Required so the audit trail is worth reading a year from now.
    return json({ error: 'reason_required' }, 400);
  }

  let ownsIt;
  try {
    ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  if (!ownsIt) {
    return json({ error: 'forbidden' }, 403);
  }

  const patch =
    action === 'archive'
      ? { archived_at: new Date().toISOString() }
      : { archived_at: null };

  const upd = await supabaseUpdateReturning(
    env,
    'animals',
    `id=eq.${encodeURIComponent(animalId)}`,
    patch
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'animal_update_failed', status: upd.status }, 500);
  }

  const evt = await supabaseInsertReturning(env, 'animal_archive_events', {
    animal_id: animalId,
    actor_id:  actorId,
    action,
    reason:    action === 'archive' ? reasonRaw : null,
  });
  if (!evt.ok) {
    // The timestamp UPDATE already succeeded. We still return the fresh
    // animal — audit coverage is a soft failure that will show up in
    // logs, and the animals table remains the source of truth.
    console.warn('[archive] audit event insert failed', { status: evt.status });
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       action === 'archive' ? 'animal.archive' : 'animal.unarchive',
    target_table: 'animals',
    target_id:    animalId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     action === 'archive' ? { reason: reasonRaw } : {},
  });

  return json({ animal: upd.data });
}

/* =============================================================
   /api/sessions/archive
   -------------------------------------------------------------
   Trainer soft-archives one of their own training_sessions rows,
   mirroring the animal archive flow. OAG §8 — no hard deletes.

   Flow:
     1. requireOwner — valid Supabase JWT.
     2. Verify the caller is the trainer on the session AND still
        has access to the animal — same contract RLS enforces on
        writes, but we do it via service_role here so we can write
        session_archive_events atomically (that table's RLS bars
        client INSERT).
     3. service_role UPDATE training_sessions.archived_at = now().
     4. service_role INSERT session_archive_events audit row.
     5. audit_log fire-and-forget.
   ============================================================= */
const SESSION_ARCHIVE_RATE = { limit: 20, windowSec: 60 };

async function handleSessionArchive(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:session_archive:${actorId}`,
    SESSION_ARCHIVE_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!sessionId) return json({ error: 'session_id required' }, 400);
  if (reasonRaw.length === 0) return json({ error: 'reason_required' }, 400);

  // Ownership check: trainer_id must match the caller AND the trainer
  // must still have access to the animal. We use the caller's JWT on
  // the SELECT so RLS narrows the read — if the row comes back, the
  // trainer still holds a grant. An independent check avoids a TOCTOU
  // where a service_role UPDATE would bypass the access helper.
  const lookup = await supabaseSelect(
    env,
    'training_sessions',
    `select=id,trainer_id,animal_id,status,archived_at&id=eq.${encodeURIComponent(sessionId)}`,
    { userJwt: jwt }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.trainer_id !== actorId) return json({ error: 'forbidden' }, 403);
  if (row.archived_at) return json({ error: 'already_archived' }, 409);
  if (row.status !== 'logged') {
    // Archiving a session that's been approved/paid would strand a
    // session_payment row pointing at an invisible session. Prompt 2.7
    // +2.8 handle that lifecycle; for now, lock archive to 'logged'.
    return json({ error: 'not_archivable', status: row.status }, 409);
  }

  const upd = await supabaseUpdateReturning(
    env,
    'training_sessions',
    `id=eq.${encodeURIComponent(sessionId)}`,
    { archived_at: new Date().toISOString() }
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'session_update_failed', status: upd.status }, 500);
  }

  const evt = await supabaseInsertReturning(env, 'session_archive_events', {
    session_id: sessionId,
    actor_id:   actorId,
    action:     'archive',
    reason:     reasonRaw,
  });
  if (!evt.ok) {
    console.warn('[session_archive] audit event insert failed', { status: evt.status });
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'trainer',
    action:       'session.archive',
    target_table: 'training_sessions',
    target_id:    sessionId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { reason: reasonRaw },
  });

  return json({ session: upd.data });
}

/* =============================================================
   /api/expenses/archive
   -------------------------------------------------------------
   Soft-archive an expense row. Either the owner of the underlying
   animal OR a trainer with an active grant + authorship on the row
   can archive — access is encapsulated in the
   is_expense_owner_or_granted_trainer helper (migration 00009:391).

   Flow:
     1. requireOwner — valid Supabase JWT.
     2. SELECT the expense with the caller's JWT so RLS narrows
        reads. If the row comes back, the caller can SEE it.
     3. Additional fine-grained check via the helper RPC — blocks
        "I can see this because I'm the animal owner, but someone
        else authored it" UPDATE attempts before the RLS UPDATE
        policy does (clearer 403 vs. silent no-op).
     4. service_role UPDATE expenses.archived_at = now().
     5. service_role INSERT expense_archive_events audit row.
     6. audit_log fire-and-forget.

   OAG §8: no hard deletes; every archive writes an append-only
   event row.
   ============================================================= */
const EXPENSE_ARCHIVE_RATE = { limit: 30, windowSec: 60 };

async function handleExpenseArchive(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:expense_archive:${actorId}`,
    EXPENSE_ARCHIVE_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const expenseId = typeof body?.expense_id === 'string' ? body.expense_id : '';
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!expenseId) return json({ error: 'expense_id required' }, 400);

  // Caller-scoped SELECT via RLS confirms they can at least SEE the
  // row. Owners see any row on their animal; trainers see rows on
  // granted animals (regardless of authorship).
  const lookup = await supabaseSelect(
    env,
    'expenses',
    `select=id,recorder_id,recorder_role,animal_id,archived_at&id=eq.${encodeURIComponent(expenseId)}`,
    { userJwt: jwt }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.archived_at) return json({ error: 'already_archived' }, 409);

  // Authorship check: owners can archive any row on their animal,
  // trainers can only archive rows they authored. Mirrors the
  // split in the UPDATE policies (00009:269-308).
  // We can infer the caller's role by comparing recorder_id to
  // actorId AND recorder_role; for an owner, the animals_owner_select
  // side of the SELECT RLS means row visibility implies ownership.
  // For a trainer, visibility implies an active grant — but the
  // UPDATE policy additionally requires recorder_id = auth.uid().
  // We enforce the stricter of the two here for a cleaner 403.
  if (row.recorder_role === 'trainer' && row.recorder_id !== actorId) {
    return json({ error: 'forbidden' }, 403);
  }

  const upd = await supabaseUpdateReturning(
    env,
    'expenses',
    `id=eq.${encodeURIComponent(expenseId)}`,
    { archived_at: new Date().toISOString() }
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'expense_update_failed', status: upd.status }, 500);
  }

  const evt = await supabaseInsertReturning(env, 'expense_archive_events', {
    expense_id: expenseId,
    actor_id:   actorId,
    action:     'archive',
    reason:     reasonRaw || null,
  });
  if (!evt.ok) {
    console.warn('[expense_archive] audit event insert failed', { status: evt.status });
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   row.recorder_role === 'trainer' && row.recorder_id === actorId
                    ? 'trainer' : 'owner',
    action:       'expense.archive',
    target_table: 'expenses',
    target_id:    expenseId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { reason: reasonRaw || null },
  });

  return json({ expense: upd.data });
}

/* =============================================================
   /api/records/export-pdf
   -------------------------------------------------------------
   Renders a single-animal, N-day records PDF server-side, uploads
   it to R2 under kind='records_export', returns a 15-minute signed
   GET URL so the owner can download + send.

   Body: { animal_id, window_days: 30 | 90 | 365 }

   Rate: 5 req / 5 min per caller — PDF render is not cheap.
   ============================================================= */
const RECORDS_EXPORT_RATE = { limit: 5, windowSec: 300 };
const RECORDS_EXPORT_ALLOWED_WINDOWS = new Set([30, 90, 365]);

async function handleRecordsExport(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.MANELINE_R2 || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:records_export:${actorId}`,
    RECORDS_EXPORT_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const animalId = typeof body?.animal_id === 'string' ? body.animal_id : '';
  const windowDays = Number(body?.window_days ?? 365);
  if (!animalId) return json({ error: 'animal_id required' }, 400);
  if (!RECORDS_EXPORT_ALLOWED_WINDOWS.has(windowDays)) {
    return json({ error: 'bad_window_days', allowed: [30, 90, 365] }, 400);
  }

  try {
    const ok = await assertCallerOwnsAnimal(env, jwt, animalId);
    if (!ok) return json({ error: 'forbidden' }, 403);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  // ---- Gather source rows via service_role ----
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceIso = since.toISOString();

  const [animalR, ownerR, vetR, r2R, mediaCountR] = await Promise.all([
    supabaseSelect(
      env,
      'animals',
      `select=id,barn_name,species,breed,year_born,discipline,owner_id&id=eq.${encodeURIComponent(animalId)}&limit=1`,
      { serviceRole: true }
    ),
    // We use the animals row's owner_id to look up display_name.
    // Parallelizing means we don't wait for the animal lookup first —
    // the owner lookup runs speculatively against the caller's id and
    // turns out to be the same row (owner uploading their own).
    supabaseSelect(
      env,
      'user_profiles',
      `select=display_name&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
      { serviceRole: true }
    ),
    supabaseSelect(
      env,
      'vet_records',
      `select=id,record_type,issued_on,expires_on,issuing_provider,notes,created_at,r2_object_id` +
        `&animal_id=eq.${encodeURIComponent(animalId)}&archived_at=is.null&created_at=gte.${encodeURIComponent(sinceIso)}` +
        `&order=issued_on.desc.nullslast,created_at.desc`,
      { serviceRole: true }
    ),
    // We'll resolve filenames via a follow-up query once we know the ids.
    Promise.resolve(null),
    supabaseSelect(
      env,
      'animal_media',
      `select=id&animal_id=eq.${encodeURIComponent(animalId)}&archived_at=is.null`,
      { serviceRole: true }
    ),
  ]);

  const animal = Array.isArray(animalR.data) ? animalR.data[0] : null;
  if (!animal) return json({ error: 'animal_not_found' }, 404);
  const ownerName = Array.isArray(ownerR.data) ? ownerR.data[0]?.display_name : null;
  const vetRows = Array.isArray(vetR.data) ? vetR.data : [];
  const mediaCount = Array.isArray(mediaCountR.data) ? mediaCountR.data.length : 0;

  // Resolve object_key → filename ("coggins-2026-04-02.pdf"-style) for
  // each vet record. We only print the basename — the file itself is
  // never embedded, so this is just a pointer for the vet/buyer.
  let fileNameByObjectId = new Map();
  if (vetRows.length > 0) {
    const ids = Array.from(new Set(vetRows.map((r) => r.r2_object_id)));
    const r2 = await supabaseSelect(
      env,
      'r2_objects',
      `select=id,object_key&id=in.(${ids.map((x) => encodeURIComponent(x)).join(',')})`,
      { serviceRole: true }
    );
    for (const row of r2.data || []) {
      const key = row.object_key || '';
      const base = key.split('/').pop() || key;
      fileNameByObjectId.set(row.id, base);
    }
  }
  const vetRecords = vetRows.map((r) => ({
    ...r,
    filename: fileNameByObjectId.get(r.r2_object_id) || null,
  }));
  // Void the placeholder to keep lint happy.
  void r2R;

  // ---- Render PDF ----
  let pdfBytes;
  try {
    pdfBytes = renderRecordsPdf({
      animal,
      ownerName,
      windowDays,
      vetRecords,
      mediaCount,
    });
  } catch (err) {
    return json({ error: 'render_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  // ---- Upload to R2 ----
  const objectId  = uuidv4();
  const objectKey = `${actorId}/records_export/${objectId}.pdf`;
  try {
    await env.MANELINE_R2.put(objectKey, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
  } catch (err) {
    return json({ error: 'r2_put_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  const r2Insert = await supabaseInsertReturning(env, 'r2_objects', {
    owner_id:     actorId,
    bucket:       'maneline-records',
    object_key:   objectKey,
    kind:         'records_export',
    content_type: 'application/pdf',
    byte_size:    pdfBytes.length,
  });
  if (!r2Insert.ok) {
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'db_write_failed' }, 500);
  }

  // 15-minute signed GET so the owner has time to download + forward.
  let getUrl;
  try {
    getUrl = await presignGet({
      bucket: 'maneline-records',
      key: objectKey,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      expiresSec: 900,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'records.export',
    target_table: 'animals',
    target_id:    animalId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { window_days: windowDays, object_key: objectKey, vet_count: vetRecords.length },
  });

  return json({
    object_key:  objectKey,
    get_url:     getUrl,
    expires_in:  900,
    record_count: vetRecords.length,
  });
}

/* =============================================================
   /api/access/grant   and   /api/access/revoke
   -------------------------------------------------------------
   Owners choose who sees their animals (§2.2 of the feature
   map). Grants are scoped to a single animal, a whole ranch, or
   every animal the owner has. Revocation is soft — revoked_at +
   grace_period_ends_at keep the trainer's read access alive
   through a countdown visible in the UI.

   Both endpoints audit under action='access.grant' /
   'access.revoke' with the grant id + scope.
   ============================================================= */
const ACCESS_RATE = { limit: 10, windowSec: 60 };
const ACCESS_SCOPES = new Set(['animal', 'ranch', 'owner_all']);
const GRACE_DAYS_DEFAULT = 7;
const GRACE_DAYS_MAX = 30;

async function handleAccessGrant(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(env, `ratelimit:access_grant:${actorId}`, ACCESS_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const trainerEmail = typeof body?.trainer_email === 'string'
    ? body.trainer_email.trim().toLowerCase()
    : '';
  const scope = typeof body?.scope === 'string' ? body.scope : '';
  const animalId = typeof body?.animal_id === 'string' && body.animal_id ? body.animal_id : null;
  const ranchId  = typeof body?.ranch_id  === 'string' && body.ranch_id  ? body.ranch_id  : null;
  const notes    = typeof body?.notes     === 'string' ? body.notes.trim() : null;

  if (!trainerEmail)      return json({ error: 'trainer_email required' }, 400);
  if (!ACCESS_SCOPES.has(scope)) return json({ error: 'bad_scope', allowed: [...ACCESS_SCOPES] }, 400);
  if (scope === 'animal' && !animalId) return json({ error: 'animal_id required for scope=animal' }, 400);
  if (scope === 'ranch'  && !ranchId)  return json({ error: 'ranch_id required for scope=ranch' }, 400);

  if (scope === 'animal') {
    let ok;
    try {
      ok = await assertCallerOwnsAnimal(env, jwt, animalId);
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }
    if (!ok) return json({ error: 'forbidden' }, 403);
  } else if (scope === 'ranch') {
    const r = await supabaseSelect(
      env,
      'ranches',
      `select=id&id=eq.${encodeURIComponent(ranchId)}&owner_id=eq.${encodeURIComponent(actorId)}&limit=1`,
      { serviceRole: true }
    );
    if (!r.ok) return json({ error: 'ranch_check_failed' }, 500);
    if (!Array.isArray(r.data) || r.data.length === 0) return json({ error: 'forbidden' }, 403);
  }

  // Resolve the trainer by email. Must exist in user_profiles as an
  // active trainer AND have an approved trainer_profiles row.
  const userLookup = await supabaseSelect(
    env,
    'user_profiles',
    `select=user_id,role,status,display_name&email=eq.${encodeURIComponent(trainerEmail)}&limit=1`,
    { serviceRole: true }
  );
  if (!userLookup.ok) return json({ error: 'trainer_lookup_failed' }, 500);
  const profile = Array.isArray(userLookup.data) ? userLookup.data[0] : null;
  if (!profile || profile.role !== 'trainer' || profile.status !== 'active') {
    return json({ error: 'trainer_not_found' }, 404);
  }

  const tpLookup = await supabaseSelect(
    env,
    'trainer_profiles',
    `select=application_status&user_id=eq.${encodeURIComponent(profile.user_id)}&limit=1`,
    { serviceRole: true }
  );
  if (!tpLookup.ok) return json({ error: 'trainer_lookup_failed' }, 500);
  const tp = Array.isArray(tpLookup.data) ? tpLookup.data[0] : null;
  if (!tp || tp.application_status !== 'approved') {
    return json({ error: 'trainer_not_approved' }, 404);
  }

  const insert = await supabaseInsertReturning(env, 'animal_access_grants', {
    owner_id:   actorId,
    trainer_id: profile.user_id,
    scope,
    animal_id:  scope === 'animal' ? animalId : null,
    ranch_id:   scope === 'ranch'  ? ranchId  : null,
    notes:      notes || null,
  });
  if (!insert.ok || !insert.data) {
    // Phase 9 — the DB trigger raises P0001 `trainer_pro_required: ...`
    // when the grant would push the trainer over the 5-horse free cap.
    // Propagate as a 402 so the SPA can show the trainer-pro paywall
    // and the owner a "this trainer needs to subscribe" message.
    const errMsg = typeof insert.data?.message === 'string' ? insert.data.message : '';
    if (errMsg.startsWith('trainer_pro_required')) {
      return json({
        error: 'trainer_pro_required',
        message: 'This trainer has reached the free plan limit of 5 horses and needs Trainer Pro to take on additional clients.',
        trainer_id: profile.user_id,
      }, 402);
    }
    return json({ error: 'grant_insert_failed', status: insert.status }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'access.grant',
    target_table: 'animal_access_grants',
    target_id:    insert.data.id,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     {
      scope,
      trainer_id: profile.user_id,
      trainer_email: trainerEmail,
      animal_id: animalId,
      ranch_id:  ranchId,
    },
  });

  // TECH_DEBT(phase-2): wire the Gmail relay here. Until the
  // integration is live, the audit row above is the notification
  // trail; the trainer will see the grant appear in their dashboard
  // on next sign-in.

  return json({
    grant: insert.data,
    trainer: {
      user_id: profile.user_id,
      display_name: profile.display_name,
      email: trainerEmail,
    },
  });
}

async function handleAccessRevoke(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId;
  try {
    ({ actorId } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(env, `ratelimit:access_revoke:${actorId}`, ACCESS_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const grantId = typeof body?.grant_id === 'string' ? body.grant_id : '';
  if (!grantId) return json({ error: 'grant_id required' }, 400);

  let graceDays = Number(body?.grace_days ?? GRACE_DAYS_DEFAULT);
  if (!Number.isFinite(graceDays) || graceDays < 0) graceDays = GRACE_DAYS_DEFAULT;
  if (graceDays > GRACE_DAYS_MAX) graceDays = GRACE_DAYS_MAX;

  // Confirm the grant belongs to the caller. We scope the PATCH by
  // owner_id below too so a wrong id can never flip someone else's
  // grant — the pre-read just lets us return a clean 404.
  const precheck = await supabaseSelect(
    env,
    'animal_access_grants',
    `select=id,owner_id,trainer_id,scope&id=eq.${encodeURIComponent(grantId)}&limit=1`,
    { serviceRole: true }
  );
  if (!precheck.ok) return json({ error: 'grant_lookup_failed' }, 500);
  const existing = Array.isArray(precheck.data) ? precheck.data[0] : null;
  if (!existing) return json({ error: 'not_found' }, 404);
  if (existing.owner_id !== actorId) return json({ error: 'forbidden' }, 403);

  const now = new Date();
  const graceEnds = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const patch = {
    revoked_at: now.toISOString(),
    grace_period_ends_at: graceEnds.toISOString(),
  };

  const upd = await supabaseUpdateReturning(
    env,
    'animal_access_grants',
    `id=eq.${encodeURIComponent(grantId)}&owner_id=eq.${encodeURIComponent(actorId)}`,
    patch
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'grant_update_failed', status: upd.status }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'access.revoke',
    target_table: 'animal_access_grants',
    target_id:    grantId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     {
      scope:      existing.scope,
      trainer_id: existing.trainer_id,
      grace_days: graceDays,
    },
  });

  return json({ grant: upd.data });
}

/* =============================================================
   Admin fee helpers — called from handleAdmin() dispatcher.
   -------------------------------------------------------------
   All three helpers assume the caller has already been verified
   as an active silver_lining admin. Every change writes a
   separate audit_log row with prev + new values so we can
   reconstruct the fee history in an incident review.
   ============================================================= */

async function adminFeesGet(env) {
  const settings = await supabaseSelect(
    env,
    'platform_settings',
    'select=id,default_fee_bps,updated_by,updated_at&id=eq.1',
    { serviceRole: true }
  );
  if (!settings.ok) return json({ error: 'settings_fetch_failed' }, 500);
  const defaultRow = Array.isArray(settings.data) ? settings.data[0] : null;

  const overrides = await supabaseSelect(
    env,
    'stripe_connect_accounts',
    'select=id,trainer_id,fee_override_bps,fee_override_reason,fee_override_set_by,fee_override_set_at' +
      '&fee_override_bps=not.is.null&deactivated_at=is.null&order=fee_override_set_at.desc',
    { serviceRole: true }
  );
  if (!overrides.ok) return json({ error: 'overrides_fetch_failed' }, 500);

  const rows = Array.isArray(overrides.data) ? overrides.data : [];
  const trainerIds = Array.from(new Set(rows.map((r) => r.trainer_id).filter(Boolean)));
  let nameMap = new Map();
  if (trainerIds.length > 0) {
    const names = await supabaseSelect(
      env,
      'user_profiles',
      `select=user_id,display_name,email&user_id=in.(${trainerIds.map(encodeURIComponent).join(',')})`,
      { serviceRole: true }
    );
    if (names.ok && Array.isArray(names.data)) {
      for (const n of names.data) {
        nameMap.set(n.user_id, n.display_name || n.email || 'Trainer');
      }
    }
  }

  return json({
    default_fee_bps: defaultRow?.default_fee_bps ?? 1000,
    default_updated_at: defaultRow?.updated_at ?? null,
    default_updated_by: defaultRow?.updated_by ?? null,
    overrides: rows.map((r) => ({
      trainer_id:       r.trainer_id,
      trainer_name:     nameMap.get(r.trainer_id) ?? 'Trainer',
      fee_override_bps: r.fee_override_bps,
      reason:           r.fee_override_reason,
      set_by:           r.fee_override_set_by,
      set_at:           r.fee_override_set_at,
    })),
  });
}

async function adminFeesSetDefault(request, env, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const bps = Number(body?.default_fee_bps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    return json({ error: 'bad_default_fee_bps', detail: 'integer 0..10000' }, 400);
  }

  // Capture the old value for the audit row.
  const prev = await supabaseSelect(
    env,
    'platform_settings',
    'select=default_fee_bps&id=eq.1',
    { serviceRole: true }
  );
  const prevBps = Array.isArray(prev.data) && prev.data[0]
    ? prev.data[0].default_fee_bps
    : null;

  const upd = await supabaseUpdateReturning(
    env,
    'platform_settings',
    'id=eq.1',
    { default_fee_bps: bps, updated_by: actorId }
  );
  if (!upd.ok) return json({ error: 'update_failed', status: upd.status }, 500);

  // Fire-and-forget a structured audit row alongside the default handleAdmin
  // log so the prev + new values are captured atomically.
  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.platform_fees.default.update',
    target_table: 'platform_settings',
    target_id:    '1',
    metadata:     { prev_bps: prevBps, new_bps: bps },
  });

  return json({ default_fee_bps: bps });
}

async function adminFeesSetTrainerOverride(request, env, actorId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const trainerId = typeof body?.trainer_id === 'string' ? body.trainer_id : '';
  if (!trainerId) return json({ error: 'trainer_id required' }, 400);

  let overrideBps = body?.fee_override_bps;
  if (overrideBps !== null) {
    overrideBps = Number(overrideBps);
    if (!Number.isInteger(overrideBps) || overrideBps < 0 || overrideBps > 10000) {
      return json({ error: 'bad_fee_override_bps', detail: 'integer 0..10000 or null' }, 400);
    }
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

  const existing = await supabaseSelect(
    env,
    'stripe_connect_accounts',
    `select=id,trainer_id,fee_override_bps,fee_override_reason&trainer_id=eq.${encodeURIComponent(trainerId)}&deactivated_at=is.null&limit=1`,
    { serviceRole: true }
  );
  if (!existing.ok) return json({ error: 'trainer_lookup_failed' }, 500);
  const row = Array.isArray(existing.data) ? existing.data[0] : null;
  if (!row) return json({ error: 'trainer_has_no_connect_account' }, 404);

  const patch = {
    fee_override_bps:     overrideBps,
    fee_override_reason:  overrideBps === null ? null : reason,
    fee_override_set_by:  actorId,
    fee_override_set_at:  new Date().toISOString(),
  };

  const upd = await supabaseUpdateReturning(
    env,
    'stripe_connect_accounts',
    `id=eq.${encodeURIComponent(row.id)}`,
    patch
  );
  if (!upd.ok) return json({ error: 'update_failed', status: upd.status }, 500);

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.platform_fees.trainer_override.update',
    target_table: 'stripe_connect_accounts',
    target_id:    row.id,
    metadata: {
      trainer_id: trainerId,
      prev_bps:   row.fee_override_bps,
      new_bps:    overrideBps,
      reason,
    },
  });

  return json({
    trainer_id:       trainerId,
    fee_override_bps: overrideBps,
    reason:           overrideBps === null ? null : reason,
  });
}

/* =============================================================
   /api/stripe/connect/*  — trainer onboarding for Stripe Express
   -------------------------------------------------------------
   These endpoints all require a valid trainer JWT. Writes to
   stripe_connect_accounts go through service_role (RLS blocks
   authenticated writes per migration 00006:205).

   When STRIPE_SECRET_KEY is not set the handlers short-circuit
   with 501 stripe_not_configured so the SPA can render a
   "waiting on keys" state without a 500.

   TECH_DEBT(phase-2): Stripe keys are placeholders until the
   company's payment processor is verified. See docs/TECH_DEBT.md
   and worker/stripe.js.
   ============================================================= */
const STRIPE_CONNECT_RATE = { limit: 10, windowSec: 60 };

async function getLatestConnectForTrainer(env, trainerId) {
  const r = await supabaseSelect(
    env,
    'stripe_connect_accounts',
    `select=id,trainer_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted,disabled_reason,onboarding_link_last_issued_at,deactivated_at,created_at,updated_at&trainer_id=eq.${encodeURIComponent(trainerId)}&deactivated_at=is.null&order=created_at.desc&limit=1`,
    { serviceRole: true }
  );
  if (!r.ok) return null;
  return Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null;
}

function stripeReturnBaseUrl(url) {
  // Use the Worker's host so the Stripe redirect lands somewhere that
  // exists in production; local dev users hit the SPA directly so
  // `/api/stripe/connect/return` will still resolve.
  return `${url.protocol}//${url.host}`;
}

async function handleStripeConnectOnboard(request, env, url) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  void jwt;

  if (!isStripeConfigured(env)) {
    return json({ error: 'stripe_not_configured' }, 501);
  }

  const rl = await rateLimit(
    env,
    `ratelimit:stripe_connect_onboard:${actorId}`,
    STRIPE_CONNECT_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  // Confirm the caller is an active trainer.
  const profile = await supabaseSelect(
    env,
    'user_profiles',
    `select=role,status,email,display_name&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const p = Array.isArray(profile.data) ? profile.data[0] : null;
  if (!p || p.role !== 'trainer' || p.status !== 'active') {
    return json({ error: 'forbidden' }, 403);
  }

  const base = stripeReturnBaseUrl(url);
  const returnUrl  = `${base}/api/stripe/connect/return`;
  const refreshUrl = `${base}/api/stripe/connect/refresh-link`;

  let accountId;
  let existing = await getLatestConnectForTrainer(env, actorId);

  if (!existing) {
    const created = await createExpressAccount(env, {
      email: p.email ?? undefined,
      metadata: { trainer_id: actorId },
    });
    if (!created.ok) {
      return json({ error: created.error || 'stripe_create_account_failed', message: created.message ?? null }, 502);
    }
    accountId = created.data?.id;
    if (!accountId) return json({ error: 'stripe_missing_account_id' }, 502);

    const ins = await supabaseInsertReturning(env, 'stripe_connect_accounts', {
      trainer_id:        actorId,
      stripe_account_id: accountId,
      charges_enabled:   Boolean(created.data?.charges_enabled),
      payouts_enabled:   Boolean(created.data?.payouts_enabled),
      details_submitted: Boolean(created.data?.details_submitted),
      disabled_reason:   created.data?.requirements?.disabled_reason ?? null,
    });
    if (!ins.ok) {
      return json({ error: 'connect_row_insert_failed', status: ins.status }, 500);
    }
    existing = ins.data;
  } else {
    accountId = existing.stripe_account_id;
  }

  const link = await createAccountLink(env, {
    accountId,
    refreshUrl,
    returnUrl,
    type: 'account_onboarding',
  });
  if (!link.ok) {
    return json({ error: link.error || 'stripe_account_link_failed', message: link.message ?? null }, 502);
  }

  await supabaseUpdateReturning(
    env,
    'stripe_connect_accounts',
    `id=eq.${encodeURIComponent(existing.id)}`,
    { onboarding_link_last_issued_at: new Date().toISOString() }
  );

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'trainer',
    action:       'stripe.connect.onboard',
    target_table: 'stripe_connect_accounts',
    target_id:    existing.id,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { stripe_account_id: accountId },
  });

  return json({ onboarding_url: link.data?.url });
}

async function handleStripeConnectRefresh(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  void jwt;

  if (!isStripeConfigured(env)) {
    return json({ error: 'stripe_not_configured' }, 501);
  }

  const rl = await rateLimit(
    env,
    `ratelimit:stripe_connect_refresh:${actorId}`,
    STRIPE_CONNECT_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  const existing = await getLatestConnectForTrainer(env, actorId);
  if (!existing) return json({ error: 'no_connect_account' }, 404);

  const acct = await retrieveAccount(env, existing.stripe_account_id);
  if (!acct.ok) {
    return json({ error: acct.error || 'stripe_retrieve_failed', message: acct.message ?? null }, 502);
  }

  const patch = {
    charges_enabled:   Boolean(acct.data?.charges_enabled),
    payouts_enabled:   Boolean(acct.data?.payouts_enabled),
    details_submitted: Boolean(acct.data?.details_submitted),
    disabled_reason:   acct.data?.requirements?.disabled_reason ?? null,
  };
  const upd = await supabaseUpdateReturning(
    env,
    'stripe_connect_accounts',
    `id=eq.${encodeURIComponent(existing.id)}`,
    patch
  );
  if (!upd.ok) return json({ error: 'connect_row_update_failed', status: upd.status }, 500);

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'trainer',
    action:       'stripe.connect.refresh',
    target_table: 'stripe_connect_accounts',
    target_id:    existing.id,
    metadata:     patch,
  });

  return json({ account: upd.data });
}

/**
 * GET /api/stripe/connect/return
 *
 * Stripe redirects the trainer here after they finish the Express
 * onboarding flow. We can't read the JWT from the browser navigation,
 * so we don't try to mutate DB state here — we just bounce them to the
 * SPA with a `returned=1` flag. The Payouts page runs a
 * POST /api/stripe/connect/refresh on mount when that flag is present
 * (that POST carries the Supabase Authorization header).
 */
async function handleStripeConnectReturn(_request, _env, url) {
  const target = new URL('/trainer/payouts', `${url.protocol}//${url.host}`);
  target.searchParams.set('returned', '1');
  return Response.redirect(target.toString(), 302);
}

/* =============================================================
   /api/sessions/approve
   -------------------------------------------------------------
   Owner flips a session 'logged' → 'approved'. This is a
   separate step from payment so owners can approve a session
   (committing to pay) even before a Connect account is ready.
   The 'pay' call is the second step.
   ============================================================= */
const SESSION_APPROVE_RATE = { limit: 20, windowSec: 60 };

async function handleSessionApprove(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:session_approve:${actorId}`,
    SESSION_APPROVE_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!sessionId) return json({ error: 'session_id required' }, 400);

  // Read with the caller's JWT — RLS confirms the owner owns the row.
  const lookup = await supabaseSelect(
    env,
    'training_sessions',
    `select=id,owner_id,trainer_id,status,archived_at,trainer_price_cents&id=eq.${encodeURIComponent(sessionId)}`,
    { userJwt: jwt }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.owner_id !== actorId) return json({ error: 'forbidden' }, 403);
  if (row.archived_at) return json({ error: 'archived' }, 409);
  if (row.status === 'approved' || row.status === 'paid') {
    return json({ session: row });
  }
  if (row.status !== 'logged') {
    return json({ error: 'not_approvable', status: row.status }, 409);
  }
  if (row.trainer_price_cents == null || row.trainer_price_cents <= 0) {
    return json({ error: 'price_not_set' }, 409);
  }

  const upd = await supabaseUpdateReturning(
    env,
    'training_sessions',
    `id=eq.${encodeURIComponent(sessionId)}&status=eq.logged`,
    { status: 'approved' }
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'session_update_failed', status: upd.status }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'session.approve',
    target_table: 'training_sessions',
    target_id:    sessionId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { trainer_id: row.trainer_id, amount_cents: row.trainer_price_cents },
  });

  return json({ session: upd.data });
}

/* =============================================================
   /api/stripe/sessions/pay
   -------------------------------------------------------------
   Owner starts payment for an approved session. Two paths:
     • trainer Connect ready → create PaymentIntent, insert
       session_payments with status='pending', return
       { client_secret, payment_intent_id }.
     • trainer not ready → insert session_payments with
       status='awaiting_trainer_setup', return that status so
       the SPA can render the "waiting on trainer" helper.
   Fee math uses public.effective_fee_bps (single source of
   truth across admin default + per-trainer overrides).
   Idempotent on an existing session_payments row: if a
   'pending' intent already exists, retrieve it and return
   its client_secret rather than creating a second intent.
   ============================================================= */
const SESSION_PAY_RATE = { limit: 10, windowSec: 60 };

async function handleSessionPay(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimit(
    env,
    `ratelimit:session_pay:${actorId}`,
    SESSION_PAY_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!sessionId) return json({ error: 'session_id required' }, 400);

  // RLS-scoped read: owner only sees rows where owner_id = auth.uid().
  const lookup = await supabaseSelect(
    env,
    'training_sessions',
    `select=id,owner_id,trainer_id,status,archived_at,trainer_price_cents&id=eq.${encodeURIComponent(sessionId)}`,
    { userJwt: jwt }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.owner_id !== actorId) return json({ error: 'forbidden' }, 403);
  if (row.archived_at) return json({ error: 'archived' }, 409);
  if (row.status !== 'approved') {
    return json({ error: 'not_payable', status: row.status }, 409);
  }
  if (row.trainer_price_cents == null || row.trainer_price_cents <= 0) {
    return json({ error: 'price_not_set' }, 409);
  }

  // Compute platform fee via the single source-of-truth SQL helper.
  const feeRpc = await supabaseRpc(
    env,
    'effective_fee_bps',
    { p_trainer_id: row.trainer_id },
    { serviceRole: true }
  );
  if (!feeRpc.ok) {
    return json({ error: 'fee_lookup_failed' }, 500);
  }
  const feeBps = typeof feeRpc.data === 'number'
    ? feeRpc.data
    : Number(feeRpc.data);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10000) {
    return json({ error: 'fee_invalid' }, 500);
  }
  const amountCents = row.trainer_price_cents;
  const platformFeeCents = Math.ceil((amountCents * feeBps) / 10000);

  // Existing payment row? (Idempotency on repeated clicks.)
  const existingQ = await supabaseSelect(
    env,
    'session_payments',
    `select=id,status,stripe_payment_intent_id,amount_cents,platform_fee_cents&session_id=eq.${encodeURIComponent(sessionId)}`,
    { serviceRole: true }
  );
  const existing = Array.isArray(existingQ.data) ? existingQ.data[0] : null;

  // Succeeded / refunded rows short-circuit — the session is done.
  if (existing && (existing.status === 'succeeded' || existing.status === 'processing')) {
    return json({
      status: existing.status,
      payment_intent_id: existing.stripe_payment_intent_id,
    });
  }

  // Look up trainer Connect status.
  const connect = await getLatestConnectForTrainer(env, row.trainer_id);
  const connectReady =
    connect && connect.charges_enabled && !connect.deactivated_at;

  // --- Path A: trainer not ready → park as awaiting_trainer_setup. ---
  if (!connectReady) {
    if (existing && existing.status === 'awaiting_trainer_setup') {
      return json({
        status: 'awaiting_trainer_setup',
        amount_cents: existing.amount_cents,
        platform_fee_cents: existing.platform_fee_cents,
      });
    }
    // Insert fresh (or upgrade a stale 'failed' row by deleting + reinserting
    // is risky; instead we only insert when no row exists and otherwise
    // return the current state).
    if (!existing) {
      const ins = await supabaseInsertReturning(env, 'session_payments', {
        session_id:         sessionId,
        payer_id:           actorId,
        payee_id:           row.trainer_id,
        amount_cents:       amountCents,
        platform_fee_cents: platformFeeCents,
        currency:           'usd',
        status:             'awaiting_trainer_setup',
      });
      if (!ins.ok) {
        return json({ error: 'payment_insert_failed', status: ins.status }, 500);
      }
    }
    ctx_audit(env, {
      actor_id:     actorId,
      actor_role:   'owner',
      action:       'session_payment.awaiting_trainer_setup',
      target_table: 'session_payments',
      target_id:    sessionId,
      metadata:     { amount_cents: amountCents, platform_fee_cents: platformFeeCents },
    });
    return json({
      status: 'awaiting_trainer_setup',
      amount_cents: amountCents,
      platform_fee_cents: platformFeeCents,
    });
  }

  // --- Path B: trainer ready → create / re-fetch PaymentIntent. ---
  if (!isStripeConfigured(env)) {
    return json({ error: 'stripe_not_configured' }, 501);
  }

  // If we already have a pending intent for this session, just re-retrieve
  // its client_secret so the SPA can resume.
  if (existing && existing.status === 'pending' && existing.stripe_payment_intent_id) {
    const pi = await retrievePaymentIntent(env, existing.stripe_payment_intent_id);
    if (pi.ok && pi.data?.client_secret) {
      return json({
        status: 'pending',
        client_secret: pi.data.client_secret,
        payment_intent_id: pi.data.id,
      });
    }
    // fall through and create a new one if Stripe lost it
  }

  const idempotencyKey = `session_pay:${sessionId}:${amountCents}:${platformFeeCents}`;
  const piRes = await createPaymentIntent(env, {
    amountCents,
    applicationFeeAmountCents: platformFeeCents,
    destinationAccountId: connect.stripe_account_id,
    idempotencyKey,
    description: `Mane Line session ${sessionId}`,
    metadata: {
      session_id: sessionId,
      owner_id:   actorId,
      trainer_id: row.trainer_id,
      fee_bps:    String(feeBps),
    },
  });
  if (!piRes.ok || !piRes.data?.id || !piRes.data?.client_secret) {
    return json({
      error: piRes.error || 'stripe_create_intent_failed',
      message: piRes.message ?? null,
    }, 502);
  }

  // Insert or update the session_payments row to track this intent.
  if (existing) {
    const upd = await supabaseUpdateReturning(
      env,
      'session_payments',
      `id=eq.${encodeURIComponent(existing.id)}`,
      {
        stripe_payment_intent_id: piRes.data.id,
        amount_cents:             amountCents,
        platform_fee_cents:       platformFeeCents,
        status:                   'pending',
        failure_code:             null,
        failure_message:          null,
      }
    );
    if (!upd.ok) {
      return json({ error: 'payment_update_failed', status: upd.status }, 500);
    }
  } else {
    const ins = await supabaseInsertReturning(env, 'session_payments', {
      session_id:               sessionId,
      payer_id:                 actorId,
      payee_id:                 row.trainer_id,
      stripe_payment_intent_id: piRes.data.id,
      amount_cents:             amountCents,
      platform_fee_cents:       platformFeeCents,
      currency:                 'usd',
      status:                   'pending',
    });
    if (!ins.ok) {
      return json({ error: 'payment_insert_failed', status: ins.status }, 500);
    }
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'session_payment.create_intent',
    target_table: 'session_payments',
    target_id:    sessionId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     {
      payment_intent_id:  piRes.data.id,
      amount_cents:       amountCents,
      platform_fee_cents: platformFeeCents,
      fee_bps:            feeBps,
    },
  });

  return json({
    status: 'pending',
    client_secret: piRes.data.client_secret,
    payment_intent_id: piRes.data.id,
    amount_cents: amountCents,
    platform_fee_cents: platformFeeCents,
  });
}


/* =============================================================
   /api/invoices/{finalize,send,void}
   -------------------------------------------------------------
   Phase 7 PR #5 — white-label trainer invoicing on Stripe Connect.

   Finalize: draft -> open on both Stripe and our DB. Creates Customer
   + InvoiceItems + Invoice on the trainer's connected account the
   first time, then calls /v1/invoices/{id}/finalize. application_fee_amount
   is computed via effective_fee_bps() so the platform cut stays in
   lockstep with the session-payment path.

   Send: /v1/invoices/{id}/send. Stripe emails the hosted-invoice URL
   to the customer. Sets sent_at on our row.

   Void: /v1/invoices/{id}/void. Sets status='void', voided_at=now().
   Invoices are never deleted (OAG §8).
   ============================================================= */
const INVOICE_ACTION_RATE = { limit: 12, windowSec: 60 };

async function requireInvoiceOwnership(env, invoiceId, actorId) {
  const r = await supabaseSelect(
    env,
    'invoices',
    `select=*&id=eq.${encodeURIComponent(invoiceId)}`,
    { serviceRole: true }
  );
  if (!r.ok) return { error: json({ error: 'lookup_failed' }, 500) };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { error: json({ error: 'invoice_not_found' }, 404) };
  if (row.trainer_id !== actorId) return { error: json({ error: 'forbidden' }, 403) };
  return { invoice: row };
}

async function resolveTrainerInvoiceContext(env, invoice) {
  const connect = await getLatestConnectForTrainer(env, invoice.trainer_id);
  if (!connect || !connect.stripe_account_id) {
    return { error: json({ error: 'connect_not_onboarded' }, 409) };
  }
  if (!connect.charges_enabled || connect.deactivated_at) {
    return { error: json({ error: 'connect_not_ready', disabled_reason: connect.disabled_reason ?? null }, 409) };
  }

  const settingsRes = await supabaseSelect(
    env,
    'trainer_invoice_settings',
    `select=*&trainer_id=eq.${encodeURIComponent(invoice.trainer_id)}`,
    { serviceRole: true }
  );
  const settings = Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;

  return { connect, settings };
}

// Look up (trainer, owner|adhoc_email) -> stripe_customer_id. Creates
// the Customer on the trainer's Connect account the first time we
// bill a given counterparty.
async function ensureStripeCustomer(env, {
  invoice,
  stripeAccountId,
}) {
  const trainerId = invoice.trainer_id;
  const ownerId   = invoice.owner_id;
  const adhocEmail = invoice.adhoc_email ? invoice.adhoc_email.toLowerCase() : null;

  // Lookup existing mapping.
  let query;
  if (ownerId) {
    query = `select=id,stripe_customer_id&trainer_id=eq.${encodeURIComponent(trainerId)}&owner_id=eq.${encodeURIComponent(ownerId)}`;
  } else if (adhocEmail) {
    query = `select=id,stripe_customer_id&trainer_id=eq.${encodeURIComponent(trainerId)}&adhoc_email=eq.${encodeURIComponent(adhocEmail)}`;
  } else {
    return { error: json({ error: 'invoice_has_no_subject' }, 400) };
  }
  const existing = await supabaseSelect(env, 'trainer_customer_map', query, { serviceRole: true });
  const hit = Array.isArray(existing.data) ? existing.data[0] : null;
  if (hit) return { stripeCustomerId: hit.stripe_customer_id };

  // Resolve billing name + email.
  let email, name;
  if (ownerId) {
    const prof = await supabaseSelect(
      env,
      'user_profiles',
      `select=display_name,email&user_id=eq.${encodeURIComponent(ownerId)}`,
      { serviceRole: true }
    );
    const row = Array.isArray(prof.data) ? prof.data[0] : null;
    email = row?.email;
    name  = row?.display_name || row?.email;
  } else {
    email = invoice.adhoc_email;
    name  = invoice.adhoc_name || invoice.adhoc_email;
  }
  if (!email) return { error: json({ error: 'customer_email_missing' }, 400) };

  const cust = await createConnectCustomer(env, {
    stripeAccountId,
    email,
    name,
    metadata: {
      ml_trainer_id: trainerId,
      ml_owner_id:   ownerId ?? '',
      ml_adhoc:      adhocEmail ?? '',
    },
    idempotencyKey: `invoice_customer:${trainerId}:${ownerId ?? adhocEmail}`,
  });
  if (!cust.ok || !cust.data?.id) {
    return { error: json({ error: 'customer_create_failed', stripe_error: cust.error, message: cust.message }, 502) };
  }
  const stripeCustomerId = cust.data.id;

  await supabaseInsertReturning(env, 'trainer_customer_map', {
    trainer_id:         trainerId,
    owner_id:           ownerId,
    adhoc_email:        adhocEmail,
    stripe_customer_id: stripeCustomerId,
  });
  return { stripeCustomerId };
}

async function handleInvoiceFinalize(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  if (!isStripeConfigured(env)) return json({ error: 'stripe_not_configured' }, 501);

  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { return resp instanceof Response ? resp : json({ error: 'unauthorized' }, 401); }

  const rl = await rateLimit(env, `ratelimit:invoice_finalize:${actorId}`, INVOICE_ACTION_RATE);
  if (!rl.ok) return json({ error: 'rate_limited' }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const invoiceId = body?.invoice_id;
  if (!invoiceId || typeof invoiceId !== 'string') {
    return json({ error: 'invoice_id_required' }, 400);
  }

  const own = await requireInvoiceOwnership(env, invoiceId, actorId);
  if (own.error) return own.error;
  const invoice = own.invoice;

  const r = await performInvoiceFinalize(env, invoice, {
    auditActorId:   actorId,
    auditActorRole: 'trainer',
    auditAction:    'invoice.finalize',
  });
  if (r.response) return r.response;
  return json({ ok: true, idempotent: r.idempotent ?? false, invoice: r.invoice });
}

/**
 * Drive a draft invoice from `draft` → `open` on Stripe and sync our
 * row. Shared between the HTTP handler (handleInvoiceFinalize) and
 * the hourly cron (autoFinalizeDueDrafts).
 *
 * Returns:
 *   { response: Response }        — caller should return this directly
 *                                   (bad state, Stripe error, etc.)
 *   { invoice: Row, idempotent? } — success
 */
async function performInvoiceFinalize(env, invoice, { auditActorId = null, auditActorRole = 'system', auditAction = 'invoice.finalize' } = {}) {
  if (invoice.status === 'open' || invoice.status === 'paid') {
    return { invoice, idempotent: true };
  }
  if (invoice.status !== 'draft') {
    return { response: json({ error: 'not_draft', status: invoice.status }, 409) };
  }

  const linesRes = await supabaseSelect(
    env,
    'invoice_line_items',
    `select=*&invoice_id=eq.${encodeURIComponent(invoice.id)}&order=sort_order.asc`,
    { serviceRole: true }
  );
  const lines = Array.isArray(linesRes.data) ? linesRes.data : [];
  if (lines.length === 0) return { response: json({ error: 'no_line_items' }, 409) };

  const subtotalCents = lines.reduce((acc, l) => acc + Math.round(Number(l.quantity) * l.unit_amount_cents), 0);
  const taxCents = lines.reduce((acc, l) => {
    const sub = Math.round(Number(l.quantity) * l.unit_amount_cents);
    return acc + Math.round((sub * l.tax_rate_bps) / 10000);
  }, 0);
  const totalCents = subtotalCents + taxCents;
  if (totalCents <= 0) return { response: json({ error: 'zero_total' }, 409) };

  const ctx = await resolveTrainerInvoiceContext(env, invoice);
  if (ctx.error) return { response: ctx.error };
  const { connect, settings } = ctx;
  const stripeAccountId = connect.stripe_account_id;

  const feeRpc = await supabaseRpc(env, 'effective_fee_bps', { p_trainer_id: invoice.trainer_id }, { serviceRole: true });
  if (!feeRpc.ok) return { response: json({ error: 'fee_lookup_failed' }, 500) };
  const feeBps = Number(feeRpc.data);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10000) {
    return { response: json({ error: 'fee_invalid' }, 500) };
  }
  const platformFeeCents = Math.ceil((totalCents * feeBps) / 10000);

  const custRes = await ensureStripeCustomer(env, { invoice, stripeAccountId });
  if (custRes.error) return { response: custRes.error };
  const stripeCustomerId = custRes.stripeCustomerId;

  const today = new Date().toISOString().slice(0, 10);
  const daysUntilDue = Math.max(
    0,
    Math.round(
      (new Date(invoice.due_date + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  let stripeInvoiceId = invoice.stripe_invoice_id;

  if (!stripeInvoiceId) {
    const inv = await createConnectInvoice(env, {
      stripeAccountId,
      customerId: stripeCustomerId,
      applicationFeeAmountCents: platformFeeCents,
      daysUntilDue,
      footerMemo: settings?.footer_memo ?? null,
      metadata: {
        ml_invoice_id: invoice.id,
        ml_trainer_id: invoice.trainer_id,
        ml_owner_id:   invoice.owner_id ?? '',
      },
      idempotencyKey: `invoice_create:${invoice.id}`,
    });
    if (!inv.ok || !inv.data?.id) {
      return { response: json({ error: 'invoice_create_failed', stripe_error: inv.error, message: inv.message }, 502) };
    }
    stripeInvoiceId = inv.data.id;

    await supabaseUpdateReturning(
      env,
      'invoices',
      `id=eq.${encodeURIComponent(invoice.id)}`,
      { stripe_invoice_id: stripeInvoiceId, stripe_customer_id: stripeCustomerId }
    );

    for (const line of lines) {
      const itemAmount = Math.round(Number(line.quantity) * line.unit_amount_cents);
      const item = await createConnectInvoiceItem(env, {
        stripeAccountId,
        customerId: stripeCustomerId,
        invoiceId: stripeInvoiceId,
        amountCents: itemAmount,
        description: line.description,
        quantity: line.kind === 'session' ? line.quantity : undefined,
        unitAmountCents: line.kind === 'session' ? line.unit_amount_cents : undefined,
        idempotencyKey: `invoice_item:${line.id}`,
      });
      if (!item.ok) {
        return { response: json({ error: 'invoice_item_failed', stripe_error: item.error, message: item.message }, 502) };
      }
    }
  }

  const fin = await finalizeConnectInvoice(env, {
    stripeAccountId,
    invoiceId: stripeInvoiceId,
    idempotencyKey: `invoice_finalize:${invoice.id}`,
  });
  if (!fin.ok) {
    return { response: json({ error: 'finalize_failed', stripe_error: fin.error, message: fin.message }, 502) };
  }
  const finalized = fin.data || {};

  const updated = await supabaseUpdateReturning(
    env,
    'invoices',
    `id=eq.${encodeURIComponent(invoice.id)}`,
    {
      status: 'open',
      stripe_invoice_id:       stripeInvoiceId,
      stripe_customer_id:      stripeCustomerId,
      stripe_hosted_invoice_url: finalized.hosted_invoice_url ?? null,
      stripe_invoice_pdf_url:    finalized.invoice_pdf ?? null,
      invoice_number:          finalized.number ?? null,
      subtotal_cents:          subtotalCents,
      tax_cents:               taxCents,
      total_cents:             totalCents,
      platform_fee_cents:      platformFeeCents,
    }
  );

  ctx_audit(env, {
    actor_id:     auditActorId,
    actor_role:   auditActorRole,
    action:       auditAction,
    target_table: 'invoices',
    target_id:    invoice.id,
    metadata:     { stripe_invoice_id: stripeInvoiceId, total_cents: totalCents, platform_fee_cents: platformFeeCents },
  });

  return { invoice: updated.data };
}

async function handleInvoiceSend(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  if (!isStripeConfigured(env)) return json({ error: 'stripe_not_configured' }, 501);

  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { return resp instanceof Response ? resp : json({ error: 'unauthorized' }, 401); }

  const rl = await rateLimit(env, `ratelimit:invoice_send:${actorId}`, INVOICE_ACTION_RATE);
  if (!rl.ok) return json({ error: 'rate_limited' }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const invoiceId = body?.invoice_id;
  if (!invoiceId) return json({ error: 'invoice_id_required' }, 400);

  const own = await requireInvoiceOwnership(env, invoiceId, actorId);
  if (own.error) return own.error;
  const invoice = own.invoice;

  if (!invoice.stripe_invoice_id) return json({ error: 'not_finalized' }, 409);
  if (invoice.status !== 'open') return json({ error: 'not_sendable', status: invoice.status }, 409);

  const ctx = await resolveTrainerInvoiceContext(env, invoice);
  if (ctx.error) return ctx.error;

  const sent = await sendConnectInvoice(env, {
    stripeAccountId: ctx.connect.stripe_account_id,
    invoiceId: invoice.stripe_invoice_id,
    idempotencyKey: `invoice_send:${invoice.id}`,
  });
  if (!sent.ok) {
    return json({ error: 'send_failed', stripe_error: sent.error, message: sent.message }, 502);
  }

  const updated = await supabaseUpdateReturning(
    env,
    'invoices',
    `id=eq.${encodeURIComponent(invoice.id)}`,
    { sent_at: new Date().toISOString() }
  );

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'trainer',
    action:       'invoice.send',
    target_table: 'invoices',
    target_id:    invoice.id,
    metadata:     { stripe_invoice_id: invoice.stripe_invoice_id },
  });

  return json({ ok: true, invoice: updated.data });
}

async function handleInvoiceVoid(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);

  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { return resp instanceof Response ? resp : json({ error: 'unauthorized' }, 401); }

  const rl = await rateLimit(env, `ratelimit:invoice_void:${actorId}`, INVOICE_ACTION_RATE);
  if (!rl.ok) return json({ error: 'rate_limited' }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const invoiceId = body?.invoice_id;
  if (!invoiceId) return json({ error: 'invoice_id_required' }, 400);

  const own = await requireInvoiceOwnership(env, invoiceId, actorId);
  if (own.error) return own.error;
  const invoice = own.invoice;

  if (invoice.status === 'void') {
    return json({ ok: true, idempotent: true, invoice });
  }
  if (invoice.status === 'paid') {
    return json({ error: 'already_paid' }, 409);
  }

  // Draft can skip Stripe entirely — just flip our row. Open invoices
  // must be voided on Stripe first so their hosted URL goes dead.
  if (invoice.status !== 'draft' && invoice.stripe_invoice_id) {
    if (!isStripeConfigured(env)) return json({ error: 'stripe_not_configured' }, 501);
    const ctx = await resolveTrainerInvoiceContext(env, invoice);
    if (ctx.error) return ctx.error;

    const vd = await voidConnectInvoice(env, {
      stripeAccountId: ctx.connect.stripe_account_id,
      invoiceId: invoice.stripe_invoice_id,
      idempotencyKey: `invoice_void:${invoice.id}`,
    });
    if (!vd.ok) {
      return json({ error: 'void_failed', stripe_error: vd.error, message: vd.message }, 502);
    }
  }

  const updated = await supabaseUpdateReturning(
    env,
    'invoices',
    `id=eq.${encodeURIComponent(invoice.id)}`,
    { status: 'void', voided_at: new Date().toISOString() }
  );

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'trainer',
    action:       'invoice.void',
    target_table: 'invoices',
    target_id:    invoice.id,
    metadata:     { stripe_invoice_id: invoice.stripe_invoice_id },
  });

  return json({ ok: true, invoice: updated.data });
}

// Webhook sync — fires when a Stripe-hosted invoice gets paid or
// voided outside our UI. Matches on stripe_invoice_id so it only
// touches rows we created; subscription invoices still flow through
// the stripe-subscriptions.js handlers. Avoids the need to inspect
// event metadata to decide which path to take.
async function syncConnectInvoiceFromEvent(env, event) {
  const stripeInv = event?.data?.object;
  const stripeInvoiceId = stripeInv?.id;
  if (!stripeInvoiceId) return { ok: false, error: 'missing_invoice' };

  const r = await supabaseSelect(
    env,
    'invoices',
    'select=id,status,trainer_id,owner_id,adhoc_email,adhoc_name,' +
      'total_cents,amount_paid_cents,currency,invoice_number' +
      `&stripe_invoice_id=eq.${encodeURIComponent(stripeInvoiceId)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { ok: true, ignored: true }; // not one of ours; subscription handler or unrelated

  const patch = {};
  let transitionedToPaid = false;
  switch (event.type) {
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      if (row.status === 'paid') return { ok: true, idempotent: true };
      patch.status            = 'paid';
      patch.paid_at           = new Date().toISOString();
      patch.amount_paid_cents = stripeInv.amount_paid ?? stripeInv.total ?? 0;
      transitionedToPaid = true;
      break;
    case 'invoice.voided':
      if (row.status === 'void') return { ok: true, idempotent: true };
      patch.status    = 'void';
      patch.voided_at = new Date().toISOString();
      break;
    case 'invoice.marked_uncollectible':
      patch.status = 'uncollectible';
      break;
    default:
      return { ok: true, ignored: true };
  }

  const upd = await supabaseUpdateReturning(
    env,
    'invoices',
    `id=eq.${encodeURIComponent(row.id)}`,
    patch
  );
  if (!upd.ok) return { ok: false, error: 'invoice_update_failed' };

  ctx_audit(env, {
    action:       `invoice.webhook.${event.type}`,
    target_table: 'invoices',
    target_id:    row.id,
    metadata:     { stripe_invoice_id: stripeInvoiceId, event_id: event.id },
  });

  // Fire the HubSpot behavioral event on paid transitions only. Best
  // effort — the insert is idempotent-by-event_id at the drain layer
  // (hubspot_sync_log) but we guard here so retries of the same
  // webhook don't enqueue duplicate rows. The contact is the payer
  // (owner or adhoc), not the trainer — HubSpot tracks who paid.
  if (transitionedToPaid) {
    try {
      await enqueueInvoicePaidHubspot(env, {
        invoice: { ...row, ...patch },
        stripeInvoice: stripeInv,
        eventId: event.id,
      });
    } catch (err) {
      console.warn('[hubspot] invoice.paid enqueue failed:', err?.message);
    }
  }
  return { ok: true };
}

// Enqueue maneline_invoice_paid into pending_hubspot_syncs. Resolves
// the payer (contact) email from owner_id → user_profiles.email,
// falling back to adhoc_email for invoices sent to non-users. Adds
// trainer context as event properties so HubSpot workflows can
// segment by trainer. Drain cron handles delivery + retries.
async function enqueueInvoicePaidHubspot(env, { invoice, stripeInvoice, eventId }) {
  // Resolve payer email.
  let payerEmail = invoice.adhoc_email ? String(invoice.adhoc_email).trim().toLowerCase() : '';
  let payerName  = invoice.adhoc_name || null;
  if (invoice.owner_id) {
    const o = await supabaseSelect(
      env,
      'user_profiles',
      `select=email,display_name&user_id=eq.${encodeURIComponent(invoice.owner_id)}&limit=1`,
      { serviceRole: true }
    );
    const prof = Array.isArray(o.data) ? o.data[0] : null;
    if (prof?.email) payerEmail = String(prof.email).trim().toLowerCase();
    if (prof?.display_name) payerName = prof.display_name;
  }
  if (!payerEmail) {
    // Can't send without an email — bail quietly. Drain layer also
    // dead-letters on missing_email; this just avoids the extra row.
    return;
  }

  // Resolve trainer context (display_name/email for the event body).
  let trainerEmail = null;
  let trainerName  = null;
  if (invoice.trainer_id) {
    const t = await supabaseSelect(
      env,
      'user_profiles',
      `select=email,display_name&user_id=eq.${encodeURIComponent(invoice.trainer_id)}&limit=1`,
      { serviceRole: true }
    );
    const prof = Array.isArray(t.data) ? t.data[0] : null;
    trainerEmail = prof?.email ?? null;
    trainerName  = prof?.display_name ?? null;
  }

  await supabaseInsert(env, 'pending_hubspot_syncs', {
    event_name: 'maneline_invoice_paid',
    payload: {
      email: payerEmail,
      display_name: payerName,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number ?? null,
      stripe_invoice_id: stripeInvoice?.id ?? null,
      total_cents: invoice.total_cents ?? null,
      amount_paid_cents: invoice.amount_paid_cents ?? stripeInvoice?.amount_paid ?? null,
      currency: invoice.currency ?? null,
      trainer_id: invoice.trainer_id,
      trainer_email: trainerEmail,
      trainer_name: trainerName,
      paid_at: invoice.paid_at ?? new Date().toISOString(),
      stripe_event_id: eventId ?? null,
    },
  });
}

/* =============================================================
   PR #6 — Cron jobs: recurring-line materialization + auto-finalize
   -------------------------------------------------------------
   Fired from scheduled() (hourly) and the manual /api/cron/run-once
   endpoint. Each job is idempotent: re-running within the same
   period is a no-op.

   SAFETY: The scheduled() handler gates on FLAGS["cron:enabled"]
   so nothing fires in prod until launch. Per-job flags
   ("cron:recurring", "cron:auto_finalize") give finer control
   during smoke tests.
   ============================================================= */

// Compute YYYY-MM-DD in a given IANA time zone. Used to check
// whether "today" in the trainer's local calendar matches their
// auto_finalize_day. Intl is available in the Workers runtime.
function todayInTimeZone(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/Chicago',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`; // en-CA is ISO-ordered
}

// Given a first-of-month date "YYYY-MM-01", return the last day of
// that month as "YYYY-MM-DD". Used to seed invoice.period_end when
// the recurring materializer creates a draft.
function endOfMonthDate(monthStartIso) {
  const [y, m] = monthStartIso.split('-').map(Number);
  // new Date(y, m, 0) → last day of month m (1-indexed), since
  // day=0 rolls back from the next month's first.
  const d = new Date(Date.UTC(y, m, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * For every active recurring_line_items row, ensure the current
 * billing period (trainer-local calendar month) has ONE line on a
 * draft invoice for that (trainer, subject) pair.
 *
 * Match via invoice_line_items.source_id=recurring.id — so a re-run
 * within the same month never double-bills. If no draft exists for
 * the period, we create one using the trainer's default net days.
 */
async function materializeRecurringItems(env) {
  const started = Date.now();
  const stats = { considered: 0, already_billed: 0, drafts_created: 0, lines_added: 0, errors: [] };

  const rowsRes = await supabaseSelect(
    env,
    'recurring_line_items',
    'select=*&active=eq.true',
    { serviceRole: true }
  );
  if (!rowsRes.ok) {
    return { ok: false, error: 'recurring_query_failed', status: rowsRes.status };
  }
  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  stats.considered = rows.length;

  // Cache month_start per trainer (one RPC round trip each).
  const monthStartCache = new Map();
  async function monthStartFor(trainerId) {
    if (monthStartCache.has(trainerId)) return monthStartCache.get(trainerId);
    const r = await supabaseRpc(env, 'trainer_month_start', { p_trainer_id: trainerId }, { serviceRole: true });
    const ms = (r.ok && typeof r.data === 'string') ? r.data : null;
    monthStartCache.set(trainerId, ms);
    return ms;
  }

  // Cache (trainer_id, default_due_net_days) so we don't re-query.
  const settingsCache = new Map();
  async function settingsFor(trainerId) {
    if (settingsCache.has(trainerId)) return settingsCache.get(trainerId);
    const r = await supabaseSelect(
      env,
      'trainer_invoice_settings',
      `select=default_due_net_days&trainer_id=eq.${encodeURIComponent(trainerId)}`,
      { serviceRole: true }
    );
    const row = Array.isArray(r.data) ? r.data[0] : null;
    settingsCache.set(trainerId, row);
    return row;
  }

  for (const r of rows) {
    try {
      const monthStart = await monthStartFor(r.trainer_id);
      if (!monthStart) { stats.errors.push({ id: r.id, reason: 'no_month_start' }); continue; }

      // Already billed this period?
      const existingLine = await supabaseSelect(
        env,
        'invoice_line_items',
        `select=id,invoice_id,invoices!inner(id,trainer_id,owner_id,adhoc_email,period_start,status)` +
        `&kind=eq.recurring&source_id=eq.${encodeURIComponent(r.id)}` +
        `&invoices.trainer_id=eq.${encodeURIComponent(r.trainer_id)}` +
        `&invoices.period_start=eq.${encodeURIComponent(monthStart)}` +
        `&invoices.status=neq.void`,
        { serviceRole: true }
      );
      const hits = Array.isArray(existingLine.data) ? existingLine.data : [];
      const matched = hits.find(h => {
        const inv = h.invoices || {};
        if (r.owner_id)  return inv.owner_id === r.owner_id;
        if (r.adhoc_email) return (inv.adhoc_email || '').toLowerCase() === r.adhoc_email.toLowerCase();
        return false;
      });
      if (matched) { stats.already_billed++; continue; }

      // Find or create a draft for this subject+period.
      let draft;
      const draftFilter = r.owner_id
        ? `trainer_id=eq.${encodeURIComponent(r.trainer_id)}&owner_id=eq.${encodeURIComponent(r.owner_id)}&period_start=eq.${encodeURIComponent(monthStart)}&status=eq.draft`
        : `trainer_id=eq.${encodeURIComponent(r.trainer_id)}&adhoc_email=eq.${encodeURIComponent(r.adhoc_email.toLowerCase())}&period_start=eq.${encodeURIComponent(monthStart)}&status=eq.draft`;

      const draftQ = await supabaseSelect(env, 'invoices', `select=*&${draftFilter}&limit=1`, { serviceRole: true });
      draft = Array.isArray(draftQ.data) ? draftQ.data[0] : null;

      if (!draft) {
        const periodEnd = endOfMonthDate(monthStart);
        const settings = await settingsFor(r.trainer_id);
        const netDays = Number(settings?.default_due_net_days ?? 15);
        const dueDate = addDaysIso(periodEnd, netDays);

        const payload = {
          trainer_id:   r.trainer_id,
          owner_id:     r.owner_id,
          adhoc_email:  r.adhoc_email ? r.adhoc_email.toLowerCase() : null,
          adhoc_name:   r.adhoc_email ? r.adhoc_email : null,
          status:       'draft',
          period_start: monthStart,
          period_end:   periodEnd,
          due_date:     dueDate,
        };

        const createRes = await supabaseInsertReturning(env, 'invoices', payload);
        if (!createRes.ok || !createRes.data) {
          stats.errors.push({ id: r.id, reason: 'draft_create_failed', status: createRes.status });
          continue;
        }
        draft = createRes.data;
        stats.drafts_created++;
      }

      // Add the recurring line. invoice_line_items_insert RLS won't
      // apply since we use service_role.
      const linesRes = await supabaseSelect(
        env,
        'invoice_line_items',
        `select=sort_order&invoice_id=eq.${encodeURIComponent(draft.id)}&order=sort_order.desc&limit=1`,
        { serviceRole: true }
      );
      const topSort = Array.isArray(linesRes.data) && linesRes.data[0]
        ? Number(linesRes.data[0].sort_order) : 0;

      const insLine = await supabaseInsertReturning(env, 'invoice_line_items', {
        invoice_id:         draft.id,
        kind:               'recurring',
        source_id:          r.id,
        description:        r.description,
        quantity:           1,
        unit_amount_cents:  r.amount_cents,
        tax_rate_bps:       0,
        amount_cents:       r.amount_cents,
        sort_order:         topSort + 1,
      });
      if (!insLine.ok) {
        stats.errors.push({ id: r.id, reason: 'line_insert_failed' });
        continue;
      }

      // Recompute draft totals (subtotal = sum of amount_cents;
      // recurring has no tax by default, so use existing tax_cents).
      const allLinesRes = await supabaseSelect(
        env,
        'invoice_line_items',
        `select=quantity,unit_amount_cents,tax_rate_bps&invoice_id=eq.${encodeURIComponent(draft.id)}`,
        { serviceRole: true }
      );
      const allLines = Array.isArray(allLinesRes.data) ? allLinesRes.data : [];
      const sub = allLines.reduce((a, l) => a + Math.round(Number(l.quantity) * l.unit_amount_cents), 0);
      const tax = allLines.reduce((a, l) => {
        const s = Math.round(Number(l.quantity) * l.unit_amount_cents);
        return a + Math.round((s * l.tax_rate_bps) / 10000);
      }, 0);
      await supabaseUpdateReturning(
        env,
        'invoices',
        `id=eq.${encodeURIComponent(draft.id)}`,
        { subtotal_cents: sub, tax_cents: tax, total_cents: sub + tax }
      );

      stats.lines_added++;
    } catch (err) {
      stats.errors.push({ id: r.id, reason: String(err?.message ?? err) });
    }
  }

  stats.elapsed_ms = Date.now() - started;
  return { ok: true, ...stats };
}

/**
 * Finalize drafts whose billing period has ended and whose trainer
 * has configured today (in their local TZ) as auto_finalize_day.
 * Each trainer's drafts get finalized one at a time via
 * performInvoiceFinalize so the hosted Stripe invoice mirrors the
 * "manual finalize" path exactly.
 */
async function autoFinalizeDueDrafts(env) {
  const started = Date.now();
  const stats = { candidates: 0, finalized: 0, skipped: 0, errors: [] };

  // Pull every trainer's settings + timezone in one pass.
  const settingsRes = await supabaseSelect(
    env,
    'trainer_invoice_settings',
    'select=trainer_id,auto_finalize_day',
    { serviceRole: true }
  );
  if (!settingsRes.ok) return { ok: false, error: 'settings_query_failed' };
  const settings = Array.isArray(settingsRes.data) ? settingsRes.data : [];

  for (const s of settings) {
    try {
      const trainerId = s.trainer_id;
      const profRes = await supabaseSelect(
        env,
        'trainer_profiles',
        `select=invoice_timezone&user_id=eq.${encodeURIComponent(trainerId)}`,
        { serviceRole: true }
      );
      const prof = Array.isArray(profRes.data) ? profRes.data[0] : null;
      const tz = prof?.invoice_timezone || 'America/Chicago';
      const today = todayInTimeZone(tz); // YYYY-MM-DD
      const todayDay = Number(today.slice(-2));

      if (todayDay !== Number(s.auto_finalize_day)) {
        stats.skipped++;
        continue;
      }

      // Any drafts whose billing period has already ended.
      const draftsRes = await supabaseSelect(
        env,
        'invoices',
        `select=*&trainer_id=eq.${encodeURIComponent(trainerId)}` +
        `&status=eq.draft` +
        `&period_end=lt.${encodeURIComponent(today)}` +
        `&total_cents=gt.0`,
        { serviceRole: true }
      );
      const drafts = Array.isArray(draftsRes.data) ? draftsRes.data : [];
      stats.candidates += drafts.length;

      for (const inv of drafts) {
        const res = await performInvoiceFinalize(env, inv, {
          auditActorId:   null,
          auditActorRole: 'system',
          auditAction:    'invoice.auto_finalize',
        });
        if (res.response) {
          stats.errors.push({ invoice_id: inv.id, response_status: res.response.status });
          continue;
        }
        stats.finalized++;

        // Best-effort send so the hosted URL lands in the client's inbox.
        if (res.invoice?.stripe_invoice_id) {
          const ctx = await resolveTrainerInvoiceContext(env, res.invoice);
          if (!ctx.error) {
            const sr = await sendConnectInvoice(env, {
              stripeAccountId: ctx.connect.stripe_account_id,
              invoiceId: res.invoice.stripe_invoice_id,
              idempotencyKey: `invoice_send:${res.invoice.id}`,
            });
            if (sr.ok) {
              await supabaseUpdateReturning(
                env,
                'invoices',
                `id=eq.${encodeURIComponent(res.invoice.id)}`,
                { sent_at: new Date().toISOString() }
              );
            }
          }
        }
      }
    } catch (err) {
      stats.errors.push({ trainer_id: s.trainer_id, reason: String(err?.message ?? err) });
    }
  }

  stats.elapsed_ms = Date.now() - started;
  return { ok: true, ...stats };
}

/**
 * POST /api/cron/run-once
 * Manual trigger for the scheduled jobs. Requires a service-role
 * header (x-cron-key == env.CRON_SHARED_SECRET) — this is NOT a
 * public endpoint. Bypasses the cron:enabled master switch so we
 * can smoke-test the jobs before flipping the flag.
 *
 * Body: { "job": "recurring" | "auto_finalize" | "all" }
 */
async function handleCronRunOnce(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);

  const secret = env.CRON_SHARED_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 501);
  const provided = request.headers.get('x-cron-key') || '';
  if (!timingSafeEqual(provided, secret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const job = body?.job || 'all';

  const out = {};
  if (job === 'recurring' || job === 'all') {
    out.recurring = await materializeRecurringItems(env);
  }
  if (job === 'auto_finalize' || job === 'all') {
    out.auto_finalize = await autoFinalizeDueDrafts(env);
  }
  return json({ ok: true, job, ...out });
}

/**
 * POST /api/trainer/branding/sync — Phase 7 PR #7
 *
 * Pushes the trainer's brand (logo, primary color, display name) onto
 * their connected Stripe account so the hosted-invoice page + PDF
 * render with the trainer's identity instead of Mane Line's.
 *
 *   logo           — read from R2 (trainer_profiles.invoice_logo_r2_key),
 *                    uploaded to files.stripe.com as purpose=business_logo
 *                    on-behalf-of the connected account. Cached by R2 key
 *                    so a no-op resync doesn't re-upload.
 *   primary color  — trainer_invoice_settings.brand_hex -> settings.branding.primary_color
 *   business name  — user_profiles.display_name -> business_profile.name
 *
 * Returns 200 with { synced_at, logo_file_id, has_logo, has_color, has_name }.
 * 404 if the trainer has no Connect account yet (finish onboarding first).
 * Upstream Stripe errors surface as 502.
 */
async function handleTrainerBrandingSync(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  if (!isStripeConfigured(env)) return json({ error: 'stripe_not_configured' }, 501);

  let actorId;
  try {
    ({ actorId } = await requireOwner(request, env));
  } catch (res) {
    return res;
  }

  const profileQ = await supabaseSelect(
    env,
    'user_profiles',
    `select=user_id,role,status,display_name&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const profile = Array.isArray(profileQ.data) ? profileQ.data[0] : null;
  if (!profile || profile.role !== 'trainer' || profile.status !== 'active') {
    return json({ error: 'forbidden' }, 403);
  }

  const tpQ = await supabaseSelect(
    env,
    'trainer_profiles',
    `select=invoice_logo_r2_key,invoice_logo_stripe_file_id,invoice_logo_stripe_file_key&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const tp = Array.isArray(tpQ.data) ? tpQ.data[0] : null;
  if (!tp) return json({ error: 'trainer_profile_missing' }, 404);

  const settingsQ = await supabaseSelect(
    env,
    'trainer_invoice_settings',
    `select=brand_hex&trainer_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const settings = Array.isArray(settingsQ.data) ? settingsQ.data[0] : null;

  const connectQ = await supabaseSelect(
    env,
    'stripe_connect_accounts',
    `select=stripe_account_id&trainer_id=eq.${encodeURIComponent(actorId)}&deactivated_at=is.null&order=created_at.desc&limit=1`,
    { serviceRole: true }
  );
  const connect = Array.isArray(connectQ.data) ? connectQ.data[0] : null;
  if (!connect || !connect.stripe_account_id) {
    return json({ error: 'no_connect_account' }, 404);
  }
  const stripeAccountId = connect.stripe_account_id;

  // Reuse the cached Stripe File id when the R2 logo hasn't changed.
  // If the trainer cleared the logo, unset the icon on Stripe too.
  let logoFileId = null;
  const currentR2Key = tp.invoice_logo_r2_key || null;
  if (currentR2Key) {
    if (
      tp.invoice_logo_stripe_file_id &&
      tp.invoice_logo_stripe_file_key === currentR2Key
    ) {
      logoFileId = tp.invoice_logo_stripe_file_id;
    } else {
      const r2Obj = await env.MANELINE_R2.get(currentR2Key);
      if (!r2Obj) return json({ error: 'logo_fetch_failed', detail: 'r2_object_missing' }, 500);
      const bytes = await r2Obj.arrayBuffer();
      const mimeType = r2Obj.httpMetadata?.contentType || 'image/png';
      const filename = currentR2Key.split('/').pop() || 'logo';
      const up = await uploadStripeFileForAccount(env, {
        stripeAccountId,
        bytes,
        filename,
        mimeType,
        purpose: 'business_logo',
      });
      if (!up.ok || !up.data?.id) {
        return json({ error: 'stripe_file_upload_failed', stripe_error: up.error, message: up.message }, 502);
      }
      logoFileId = up.data.id;
      await supabaseUpdateReturning(
        env,
        'trainer_profiles',
        `user_id=eq.${encodeURIComponent(actorId)}`,
        {
          invoice_logo_stripe_file_id:  logoFileId,
          invoice_logo_stripe_file_key: currentR2Key,
        }
      );
    }
  }

  // encodeForm flattens nested objects into Stripe's `a[b][c]` form,
  // so we can pass the branding block as a plain nested object.
  const branding = {};
  if (logoFileId) branding.icon = logoFileId;
  if (settings?.brand_hex) branding.primary_color = settings.brand_hex;
  const nestedPatch = {};
  if (Object.keys(branding).length) {
    nestedPatch.settings = { branding };
  }
  if (profile.display_name) {
    nestedPatch.business_profile = { name: profile.display_name };
  }

  if (Object.keys(nestedPatch).length === 0) {
    return json({ error: 'nothing_to_sync', detail: 'Set a display name, brand color, or logo first.' }, 400);
  }

  const upd = await updateConnectAccount(env, stripeAccountId, nestedPatch);
  if (!upd.ok) {
    return json({ error: 'account_update_failed', stripe_error: upd.error, message: upd.message }, 502);
  }

  const syncedAt = new Date().toISOString();
  await supabaseUpdateReturning(
    env,
    'trainer_profiles',
    `user_id=eq.${encodeURIComponent(actorId)}`,
    { branding_synced_at: syncedAt }
  );

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'trainer',
    action: 'branding.sync',
    target_table: 'stripe_connect_accounts',
    target_id: stripeAccountId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      logo_file_id: logoFileId,
      primary_color: settings?.brand_hex ?? null,
      business_name: profile.display_name ?? null,
    },
  });

  return json({
    ok:            true,
    synced_at:     syncedAt,
    logo_file_id:  logoFileId,
    has_logo:      Boolean(logoFileId),
    has_color:     Boolean(settings?.brand_hex),
    has_name:      Boolean(profile.display_name),
  });
}

/* =============================================================
   /api/stripe/webhook
   -------------------------------------------------------------
   Receives every Stripe event. Auth is signature-only:
   Stripe-Signature header is HMAC-SHA256 over the raw body with
   STRIPE_WEBHOOK_SECRET. No JWT.

   Flow:
     1. Read raw body, verify signature.
     2. INSERT stripe_webhook_events row keyed by event.id.
        ON CONFLICT means we've seen this event — return 200 and
        skip the handler (idempotency §7 in the law file).
     3. processStripeEvent fans out by event.type.
     4. On success stamp processed_at = now().
     5. On failure store last_error + bump processing_attempts;
        the pg_cron sweep will retry.
   ============================================================= */
const STRIPE_WEBHOOK_RATE = { limit: 120, windowSec: 60 };

async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Fail closed. 401 (not 501) so an attacker scanning for
    // misconfigured instances can't differentiate "endpoint exists
    // but no secret" from "endpoint rejects my signature" by status
    // code — both look like auth failures from the outside. Keep a
    // loud log line so ops notices the secret is missing.
    console.warn('[stripe_webhook] STRIPE_WEBHOOK_SECRET not set — rejecting');
    return json({ error: 'invalid_signature' }, 401);
  }

  // Per-IP ceiling — Stripe's own throughput is well below this.
  const rl = await rateLimit(
    env,
    `ratelimit:stripe_webhook:${clientIp(request)}`,
    STRIPE_WEBHOOK_RATE
  );
  if (!rl.ok) {
    return json({ error: 'rate_limited' }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get('stripe-signature') || '';
  const verify = await verifyStripeSignature({
    rawBody,
    signatureHeader: sigHeader,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  if (!verify.ok) {
    console.warn('[stripe_webhook] signature rejected', { reason: verify.error });
    return json({ error: 'invalid_signature' }, 400);
  }

  let event;
  try { event = JSON.parse(rawBody); } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const eventId = typeof event?.id === 'string' ? event.id : '';
  const eventType = typeof event?.type === 'string' ? event.type : '';
  if (!eventId || !eventType) return json({ error: 'event_malformed' }, 400);

  return ingestStripeEvent(env, event, 'webhook');
}

/* =============================================================
   /api/stripe/sweep/process
   -------------------------------------------------------------
   Internal entry point for the `sweep-stripe-events` Supabase
   Edge Function. Authenticated with the service_role Bearer
   token (the Edge Function already runs with service_role,
   so we compare Authorization to SUPABASE_SERVICE_ROLE_KEY).
   Body: { event: <raw Stripe event object> }
   ============================================================= */
async function handleStripeSweepProcess(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }
  const authz = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (!timingSafeEqual(authz, expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const event = body?.event;
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    return json({ error: 'event_malformed' }, 400);
  }
  return ingestStripeEvent(env, event, 'sweep');
}

/**
 * Shared event ingestion path. Idempotent on event.id. Stamps
 * processed_at on success; otherwise records last_error and
 * bumps processing_attempts for the sweep to retry.
 */
async function ingestStripeEvent(env, event, source) {
  const eventId = event.id;
  const eventType = event.type;

  // 1) Idempotency: has this event already been processed?
  const seen = await supabaseSelect(
    env,
    'stripe_webhook_events',
    `select=id,processed_at,processing_attempts&event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    { serviceRole: true }
  );
  const seenRow = Array.isArray(seen.data) ? seen.data[0] : null;

  let rowId;
  let currentAttempts = 0;
  if (seenRow) {
    if (seenRow.processed_at) {
      return json({ ok: true, idempotent: true, event_id: eventId });
    }
    rowId = seenRow.id;
    currentAttempts = seenRow.processing_attempts || 0;
  } else {
    const ins = await supabaseInsertReturning(env, 'stripe_webhook_events', {
      event_id:   eventId,
      event_type: eventType,
      payload:    event,
      source,
    });
    if (!ins.ok) {
      // Race: another request inserted first. Treat as already-seen.
      return json({ ok: true, idempotent: true, race: true, event_id: eventId });
    }
    rowId = ins.data?.id;
  }

  // 2) Fan out by event type.
  let handlerResult;
  try {
    handlerResult = await processStripeEvent(env, event);
  } catch (err) {
    handlerResult = { ok: false, error: err?.message || 'handler_threw' };
  }

  // 3) Mark processed or bump attempts.
  if (handlerResult.ok) {
    await supabaseUpdateReturning(
      env,
      'stripe_webhook_events',
      `id=eq.${encodeURIComponent(rowId)}`,
      { processed_at: new Date().toISOString(), last_error: null }
    );
    return json({ ok: true, event_id: eventId });
  }

  await supabaseUpdateReturning(
    env,
    'stripe_webhook_events',
    `id=eq.${encodeURIComponent(rowId)}`,
    {
      processing_attempts: currentAttempts + 1,
      last_error:          handlerResult.error || 'unknown',
    }
  );
  // Return 500 so Stripe's own retry loop also fires — belt + suspenders
  // with the pg_cron sweep.
  return json({ ok: false, error: handlerResult.error || 'handler_failed' }, 500);
}

/**
 * Fan-out handler. Returns { ok: true } or { ok: false, error }.
 * Kept side-effect-free of the stripe_webhook_events row — the caller
 * manages processed_at / last_error so replay behavior lives in one
 * place (ingestStripeEvent).
 */
async function processStripeEvent(env, event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(env, event);
    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(env, event);
    case 'account.updated':
      return handleAccountUpdated(env, event);
    case 'charge.refunded':
      return handleChargeRefunded(env, event);
    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(env, event);
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutSessionCompleted(env, event);
    case 'checkout.session.async_payment_failed':
      return handleCheckoutSessionAsyncPaymentFailed(env, event);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionLifecycle(env, event);
    case 'invoice.paid':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible':
      // Trainer white-label invoices only — subscription invoices
      // don't fire these. Ignores unknown IDs so unrelated Stripe
      // accounts (should we ever add more) don't error out.
      return syncConnectInvoiceFromEvent(env, event);
    case 'invoice.payment_succeeded': {
      // Shared between Phase 4 subscriptions and Phase 7 trainer
      // invoices. Route by whether we have a matching row in
      // public.invoices; fall through to the subscription handler
      // otherwise.
      const trainerSync = await syncConnectInvoiceFromEvent(env, event);
      if (trainerSync && !trainerSync.ignored) return trainerSync;
      return handleInvoicePaymentSucceeded(env, event);
    }
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(env, event);
    default:
      // Unhandled events are recorded but treated as success so they
      // don't clog the retry queue. Stripe sends many event types we
      // don't care about.
      return { ok: true, ignored: true };
  }
}

async function handlePaymentIntentSucceeded(env, event) {
  const pi = event.data?.object;
  if (!pi?.id) return { ok: false, error: 'missing_payment_intent' };

  const lookup = await supabaseSelect(
    env,
    'session_payments',
    `select=id,session_id,status&stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return { ok: false, error: 'session_payment_not_found' };
  if (row.status === 'succeeded') return { ok: true, idempotent: true };

  const chargeId =
    (Array.isArray(pi.charges?.data) && pi.charges.data[0]?.id) ||
    pi.latest_charge ||
    null;

  const updPay = await supabaseUpdateReturning(
    env,
    'session_payments',
    `id=eq.${encodeURIComponent(row.id)}`,
    {
      status:                 'succeeded',
      stripe_charge_id:       chargeId,
      stripe_event_last_seen: event.id,
      failure_code:           null,
      failure_message:        null,
    }
  );
  if (!updPay.ok) return { ok: false, error: 'session_payment_update_failed' };

  const updSess = await supabaseUpdateReturning(
    env,
    'training_sessions',
    `id=eq.${encodeURIComponent(row.session_id)}`,
    { status: 'paid' }
  );
  if (!updSess.ok) return { ok: false, error: 'training_session_update_failed' };

  ctx_audit(env, {
    action:       'session_payment.succeeded',
    target_table: 'session_payments',
    target_id:    row.id,
    metadata:     { event_id: event.id, charge_id: chargeId },
  });
  return { ok: true };
}

async function handlePaymentIntentFailed(env, event) {
  const pi = event.data?.object;
  if (!pi?.id) return { ok: false, error: 'missing_payment_intent' };

  const lookup = await supabaseSelect(
    env,
    'session_payments',
    `select=id,status&stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return { ok: false, error: 'session_payment_not_found' };

  const err = pi.last_payment_error || {};
  const upd = await supabaseUpdateReturning(
    env,
    'session_payments',
    `id=eq.${encodeURIComponent(row.id)}`,
    {
      status:                 'failed',
      failure_code:           err.code || err.decline_code || null,
      failure_message:        err.message || null,
      stripe_event_last_seen: event.id,
    }
  );
  if (!upd.ok) return { ok: false, error: 'session_payment_update_failed' };

  ctx_audit(env, {
    action:       'session_payment.failed',
    target_table: 'session_payments',
    target_id:    row.id,
    metadata:     { event_id: event.id, failure_code: err.code || null },
  });
  return { ok: true };
}

async function handleAccountUpdated(env, event) {
  const acct = event.data?.object;
  const acctId = acct?.id;
  if (!acctId) return { ok: false, error: 'missing_account' };

  const lookup = await supabaseSelect(
    env,
    'stripe_connect_accounts',
    `select=id,trainer_id,charges_enabled,payouts_enabled,details_submitted,disabled_reason,deactivated_at&stripe_account_id=eq.${encodeURIComponent(acctId)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) {
    // An account we don't track — ignore gracefully.
    return { ok: true, ignored: true };
  }

  const prevChargesEnabled = Boolean(row.charges_enabled);
  const nextChargesEnabled = Boolean(acct.charges_enabled);

  const upd = await supabaseUpdateReturning(
    env,
    'stripe_connect_accounts',
    `id=eq.${encodeURIComponent(row.id)}`,
    {
      charges_enabled:   nextChargesEnabled,
      payouts_enabled:   Boolean(acct.payouts_enabled),
      details_submitted: Boolean(acct.details_submitted),
      disabled_reason:   acct.requirements?.disabled_reason ?? null,
    }
  );
  if (!upd.ok) return { ok: false, error: 'connect_update_failed' };

  ctx_audit(env, {
    action:       'stripe.account.updated',
    target_table: 'stripe_connect_accounts',
    target_id:    row.id,
    metadata:     {
      event_id:        event.id,
      charges_enabled: nextChargesEnabled,
      payouts_enabled: Boolean(acct.payouts_enabled),
    },
  });

  // Edge-triggered retry: false → true flip on charges_enabled means any
  // awaiting_trainer_setup rows for this trainer should now become real
  // PaymentIntents.
  if (!prevChargesEnabled && nextChargesEnabled && !row.deactivated_at) {
    const retryRes = await retryAwaitingPaymentsForTrainer(env, row.trainer_id, acctId);
    if (!retryRes.ok) return retryRes;
  }
  return { ok: true };
}

async function handleChargeRefunded(env, event) {
  const ch = event.data?.object;
  const piId = ch?.payment_intent;
  const chId = ch?.id;
  if (!piId && !chId) return { ok: false, error: 'missing_identifiers' };

  // Phase 5.5 — shop order refunds. Walk charge.refunds.data[] and, for
  // each refund, upsert the matching order_refunds row by
  // stripe_refund_id. Independent of the session_payments path below.
  const refundObjs = Array.isArray(ch?.refunds?.data) ? ch.refunds.data : [];
  for (const rf of refundObjs) {
    if (!rf?.id) continue;
    const existing = await supabaseSelect(
      env,
      'order_refunds',
      `select=id,order_id,stripe_status,amount_cents&stripe_refund_id=eq.${encodeURIComponent(rf.id)}&limit=1`,
      { serviceRole: true }
    );
    const row = Array.isArray(existing.data) ? existing.data[0] : null;
    if (!row) continue;
    const newStatus = rf.status === 'succeeded'
      ? 'succeeded'
      : rf.status === 'failed' || rf.status === 'canceled'
        ? rf.status
        : 'pending';
    if (row.stripe_status === newStatus) continue;
    const upd = await supabaseUpdateReturning(
      env,
      'order_refunds',
      `id=eq.${encodeURIComponent(row.id)}`,
      {
        stripe_status: newStatus,
        last_error: newStatus === 'failed' ? (rf.failure_reason || null) : null,
      }
    );
    if (!upd.ok) {
      ctx_audit(env, {
        action: 'order_refund.webhook_update_failed',
        target_table: 'order_refunds',
        target_id: row.id,
        metadata: { event_id: event.id, stripe_refund_id: rf.id, status: upd.status },
      });
      continue;
    }
    // If cumulative succeeded refunds now cover the full order, flip orders.status.
    if (newStatus === 'succeeded') {
      const agg = await supabaseSelect(
        env,
        'order_refunds',
        `select=amount_cents,stripe_status&order_id=eq.${encodeURIComponent(row.order_id)}`,
        { serviceRole: true }
      );
      const refunded = (Array.isArray(agg.data) ? agg.data : [])
        .filter((r) => r.stripe_status === 'succeeded')
        .reduce((s, r) => s + (Number.isFinite(r.amount_cents) ? r.amount_cents : 0), 0);
      const orderLookup = await supabaseSelect(
        env,
        'orders',
        `select=id,status,total_cents&id=eq.${encodeURIComponent(row.order_id)}&limit=1`,
        { serviceRole: true }
      );
      const order = Array.isArray(orderLookup.data) ? orderLookup.data[0] : null;
      if (order && refunded >= order.total_cents && order.status !== 'refunded') {
        await supabaseUpdateReturning(
          env,
          'orders',
          `id=eq.${encodeURIComponent(order.id)}`,
          { status: 'refunded' }
        );
      }
    }
    ctx_audit(env, {
      action: 'order_refund.webhook_updated',
      target_table: 'order_refunds',
      target_id: row.id,
      metadata: { event_id: event.id, stripe_refund_id: rf.id, status: newStatus },
    });
  }

  const filter = piId
    ? `stripe_payment_intent_id=eq.${encodeURIComponent(piId)}`
    : `stripe_charge_id=eq.${encodeURIComponent(chId)}`;
  const lookup = await supabaseSelect(
    env,
    'session_payments',
    `select=id,session_id,status&${filter}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return { ok: true, ignored: true };
  if (row.status === 'refunded') return { ok: true, idempotent: true };

  const updPay = await supabaseUpdateReturning(
    env,
    'session_payments',
    `id=eq.${encodeURIComponent(row.id)}`,
    { status: 'refunded', stripe_event_last_seen: event.id }
  );
  if (!updPay.ok) return { ok: false, error: 'session_payment_update_failed' };

  // Session goes back to 'approved' so owner/trainer know the charge
  // was reversed but the event itself still happened.
  const updSess = await supabaseUpdateReturning(
    env,
    'training_sessions',
    `id=eq.${encodeURIComponent(row.session_id)}`,
    { status: 'approved' }
  );
  if (!updSess.ok) return { ok: false, error: 'training_session_update_failed' };

  ctx_audit(env, {
    action:       'session_payment.refunded',
    target_table: 'session_payments',
    target_id:    row.id,
    metadata:     { event_id: event.id, request_id: event.request?.id ?? null },
  });
  return { ok: true };
}

/* =============================================================
   Phase 3.5 — Shop checkout session webhook handlers.
   ------------------------------------------------------------
   The three checkout.session.* events share a payload shape: we
   read metadata.ml_order_id (set on session create in 3.4), load
   the corresponding orders row, snapshot line items into
   order_line_items, and flip status. Idempotency is provided by
   the shared ingestStripeEvent(event.id) UNIQUE guard upstream;
   we additionally short-circuit when orders.status is already
   terminal.
   ============================================================= */

async function handleCheckoutSessionCompleted(env, event) {
  const sess = event.data?.object;

  // Phase 8 — Barn Mode subscription checkout: route before the Phase 6
  // ecommerce branch. These sessions have mode=subscription and carry
  // metadata.ml_source='barn_mode_subscription' (no ml_order_id).
  if (sess?.mode === 'subscription'
      && sess?.metadata?.ml_source === 'barn_mode_subscription') {
    return handleBarnModeCheckoutCompleted(env, sess, event.id);
  }

  const orderId = sess?.metadata?.ml_order_id || null;
  if (!orderId) return { ok: true, ignored: true, reason: 'no_order_metadata' };

  const lookup = await supabaseSelect(
    env,
    'orders',
    `select=id,status,subtotal_cents&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return { ok: false, error: 'order_not_found' };
  if (row.status === 'paid' || row.status === 'refunded') {
    return { ok: true, idempotent: true };
  }

  // Pull line items + payment_intent back from Stripe. Stripe's
  // Checkout Session metadata doesn't include line details, but our
  // product_data.metadata.shopify_variant_id comes through on the
  // expanded line_items.data[].price.product.metadata.
  const hydrate = await retrieveCheckoutSession(env, sess.id);
  if (!hydrate.ok || !hydrate.data) {
    return { ok: false, error: hydrate.error || 'stripe_session_read_failed' };
  }
  const fresh = hydrate.data;
  const lineItems = Array.isArray(fresh.line_items?.data) ? fresh.line_items.data : [];
  const pi = fresh.payment_intent && typeof fresh.payment_intent === 'object'
    ? fresh.payment_intent
    : null;
  const paymentIntentId = pi?.id || (typeof fresh.payment_intent === 'string' ? fresh.payment_intent : null);
  const chargeId =
    (pi?.latest_charge && typeof pi.latest_charge === 'object' && pi.latest_charge.id) ||
    (typeof pi?.latest_charge === 'string' ? pi.latest_charge : null);
  const receiptUrl =
    (pi?.latest_charge && typeof pi.latest_charge === 'object' && pi.latest_charge.receipt_url) || null;

  const subtotalCents = Number.isFinite(fresh.amount_subtotal)
    ? fresh.amount_subtotal
    : row.subtotal_cents;
  const totalCents = Number.isFinite(fresh.amount_total)
    ? fresh.amount_total
    : subtotalCents;
  const taxCents = Number.isFinite(fresh.total_details?.amount_tax)
    ? fresh.total_details.amount_tax
    : 0;
  const shippingCents = Number.isFinite(fresh.total_details?.amount_shipping)
    ? fresh.total_details.amount_shipping
    : 0;

  // Snapshot line items BEFORE flipping the order to paid — if this
  // fails partway we want to retry on the next webhook delivery.
  for (const li of lineItems) {
    const productMeta = li.price?.product?.metadata || {};
    const shopifyVariantId = productMeta.shopify_variant_id || null;
    const productId = productMeta.ml_product_id || null;
    const sku = productMeta.sku || '';
    const title = li.description || li.price?.product?.name || 'Item';
    const unit = Number.isFinite(li.price?.unit_amount) ? li.price.unit_amount : 0;
    const qty = Number.isFinite(li.quantity) ? li.quantity : 1;
    const lineTotal = Number.isFinite(li.amount_total) ? li.amount_total : unit * qty;

    if (!shopifyVariantId) {
      // Legacy/edge: a session minted before we started stamping
      // shopify_variant_id on product_data.metadata. Still snapshot
      // so the owner sees something; reconciliation can happen later.
      await supabaseInsertReturning(env, 'order_line_items', {
        order_id:           orderId,
        product_id:         productId,
        shopify_variant_id: 'unknown',
        sku_snapshot:       sku,
        title_snapshot:     title,
        unit_price_cents:   unit,
        quantity:           qty,
        line_total_cents:   lineTotal,
      });
      continue;
    }

    await supabaseInsertReturning(env, 'order_line_items', {
      order_id:           orderId,
      product_id:         productId,
      shopify_variant_id: shopifyVariantId,
      sku_snapshot:       sku,
      title_snapshot:     title,
      unit_price_cents:   unit,
      quantity:           qty,
      line_total_cents:   lineTotal,
    });
  }

  const upd = await supabaseUpdateReturning(
    env,
    'orders',
    `id=eq.${encodeURIComponent(orderId)}`,
    {
      status:                    'paid',
      stripe_payment_intent_id:  paymentIntentId,
      stripe_charge_id:          chargeId,
      stripe_receipt_url:        receiptUrl,
      subtotal_cents:            subtotalCents,
      tax_cents:                 taxCents,
      shipping_cents:            shippingCents,
      total_cents:               totalCents,
      failure_code:              null,
      failure_message:           null,
    }
  );
  if (!upd.ok) return { ok: false, error: 'order_update_failed' };

  ctx_audit(env, {
    action:       'order.paid',
    target_table: 'orders',
    target_id:    orderId,
    metadata: {
      event_id:     event.id,
      session_id:   sess.id,
      total_cents:  totalCents,
      tax_cents:    taxCents,
      shipping_cents: shippingCents,
      line_count:   lineItems.length,
    },
  });

  // Phase 3.8 — in-expense one-tap purchase: if the session carried an
  // expense_draft payload, auto-create the matching expenses row now
  // that payment has cleared. The checkout mint enforced items.length===1
  // and validated animal access, so we trust the draft here. Idempotent
  // on order_id — webhook replays won't double-insert.
  const draftJson = sess?.metadata?.ml_expense_draft_json || null;
  if (draftJson && lineItems.length >= 1) {
    let draft = null;
    try { draft = JSON.parse(draftJson); } catch { draft = null; }
    if (draft && draft.animal_id && draft.recorder_id && draft.recorder_role && draft.occurred_on) {
      const existing = await supabaseSelect(
        env,
        'expenses',
        `select=id&order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
        { serviceRole: true }
      );
      const already = Array.isArray(existing.data) && existing.data.length > 0;
      if (!already) {
        const li0 = lineItems[0];
        const productMeta = li0.price?.product?.metadata || {};
        const productId = productMeta.ml_product_id || null;
        const unit = Number.isFinite(li0.price?.unit_amount) ? li0.price.unit_amount : 0;
        const ins = await supabaseInsertReturning(env, 'expenses', {
          animal_id:     draft.animal_id,
          recorder_id:   draft.recorder_id,
          recorder_role: draft.recorder_role,
          category:      'supplement',
          vendor:        'silver_lining',
          amount_cents:  unit,
          currency:      'usd',
          occurred_on:   draft.occurred_on,
          notes:         draft.notes ?? null,
          product_id:    productId,
          order_id:      orderId,
        });
        if (ins.ok) {
          ctx_audit(env, {
            action:       'expense.auto_created_from_order',
            target_table: 'expenses',
            target_id:    ins.data?.id || null,
            metadata: {
              order_id:      orderId,
              animal_id:     draft.animal_id,
              product_id:    productId,
              amount_cents:  unit,
              recorder_role: draft.recorder_role,
            },
          });
        } else {
          ctx_audit(env, {
            action:       'expense.auto_create_failed',
            target_table: 'orders',
            target_id:    orderId,
            metadata: {
              status:    ins.status ?? null,
              animal_id: draft.animal_id,
            },
          });
        }
      }
    }
  }

  // Shopify inventory decrement — best-effort. If SHOPIFY_ADMIN_API_TOKEN
  // is unset the helper is a no-op; if it's set but fails we log and
  // move on (hourly sync will reconcile within ~1h).
  for (const li of lineItems) {
    const variantId = li.price?.product?.metadata?.shopify_variant_id;
    const qty = Number.isFinite(li.quantity) ? li.quantity : 1;
    if (!variantId) continue;
    try {
      const res = await adjustInventory(env, {
        shopifyVariantId: variantId,
        delta: -qty,
      });
      if (!res.ok && !res.skipped) {
        ctx_audit(env, {
          action:       'shopify.inventory_adjust_failed',
          target_table: 'orders',
          target_id:    orderId,
          metadata: {
            event_id:   event.id,
            variant_id: variantId,
            delta:      -qty,
            error:      res.error,
            message:    res.message ?? null,
          },
        });
      }
    } catch {
      // Swallow — webhook idempotency is the backstop.
    }
  }

  return { ok: true };
}

async function handleCheckoutSessionAsyncPaymentFailed(env, event) {
  const sess = event.data?.object;
  const orderId = sess?.metadata?.ml_order_id || null;
  if (!orderId) return { ok: true, ignored: true, reason: 'no_order_metadata' };

  const lookup = await supabaseSelect(
    env,
    'orders',
    `select=id,status&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row) return { ok: false, error: 'order_not_found' };
  if (row.status === 'failed' || row.status === 'refunded') {
    return { ok: true, idempotent: true };
  }

  // Stripe doesn't include last_payment_error on the session object —
  // pull it from the expanded payment_intent.
  let failureCode = 'async_payment_failed';
  let failureMessage = null;
  try {
    const hydrate = await retrieveCheckoutSession(env, sess.id);
    const pi = hydrate.ok && hydrate.data?.payment_intent && typeof hydrate.data.payment_intent === 'object'
      ? hydrate.data.payment_intent
      : null;
    if (pi?.last_payment_error) {
      failureCode = pi.last_payment_error.code || pi.last_payment_error.decline_code || failureCode;
      failureMessage = pi.last_payment_error.message || null;
    }
  } catch {
    // Fall through with generic code.
  }

  const upd = await supabaseUpdateReturning(
    env,
    'orders',
    `id=eq.${encodeURIComponent(orderId)}`,
    {
      status:          'failed',
      failure_code:    failureCode,
      failure_message: failureMessage,
    }
  );
  if (!upd.ok) return { ok: false, error: 'order_update_failed' };

  ctx_audit(env, {
    action:       'order.failed',
    target_table: 'orders',
    target_id:    orderId,
    metadata: {
      event_id:      event.id,
      session_id:    sess.id,
      failure_code:  failureCode,
    },
  });
  return { ok: true };
}

/* =============================================================
   GET /api/orders — owner reads their own orders (index).
   ------------------------------------------------------------
   Thin wrapper over PostgREST. RLS on `orders` scopes rows to
   the requesting owner. Sorted newest-first.  Orders with
   status='pending_payment' are intentionally NOT filtered out
   here — they're filtered in the SPA so owners can still see
   `awaiting_merchant_setup` orders. (OAG §8.)
   ============================================================= */
async function handleOrdersList(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  let jwt;
  try {
    ({ jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  // Grab 100 most recent — enough for any owner realistically to
  // scroll through; pagination can land if we ever see > 100/owner.
  const ordersRes = await supabaseSelect(
    env,
    'orders',
    `select=id,status,subtotal_cents,tax_cents,shipping_cents,total_cents,currency,source,created_at,stripe_receipt_url&order=created_at.desc&limit=100`,
    { userJwt: jwt }
  );
  if (!ordersRes.ok) {
    return json({ error: 'orders_read_failed' }, 500);
  }
  const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  if (orders.length === 0) {
    return json({ orders: [] });
  }

  // Fetch line-item counts in one round-trip so the index can show
  // "3 items" without N+1 queries.
  const ids = orders.map((o) => o.id);
  const filter = ids.map((id) => `"${id}"`).join(',');
  const linesRes = await supabaseSelect(
    env,
    'order_line_items',
    `select=order_id,quantity&order_id=in.(${encodeURIComponent(filter)})`,
    { userJwt: jwt }
  );
  const byOrder = new Map();
  if (linesRes.ok && Array.isArray(linesRes.data)) {
    for (const li of linesRes.data) {
      const cur = byOrder.get(li.order_id) ?? { lines: 0, units: 0 };
      cur.lines += 1;
      cur.units += Number(li.quantity) || 0;
      byOrder.set(li.order_id, cur);
    }
  }

  const enriched = orders.map((o) => ({
    ...o,
    line_count: byOrder.get(o.id)?.lines ?? 0,
    unit_count: byOrder.get(o.id)?.units ?? 0,
  }));
  return json({ orders: enriched });
}

/* =============================================================
   GET /api/orders/:id — owner reads their own order.
   ------------------------------------------------------------
   Thin wrapper over PostgREST so the SPA success page has a
   single place to poll during the Stripe→webhook race. RLS on
   `orders` + `order_line_items` (owner SELECT) enforces
   authorization — we call supabaseSelect with the user's JWT,
   not service_role.
   ============================================================= */
async function handleOrderGet(request, env, orderId) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const uuidShape = /^[0-9a-f-]{32,40}$/i;
  if (!uuidShape.test(orderId)) {
    return json({ error: 'bad_id' }, 400);
  }

  let jwt;
  try {
    ({ jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const orderRes = await supabaseSelect(
    env,
    'orders',
    `select=id,status,subtotal_cents,tax_cents,shipping_cents,total_cents,currency,source,created_at,stripe_checkout_session_id,stripe_receipt_url,failure_code,failure_message&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { userJwt: jwt }
  );
  if (!orderRes.ok) {
    return json({ error: 'order_read_failed' }, 500);
  }
  const order = Array.isArray(orderRes.data) ? orderRes.data[0] : null;
  if (!order) {
    // RLS hides other-owner rows as 404 equivalent.
    return json({ error: 'not_found' }, 404);
  }

  const linesRes = await supabaseSelect(
    env,
    'order_line_items',
    `select=id,product_id,shopify_variant_id,sku_snapshot,title_snapshot,unit_price_cents,quantity,line_total_cents&order_id=eq.${encodeURIComponent(orderId)}&order=created_at.asc`,
    { userJwt: jwt }
  );
  const lines = Array.isArray(linesRes.data) ? linesRes.data : [];

  // Phase 5.5 — owner-visible refund history. order_refunds RLS grants
  // owner SELECT via the join on orders.owner_id, so we pass the user's
  // JWT rather than service_role.
  const refundsRes = await supabaseSelect(
    env,
    'order_refunds',
    `select=id,amount_cents,reason,stripe_status,created_at&order_id=eq.${encodeURIComponent(orderId)}&order=created_at.asc`,
    { userJwt: jwt }
  );
  const refunds = Array.isArray(refundsRes.data) ? refundsRes.data : [];

  return json({ order, line_items: lines, refunds });
}

/**
 * For every session_payments row belonging to this trainer that is
 * still parked in 'awaiting_trainer_setup', mint a PaymentIntent and
 * flip to 'pending'. Called from the account.updated handler when
 * charges_enabled transitions false → true.
 *
 * TECH_DEBT(phase-2.5): we should email the owner a one-tap confirm
 * link per pending row. No mail helper exists yet; for now we log an
 * audit_log row per retry so ops can follow up by hand. See
 * docs/phase-2-plan.md §6 (resolved decision #2 + watch item on email).
 */
async function retryAwaitingPaymentsForTrainer(env, trainerId, stripeAccountId) {
  const pending = await supabaseSelect(
    env,
    'session_payments',
    `select=id,session_id,amount_cents,platform_fee_cents,payer_id&payee_id=eq.${encodeURIComponent(trainerId)}&status=eq.awaiting_trainer_setup`,
    { serviceRole: true }
  );
  const rows = Array.isArray(pending.data) ? pending.data : [];
  if (rows.length === 0) return { ok: true, retried: 0 };

  if (!isStripeConfigured(env)) {
    return { ok: false, error: 'stripe_not_configured_on_retry' };
  }

  let retried = 0;
  for (const r of rows) {
    const pi = await createPaymentIntent(env, {
      amountCents:               r.amount_cents,
      applicationFeeAmountCents: r.platform_fee_cents,
      destinationAccountId:      stripeAccountId,
      idempotencyKey:            `session_pay_retry:${r.id}:${r.amount_cents}:${r.platform_fee_cents}`,
      description:               `Mane Line session ${r.session_id}`,
      metadata: {
        session_id: r.session_id,
        owner_id:   r.payer_id,
        trainer_id: trainerId,
        retry:      'account.updated',
      },
    });
    if (!pi.ok || !pi.data?.id) {
      // Leave this row in awaiting_trainer_setup; the next sweep or
      // the next account.updated event will pick it up.
      continue;
    }
    const upd = await supabaseUpdateReturning(
      env,
      'session_payments',
      `id=eq.${encodeURIComponent(r.id)}`,
      {
        stripe_payment_intent_id: pi.data.id,
        status:                   'pending',
        failure_code:             null,
        failure_message:          null,
      }
    );
    if (upd.ok) {
      retried++;
      ctx_audit(env, {
        action:       'session_payment.auto_retry',
        target_table: 'session_payments',
        target_id:    r.id,
        metadata:     { payment_intent_id: pi.data.id, trigger: 'account.updated' },
      });
    }
  }
  return { ok: true, retried };
}


/* =============================================================
   Phase 4 — Workers AI + Vectorize internal endpoints
   -------------------------------------------------------------
   Both routes are INTERNAL. They gate on a constant-time match
   of the X-Internal-Secret header against env.WORKER_INTERNAL_SECRET
   (a secret shared with the Supabase Edge Function that drives
   the seed pipeline). Never exposed to end users.

   /api/ai/embed              POST { text }                  →  { vector: float[768] }
   /api/protocols/embed-index POST { protocol_id, text, metadata? }
                                                             →  { ok, dims, mutationId }
   ============================================================= */

async function requireInternalSecret(request, env) {
  if (!env.WORKER_INTERNAL_SECRET) {
    return json({ error: 'not_configured' }, 500);
  }
  const got = request.headers.get('x-internal-secret') || '';
  if (!timingSafeEqual(got, env.WORKER_INTERNAL_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

async function handleAiEmbed(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const gate = await requireInternalSecret(request, env);
  if (gate) return gate;

  const body = await readJson(request);
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return json({ error: 'text_required' }, 400);
  }

  try {
    const vector = await embedText(env, text);
    return json({ vector, dims: EMBED_DIMS });
  } catch (err) {
    return json({ error: 'embed_failed', detail: err?.message ?? 'unknown' }, 502);
  }
}

async function handleProtocolEmbedIndex(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const gate = await requireInternalSecret(request, env);
  if (gate) return gate;

  const body = await readJson(request);
  const protocolId = typeof body?.protocol_id === 'string' ? body.protocol_id.trim() : '';
  const text       = typeof body?.text === 'string' ? body.text : '';
  const metadata   = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};

  if (!protocolId || !/^[0-9a-f-]{36}$/i.test(protocolId)) {
    return json({ error: 'protocol_id_invalid' }, 400);
  }
  if (!text.trim()) {
    return json({ error: 'text_required' }, 400);
  }

  let vector;
  try {
    vector = await embedText(env, text);
  } catch (err) {
    return json(
      { error: 'embed_failed', detail: err?.message ?? 'unknown' },
      502
    );
  }

  try {
    const res = await upsertProtocolVector(env, protocolId, vector, metadata);
    return json({
      ok: true,
      dims: EMBED_DIMS,
      mutation_id: res.mutationId,
      count: res.count,
    });
  } catch (err) {
    return json(
      { error: 'vectorize_upsert_failed', detail: err?.message ?? 'unknown' },
      502
    );
  }
}

/* =============================================================
   Phase 5.6 — /api/_internal/hubspot-drain
   -------------------------------------------------------------
   Called by pg_cron every 5m via net.http_post from the
   drain_hubspot_syncs() plpgsql function. Body shape:
     { rows: [{ id, event_name, payload, attempts }] }
   — each row is already status='sending' in the queue (the
   plpgsql function flipped it before POSTing).

   Responsibilities:
     1. Gate on X-Internal-Secret (same pattern as /api/ai/embed).
     2. If HUBSPOT_PRIVATE_APP_TOKEN missing → push rows back to
        'pending' with a 15m next_run_at, return 501
        hubspot_not_configured. Matches plan §5.6's graceful
        "waiting on keys" pattern.
     3. For each row: upsert HubSpot contact, send behavioral
        event, write hubspot_sync_log on success. 4xx → dead_letter.
        5xx / throw → backoff (15m × 2^attempts, max 5).
   ============================================================= */

const HUBSPOT_MAX_ATTEMPTS = 5;
const HUBSPOT_BACKOFF_BASE_MS = 15 * 60 * 1000;

function truncateError(msg) {
  return typeof msg === 'string' ? msg.slice(0, 500) : 'unknown';
}

async function handleHubspotDrain(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const gate = await requireInternalSecret(request, env);
  if (gate) return gate;

  const body = await readJson(request);
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  if (!isHubspotConfigured(env)) {
    const delayedAt = new Date(Date.now() + HUBSPOT_BACKOFF_BASE_MS).toISOString();
    for (const r of rows) {
      if (!r?.id) continue;
      await supabaseUpdateReturning(
        env,
        'pending_hubspot_syncs',
        `id=eq.${encodeURIComponent(r.id)}`,
        {
          status: 'pending',
          next_run_at: delayedAt,
          last_error: 'hubspot_not_configured',
        }
      );
    }
    return json({ error: 'hubspot_not_configured' }, 501);
  }

  let sent = 0;
  let dead_letter = 0;
  let retried = 0;

  for (const r of rows) {
    if (!r?.id || typeof r.event_name !== 'string') {
      continue;
    }
    const eventName = r.event_name;
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    const attempts = typeof r.attempts === 'number' ? r.attempts : 0;

    const hs = toHubspotPayload(eventName, payload);
    if (!hs.email) {
      await supabaseUpdateReturning(
        env,
        'pending_hubspot_syncs',
        `id=eq.${encodeURIComponent(r.id)}`,
        { status: 'dead_letter', last_error: 'missing_email' }
      );
      dead_letter++;
      continue;
    }

    const t0 = Date.now();
    try {
      const contactRes = await upsertContact(env, hs.email, hs.contactProperties);
      if (contactRes.status >= 400 && contactRes.status < 500) {
        await supabaseUpdateReturning(
          env,
          'pending_hubspot_syncs',
          `id=eq.${encodeURIComponent(r.id)}`,
          {
            status: 'dead_letter',
            last_error: truncateError(
              `contact_${contactRes.status}: ${JSON.stringify(contactRes.data)}`
            ),
          }
        );
        dead_letter++;
        continue;
      }
      if (!contactRes.ok) {
        throw new Error(`contact_upsert_${contactRes.status}`);
      }

      const eventRes = await sendBehavioralEvent(env, {
        eventName,
        email: hs.email,
        properties: hs.eventProperties,
      });
      if (eventRes.status >= 400 && eventRes.status < 500) {
        await supabaseUpdateReturning(
          env,
          'pending_hubspot_syncs',
          `id=eq.${encodeURIComponent(r.id)}`,
          {
            status: 'dead_letter',
            last_error: truncateError(
              `event_${eventRes.status}: ${JSON.stringify(eventRes.data)}`
            ),
          }
        );
        dead_letter++;
        continue;
      }
      if (!eventRes.ok) {
        throw new Error(`event_send_${eventRes.status}`);
      }

      const contactId =
        Array.isArray(contactRes.data?.results) && contactRes.data.results[0]?.id
          ? String(contactRes.data.results[0].id)
          : null;

      await supabaseInsert(env, 'hubspot_sync_log', {
        event_name: eventName,
        hubspot_contact_id: contactId,
        payload,
        response: { contact: contactRes.data, event: eventRes.data },
        latency_ms: Date.now() - t0,
      });
      await supabaseUpdateReturning(
        env,
        'pending_hubspot_syncs',
        `id=eq.${encodeURIComponent(r.id)}`,
        { status: 'sent', last_error: null }
      );
      sent++;
    } catch (err) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= HUBSPOT_MAX_ATTEMPTS) {
        await supabaseUpdateReturning(
          env,
          'pending_hubspot_syncs',
          `id=eq.${encodeURIComponent(r.id)}`,
          {
            status: 'dead_letter',
            attempts: nextAttempts,
            last_error: truncateError(err?.message ?? 'unknown'),
          }
        );
        dead_letter++;
      } else {
        const backoffMs = HUBSPOT_BACKOFF_BASE_MS * Math.pow(2, nextAttempts - 1);
        const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
        await supabaseUpdateReturning(
          env,
          'pending_hubspot_syncs',
          `id=eq.${encodeURIComponent(r.id)}`,
          {
            status: 'pending',
            attempts: nextAttempts,
            next_run_at: nextRunAt,
            last_error: truncateError(err?.message ?? 'unknown'),
          }
        );
        retried++;
      }
    }
  }

  return json({ processed: rows.length, sent, dead_letter, retried });
}

/* =============================================================
   Phase 4.3 — /api/chat
   -------------------------------------------------------------
   Owner-facing RAG chat. Flow:

     1. requireOwner JWT.
     2. KV daily rate-limit (30/day/user). 429 on overrun.
     3. Emergency keyword short-circuit — writes a chatbot_runs row
        with emergency_triggered=true, returns JSON (no AI call).
     4. Insert user turn into chatbot_runs.
     5. Embed message → query Vectorize (top-K) → hydrate protocols
        (with Phase 3 linked products).
     6. Compose messages (system-prompt + retrieved block + last 8
        turns of history + user turn) and stream Llama-3.3-70B.
     7. Tee the SSE stream: forward one branch to client, accumulate
        the other into `response_text`. On stream close (via
        ctx.waitUntil) insert the assistant chatbot_runs row and
        touch the conversation.
     8. On AI error / 8s timeout → fall back to keyword search over
        `protocols.keywords`. Return JSON (not SSE) with the canned
        "warming up" copy + top-3 protocols; log fallback='kv_keyword'.

   Response envelope:
     - Success  : text/event-stream
         headers: X-Conversation-Id, X-Rate-Limit-Remaining,
                  X-Protocol-Ids (comma-joined), X-Model
     - Emergency: 200 JSON { emergency: true, matched_keyword,
                             conversation_id }
     - Fallback : 200 JSON { fallback: 'kv_keyword', message,
                             protocols: [...], conversation_id }
     - 429      : JSON { error: 'rate_limited', remaining: 0 }
     - 400/401/500 per usual.
   ============================================================= */

async function handleChat(request, env, ctx) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId;
  try {
    ({ actorId } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const body = await readJson(request);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const requestedConvId =
    typeof body?.conversation_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.conversation_id)
      ? body.conversation_id
      : null;
  if (!message) {
    return json({ error: 'message_required' }, 400);
  }
  if (message.length > 2000) {
    return json({ error: 'message_too_long', max: 2000 }, 400);
  }

  // ---- Rate limit ---------------------------------------------------
  const rl = await incrementDailyRateLimit(env, actorId);
  if (!rl.ok) {
    return json({ error: 'rate_limited', remaining: 0 }, 429);
  }

  // ---- Emergency short-circuit (before conversation insert, but we
  //      still write an auditable chatbot_runs row so the guardrail
  //      leaves a trail). ----------------------------------------------
  const matchedKeyword = detectEmergency(message);

  // ---- Conversation + user turn ------------------------------------
  let conversation;
  try {
    conversation = await getOrCreateConversation(env, actorId, requestedConvId, message);
  } catch (err) {
    return json({ error: 'conversation_failed', detail: err?.message ?? 'unknown' }, 500);
  }
  const convId = conversation.id;

  // Fetch history BEFORE inserting the user turn so the trailing user
  // message we pass to composeMessages doesn't double up.
  const history = await getRecentHistory(env, convId, 8);

  const userTurnIndex = await nextTurnIndex(env, convId);
  await insertChatbotRun(env, {
    conversation_id:      convId,
    turn_index:           userTurnIndex,
    role:                 'user',
    user_text:            message,
    emergency_triggered:  Boolean(matchedKeyword),
    rate_limit_remaining: rl.remaining,
  });

  if (matchedKeyword) {
    // Log the emergency-assistant row (role=assistant, response_text=null,
    // emergency_triggered=true). Client renders the red alert banner with
    // animals.vet_phone tap-to-copy — the assistant text comes from the SPA,
    // not the model.
    await insertChatbotRun(env, {
      conversation_id:      convId,
      turn_index:           userTurnIndex + 1,
      role:                 'assistant',
      response_text:        null,
      fallback:             'emergency',
      emergency_triggered:  true,
      rate_limit_remaining: rl.remaining,
    });
    ctx.waitUntil(touchConversation(env, convId));
    return json({
      emergency:       true,
      matched_keyword: matchedKeyword,
      conversation_id: convId,
      remaining:       rl.remaining,
    });
  }

  // ---- RAG: embed → Vectorize → hydrate ----------------------------
  let retrievedIds = [];
  let retrieved = [];
  try {
    const vector = await embedText(env, message);
    const matches = await queryProtocolVectors(env, vector, RAG_TOP_K);
    retrievedIds = Array.isArray(matches)
      ? matches.map((m) => m?.id).filter((s) => typeof s === 'string')
      : [];
    retrieved = await hydrateProtocols(env, retrievedIds);
  } catch (err) {
    // Embed or Vectorize down → skip retrieval; the model still gets
    // the system prompt. If the model also fails we fall through to
    // kvKeywordFallback below.
    retrievedIds = [];
    retrieved = [];
  }

  const messages = composeMessages(retrieved, history, message);

  // ---- Stream (with 8s timeout + keyword fallback) -----------------
  const started = Date.now();
  let aiStream;
  try {
    aiStream = await runChatModelWithTimeout(env, messages);
  } catch (err) {
    console.error('chat.ai_failed', {
      msg: err?.message ?? 'unknown',
      name: err?.name,
      stack: typeof err?.stack === 'string' ? err.stack.slice(0, 500) : undefined,
    });
    // Keyword fallback: no AI, but still a useful answer.
    const fbRows = await kvKeywordFallback(env, message);
    const hydrated = fbRows.length
      ? await hydrateProtocols(env, fbRows.map((r) => r.id))
      : [];
    const assistantTurn = userTurnIndex + 1;
    ctx.waitUntil((async () => {
      await insertChatbotRun(env, {
        conversation_id:        convId,
        turn_index:             assistantTurn,
        role:                   'assistant',
        response_text:          FALLBACK_CANNED_MESSAGE,
        retrieved_protocol_ids: hydrated.map((p) => p.id),
        fallback:               'kv_keyword',
        latency_ms:             Date.now() - started,
        rate_limit_remaining:   rl.remaining,
      });
      await touchConversation(env, convId);
    })());
    return json({
      fallback:        'kv_keyword',
      message:         FALLBACK_CANNED_MESSAGE,
      protocols:       hydrated,
      conversation_id: convId,
      remaining:       rl.remaining,
    });
  }

  const { clientBranch, accumulated } = teeAndAccumulate(aiStream);

  const assistantTurn = userTurnIndex + 1;
  ctx.waitUntil((async () => {
    try {
      const text = await accumulated;
      await insertChatbotRun(env, {
        conversation_id:        convId,
        turn_index:             assistantTurn,
        role:                   'assistant',
        response_text:          text,
        retrieved_protocol_ids: retrieved.map((p) => p.id),
        model_id:               CHAT_MODEL,
        latency_ms:             Date.now() - started,
        rate_limit_remaining:   rl.remaining,
      });
      await touchConversation(env, convId);
    } catch {
      // Swallow — this is best-effort audit logging.
    }
  })());

  return new Response(clientBranch, {
    status: 200,
    headers: {
      'content-type':          'text/event-stream; charset=utf-8',
      'cache-control':         'no-store',
      'x-conversation-id':     convId,
      'x-rate-limit-remaining':String(rl.remaining),
      'x-protocol-ids':        retrieved.map((p) => p.id).join(','),
      'x-model':               CHAT_MODEL,
    },
  });
}

/* =============================================================
   Phase 8 — Barn Mode Module 01 — Professional Contacts CRUD
   ============================================================= */

const BARN_CONTACT_RATE = { limit: 30, windowSec: 60 };
// Aligned with SPA `ProContactRole` in app/src/lib/barn.ts + DB CHECK
// professional_contacts_role_check (migration 00035). `staff` is kept
// for backward compatibility with rows that predate the SPA role set.
const BARN_CONTACT_ROLES = new Set([
  'farrier',
  'vet',
  'nutritionist',
  'bodyworker',
  'trainer',
  'boarding',
  'hauler',
  'staff',
  'other',
]);

function normalizeContactBody(body, { requireAll = true } = {}) {
  const out = {};
  const errs = [];

  if (body.name !== undefined || requireAll) {
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 120) {
      errs.push('name must be 1..120 chars');
    } else {
      out.name = body.name.trim();
    }
  }
  if (body.role !== undefined || requireAll) {
    if (!BARN_CONTACT_ROLES.has(body.role)) {
      errs.push('role must be one of farrier|vet|nutritionist|bodyworker|trainer|boarding|hauler|staff|other');
    } else {
      out.role = body.role;
    }
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === '') {
      out.email = null;
    } else if (!isEmail(body.email)) {
      errs.push('email format invalid');
    } else {
      out.email = body.email.trim().toLowerCase();
    }
  }
  if (body.phone_e164 !== undefined) {
    if (body.phone_e164 === null || body.phone_e164 === '') {
      out.phone_e164 = null;
    } else if (!isE164(body.phone_e164)) {
      errs.push('phone_e164 must be E.164 (+<country><number>)');
    } else {
      out.phone_e164 = body.phone_e164;
    }
  }
  if (body.company !== undefined) {
    if (body.company === null || body.company === '') {
      out.company = null;
    } else if (typeof body.company !== 'string' || body.company.length > 200) {
      errs.push('company must be <=200 chars');
    } else {
      out.company = body.company.trim();
    }
  }
  if (body.notes !== undefined) {
    if (body.notes === null || body.notes === '') {
      out.notes = null;
    } else if (typeof body.notes !== 'string' || body.notes.length > 2000) {
      errs.push('notes must be <=2000 chars');
    } else {
      out.notes = body.notes;
    }
  }
  if (body.sms_opt_in !== undefined) {
    if (typeof body.sms_opt_in !== 'boolean') {
      errs.push('sms_opt_in must be boolean');
    } else {
      out.sms_opt_in = body.sms_opt_in;
    }
  }

  return { patch: out, errs };
}

async function handleProContactsList(request, env, url) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_contacts_list:${actorId}`, BARN_CONTACT_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  const role = url.searchParams.get('role');
  const includeArchived = url.searchParams.get('include_archived') === '1';

  const filters = [`owner_id=eq.${actorId}`];
  if (role && BARN_CONTACT_ROLES.has(role)) filters.push(`role=eq.${role}`);
  if (!includeArchived) filters.push('archived_at=is.null');
  const q = `select=*&${filters.join('&')}&order=name.asc`;

  const r = await barnSrSelect(env, 'professional_contacts', q);
  if (!r.ok) return json({ error: 'list_failed', status: r.status }, 500);
  return json({ contacts: r.data || [] });
}

async function handleProContactCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_contacts_create:${actorId}`, BARN_CONTACT_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const { patch, errs } = normalizeContactBody(body, { requireAll: true });
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  // Best-effort lazy-link: if the email matches a Maneline user, stamp linked_user_id.
  let linkedUserId = null;
  if (patch.email) {
    const hit = await lookupUserByEmail(env, patch.email);
    if (hit && hit.userId) linkedUserId = hit.userId;
  }

  const insert = await barnSrInsertReturning(env, 'professional_contacts', {
    owner_id: actorId,
    name: patch.name,
    role: patch.role,
    email: patch.email ?? null,
    phone_e164: patch.phone_e164 ?? null,
    company: patch.company ?? null,
    notes: patch.notes ?? null,
    sms_opt_in: patch.sms_opt_in ?? false,
    linked_user_id: linkedUserId,
  });
  if (!insert.ok || !insert.data) {
    return json({ error: 'insert_failed', status: insert.status, detail: insert.data }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.pro_contact.create',
    target_table: 'professional_contacts',
    target_id: insert.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { role: patch.role, linked_user_id: linkedUserId },
  }, ctx);

  return json({ contact: insert.data }, 201);
}

async function handleProContactUpdate(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_contacts_update:${actorId}`, BARN_CONTACT_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const { patch, errs } = normalizeContactBody(body, { requireAll: false });
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields_to_update' }, 400);

  if (patch.email !== undefined) {
    if (patch.email === null) {
      patch.linked_user_id = null;
    } else {
      const hit = await lookupUserByEmail(env, patch.email);
      patch.linked_user_id = hit?.userId || null;
    }
  }

  const filter = `id=eq.${id}&owner_id=eq.${actorId}&archived_at=is.null`;
  const upd = await barnSrPatchReturning(env, 'professional_contacts', filter, patch);
  if (!upd.ok) return json({ error: 'update_failed', status: upd.status }, 500);
  if (!upd.data) return json({ error: 'not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.pro_contact.update',
    target_table: 'professional_contacts',
    target_id: id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { fields: Object.keys(patch) },
  }, ctx);

  return json({ contact: upd.data });
}

async function handleProContactArchive(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_contacts_archive:${actorId}`, BARN_CONTACT_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  const arch = await barnSrArchive(env, 'professional_contacts', id, actorId);
  if (!arch.ok) return json({ error: 'archive_failed', status: arch.status }, 500);
  if (!arch.data) return json({ error: 'not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.pro_contact.archive',
    target_table: 'professional_contacts',
    target_id: id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({ contact: arch.data });
}

/* =============================================================
   Phase 8 — Barn Mode Module 01 — Events CRUD + respond
   ============================================================= */

const BARN_EVENT_RATE   = { limit: 60, windowSec: 60 };
const BARN_CREATE_RATE  = { limit: 30, windowSec: 60 };
const BARN_RESPOND_RATE = { limit: 30, windowSec: 60 };
const BARN_PUBLIC_GET_RATE     = { limit: 60, windowSec: 60 };
const BARN_PUBLIC_RESPOND_RATE = { limit: 20, windowSec: 60 };
const EVENT_STATUSES     = new Set(['scheduled','in_progress','completed','cancelled']);
const RESPONSE_STATUSES  = new Set(['confirmed','declined','countered','cancelled']);
const DELIVERY_CHANNELS  = new Set(['in_app','email','email_sms']);

function validateIsoTimestamp(s) {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function assertOwnerOwnsAnimals(env, ownerId, animalIds) {
  if (!animalIds.length) return { ok: true };
  const inList = animalIds.map(encodeURIComponent).join(',');
  const q = `select=id&id=in.(${inList})&owner_id=eq.${ownerId}&archived_at=is.null`;
  const r = await barnSrSelect(env, 'animals', q);
  if (!r.ok) return { ok: false, status: 500, error: 'animals_check_failed' };
  const owned = new Set((r.data || []).map((x) => x.id));
  const missing = animalIds.filter((id) => !owned.has(id));
  if (missing.length) return { ok: false, status: 403, error: 'animal_not_owned', missing };
  return { ok: true };
}

async function fireInvitationEmail(env, { event, attendee, ownerName }) {
  if (!attendee.email) return { skipped: true, reason: 'no_email' };
  if (attendee.delivery_channel === 'in_app') return { skipped: true, reason: 'in_app_only' };
  if (!isResendConfigured(env)) return { skipped: true, reason: 'resend_not_configured' };

  const link = attendee.public_token ? publicEventUrl(env, attendee.public_token) : null;
  const startHuman = new Date(event.start_at).toUTCString();
  const subject = `${ownerName || 'Mane Line'} invited you: ${event.title}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="color:#0f172a;margin:0 0 12px">${escapeHtml(event.title)}</h2>
      <p style="margin:8px 0"><strong>When:</strong> ${escapeHtml(startHuman)} (${event.duration_minutes} min)</p>
      ${event.location_text ? `<p style="margin:8px 0"><strong>Where:</strong> ${escapeHtml(event.location_text)}</p>` : ''}
      ${event.notes ? `<p style="margin:8px 0;white-space:pre-wrap">${escapeHtml(event.notes)}</p>` : ''}
      ${link ? `
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">
            Respond (confirm / decline / propose new time)
          </a>
        </p>
        <p style="font-size:12px;color:#64748b">Or paste this link: ${link}</p>` : ''}
      <p style="font-size:12px;color:#64748b;margin-top:32px">Sent via Mane Line — your clients' barn in a box.</p>
    </div>
  `;
  try {
    await sendResendEmail(env, {
      to: attendee.email,
      subject,
      html,
      tags: [{ name: 'category', value: 'barn_invite' }],
    });
    return { sent: true };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function handleBarnEventsList(request, env, url) {
  let actorId, jwt;
  try { ({ actorId, jwt } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_events_list:${actorId}`, BARN_EVENT_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const from = url.searchParams.get('from');
  const to   = url.searchParams.get('to');
  const filters = ['archived_at=is.null'];
  if (from) filters.push(`start_at=gte.${encodeURIComponent(from)}`);
  if (to)   filters.push(`start_at=lte.${encodeURIComponent(to)}`);
  const q = `select=*&${filters.join('&')}&order=start_at.asc&limit=500`;

  // Use caller JWT so RLS (owner-own + trainer-via-grants) applies.
  const r = await supabaseSelect(env, 'barn_events', q, { userJwt: jwt });
  if (!r.ok) return json({ error: 'list_failed', status: r.status }, 500);
  return json({ events: r.data || [] });
}

async function handleBarnEventGet(request, env, id) {
  let actorId, jwt;
  try { ({ actorId, jwt } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const evQ = `select=*&id=eq.${id}&archived_at=is.null&limit=1`;
  const er = await supabaseSelect(env, 'barn_events', evQ, { userJwt: jwt });
  if (!er.ok) return json({ error: 'get_failed', status: er.status }, 500);
  const event = Array.isArray(er.data) ? er.data[0] : null;
  if (!event) return json({ error: 'not_found' }, 404);

  const atQ = `select=*&event_id=eq.${id}&archived_at=is.null&order=created_at.asc`;
  const ar = await supabaseSelect(env, 'barn_event_attendees', atQ, { userJwt: jwt });

  const resQ = `select=*&event_id=eq.${id}&order=created_at.desc&limit=100`;
  const rr = await supabaseSelect(env, 'barn_event_responses', resQ, { userJwt: jwt });

  return json({
    event,
    attendees: ar.ok ? (ar.data || []) : [],
    responses: rr.ok ? (rr.data || []) : [],
  });
}

async function handleBarnEventCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_event_create:${actorId}`, BARN_CREATE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const errs = [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 200) errs.push('title must be 1..200 chars');

  const startAt = validateIsoTimestamp(body.start_at);
  if (!startAt) errs.push('start_at must be ISO-8601 timestamp');

  const duration = Number.parseInt(body.duration_minutes ?? 60, 10);
  if (!Number.isFinite(duration) || duration < 5 || duration > 1440) errs.push('duration_minutes must be 5..1440');

  const location = body.location_text == null ? null : String(body.location_text).trim();
  if (location && location.length > 300) errs.push('location_text <=300 chars');

  const notes = body.notes == null ? null : String(body.notes);
  if (notes && notes.length > 4000) errs.push('notes <=4000 chars');

  const animalIds = Array.isArray(body.animal_ids) ? body.animal_ids.filter((x) => typeof x === 'string') : [];
  for (const aid of animalIds) if (!isUuid(aid)) errs.push(`animal_ids has non-uuid: ${aid}`);

  const ranchId = typeof body.ranch_id === 'string' && body.ranch_id ? body.ranch_id : null;
  if (ranchId && !isUuid(ranchId)) errs.push('ranch_id must be uuid');

  const attendees = Array.isArray(body.attendees) ? body.attendees : [];
  if (attendees.length > 20) errs.push('max 20 attendees per event');

  const recurrence = body.recurrence;
  let rrule = null;
  if (recurrence != null) {
    if (typeof recurrence !== 'object' || typeof recurrence.rrule !== 'string') {
      errs.push('recurrence must be {rrule, series_end_at?}');
    } else {
      rrule = parseRruleMinimal(recurrence.rrule);
      if (!rrule) errs.push('recurrence.rrule could not be parsed');
    }
  }

  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  // Ownership check on animals.
  const ownedCheck = await assertOwnerOwnsAnimals(env, actorId, animalIds);
  if (!ownedCheck.ok) return json({ error: ownedCheck.error, missing: ownedCheck.missing }, ownedCheck.status || 500);

  // Resolve attendees.
  const resolvedAttendees = [];
  for (const a of attendees) {
    const r = await resolveAttendeeForCreate(env, { ownerId: actorId, eventStartAt: startAt, input: a });
    if (r.error) return json({ error: 'attendee_validation_failed', detail: r.error, attendee: a }, 400);
    if (!DELIVERY_CHANNELS.has(r.row.delivery_channel)) return json({ error: 'bad_delivery_channel' }, 400);
    resolvedAttendees.push(r.row);
  }

  // Insert optional recurrence rule first so we can stamp recurrence_rule_id.
  let recurrenceRuleId = null;
  if (rrule) {
    const seriesEndAt = recurrence.series_end_at ? validateIsoTimestamp(recurrence.series_end_at) : null;
    const ruleIns = await barnSrInsertReturning(env, 'barn_event_recurrence_rules', {
      owner_id: actorId,
      rrule_text: recurrence.rrule,
      template_title: title,
      template_duration: duration,
      template_animal_ids: animalIds,
      template_notes: notes,
      series_start_at: startAt.toISOString(),
      series_end_at: seriesEndAt ? seriesEndAt.toISOString() : null,
    });
    if (!ruleIns.ok || !ruleIns.data) return json({ error: 'recurrence_insert_failed' }, 500);
    recurrenceRuleId = ruleIns.data.id;
  }

  // Insert base event.
  const evIns = await barnSrInsertReturning(env, 'barn_events', {
    owner_id: actorId,
    ranch_id: ranchId,
    title,
    start_at: startAt.toISOString(),
    duration_minutes: duration,
    location_text: location,
    animal_ids: animalIds,
    notes,
    created_by: actorId,
    status: 'scheduled',
    recurrence_rule_id: recurrenceRuleId,
    prefill_source: body.prefill_source || 'manual',
  });
  if (!evIns.ok || !evIns.data) return json({ error: 'event_insert_failed', status: evIns.status, detail: evIns.data }, 500);
  const event = evIns.data;

  // Insert attendees stamped with event_id.
  let insertedAttendees = [];
  if (resolvedAttendees.length) {
    const rows = resolvedAttendees.map((a) => ({ ...a, event_id: event.id }));
    const many = await barnSrInsertMany(env, 'barn_event_attendees', rows);
    if (!many.ok) return json({ error: 'attendee_insert_failed', status: many.status, detail: many.data }, 500);
    insertedAttendees = many.data || [];
  }

  // Materialize recurrence instances (no attendees on instances — tech-debt).
  let materializedCount = 0;
  if (rrule) {
    const horizon = recurrence.series_end_at
      ? new Date(recurrence.series_end_at)
      : new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const dates = materializeRecurrenceDates(startAt, rrule, { maxInstances: 52, horizon });
    if (dates.length) {
      const rows = dates.map((iso) => ({
        owner_id: actorId,
        ranch_id: ranchId,
        title,
        start_at: iso,
        duration_minutes: duration,
        location_text: location,
        animal_ids: animalIds,
        notes,
        created_by: actorId,
        status: 'scheduled',
        recurrence_rule_id: recurrenceRuleId,
        prefill_source: 'recurrence_materialize',
      }));
      const ins = await barnSrInsertMany(env, 'barn_events', rows);
      if (ins.ok) {
        materializedCount = (ins.data || []).length;
        await barnSrPatchReturning(
          env,
          'barn_event_recurrence_rules',
          `id=eq.${recurrenceRuleId}`,
          { last_materialized_through: dates[dates.length - 1] },
        );
      }
    }
  }

  // Fire invitation emails async; log outcomes to notifications_log.
  const ownerProfile = await barnSrSelect(env, 'user_profiles',
    `select=display_name&user_id=eq.${actorId}&limit=1`);
  const ownerName = ownerProfile.ok && Array.isArray(ownerProfile.data) && ownerProfile.data[0]?.display_name
    ? ownerProfile.data[0].display_name : null;

  const emailPromise = (async () => {
    for (const a of insertedAttendees) {
      if (a.delivery_channel === 'in_app') {
        await logBarnNotification(env, {
          event_id: event.id,
          attendee_id: a.id,
          pro_contact_id: a.pro_contact_id,
          channel: 'in_app',
          bucket: null,
          status: 'sent',
        });
        continue;
      }
      const r = await fireInvitationEmail(env, { event, attendee: a, ownerName });
      await logBarnNotification(env, {
        event_id: event.id,
        attendee_id: a.id,
        pro_contact_id: a.pro_contact_id,
        channel: 'email',
        bucket: null,
        status: r.sent ? 'sent' : (r.skipped ? 'skipped' : 'failed'),
        error: r.error || r.reason || null,
      });
    }
  })().catch((err) => console.warn('[barn.invite] failed:', err?.message));
  if (ctx?.waitUntil) ctx.waitUntil(emailPromise);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.event.create',
    target_table: 'barn_events',
    target_id: event.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      attendee_count: insertedAttendees.length,
      recurrence_rule_id: recurrenceRuleId,
      materialized_count: materializedCount,
    },
  }, ctx);

  return json({
    event,
    attendees: insertedAttendees,
    recurrence_rule_id: recurrenceRuleId,
    materialized_count: materializedCount,
    public_token_count: insertedAttendees.filter((a) => a.public_token).length,
  }, 201);
}

async function handleBarnEventUpdate(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_event_update:${actorId}`, BARN_CREATE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const patch = {};
  const errs = [];
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 200) errs.push('bad title');
    else patch.title = body.title.trim();
  }
  if (body.start_at !== undefined) {
    const d = validateIsoTimestamp(body.start_at);
    if (!d) errs.push('bad start_at'); else patch.start_at = d.toISOString();
  }
  if (body.duration_minutes !== undefined) {
    const n = Number.parseInt(body.duration_minutes, 10);
    if (!Number.isFinite(n) || n < 5 || n > 1440) errs.push('bad duration_minutes');
    else patch.duration_minutes = n;
  }
  if (body.location_text !== undefined) {
    if (body.location_text === null || body.location_text === '') patch.location_text = null;
    else if (typeof body.location_text !== 'string' || body.location_text.length > 300) errs.push('bad location_text');
    else patch.location_text = body.location_text.trim();
  }
  if (body.notes !== undefined) {
    if (body.notes === null || body.notes === '') patch.notes = null;
    else if (typeof body.notes !== 'string' || body.notes.length > 4000) errs.push('bad notes');
    else patch.notes = body.notes;
  }
  if (body.status !== undefined) {
    if (!EVENT_STATUSES.has(body.status)) errs.push('bad status');
    else patch.status = body.status;
  }
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields_to_update' }, 400);

  const filter = `id=eq.${id}&owner_id=eq.${actorId}&archived_at=is.null`;
  const upd = await barnSrPatchReturning(env, 'barn_events', filter, patch);
  if (!upd.ok) return json({ error: 'update_failed', status: upd.status }, 500);
  if (!upd.data) return json({ error: 'not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.event.update',
    target_table: 'barn_events',
    target_id: id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { fields: Object.keys(patch) },
  }, ctx);

  return json({ event: upd.data });
}

async function handleBarnEventCancel(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const filter = `id=eq.${id}&owner_id=eq.${actorId}&archived_at=is.null`;
  const upd = await barnSrPatchReturning(env, 'barn_events', filter, { status: 'cancelled' });
  if (!upd.ok) return json({ error: 'cancel_failed', status: upd.status }, 500);
  if (!upd.data) return json({ error: 'not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.event.cancel',
    target_table: 'barn_events',
    target_id: id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({ event: upd.data });
}

async function handleBarnEventArchive(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const arch = await barnSrArchive(env, 'barn_events', id, actorId);
  if (!arch.ok) return json({ error: 'archive_failed', status: arch.status }, 500);
  if (!arch.data) return json({ error: 'not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.event.archive',
    target_table: 'barn_events',
    target_id: id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({ event: arch.data });
}

async function handleBarnEventRespond(request, env, id, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:barn_event_respond:${actorId}`, BARN_RESPOND_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const status = body.status;
  if (!RESPONSE_STATUSES.has(status)) return json({ error: 'bad_status' }, 400);

  const note = body.response_note == null ? null : String(body.response_note);
  if (note && note.length > 1000) return json({ error: 'note_too_long' }, 400);

  let counterStart = null;
  if (status === 'countered') {
    counterStart = validateIsoTimestamp(body.counter_start_at);
    if (!counterStart) return json({ error: 'counter_start_at_required' }, 400);
  }

  // Resolve the target attendee row.
  //
  // Two valid paths:
  //   1. The owner of the event passes an explicit attendee_id in the
  //      body to mark any invitee as confirmed/declined/countered on
  //      their behalf (e.g. phoned in an RSVP). We verify the attendee
  //      actually belongs to this event before trusting it.
  //   2. No attendee_id — caller is answering for themselves. We look
  //      up their own attendee row by linked_user_id.
  //
  // The legacy handler ignored body.attendee_id entirely, so owner
  // self-RSVP-on-behalf-of was silently a no-op against their own row.
  const rawAttendeeId = typeof body.attendee_id === 'string' ? body.attendee_id.trim() : '';
  let attendee = null;
  if (rawAttendeeId) {
    // Owner-assist path — verify both the attendee and the event owner.
    if (!isUuid(rawAttendeeId)) return json({ error: 'bad_attendee_id' }, 400);
    const evQ = `select=id,owner_id&id=eq.${id}&limit=1`;
    const er = await barnSrSelect(env, 'barn_events', evQ);
    if (!er.ok) return json({ error: 'event_lookup_failed' }, 500);
    const ev = Array.isArray(er.data) ? er.data[0] : null;
    if (!ev) return json({ error: 'event_not_found' }, 404);
    if (ev.owner_id !== actorId) return json({ error: 'forbidden' }, 403);
    const attQ = `select=id,linked_user_id,event_id&event_id=eq.${id}&id=eq.${rawAttendeeId}&archived_at=is.null&limit=1`;
    const ar = await barnSrSelect(env, 'barn_event_attendees', attQ);
    if (!ar.ok) return json({ error: 'attendee_lookup_failed' }, 500);
    attendee = Array.isArray(ar.data) ? ar.data[0] : null;
    if (!attendee) return json({ error: 'attendee_not_found' }, 404);
  } else {
    // Self path — the caller's own attendee row on this event.
    const attQ = `select=id,linked_user_id,event_id&event_id=eq.${id}&linked_user_id=eq.${actorId}&archived_at=is.null&limit=1`;
    const ar = await barnSrSelect(env, 'barn_event_attendees', attQ);
    if (!ar.ok) return json({ error: 'attendee_lookup_failed' }, 500);
    attendee = Array.isArray(ar.data) ? ar.data[0] : null;
    if (!attendee) return json({ error: 'not_an_attendee' }, 403);
  }

  const respIns = await barnSrInsertReturning(env, 'barn_event_responses', {
    event_id: id,
    attendee_id: attendee.id,
    responder_channel: 'in_app',
    responder_user_id: actorId,
    status,
    counter_start_at: counterStart ? counterStart.toISOString() : null,
    response_note: note,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  });
  if (!respIns.ok || !respIns.data) return json({ error: 'response_insert_failed' }, 500);

  const onBehalf = rawAttendeeId && attendee.linked_user_id !== actorId;

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: onBehalf ? 'owner' : 'attendee',
    action: 'barn.event.respond',
    target_table: 'barn_event_responses',
    target_id: respIns.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { event_id: id, attendee_id: attendee.id, status, on_behalf: Boolean(onBehalf) },
  }, ctx);

  return json({ response: respIns.data, current_status: status });
}

/* =============================================================
   Phase 8 — Public token accept/decline (anon via signed token)
   ============================================================= */

async function loadAttendeeByToken(env, token) {
  const q = `select=*,barn_events(id,owner_id,title,start_at,duration_minutes,location_text,animal_ids,notes,status,ranch_id)&public_token=eq.${encodeURIComponent(token)}&limit=1`;
  const r = await barnSrSelect(env, 'barn_event_attendees', q);
  if (!r.ok) return null;
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return null;
  return row;
}

async function handlePublicEventGet(request, env, token) {
  const rl = await rateLimit(env, `ratelimit:public_event_get:${token}`, BARN_PUBLIC_GET_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const att = await loadAttendeeByToken(env, token);
  if (!att) return json({ error: 'not_found' }, 404);
  if (att.archived_at) return json({ error: 'revoked' }, 410);
  if (att.token_expires_at && new Date(att.token_expires_at) < new Date()) {
    return json({ error: 'token_expired' }, 410);
  }

  // Fetch response history for this attendee.
  const rq = `select=status,counter_start_at,response_note,created_at&attendee_id=eq.${att.id}&order=created_at.desc&limit=20`;
  const rr = await barnSrSelect(env, 'barn_event_responses', rq);

  return json({
    event: att.barn_events || null,
    attendee: {
      id: att.id,
      email: att.email,
      delivery_channel: att.delivery_channel,
      current_status: att.current_status,
      token_expires_at: att.token_expires_at,
    },
    responses: rr.ok ? (rr.data || []) : [],
  });
}

async function handlePublicEventRespond(request, env, token, ctx) {
  const rl = await rateLimit(env, `ratelimit:public_event_respond:${token}`, BARN_PUBLIC_RESPOND_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const att = await loadAttendeeByToken(env, token);
  if (!att) return json({ error: 'not_found' }, 404);
  if (att.archived_at) return json({ error: 'revoked' }, 410);
  if (att.token_expires_at && new Date(att.token_expires_at) < new Date()) {
    return json({ error: 'token_expired' }, 410);
  }
  const event = att.barn_events;
  if (!event) return json({ error: 'event_not_found' }, 404);
  if (event.status === 'cancelled') return json({ error: 'event_cancelled' }, 410);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const status = body.status;
  if (!RESPONSE_STATUSES.has(status)) return json({ error: 'bad_status' }, 400);

  const note = body.response_note == null ? null : String(body.response_note);
  if (note && note.length > 1000) return json({ error: 'note_too_long' }, 400);

  let counterStart = null;
  if (status === 'countered') {
    counterStart = validateIsoTimestamp(body.counter_start_at);
    if (!counterStart) return json({ error: 'counter_start_at_required' }, 400);
  }

  const respIns = await barnSrInsertReturning(env, 'barn_event_responses', {
    event_id: event.id,
    attendee_id: att.id,
    responder_channel: 'public_token',
    responder_user_id: null,
    status,
    counter_start_at: counterStart ? counterStart.toISOString() : null,
    response_note: note,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  });
  if (!respIns.ok || !respIns.data) return json({ error: 'response_insert_failed' }, 500);

  ctx_audit(env, {
    actor_id: null,
    actor_role: 'public_attendee',
    action: 'barn.event.public_respond',
    target_table: 'barn_event_responses',
    target_id: respIns.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { event_id: event.id, attendee_id: att.id, status },
  }, ctx);

  return json({ response: respIns.data, current_status: status });
}

async function handlePublicEventRevoke(request, env, token, ctx) {
  const rl = await rateLimit(env, `ratelimit:public_event_revoke:${token}`, BARN_PUBLIC_RESPOND_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const att = await loadAttendeeByToken(env, token);
  if (!att) return json({ error: 'not_found' }, 404);
  if (att.archived_at) return json({ ok: true, already: 'revoked' });

  // Archive the attendee + record a cancelled response for audit trail.
  const arch = await barnSrPatchReturning(env, 'barn_event_attendees',
    `id=eq.${att.id}`,
    { archived_at: new Date().toISOString(), current_status: 'cancelled' });
  if (!arch.ok) return json({ error: 'revoke_failed' }, 500);

  await barnSrInsertReturning(env, 'barn_event_responses', {
    event_id: att.event_id,
    attendee_id: att.id,
    responder_channel: 'public_token',
    status: 'cancelled',
    response_note: 'revoked via public token',
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  });

  ctx_audit(env, {
    actor_id: null,
    actor_role: 'public_attendee',
    action: 'barn.event.public_revoke',
    target_table: 'barn_event_attendees',
    target_id: att.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
  }, ctx);

  return json({ ok: true });
}

/* =============================================================
   Phase 8 — Internal cron endpoints
   All gated by X-Internal-Secret (timing-safe compare).
   ============================================================= */

const BARN_REMINDER_BUCKETS = [
  { bucket: '48h', lowerMin: 47 * 60, upperMin: 49 * 60 },
  { bucket: '24h', lowerMin: 23 * 60, upperMin: 25 * 60 },
  { bucket: '2h',  lowerMin: 95,      upperMin: 125 },
];

async function handleBarnRemindersTick(request, env, ctx) {
  const fail = await requireInternalSecret(request, env);
  if (fail) return fail;

  const now = Date.now();
  const stats = { scanned: 0, fired: 0, skipped: 0, failed: 0 };

  for (const b of BARN_REMINDER_BUCKETS) {
    const lower = new Date(now + b.lowerMin * 60 * 1000).toISOString();
    const upper = new Date(now + b.upperMin * 60 * 1000).toISOString();

    const q = `select=id,owner_id,title,start_at,duration_minutes,location_text,notes,status`
      + `&status=eq.scheduled&archived_at=is.null`
      + `&start_at=gte.${encodeURIComponent(lower)}&start_at=lte.${encodeURIComponent(upper)}`;
    const er = await barnSrSelect(env, 'barn_events', q);
    if (!er.ok) continue;
    const events = er.data || [];

    for (const ev of events) {
      stats.scanned += 1;

      const atQ = `select=id,email,phone_e164,delivery_channel,pro_contact_id,linked_user_id,current_status`
        + `&event_id=eq.${ev.id}&archived_at=is.null`;
      const ar = await barnSrSelect(env, 'barn_event_attendees', atQ);
      if (!ar.ok) continue;
      const attendees = ar.data || [];

      for (const a of attendees) {
        if (a.current_status === 'cancelled' || a.current_status === 'declined') {
          stats.skipped += 1; continue;
        }
        // Dedupe via prior log rows for this (event, attendee, bucket, channel).
        const channel = a.delivery_channel === 'in_app' ? 'in_app' : 'email';
        const dedupeQ = `select=id&event_id=eq.${ev.id}&attendee_id=eq.${a.id}`
          + `&bucket=eq.${b.bucket}&channel=eq.${channel}&limit=1`;
        const dr = await barnSrSelect(env, 'barn_event_notifications_log', dedupeQ);
        if (dr.ok && Array.isArray(dr.data) && dr.data.length > 0) {
          stats.skipped += 1; continue;
        }

        if (channel === 'in_app') {
          await logBarnNotification(env, {
            event_id: ev.id, attendee_id: a.id, pro_contact_id: a.pro_contact_id,
            channel, bucket: b.bucket, status: 'sent',
          });
          stats.fired += 1;
          continue;
        }

        // email reminder
        if (!a.email || !isResendConfigured(env)) {
          await logBarnNotification(env, {
            event_id: ev.id, attendee_id: a.id, pro_contact_id: a.pro_contact_id,
            channel, bucket: b.bucket, status: 'skipped',
            error: !a.email ? 'no_email' : 'resend_not_configured',
          });
          stats.skipped += 1;
          continue;
        }
        try {
          const when = new Date(ev.start_at).toUTCString();
          await sendResendEmail(env, {
            to: a.email,
            subject: `Reminder (${b.bucket}): ${ev.title}`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:520px;padding:24px">
              <h2>${escapeHtml(ev.title)}</h2>
              <p><strong>When:</strong> ${escapeHtml(when)} (${ev.duration_minutes} min)</p>
              ${ev.location_text ? `<p><strong>Where:</strong> ${escapeHtml(ev.location_text)}</p>` : ''}
              ${ev.notes ? `<p style="white-space:pre-wrap">${escapeHtml(ev.notes)}</p>` : ''}
            </div>`,
            tags: [{ name: 'category', value: 'barn_reminder' }, { name: 'bucket', value: b.bucket }],
          });
          await logBarnNotification(env, {
            event_id: ev.id, attendee_id: a.id, pro_contact_id: a.pro_contact_id,
            channel, bucket: b.bucket, status: 'sent',
          });
          stats.fired += 1;
        } catch (err) {
          await logBarnNotification(env, {
            event_id: ev.id, attendee_id: a.id, pro_contact_id: a.pro_contact_id,
            channel, bucket: b.bucket, status: 'failed', error: String(err?.message || err),
          });
          stats.failed += 1;
        }
      }
    }
  }

  return json({ ok: true, stats });
}

async function handleBarnMaterializeRecurrences(request, env, _ctx) {
  const fail = await requireInternalSecret(request, env);
  if (fail) return fail;

  const horizonIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  // Pick up active rules whose last_materialized_through is older than horizon - 30d.
  const cutoff = new Date(Date.now() + (365 - 30) * 24 * 3600 * 1000).toISOString();
  const rq = `select=*&archived_at=is.null`
    + `&or=(last_materialized_through.is.null,last_materialized_through.lt.${encodeURIComponent(cutoff)})`
    + `&limit=100`;
  const rr = await barnSrSelect(env, 'barn_event_recurrence_rules', rq);
  if (!rr.ok) return json({ error: 'rules_lookup_failed' }, 500);
  const rules = rr.data || [];

  const stats = { rules_scanned: rules.length, instances_inserted: 0 };

  for (const rule of rules) {
    const rrule = parseRruleMinimal(rule.rrule_text);
    if (!rrule) continue;

    const anchor = rule.last_materialized_through
      ? new Date(rule.last_materialized_through)
      : new Date(rule.series_start_at);

    const horizon = rule.series_end_at
      ? new Date(Math.min(new Date(rule.series_end_at).getTime(), Date.parse(horizonIso)))
      : new Date(horizonIso);

    const dates = materializeRecurrenceDates(anchor, rrule, { maxInstances: 200, horizon });
    if (!dates.length) continue;

    const rows = dates.map((iso) => ({
      owner_id: rule.owner_id,
      title: rule.template_title,
      start_at: iso,
      duration_minutes: rule.template_duration,
      animal_ids: rule.template_animal_ids || [],
      notes: rule.template_notes || null,
      created_by: rule.owner_id,
      status: 'scheduled',
      recurrence_rule_id: rule.id,
      prefill_source: 'recurrence_materialize',
    }));
    const ins = await barnSrInsertMany(env, 'barn_events', rows);
    if (ins.ok) {
      stats.instances_inserted += (ins.data || []).length;
      await barnSrPatchReturning(env, 'barn_event_recurrence_rules',
        `id=eq.${rule.id}`,
        { last_materialized_through: dates[dates.length - 1] });
    }
  }

  return json({ ok: true, stats });
}

async function handleBarnProClaimEmail(request, env, _ctx) {
  const fail = await requireInternalSecret(request, env);
  if (fail) return fail;

  // Find eligible pro_contacts: >=3 confirms, never claim-emailed, not linked, has email.
  const q = `select=id,owner_id,name,role,email`
    + `&response_count_confirmed=gte.3`
    + `&claim_email_sent_at=is.null`
    + `&linked_user_id=is.null`
    + `&email=not.is.null`
    + `&archived_at=is.null`
    + `&limit=50`;
  const r = await barnSrSelect(env, 'professional_contacts', q);
  if (!r.ok) return json({ error: 'scan_failed' }, 500);
  const candidates = r.data || [];

  const stats = { candidates: candidates.length, sent: 0, skipped: 0, failed: 0 };
  const nowIso = new Date().toISOString();

  for (const c of candidates) {
    if (!isResendConfigured(env)) {
      await logBarnNotification(env, {
        pro_contact_id: c.id, channel: 'claim_pro_email', bucket: 'claim_pro',
        status: 'skipped', error: 'resend_not_configured',
      });
      stats.skipped += 1; continue;
    }
    try {
      const signupUrl = `${(env.PUBLIC_APP_URL || 'https://maneline.co').replace(/\/+$/, '')}/signup?role=${encodeURIComponent(c.role)}&email=${encodeURIComponent(c.email)}`;
      await sendResendEmail(env, {
        to: c.email,
        subject: 'Your clients have been booking you through Mane Line',
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;padding:24px">
          <h2>Hi ${escapeHtml(c.name)},</h2>
          <p>Three or more of your Mane Line clients have confirmed bookings with you lately. Claim your free ${escapeHtml(c.role)} account and your schedule will start appearing in one place.</p>
          <p><a href="${signupUrl}" style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Claim my account</a></p>
          <p style="font-size:12px;color:#64748b">Sent by Mane Line — your clients' barn in a box.</p>
        </div>`,
        tags: [{ name: 'category', value: 'claim_pro_email' }],
      });
      await barnSrPatchReturning(env, 'professional_contacts',
        `id=eq.${c.id}`,
        { claim_email_sent_at: nowIso });
      await logBarnNotification(env, {
        pro_contact_id: c.id, channel: 'claim_pro_email', bucket: 'claim_pro', status: 'sent',
      });
      stats.sent += 1;
    } catch (err) {
      await logBarnNotification(env, {
        pro_contact_id: c.id, channel: 'claim_pro_email', bucket: 'claim_pro',
        status: 'failed', error: String(err?.message || err),
      });
      stats.failed += 1;
    }
  }

  return json({ ok: true, stats });
}

/* =============================================================
   Phase 8 — Barn Mode Module 02 — Herd Health Dashboard
   ============================================================= */

const HERD_HEALTH_READ_RATE  = { limit: 60, windowSec: 60 };
const HERD_HEALTH_WRITE_RATE = { limit: 30, windowSec: 60 };
const HERD_HEALTH_PDF_RATE   = { limit: 5,  windowSec: 60 };

/**
 * Phase 8.5 Barn Mode gate stub. Until Module 05 ships, this returns
 * true for every owner. TECH_DEBT(phase-8:02-02).
 */
async function isBarnModeEntitled(_env, _ownerId) {
  return true;
}

function normalizeThresholdPatchBody(body) {
  const errs = [];
  if (!body || typeof body !== 'object' || !Array.isArray(body.thresholds)) {
    errs.push('body.thresholds must be an array');
    return { rows: [], errs };
  }
  const rows = [];
  for (const r of body.thresholds) {
    if (!r || typeof r !== 'object') { errs.push('each threshold must be an object'); continue; }
    if (!isHerdHealthRecordType(r.record_type)) {
      errs.push(`record_type must be one of: ${HERD_HEALTH_RECORD_TYPES.join(', ')}`);
      continue;
    }
    const days = Number(r.interval_days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      errs.push('interval_days must be an integer between 1 and 3650');
      continue;
    }
    if (typeof r.enabled !== 'boolean') {
      errs.push('enabled must be boolean');
      continue;
    }
    rows.push({ record_type: r.record_type, interval_days: days, enabled: r.enabled });
  }
  return { rows, errs };
}

function normalizeAcknowledgementBody(body) {
  const errs = [];
  const out = {};
  if (!body || typeof body !== 'object') {
    errs.push('body must be an object');
    return { out, errs };
  }
  if (!isUuid(body.animal_id)) errs.push('animal_id must be uuid');
  else out.animal_id = body.animal_id;
  if (!isHerdHealthRecordType(body.record_type)) {
    errs.push(`record_type must be one of: ${HERD_HEALTH_RECORD_TYPES.join(', ')}`);
  } else {
    out.record_type = body.record_type;
  }
  const d = body.dismissed_until ? new Date(body.dismissed_until) : null;
  if (!d || Number.isNaN(d.getTime())) errs.push('dismissed_until must be an ISO timestamp');
  else if (d.getTime() <= Date.now()) errs.push('dismissed_until must be in the future');
  else if (d.getTime() > Date.now() + 365 * 24 * 3600 * 1000) {
    errs.push('dismissed_until must be within 365 days');
  } else {
    out.dismissed_until = d.toISOString();
  }
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string' || body.reason.length > 500) {
      errs.push('reason must be <=500 chars');
    } else {
      out.reason = body.reason.trim() || null;
    }
  } else {
    out.reason = null;
  }
  return { out, errs };
}

async function handleHerdHealthGet(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:herd_health_get:${actorId}`, HERD_HEALTH_READ_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  const thr = await listOrSeedThresholds(env, actorId);
  if (!thr.ok) return json({ error: 'thresholds_failed', status: thr.status }, 500);

  const animals = await hhListOwnerAnimals(env, actorId);
  if (!animals.ok) return json({ error: 'animals_failed', status: animals.status }, 500);

  const grid = await computeHerdHealth(env, actorId);
  if (!grid.ok) return json({ error: 'compute_failed', status: grid.status }, 500);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.read',
    target_table: 'health_thresholds',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      animal_count: animals.data.length,
      threshold_count: thr.data.length,
      cell_count: grid.data.length,
    },
  }, ctx);

  return json({
    record_types: HERD_HEALTH_RECORD_TYPES,
    thresholds: thr.data,
    animals: animals.data,
    cells: grid.data,
  });
}

async function handleHerdHealthThresholdsPatch(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:herd_health_thr:${actorId}`, HERD_HEALTH_WRITE_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const { rows, errs } = normalizeThresholdPatchBody(body);
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (rows.length === 0) return json({ error: 'no_thresholds_to_update' }, 400);

  const results = [];
  for (const row of rows) {
    const r = await upsertThreshold(env, actorId, row);
    if (!r.ok) return json({ error: 'upsert_failed', status: r.status, record_type: row.record_type }, 500);
    if (r.data) results.push(r.data);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.thresholds_update',
    target_table: 'health_thresholds',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { record_types: rows.map((r) => r.record_type) },
  }, ctx);

  return json({ thresholds: results });
}

async function handleHerdHealthThresholdsReset(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:herd_health_reset:${actorId}`, HERD_HEALTH_WRITE_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  const r = await resetThresholdsToDefaults(env, actorId);
  if (!r.ok) return json({ error: 'reset_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.thresholds_reset',
    target_table: 'health_thresholds',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { count: r.data.length },
  }, ctx);

  return json({ thresholds: r.data });
}

async function handleHerdHealthAcknowledge(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:herd_health_ack:${actorId}`, HERD_HEALTH_WRITE_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const { out, errs } = normalizeAcknowledgementBody(body);
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  const animal = await hhGetOwnerAnimal(env, actorId, out.animal_id);
  if (!animal.ok) return json({ error: 'animal_lookup_failed', status: animal.status }, 500);
  if (!animal.data) return json({ error: 'animal_not_found' }, 404);

  const ins = await hhInsertAcknowledgement(env, actorId, out);
  if (!ins.ok || !ins.data) return json({ error: 'insert_failed', status: ins.status }, 500);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.acknowledge',
    target_table: 'health_dashboard_acknowledgements',
    target_id: ins.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      animal_id: out.animal_id,
      record_type: out.record_type,
      dismissed_until: out.dismissed_until,
    },
  }, ctx);

  return json({ acknowledgement: ins.data }, 201);
}

async function handleHerdHealthAnimalDetail(request, env, animalId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:herd_health_animal:${actorId}`, HERD_HEALTH_READ_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  const animal = await hhGetOwnerAnimal(env, actorId, animalId);
  if (!animal.ok) return json({ error: 'animal_lookup_failed', status: animal.status }, 500);
  if (!animal.data) return json({ error: 'not_found' }, 404);

  const [records, thresholds, grid] = await Promise.all([
    hhListAnimalVetRecords(env, actorId, animalId),
    listOrSeedThresholds(env, actorId),
    computeHerdHealth(env, actorId),
  ]);
  if (!records.ok) return json({ error: 'records_failed', status: records.status }, 500);
  if (!thresholds.ok) return json({ error: 'thresholds_failed', status: thresholds.status }, 500);
  if (!grid.ok) return json({ error: 'compute_failed', status: grid.status }, 500);

  const cells = grid.data.filter((c) => c.animal_id === animalId);

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.animal_detail',
    target_table: 'animals',
    target_id: animalId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { record_count: records.data.length },
  }, ctx);

  return json({
    animal: animal.data,
    records: records.data,
    thresholds: thresholds.data,
    cells,
    record_types: HERD_HEALTH_RECORD_TYPES,
  });
}

async function handleHerdHealthReportPdf(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const entitled = await isBarnModeEntitled(env, actorId);
  if (!entitled) {
    return json({
      error: 'barn_mode_required',
      message: 'Upgrade to Barn Mode to export the Herd Health PDF.',
    }, 402);
  }

  const rl = await rateLimit(env, `ratelimit:herd_health_pdf:${actorId}`, HERD_HEALTH_PDF_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429,
      { 'retry-after': String(rl.resetSec) });
  }

  // TECH_DEBT(phase-8:02-01) — the Cloudflare Browser Rendering
  // pipeline for the Herd Health PDF reuses the Phase 7 R2 flow but
  // the HTML template + BROWSER-binding render path isn't wired
  // through yet; endpoint stubs to 501 until Module 06 observability
  // sweep ships the template alongside the other PDF types.
  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'barn.herd_health.report_export_attempt',
    target_table: 'audit_log',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { outcome: 'not_implemented' },
  }, ctx);
  return json({ error: 'pdf_not_implemented', tech_debt: 'phase-8:02-01' }, 501);
}

// Silence unused-var lint for future wiring (HERD_HEALTH_RECORD_TYPE_SET +
// HERD_HEALTH_DEFAULTS + hhInsertAcknowledgement are re-exported for
// Module 03+ work so they don't need to be re-imported).
void HERD_HEALTH_RECORD_TYPE_SET;
void HERD_HEALTH_DEFAULTS;

/* =============================================================
   Phase 8 — Barn Mode Module 03 — Facility Map + Care Matrix
   ============================================================= */

const FACILITY_READ_RATE   = { limit: 60, windowSec: 60 };
const FACILITY_WRITE_RATE  = { limit: 30, windowSec: 60 };
const FACILITY_PDF_RATE    = { limit: 5,  windowSec: 60 };

function validStallLabel(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 60;
}
function validGroupName(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 80;
}
function validNotes(s) {
  return s === null || s === undefined || (typeof s === 'string' && s.length <= 500);
}
function validColorHex(s) {
  return s === null || s === undefined || (typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s));
}
function validYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

async function handleFacilityRanches(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_ranches:${actorId}`, FACILITY_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const r = await fmListOwnerRanches(env, actorId);
  if (!r.ok) return json({ error: 'ranches_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.ranches_read',
    target_table: 'ranches', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { count: r.data.length },
  }, ctx);

  return json({ ranches: r.data });
}

async function handleFacilityMap(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const ranchId = url.searchParams.get('ranch_id');
  if (!isUuid(ranchId)) return json({ error: 'bad_ranch_id' }, 400);

  const rl = await rateLimit(env, `ratelimit:facility_map:${actorId}`, FACILITY_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const ranch = await fmGetOwnerRanch(env, actorId, ranchId);
  if (!ranch) return json({ error: 'ranch_not_found' }, 404);

  const map = await fmReadFacilityMap(env, ranchId);
  if (!map.ok) return json({ error: 'map_failed', status: map.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.map_read',
    target_table: 'stalls', target_id: ranchId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {
      stalls: map.data.stalls.length,
      groups: map.data.groups.length,
      assignments: map.data.assignments.length,
      members: map.data.members.length,
    },
  }, ctx);

  return json({ ranch, ...map.data });
}

async function handleStallCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_stall_ins:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const errs = [];
  if (!isUuid(body?.ranch_id)) errs.push('ranch_id must be uuid');
  if (!validStallLabel(body?.label)) errs.push('label must be 1-60 chars');
  if (!validNotes(body?.notes)) errs.push('notes must be <=500 chars');
  if (body?.position_row !== null && body?.position_row !== undefined && !Number.isInteger(body.position_row)) errs.push('position_row must be integer');
  if (body?.position_col !== null && body?.position_col !== undefined && !Number.isInteger(body.position_col)) errs.push('position_col must be integer');
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  const ranch = await fmGetOwnerRanch(env, actorId, body.ranch_id);
  if (!ranch) return json({ error: 'ranch_not_found' }, 404);

  const ins = await fmInsertStall(env, body.ranch_id, {
    label: body.label.trim(),
    notes: body.notes ?? null,
    position_row: body.position_row ?? null,
    position_col: body.position_col ?? null,
  });
  if (!ins.ok || !ins.data) return json({ error: 'insert_failed', status: ins.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.stall_create',
    target_table: 'stalls', target_id: ins.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { ranch_id: body.ranch_id, label: body.label },
  }, ctx);

  return json({ stall: ins.data }, 201);
}

async function handleFacilityRanchCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_ranch_ins:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const errs = [];
  if (typeof body?.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 120) {
    errs.push('name must be 1-120 chars');
  }
  const optStr = (v, max) => v === null || v === undefined || (typeof v === 'string' && v.length <= max);
  if (!optStr(body?.address, 200)) errs.push('address must be <=200 chars');
  if (!optStr(body?.city, 100)) errs.push('city must be <=100 chars');
  if (!optStr(body?.state, 100)) errs.push('state must be <=100 chars');
  if (!validColorHex(body?.color_hex)) errs.push('color_hex must be #RRGGBB');
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  const ins = await fmInsertRanch(env, actorId, {
    name: body.name.trim(),
    address: body.address?.trim() || null,
    city: body.city?.trim() || null,
    state: body.state?.trim() || null,
    color_hex: body.color_hex ?? null,
  });
  if (!ins.ok || !ins.data) return json({ error: 'insert_failed', status: ins.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.ranch_create',
    target_table: 'ranches', target_id: ins.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { name: ins.data.name },
  }, ctx);

  return json({ ranch: ins.data }, 201);
}

async function handleStallPatch(request, env, stallId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_stall_patch:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const owned = await fmGetOwnerStall(env, actorId, stallId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'stall_not_found' }, 404);

  const patch = {};
  const errs = [];
  if (body?.label !== undefined) {
    if (!validStallLabel(body.label)) errs.push('label must be 1-60 chars');
    else patch.label = body.label.trim();
  }
  if (body?.notes !== undefined) {
    if (!validNotes(body.notes)) errs.push('notes must be <=500 chars');
    else patch.notes = body.notes;
  }
  if (body?.position_row !== undefined) {
    if (body.position_row !== null && !Number.isInteger(body.position_row)) errs.push('position_row must be integer or null');
    else patch.position_row = body.position_row;
  }
  if (body?.position_col !== undefined) {
    if (body.position_col !== null && !Number.isInteger(body.position_col)) errs.push('position_col must be integer or null');
    else patch.position_col = body.position_col;
  }
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields' }, 400);

  const r = await fmPatchStall(env, stallId, patch);
  if (!r.ok || !r.data) return json({ error: 'patch_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.stall_patch',
    target_table: 'stalls', target_id: stallId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { fields: Object.keys(patch) },
  }, ctx);

  return json({ stall: r.data });
}

async function handleStallArchive(request, env, stallId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_stall_arch:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const owned = await fmGetOwnerStall(env, actorId, stallId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'stall_not_found' }, 404);

  const r = await fmArchiveStall(env, stallId);
  if (!r.ok || !r.data) return json({ error: 'archive_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.stall_archive',
    target_table: 'stalls', target_id: stallId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({ stall: r.data });
}

async function handleStallAssign(request, env, stallId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_stall_assign:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const animalId = body?.animal_id ?? null;
  if (animalId !== null && !isUuid(animalId)) return json({ error: 'bad_animal_id' }, 400);

  const owned = await fmGetOwnerStall(env, actorId, stallId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'stall_not_found' }, 404);

  if (animalId) {
    const a = await hhGetOwnerAnimal(env, actorId, animalId);
    if (!a.ok) return json({ error: 'animal_lookup_failed', status: a.status }, 500);
    if (!a.data) return json({ error: 'animal_not_found' }, 404);
  }

  const r = await fmAssignStall(env, actorId, stallId, animalId);
  if (!r.ok) return json({ error: 'assign_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: animalId ? 'barn.facility.stall_assign' : 'barn.facility.stall_unassign',
    target_table: 'stall_assignments',
    target_id: r.data ? r.data.id : null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { stall_id: stallId, animal_id: animalId },
  }, ctx);

  return json({ assignment: r.data });
}

async function handleTurnoutGroupCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_tg_ins:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const errs = [];
  if (!isUuid(body?.ranch_id)) errs.push('ranch_id must be uuid');
  if (!validGroupName(body?.name)) errs.push('name must be 1-80 chars');
  if (!validColorHex(body?.color_hex)) errs.push('color_hex must be #RRGGBB');
  if (!validNotes(body?.notes)) errs.push('notes must be <=500 chars');
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);

  const ranch = await fmGetOwnerRanch(env, actorId, body.ranch_id);
  if (!ranch) return json({ error: 'ranch_not_found' }, 404);

  const ins = await fmInsertTurnoutGroup(env, body.ranch_id, {
    name: body.name.trim(),
    color_hex: body.color_hex ?? null,
    notes: body.notes ?? null,
  });
  if (!ins.ok || !ins.data) return json({ error: 'insert_failed', status: ins.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.turnout_group_create',
    target_table: 'turnout_groups', target_id: ins.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { ranch_id: body.ranch_id, name: body.name },
  }, ctx);

  return json({ group: ins.data }, 201);
}

async function handleTurnoutGroupPatch(request, env, groupId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_tg_patch:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const owned = await fmGetOwnerTurnoutGroup(env, actorId, groupId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'group_not_found' }, 404);

  const patch = {};
  const errs = [];
  if (body?.name !== undefined) {
    if (!validGroupName(body.name)) errs.push('name must be 1-80 chars');
    else patch.name = body.name.trim();
  }
  if (body?.color_hex !== undefined) {
    if (!validColorHex(body.color_hex)) errs.push('color_hex must be #RRGGBB or null');
    else patch.color_hex = body.color_hex;
  }
  if (body?.notes !== undefined) {
    if (!validNotes(body.notes)) errs.push('notes must be <=500 chars');
    else patch.notes = body.notes;
  }
  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields' }, 400);

  const r = await fmPatchTurnoutGroup(env, groupId, patch);
  if (!r.ok || !r.data) return json({ error: 'patch_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.turnout_group_patch',
    target_table: 'turnout_groups', target_id: groupId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { fields: Object.keys(patch) },
  }, ctx);

  return json({ group: r.data });
}

async function handleTurnoutGroupArchive(request, env, groupId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_tg_arch:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const owned = await fmGetOwnerTurnoutGroup(env, actorId, groupId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'group_not_found' }, 404);

  const r = await fmArchiveTurnoutGroup(env, groupId);
  if (!r.ok || !r.data) return json({ error: 'archive_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.turnout_group_archive',
    target_table: 'turnout_groups', target_id: groupId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({ group: r.data });
}

async function handleTurnoutGroupMembersAdd(request, env, groupId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_tg_mem_add:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const animalIds = Array.isArray(body?.animal_ids) ? body.animal_ids : [];
  if (animalIds.length === 0 || animalIds.length > 50) {
    return json({ error: 'animal_ids must be 1-50 uuids' }, 400);
  }
  for (const id of animalIds) {
    if (!isUuid(id)) return json({ error: 'bad_animal_id', value: id }, 400);
  }

  const owned = await fmGetOwnerTurnoutGroup(env, actorId, groupId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'group_not_found' }, 404);

  for (const id of animalIds) {
    const a = await hhGetOwnerAnimal(env, actorId, id);
    if (!a.ok) return json({ error: 'animal_lookup_failed', status: a.status }, 500);
    if (!a.data) return json({ error: 'animal_not_found', animal_id: id }, 404);
  }

  const r = await fmAddTurnoutMembers(env, actorId, groupId, animalIds);
  if (!r.ok) return json({ error: 'add_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.turnout_members_add',
    target_table: 'turnout_group_members', target_id: groupId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { group_id: groupId, animal_count: animalIds.length },
  }, ctx);

  return json({ members: r.data }, 201);
}

async function handleTurnoutGroupMemberRemove(request, env, groupId, animalId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_tg_mem_rem:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const owned = await fmGetOwnerTurnoutGroup(env, actorId, groupId);
  if (!owned.ok) return json({ error: 'lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'group_not_found' }, 404);

  const r = await fmRemoveTurnoutMember(env, groupId, animalId);
  if (!r.ok) return json({ error: 'remove_failed', status: r.status }, 500);
  if (!r.data) return json({ error: 'member_not_found' }, 404);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.turnout_member_remove',
    target_table: 'turnout_group_members', target_id: r.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { group_id: groupId, animal_id: animalId },
  }, ctx);

  return json({ member: r.data });
}

async function handleCareMatrixGet(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const ranchId = url.searchParams.get('ranch_id');
  const ymd = url.searchParams.get('date');
  if (!isUuid(ranchId)) return json({ error: 'bad_ranch_id' }, 400);
  if (!validYmd(ymd)) return json({ error: 'bad_date' }, 400);

  const rl = await rateLimit(env, `ratelimit:facility_cm_get:${actorId}`, FACILITY_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const ranch = await fmGetOwnerRanch(env, actorId, ranchId);
  if (!ranch) return json({ error: 'ranch_not_found' }, 404);

  const r = await fmListCareMatrix(env, ranchId, ymd);
  if (!r.ok) return json({ error: 'care_matrix_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.care_matrix_read',
    target_table: 'care_matrix_entries', target_id: ranchId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { date: ymd, animal_count: r.data.animal_ids.length, entry_count: r.data.entries.length },
  }, ctx);

  return json({
    ranch_id: ranchId,
    date: ymd,
    columns: CARE_MATRIX_COLUMNS,
    animal_ids: r.data.animal_ids,
    entries: r.data.entries,
  });
}

async function handleCareMatrixBatchUpsert(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:facility_cm_upsert:${actorId}`, FACILITY_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  if (!isUuid(body?.ranch_id)) return json({ error: 'bad_ranch_id' }, 400);
  if (!validYmd(body?.date)) return json({ error: 'bad_date' }, 400);
  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (!entries || entries.length === 0 || entries.length > 200) {
    return json({ error: 'entries must be 1-200 items' }, 400);
  }

  const ranch = await fmGetOwnerRanch(env, actorId, body.ranch_id);
  if (!ranch) return json({ error: 'ranch_not_found' }, 404);

  // Every animal_id must belong to the caller.
  const seen = new Set();
  for (const e of entries) {
    if (!e || typeof e !== 'object') return json({ error: 'entry must be object' }, 400);
    if (!isUuid(e.animal_id)) return json({ error: 'bad_animal_id', value: e.animal_id }, 400);
    if (seen.has(e.animal_id)) return json({ error: 'duplicate_animal_id', value: e.animal_id }, 400);
    seen.add(e.animal_id);
    if (e.notes !== undefined && e.notes !== null && (typeof e.notes !== 'string' || e.notes.length > 1000)) {
      return json({ error: 'notes must be <=1000 chars' }, 400);
    }
  }
  for (const id of seen) {
    const a = await hhGetOwnerAnimal(env, actorId, id);
    if (!a.ok) return json({ error: 'animal_lookup_failed', status: a.status }, 500);
    if (!a.data) return json({ error: 'animal_not_found', animal_id: id }, 404);
  }

  const r = await fmBatchUpsertCareMatrix(env, actorId, body.date, entries);
  if (!r.ok) return json({ error: 'upsert_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.care_matrix_upsert',
    target_table: 'care_matrix_entries', target_id: body.ranch_id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { date: body.date, count: entries.length },
  }, ctx);

  return json({ entries: r.data });
}

async function handleFacilityPrintPdf(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const entitled = await isBarnModeEntitled(env, actorId);
  if (!entitled) {
    return json({
      error: 'barn_mode_required',
      message: 'Upgrade to Barn Mode to export the Facility Map PDF.',
    }, 402);
  }

  const rl = await rateLimit(env, `ratelimit:facility_pdf:${actorId}`, FACILITY_PDF_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  // TECH_DEBT(phase-8:03-01) — Facility / Care Matrix PDF reuses the
  // Module 02 template pipeline; stub returns 501 until Module 06
  // observability sweep ships the PDF templates alongside the BROWSER
  // binding.
  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.facility.pdf_export_attempt',
    target_table: 'audit_log', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { outcome: 'not_implemented' },
  }, ctx);

  return json({ error: 'pdf_not_implemented', tech_debt: 'phase-8:03-01' }, 501);
}

/* =============================================================
   Phase 8 — Barn Mode Module 04 — Barn Spending
   ============================================================= */

const SPENDING_READ_RATE  = { limit: 60, windowSec: 60 };
const SPENDING_WRITE_RATE = { limit: 30, windowSec: 60 };
const SPENDING_EXPORT_RATE = { limit: 10, windowSec: 60 };

function validYear(y) {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function handleSpendingGet(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const year = Number(url.searchParams.get('year'));
  if (!validYear(year)) return json({ error: 'bad_year' }, 400);
  const groupBy = url.searchParams.get('group_by') || 'category';
  if (!['category', 'animal', 'ranch'].includes(groupBy)) {
    return json({ error: 'bad_group_by' }, 400);
  }

  const rl = await rateLimit(env, `ratelimit:spending_get:${actorId}`, SPENDING_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const exp = await spListExpensesYear(env, actorId, year);
  if (!exp.ok) return json({ error: 'expenses_failed', status: exp.status }, 500);

  const animals = await spListAnimalsBasis(env, actorId);
  if (!animals.ok) return json({ error: 'animals_failed', status: animals.status }, 500);

  const ranchMap = await spListRanchMap(env, actorId);
  if (!ranchMap.ok) return json({ error: 'ranch_map_failed', status: ranchMap.status }, 500);

  const animalNameById = new Map(animals.data.map((a) => [a.id, a.barn_name]));

  // Rollups.
  const totalsByKey = new Map();
  const monthlyTotals = new Array(12).fill(0);
  let grandTotal = 0;
  for (const row of exp.data) {
    const amt = Number(row.amount_cents) || 0;
    grandTotal += amt;
    const m = Number(row.occurred_on.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) monthlyTotals[m] += amt;

    let key;
    let label;
    if (groupBy === 'category') {
      key = row.category;
      label = row.category;
    } else if (groupBy === 'animal') {
      key = row.animal_id;
      label = animalNameById.get(row.animal_id) || '(unknown)';
    } else {
      key = ranchMap.data.byAnimal.get(row.animal_id) || 'unassigned';
      label = ranchMap.data.ranchNames.get(key) || 'Unassigned';
    }
    const prev = totalsByKey.get(key) || { key, label, total_cents: 0, entry_count: 0 };
    prev.total_cents += amt;
    prev.entry_count += 1;
    totalsByKey.set(key, prev);
  }

  const totals = Array.from(totalsByKey.values()).sort((a, b) => b.total_cents - a.total_cents);
  const monthlyTimeline = monthlyTotals.map((v, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    total_cents: v,
  }));

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.spending.read',
    target_table: 'expenses', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { year, group_by: groupBy, entry_count: exp.data.length, grand_total_cents: grandTotal },
  }, ctx);

  return json({
    year,
    group_by: groupBy,
    grand_total_cents: grandTotal,
    totals,
    monthly_timeline: monthlyTimeline,
    categories: EXPENSE_CATEGORIES,
  });
}

async function handleSpendingCsv(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const year = Number(url.searchParams.get('year'));
  if (!validYear(year)) return json({ error: 'bad_year' }, 400);

  const rl = await rateLimit(env, `ratelimit:spending_csv:${actorId}`, SPENDING_EXPORT_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const exp = await spListExpensesYear(env, actorId, year);
  if (!exp.ok) return json({ error: 'expenses_failed', status: exp.status }, 500);

  const header = [
    'occurred_on', 'animal_id', 'animal_name', 'category',
    'amount_cents', 'amount_usd', 'currency', 'vendor', 'notes',
    'source_invoice_id', 'billable_to_owner', 'recorder_role',
  ];
  const lines = [header.join(',')];
  for (const row of exp.data) {
    const amountUsd = (Number(row.amount_cents) / 100).toFixed(2);
    lines.push([
      csvEscape(row.occurred_on),
      csvEscape(row.animal_id),
      csvEscape(row.animal?.barn_name ?? ''),
      csvEscape(row.category),
      csvEscape(row.amount_cents),
      csvEscape(amountUsd),
      csvEscape('usd'),
      csvEscape(row.vendor ?? ''),
      csvEscape(row.notes ?? ''),
      csvEscape(row.source_invoice_id ?? ''),
      csvEscape(row.billable_to_owner ? 'true' : 'false'),
      csvEscape(row.recorder_role ?? ''),
    ].join(','));
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.spending.csv_export',
    target_table: 'expenses', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { year, row_count: exp.data.length },
  }, ctx);

  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="barn-spending-${year}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

async function handleSpendingPdf(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const year = Number(url.searchParams.get('year'));
  if (!validYear(year)) return json({ error: 'bad_year' }, 400);

  const rl = await rateLimit(env, `ratelimit:spending_pdf:${actorId}`, SPENDING_EXPORT_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  // TECH_DEBT(phase-8:04-01) — PDF export reuses Module 02 template
  // pipeline; stubs to 501 until BROWSER binding ships.
  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.spending.pdf_export_attempt',
    target_table: 'audit_log', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { year, outcome: 'not_implemented' },
  }, ctx);

  return json({ error: 'pdf_not_implemented', tech_debt: 'phase-8:04-01' }, 501);
}

async function handleAnimalCostBasisGet(request, env, animalId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:spending_basis_get:${actorId}`, SPENDING_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const a = await spGetAnimalBasis(env, actorId, animalId);
  if (!a.ok) return json({ error: 'animal_lookup_failed', status: a.status }, 500);
  if (!a.data) return json({ error: 'not_found' }, 404);

  const sum = await spSumAnimalSpend(env, animalId);
  if (!sum.ok) return json({ error: 'sum_failed', status: sum.status }, 500);

  const cumulative = sum.data;
  let annualized = null;
  if (a.data.acquired_at) {
    const daysOwned = Math.max(
      1,
      Math.floor((Date.now() - new Date(a.data.acquired_at).getTime()) / (24 * 3600 * 1000))
    );
    annualized = Math.round((cumulative * 365) / daysOwned);
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.spending.cost_basis_read',
    target_table: 'animals', target_id: animalId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({
    animal: a.data,
    cumulative_spend_cents: cumulative,
    annualized_spend_cents: annualized,
  });
}

async function handleAnimalCostBasisPatch(request, env, animalId, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:spending_basis_patch:${actorId}`, SPENDING_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const errs = [];
  const patch = {};

  if (body?.acquired_at !== undefined) {
    if (body.acquired_at === null) {
      patch.acquired_at = null;
    } else if (typeof body.acquired_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.acquired_at)) {
      errs.push('acquired_at must be YYYY-MM-DD');
    } else {
      patch.acquired_at = body.acquired_at;
    }
  }
  if (body?.acquired_price_cents !== undefined) {
    if (body.acquired_price_cents === null) {
      patch.acquired_price_cents = null;
    } else if (!Number.isInteger(body.acquired_price_cents) || body.acquired_price_cents < 0) {
      errs.push('acquired_price_cents must be integer >= 0 or null');
    } else {
      patch.acquired_price_cents = body.acquired_price_cents;
    }
  }
  if (body?.disposition !== undefined) {
    if (body.disposition === null) {
      patch.disposition = null;
    } else if (!DISPOSITION_VALUES.includes(body.disposition)) {
      errs.push(`disposition must be one of: ${DISPOSITION_VALUES.join(', ')}`);
    } else {
      patch.disposition = body.disposition;
    }
  }
  if (body?.disposition_at !== undefined) {
    if (body.disposition_at === null) {
      patch.disposition_at = null;
    } else if (typeof body.disposition_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.disposition_at)) {
      errs.push('disposition_at must be YYYY-MM-DD');
    } else {
      patch.disposition_at = body.disposition_at;
    }
  }
  if (body?.disposition_amount_cents !== undefined) {
    if (body.disposition_amount_cents === null) {
      patch.disposition_amount_cents = null;
    } else if (!Number.isInteger(body.disposition_amount_cents) || body.disposition_amount_cents < 0) {
      errs.push('disposition_amount_cents must be integer >= 0 or null');
    } else {
      patch.disposition_amount_cents = body.disposition_amount_cents;
    }
  }

  if (errs.length) return json({ error: 'validation_failed', errors: errs }, 400);
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields' }, 400);

  // App-level enforcement of the "disposition_at implies non-still-owned"
  // rule before the DB constraint fires — gives a Zod-style 400.
  const effectiveDisp = patch.disposition !== undefined
    ? patch.disposition
    : undefined;
  const effectiveDispAt = patch.disposition_at !== undefined
    ? patch.disposition_at
    : undefined;
  if (effectiveDispAt !== undefined && effectiveDispAt !== null) {
    if (effectiveDisp === undefined) {
      // Need to know the current row's disposition.
      const cur = await spGetAnimalBasis(env, actorId, animalId);
      if (!cur.ok) return json({ error: 'animal_lookup_failed', status: cur.status }, 500);
      if (!cur.data) return json({ error: 'not_found' }, 404);
      if (!cur.data.disposition || cur.data.disposition === 'still_owned') {
        return json({
          error: 'validation_failed',
          errors: ['disposition_at requires a non-still_owned disposition'],
        }, 400);
      }
    } else if (effectiveDisp === 'still_owned' || effectiveDisp === null) {
      return json({
        error: 'validation_failed',
        errors: ['disposition_at requires a non-still_owned disposition'],
      }, 400);
    }
  }

  const owned = await spGetAnimalBasis(env, actorId, animalId);
  if (!owned.ok) return json({ error: 'animal_lookup_failed', status: owned.status }, 500);
  if (!owned.data) return json({ error: 'not_found' }, 404);

  const r = await spPatchAnimalBasis(env, animalId, patch);
  if (!r.ok || !r.data) return json({ error: 'patch_failed', status: r.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.spending.cost_basis_update',
    target_table: 'animals', target_id: animalId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { fields: Object.keys(patch) },
  }, ctx);

  return json({ animal: r.data });
}

/* =============================================================
   Phase 8 Module 05 — Barn Mode subscription + SL comp + promo
   ============================================================= */

const SUBSCRIPTION_READ_RATE   = { limit: 60, windowSec: 60 };
const SUBSCRIPTION_WRITE_RATE  = { limit: 10, windowSec: 60 };
const PROMO_REDEEM_RATE        = { limit: 10, windowSec: 300 };
const SL_WRITE_RATE            = { limit: 10, windowSec: 60 };
const ADMIN_PROMO_WRITE_RATE   = { limit: 30, windowSec: 60 };

async function requireSilverLiningAdmin(request, env) {
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw json({ error: 'unauthorized' }, 401);

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) throw json({ error: 'unauthorized' }, 401);
  const whoData = await who.json().catch(() => null);
  const actorId = whoData?.id;
  if (!actorId) throw json({ error: 'unauthorized' }, 401);

  const profileRes = await supabaseSelect(
    env,
    'user_profiles',
    `select=role,status&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const profile = Array.isArray(profileRes.data) ? profileRes.data[0] : null;
  if (!profile || profile.role !== 'silver_lining' || profile.status !== 'active') {
    throw json({ error: 'forbidden' }, 403);
  }
  return { actorId, jwt };
}

async function fetchOwnerEmail(env, jwt) {
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return null;
  const d = await who.json().catch(() => null);
  return d?.email || null;
}

async function handleSubscriptionGet(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sub_get:${actorId}`, SUBSCRIPTION_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const sub = await getSubscriptionForOwner(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed', status: sub.status }, 500);

  const horses = await countOwnerHorses(env, actorId);
  const events = await listEntitlementEvents(env, actorId, 20);
  const link   = await getSilverLiningLinkForOwner(env, actorId);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.subscription.read',
    target_table: 'subscriptions', target_id: sub.data?.id ?? null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { has_sub: !!sub.data, horse_count: horses.data },
  }, ctx);

  return json({
    subscription:      sub.data || null,
    horse_count:       horses.data,
    horse_limit_free:  5,
    on_barn_mode:      ownerHasBarnMode(sub.data),
    silver_lining:     link.data || null,
    entitlement_events: events.data || [],
    stripe_configured: isStripePlatformConfigured(env),
  });
}

async function handleSubscriptionCheckout(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId, jwt;
  try { ({ actorId, jwt } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sub_checkout:${actorId}`, SUBSCRIPTION_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  if (!isStripePlatformConfigured(env)) {
    // TECH_DEBT(phase-8:05-01) — STRIPE_PRICE_BARN_MODE_MONTHLY not provisioned.
    ctx_audit(env, {
      actor_id: actorId, actor_role: 'owner',
      action: 'barn.subscription.checkout_unconfigured',
      target_table: 'subscriptions', target_id: null,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
      metadata: { tech_debt: 'phase-8:05-01' },
    }, ctx);
    return json({ error: 'stripe_not_configured', tech_debt: 'phase-8:05-01' }, 501);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const price = body?.price === 'annual' ? 'annual' : 'monthly';
  const priceId = price === 'annual'
    ? env.STRIPE_PRICE_BARN_MODE_ANNUAL
    : env.STRIPE_PRICE_BARN_MODE_MONTHLY;
  if (!priceId) {
    return json({ error: 'stripe_price_missing', tech_debt: 'phase-8:05-01' }, 501);
  }

  const sub = await getSubscriptionForOwner(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed' }, 500);
  const email = await fetchOwnerEmail(env, jwt);
  const custRes = await ensurePlatformStripeCustomer(env, {
    ownerId: actorId,
    email,
    existingCustomerId: sub.data?.stripe_customer_id || null,
  });
  if (!custRes.ok) return json({ error: 'stripe_customer_failed', status: custRes.status, message: custRes.message }, 502);
  const customerId = custRes.data?.id;

  const base = env.PUBLIC_APP_URL || 'https://maneline.co';
  const successUrl = `${base}/app/settings/subscription?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${base}/app/settings/subscription?stripe=cancel`;

  const sess = await createBarnModeCheckoutSession(env, {
    ownerId: actorId,
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    idempotencyKey: `barn_mode_checkout:${actorId}:${price}`,
  });
  if (!sess.ok) return json({ error: 'stripe_checkout_failed', status: sess.status, message: sess.message }, 502);

  if (!sub.data) {
    await insertSubscriptionRow(env, {
      owner_id: actorId,
      tier: 'free',
      status: 'active',
      stripe_customer_id: customerId,
    });
  } else if (!sub.data.stripe_customer_id) {
    await patchSubscription(env, sub.data.id, { stripe_customer_id: customerId });
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.subscription.checkout_start',
    target_table: 'subscriptions', target_id: sub.data?.id ?? null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { price, session_id: sess.data?.id },
  }, ctx);

  return json({ checkout_url: sess.data?.url, session_id: sess.data?.id });
}

async function handleSubscriptionPortal(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sub_portal:${actorId}`, SUBSCRIPTION_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'stripe_not_configured', tech_debt: 'phase-8:05-01' }, 501);
  }

  const sub = await getSubscriptionForOwner(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed' }, 500);
  if (!sub.data?.stripe_customer_id) {
    return json({ error: 'no_stripe_customer' }, 400);
  }

  const base = env.PUBLIC_APP_URL || 'https://maneline.co';
  const portal = await createBillingPortalSession(env, {
    customerId: sub.data.stripe_customer_id,
    returnUrl: `${base}/app/settings/subscription`,
  });
  if (!portal.ok) return json({ error: 'stripe_portal_failed', status: portal.status, message: portal.message }, 502);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.subscription.portal_open',
    target_table: 'subscriptions', target_id: sub.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({ portal_url: portal.data?.url });
}

/* =============================================================
 * Phase 9 — Trainer Pro subscription endpoints.
 * GET /api/trainer/subscription            — snapshot
 * POST /api/trainer/subscription/checkout  — Stripe Checkout session
 * POST /api/trainer/subscription/portal    — billing portal
 *
 * Pricing: $25/mo, env STRIPE_PRICE_TRAINER_PRO_MONTHLY. Mirrored
 * through the shared webhook handler — metadata.ml_source
 * distinguishes trainer_pro_subscription from barn_mode_subscription.
 * ============================================================= */
async function handleTrainerSubscriptionGet(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:trainer_sub_get:${actorId}`, SUBSCRIPTION_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const sub    = await getSubscriptionForTrainer(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed', status: sub.status }, 500);
  const horses = await countTrainerDistinctHorses(env, actorId);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'trainer',
    action: 'trainer.subscription.read',
    target_table: 'subscriptions', target_id: sub.data?.id ?? null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { has_sub: !!sub.data, horse_count: horses.data },
  }, ctx);

  return json({
    subscription:      sub.data || null,
    horse_count:       horses.data,
    horse_limit_free:  5,
    on_trainer_pro:    trainerHasPro(sub.data),
    stripe_configured: isTrainerProConfigured(env),
  });
}

async function handleTrainerSubscriptionCheckout(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId, jwt;
  try { ({ actorId, jwt } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:trainer_sub_checkout:${actorId}`, SUBSCRIPTION_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  if (!isTrainerProConfigured(env)) {
    return json({ error: 'stripe_not_configured', tech_debt: 'phase-9:01-01' }, 501);
  }
  const priceId = env.STRIPE_PRICE_TRAINER_PRO_MONTHLY;

  const sub = await getSubscriptionForTrainer(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed' }, 500);
  const email = await fetchOwnerEmail(env, jwt);
  const custRes = await ensurePlatformTrainerStripeCustomer(env, {
    trainerId: actorId,
    email,
    existingCustomerId: sub.data?.stripe_customer_id || null,
  });
  if (!custRes.ok) return json({ error: 'stripe_customer_failed', status: custRes.status, message: custRes.message }, 502);
  const customerId = custRes.data?.id;

  const base = env.PUBLIC_APP_URL || 'https://maneline.co';
  const successUrl = `${base}/trainer/subscription?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${base}/trainer/subscription?stripe=cancel`;

  const sess = await createTrainerProCheckoutSession(env, {
    trainerId: actorId,
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    idempotencyKey: `trainer_pro_checkout:${actorId}`,
  });
  if (!sess.ok) return json({ error: 'stripe_checkout_failed', status: sess.status, message: sess.message }, 502);

  if (!sub.data) {
    await insertSubscriptionRow(env, {
      owner_id:   actorId,
      role_scope: 'trainer',
      tier:       'free',
      status:     'active',
      stripe_customer_id: customerId,
    });
  } else if (!sub.data.stripe_customer_id) {
    await patchSubscription(env, sub.data.id, { stripe_customer_id: customerId });
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'trainer',
    action: 'trainer.subscription.checkout_start',
    target_table: 'subscriptions', target_id: sub.data?.id ?? null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { session_id: sess.data?.id },
  }, ctx);

  return json({ checkout_url: sess.data?.url, session_id: sess.data?.id });
}

async function handleTrainerSubscriptionPortal(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:trainer_sub_portal:${actorId}`, SUBSCRIPTION_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'stripe_not_configured', tech_debt: 'phase-9:01-01' }, 501);
  }

  const sub = await getSubscriptionForTrainer(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed' }, 500);
  if (!sub.data?.stripe_customer_id) {
    return json({ error: 'no_stripe_customer' }, 400);
  }

  const base = env.PUBLIC_APP_URL || 'https://maneline.co';
  const portal = await createBillingPortalSession(env, {
    customerId: sub.data.stripe_customer_id,
    returnUrl: `${base}/trainer/subscription`,
  });
  if (!portal.ok) return json({ error: 'stripe_portal_failed', status: portal.status, message: portal.message }, 502);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'trainer',
    action: 'trainer.subscription.portal_open',
    target_table: 'subscriptions', target_id: sub.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({ portal_url: portal.data?.url });
}

async function handlePromoRedeem(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:promo_redeem:${actorId}`, PROMO_REDEEM_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const raw = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!raw || raw.length > 32) return json({ error: 'bad_code' }, 400);

  const promo = await findPromoByCode(env, raw);
  if (!promo.ok) return json({ error: 'promo_lookup_failed' }, 500);
  if (!promo.data) return json({ error: 'invalid_code' }, 404);

  if (promo.data.redeemed_at && promo.data.single_use) {
    return json({ error: 'already_redeemed' }, 409);
  }
  if (promo.data.expires_at && new Date(promo.data.expires_at).getTime() < Date.now()) {
    return json({ error: 'expired' }, 410);
  }

  if (promo.data.single_use) {
    const claim = await markPromoRedeemed(env, promo.data.id, actorId);
    if (!claim.ok || !claim.data) {
      return json({ error: 'already_redeemed' }, 409);
    }
  }

  const sub = await getSubscriptionForOwner(env, actorId);
  if (!sub.ok) return json({ error: 'sub_lookup_failed' }, 500);

  const months = promo.data.grants_barn_mode_months;
  const expiresAt = new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString();
  const patch = {
    tier: 'barn_mode',
    status: 'active',
    comp_source: 'promo_code',
    comp_campaign: promo.data.campaign,
    comp_expires_at: expiresAt,
  };

  const prev = sub.data;
  const next = prev
    ? await patchSubscription(env, prev.id, patch)
    : await insertSubscriptionRow(env, { owner_id: actorId, ...patch });
  if (!next.ok || !next.data) {
    return json({ error: 'sub_patch_failed' }, 500);
  }

  await insertEntitlementEvent(env, {
    owner_id: actorId,
    event: 'comp_attached',
    reason: `promo_code:${promo.data.campaign}`,
    source: 'promo_code',
    prev_tier: prev?.tier ?? null,
    next_tier: 'barn_mode',
    prev_comp_source: prev?.comp_source ?? null,
    next_comp_source: 'promo_code',
    metadata: { code: promo.data.code, months, campaign: promo.data.campaign },
  });

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.promo_code.redeem',
    target_table: 'promo_codes', target_id: promo.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { campaign: promo.data.campaign, months },
  }, ctx);

  return json({
    status: 'redeemed',
    comp_source: 'promo_code',
    comp_campaign: promo.data.campaign,
    comp_expires_at: expiresAt,
  });
}

// Silver Lining endpoints — the happy path needs the Shopify admin
// token, which is a 🔴 dependency in the tech-debt ledger (phase-8:05-03).
// Until that token lands, we keep the routes wired but return 501 with
// the TECH_DEBT slug so the SPA shows the "coming soon" state.
async function handleSilverLiningLink(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sl_link:${actorId}`, SL_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  if (!env.SILVER_LINING_SHOPIFY_ADMIN_TOKEN || !env.SILVER_LINING_SHOPIFY_STORE_DOMAIN) {
    ctx_audit(env, {
      actor_id: actorId, actor_role: 'owner',
      action: 'barn.silver_lining.link_unconfigured',
      target_table: 'silver_lining_links', target_id: null,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
      metadata: { tech_debt: 'phase-8:05-03' },
    }, ctx);
    return json({ error: 'silver_lining_not_configured', tech_debt: 'phase-8:05-03' }, 501);
  }

  // When the Shopify token is live, this handler verifies the email +
  // order number via Shopify Admin API, creates a platform SetupIntent
  // so the card is on file for conversion, and returns both identifiers
  // for the SPA's confirm step. The verification + link-insert body is
  // TECH_DEBT(phase-8:05-04) — see ledger for the remaining work.
  return json({ error: 'silver_lining_link_pending', tech_debt: 'phase-8:05-04' }, 501);
}

async function handleSilverLiningLinkConfirm(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sl_link_confirm:${actorId}`, SL_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.silver_lining.link_confirm_unconfigured',
    target_table: 'silver_lining_links', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { tech_debt: 'phase-8:05-04' },
  }, ctx);
  return json({ error: 'silver_lining_link_pending', tech_debt: 'phase-8:05-04' }, 501);
}

async function handleSilverLiningStatus(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sl_status:${actorId}`, SUBSCRIPTION_READ_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const link = await getSilverLiningLinkForOwner(env, actorId);
  if (!link.ok) return json({ error: 'sl_lookup_failed' }, 500);

  return json({ silver_lining: link.data || null });
}

async function handleSilverLiningUnlink(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireOwner(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:sl_unlink:${actorId}`, SL_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const link = await getSilverLiningLinkForOwner(env, actorId);
  if (!link.ok) return json({ error: 'sl_lookup_failed' }, 500);
  if (!link.data) return json({ error: 'not_linked' }, 404);
  if (new Date(link.data.sticky_until).getTime() > Date.now()) {
    return json({ error: 'sticky', sticky_until: link.data.sticky_until }, 409);
  }

  const upd = await patchSilverLiningLink(env, link.data.id, {
    archived_at: new Date().toISOString(),
  });
  if (!upd.ok) return json({ error: 'unlink_failed' }, 500);

  const sub = await getSubscriptionForOwner(env, actorId);
  if (sub.ok && sub.data?.comp_source === 'silver_lining_sns') {
    await patchSubscription(env, sub.data.id, {
      comp_source: null,
      comp_expires_at: null,
    });
    await insertEntitlementEvent(env, {
      owner_id: actorId,
      event: 'comp_detached',
      reason: 'user_unlink',
      source: 'user_action',
      prev_tier: sub.data.tier,
      next_tier: sub.data.tier,
      prev_comp_source: 'silver_lining_sns',
      next_comp_source: null,
      metadata: {},
    });
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'owner',
    action: 'barn.silver_lining.unlink',
    target_table: 'silver_lining_links', target_id: link.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: {},
  }, ctx);

  return json({ status: 'unlinked' });
}

async function handleSilverLiningVerifyTick(request, env, ctx) {
  const gate = await requireInternalSecret(request, env);
  if (gate) return gate;

  if (!env.SILVER_LINING_SHOPIFY_ADMIN_TOKEN || !env.SILVER_LINING_SHOPIFY_STORE_DOMAIN) {
    // TECH_DEBT(phase-8:05-04) — cron body depends on SL token delivery.
    return json({ error: 'silver_lining_not_configured', tech_debt: 'phase-8:05-04' }, 501);
  }

  // Live body: loop every silver_lining_links row (archived_at is null
  // AND (last_verified_at is null OR last_verified_at < now() - 22h)),
  // hit Shopify /customers/:id/subscription_contracts, apply the
  // grant / grace / convert state machine described in §E of the spec.
  ctx_audit(env, {
    actor_id: null, actor_role: 'system',
    action: 'barn.silver_lining.cron_tick_pending',
    target_table: 'silver_lining_links', target_id: null,
    ip: clientIp(request),
    user_agent: 'pg_cron',
    metadata: { tech_debt: 'phase-8:05-04' },
  }, ctx);
  return json({ error: 'sl_cron_pending', tech_debt: 'phase-8:05-04' }, 501);
}

async function handleAdminPromoCodesList(request, env, url, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireSilverLiningAdmin(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const campaign = url.searchParams.get('campaign') || null;
  const includeArchived = url.searchParams.get('include_archived') === '1';
  const rows = await listPromoCodes(env, campaign, { includeArchived });
  if (!rows.ok) return json({ error: 'promo_list_failed' }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'silver_lining',
    action: 'admin.promo_codes.list',
    target_table: 'promo_codes', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { campaign, include_archived: includeArchived, row_count: rows.data.length },
  }, ctx);

  return json({ codes: rows.data });
}

async function handleAdminPromoCodeArchiveToggle(request, env, ctx, promoId, archive) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireSilverLiningAdmin(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:admin_promo_write:${actorId}`, ADMIN_PROMO_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  const res = archive
    ? await archivePromoCode(env, promoId)
    : await unarchivePromoCode(env, promoId);
  if (!res.ok) return json({ error: 'promo_update_failed', status: res.status }, 500);
  if (!res.data) {
    // Row didn't exist, was already in target state, or (for archive) already redeemed.
    return json({ error: 'promo_not_eligible' }, 409);
  }

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'silver_lining',
    action: archive ? 'admin.promo_codes.archive' : 'admin.promo_codes.unarchive',
    target_table: 'promo_codes', target_id: promoId,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { campaign: res.data.campaign || null },
  }, ctx);

  return json({ code: res.data });
}

async function handleAdminPromoCodesCreate(request, env, ctx) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  let actorId;
  try { ({ actorId } = await requireSilverLiningAdmin(request, env)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const rl = await rateLimit(env, `ratelimit:admin_promo_create:${actorId}`, ADMIN_PROMO_WRITE_RATE);
  if (!rl.ok) return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const campaign = typeof body?.campaign === 'string' ? body.campaign.trim() : '';
  const months = Number(body?.grants_barn_mode_months);
  const count = Math.max(1, Math.min(500, Number(body?.count) || 1));
  const singleUse = body?.single_use !== false;
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
  let expiresAt = null;
  if (typeof body?.expires_at === 'string' && body.expires_at.trim()) {
    const d = new Date(body.expires_at);
    if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
  }

  if (!campaign || campaign.length > 64) return json({ error: 'bad_campaign' }, 400);
  if (!Number.isFinite(months) || months < 1 || months > 36) return json({ error: 'bad_months' }, 400);

  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      code: generatePromoCode(),
      campaign,
      grants_barn_mode_months: months,
      single_use: singleUse,
      expires_at: expiresAt,
      created_by: actorId,
      notes,
    });
  }
  const ins = await insertPromoCodesBulk(env, rows);
  if (!ins.ok) return json({ error: 'promo_insert_failed', status: ins.status }, 500);

  ctx_audit(env, {
    actor_id: actorId, actor_role: 'silver_lining',
    action: 'admin.promo_codes.create',
    target_table: 'promo_codes', target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { campaign, months, count, single_use: singleUse },
  }, ctx);

  return json({ codes: ins.data }, 201);
}
