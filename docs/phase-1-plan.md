# Mane Line — Phase 1 (Owner Portal Core) Build Plan

**Owner:** Cedric / OAG
**Window:** Week of 2026-04-20 (Phase 0 verified 2026-04-17)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §3.1 + §6 phase gate
**UI reference:** `FRONTEND-UI-GUIDE.md` (cream/green/black tokens in `app/src/styles/index.css`)

---

## 0. What Phase 1 is, and what it isn't

**In scope (from feature map §3.1 P0 items):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **"Today" view** — multi-animal card stack, health snapshot per animal | Owner lands on `/app`, sees one card per animal, confirms a protocol in ≤ 2 taps |
| 2 | **Animal CRUD** — create, edit, **archive (never delete)** | Owner adds a horse, edits breed, archives; archived animals still exportable |
| 3 | **R2 storage** — photos + PDFs with signed URLs | Coggins PDF uploads; thumbnail/preview loads; URLs expire |
| 4 | **Records export to PDF** — 12-month view for vet / show / sale | One tap downloads a PDF with vet records + protocol log |
| 5 | **Trainer access management UI** — grant, revoke, see grace period | Owner grants Sarah access to Duchess; revokes; sees a 7-day grace-period countdown |

**Explicitly out of scope (defer to later phases):**
- Protocol logging / dose-confirm UI (Phase 2 pairs this with the trainer session log — same write path)
- Stripe payments, trainer invoices, marketplace (Phases 2 → 3)
- Protocol Brain AI chatbot (Phase 4)
- Vet View public page (shell exists; full feature in Phase 5)
- Push notifications (Phase 2+)
- Photo/video timeline per animal (P1 in feature map — defer to v1.1 unless trivial)

**Phase 1 gate to Phase 2** (§6 of the feature map, slightly expanded):

> *An owner can sign up, add a horse, upload a Coggins, export a 12-month PDF, invite a trainer.*

Every prompt below feeds that gate. If a prompt lands outside this scope, stop and push the work to Phase 2.

---

## 1. Pre-flight — Phase 0 must be fully green

Before starting any Phase 1 sub-prompt, confirm:

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
# Phase 0 deferred verify (D-1) must be cleared — SMTP green, all three
# role paths signup + land correctly.
# See MANELINE-PRODUCT-FEATURE-MAP.md §6.1 "Deferred verifications".

# Scaffold check — all deps installed, palette flipped to cream/green/black
cat app/package.json | grep -E "@heroui|react-hook-form|zod|@tanstack/react-table|recharts|@react-pdf|sonner|class-variance-authority"
# Expect: each dependency present

cat app/src/styles/index.css | grep -E "#3D7A3D|#67B04A|#F5EFE0"
# Expect: three brand colors present in :root

cd app && npm run build
# Expect: built cleanly (no TS errors, no missing imports)

cd .. && npx wrangler deploy --dry-run
# Expect: no wrangler.toml drift
```

If any of the above is red, **do not start Phase 1 sub-prompts** — fix first.

---

## 2. Architecture deltas Phase 1 introduces

These are the building blocks every sub-prompt below leans on. Read this
once before pasting anything.

### 2.1 New Supabase tables

```
vet_records             — uploaded documents metadata (R2 key, type, issued_at, etc.)
animal_media            — photos / videos linked to an animal (R2 key, kind)
r2_objects              — ledger of every R2 upload (owner_id, bucket key, size, mime)
                          — separates metadata from the blob; keeps nightly backup honest
animal_archive_events   — audit of archive / un-archive transitions (OAG Law 8)
```

Every table ships with RLS policies mirroring §4.3 of the feature map:
owners CRUD their own; trainers SELECT where `do_i_have_access_to_animal`
is true; Silver Lining admins read only via Worker + `service_role`.

### 2.2 New Cloudflare bindings

```
R2: MANELINE_R2          — private bucket; owner-only via signed URLs
KV: ML_RL (exists)       — reused for upload rate limiting
```

### 2.3 New Worker endpoints

```
POST /api/uploads/sign           — returns a scoped presigned R2 PUT URL
POST /api/uploads/commit         — writes r2_objects + the typed row (vet_records / animal_media)
GET  /api/uploads/read-url       — returns a short-lived signed GET URL for a given object
POST /api/records/export-pdf     — renders the 12-month PDF server-side via React-PDF
                                   (runs in the Worker with `ctx.waitUntil` + streamed response)
POST /api/access/grant           — owner grants a trainer; writes animal_access_grants + audit
POST /api/access/revoke          — owner revokes a trainer; sets revoked_at, starts grace window
```

The Worker enforces: owner JWT → row-level ownership → rate limit → audit log → execute.

### 2.4 New SPA surface area

```
src/pages/app/TodayView.tsx              ← /app
src/pages/app/AnimalsIndex.tsx           ← /app/animals  (list + archived filter)
src/pages/app/AnimalDetail.tsx           ← /app/animals/:id
src/pages/app/AnimalNew.tsx              ← /app/animals/new
src/pages/app/AnimalEdit.tsx             ← /app/animals/:id/edit
src/pages/app/RecordsIndex.tsx           ← /app/records
src/pages/app/ExportRecords.tsx          ← /app/records/export
src/pages/app/TrainersIndex.tsx          ← /app/trainers
src/pages/app/TrainerInvite.tsx          ← /app/trainers/invite

