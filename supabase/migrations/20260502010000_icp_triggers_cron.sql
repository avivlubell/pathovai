-- Schedule the daily sync for the ICP Trigger Monitor (Notion -> public.icp_triggers).
-- Companion to 20260424000000_icp_triggers.sql, which created the table but
-- did not register the pg_cron job. Without this, the table is a one-shot
-- snapshot frozen at the migration date.
--
-- Requires extensions pg_cron, pg_net, supabase_vault, and Vault secrets
-- 'project_url' and 'service_role_key' to be present. Seed them once via the
-- Supabase SQL editor (do NOT commit the values):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- Fail loudly if the Vault secrets aren't seeded — better than silently
-- scheduling a job that 401s every morning.
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
select cron.unschedule('sync-icp-triggers-daily')
where exists (select 1 from cron.job where jobname = 'sync-icp-triggers-daily');

-- pg_cron schedules are in UTC. 12:00 UTC == 8am EDT (summer) / 7am EST (winter).
-- Switch to '0 13 * * *' if 8am EST year-round is preferred.
select cron.schedule(
  'sync-icp-triggers-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-icp-triggers',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
