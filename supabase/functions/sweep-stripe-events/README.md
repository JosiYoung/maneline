# sweep-stripe-events

Supabase Edge Function that runs every 5 minutes to catch any Stripe
events the Worker's `/api/stripe/webhook` missed. Plan:
`docs/phase-2-plan.md` Prompt 2.8, §6 resolved decision #3.

## Deploy

```bash
supabase functions deploy sweep-stripe-events
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  MANELINE_WORKER_URL=https://mane-line.<your-sub>.workers.dev
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

## Schedule (pg_cron)

Supabase's dashboard "Schedules" tab is gone, so use SQL Editor:

```sql
-- once:
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- replace <PROJECT_REF> and make sure the service_role key is set as a
-- Vault secret named 'service_role_key' OR hard-code it below (not ideal).
select cron.schedule(
  'sweep-stripe-events',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sweep-stripe-events',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' ||
                     (select decrypted_secret
                      from vault.decrypted_secrets
                      where name = 'service_role_key'),
                   'content-type', 'application/json'
                 ),
      body    := '{}'::jsonb
    );
  $$
);
```

Verify: `select * from cron.job where jobname = 'sweep-stripe-events';`

## Local smoke test

```bash
supabase functions serve sweep-stripe-events --env-file .env
curl -X POST http://localhost:54321/functions/v1/sweep-stripe-events \
  -H "Authorization: Bearer <anon or service role>"
```

## Behavior

- **Leg 1 (backfill):** reads the newest `received_at` from
  `stripe_webhook_events`, asks Stripe for `created[gte]` since that
  timestamp (with a 60s lookback), POSTs each new event to the
  Worker's `/api/stripe/sweep/process` endpoint.
- **Leg 2 (retry):** finds rows where `processed_at is null`,
  `received_at < now() - 5min`, and `processing_attempts < 5`, then
  re-POSTs their `payload` to the same Worker endpoint.

The Worker owns all mutation logic — this function is discovery +
dispatch only.
