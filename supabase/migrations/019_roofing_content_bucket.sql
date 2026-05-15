-- Migration 019: roofing-content storage bucket
-- Public bucket for voiceovers (audio/mpeg) and thumbnails (image/png)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'roofing-content',
  'roofing-content',
  true,
  52428800,
  ARRAY['audio/mpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "Public read roofing-content"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'roofing-content');

-- Service role write
CREATE POLICY "Service role insert roofing-content"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'roofing-content' AND auth.role() = 'service_role');

-- Service role delete
CREATE POLICY "Service role delete roofing-content"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'roofing-content' AND auth.role() = 'service_role');
