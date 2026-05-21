-- Migration 022: Add Facebook group P.S. line to all outreach email templates
-- Applies to all 11 touch templates in email_templates table.
-- Also applied inline to roofing-nudge-email/index.ts defaultHtml.

-- Templates 1-9 and 11: inject P.S. before the standard unsubscribe footer
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<p style="color:#9ca3af;font-size:13px;margin-top:32px;">',
  '<p style="color:#6b7280;font-size:14px;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">P.S. Join our free Facebook group for roofing contractors — supplement tips, software reviews, and storm strategy: <a href="https://www.facebook.com/groups/2266757270527259" style="color:#3b82f6;">facebook.com/groups/2266757270527259</a></p><p style="color:#9ca3af;font-size:13px;margin-top:32px;">'
)
WHERE touch_number IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 11);

-- Template 10 has a different structure — append P.S. directly
UPDATE email_templates
SET body_html = body_html || '<p style="color:#6b7280;font-size:14px;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">P.S. Join our free Facebook group for roofing contractors — supplement tips, software reviews, and storm strategy: <a href="https://www.facebook.com/groups/2266757270527259" style="color:#3b82f6;">facebook.com/groups/2266757270527259</a></p>'
WHERE touch_number = 10;
