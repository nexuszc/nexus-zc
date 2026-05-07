-- Email templates: reusable message content assigned to sequence steps.
-- body_html and body_text are both required — text is the plain fallback.
-- Subject/body are snapshotted at send time in email_sends; edits here
-- don't mutate already-sent emails.

create table email_templates (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references clients(id) on delete cascade,
  name       text        not null,
  subject    text        not null,
  body_html  text        not null,
  body_text  text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger email_templates_updated_at
  before update on email_templates
  for each row execute function set_updated_at();

-- Now that email_templates exists, add the FK that sequence_steps could not
-- reference at creation time.
alter table sequence_steps
  add constraint fk_sequence_steps_email_template
  foreign key (email_template_id)
  references email_templates(id)
  on delete set null;
