import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface ServeOptions {
  timeout?: number;
  healthCheckPath?: string;
}

interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
}

type Handler = (req: Request) => Response | Promise<Response>;

export function serveWithErrorHandling(
  handler: Handler,
  options: ServeOptions = {}
): void {
  const timeout = options.timeout || 30000;
  const healthCheckPath = options.healthCheckPath || "/health";

  serve(async (req: Request): Promise<Response> => {
    try {
      if (!req || !(req instanceof Request)) {
        throw new Error("Invalid request object");
      }

      const url = new URL(req.url);
      
      if (url.pathname === healthCheckPath) {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeout);
      });

      const handlerPromise = Promise.resolve(handler(req));

      const response = await Promise.race([handlerPromise, timeoutPromise]);

      if (!response || !(response instanceof Response)) {
        throw new Error("Handler did not return a valid Response object");
      }

      return response;
    } catch (error) {
      console.error("Error in request handler:", error);

      const errorResponse: ErrorResponse = {
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString(),
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  });
}

export function createJsonResponse(
  data: unknown,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function createErrorResponse(
  message: string,
  status: number = 400
): Response {
  const errorResponse: ErrorResponse = {
    error: status >= 500 ? "Internal Server Error" : "Bad Request",
    message,
    timestamp: new Date().toISOString(),
  };

  return createJsonResponse(errorResponse, status);
}