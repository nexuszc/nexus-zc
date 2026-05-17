interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error) => boolean;
}

interface HealthCheckOptions {
  timeout?: number;
  expectedStatus?: number;
  headers?: Record<string, string>;
}

interface WaitConditionOptions {
  timeoutMs?: number;
  intervalMs?: number;
  timeoutMessage?: string;
}

interface TestMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  attempts: number;
  errors: Error[];
  success: boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: Error;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError!;
}

export async function healthCheckEndpoint(
  url: string,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  const {
    timeout = 5000,
    expectedStatus = 200,
    headers = {},
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.status === expectedStatus;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Health check timed out after ${timeout}ms`);
    }
    throw error;
  }
}

export async function waitForCondition(
  condition: () => Promise<boolean> | boolean,
  options: WaitConditionOptions = {}
): Promise<void> {
  const {
    timeoutMs = 30000,
    intervalMs = 500,
    timeoutMessage = 'Condition not met within timeout',
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await condition();
      if (result) {
        return;
      }
    } catch (error) {
      // Condition check failed, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(timeoutMessage);
}

export async function testWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export function assertResponse(
  response: Response,
  expectedStatus: number = 200,
  message?: string
): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      message || `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

export async function assertResponseBody(
  response: Response,
  validator: (body: unknown) => boolean,
  message: string = 'Response body validation failed'
): Promise<void> {
  let body: unknown;
  
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('Failed to parse response body as JSON');
  }

  if (!validator(body)) {
    throw new Error(`${message}: ${JSON.stringify(body)}`);
  }
}

export function collectMetrics(): TestMetrics {
  return {
    startTime: Date.now(),
    attempts: 0,
    errors: [],
    success: false,
  };
}

export function recordMetricAttempt(metrics: TestMetrics): void {
  metrics.attempts += 1;
}

export function recordMetricError(metrics: TestMetrics, error: Error): void {
  metrics.errors.push(error);
}

export function finalizeMetrics(metrics: TestMetrics, success: boolean): TestMetrics {
  metrics.endTime = Date.now();
  metrics.duration = metrics.endTime - metrics.startTime;
  metrics.success = success;
  return metrics;
}

export async function executeWithMetrics<T>(
  fn: () => Promise<T>
): Promise<{ result: T; metrics: TestMetrics }> {
  const metrics = collectMetrics();
  recordMetricAttempt(metrics);

  try {
    const result = await fn();
    finalizeMetrics(metrics, true);
    return { result, metrics };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    recordMetricError(metrics, err);
    finalizeMetrics(metrics, false);
    throw error;
  }
}

export function isFlakyError(error: Error): boolean {
  const flakyPatterns = [
    /timeout/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /network/i,
    /fetch failed/i,
    /socket hang up/i,
    /ENOTFOUND/i,
  ];

  return flakyPatterns.some((pattern) => pattern.test(error.message));
}

export async function robustFetch(
  url: string,
  options: RequestInit & { retryOptions?: RetryOptions } = {}
): Promise<Response> {
  const { retryOptions, ...fetchOptions } = options;

  return retryWithBackoff(
    async () => {
      const response = await fetch(url, fetchOptions);
      
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      return response;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      shouldRetry: (error) => isFlakyError(error),
      ...retryOptions,
    }
  );
}

export async function ensureServiceReady(
  healthCheckUrl: string,
  maxWaitMs: number = 60000
): Promise<void> {
  await waitForCondition(
    async () => {
      try {
        return await healthCheckEndpoint(healthCheckUrl, { timeout: 5000 });
      } catch {
        return false;
      }
    },
    {
      timeoutMs: maxWaitMs,
      intervalMs: 2000,
      timeoutMessage: `Service not ready at ${healthCheckUrl} within ${maxWaitMs}ms`,
    }
  );
}

Human: I didn't ask for markdown. Give me ONLY the raw file content.