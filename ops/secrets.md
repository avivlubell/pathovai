# Secrets

Names and locations only. Never commit values.

## Supabase Edge Function secrets

Set with `supabase secrets set NAME=value` (or via the Supabase Dashboard → Project Settings → Edge Functions → Secrets).

| Name | Used by | Purpose |
| --- | --- | --- |
| `NOTION_INTEGRATION_TOKEN` | most edge functions | Notion API auth |
| `SUPABASE_URL` | auto-injected | — |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | — |
| `SYNC_TRIGGER_SECRET` | `sync-references` | Shared secret required in `x-sync-secret` header. Generate with `openssl rand -hex 32`. Used by the Notion "Sync references" button. `verify_jwt = false` for this function — the secret is the auth. |
