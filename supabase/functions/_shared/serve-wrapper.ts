import { corsHeaders } from "./cors.ts";

export interface ServeOptions {
  timeout?: number;
  healthCheckPath?: string;
}

export function serveWithHealthCheck(
  handler: (req: Request) => Promise<Response> | Response,
  options: ServeOptions = {}
) {
  const timeout = options.timeout || 50000;
  const healthCheckPath = options.healthCheckPath || "/health";

  return Deno.serve(async (req: Request) => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (url.pathname === healthCheckPath) {
      return new Response(
        JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    try {
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeout);
      });

      const handlerPromise = Promise.resolve(handler(req));
      const response = await Promise.race([handlerPromise, timeoutPromise]);

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
      console.error("Error in handler:", error);

      const isTimeout = error instanceof Error && error.message === "Request timeout";
      const status = isTimeout ? 504 : 500;
      const message = isTimeout ? "Request timeout" : "Internal server error";

      return new Response(
        JSON.stringify({
          error: message,
          details: error instanceof Error ? error.message : String(error),
        }),
        {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  });
}