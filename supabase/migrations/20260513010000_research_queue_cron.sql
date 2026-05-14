-- Nightly drain of the research_jobs queue.
-- Runs 3× per night (10pm, 11pm, midnight UTC) processing 2 jobs per run = up to 6 companies overnight.
-- Each run is capped at ~90s (2 companies × ~40s each) well within the 150s edge function limit.
-- Requires vault secrets 'project_url' and 'service_role_key' (set by prior migrations).

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Vault secret "project_url" is missing.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise exception 'Vault secret "service_role_key" is missing.';
  end if;
end $$;

select cron.unschedule('drain-research-queue-1') where exists (select 1 from cron.job where jobname = 'drain-research-queue-1');
select cron.unschedule('drain-research-queue-2') where exists (select 1 from cron.job where jobname = 'drain-research-queue-2');
select cron.unschedule('drain-research-queue-3') where exists (select 1 from cron.job where jobname = 'drain-research-queue-3');

-- 10pm UTC
select cron.schedule(
  'drain-research-queue-1',
  '0 22 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drain-research-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- 11pm UTC
select cron.schedule(
  'drain-research-queue-2',
  '0 23 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drain-research-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- midnight UTC
select cron.schedule(
  'drain-research-queue-3',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drain-research-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
