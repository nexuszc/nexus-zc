-- Fix permission denied on roofing_content_dashboard view
GRANT SELECT ON roofing_content_dashboard TO service_role, authenticated, anon;

-- Fix roofing_partnership_targets access
GRANT ALL ON roofing_partnership_targets TO service_role;
GRANT SELECT ON roofing_partnership_targets TO authenticated;

-- Ensure roofing_page_visits is accessible (table pre-existed)
ALTER TABLE roofing_page_visits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON roofing_page_visits TO service_role;
GRANT SELECT ON roofing_page_visits TO authenticated;