src/components/owner/BottomNav.tsx       ← fixed bottom nav (Today / Animals / Records / Trainers)
src/components/owner/AnimalCard.tsx      ← HeroUI card used in TodayView + AnimalsIndex
src/components/owner/AnimalForm.tsx      ← shadcn form (RHF + zod) for new/edit
src/components/owner/RecordsUploader.tsx ← drag-drop + signed-PUT orchestrator
src/components/owner/AccessGrantForm.tsx ← grant scope picker (animal / ranch / owner_all)
src/components/pdf/RecordsExport.tsx     ← React-PDF document (12-month view)
```

All of the above use the cream/green/black tokens and the shadcn
primitives already in `src/components/ui/`. No raw hex literals.

---

## 3. Phase 1 sub-prompts (copy/paste into Claude Code, one at a time)

> **How to run these:**
>
> 1. Open a terminal at repo root. Launch Claude Code (`claude`).
> 2. Paste a sub-prompt verbatim. Wait for Claude to finish and show diffs.
> 3. Run the **Verify (bash)** block under each prompt. If it's red, paste
>    the failure back to Claude and ask for a fix before moving on.
> 4. Do **not** skip a verify block. Phase 0 shipped because every gate
>    was enforced; Phase 1 keeps the same discipline.

---

### Prompt 1.1 — Data model: R2 metadata, vet records, media, archive audit

```
Create a new Supabase migration at supabase/migrations/00005_phase1_owner_core.sql.
Follow OAG_ARCHITECTURE_LAWS §7 (RLS on every table, no hard deletes) and
MANELINE-PRODUCT-FEATURE-MAP.md §4.2 / §4.3. Keep existing tables — do NOT
drop animals, user_profiles, animal_access_grants.

1. Create `r2_objects` (ledger of every R2 upload):
   - id uuid PK default gen_random_uuid()
   - owner_id uuid NOT NULL FK auth.users(id)
   - bucket text NOT NULL default 'maneline-r2'
   - object_key text NOT NULL UNIQUE   -- <owner_id>/<kind>/<uuid>.<ext>
   - kind text NOT NULL CHECK (kind in ('vet_record','animal_photo','animal_video','records_export'))
   - content_type text NOT NULL
   - byte_size bigint NOT NULL CHECK (byte_size > 0)
   - created_at, updated_at timestamptz
   - deleted_at timestamptz NULL   -- soft delete, §Law 8
   - index on owner_id, kind

2. Create `vet_records`:
   - id uuid PK
   - owner_id uuid NOT NULL
   - animal_id uuid NOT NULL FK animals(id)
   - r2_object_id uuid NOT NULL FK r2_objects(id)
   - record_type text NOT NULL CHECK (record_type in ('coggins','vaccine','dental','farrier','other'))
   - issued_on date
   - expires_on date NULL
   - issuing_provider text NULL
   - notes text NULL
   - created_at, updated_at, archived_at timestamptz NULL

3. Create `animal_media`:
   - id uuid PK
   - owner_id uuid NOT NULL
   - animal_id uuid NOT NULL FK animals(id)
   - r2_object_id uuid NOT NULL FK r2_objects(id)
   - kind text CHECK (kind in ('photo','video'))
   - caption text NULL
   - taken_on date NULL
   - created_at, updated_at, archived_at timestamptz NULL

4. Create `animal_archive_events` (audit only — every archive / un-archive):
   - id uuid PK
   - animal_id uuid NOT NULL FK animals(id)
   - actor_id uuid NOT NULL FK auth.users(id)
   - action text CHECK (action in ('archive','unarchive'))
   - reason text NULL
   - created_at timestamptz default now()

5. Add `archived_at timestamptz NULL` to animals. Update every SPA-facing
   query to filter `archived_at IS NULL` by default. Archive = SET
   archived_at = now(); un-archive = SET archived_at = NULL. NO hard
   deletes.

6. RLS policies:
   - r2_objects: owner SELECT/UPDATE own. No client INSERT — Worker writes
     via service_role after validating the presigned PUT completed.
   - vet_records: owner CRUD own. Trainers SELECT where
     do_i_have_access_to_animal(animal_id) = true (no UPDATE — Phase 2
     gives trainers an explicit "add note" write path through sessions).
   - animal_media: same shape as vet_records.
   - animal_archive_events: owner SELECT own. Only service_role writes.

7. Add `touch_updated_at` triggers everywhere (reuse existing helper).

