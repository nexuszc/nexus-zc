import { corsHeaders } from "./cors.ts";

type Handler = (req: Request) => Promise<Response> | Response;

interface ServeOptions {
  handler: Handler;
  timeoutMs?: number;
}

export function serveWithHealthCheck(options: ServeOptions) {
  const { handler, timeoutMs = 30000 } = options;

  return Deno.serve(async (req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
      });

      const handlerPromise = handler(req);
      const response = await Promise.race([handlerPromise, timeoutPromise]);

      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        if (!responseHeaders.has(key)) {
          responseHeaders.set(key, value);
        }
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Request handler error:", error);

      const errorMessage = error instanceof Error ? error.message : "Internal server error";
      const statusCode = error instanceof Error && error.message === "Request timeout" ? 504 : 500;

      return new Response(
        JSON.stringify({
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
        {
          status: statusCode,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  });
}