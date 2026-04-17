# TECH_DEBT marker convention

## What it is

When we knowingly ship a shortcut, hardcode, placeholder, or deferred
follow-up, we annotate the exact spot in source with a grep-friendly marker:

```
TECH_DEBT(<phase>): <one-line description>
```

Examples:

```ts
// TECH_DEBT(phase-1): replace with generated types once supabase CLI is wired.
```

```sql
-- TECH_DEBT(phase-5): admin RLS policies; replace with service-role worker path.
```

```js
// TECH_DEBT(phase-4): Google Apps Script payloads are unsigned — add HMAC
// once we have write access to the script project.
```

## Why this convention

1. **Greppable.** `grep -rn "TECH_DEBT"` across the repo gives a complete,
   sortable list of outstanding shortcuts. We can't scatter TODO / XXX / FIXME
   without losing signal among third-party dependencies' own comments.
2. **Phase-tagged.** Every marker carries the phase by which the debt must
   be paid. Phase gates can fail the release if any marker tagged with a
   prior phase is still present.
3. **No orphan tickets.** The comment IS the ticket. Anything worth tracking
   separately (design work, UX review) goes in the roadmap doc instead.

## Phase tags

- `phase-0` — must be resolved before Phase 0 is called done
- `phase-1` — owner portal MVP
- `phase-2` — multi-species / dog support
- `phase-3` — vet-share bundles
- `phase-4` — integrations hardening (Apps Script HMAC, etc.)
- `phase-5` — admin portal + service-role migration
- `eventually` — known nice-to-have, no committed phase yet

Use `eventually` sparingly — it's a last resort for real deferral. If you're
tempted to use it for something that will affect compliance or safety, pick
a concrete phase instead.

## What NOT to tag

- In-progress work in a feature branch — use a regular TODO and clean it up
  before merge.
- Style nitpicks — just fix them.
- "Could be faster" optimizations with no current pain — don't tag unless
  a real bottleneck has been measured.

## Current outstanding markers

As of Phase 0 hardening (2026-04-16):

| Tag | Location | Summary |
|---|---|---|
| phase-1 | `app/src/lib/database.types.ts` | Replace hand-rolled types with `supabase gen types` output |
| phase-4 | `supabase-edge/apps-script/*` (future) | Add HMAC signing to Google Apps Script payloads |
| phase-5 | `supabase/migrations/00002_phase0_multirole_foundation.sql` | Admin RLS policies were dropped in 00004; this file's REVISIT block is superseded |

When you add a new marker, also add the row here. When you resolve one,
delete the row in the same commit that removes the marker.
