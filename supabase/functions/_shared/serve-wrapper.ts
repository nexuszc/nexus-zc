const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

interface ServeOptions {
  timeout?: number;
  logRequests?: boolean;
}

type Handler = (req: Request) => Promise<Response> | Response;

export function serveWithHealthCheck(
  handler: Handler,
  options: ServeOptions = {}
): void {
  const { timeout = 30000, logRequests = true } = options;

  Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const method = req.method;

    if (logRequests) {
      console.log(`${method} ${url.pathname}`);
    }

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    try {
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeout);
      });

      const handlerPromise = Promise.resolve(handler(req));

      const response = await Promise.race([handlerPromise, timeoutPromise]);

      const headers = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error('Handler error:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Internal server error';
      const statusCode = error instanceof Error && error.message === 'Request timeout'
        ? 504
        : 500;

      return new Response(
        JSON.stringify({
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
        {
          status: statusCode,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  });
}