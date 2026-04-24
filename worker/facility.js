/**
 * Mane Line — Phase 8 Module 03 — Facility Map helpers.
 *
 * All service-role. Route handlers own auth + rate + audit; this
 * module only talks to Supabase (REST + RPC).
 */

const RESTB = (env) => `${env.SUPABASE_URL}/rest/v1`;
const SR = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

export const CARE_MATRIX_COLUMNS = [
  'feed_am',
  'feed_pm',
  'hay',
  'turnout',
  'blanket',
  'supplements_given',
  'meds_given',
];

/**
 * Confirms the ranch belongs to the owner. Returns the ranch row or null.
 */
export async function getOwnerRanch(env, ownerId, ranchId) {
  const q = [
    'select=id,name,color_hex,address_line1,city,state',
    `id=eq.${ranchId}`,
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/ranches?${q}`, { headers: SR(env) });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Confirms the stall belongs to a ranch owned by the caller.
 * Returns { stall, ranch_id } or null.
 */
export async function getOwnerStall(env, ownerId, stallId) {
  const q = [
    'select=id,ranch_id,label,position_row,position_col,notes,archived_at,ranch:ranches!inner(id,owner_id)',
    `id=eq.${stallId}`,
    `ranch.owner_id=eq.${ownerId}`,
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/stalls?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

/**
 * Confirms the turnout group belongs to a ranch owned by the caller.
 */
export async function getOwnerTurnoutGroup(env, ownerId, groupId) {
  const q = [
    'select=id,ranch_id,name,color_hex,notes,archived_at,ranch:ranches!inner(id,owner_id)',
    `id=eq.${groupId}`,
    `ranch.owner_id=eq.${ownerId}`,
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/turnout_groups?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

/**
 * Lists the owner's non-archived ranches with stall counts.
 */
export async function listOwnerRanches(env, ownerId) {
  const q = [
    'select=id,name,color_hex',
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    'order=name.asc',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/ranches?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

/**
 * Inserts a ranch row for the owner. Caller has already auth'd the actor.
 */
export async function insertRanch(env, ownerId, payload) {
  const r = await fetch(`${RESTB(env)}/ranches`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      owner_id: ownerId,
      name: payload.name,
      address: payload.address ?? null,
      city: payload.city ?? null,
      state: payload.state ?? null,
      color_hex: payload.color_hex ?? null,
    }]),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

/**
 * Reads the full facility map for a ranch — stalls + current
 * assignments + turnout_groups + active members. Single network
 * request each to keep SR simple; the SPA expects one consolidated
 * response.
 */
export async function readFacilityMap(env, ranchId) {
  const stallsQ = `select=*&ranch_id=eq.${ranchId}&archived_at=is.null&order=label.asc`;
  const groupsQ = `select=*&ranch_id=eq.${ranchId}&archived_at=is.null&order=name.asc`;
  const [stallsR, groupsR] = await Promise.all([
    fetch(`${RESTB(env)}/stalls?${stallsQ}`, { headers: SR(env) }),
    fetch(`${RESTB(env)}/turnout_groups?${groupsQ}`, { headers: SR(env) }),
  ]);
  if (!stallsR.ok) return { ok: false, status: stallsR.status, data: null };
  if (!groupsR.ok) return { ok: false, status: groupsR.status, data: null };
  const stalls = (await stallsR.json().catch(() => [])) || [];
  const groups = (await groupsR.json().catch(() => [])) || [];

  const stallIds = stalls.map((s) => s.id);
  const groupIds = groups.map((g) => g.id);
  let assignments = [];
  let members = [];
  if (stallIds.length) {
    const inList = stallIds.join(',');
    const r = await fetch(
      `${RESTB(env)}/stall_assignments?select=*&stall_id=in.(${inList})&unassigned_at=is.null`,
      { headers: SR(env) }
    );
    if (r.ok) assignments = (await r.json().catch(() => [])) || [];
  }
  if (groupIds.length) {
    const inList = groupIds.join(',');
    const r = await fetch(
      `${RESTB(env)}/turnout_group_members?select=*&group_id=in.(${inList})&left_at=is.null`,
      { headers: SR(env) }
    );
    if (r.ok) members = (await r.json().catch(() => [])) || [];
  }
  return { ok: true, status: 200, data: { stalls, assignments, groups, members } };
}

/**
 * Inserts a stall row. Caller has already confirmed ranch ownership.
 */
export async function insertStall(env, ranchId, payload) {
  const r = await fetch(`${RESTB(env)}/stalls`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      ranch_id: ranchId,
      label: payload.label,
      notes: payload.notes ?? null,
      position_row: payload.position_row ?? null,
      position_col: payload.position_col ?? null,
    }]),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function patchStall(env, stallId, patch) {
  const r = await fetch(`${RESTB(env)}/stalls?id=eq.${stallId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function archiveStall(env, stallId) {
  const nowIso = new Date().toISOString();
  // First stamp the active assignment (if any) as unassigned.
  await fetch(
    `${RESTB(env)}/stall_assignments?stall_id=eq.${stallId}&unassigned_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ unassigned_at: nowIso }),
    }
  );
  const r = await fetch(`${RESTB(env)}/stalls?id=eq.${stallId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ archived_at: nowIso }),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

/**
 * Atomically move an animal into a stall (or clear the stall).
 * Steps:
 *   a) unassign any active row for this animal (if any, other stalls).
 *   b) unassign any active row for this stall (if any, other animal).
 *   c) insert new active row if animal_id provided.
 */
export async function assignStall(env, ownerId, stallId, animalId) {
  const nowIso = new Date().toISOString();

  if (animalId) {
    // (a) clear animal's prior stall, anywhere.
    await fetch(
      `${RESTB(env)}/stall_assignments?animal_id=eq.${animalId}&unassigned_at=is.null`,
      {
        method: 'PATCH',
        headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ unassigned_at: nowIso }),
      }
    );
  }

  // (b) clear this stall's current assignment.
  await fetch(
    `${RESTB(env)}/stall_assignments?stall_id=eq.${stallId}&unassigned_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ unassigned_at: nowIso }),
    }
  );

  if (!animalId) return { ok: true, status: 200, data: null };

  // (c) insert new row.
  const ins = await fetch(`${RESTB(env)}/stall_assignments`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      stall_id: stallId,
      animal_id: animalId,
      assigned_by: ownerId,
    }]),
  });
  if (!ins.ok) return { ok: false, status: ins.status, data: null };
  const data = await ins.json().catch(() => []);
  return { ok: true, status: ins.status, data: Array.isArray(data) ? data[0] : null };
}

export async function insertTurnoutGroup(env, ranchId, payload) {
  const r = await fetch(`${RESTB(env)}/turnout_groups`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      ranch_id: ranchId,
      name: payload.name,
      color_hex: payload.color_hex ?? null,
      notes: payload.notes ?? null,
    }]),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function patchTurnoutGroup(env, groupId, patch) {
  const r = await fetch(`${RESTB(env)}/turnout_groups?id=eq.${groupId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function archiveTurnoutGroup(env, groupId) {
  const nowIso = new Date().toISOString();
  await fetch(
    `${RESTB(env)}/turnout_group_members?group_id=eq.${groupId}&left_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ left_at: nowIso }),
    }
  );
  const r = await fetch(`${RESTB(env)}/turnout_groups?id=eq.${groupId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ archived_at: nowIso }),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function addTurnoutMembers(env, ownerId, groupId, animalIds) {
  const rows = animalIds.map((animal_id) => ({
    group_id: groupId,
    animal_id,
    added_by: ownerId,
  }));
  const r = await fetch(
    `${RESTB(env)}/turnout_group_members?on_conflict=group_id,animal_id`,
    {
      method: 'POST',
      headers: {
        ...SR(env),
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data : [] };
}

export async function removeTurnoutMember(env, groupId, animalId) {
  const nowIso = new Date().toISOString();
  const r = await fetch(
    `${RESTB(env)}/turnout_group_members?group_id=eq.${groupId}&animal_id=eq.${animalId}&left_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ left_at: nowIso }),
    }
  );
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = await r.json().catch(() => []);
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

/**
 * Lists care_matrix_entries for a (ranch, date). Joined on active
 * stall_assignments → animal_id filter keeps the list scoped to
 * horses currently at the ranch.
 */
export async function listCareMatrix(env, ranchId, dateYmd) {
  // Horses at ranch: active assignments → stall.ranch_id
  const r1 = await fetch(
    `${RESTB(env)}/stall_assignments?select=animal_id,stall:stalls!inner(id,ranch_id,label)&unassigned_at=is.null&stall.ranch_id=eq.${ranchId}`,
    { headers: SR(env) }
  );
  if (!r1.ok) return { ok: false, status: r1.status, data: null };
  const joined = (await r1.json().catch(() => [])) || [];
  const animalIds = joined.map((x) => x.animal_id);
  if (animalIds.length === 0) {
    return { ok: true, status: 200, data: { animal_ids: [], entries: [] } };
  }
  const inList = animalIds.join(',');
  const r2 = await fetch(
    `${RESTB(env)}/care_matrix_entries?select=*&animal_id=in.(${inList})&entry_date=eq.${dateYmd}&archived_at=is.null`,
    { headers: SR(env) }
  );
  if (!r2.ok) return { ok: false, status: r2.status, data: null };
  const entries = (await r2.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: { animal_ids: animalIds, entries } };
}

export async function batchUpsertCareMatrix(env, ownerId, dateYmd, entries) {
  const rows = entries.map((e) => ({
    animal_id: e.animal_id,
    entry_date: dateYmd,
    feed_am: !!e.feed_am,
    feed_pm: !!e.feed_pm,
    hay: !!e.hay,
    turnout: !!e.turnout,
    blanket: !!e.blanket,
    supplements_given: !!e.supplements_given,
    meds_given: !!e.meds_given,
    notes: e.notes ? String(e.notes).slice(0, 1000) : null,
    updated_by: ownerId,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return { ok: true, status: 200, data: [] };
  const r = await fetch(
    `${RESTB(env)}/care_matrix_entries?on_conflict=animal_id,entry_date`,
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
