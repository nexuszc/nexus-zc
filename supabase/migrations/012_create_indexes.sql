-- Performance indexes.
-- Designed for: queue generation, dashboard aggregates, email webhook lookups,
-- VA performance views, stalled-lead detection.
-- At ~3,000 leads and 500 call_log rows/day these are sufficient for years.

-- ── Queue generation ──────────────────────────────────────────────────────────

-- All active leads per client ordered by next due date (core queue query).
create index idx_leads_queue
  on leads (client_id, next_touch_due_at)
  where status = 'active';

-- VA-specific queue slice (assigned leads only).
create index idx_leads_va_queue
  on leads (client_id, assigned_va_id, next_touch_due_at)
  where status = 'active';

-- Tier 4: new uncontacted leads, surfaced FIFO by import order.
create index idx_leads_uncontacted
  on leads (client_id, imported_at)
  where status = 'active' and touch_count = 0;

-- ── Dashboard & reporting ─────────────────────────────────────────────────────

-- Outcome bucket breakdown (sequence health panel).
create index idx_leads_outcome
  on leads (client_id, current_outcome);

-- Stalled lead detection: active leads with no touch in X days.
create index idx_leads_stalled
  on leads (client_id, last_touched_at)
  where status = 'active';

-- Client-level call aggregates (daily/weekly dashboards and report generation).
create index idx_call_logs_client
  on call_logs (client_id, logged_at desc);

-- Per-lead call history (lead detail view, sequence logic).
create index idx_call_logs_lead
  on call_logs (lead_id, logged_at desc);

-- VA performance: calls logged per VA today / this week.
create index idx_call_logs_va
  on call_logs (va_id, logged_at desc);

-- ── Sequence processing ───────────────────────────────────────────────────────

-- Background worker: find enrollments whose next step is due.
create index idx_enrollments_due
  on lead_enrollments (next_step_due_at)
  where completed_at is null;

-- ── Callbacks ────────────────────────────────────────────────────────────────

-- Tier 1 queue: pending callbacks ordered by scheduled time.
create index idx_callbacks_pending
  on scheduled_callbacks (client_id, scheduled_at)
  where completed_at is null;

-- ── Email ────────────────────────────────────────────────────────────────────

-- Resend webhook lookup: tracking_token → email_sends row.
-- (Unique constraint on email_sends.tracking_token already creates this implicitly,
--  listed here explicitly for documentation clarity.)

-- Sam's reply alert queue: unflagged replies needing review.
create index idx_email_replies_unflagged
  on email_sends (lead_id, replied_at)
  where reply_flagged = false and replied_at is not null;

-- Hard bounce tracking: stop future email steps for bounced leads.
create index idx_email_bounces
  on email_sends (lead_id)
  where bounce_type = 'hard';
