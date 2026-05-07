-- Leads: every homeowner contact in the client's list.
-- Brian's initial load is ~3,000 pre-foreclosure homeowners.
--
-- TCPA compliance: leads.timezone overrides clients.timezone for calling-hour
-- enforcement. Queue generation MUST NOT surface a lead before 8 AM or after
-- 9 PM in coalesce(leads.timezone, clients.timezone). Legal requirement.

create table leads (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  first_name  text    not null,
  last_name   text    not null,
  phone       text    not null,
  email       text,
  address     text,
  city        text,
  state       text,
  zip         text,

  -- Lead's local timezone for TCPA calling-hour enforcement.
  -- Nullable: falls back to clients.timezone when null.
  timezone    text,

  -- Financial context from import (optional, helps VAs tailor pitch)
  loan_amount    numeric check (loan_amount >= 0),
  property_value numeric check (property_value >= 0),

  status text not null default 'active'
    check (status in ('active', 'do_not_call', 'qualified', 'converted', 'archived')),

  -- Set on every call log. Drives which sequence the lead is enrolled in.
  current_outcome text
    check (current_outcome in (
      'voicemail',
      'no_answer',
      'connected_not_interested',
      'connected_not_ready',
      'callback_requested',
      'qualified',
      'do_not_call'
    )),

  assigned_va_id uuid references vas(id) on delete set null,

  touch_count             int         not null default 0 check (touch_count >= 0),
  last_touched_at         timestamptz,
  -- Recomputed on every outcome log. Drives queue generation.
  next_touch_due_at       timestamptz,

  unsubscribed_from_email bool        not null default false,
  unsubscribed_at         timestamptz,

  imported_at timestamptz not null default now(),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger leads_updated_at
  before update on leads
  for each row execute function set_updated_at();
