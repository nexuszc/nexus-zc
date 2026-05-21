-- Migration 028: AE task system tables, seed, RLS, and cron

-- ── TABLE: roofing_va_tasks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roofing_va_tasks (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  date        NOT NULL DEFAULT current_date,
  task_type             text        NOT NULL,
  title                 text        NOT NULL,
  description           text,
  steps                 jsonb,
  copy_text             text,
  priority              int         NOT NULL DEFAULT 3,
  status                text        NOT NULL DEFAULT 'pending',
  assigned_to           text        NOT NULL DEFAULT 'ae',
  completed_at          timestamptz,
  completed_by          text,
  escalated_at          timestamptz,
  escalation_reason     text,
  escalation_status     text,
  time_estimate_minutes int,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roofing_va_tasks_date   ON roofing_va_tasks(date);
CREATE INDEX IF NOT EXISTS idx_roofing_va_tasks_status ON roofing_va_tasks(status);

-- ── TABLE: ae_accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ae_accounts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  email      text        UNIQUE NOT NULL,
  role       text        NOT NULL DEFAULT 'ae',
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── TABLE: ae_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ae_sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ae_id      uuid        NOT NULL REFERENCES ae_accounts(id),
  token      text        UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ae_sessions_token ON ae_sessions(token);

-- ── SEED ───────────────────────────────────────────────────────────────────
INSERT INTO ae_accounts (name, email, role)
VALUES ('Account Executive', 'ae@roofingos.dev', 'ae')
ON CONFLICT (email) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE roofing_va_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_sessions      ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON roofing_va_tasks TO service_role;
GRANT SELECT, INSERT         ON ae_sessions      TO service_role;
GRANT SELECT                 ON ae_accounts      TO service_role;

GRANT SELECT, UPDATE ON roofing_va_tasks TO authenticated;
GRANT SELECT         ON ae_accounts      TO authenticated;

DROP POLICY IF EXISTS "authenticated read va tasks"   ON roofing_va_tasks;
CREATE POLICY "authenticated read va tasks"
  ON roofing_va_tasks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated update va tasks" ON roofing_va_tasks;
CREATE POLICY "authenticated update va tasks"
  ON roofing_va_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── CRON: generate-va-tasks at 13:00 UTC daily (7 AM MT) ──────────────────
SELECT cron.unschedule(job.jobid)
FROM cron.job AS job
WHERE job.jobname = 'generate-va-tasks-daily';

SELECT cron.schedule(
  'generate-va-tasks-daily',
  '0 13 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/generate-va-tasks',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"generate_ae_tasks":true}'::jsonb
  ) AS request_id$$
);
