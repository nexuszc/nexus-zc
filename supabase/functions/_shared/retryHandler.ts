export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
}

export interface RateLimitError extends Error {
  status?: number;
  headers?: Headers | Record<string, string>;
}

export class RetryHandler {
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly jitterFactor: number;

  constructor(options: RetryOptions = {}) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelay = options.baseDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 60000;
    this.jitterFactor = options.jitterFactor ?? 0.1;
  }

  parseRetryAfter(error: RateLimitError): number | null {
    if (!error.headers) {
      return null;
    }

    let retryAfterValue: string | null = null;

    if (error.headers instanceof Headers) {
      retryAfterValue = error.headers.get('retry-after');
    } else if (typeof error.headers === 'object') {
      retryAfterValue = error.headers['retry-after'] || error.headers['Retry-After'] || null;
    }

    if (!retryAfterValue) {
      return null;
    }

    const numericValue = parseInt(retryAfterValue, 10);
    
    if (isNaN(numericValue)) {
      const date = new Date(retryAfterValue);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
      return null;
    }

    if (numericValue > 1000000) {
      return numericValue;
    }

    return numericValue * 1000;
  }

  calculateBackoff(attempt: number, retryAfter: number | null): number {
    if (retryAfter !== null && retryAfter > 0) {
      const jitter = retryAfter * this.jitterFactor * (Math.random() - 0.5);
      return Math.min(retryAfter + jitter, this.maxDelay);
    }

    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = exponentialDelay * this.jitterFactor * (Math.random() - 0.5);
    const delay = exponentialDelay + jitter;

    return Math.min(delay, this.maxDelay);
  }

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt >= maxRetries) {
          console.error(`[RetryHandler] Max retries (${maxRetries}) exceeded at ${new Date().toISOString()}`);
          throw error;
        }

        const isRateLimitError = 
          (error as RateLimitError).status === 429 ||
          (error as Error).message?.toLowerCase().includes('rate limit') ||
          (error as Error).message?.toLowerCase().includes('too many requests');

        if (!isRateLimitError && attempt > 0) {
          throw error;
        }

        const retryAfter = this.parseRetryAfter(error as RateLimitError);
        const backoffDelay = this.calculateBackoff(attempt, retryAfter);

        console.log(
          `[RetryHandler] Retry attempt ${attempt + 1}/${maxRetries} at ${new Date().toISOString()}. ` +
          `Retry-After: ${retryAfter ? `${retryAfter}ms` : 'not set'}. ` +
          `Backoff delay: ${backoffDelay}ms. ` +
          `Error: ${(error as Error).message}`
        );

        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    throw lastError || new Error('Retry failed with unknown error');
  }
}

export const defaultRetryHandler = new RetryHandler();