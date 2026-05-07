-- Lead enrollments: tracks which sequence a lead is currently working through.
-- Only one active enrollment per lead at any time (enforced by partial unique index).
-- When a VA logs a new outcome, the current enrollment is closed and a new one opens.

create table lead_enrollments (
  id                  uuid        primary key default gen_random_uuid(),
  lead_id             uuid        not null references leads(id) on delete cascade,
  -- restrict: don't allow deleting a template that has active enrollments
  template_id         uuid        not null references sequence_templates(id) on delete restrict,
  current_step_number int         not null default 1 check (current_step_number > 0),
  enrolled_at         timestamptz not null default now(),
  next_step_due_at    timestamptz not null,

  -- Set when enrollment ends for any reason.
  completed_at  timestamptz,
  exited_reason text
    check (exited_reason in ('completed', 'outcome_changed', 'do_not_call', 'converted')),

  created_at timestamptz not null default now()
);

-- One active enrollment per lead. Partial unique index on null completed_at.
create unique index idx_enrollments_one_active
  on lead_enrollments (lead_id)
  where completed_at is null;
