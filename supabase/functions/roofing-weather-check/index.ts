// roofing-weather-check v1 — daily 5am MT (11:00 UTC)
// Checks weather for all active job addresses. Warns if rain >40% or wind >25mph.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY") || "";
const TELEGRAM_BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT_ID    = Deno.env.get("TELEGRAM_CHAT_ID") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function getWeather(lat: number, lng: number): Promise<{ rain_chance_pct: number; wind_mph: number; temp_high_f: number; temp_low_f: number; conditions: string } | null> {
  if (!OPENWEATHER_API_KEY) return null;
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial&cnt=8`
    );
    const data = await res.json();
    if (!data.list?.length) return null;

    const tomorrow = data.list.slice(0, 8);
    const rainEntries = tomorrow.filter((e: any) => e.rain || (e.weather?.[0]?.main === 'Rain') || (e.weather?.[0]?.main === 'Drizzle') || (e.pop > 0.4));
    const maxPop = Math.max(...tomorrow.map((e: any) => (e.pop || 0) * 100));
    const maxWind = Math.max(...tomorrow.map((e: any) => e.wind?.speed || 0));
    const temps = tomorrow.map((e: any) => e.main?.temp || 70);
    const conditions = tomorrow[0]?.weather?.[0]?.description || 'clear';

    return {
      rain_chance_pct: Math.round(maxPop),
      wind_mph: Math.round(maxWind),
      temp_high_f: Math.round(Math.max(...temps)),
      temp_low_f: Math.round(Math.min(...temps)),
      conditions,
    };
  } catch {
    return null;
  }
}

// Geocode an address string → lat/lng
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!OPENWEATHER_API_KEY) return null;
  try {
    const res = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(address)}&limit=1&appid=${OPENWEATHER_API_KEY}`
    );
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: data[0].lat, lng: data[0].lon };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-weather-check v1 ready" });

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  // Get active jobs with addresses (not complete/paid/lead)
  const { data: jobs } = await supabase
    .from("roofing_jobs")
    .select("id, contractor_id, property_address, city, state, zip_code, lat, lng")
    .not("status", "in", '("lead","complete","paid")')
    .not("property_address", "is", null);

  if (!jobs?.length) return Response.json({ ok: true, checked: 0 });

  let warnings = 0;
  const warningJobs: string[] = [];

  for (const job of jobs) {
    let coords: { lat: number; lng: number } | null = null;

    if (job.lat && job.lng) {
      coords = { lat: job.lat, lng: job.lng };
    } else {
      const addr = [job.property_address, job.city, job.state, job.zip_code].filter(Boolean).join(", ");
      coords = await geocodeAddress(addr);
    }

    if (!coords) continue;

    const wx = await getWeather(coords.lat, coords.lng);
    if (!wx) continue;

    const isWarning = wx.rain_chance_pct > 40 || wx.wind_mph > 25;

    await supabase.from("job_weather").upsert({
      job_id: job.id,
      contractor_id: job.contractor_id,
      forecast_date: tomorrow,
      temp_high_f: wx.temp_high_f,
      temp_low_f: wx.temp_low_f,
      conditions: wx.conditions,
      rain_chance_pct: wx.rain_chance_pct,
      wind_mph: wx.wind_mph,
      warning: isWarning,
      warning_reason: isWarning
        ? [wx.rain_chance_pct > 40 ? `Rain ${wx.rain_chance_pct}%` : null, wx.wind_mph > 25 ? `Wind ${wx.wind_mph}mph` : null].filter(Boolean).join(", ")
        : null,
    }, { onConflict: "job_id,forecast_date" });

    if (isWarning) {
      warnings++;
      warningJobs.push(`${job.property_address} — ${wx.rain_chance_pct > 40 ? `Rain ${wx.rain_chance_pct}%` : ''} ${wx.wind_mph > 25 ? `Wind ${wx.wind_mph}mph` : ''}`.trim());

      // Flag job
      await supabase.from("roofing_jobs").update({ weather_warning: true }).eq("id", job.id);
    } else {
      await supabase.from("roofing_jobs").update({ weather_warning: false }).eq("id", job.id);
    }
  }

  if (warnings > 0) {
    await sendTelegram(
      `⛈️ <b>Weather Warning — ${tomorrow}</b>\n${warnings} active job${warnings > 1 ? 's' : ''} at risk:\n\n` +
      warningJobs.slice(0, 5).map(j => `• ${j}`).join("\n")
    );
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "roofing-weather-check",
    status: "ok",
    response_ms: 0,
    metadata: { jobs_checked: jobs.length, warnings },
    recorded_at: now.toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, jobs_checked: jobs.length, warnings });
});
