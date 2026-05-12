-- Backfill sent_touch_date for touches that were sent (sent=true) before the
-- 2026-05-05 schema split, or were created by agents that wrote the sent date
-- into touch_date instead of sent_touch_date.
--
-- Condition: sent=true AND touch_date is populated AND sent_touch_date is empty
-- AND the touch_date is not in the future (future-dated sent rows are data errors
-- that should be corrected in Notion, not auto-promoted here).
--
-- Safe: effective_touch_date = COALESCE(sent_touch_date, touch_date) is unchanged
-- after this update because sent_touch_date takes precedence and gets the same value.

update public.touches
set
  sent_touch_date = touch_date,
  touch_date      = null
where sent = true
  and touch_date is not null
  and sent_touch_date is null
  and touch_date <= current_date;
