import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const page = body.page || "/";
    const today = new Date().toISOString().slice(0, 10);

    // Upsert into aggregate table: increment visit count for today/page
    const { data: existing } = await supabase
      .from("roofing_page_visits")
      .select("id, visits")
      .eq("date", today)
      .eq("page", page)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("roofing_page_visits")
        .update({ visits: (existing.visits || 0) + 1 })
        .eq("id", existing.id);
    } else {
      await supabase.from("roofing_page_visits").insert({
        date: today,
        page,
        visits: 1,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  } catch (e: any) {
    // Always 200 — never break the landing page
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200,
      headers: CORS,
    });
  }
});
