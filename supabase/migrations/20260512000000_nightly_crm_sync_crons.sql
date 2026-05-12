-- Schedule nightly syncs for core CRM tables (accounts + touches).
-- These tables were previously webhook/manual-only, which caused the QB to
-- miss outreach history in morning triage when touches weren't individually
-- synced. Runs at 4:00–4:05 UTC (midnight EDT) — well ahead of morning
-- triage at 12:00 UTC (8am EDT).
--
-- Requires vault secrets 'project_url' and 'service_role_key' (same prereqs
-- as existing crons). See 20260502010000_icp_triggers_cron.sql for seeding
-- instructions.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Vault secret "project_url" is missing. Seed it before applying this migration.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise exception 'Vault secret "service_role_key" is missing. Seed it before applying this migration.';
  end if;
end $$;

-- sync-prospects (Outreach Intelligence accounts) — 4:00 UTC / midnight EDT
select cron.unschedule('sync-prospects-nightly')
where exists (select 1 from cron.job where jobname = 'sync-prospects-nightly');

select cron.schedule(
  'sync-prospects-nightly',
  '0 4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-prospects',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- sync-touches (Outreach Touches) — 4:05 UTC / 12:05am EDT
-- Staggered 5 min after prospects so the account FK index is warm
-- when touches resolve their related_outreach_page_id lookups.
select cron.unschedule('sync-touches-nightly')
where exists (select 1 from cron.job where jobname = 'sync-touches-nightly');

select cron.schedule(
  'sync-touches-nightly',
  '5 4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-touches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