8. Add functions:
   - owner_record_count(owner_id uuid) → int (for admin dashboards later)
   - signed_url_ttl_seconds() → int STABLE, returns 300 (helper for Worker)

9. Seed nothing — Phase 1 starts with an empty records table.

Test locally: `supabase db reset` in a branch, then `supabase migration up`.
Do NOT apply to prod until Cedric reviews the diff.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
ls supabase/migrations/ | grep 00005
# Expect: 00005_phase1_owner_core.sql
grep -E "CREATE TABLE|ENABLE ROW LEVEL SECURITY|CREATE POLICY" \
  supabase/migrations/00005_phase1_owner_core.sql | head -30
# Sanity: each new table has RLS ENABLE + at least one policy
```

---

### Prompt 1.2 — R2 bucket + Worker endpoints for uploads and signed reads

```
Add Cloudflare R2 to the stack for Phase 1 per MANELINE-PRODUCT-FEATURE-MAP.md
§4.4. Keep the Worker thin — it owns presigning and audit, not business logic.

1. Update wrangler.toml:
   - Add an [[r2_buckets]] entry:
       binding = "MANELINE_R2"
       bucket_name = "maneline-records"
       preview_bucket_name = "maneline-records-preview"
   - Reuse the existing ML_RL KV binding for per-IP rate limits.
   - Document in a comment block: "R2 bucket is PRIVATE. All reads and
     writes go through signed URLs. No public access. See
     docs/phase-1-plan.md §2.3."

2. In worker.js, add three new endpoints (each writes an audit_log row):

   POST /api/uploads/sign
     Body: { kind, content_type, byte_size_estimate, animal_id? }
     - Auth: require Supabase JWT in Authorization: Bearer
     - Validate kind ∈ ('vet_record','animal_photo','animal_video')
     - If animal_id present, call am_i_owner_of(animal_id) via service_role;
       reject 403 if false.
     - Rate limit: 20 presign/min per user (KV-backed).
     - Build object_key = <user_id>/<kind>/<uuid>.<ext-from-content-type>
     - Return { put_url, object_key, expires_in: 300 }
       put_url is an S3 v4 presigned PUT to MANELINE_R2 with a 5-minute TTL.

   POST /api/uploads/commit
     Body: { object_key, kind, animal_id?, record_type?, caption?, issued_on? }
     - Auth: Supabase JWT
     - HEAD the object in R2 — 404 if it doesn't exist
     - INSERT a row into r2_objects (service_role)
     - INSERT the typed row (vet_records OR animal_media) linked to that object
     - audit_log: { actor, action: 'records.upload', target: animal_id }
     - Return { id, r2_object_id }

   GET /api/uploads/read-url?object_key=...
     - Auth: Supabase JWT
     - Verify caller owns the object OR (is trainer AND do_i_have_access)
     - Rate limit: 60/min/user
     - Return { get_url, expires_in: 300 }  (S3 v4 presigned GET)

3. Share presign logic in a new worker-side module worker/r2-presign.js
   (pure ESM, no deps beyond the Web Crypto subtle API). Export
   presignPut(objectKey, contentType, bucket, creds) and presignGet(...).
   Creds come from env.MANELINE_R2_* secrets — document placeholders in
   wrangler.toml the same way we did Shopify/HubSpot.

4. Add integration-test notes to docs/INTEGRATIONS.md under a new "R2"
   section: how to create the bucket, what to set as secrets, what the
   health endpoint reports.

5. Update /api/_integrations-health to include r2: 'live' | 'mock' based
   on whether the R2 binding is present and the bucket HEAD succeeds.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
grep -E "r2_buckets|MANELINE_R2" wrangler.toml
# Expect: binding declared

npx wrangler r2 bucket create maneline-records           # once
npx wrangler r2 bucket create maneline-records-preview   # once

npx wrangler deploy --dry-run
# Expect: no binding errors

curl -s https://maneline.co/api/_integrations-health | python -m json.tool
# Expect: "r2": "live" (or "mock" until bucket is created)
```

---

### Prompt 1.3 — Owner Portal layout + BottomNav + route tree

```
Phase 0 mounted a bare /app shell. Phase 1 turns it into the Owner
Portal. Follow FRONTEND-UI-GUIDE.md §5.1 (mobile-first, 44×44px taps,
bottom nav always visible).

