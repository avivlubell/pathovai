create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  deal_name text,
  company_name text,
  motion_type text,
  stage text,
  probability numeric,
  value numeric,
  expected_close_date date,
  next_milestone text,
  primary_contact text,
  notes text,
  notion_url text,
  created_at timestamptz default now()
);
