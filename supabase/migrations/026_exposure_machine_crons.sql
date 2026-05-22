-- Migration 026: Automated Exposure Machine cron jobs and DB triggers
-- Adds 5 new crons + 1 DB trigger for the 7-phase exposure system.
-- All times are UTC; MT summer = UTC - 6.

-- ── UPDATE EXISTING COMMUNITY MONITOR CRON ───────────────────────────────────
-- Change from every 4 hours to every 6 hours (cost reduction + rate limit protection)
SELECT cron.unschedule(job.jobid)
FROM cron.job AS job
WHERE job.jobname = 'roofing-community-monitor';

SELECT cron.schedule(
  'roofing-community-monitor',
  '0 */6 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-community-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ── NEW CRONS ─────────────────────────────────────────────────────────────────

-- r/RoofingOS daily post: 10am MT = 16:00 UTC (summer)
SELECT cron.schedule(
  'roofing-reddit-daily-post',
  '0 16 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-community-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := jsonb_build_object('post_owned_community', true, 'platform', 'reddit', 'limit', 1)
  ) AS request_id$$
);

-- Facebook page daily post: 9am MT = 15:00 UTC (summer)
SELECT cron.schedule(
  'roofing-facebook-page-daily',
  '0 15 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-social-poster',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := jsonb_build_object('channel', 'facebook_page', 'limit', 1)
  ) AS request_id$$
);

-- Facebook group daily post: 11am MT = 17:00 UTC (summer)
SELECT cron.schedule(
  'roofing-facebook-group-daily',
  '0 17 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-social-poster',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := jsonb_build_object('channel', 'facebook_group', 'limit', 1)
  ) AS request_id$$
);

-- YouTube uploader: 3pm MT = 21:00 UTC (summer)
SELECT cron.schedule(
  'roofing-youtube-uploader-daily',
  '0 21 * * *',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-youtube-uploader',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ── VOICEOVER DB TRIGGER ──────────────────────────────────────────────────────
-- When a new YouTube content row is inserted, fire roofing-voiceover-engine immediately
CREATE OR REPLACE FUNCTION _trigger_voiceover_on_youtube_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.type IN ('youtube_short', 'youtube_long') THEN
    PERFORM net.http_post(
      url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-voiceover-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
      ),
      body := jsonb_build_object('content_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voiceover_on_youtube_content ON roofing_content;
CREATE TRIGGER trg_voiceover_on_youtube_content
  AFTER INSERT ON roofing_content
  FOR EACH ROW EXECUTE FUNCTION _trigger_voiceover_on_youtube_content();
