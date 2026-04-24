import { supabase } from "./supabase";

// uploads — thin wrappers around the Worker endpoints in 1.2.
//
// Flow (records):
//   1. requestPresign   — Worker rate-limits, audits intent, returns
//                         { put_url, object_key, expires_in }.
//   2. uploadToR2       — browser PUTs the file body directly to R2.
//                         Content-Type MUST match what we signed with.
//   3. commitUpload     — Worker HEADs the object via its R2 binding,
//                         inserts r2_objects + vet_records|animal_media.
//   4. readUrlFor       — 5-min signed GET when we need to view the file.
//
// Every call attaches the current Supabase access token so requireOwner()
// on the Worker side sees a real user.

export type UploadKind =
  | "vet_record"
  | "animal_photo"
  | "animal_video"
  | "trainer_logo"
  | "expense_receipt";

export type PresignResult = {
  put_url: string;
  object_key: string;
  expires_in: number;
};

export type CommitRecordType = "coggins" | "vaccine" | "dental" | "farrier" | "other";

export type CommitInput =
  | {
      kind: "vet_record";
      object_key: string;
      animal_id: string;
      record_type: CommitRecordType;
      issued_on?: string | null;
      expires_on?: string | null;
      issuing_provider?: string | null;
      notes?: string | null;
    }
  | {
      kind: "animal_photo" | "animal_video";
      object_key: string;
      animal_id: string;
      caption?: string | null;
      taken_on?: string | null;
    }
  | {
      kind: "trainer_logo";
      object_key: string;
    }
  | {
      kind: "expense_receipt";
      object_key: string;
      animal_id: string;
    };

export type CommitResult = { id: string; r2_object_id: string };

export type ReadUrlResult = { get_url: string; expires_in: number };

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function postWorker<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    // Bubble up rate-limit specifically — the uploader surfaces a tailored toast.
    if (res.status === 429) {
      const err = new Error("rate_limited");
      (err as Error & { code?: string }).code = "rate_limited";
      throw err;
    }
    // Preserve the Worker's error code + detail on the thrown Error so
    // callers can map it to a specific toast instead of the blanket
    // "Something went wrong" fallback in mapSupabaseError.
    const code = typeof msg?.error === "string" ? msg.error : undefined;
    const detail = typeof msg?.detail === "string" ? msg.detail : undefined;
    const err = new Error(code || detail || `Request failed (${res.status})`);
    (err as Error & { code?: string; detail?: string; status?: number }).code = code;
    (err as Error & { code?: string; detail?: string; status?: number }).detail = detail;
    (err as Error & { code?: string; detail?: string; status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// Human-readable mapping for Worker upload error codes. Prefer this over
// mapSupabaseError for upload flows — most Worker codes don't match any
// Supabase pattern and would otherwise fall through to GENERIC.
export function mapUploadError(err: unknown): string {
  const e = err as Error & { code?: string; detail?: string; status?: number };
  const code = e?.code;
  const status = e?.status;
  switch (code) {
    case "rate_limited":
      return "Too many uploads right now; try again in a minute.";
    case "unauthorized":
    case "forbidden":
      return "You don't have permission to upload here.";
    case "bad_kind":
    case "bad_content_type":
      return "That file type isn't supported for this upload.";
    case "too_large":
      return "File is too large.";
    case "bad_record_type":
      return "Pick a valid record type (Coggins, vaccine, dental, farrier, or other).";
    case "missing_animal":
    case "animal_not_found":
      return "That horse is no longer available. Refresh and try again.";
    case "r2_not_found":
      return "Upload didn't finish reaching storage. Please try again.";
    case "db_write_failed":
      return `Couldn't save the record${e.detail ? ` (${e.detail})` : ""}. Please try again.`;
    case "not_configured":
      return "Uploads are temporarily unavailable. We've been notified.";
    default:
      if (status === 413) return "File is too large.";
      if (status === 401) return "Your session expired. Please sign in again.";
      if (typeof e?.message === "string" && e.message) return e.message;
      return "Upload failed. Please try again.";
  }
}

export async function requestPresign(input: {
  kind: UploadKind;
  contentType: string;
  byteSize: number;
  animalId?: string;
}): Promise<PresignResult> {
  return postWorker<PresignResult>("/api/uploads/sign", {
    kind: input.kind,
    content_type: input.contentType,
    byte_size_estimate: input.byteSize,
    animal_id: input.animalId ?? null,
  });
}

export async function uploadToR2(
  putUrl: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<void> {
  // XHR gives us progress events that fetch() still can't (streams
  // work on response, not request). Small surface — we only need
  // progress + error reporting.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", putUrl, true);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export async function commitUpload(input: CommitInput): Promise<CommitResult> {
  return postWorker<CommitResult>("/api/uploads/commit", input);
}

export async function readUrlFor(objectKey: string): Promise<ReadUrlResult> {
  const headers = await authHeaders();
  const res = await fetch(
    `/api/uploads/read-url?object_key=${encodeURIComponent(objectKey)}`,
    { headers }
  );
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg?.error || `read-url failed (${res.status})`);
  }
  return (await res.json()) as ReadUrlResult;
}

// MIME → upload kind mapping. Matches ALLOWED_CONTENT_TYPES on the Worker.
export const VET_RECORD_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
]);

export const TRAINER_LOGO_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const EXPENSE_RECEIPT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
