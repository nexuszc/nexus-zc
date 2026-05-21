-- Migration 027: YouTube engine cron + RLS grants for dashboard

-- YouTube engine cron: Mon + Thu at 13:00 UTC (3 shorts per run)
SELECT cron.schedule(
  'roofing-youtube-engine-2x-week',
  '0 13 * * 1,4',
  $$SELECT net.http_post(
    url := 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-youtube-engine',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := jsonb_build_object('count', 3)
  ) AS request_id$$
);

-- Grant dashboard (authenticated) read/update on kill switches and partnership targets
GRANT SELECT, UPDATE ON channel_kill_switches TO authenticated;
GRANT SELECT ON roofing_partnership_targets TO authenticated;

-- RLS policies for channel_kill_switches (dashboard users can read + toggle)
ALTER TABLE channel_kill_switches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read kill switches" ON channel_kill_switches;
CREATE POLICY "authenticated can read kill switches"
  ON channel_kill_switches FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated can update kill switches" ON channel_kill_switches;
CREATE POLICY "authenticated can update kill switches"
  ON channel_kill_switches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS policies for roofing_partnership_targets (dashboard read)
ALTER TABLE roofing_partnership_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read partnership targets" ON roofing_partnership_targets;
CREATE POLICY "authenticated can read partnership targets"
  ON roofing_partnership_targets FOR SELECT TO authenticated USING (true);
