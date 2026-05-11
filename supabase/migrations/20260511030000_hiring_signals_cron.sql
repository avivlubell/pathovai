-- Schedule the weekly sync for MedTech Commercial Hiring Signals
-- (Notion -> public.hiring_signals). Companion to 20260511020000_hiring_signals.sql.
-- Without this, the table is a one-shot snapshot frozen at the migration date.
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
select cron.unschedule('sync-hiring-signals-weekly')
where exists (select 1 from cron.job where jobname = 'sync-hiring-signals-weekly');

-- pg_cron schedules are in UTC. 10:30 UTC Monday == 6:30am EDT (summer) / 5:30am EST (winter).
-- Offset 30 min from sync-intelligence (10:00 UTC) to avoid concurrent load.
select cron.schedule(
  'sync-hiring-signals-weekly',
  '30 10 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-hiring-signals',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
