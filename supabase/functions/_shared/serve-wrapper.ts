import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface ServeOptions {
  corsOrigin?: string;
  logRequests?: boolean;
}

type Handler = (req: Request) => Promise<Response> | Response;

export function serveWithHealthCheck(
  handler: Handler,
  options: ServeOptions = {}
) {
  const {
    corsOrigin = "*",
    logRequests = true,
  } = options;

  const wrappedHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (logRequests) {
      console.log(`${method} ${path}`);
    }

    if (path === "/health" || path === "/_health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": corsOrigin,
          },
        }
      );
    }

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const response = await handler(req);

      if (!response || !(response instanceof Response)) {
        console.error("Handler did not return a valid Response object");
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": corsOrigin,
            },
          }
        );
      }

      const headers = new Headers(response.headers);
      if (!headers.has("Access-Control-Allow-Origin")) {
        headers.set("Access-Control-Allow-Origin", corsOrigin);
      }
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error("Handler error:", error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (logRequests) {
        console.error("Error stack:", errorStack);
      }

      return new Response(
        JSON.stringify({
          error: errorMessage,
          ...(Deno.env.get("ENVIRONMENT") === "development" && { stack: errorStack }),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": corsOrigin,
          },
        }
      );
    }
  };

  serve(wrappedHandler);
}

export function createErrorResponse(
  message: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export function createSuccessResponse(
  data: unknown,
  status: number = 200
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}