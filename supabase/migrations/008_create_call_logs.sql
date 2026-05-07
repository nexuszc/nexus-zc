-- Call logs: immutable record of every outcome a VA logs.
-- Append-only — never updated after insert. Source of truth for all reporting.
-- client_id is denormalized here for fast dashboard aggregates without joins.

create table call_logs (
  id        uuid        primary key default gen_random_uuid(),
  lead_id   uuid        not null references leads(id) on delete cascade,
  va_id     uuid        not null references vas(id) on delete restrict,
  client_id uuid        not null references clients(id) on delete cascade,

  outcome text not null
    check (outcome in (
      'voicemail',
      'no_answer',
      'connected_not_interested',
      'connected_not_ready',
      'callback_requested',
      'qualified',
      'do_not_call'
    )),

  notes text,

  -- Required when outcome = 'callback_requested'.
  callback_scheduled_at timestamptz,

  duration_seconds int check (duration_seconds >= 0),
  logged_at        timestamptz not null default now(),

  -- Enforce callback_scheduled_at is populated when the outcome demands it.
  constraint callback_time_required
    check (outcome != 'callback_requested' or callback_scheduled_at is not null)
);
