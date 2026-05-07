-- Sequence templates: one per outcome type per client.
-- Brian can edit these freely — touch frequency, steps, channels.
-- do_not_call has no template; that outcome terminates the lead entirely.

create table sequence_templates (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references clients(id) on delete cascade,

  outcome_type text        not null
                             check (outcome_type in (
                               'voicemail',
                               'no_answer',
                               'connected_not_interested',
                               'connected_not_ready',
                               'callback_requested',
                               'qualified'
                             )),

  name         text        not null,
  description  text,
  is_active    bool        not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One active template per outcome per client.
  unique (client_id, outcome_type)
);

create trigger sequence_templates_updated_at
  before update on sequence_templates
  for each row execute function set_updated_at();
