-- Weekly reports: auto-generated snapshot emailed to Brian every Friday.
-- report_data stores the full rendered payload so the email can be
-- reconstructed or re-sent without re-querying historical data.

create table weekly_reports (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references clients(id) on delete cascade,

  week_start date        not null,
  week_end   date        not null,

  calls_made int not null default 0 check (calls_made >= 0),
  connects   int not null default 0 check (connects >= 0),
  qualifieds int not null default 0 check (qualifieds >= 0),

  -- Full report snapshot for rendering / re-sending.
  report_data jsonb not null default '{}',

  generated_at timestamptz not null default now(),
  emailed_at   timestamptz,

  unique (client_id, week_start),

  constraint valid_week_range check (week_end >= week_start)
);
