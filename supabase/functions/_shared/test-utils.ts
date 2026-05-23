import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

export interface TestRequestOptions {
  headers?: Record<string, string>
  auth?: string
}

export function createTestRequest(
  method: string,
  path: string,
  body?: unknown,
  options?: TestRequestOptions
): Request {
  const url = `http://localhost:54321${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers,
  }

  if (options?.auth) {
    headers['Authorization'] = `Bearer ${options.auth}`
  }

  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function validateResponse(
  response: Response,
  expectedStatus: number,
  expectedShape?: Record<string, string>
): Promise<void> {
  if (response.status !== expectedStatus) {
    const text = await response.text()
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}: ${text}`
    )
  }

  if (expectedShape) {
    const data = await response.json()
    
    for (const [key, type] of Object.entries(expectedShape)) {
      if (!(key in data)) {
        throw new Error(`Missing expected key: ${key}`)
      }
      
      const actualType = Array.isArray(data[key]) ? 'array' : typeof data[key]
      if (actualType !== type) {
        throw new Error(
          `Expected ${key} to be ${type}, got ${actualType}`
        )
      }
    }
  }
}

export function setupTestEnv(): void {
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321')
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
}

export function teardownTestEnv(): void {
  Deno.env.delete('SUPABASE_URL')
  Deno.env.delete('SUPABASE_ANON_KEY')
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
}

export function mockSupabaseClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321',
    Deno.env.get('SUPABASE_ANON_KEY') ?? 'test-anon-key'
  )
}

export async function assertNoErrors(response: Response): Promise<void> {
  if (!response.ok) {
    const text = await response.text()
    let errorMessage: string
    
    try {
      const json = JSON.parse(text)
      errorMessage = json.error || json.message || text
    } catch {
      errorMessage = text
    }
    
    throw new Error(`Request failed with status ${response.status}: ${errorMessage}`)
  }
}

export function createMockAuthHeader(userId: string = 'test-user-id'): string {
  const payload = {
    sub: userId,
    role: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  
  const base64Payload = btoa(JSON.stringify(payload))
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${base64Payload}.mock-signature`
}

export async function executeHandler(
  handler: (req: Request) => Promise<Response> | Response,
  request: Request
): Promise<Response> {
  try {
    return await handler(request)
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export function assertResponseHeaders(
  response: Response,
  expectedHeaders: Record<string, string>
): void {
  for (const [key, value] of Object.entries(expectedHeaders)) {
    const actual = response.headers.get(key)
    if (actual !== value) {
      throw new Error(
        `Expected header ${key} to be "${value}", got "${actual}"`
      )
    }
  }
}

export async function parseJsonResponse<T = unknown>(
  response: Response
): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Failed to parse JSON response: ${text}`)
  }
}