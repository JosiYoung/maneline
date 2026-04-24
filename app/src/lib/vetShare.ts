import { supabase } from "./supabase";

// Vet-share client lib — Phase 5.7. Owner-facing endpoints require the
// owner's JWT. getVetShare is anon (the token *is* the credential).

export const VET_SHARE_TOKENS_QUERY_KEY = ["vet_share_tokens"] as const;

export type VetShareScope = {
  records: boolean;
  media: boolean;
  sessions: boolean;
};

export type VetShareExpiryDays = 1 | 7 | 14 | 30;

export const VET_SHARE_EXPIRY_CHOICES: ReadonlyArray<{
  value: VetShareExpiryDays;
  label: string;
}> = [
  { value: 1, label: "24 hours" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

export type VetShareTokenCreated = {
  id: string;
  token: string;
  url: string;
  animal_id: string;
  scope: VetShareScope;
  expires_at: string;
  created_at: string;
};

export type VetShareTokenRow = {
  id: string;
  animal_id: string;
  token_hint: string | null;
  scope: VetShareScope;
  expires_at: string;
  viewed_at: string | null;
  view_count: number;
  revoked_at: string | null;
  created_at: string;
};

export type CreateVetShareTokenInput = {
  animal_id: string;
  expires_in_days: VetShareExpiryDays;
  scope: { records: boolean; media: boolean };
};

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string; detail?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  // If the Worker route didn't match and the ASSETS fallback served the
  // SPA shell, we'll have a 2xx/404 with HTML body — surface that as a
  // specific code so callers don't show a generic "something went wrong".
  const code =
    payload?.error ||
    (res.status === 404 ? "not_found" : res.status === 401 ? "unauthorized" : undefined);
  const msg =
    payload?.message || payload?.detail || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string; status?: number }).code = code;
  (err as Error & { code?: string; status?: number }).status = res.status;
  return err;
}

async function authed(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function createVetShareToken(
  input: CreateVetShareTokenInput,
): Promise<VetShareTokenCreated> {
  const res = await authed("POST", "/api/vet-share-tokens", input);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as VetShareTokenCreated;
}

export async function listVetShareTokens(animalId?: string): Promise<VetShareTokenRow[]> {
  const suffix = animalId ? `?animal_id=${encodeURIComponent(animalId)}` : "";
  const res = await authed("GET", `/api/vet-share-tokens${suffix}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { tokens: VetShareTokenRow[] };
  return payload.tokens;
}

export async function revokeVetShareToken(
  tokenId: string,
  reason?: string,
): Promise<{ ok: true; revoked_at: string | null }> {
  const res = await authed(
    "POST",
    `/api/vet-share-tokens/${encodeURIComponent(tokenId)}/revoke`,
    reason ? { reason } : undefined,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { ok: true; revoked_at: string | null };
}

// Anon endpoint: the token is the credential. Used by VetView.
export type VetShareBundle = {
  share: {
    expires_at: string;
    scope: VetShareScope;
    issued_at: string;
  };
  animal: {
    id: string;
    species: string;
    barn_name: string;
    breed: string | null;
    sex: string | null;
    year_born: number | null;
    discipline: string | null;
  };
  records: Array<{
    id: string;
    record_type: string;
    issued_on: string | null;
    expires_on: string | null;
    issuing_provider: string | null;
    notes: string | null;
    created_at: string;
    file: { url: string; content_type: string | null; size_bytes: number | null } | null;
  }>;
  media: Array<{
    id: string;
    kind: "photo" | "video";
    caption: string | null;
    taken_on: string | null;
    created_at: string;
    file: { url: string; content_type: string | null; size_bytes: number | null } | null;
  }>;
};

export async function getVetShare(token: string): Promise<VetShareBundle> {
  const res = await fetch(`/api/vet/${encodeURIComponent(token)}`, { method: "GET" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as VetShareBundle;
}
