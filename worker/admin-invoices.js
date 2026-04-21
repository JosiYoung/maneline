// ============================================================
// worker/admin-invoices.js — Phase 7 PR #8
// ------------------------------------------------------------
// Admin read-only surface for the trainer direct-charge invoices
// table (see supabase/migrations/00018). Unlike subscriptions, we
// do NOT offer mutation verbs — admins are there for visibility
// and support triage. The trainer owns the invoice; mutations go
// through the trainer's own UI, which preserves audit clarity
// (trainer finalized, trainer voided).
//
// Endpoints:
//   GET /api/admin/invoices?status=<open|paid|void|draft|uncollectible|all>
//
// Rows are hydrated with trainer + owner display_name/email so
// the AdminInvoicesIndex table doesn't need to do a second fetch.
// ============================================================

async function sbSelect(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const STATUS_FILTERS = new Set([
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
]);

export async function adminInvoicesList(env, url) {
  const status = (url.searchParams.get('status') || '').trim();
  const parts = [
    'select=id,trainer_id,owner_id,adhoc_name,adhoc_email,' +
      'stripe_invoice_id,stripe_hosted_invoice_url,stripe_invoice_pdf_url,' +
      'invoice_number,status,period_start,period_end,due_date,' +
      'subtotal_cents,tax_cents,total_cents,amount_paid_cents,' +
      'platform_fee_cents,currency,sent_at,paid_at,voided_at,' +
      'created_at,updated_at',
    'order=created_at.desc',
    'limit=200',
  ];
  if (STATUS_FILTERS.has(status)) {
    parts.push(`status=eq.${status}`);
  }
  const q = await sbSelect(env, 'invoices', parts.join('&'));
  const rows = q.ok && Array.isArray(q.data) ? q.data : [];

  // Hydrate trainer + owner email/display_name in a single user_profiles
  // lookup. adhoc_email rows skip the owner lookup (they have no
  // owner_id) but still keep adhoc_name/adhoc_email on the row.
  const userIds = new Set();
  for (const r of rows) {
    if (r.trainer_id) userIds.add(r.trainer_id);
    if (r.owner_id) userIds.add(r.owner_id);
  }
  const userMap = new Map();
  if (userIds.size) {
    const inList = [...userIds].map((i) => `"${i}"`).join(',');
    const u = await sbSelect(
      env,
      'user_profiles',
      `select=user_id,email,display_name&user_id=in.(${inList})`,
    );
    const users = u.ok && Array.isArray(u.data) ? u.data : [];
    for (const row of users) userMap.set(row.user_id, row);
  }

  const hydrated = rows.map((r) => ({
    ...r,
    trainer_email:        userMap.get(r.trainer_id)?.email || null,
    trainer_display_name: userMap.get(r.trainer_id)?.display_name || null,
    owner_email:          userMap.get(r.owner_id)?.email || null,
    owner_display_name:   userMap.get(r.owner_id)?.display_name || null,
  }));
  return jsonResp({ rows: hydrated });
}
