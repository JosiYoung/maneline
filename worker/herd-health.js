/**
 * Mane Line — Phase 8 Module 02 — Herd Health helpers.
 *
 * All functions assume service_role (env.SUPABASE_SERVICE_ROLE_KEY). Route
 * handlers in worker.js own auth + rate limit + audit; this module only
 * speaks to Supabase.
 */

const RESTB = (env) => `${env.SUPABASE_URL}/rest/v1`;
const SR = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

export const HERD_HEALTH_RECORD_TYPES = [
  'coggins',
  'core_vaccines',
  'risk_vaccines',
  'dental',
  'farrier',
  'fec',
  'deworming',
];
export const HERD_HEALTH_RECORD_TYPE_SET = new Set(HERD_HEALTH_RECORD_TYPES);

/**
 * AAEP industry defaults. `deworming` is disabled (interval=0 is not
 * allowed by the check constraint, so it ships as 365 + enabled=false
 * so the column stays valid — the dashboard treats enabled=false as
 * "informational only, no alarm").
 */
export const HERD_HEALTH_DEFAULTS = {
  coggins:       { interval_days: 365, enabled: true },
  core_vaccines: { interval_days: 365, enabled: true },
  risk_vaccines: { interval_days: 180, enabled: true },
  dental:        { interval_days: 365, enabled: true },
  farrier:       { interval_days: 49,  enabled: true },
  fec:           { interval_days: 90,  enabled: true },
  deworming:     { interval_days: 365, enabled: false },
};

export function isHerdHealthRecordType(s) {
  return typeof s === 'string' && HERD_HEALTH_RECORD_TYPE_SET.has(s);
}

/**
 * Returns the owner's threshold rows. If the owner has none (first
 * load), seeds the 7 AAEP defaults then returns them.
 */
export async function listOrSeedThresholds(env, ownerId) {
  const q = `select=id,record_type,interval_days,enabled,updated_at&owner_id=eq.${ownerId}`;
  const r = await fetch(`${RESTB(env)}/health_thresholds?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  if (rows.length >= HERD_HEALTH_RECORD_TYPES.length) {
    return { ok: true, status: 200, data: rows };
  }

  const have = new Set(rows.map((x) => x.record_type));
  const missing = HERD_HEALTH_RECORD_TYPES
    .filter((rt) => !have.has(rt))
    .map((rt) => ({
      owner_id: ownerId,
      record_type: rt,
      interval_days: HERD_HEALTH_DEFAULTS[rt].interval_days,
      enabled: HERD_HEALTH_DEFAULTS[rt].enabled,
    }));

  if (missing.length > 0) {
    const ins = await fetch(`${RESTB(env)}/health_thresholds`, {
      method: 'POST',
      headers: {
        ...SR(env),
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify(missing),
    });
    if (!ins.ok) return { ok: false, status: ins.status, data: null };
  }

  const r2 = await fetch(`${RESTB(env)}/health_thresholds?${q}`, { headers: SR(env) });
  if (!r2.ok) return { ok: false, status: r2.status, data: null };
  const rows2 = (await r2.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows2 };
}

/**
 * Upserts one threshold row for (ownerId, record_type). Uses
 * PostgREST `on_conflict` + merge-duplicates to keep logic in DB.
 */
export async function upsertThreshold(env, ownerId, row) {
  const body = [{
    owner_id: ownerId,
    record_type: row.record_type,
    interval_days: row.interval_days,
    enabled: row.enabled,
    updated_at: new Date().toISOString(),
  }];
  const r = await fetch(
    `${RESTB(env)}/health_thresholds?on_conflict=owner_id,record_type`,
    {
      method: 'POST',
      headers: {
        ...SR(env),
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

/**
 * Resets owner's thresholds to AAEP defaults. Upserts all 7 rows.
 */
export async function resetThresholdsToDefaults(env, ownerId) {
  const rows = HERD_HEALTH_RECORD_TYPES.map((rt) => ({
    owner_id: ownerId,
    record_type: rt,
    interval_days: HERD_HEALTH_DEFAULTS[rt].interval_days,
    enabled: HERD_HEALTH_DEFAULTS[rt].enabled,
    updated_at: new Date().toISOString(),
  }));
  const r = await fetch(
    `${RESTB(env)}/health_thresholds?on_conflict=owner_id,record_type`,
    {
      method: 'POST',
      headers: {
        ...SR(env),
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data : [] };
}

/**
 * Calls the compute_herd_health(p_owner_id) SQL function via the
 * PostgREST RPC endpoint. Returns the 2D grid (one row per animal ×
 * record_type).
 */
export async function computeHerdHealth(env, ownerId) {
  const r = await fetch(`${RESTB(env)}/rpc/compute_herd_health`, {
    method: 'POST',
    headers: {
      ...SR(env),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_owner_id: ownerId }),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = await r.json().catch(() => []);
  return { ok: true, status: 200, data: Array.isArray(rows) ? rows : [] };
}

/**
 * Lists the owner's non-archived animals (used to join onto grid cells).
 */
export async function listOwnerAnimals(env, ownerId) {
  const q = [
    'select=id,name,color_hex,archived_at',
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    'order=name.asc',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/animals?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

/**
 * Inserts a new dashboard acknowledgement (dismissal). Any previous
 * active ack for the same (animal, record_type) is archived first so
 * the grid reads a single current row.
 */
export async function insertAcknowledgement(env, ownerId, payload) {
  const nowIso = new Date().toISOString();
  const archFilter = [
    `owner_id=eq.${ownerId}`,
    `animal_id=eq.${payload.animal_id}`,
    `record_type=eq.${payload.record_type}`,
    'archived_at=is.null',
  ].join('&');
  await fetch(
    `${RESTB(env)}/health_dashboard_acknowledgements?${archFilter}`,
    {
      method: 'PATCH',
      headers: {
        ...SR(env),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ archived_at: nowIso }),
    }
  );
  const ins = await fetch(`${RESTB(env)}/health_dashboard_acknowledgements`, {
    method: 'POST',
    headers: {
      ...SR(env),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([{
      owner_id: ownerId,
      animal_id: payload.animal_id,
      record_type: payload.record_type,
      dismissed_until: payload.dismissed_until,
      reason: payload.reason || null,
    }]),
  });
  if (!ins.ok) return { ok: false, status: ins.status, data: null };
  const data = await ins.json().catch(() => []);
  return { ok: true, status: ins.status, data: Array.isArray(data) ? data[0] : null };
}

/**
 * Reads an animal's vet_records chronologically, most-recent first.
 * Caller scopes by owner_id (RLS-equivalent at service-role).
 */
export async function listAnimalVetRecords(env, ownerId, animalId) {
  const q = [
    'select=id,record_type,issued_on,expires_on,issuing_provider,notes,created_at',
    `owner_id=eq.${ownerId}`,
    `animal_id=eq.${animalId}`,
    'archived_at=is.null',
    'order=issued_on.desc.nullslast,created_at.desc',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/vet_records?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

/**
 * Reads a single animal row (name/color) scoped to owner.
 */
export async function getOwnerAnimal(env, ownerId, animalId) {
  const q = [
    'select=id,name,color_hex,archived_at,created_at',
    `id=eq.${animalId}`,
    `owner_id=eq.${ownerId}`,
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/animals?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}
