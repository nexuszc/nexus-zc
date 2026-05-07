-- Email sends: one row per email dispatched to a lead.
-- subject and body_html are snapshotted at send time — edits to the source
-- email_template do not alter the historical record.
-- tracking_token is the UUID embedded in open-pixel and click-redirect URLs;
-- Resend webhooks hit Nexus with this token to log engagement events.

create table email_sends (
  id                uuid        primary key default gen_random_uuid(),
  lead_id           uuid        not null references leads(id) on delete cascade,
  enrollment_id     uuid        not null references lead_enrollments(id) on delete cascade,
  step_id           uuid        not null references sequence_steps(id) on delete restrict,
  email_template_id uuid        not null references email_templates(id) on delete restrict,

  to_email text not null,

  -- Snapshot of template at send time.
  subject   text not null,
  body_html text not null,

  -- UUID embedded in tracking pixel + redirect links. Resend webhooks reference this.
  tracking_token text not null unique default gen_random_uuid()::text,

  sent_at     timestamptz,
  opened_at   timestamptz,              -- first open
  open_count  int not null default 0 check (open_count >= 0),
  clicked_at  timestamptz,             -- first click
  click_count int not null default 0 check (click_count >= 0),

  replied_at    timestamptz,
  -- Stays true until Sam reviews the reply in the dashboard.
  reply_flagged bool not null default false,

  unsubscribed_at timestamptz,
  bounce_type     text check (bounce_type in ('hard', 'soft')),

  created_at timestamptz not null default now()
);
