// ============================================================
// worker/hubspot.js — HubSpot v3 API wrapper
// ------------------------------------------------------------
// Two primitives used by the /api/_internal/hubspot-drain
// handler:
//
//   upsertContact(env, email, props)   — PATCH-or-CREATE via
//     batch/upsert with idProperty=email. Idempotent.
//   sendBehavioralEvent(env, {eventName, email, properties})
//     — /events/v3/send. The eventName must match a Custom
//     Behavioral Event registered in the HubSpot portal (set up
//     manually by the operator once per event name).
//
// Contract with caller:
//   - Returns { ok, status, data } envelopes. Never throws for
//     a controlled 4xx/5xx response; only throws on network /
//     JSON parse failure (which the drain handler maps to a
//     retriable error).
//   - 4xx → permanent (drain moves to dead_letter).
//   - 5xx / throw → transient (drain schedules a backoff retry).
//
// Env:
//   HUBSPOT_PRIVATE_APP_TOKEN   — required. Private-app token with
//                                 crm.objects.contacts.write +
//                                 behavioral_events.send scopes.
// ============================================================

const HS_API = 'https://api.hubapi.com';

export function isHubspotConfigured(env) {
  return typeof env.HUBSPOT_PRIVATE_APP_TOKEN === 'string'
    && env.HUBSPOT_PRIVATE_APP_TOKEN.length > 0;
}

async function hubspotFetch(env, path, body) {
  const res = await fetch(`${HS_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Idempotent upsert keyed by email. v3 batch/upsert is the
// canonical path — a single-item batch is cheaper than a lookup +
// conditional PATCH and matches HubSpot's own recommended pattern.
export async function upsertContact(env, email, properties) {
  return hubspotFetch(env, '/crm/v3/objects/contacts/batch/upsert', {
    inputs: [{ idProperty: 'email', id: email, properties: properties ?? {} }],
  });
}

// Send a Custom Behavioral Event.
//   eventName must be prefixed with the HubSpot account's internal
//   event namespace (e.g. pe12345678_maneline_user_registered).
//   HUBSPOT_EVENT_PREFIX lets us keep event names portable in code
//   and namespace-correct on the wire. If unset, we send the bare
//   event name (works for default-namespace portals).
export async function sendBehavioralEvent(env, { eventName, email, properties }) {
  const prefix = typeof env.HUBSPOT_EVENT_PREFIX === 'string'
    ? env.HUBSPOT_EVENT_PREFIX : '';
  const wireName = prefix ? `${prefix}_${eventName}` : eventName;
  return hubspotFetch(env, '/events/v3/send', {
    eventName: wireName,
    email,
    properties: properties ?? {},
  });
}

// Translate a queued `pending_hubspot_syncs` payload into the
// contact `properties` HubSpot expects, plus the event properties
// for the behavioral event. Keeps the protocol-specific mapping in
// one place so the drain handler stays generic.
export function toHubspotPayload(eventName, payload) {
  const props = {};
  if (payload?.email) props.email = payload.email;
  if (payload?.display_name) {
    const parts = String(payload.display_name).trim().split(/\s+/);
    if (parts[0]) props.firstname = parts[0];
    if (parts.length > 1) props.lastname = parts.slice(1).join(' ');
  }
  if (payload?.role) props.maneline_role = payload.role;

  switch (eventName) {
    case 'maneline_trainer_applied':
      props.maneline_trainer_status = 'submitted';
      break;
    case 'maneline_trainer_status_changed':
      if (payload?.new_status) props.maneline_trainer_status = payload.new_status;
      break;
    case 'maneline_order_placed':
      if (typeof payload?.total_cents === 'number') {
        props.maneline_last_order_total_cents = String(payload.total_cents);
      }
      break;
    case 'maneline_invoice_paid':
      // Track lifetime-paid-to-trainer signal for workflows. We don't
      // have the prior value here (stateless mapper) so we stamp the
      // most recent invoice's amount; HubSpot can aggregate via a
      // calculated property if LTV is needed.
      if (typeof payload?.amount_paid_cents === 'number') {
        props.maneline_last_invoice_paid_cents = String(payload.amount_paid_cents);
      } else if (typeof payload?.total_cents === 'number') {
        props.maneline_last_invoice_paid_cents = String(payload.total_cents);
      }
      if (typeof payload?.paid_at === 'string') {
        props.maneline_last_invoice_paid_at = payload.paid_at;
      }
      break;
    // maneline_emergency_triggered and maneline_user_registered
    // do not bump contact props — only the behavioral event.
  }

  // Behavioral event properties: flatten primitives; skip nested
  // objects to keep payloads under HubSpot's 8KB event body cap.
  const eventProps = {};
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;
      eventProps[k] = v;
    }
  }

  return {
    email: typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : null,
    contactProperties: props,
    eventProperties: eventProps,
  };
}
