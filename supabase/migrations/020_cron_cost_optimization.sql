-- Migration 020: Cron cost optimization
-- Reduces daily Claude API calls from ~301 to ~22 for affected functions.
-- Adds event triggers to replace real-time coverage lost by reduced polling.

-- ── CRON CHANGES ─────────────────────────────────────────────────────────────

-- Remove nexus-core every-30-min job (was job 18: aria-call-queue-processor)
SELECT cron.unschedule(18);

-- nexus-core: 30-min (48x/day) → 3x daily: 01:00, 13:00, 19:00 UTC (7pm/7am/1pm MT)
SELECT cron.unschedule(6);
SELECT cron.schedule(
  'nexus-core-cycle',
  '0 1,13,19 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/nexus-core',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"source": "cron"}'::jsonb
  ) AS request_id$$
);

-- health-monitor: hourly (24x/day) → hourly schedule but conditional execution
-- Fires at 8am MT (14:00 UTC) and 8pm MT (02:00 UTC), OR if error_count > 3 in last hour
SELECT cron.unschedule(3);
SELECT cron.schedule(
  'nexus-health-monitor',
  '0 * * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/health-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  ) AS request_id
  WHERE EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC') IN (2, 14)
     OR EXISTS (
       SELECT 1 FROM nexus_health
       WHERE checked_at > NOW() - INTERVAL '1 hour'
         AND error_count > 3
       LIMIT 1
     )$$
);

-- roofing-content-engine: daily (job 15) + Monday-only (job 25) → Mon+Thu at 13:00 UTC
SELECT cron.unschedule(15);
SELECT cron.unschedule(25);
SELECT cron.schedule(
  'roofing-content-engine-2x-week',
  '0 13 * * 1,4',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-content-engine',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- roofing-self-improve: add weekly Sunday 14:00 UTC (8am MT)
SELECT cron.schedule(
  'roofing-self-improve-weekly',
  '0 14 * * 0',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-self-improve',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ── EVENT TRIGGERS ────────────────────────────────────────────────────────────

-- Trigger 1: new contractor_accounts row → fire nexus-core immediately
CREATE OR REPLACE FUNCTION _trigger_nexus_core_on_contractor_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/nexus-core',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"source": "trigger_contractor_signup"}'::jsonb
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nexus_core_on_contractor_signup ON contractor_accounts;
CREATE TRIGGER trg_nexus_core_on_contractor_signup
  AFTER INSERT ON contractor_accounts
  FOR EACH ROW EXECUTE FUNCTION _trigger_nexus_core_on_contractor_signup();

-- Trigger 2: new nexus_health row with status=error → fire health-monitor immediately
CREATE OR REPLACE FUNCTION _trigger_health_monitor_on_error()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'error' THEN
    PERFORM net.http_post(
      url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/health-monitor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
      ),
      body := '{"trigger": "error_event"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_health_monitor_on_error ON nexus_health;
CREATE TRIGGER trg_health_monitor_on_error
  AFTER INSERT ON nexus_health
  FOR EACH ROW EXECUTE FUNCTION _trigger_health_monitor_on_error();

-- Trigger 3: new supplement_audit_leads row → fire aria-queue-daily immediately
CREATE OR REPLACE FUNCTION _trigger_aria_queue_on_audit_lead()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/aria-queue-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"trigger": "new_audit_lead"}'::jsonb
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aria_queue_on_audit_lead ON supplement_audit_leads;
CREATE TRIGGER trg_aria_queue_on_audit_lead
  AFTER INSERT ON supplement_audit_leads
  FOR EACH ROW EXECUTE FUNCTION _trigger_aria_queue_on_audit_lead();
