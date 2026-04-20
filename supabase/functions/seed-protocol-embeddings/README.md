# seed-protocol-embeddings

Phase 4.2 Edge Function. Embeds `public.protocols` rows whose
`embed_status='pending'` via the Worker (`/api/protocols/embed-index`),
upserting the resulting 768-dim vectors into the `maneline-protocols`
Vectorize index.

## Flow

1. Select up to 20 pending protocols (`embed_status='pending'`,
   `archived_at is null`).
2. Compose the embedding input from
   `number + name + description + use_case + body_md + keywords`.
3. POST each row to the Worker's `/api/protocols/embed-index`
   (shared `X-Internal-Secret` header). The Worker runs Workers AI
   `@cf/baai/bge-base-en-v1.5`, then `env.VECTORIZE_PROTOCOLS.upsert`.
4. Flip `embed_status` to `synced` (on 200) or `failed` (on error),
   stamp `embed_synced_at`. Insert one `seed_run_log` row per
   protocol with the outcome.

## Drift mode

Callers can `POST {"mode":"drift"}` to first flip any
`embed_status='synced'` row whose `updated_at > embed_synced_at`
back to `pending`, then run the normal embed pass. This keeps
the index honest when protocol copy is edited in Supabase. The
hourly pg_cron uses drift mode.

## Environment

| Secret | Source | Purpose |
|---|---|---|
| `SUPABASE_URL` | auto | REST / PostgREST base |
| `SUPABASE_SERVICE_ROLE_KEY` | auto | admin reads + writes |
| `MANELINE_WORKER_URL` | `supabase secrets set` | e.g. `https://maneline.co` |
| `WORKER_INTERNAL_SECRET` | `supabase secrets set` | matches Worker's env of same name |

Deploy with:

```bash
npx supabase functions deploy seed-protocol-embeddings --no-verify-jwt
```

`--no-verify-jwt` because the call-site is pg_cron (no JWT) + an
ops-only manual trigger; the Worker-side route does its own
`X-Internal-Secret` gate.

## pg_cron schedule

Hourly drift-check + new-row sync. Run once in Cedric's SQL Editor
after the function is first deployed:

```sql
select cron.schedule(
  'seed-protocol-embeddings-hourly',
  '7 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.settings.edge_url') || '/functions/v1/seed-protocol-embeddings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('mode','drift')
    );
  $$
);
```

(`app.settings.edge_url` + `app.settings.service_role_key` are
the same postgres_settings pattern `nightly-backup` uses — set
once per project.)

## One-shot manual trigger

```bash
curl -X POST \
  "https://${PROJECT}.supabase.co/functions/v1/seed-protocol-embeddings" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "content-type: application/json" \
  -d '{}'
```

## Verification

After the first run:

```sql
select count(*) filter (where embed_status='synced')  as synced,
       count(*) filter (where embed_status='pending') as pending,
       count(*) filter (where embed_status='failed')  as failed
from public.protocols;

select run_id, count(*) filter (where status='synced')  as synced,
                   count(*) filter (where status='failed') as failed
from public.seed_run_log
group by run_id
order by max(created_at) desc
limit 5;
```

Then poke the index directly:

```bash
npx wrangler vectorize query maneline-protocols \
  --vector='[…768 floats…]' --top-k=3
```
