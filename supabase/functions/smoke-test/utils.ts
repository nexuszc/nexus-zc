const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const TIMEOUT_MS = 10000;

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < retries - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error('Failed after retries');
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateResponse(
  response: Response,
  expectedStatus?: number
): ValidationResult {
  const errors: string[] = [];

  if (expectedStatus && response.status !== expectedStatus) {
    errors.push(`Expected status ${expectedStatus}, got ${response.status}`);
  }

  if (!response.ok && !expectedStatus) {
    errors.push(`Response not OK: ${response.status} ${response.statusText}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

export function formatTestResult(
  name: string,
  passed: boolean,
  duration: number,
  error?: string,
  details?: Record<string, unknown>
): TestResult {
  return {
    name,
    passed,
    duration: Math.round(duration),
    ...(error && { error }),
    ...(details && { details }),
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = TIMEOUT_MS,
  errorMessage = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}