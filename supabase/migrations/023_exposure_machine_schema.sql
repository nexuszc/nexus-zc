-- Migration 023: Automated Exposure Machine schema
-- Adds columns and tables needed for the 7-phase exposure system.

-- ── roofing_community_posts additions ────────────────────────────────────────
ALTER TABLE roofing_community_posts
  ADD COLUMN IF NOT EXISTS owns_community boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_date  date;

-- Mark r/RoofingOS posts as owned community
UPDATE roofing_community_posts
SET owns_community = true
WHERE thread_url ILIKE '%reddit.com/r/RoofingOS%';

-- ── email_sequences additions ─────────────────────────────────────────────────
ALTER TABLE email_sequences
  ADD COLUMN IF NOT EXISTS type text;

-- ── nexus_outbound_prospects ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nexus_outbound_prospects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name     text NOT NULL,
  owner_name        text,
  email             text,
  phone             text,
  industry          text,
  market            text,
  source            text,
  status            text NOT NULL DEFAULT 'new',
  enrolled_at       timestamptz,
  last_contacted_at timestamptz,
  sequence_step     integer NOT NULL DEFAULT 0,
  converted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nexus_outbound_status ON nexus_outbound_prospects(status);
CREATE INDEX IF NOT EXISTS idx_nexus_outbound_industry ON nexus_outbound_prospects(industry);

-- ── channel_kill_switches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_kill_switches (
  channel    text PRIMARY KEY,
  paused     boolean NOT NULL DEFAULT false,
  paused_at  timestamptz,
  paused_by  text,
  note       text
);

-- Seed all channels (paused=false = active)
INSERT INTO channel_kill_switches (channel) VALUES
  ('youtube'),
  ('email'),
  ('aria_calls'),
  ('reddit'),
  ('facebook_page'),
  ('facebook_group'),
  ('nexus_pipeline'),
  ('partnership')
ON CONFLICT (channel) DO NOTHING;
