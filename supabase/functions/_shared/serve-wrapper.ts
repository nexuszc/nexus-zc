import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ServeOptions {
  timeout?: number;
  logRequests?: boolean;
}

export function serveWithErrorHandling(
  handler: (req: Request) => Promise<Response>,
  options: ServeOptions = {}
) {
  const { timeout = 55000, logRequests = true } = options;

  return serve(async (req: Request) => {
    const startTime = Date.now();
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      if (logRequests) {
        console.log(`${req.method} ${pathname}`);
      }

      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeout);
      });

      const response = await Promise.race([handler(req), timeoutPromise]);

      const duration = Date.now() - startTime;
      if (logRequests) {
        console.log(`${req.method} ${pathname} - ${response.status} (${duration}ms)`);
      }

      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Error handling ${req.method} ${pathname}:`, error);
      console.error(`Duration: ${duration}ms`);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const statusCode = error instanceof Error && error.message === "Request timeout" ? 504 : 500;

      return new Response(
        JSON.stringify({
          error: errorMessage,
          details: error instanceof Error ? error.stack : undefined,
        }),
        {
          status: statusCode,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}