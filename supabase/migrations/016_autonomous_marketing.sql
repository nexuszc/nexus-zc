-- 016_autonomous_marketing.sql
-- Roofing OS Autonomous Marketing Machine tables

CREATE TABLE IF NOT EXISTS roofing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL, -- 'blog','facebook','linkedin','youtube','carrier_intelligence','storm_bundle','google_ads','sms_template','email_template'
  title text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending','approved','rejected','published'
  channel text, -- 'blog','facebook','linkedin','youtube','email','sms'
  storm_event_id uuid,
  approved_at timestamptz,
  published_at timestamptz,
  published_url text,
  performance_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES roofing_content(id) ON DELETE CASCADE,
  channel text NOT NULL,
  recipient_phone text,
  recipient_email text,
  recipient_name text,
  prospect_id uuid,
  scheduled_for timestamptz,
  status text NOT NULL DEFAULT 'pending', -- 'pending','approved','sent','failed','cancelled'
  sent_at timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of date NOT NULL,
  channel text NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roofing_community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL, -- 'reddit','facebook_groups'
  thread_url text NOT NULL,
  thread_title text,
  thread_content text,
  our_response text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending','approved','posted','rejected'
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roofing_content_status ON roofing_content(status);
CREATE INDEX IF NOT EXISTS idx_roofing_content_type ON roofing_content(type);
CREATE INDEX IF NOT EXISTS idx_roofing_content_created ON roofing_content(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled ON content_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_marketing_performance_week ON marketing_performance(week_of);
CREATE INDEX IF NOT EXISTS idx_community_posts_status ON roofing_community_posts(status);

GRANT ALL ON roofing_content TO service_role;
GRANT ALL ON content_queue TO service_role;
GRANT ALL ON marketing_performance TO service_role;
GRANT ALL ON roofing_community_posts TO service_role;
