import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ServeOptions {
  handler: (req: Request) => Promise<Response>;
  timeoutMs?: number;
}

export function serveWithHealthCheck(options: ServeOptions) {
  const { handler, timeoutMs = 55000 } = options;

  serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const startTime = Date.now();
    console.log(`${req.method} ${url.pathname}`);

    try {
      const timeoutPromise = new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), timeoutMs)
      );

      const handlerPromise = handler(req);

      const response = await Promise.race([handlerPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(`${req.method} ${url.pathname} - ${response.status} (${duration}ms)`);

      return new Response(response.body, {
        status: response.status,
        headers: { ...corsHeaders, ...Object.fromEntries(response.headers) },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Error (${duration}ms):`, error);

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal server error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  });
}