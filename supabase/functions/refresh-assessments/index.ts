import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-password",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const password = req.headers.get("x-brain-password");
  const expectedPassword = Deno.env.get("BRAIN_PASSWORD");
  if (!password || password !== expectedPassword) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Step 1: Run assess-project for all
    const assessRes = await fetch(`${SUPABASE_URL}/functions/v1/assess-project`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-password": password,
      },
      body: JSON.stringify({ mode: "all" }),
    });
    const assessData = await assessRes.json();
    if (!assessRes.ok) {
      return new Response(JSON.stringify({ error: "Assessment failed", details: assessData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Run synthesize-portfolio
    const synthRes = await fetch(`${SUPABASE_URL}/functions/v1/synthesize-portfolio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-password": password,
      },
      body: JSON.stringify({}),
    });
    const synthData = await synthRes.json();
    if (!synthRes.ok) {
      return new Response(JSON.stringify({ error: "Synthesis failed", details: synthData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      data: {
        assessed: assessData?.data?.assessed || 0,
        brief: synthData?.data || null,
      }
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});