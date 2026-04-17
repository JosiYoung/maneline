/**
 * HubSpot integration — Phase 0 PLACEHOLDER.
 *
 * We use HubSpot for the CRM lifecycle (lead → subscriber → customer),
 * product analytics events (signup, first-protocol-saved, referral-
 * shared, etc.), and eventually marketing automation triggers.
 *
 * Mocks today so the app can wire call-sites now and flip them in
 * Phase 5 by swapping the function bodies — no call-site changes.
 *
 * Credentials this module will read once live:
 *   HUBSPOT_PRIVATE_APP_TOKEN  (SECRET — "pat-na1-..." private-app token)
 *   HUBSPOT_PORTAL_ID          (public — 8-digit hub id)
 *
 * Flip plan: see docs/INTEGRATIONS.md §HubSpot.
 */

export type HubspotLifecycle =
  | 'subscriber'
  | 'lead'
  | 'marketingqualifiedlead'
  | 'salesqualifiedlead'
  | 'opportunity'
  | 'customer'
  | 'evangelist';

export interface HubspotContactInput {
  email: string;
  lifecycle?: HubspotLifecycle;
  props?: Record<string, string | number | boolean>;
}

export interface HubspotContactResult {
  id: string;
  email: string;
  created: boolean; // true if newly created, false if updated
}

export interface HubspotEventInput {
  email: string;
  eventName: string;
  props?: Record<string, unknown>;
}

export interface HubspotEventResult {
  ok: true;
  event_id: string;
}

// TODO(Phase 5): replace mock with real HubSpot CRM API call (POST
// /crm/v3/objects/contacts). See FEATURE_MAP §4.9 and docs/INTEGRATIONS.md.
export async function upsertContact(
  contact: HubspotContactInput
): Promise<HubspotContactResult> {
  return {
    id: `mock_contact_${hashEmail(contact.email)}`,
    email: contact.email,
    created: true,
  };
}

// TODO(Phase 5): replace mock with real HubSpot Custom Behavioral Event
// call (POST /events/v3/send). See FEATURE_MAP §4.9.
export async function trackEvent(
  event: HubspotEventInput
): Promise<HubspotEventResult> {
  return {
    ok: true,
    event_id: `mock_event_${event.eventName}_${Date.now()}`,
  };
}

/* -------------------------------------------------------------
   Tiny non-cryptographic hash so mock ids are stable per email.
   ------------------------------------------------------------- */
function hashEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
