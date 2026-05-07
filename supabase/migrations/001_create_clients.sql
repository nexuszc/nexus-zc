-- Clients: one row per business using the Nexus Operations system.
-- Brian's cash-out refi operation is the first client.

create extension if not exists "pgcrypto";

-- Reusable updated_at trigger function used by all tables that track mutations.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table clients (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  email      text,
  phone      text,
  -- TCPA: all queue generation and calling-hour enforcement uses this timezone
  -- unless overridden by leads.timezone at the individual lead level.
  timezone   text        not null default 'America/Denver',
  settings   jsonb       not null default '{}',
  created_at timestamptz not null default now()
);
