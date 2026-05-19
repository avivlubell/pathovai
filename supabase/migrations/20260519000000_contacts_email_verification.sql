ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_verified boolean,
  ADD COLUMN IF NOT EXISTS email_score smallint,
  ADD COLUMN IF NOT EXISTS email_status text;