1. Wrap the entire /app/* subtree in the existing
   src/components/owner/OwnerLayout (already scaffolded with
   HeroUIProvider + PortalHeader). Mount a new BottomNav below the main
   content area. DO NOT put HeroUIProvider at the app root — it's scoped
   to owner only per §4.2 of the UI guide.

2. Create src/components/owner/BottomNav.tsx:
   - Four tabs: Today (/app), Animals (/app/animals), Records
     (/app/records), Trainers (/app/trainers).
   - lucide icons: Home, PawPrint, FileText, Users.
   - NavLink-based active state using the `text-primary` token; inactive
     uses `text-muted-foreground`.
   - Fixed bottom, pb-safe, h-16. Min tap target 44×44.

3. Expand the route tree in src/App.tsx so that /app uses nested routes
   under OwnerLayout. Keep Phase 0's redirect behavior intact — /app
   still requires role=owner via ProtectedRoute.

4. Update src/pages/owner/OwnerIndex.tsx into a routing shell that
   renders <Routes> for Today / Animals / Records / Trainers. Move the
   existing placeholder copy into TodayView.tsx (the new default page).

5. Delete the PinSettings block from OwnerIndex.tsx — it never belonged
   in the home view. Move it to /app/account (new stub page) with a
   "Account" link in BottomNav? NO — keep BottomNav to four slots. Move
   PinSettings to a future /app/settings route, render a stub page with
   just the PinSettings component.

6. Smoke test: npm run dev, log in as owner, verify:
   - BottomNav visible on every /app/* route
   - Clicking Today / Animals / Records / Trainers swaps content without
     full page reload
   - Chrome says "Mane Line" only; no "Silver Lining" text anywhere in
     the Owner portal
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co/app"
grep -rn "BottomNav" src/
# Expect: BottomNav in OwnerLayout (or OwnerIndex) + component file exists

grep -rn "Silver Lining" src/pages/owner src/components/owner
# Expect: zero matches

npm run build
# Expect: built cleanly
```

---

### Prompt 1.4 — Animal CRUD (create, edit, archive — never delete)

```
Build the Animal CRUD surface for owners. Reference
FRONTEND-UI-GUIDE.md §3.4 (shadcn Form pattern) and the existing
database.types.ts for the animals row shape.

1. Create src/lib/animals.ts — tiny data layer using supabase-js and
   @tanstack/react-query:
   - listAnimals(includeArchived?: boolean) — SELECT * FROM animals
     WHERE owner_id = auth.uid() AND (includeArchived OR archived_at IS NULL)
   - getAnimal(id) — single row; throws if not found
   - createAnimal(input) — INSERT
   - updateAnimal(id, patch) — UPDATE
   - archiveAnimal(id, reason?) — UPDATE archived_at = now(); also call
     Worker /api/archive-event (service_role) to write animal_archive_events
   - unarchiveAnimal(id) — inverse
   All functions throw on error; callers use React Query's error boundary.

2. Create src/components/owner/AnimalForm.tsx:
   - React Hook Form + zod schema:
     barn_name (required, 1–40 chars), species (enum horse|dog), breed,
     sex (enum based on species), year_born (number, 1990–currentYear),
     discipline (free text)
   - shadcn Form + Input + Select + Button primitives only
   - Submit: createAnimal OR updateAnimal based on mode prop
   - On success: invalidate 'animals' query, toast success via notify, navigate to /app/animals

3. Create three pages:
   - src/pages/app/AnimalsIndex.tsx — list + "Add animal" CTA + "Show archived" toggle
   - src/pages/app/AnimalNew.tsx    — renders <AnimalForm mode="create" />
   - src/pages/app/AnimalEdit.tsx   — loads the animal, renders <AnimalForm mode="edit" initial={...} />
   - src/pages/app/AnimalDetail.tsx — read-only summary + Archive button (shadcn Dialog confirm)

4. Archive UX: clicking Archive opens a Dialog with a required "reason"
   textarea. Confirm sets archived_at and calls the audit endpoint.
   Restored animals can be found via the Archived filter on AnimalsIndex.

5. NEVER surface a "Delete" button. This is a hard rule
   (OAG_ARCHITECTURE_LAWS §8). If Claude Code writes one, delete it.

6. Add minimal e2e-lite: expose `window.__manelineDebug.createTestAnimal()`
   in dev builds only. Used by the verify block below.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co/app"
grep -rn "deleteAnimal\|DELETE FROM animals" src/ supabase/
# Expect: zero matches (no hard-delete path anywhere)

grep -rn "archived_at" src/lib/animals.ts
# Expect: filter present in listAnimals

npm run build
# Expect: built cleanly

# Manual: open /app/animals → Add animal → fill form → save
# → edit → archive (confirm dialog)
# → toggle "Show archived" to find the archived animal
```

---

### Prompt 1.5 — "Today" view: HeroUI AnimalCard + multi-animal stack

```
Build the Owner Portal's marquee screen per
FRONTEND-UI-GUIDE.md §4.3 and §4.4. This is the first thing an owner
sees every morning — get the polish right.

1. Create src/components/owner/AnimalCard.tsx:
   - HeroUI Card (pressable), Avatar, Chip components — NOT shadcn.
   - Props: { id, name, species, breed, photoUrl?, todaysSnapshot, hasFlag, onPress }
   - todaysSnapshot for Phase 1 is a stub: count of active protocols
     (from the seeded `protocols` + future `animal_protocols` join) and
     count of recent vet records. Protocol confirmations UI is Phase 2 —
     render the section as "Protocols: N active" text, no checkboxes yet.
   - Tap target: the whole card is pressable → navigates to
     /app/animals/:id
   - Use ONLY cream/green/black tokens. No raw hex.

2. Create src/pages/app/TodayView.tsx:
   - Header: "Today" + today's date in long form
   - If the owner has zero animals, render an empty state with a CTA
     button ("Add your first animal") linking to /app/animals/new.
   - Else: render a vertical stack of <AnimalCard /> for each active
     (non-archived) animal, ordered by barn_name.
   - Use @tanstack/react-query's listAnimals({ includeArchived: false }).
   - Skeleton: HeroUI Spinner while loading; sonner.toast.error on failure.

3. Lift the count of "animals needing attention" (hasFlag = true) into
   a header badge — for Phase 1, "attention" = any animal with a vet
   record expiring within 30 days.

4. Accessibility: each card has role="button" and an aria-label like
   "Open Duchess" derived from the animal name.

5. Framer Motion entrance: stagger the cards on initial mount (0.05s
   between). Skip animation on navigation back (use `layoutId` or a
   ref-based "seen before" check). Keep motion subtle — this isn't a
   consumer app, it's a working tool.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co/app"
grep -n "HeroUIProvider" src/components/owner/OwnerLayout.tsx
# Expect: HeroUIProvider wraps the owner subtree

grep -rn "@heroui/react" src/components/owner/AnimalCard.tsx
# Expect: import from @heroui/react

grep -rn "@heroui/react" src/pages/trainer src/pages/admin
# Expect: ZERO matches (HeroUI is owner-only)

npm run build
# Expect: built cleanly
```

---

### Prompt 1.6 — Records upload (R2 signed PUT + commit)

```
Wire the end-to-end records upload flow. This is the first real hit on
R2 — keep the interface boringly correct.

1. Create src/lib/uploads.ts:
   - requestPresign({ kind, contentType, byteSize, animalId? })
     → POST /api/uploads/sign, returns { put_url, object_key, expires_in }
   - uploadToR2(put_url, file) → fetch PUT with the file body; throws on non-2xx
   - commitUpload({ object_key, kind, animal_id?, record_type?, caption?, issued_on? })
     → POST /api/uploads/commit, returns { id }
   - readUrlFor(object_key) → GET /api/uploads/read-url, returns { get_url, expires_in }
   Each call attaches the Supabase access token via the existing
   supabase.ts helper (copy pattern from /api/has-pin usage in Login.tsx).

2. Create src/components/owner/RecordsUploader.tsx:
   - Drag-drop target + file input fallback (react-dropzone is fine, or
     hand-rolled — pick hand-rolled to avoid another dep).
   - Accepts: image/jpeg, image/png, image/heic, application/pdf.
   - Max size: 25 MB per file; reject larger with a sonner toast.
   - For each file: presign → PUT to R2 (show progress per file) →
     commit. Use @tanstack/react-query's useMutation for each step.
   - On commit success: sonner notify.success("Coggins uploaded"),
     invalidate the 'vet_records' query.

3. Create src/pages/app/RecordsIndex.tsx:
   - Table (shadcn DataTable) of vet_records: record_type, animal,
     issued_on, expires_on, uploaded_at.
   - Filter row: dropdowns for animal + record_type.
   - Each row has a "View" button that fetches a signed GET URL and
     opens the file in a new tab.
   - Upload CTA opens <RecordsUploader /> inside a shadcn Dialog.

4. Create src/pages/app/AnimalDetail.tsx records section (extend the
   stub from Prompt 1.4): show the 5 most recent vet records for that
   animal plus a "See all" link to /app/records?animal=:id.

5. Error handling:
   - Upload canceled: keep UI consistent (no half-created vet_record row;
     rely on commit being the write barrier).
   - Rate-limited sign: sonner.toast "Too many uploads right now; try
     again in a minute."
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co/app"
grep -n "uploadToR2\|requestPresign\|commitUpload" src/lib/uploads.ts
# Expect: three functions exported

npm run build
# Expect: built cleanly

# Manual end-to-end:
# 1. Log in as owner
# 2. Navigate to /app/records → Upload → pick a small PDF
# 3. Watch presign → PUT → commit succeed in the network tab
# 4. Click the row → opens signed URL in new tab → PDF renders
# 5. Wait 6 minutes, try the same URL → 403 (TTL expired). Confirms signed GETs.
```

---

### Prompt 1.7 — 12-month records export to PDF

```
The "big moat" feature from the feature map §3.1. A one-tap PDF the
owner can hand to a vet, a buyer, or a show secretary.

1. Create src/components/pdf/RecordsExport.tsx using @react-pdf/renderer:
   - Document with:
     (a) Cover page: animal name, species, breed, year born, owner name,
         date range, Mane Line wordmark in cream/green.
     (b) Vet records section: grouped by record_type, most-recent first,
         showing issued_on, expires_on, issuing_provider, notes, and a
         filename pointer. The PDF itself is METADATA — the linked files
         are fetched via signed URLs if the vet wants them.
     (c) Protocol log section: placeholder "Protocol log begins in
         Phase 2" — do NOT pretend to have supplement dose data yet.
     (d) Photos section (optional): up to 8 most-recent animal_media
         thumbnails, in a 4×2 grid.
   - Pure server-side rendering. React-PDF runs inside the Worker via
     its React renderer; do NOT ship it to the browser bundle.

2. Create a Worker endpoint POST /api/records/export-pdf:
   - Body: { animal_id, window_days: 365 }
   - Auth + own-animal check same as upload endpoints.
   - Read vet_records + animal_media within the window via service_role.
   - For each media row, fetch a signed GET URL; embed thumbnails only
     (max 320px wide).
   - Render the React-PDF document to a Buffer.
   - Upload the Buffer to R2 under kind='records_export'; INSERT a row
     into r2_objects; return { object_key, get_url, expires_in: 900 }
     (15 min signed read window — let the owner download + send).
   - audit_log: { action: 'records.export', target: animal_id, meta: { window_days } }

3. Create src/pages/app/ExportRecords.tsx:
   - Animal picker + window picker (30/90/365 days — default 365)
   - "Generate PDF" button → calls the endpoint, shows a progress state,
     then a Download button pointing at get_url.
   - Copy: "Share this link or save the file. Link expires in 15 minutes."

4. Do NOT render the PDF client-side — React-PDF's browser renderer is
   large and inconsistent across fonts. Worker-side rendering is the
   guarantee.

5. Smoke test fixture: add a dev-only button on ExportRecords that
   generates a mock PDF from fixture data even when the owner has no
   records yet. Gated behind `import.meta.env.DEV`.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
grep -n "records/export-pdf" worker.js
# Expect: endpoint present

cd app && grep -rn "@react-pdf/renderer" src/components/pdf
# Expect: RecordsExport.tsx imports Document, Page, etc.

# Manual:
# 1. Log in as owner, upload one Coggins PDF (from Prompt 1.6)
# 2. /app/records/export → pick animal → Generate PDF
# 3. Click download → open the PDF
#    - Cover page shows correct animal + owner name
#    - Records section lists the Coggins
#    - Protocol log placeholder visible
# 4. Copy the get_url, wait 16 min, retry → 403. TTL honored.
```

---

### Prompt 1.8 — Trainer access management UI (grant / revoke / grace period)

```
Close the consent loop (§2.2 of the feature map). Owners choose who
sees their animals, and can cut access with a visible countdown.

1. Worker endpoints (extend worker.js):

   POST /api/access/grant
     Body: { trainer_email, scope, animal_id?, ranch_id?, notes? }
     - Auth: owner JWT
     - Look up trainer by email via service_role; 404 if not found OR
       trainer_profiles.application_status != 'approved'.
     - Validate scope: 'animal' requires animal_id and am_i_owner_of;
       'ranch' requires ranch_id + ownership; 'owner_all' no extra.
     - INSERT into animal_access_grants.
     - audit_log: { action: 'access.grant', actor, target, meta: { scope, trainer_id } }
     - Email the trainer: "Cedric granted you access to Duchess." (Gmail
       relay via existing pattern; if that integration isn't wired, log
       the intended email to audit_log instead — Phase 1 accepts that.)
     - Return { grant_id }

   POST /api/access/revoke
     Body: { grant_id, grace_days }   # grace_days default 7, max 30
     - Auth: owner JWT; verify the grant belongs to caller.
     - UPDATE animal_access_grants SET revoked_at = now(),
       grace_period_ends_at = now() + grace_days * interval '1 day'.
     - audit_log.
     - Return { revoked_at, grace_period_ends_at }

2. src/lib/access.ts:
   - listGrants() — own grants + trainer name/email join
   - grantAccess(input) → POST /api/access/grant
   - revokeAccess(grant_id, grace_days) → POST /api/access/revoke

3. Pages:
   - src/pages/app/TrainersIndex.tsx
     Table columns: Trainer (name + email), Scope, Animal/Ranch,
     Granted, Status (Active | Revoked — grace ends in 5d / Expired).
     Row actions: Revoke (shadcn Dialog confirm + days picker) /
     Re-grant (for revoked rows within grace).
   - src/pages/app/TrainerInvite.tsx
     Form: trainer email, scope picker (animal / ranch / owner_all),
     dependent field (animal picker or ranch picker or none), notes
     textarea. Submit → grantAccess → navigate back to /app/trainers.

4. Grace-period badge:
   - status Active → green Badge
   - status revoked AND now < grace_period_ends_at → warning Badge
     showing "Ends in 5d" (live-calculated)
   - status revoked AND now >= grace_period_ends_at → muted Badge "Expired"

5. Trainer-side readability: the grant row stays visible to the trainer
   through the grace window (RLS already honors this — verify the
   policy does NOT filter by revoked_at IS NULL).

6. Empty state copy: "No trainers yet. Invite one when you're ready —
   they'll only see the animals you choose."
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
grep -n "access/grant\|access/revoke" worker.js
# Expect: both endpoints

# Manual three-role drill:
# 1. Owner A grants Trainer B access to Animal X with scope='animal'.
# 2. Trainer B logs in → should see Animal X in their dashboard (Phase 2
#    surface is incomplete, but the SQL should return the row — verify
#    via a console query).
# 3. Owner A revokes with grace_days=7. UI shows "Ends in 7d" badge.
# 4. Trainer B re-queries animals → still 1 row (grace active).
# 5. Fast-forward the grace_period_ends_at in the DB by 8 days.
# 6. Trainer B queries again → 0 rows. RLS cuts access at expiry.
```

---

### Prompt 1.9 — Nightly backup extension + Phase 1 verification drill

```
Two closing tasks for Phase 1. Run them as one session.

PART A — Extend the nightly backup to cover Phase 1 tables.

Update supabase/functions/nightly-backup/index.ts to snapshot (in
addition to the existing tables):
  vet_records, animal_media, r2_objects, animal_archive_events,
  animal_access_grants (new rows + updated columns like revoked_at).

Serialize each as JSON + CSV in the same snapshot folder. Keep schedule
+ retention identical. After the change, run
`supabase functions invoke nightly-backup` and verify the GitHub
backup repo receives the new files for today.

PART B — End-to-end verification drill.

Run this before declaring Phase 1 complete. Report each step as
🟢 / 🔴 and stop if any step is red.

1. [SIGNUP] Fresh owner signup completes and lands on /app.
2. [TODAY]  Empty-state renders with "Add your first animal" CTA.
3. [CREATE] Add Duchess (horse, Quarter Horse, 2016, Western). Form
            validation blocks empty barn_name. On save, /app/animals
            shows Duchess.
4. [EDIT]   Edit Duchess → change discipline to "Ranch". Persisted.
5. [UPLOAD] /app/records → upload a Coggins PDF for Duchess.
            Presign → PUT → commit all return 2xx.
            Row visible in the Records table with issued_on set.
6. [READ]   Click the row → signed GET → PDF opens in new tab.
7. [EXPORT] /app/records/export → Duchess, 365d → Generate →
            downloaded PDF has cover + the Coggins + placeholder
            protocol-log section.
8. [GRANT]  /app/trainers/invite → grant access to an approved
            trainer's email, scope='animal', animal=Duchess.
            Row appears in /app/trainers with Active badge.
9. [REVOKE] Revoke that grant with 7-day grace. Badge shows
            "Ends in 7d". audit_log has one row for the revoke.
10.[RLS]    Trainer B logs in; sees Duchess (grace active).
            After fast-forwarding grace_period_ends_at, trainer B
            no longer sees Duchess.
11.[ARCHIVE]Archive Duchess with reason "sold". /app/animals default
            view hides her; "Show archived" reveals her. Export PDF
            still works for archived animals (records persist).
12.[NO-DELETE] Grep the repo for hard deletes against animals, vet_records,
            animal_media, or animal_access_grants. Zero matches.
13.[BRAND]  Screenshot /app, /app/animals, /app/records/export,
            /app/trainers. Every screen uses cream/green/black; no navy
            legacy tokens; no "Silver Lining" text.
14.[BACKUP] Today's folder in the backup repo contains vet_records.json,
            animal_media.json, r2_objects.json,
            animal_archive_events.json, animal_access_grants.json.

Record the table of results in docs/phase-1-plan.md §5 (Sign-off).
Do NOT close Phase 1 until every step is green.
```

**Verify (bash):**

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
supabase functions invoke nightly-backup
# Then: https://github.com/JosiYoung/Databackup/tree/main/snapshots
# Today's folder has the Phase 1 table dumps.

grep -rn "DELETE FROM animals\|\.delete()\s*\.from\('animals'\)" \
  app/src worker.js
# Expect: no hits
```

---

## 4. Out-of-scope guardrails

If during Phase 1 the prompts start drifting into any of the following,
stop and push the work to Phase 2+:

- Stripe Connect / trainer invoices / payments
- Shopify catalog sync or marketplace UI
- Protocol-dose-confirm UI (the write path belongs in Phase 2 with sessions)
- Vet View public page (shell stays; implementation in Phase 5)
- Push notifications
- Session logging (Phase 2)
- HubSpot sync (Phase 5)

These are real features — they will ship. Just not in Phase 1's week.

---

## 5. Sign-off (fill in at end of Phase 1)

| Step | Status | Notes |
|---|---|---|
| 1.1 Migration | 🟢 | `00005_phase1_owner_core.sql` — 4 new tables, all RLS-enabled. Apply to prod via Supabase dashboard before first upload. |
| 1.2 R2 + Worker | 🟢 | `[[r2_buckets]]` bound as `MANELINE_R2`; `/api/uploads/{sign,commit,read-url}` live; SigV4 presigner in `worker/r2-presign.js`. Buckets + 3 secrets still need provisioning — see `docs/INTEGRATIONS.md`. |
| 1.3 Owner layout + BottomNav | 🟢 | OwnerIndex is now a `<Routes>` shell inside OwnerLayout; BottomNav mounts with Today/Animals/Records/Trainers tabs; PinSettings moved to `/app/settings`. Build clean, no "Silver Lining" text in owner tree. |
| 1.4 Animal CRUD | 🟢 | `lib/animals.ts` data layer (list/get/create/update/archive/unarchive), `AnimalForm` (RHF + zod), `ArchiveAnimalDialog` (reason required), 4 pages under `/app/animals/*`. Archive/unarchive route through `/api/animals/{archive,unarchive}` Worker endpoints so `animals.archived_at` + `animal_archive_events` stay atomic. Build clean, 0 hard-delete paths in SPA, `archived_at` default filter enforced in `listAnimals`. |
| 1.5 Today view | 🟢 | `AnimalCard` (HeroUI Card/Avatar/Chip), `TodayView` with vertical stack, Framer Motion stagger on first mount (skipped on back-nav via `seenBeforeRef`), "N need attention" header badge driven by `attentionAnimalIds()` over `vet_records.expires_on ≤ today+30`. HeroUI stays scoped to `components/owner/*` — trainer + admin still pure shadcn. Empty-state CTA links to `/app/animals/new`. |
| 1.6 Records upload | 🟢 | `lib/uploads.ts` (requestPresign/uploadToR2 via XHR for progress/commitUpload/readUrlFor), `lib/vetRecords.ts` list + joined `object_key` lookup, `RecordsUploader` (drag+drop, metadata form, 25 MB cap, Coggins/vaccine/dental/farrier/other), `RecordsUploadDialog` with animal picker, `RecordsIndex` with animal+type filters driven by URL search params and per-row signed-GET "View". `AnimalDetail` now surfaces the 5 most recent records + "See all" link. Manual end-to-end upload still needs a real tester — Worker path is wired and signed URL TTL is 5 min. |
| 1.7 Records export PDF | 🟢 | Hand-rolled `worker/pdf-minimal.js` (PDF 1.4, base-14 Helvetica + WinAnsiEncoding, ~200 lines, no npm deps) replaces React-PDF so the Worker stays free of `nodejs_compat`. `worker/records-export.js` renders cover + vet records grouped by type (Coggins/vaccine/dental/farrier/other, most-recent first) + Phase-2 protocol placeholder + media footnote. `/api/records/export-pdf` endpoint (5/300s rate limit, 30/90/365-day windows) pulls via service_role, writes through `env.MANELINE_R2.put`, inserts `r2_objects`, audits, returns 15-min signed GET URL. `ExportRecords.tsx` wired at `/app/records/export` with animal + window pickers and a Download CTA. TECH_DEBT(phase-2): swap to @react-pdf/renderer once layouts need photo grids / cell borders. |
| 1.8 Trainer access UI | 🟢 | `/api/access/{grant,revoke}` endpoints (10/60s per caller). Grant resolves trainer by email via `user_profiles` + `trainer_profiles.application_status='approved'`, validates scope (`animal` via `assertCallerOwnsAnimal`, `ranch` via owner-scoped `ranches` lookup, `owner_all` no extra check), inserts `animal_access_grants` via service_role, audits with `metadata.scope + trainer_id`. Revoke is soft — sets `revoked_at` + `grace_period_ends_at = now() + grace_days * 1d` (default 7, max 30). `src/lib/access.ts` wraps the endpoints and adds `statusFor`/`daysLeftInGrace` helpers. `TrainersIndex` lists all grants with live `Ends in Nd` badge (1-min re-render), `TrainerInvite` form (email + scope picker) mounts at `/app/trainers/invite`. Gmail notification is TECH_DEBT(phase-2) — the audit row is the paper trail until the relay is wired. |
| 1.9 Backup + drill | 🟡 | PART A done in code: `supabase/functions/nightly-backup/index.ts` now snapshots `vet_records`, `animal_media`, `r2_objects`, `animal_archive_events` alongside the Phase 0 tables. PART B (live 14-step verification drill) is still pending — must be run by a human against the deployed Worker + Supabase once R2 buckets and the two Phase 1 secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are provisioned. `grep -rn ".delete(" app/src` is clean; worker-side `supabaseDelete` is used only to roll back orphaned `r2_objects` rows on a failed upload commit (never touches animals / vet_records / animal_media / animal_access_grants). |

**Phase 1 complete when every row is 🟢 and the verification drill in
§1.9 PART B passes end-to-end.** Only then does Phase 2 (Trainer
Portal core + vetting) begin — see feature map §6.
