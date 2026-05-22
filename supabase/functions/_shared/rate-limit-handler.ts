export interface RateLimitError {
  isRateLimit: boolean;
  retryAfter?: number;
  details?: string;
}

export function detectRateLimit(error: any): RateLimitError {
  if (!error) {
    return { isRateLimit: false };
  }

  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();
  const statusCode = error.status || error.statusCode || error.code;

  const isRateLimit =
    statusCode === 429 ||
    statusCode === '429' ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('quota exceeded') ||
    errorMessage.includes('throttle') ||
    errorString.includes('rate limit') ||
    errorString.includes('too many requests');

  let retryAfter: number | undefined;

  if (error.headers?.['retry-after']) {
    const retryAfterValue = error.headers['retry-after'];
    retryAfter = parseInt(retryAfterValue, 10);
    if (isNaN(retryAfter)) {
      retryAfter = undefined;
    }
  }

  if (error.retryAfter) {
    retryAfter = parseInt(error.retryAfter, 10);
  }

  return {
    isRateLimit,
    retryAfter,
    details: errorMessage || errorString,
  };
}

export function exponentialBackoff(
  attempt: number,
  maxAttempts: number = 5,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  if (attempt >= maxAttempts) {
    return 0;
  }

  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attempt),
    maxDelayMs
  );

  const jitter = Math.random() * 0.3 * exponentialDelay;

  return Math.floor(exponentialDelay + jitter);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const { baseDelayMs = 1000, maxDelayMs = 30000, onRetry } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const rateLimitInfo = detectRateLimit(error);

      if (!rateLimitInfo.isRateLimit && attempt === 0) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      let delayMs: number;

      if (rateLimitInfo.isRateLimit && rateLimitInfo.retryAfter) {
        delayMs = rateLimitInfo.retryAfter * 1000;
      } else if (rateLimitInfo.isRateLimit) {
        delayMs = exponentialBackoff(attempt, maxRetries, baseDelayMs * 2, maxDelayMs);
      } else {
        delayMs = exponentialBackoff(attempt, maxRetries, baseDelayMs, maxDelayMs);
      }

      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export function isRetryableError(error: any): boolean {
  const rateLimitInfo = detectRateLimit(error);
  if (rateLimitInfo.isRateLimit) {
    return true;
  }

  const statusCode = error.status || error.statusCode || error.code;
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];

  if (retryableStatusCodes.includes(Number(statusCode))) {
    return true;
  }

  const errorMessage = error.message?.toLowerCase() || '';
  const networkErrors = [
    'network',
    'timeout',
    'econnreset',
    'enotfound',
    'econnrefused',
  ];

  return networkErrors.some((keyword) => errorMessage.includes(keyword));
}