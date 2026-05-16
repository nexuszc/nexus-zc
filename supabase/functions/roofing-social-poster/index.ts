// roofing-social-poster
// Posts to Facebook after a YouTube upload.
// Called automatically by roofing-youtube-uploader.
//
// REQUIRES SECRETS (manual setup in Supabase Dashboard):
//   FACEBOOK_PAGE_ID        — Roofing OS Facebook page ID
//   FACEBOOK_ACCESS_TOKEN   — Page access token (never-expiring via Business Manager)
//
// TikTok API v2 — add when ready

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FACEBOOK_PAGE_ID = Deno.env.get('FACEBOOK_PAGE_ID') || '';
const FACEBOOK_ACCESS_TOKEN = Deno.env.get('FACEBOOK_ACCESS_TOKEN') || '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: 'Markdown' }),
  }).catch(() => {});
}

async function postToFacebook(title: string, hook: string, youtubeUrl: string): Promise<string | null> {
  if (!FACEBOOK_PAGE_ID || !FACEBOOK_ACCESS_TOKEN) return null;

  const message = `${hook}\n\nFull breakdown 👇\n${youtubeUrl}\n\n🏠 roofingos.dev — starts at $49/month`;

  const res = await fetch(`https://graph.facebook.com/v18.0/${FACEBOOK_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, link: youtubeUrl, access_token: FACEBOOK_ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('Facebook error:', JSON.stringify(data.error));
    return null;
  }
  return data.id || null;
}

// TikTok API v2 — add when ready
// async function postToTikTok(...) { ... }

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'roofing-social-poster ready' });

  // Direct test post — if youtube_url provided, uses full post format; otherwise raw message
  if (body.test_post) {
    if (!FACEBOOK_PAGE_ID || !FACEBOOK_ACCESS_TOKEN) {
      return Response.json({ ok: false, error: 'FACEBOOK_PAGE_ID or FACEBOOK_ACCESS_TOKEN not set' }, { status: 503 });
    }
    let message: string;
    if (body.youtube_url) {
      const hook = body.hook || body.title || '';
      const link = body.youtube_url as string;
      message = `${hook}\n\nFull breakdown 👇\n${link}\n\n🏠 roofingos.dev — starts at $49/month`;
    } else {
      message = (body.message as string) || 'Test post from Roofing OS';
    }
    const res = await fetch(`https://graph.facebook.com/v18.0/${FACEBOOK_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        ...(body.youtube_url ? { link: body.youtube_url } : {}),
        access_token: FACEBOOK_ACCESS_TOKEN,
      }),
    });
    const data = await res.json();
    if (data.error) return Response.json({ ok: false, error: data.error }, { status: 400 });
    return Response.json({ ok: true, post_id: data.id });
  }

  const { content_id, youtube_url, title, hook } = body;
  if (!youtube_url || !title) return Response.json({ error: 'youtube_url and title required' }, { status: 400 });

  const results: Record<string, string | null> = {};

  try {
    results.facebook = await postToFacebook(title, hook || title, youtube_url);
  } catch (err) {
    console.error('Facebook post error:', err);
    results.facebook = null;
  }

  // TikTok API v2 — add when ready
  // results.tiktok = await postToTikTok(title, hook, youtubeUrl);

  if (content_id) {
    await supabase.from('roofing_content').update({
      social_posted: true,
      social_post_ids: results,
      social_posted_at: new Date().toISOString(),
    }).eq('id', content_id).catch(() => {});
  }

  await tg(`📱 *Social Posts Done*\n\nFacebook: ${results.facebook ? '✅' : '❌'}\nTikTok: pending API setup`);

  return Response.json({ ok: true, results });
});
