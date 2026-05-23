import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface TestRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  url?: string;
}

export function createTestRequest({
  method = "GET",
  headers = {},
  body,
  url = "http://localhost:8000/test",
}: TestRequest = {}): Request {
  const defaultHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
    ...headers,
  };

  const init: RequestInit = {
    method,
    headers: new Headers(defaultHeaders),
  };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  return new Request(url, init);
}

export interface TestContext {
  req: Request;
  info: {
    remoteAddr: { transport: string; hostname: string; port: number };
  };
}

export function createTestContext(request?: Request): {
  req: Request;
  info: { remoteAddr: { transport: string; hostname: string; port: number } };
} {
  return {
    req: request || createTestRequest(),
    info: {
      remoteAddr: {
        transport: "tcp",
        hostname: "127.0.0.1",
        port: 8000,
      },
    },
  };
}

export function mockSupabaseClient(overrides: Partial<SupabaseClient> = {}): SupabaseClient {
  const mockClient = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
        limit: () => ({
          single: async () => ({ data: null, error: null }),
        }),
        order: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      }),
      insert: async () => ({ data: null, error: null }),
      update: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
      delete: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    }),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
    ...overrides,
  } as unknown as SupabaseClient;

  return mockClient;
}

export async function assertResponseOk(response: Response): Promise<void> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Response not OK: ${response.status} ${response.statusText} - ${text}`);
  }
}

export async function assertResponseStatus(response: Response, expectedStatus: number): Promise<void> {
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status} ${response.statusText} - ${text}`
    );
  }
}

export async function assertResponseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error(`Expected JSON response, got content-type: ${contentType}`);
  }
  return await response.json();
}

export async function assertResponseContains(response: Response, substring: string): Promise<void> {
  const text = await response.text();
  if (!text.includes(substring)) {
    throw new Error(`Response does not contain "${substring}". Got: ${text}`);
  }
}

export function createMockEnv(overrides: Record<string, string> = {}): void {
  const defaults = {
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    ...overrides,
  };

  for (const [key, value] of Object.entries(defaults)) {
    Deno.env.set(key, value);
  }
}

export async function invokeEdgeFunction(
  handler: (req: Request) => Response | Promise<Response>,
  request?: Request
): Promise<Response> {
  const req = request || createTestRequest();
  return await handler(req);
}