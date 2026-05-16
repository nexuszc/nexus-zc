const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: unknown;
}

export interface TestRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export async function makeTestRequest(
  url: string,
  options: TestRequestOptions = {}
): Promise<Response> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT,
  errorMessage?: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelay: number = DEFAULT_RETRY_DELAY
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Retry failed with unknown error');
}

export function formatTestResult(result: TestResult): string {
  const status = result.passed ? '✓' : '✗';
  const duration = `${result.duration}ms`;
  
  let output = `${status} ${result.name} (${duration})`;
  
  if (!result.passed && result.error) {
    output += `\n  Error: ${result.error}`;
  }
  
  if (result.details) {
    output += `\n  Details: ${JSON.stringify(result.details, null, 2)}`;
  }
  
  return output;
}

export function formatTestSummary(results: TestResult[]): string {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  let summary = '\n=== Test Summary ===\n';
  summary += `Total: ${total}\n`;
  summary += `Passed: ${passed}\n`;
  summary += `Failed: ${failed}\n`;
  summary += `Duration: ${totalDuration}ms\n`;
  
  if (failed > 0) {
    summary += '\nFailed Tests:\n';
    results
      .filter(r => !r.passed)
      .forEach(r => {
        summary += `  - ${r.name}: ${r.error}\n`;
      });
  }
  
  return summary;
}

export async function runTest(
  name: string,
  testFn: () => Promise<void>,
  timeout: number = DEFAULT_TIMEOUT
): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    await withTimeout(testFn(), timeout, `Test '${name}' timed out`);
    
    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || 'Assertion failed: expected true');
  }
}

export function assertFalse(condition: boolean, message?: string): void {
  if (condition) {
    throw new Error(message || 'Assertion failed: expected false');
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Assertion failed: expected ${expected}, got ${actual}`
    );
  }
}

export function assertNotNull<T>(value: T | null | undefined, message?: string): void {
  if (value === null || value === undefined) {
    throw new Error(message || 'Assertion failed: value is null or undefined');
  }
}

export function assertThrows(fn: () => void, message?: string): void {
  let thrown = false;
  
  try {
    fn();
  } catch {
    thrown = true;
  }
  
  if (!thrown) {
    throw new Error(message || 'Assertion failed: expected function to throw');
  }
}

export async function assertThrowsAsync(
  fn: () => Promise<void>,
  message?: string
): Promise<void> {
  let thrown = false;
  
  try {
    await fn();
  } catch {
    thrown = true;
  }
  
  if (!thrown) {
    throw new Error(message || 'Assertion failed: expected async function to throw');
  }
}

export function assertResponseOk(response: Response, message?: string): void {
  if (!response.ok) {
    throw new Error(
      message || `Response not OK: ${response.status} ${response.statusText}`
    );
  }
}

export function assertStatus(response: Response, expected: number, message?: string): void {
  if (response.status !== expected) {
    throw new Error(
      message || `Expected status ${expected}, got ${response.status}`
    );
  }
}

export async function assertJsonResponse<T>(
  response: Response,
  validator?: (data: T) => boolean
): Promise<T> {
  assertResponseOk(response);
  
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }
  
  const data = await response.json() as T;
  
  if (validator && !validator(data)) {
    throw new Error('JSON response validation failed');
  }
  
  return data;
}