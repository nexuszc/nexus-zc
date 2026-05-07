-- Sequence steps: the individual touches within a template.
-- Each step defines: when (days_after_previous), how (channel), and what (script hint / email).
--
-- Note: email_template_id FK to email_templates is added in 006_create_email_templates.sql
-- because email_templates does not exist yet at this point in migration order.

create table sequence_steps (
  id                  uuid        primary key default gen_random_uuid(),
  template_id         uuid        not null references sequence_templates(id) on delete cascade,
  step_number         int         not null check (step_number > 0),

  -- Days to wait after the previous step fires (or after enrollment for step 1).
  -- 0 = same day as enrollment / previous step.
  days_after_previous int         not null check (days_after_previous >= 0),

  channel             text        not null check (channel in ('call', 'email', 'both')),
  va_script_hint      text,

  -- Required when channel is 'email' or 'both'. FK added in 006.
  email_template_id   uuid,

  created_at          timestamptz not null default now(),

  unique (template_id, step_number),

  -- Enforce email_template_id is set whenever this step sends an email.
  constraint email_template_required_for_email_channel
    check (channel = 'call' or email_template_id is not null)
);
