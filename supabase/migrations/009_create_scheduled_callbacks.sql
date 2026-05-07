-- Scheduled callbacks: leads who asked to be called back at a specific time.
-- These surface as Tier 1 (highest priority) in the VA daily queue.
-- Separate from call_logs so missed callbacks are instantly queryable.

create table scheduled_callbacks (
  id        uuid        primary key default gen_random_uuid(),
  lead_id   uuid        not null references leads(id) on delete cascade,
  va_id     uuid        references vas(id) on delete set null,
  client_id uuid        not null references clients(id) on delete cascade,

  scheduled_at timestamptz not null,

  -- Set when VA completes the callback call.
  completed_at        timestamptz,
  outcome_call_log_id uuid references call_logs(id) on delete set null,

  created_at timestamptz not null default now()
);
