/**
 * Mane Line — emergency keyword list (Phase 4.5 guardrail).
 *
 * Source of truth for the /api/chat short-circuit. The server-side
 * match in worker/chat.js is authoritative; the SPA (Phase 4.5) will
 * import this same module for the instant-UX pre-check on submit.
 *
 * Human-readable documented version lives at
 * `supabase/seed/phase4_emergency_keywords.txt` (starter list,
 * Cedric + SLH review before Phase 4 sign-off).
 *
 * Match rules:
 *   - case-insensitive
 *   - whole-substring (a keyword like "blood" triggers on "bloody nose",
 *     which is by design — lean toward false positives for safety)
 *   - phrases with spaces match verbatim ("down and can't get up")
 */
export const EMERGENCY_KEYWORDS = Object.freeze([
  // Catastrophic / seek-vet-now
  'colic',
  'colicky',
  'not breathing',
  "can't breathe",
  'cant breathe',
  'choke',
  'choking',
  'tying up',
  'tied up',
  'tying-up',
  'exertional rhabdo',
  'azoturia',
  "down and can't get up",
  'down and cant get up',
  "can't stand",
  'cant stand',
  "won't stand up",
  'blood',
  'bleeding',
  'bleeding out',
  'hemorrhage',
  'seizure',
  'seizing',
  'convulsing',
  'convulsion',
  // Foaling / neonatal
  'foal not nursing',
  "foal won't nurse",
  'foal wont nurse',
  'newborn foal',
  'red bag',
  'dystocia',
  'retained placenta',
  // Acute pain / neuro
  'staggering',
  'falling over',
  'head pressing',
  'circling',
  'paralyzed',
  "can't move hind",
  'cant move hind',
  'compound fracture',
  'bone sticking out',
  // Severe GI / respiratory
  'projectile vomit',
  'projectile vomiting',
  'severe diarrhea',
  'bloody stool',
  'bloody manure',
  'gasping',
  'struggling to breathe',
  'blue gums',
  'white gums',
  // Trauma
  'hit by car',
  'hit by vehicle',
  'fell through',
  'impaled',
  'gored',
  'kicked in the head',
  'unconscious',
  'unresponsive',
]);

/**
 * Returns the first matching keyword, or null. Lowercases input once.
 */
export function matchEmergencyKeyword(text) {
  if (typeof text !== 'string' || !text) return null;
  const haystack = text.toLowerCase();
  for (const kw of EMERGENCY_KEYWORDS) {
    if (haystack.includes(kw)) return kw;
  }
  return null;
}
