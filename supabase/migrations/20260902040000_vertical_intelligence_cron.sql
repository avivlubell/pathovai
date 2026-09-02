-- Cutover: point the weekly market-intelligence sync at the generic
-- sync-vertical-intelligence function (processes every active vertical's
-- signal sources) instead of the ai-imaging-only sync-ai-imaging-intelligence.
-- Same schedule (Monday 7:00 AM EDT / 11:00 UTC) — this is a routing swap,
-- not a timing change. The old cron job is unscheduled so imaging signals
-- aren't fetched and classified twice.

select cron.unschedule('sync-ai-imaging-intelligence');

select cron.schedule(
  'sync-vertical-intelligence',
  '0 11 * * 1',
  $$
    select net.http_post(
      url := 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1/sync-vertical-intelligence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    )
  $$
);
