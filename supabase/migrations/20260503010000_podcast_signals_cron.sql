-- Schedule the weekly sync for the Podcast Intelligence — Signal Feed
-- (Notion -> public.podcast_signals). Companion to 20260503000000_podcast_signals.sql.
-- Without this, the table is a one-shot snapshot frozen at the migration date.
--
-- Requires extensions pg_cron, pg_net, supabase_vault, and Vault secrets
-- 'project_url' and 'service_role_key' to be present (already seeded by
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
select cron.unschedule('sync-podcast-signals-weekly')
where exists (select 1 from cron.job where jobname = 'sync-podcast-signals-weekly');

-- pg_cron schedules are in UTC. 11:00 UTC Monday == 7am EDT (summer) / 6am EST (winter).
-- Switch to '0 12 * * 1' if 7am EST year-round is preferred (= 8am EDT in summer).
select cron.schedule(
  'sync-podcast-signals-weekly',
  '0 11 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-podcast-signals',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
