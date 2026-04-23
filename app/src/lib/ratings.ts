import { supabase } from "./supabase";
import type { Database } from "./database.types";

// session_ratings data layer.
// Per Phase 9 decisions:
//   - bidirectional (owner↔trainer) per session, at most once per direction
//   - only allowed when session.status in ('approved','paid')
//   - public aggregate shown as a star only at n >= 3 (else "New")

export type SessionRating = Database["public"]["Tables"]["session_ratings"]["Row"];

export const USER_RATING_SUMMARY_QUERY_KEY = (userId: string) =>
  ["user_rating_summary", userId] as const;
export const MY_RATING_FOR_SESSION_QUERY_KEY = (sessionId: string) =>
  ["my_rating_for_session", sessionId] as const;

export const RATING_AGGREGATE_MIN_SAMPLE = 3;

export interface UserRatingSummary {
  avg_stars: number | null;
  rating_count: number;
}

export async function getUserRatingSummary(
  userId: string,
): Promise<UserRatingSummary> {
  const { data, error } = await supabase.rpc("user_rating_summary", {
    p_user_id: userId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return {
    avg_stars: row?.avg_stars != null ? Number(row.avg_stars) : null,
    rating_count: row?.rating_count ?? 0,
  };
}

export interface MyRatingForSession {
  id: string;
  stars: number;
  comment: string | null;
  created_at: string;
}

export async function getMyRatingForSession(
  sessionId: string,
): Promise<MyRatingForSession | null> {
  const { data, error } = await supabase.rpc("my_rating_for_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    id: row.id,
    stars: row.stars,
    comment: row.comment ?? null,
    created_at: row.created_at,
  };
}

export async function submitSessionRating(input: {
  sessionId: string;
  rateeId: string;
  stars: number;
  comment?: string | null;
}): Promise<SessionRating> {
  if (input.stars < 1 || input.stars > 5) {
    throw new Error("Stars must be between 1 and 5.");
  }
  const { data: session } = await supabase.auth.getSession();
  const raterId = session.session?.user.id;
  if (!raterId) throw new Error("Not signed in.");

  const trimmedComment = input.comment?.trim();
  const comment =
    trimmedComment && trimmedComment.length > 0 ? trimmedComment : null;

  const { data, error } = await supabase
    .from("session_ratings")
    .insert({
      session_id: input.sessionId,
      rater_id: raterId,
      ratee_id: input.rateeId,
      stars: input.stars,
      comment,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
