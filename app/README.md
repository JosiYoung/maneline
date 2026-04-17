# Mane Line — SPA (`app/`)

The React + TypeScript single-page app served by the Cloudflare Worker at
the repo root. Owner portal (`/app`), Trainer portal (`/trainer`), Silver
Lining admin (`/admin`), and the scoped Vet View (`/vet/:token`) all live
here.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- `react-router-dom` v6 for routing
- `@supabase/supabase-js` for auth + data
- `zustand` for auth state, `@tanstack/react-query` for server state
- `lucide-react` for icons

## Setup (first time)

```bash
cd app
npm install
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` match the values in the
repo-root `wrangler.toml` `[vars]` block. The anon key is safe to expose —
RLS enforces access.

## Scripts

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # Type-check + build to app/dist
npm run preview    # Serve the built dist/ locally
npm run typecheck  # tsc --noEmit, no build
```

## How the Worker serves this

The repo-root `wrangler.toml` has an `[assets]` block pointing at
`./app/dist`:

```toml
[assets]
directory = "./app/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

With `run_worker_first = true`, every request hits `worker.js` first. The
Worker owns `POST /webhook/sheets` and `GET /healthz`; everything else is
delegated to `env.ASSETS.fetch(request)`, which serves the built SPA (with
SPA fallback to `index.html` for client-side routes).

## Deploy flow

Do NOT deploy from `app/` directly. The canonical deploy sequence is:

```bash
# 1. Build the SPA
cd app && npm run build

# 2. Back out and deploy the Worker + assets together
cd .. && npx wrangler deploy
```

This produces a single Cloudflare deployment that serves both the Worker
endpoints and the SPA.

## File layout

```
app/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── .env.example
└── src/
    ├── main.tsx          # React entrypoint + providers
    ├── App.tsx           # Route tree
    ├── vite-env.d.ts
    ├── lib/
    │   ├── supabase.ts   # Supabase client
    │   ├── queryClient.ts
    │   ├── authStore.ts  # Zustand — session + user_profiles row
    │   └── types.ts      # UserProfile, UserRole
    ├── components/
    │   ├── AuthGate.tsx         # Top-level route hinge
    │   ├── ProtectedRoute.tsx   # Role + trainer-pending gate
    │   └── PortalHeader.tsx     # "logged in as {role}" + sign-out
    ├── pages/
    │   ├── Home.tsx             # /
    │   ├── Login.tsx            # /login
    │   ├── Signup.tsx           # /signup
    │   ├── SignupCompleteProfile.tsx  # /signup/complete-profile
    │   ├── CheckEmail.tsx       # /check-email
    │   ├── AuthCallback.tsx     # /auth/callback (magic-link lands here)
    │   ├── VetView.tsx          # /vet/:token
    │   ├── NotFound.tsx
    │   ├── owner/OwnerIndex.tsx       # /app/*
    │   ├── trainer/TrainerIndex.tsx   # /trainer/*
    │   ├── trainer/PendingReview.tsx  # /trainer/pending-review
    │   └── admin/AdminIndex.tsx       # /admin/*
    └── styles/
        ├── index.css     # Tailwind + @theme tokens
        └── brand.md      # Brand placeholder doc — READ ME
```

## Brand

The palette in `src/styles/index.css` is **placeholder** — see
`src/styles/brand.md` for the rules. When Silver Lining Herbs supplies
the canonical Mane Line brand, update both files in the same commit.

**Chrome rule (not a placeholder):** Owner, Trainer, and Vet portals
display "Mane Line" only. Only the Admin portal may show full Silver
Lining Herbs identity.
