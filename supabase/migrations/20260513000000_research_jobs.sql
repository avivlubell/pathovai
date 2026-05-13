-- Research job queue for background batch processing.
-- Jobs are written by queue-research and drained nightly by drain-research-queue.

create table public.research_jobs (
  id            uuid        primary key default gen_random_uuid(),
  company_name  text        not null,
  account_id    uuid        references public.accounts(id),
  status        text        not null default 'pending'
                              check (status in ('pending','running','complete','failed')),
  triggered_by  text        not null default 'manual',
  result_kb_id  uuid,
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create index research_jobs_status_created on public.research_jobs(status, created_at);
create index research_jobs_company        on public.research_jobs(lower(company_name));
