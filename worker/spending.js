/**
 * Mane Line — Phase 8 Module 04 — Barn Spending helpers.
 *
 * All service-role. Route handlers own auth + rate + audit; this
 * module only talks to Supabase REST.
 */

const RESTB = (env) => `${env.SUPABASE_URL}/rest/v1`;
const SR = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

export const EXPENSE_CATEGORIES = [
  'feed',
  'tack',
  'vet',
  'board',
  'farrier',
  'supplement',
  'travel',
  'show',
  'other',
];

export const DISPOSITION_VALUES = [
  'sold',
  'deceased',
  'leased_out',
  'retired',
  'still_owned',
];

/**
 * Fetch this owner's expenses for a given year, with animal name
 * pre-joined. Only the REST columns needed by downstream rollups.
 */
export async function listOwnerExpensesForYear(env, ownerId, year) {
  const start = `${year}-01-01`;
  const endEx = `${year + 1}-01-01`;
  const q = [
    'select=id,animal_id,category,occurred_on,amount_cents,vendor,notes,source_invoice_id,source_product_id,billable_to_owner,recorder_role,recorder_id,archived_at,animal:animals!inner(id,barn_name,owner_id)',
    `animal.owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    `occurred_on=gte.${start}`,
    `occurred_on=lt.${endEx}`,
    'order=occurred_on.desc',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/expenses?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

/**
 * Per-animal active stall assignment → ranch_id map. Keys the
 * `ranch` grouping without pulling the full facility map.
 */
export async function listOwnerAnimalRanchMap(env, ownerId) {
  const q = [
    'select=animal_id,stall:stalls!inner(id,ranch_id,ranch:ranches!inner(id,name,owner_id))',
    'unassigned_at=is.null',
    `stall.ranch.owner_id=eq.${ownerId}`,
  ].join('&');
  const r = await fetch(`${RESTB(env)}/stall_assignments?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  const byAnimal = new Map();
  const ranchNames = new Map();
  for (const row of rows) {
    const ranchId = row?.stall?.ranch_id ?? null;
    const ranchName = row?.stall?.ranch?.name ?? null;
    if (ranchId) {
      byAnimal.set(row.animal_id, ranchId);
      if (ranchName) ranchNames.set(ranchId, ranchName);
    }
  }
  return { ok: true, status: 200, data: { byAnimal, ranchNames } };
}

/**
 * Owner's animals with cost-basis pieces. Used for the per-horse
 * breakdown and the animal bar chart.
 */
export async function listOwnerAnimalsWithBasis(env, ownerId) {
  const q = [
    'select=id,barn_name,color_hex,archived_at,acquired_at,acquired_price_cents,disposition,disposition_at,disposition_amount_cents,created_at',
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    'order=barn_name.asc',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/animals?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

/**
 * Returns the animal row scoped to owner or null.
 */
export async function getOwnerAnimalBasis(env, ownerId, animalId) {
  const q = [
    'select=id,barn_name,color_hex,acquired_at,acquired_price_cents,disposition,disposition_at,disposition_amount_cents,created_at',
    `id=eq.${animalId}`,
    `owner_id=eq.${ownerId}`,
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/animals?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

/**
 * Cumulative spend (all-time, non-archived) for a single animal.
 */
export async function sumAnimalSpend(env, animalId) {
  const q = [
    'select=amount_cents',
    `animal_id=eq.${animalId}`,
    'archived_at=is.null',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/expenses?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  const total = rows.reduce((acc, x) => acc + (x.amount_cents || 0), 0);
  return { ok: true, status: 200, data: total };
}

/**
 * Patches an animal row (cost-basis fields only). Caller must have
 * already confirmed ownership.
 */
export async function patchAnimalBasis(env, animalId, patch) {
  const r = await fetch(`${RESTB(env)}/animals?id=eq.${animalId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}
