-- Schedule the weekly sync for Industry Intelligence
-- (Notion -> public.intelligence_scans + public.industry_intelligence).
-- Companion to 20260502000000_industry_intelligence.sql.
-- Without this, the tables are a one-shot snapshot that must be synced manually.
--
-- Requires extensions pg_cron, pg_net, supabase_vault, and Vault secrets
-- 'project_url' and 'service_role_key' (already seeded by
-- 20260502010000_icp_triggers_cron.sql).

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Vault secret "project_url" is missing. Seed it before applying this migration.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise exception 'Vault secret "service_role_key" is missing. Seed it before applying this migration.';
  end if;
end $$;

-- Idempotent: drop any prior version of the job before re-creating.
select cron.unschedule('sync-intelligence-weekly')
where exists (select 1 from cron.job where jobname = 'sync-intelligence-weekly');

-- pg_cron schedules are in UTC. 10:00 UTC Monday == 6am EDT (summer) / 5am EST (winter).
-- Runs before the morning triage so fresh signals are available to the QB.
select cron.schedule(
  'sync-intelligence-weekly',
  '0 10 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-intelligence',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
