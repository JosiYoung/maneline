-- =============================================================
-- Migration 00032 — RLS initplan optimization (2026-04-24)
--
-- Addresses the `auth_rls_initplan` advisor (~114 hits) by
-- rewriting every `auth.uid()` reference inside a policy
-- expression to `(select auth.uid())`. The wrapped form is
-- evaluated once per statement via an initplan; the bare form
-- is evaluated once per row. On tables with >1k rows this is
-- the difference between O(1) and O(n) auth-uid lookups per
-- scan.
--
-- Safe because:
--   • `(select auth.uid())` returns the same value as
--     `auth.uid()` — Postgres caches the initplan result.
--   • We only rewrite expressions that currently have the
--     un-wrapped form (LIKE filter excludes already-rewritten).
--   • ALTER POLICY preserves the policy's role set, cmd, and
--     schema-level permissions — we only swap the expressions.
--   • All ALTERs run in one transaction: any syntax failure
--     rolls the whole sweep back.
--
-- Idempotent: re-running is a no-op because the WHERE filter
-- excludes policies whose expressions already contain
-- `(select auth.uid())`.
-- =============================================================

do $$
declare
  r record;
  new_qual text;
  new_check text;
  sql text;
  n_rewritten int := 0;
begin
  for r in
    select pol.polname,
           cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid)       as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid)  as with_check
      from pg_policy pol
      join pg_class cls on cls.oid = pol.polrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
     where ns.nspname = 'public'
       and (
            (pg_get_expr(pol.polqual, pol.polrelid) like '%auth.uid()%'
             and pg_get_expr(pol.polqual, pol.polrelid) not like '%(select auth.uid())%'
             and pg_get_expr(pol.polqual, pol.polrelid) not like '%( SELECT auth.uid() AS uid)%')
         or (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%auth.uid()%'
             and pg_get_expr(pol.polwithcheck, pol.polrelid) not like '%(select auth.uid())%'
             and pg_get_expr(pol.polwithcheck, pol.polrelid) not like '%( SELECT auth.uid() AS uid)%')
           )
  loop
    new_qual  := replace(r.qual,       'auth.uid()', '(select auth.uid())');
    new_check := replace(r.with_check, 'auth.uid()', '(select auth.uid())');

    sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if new_qual is not null then
      sql := sql || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      sql := sql || format(' with check (%s)', new_check);
    end if;

    execute sql;
    n_rewritten := n_rewritten + 1;
  end loop;

  raise notice 'RLS initplan sweep: rewrote % policies', n_rewritten;
end$$;
