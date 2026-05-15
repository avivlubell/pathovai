-- Weekly scan: Monday 7:00 AM EDT (11:00 UTC)
select cron.schedule(
  'sync-ai-imaging-intelligence',
  '0 11 * * 1',
  $$
    select net.http_post(
      url := 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1/sync-ai-imaging-intelligence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    )
  $$
);
