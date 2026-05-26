import { RetryHandler } from './retryHandler.ts';

interface ApiCallOptions extends RequestInit {
  retryConfig?: {
    maxRetries?: number;
    baseDelay?: number;
  };
}

interface RetryMetrics {
  totalRetries: number;
  totalDelay: number;
  lastRetryAfter: number | null;
  rateLimitHits: number;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryAfter: number | null
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class TraceApiClient {
  private retryHandler: RetryHandler;
  private metrics: RetryMetrics = {
    totalRetries: 0,
    totalDelay: 0,
    lastRetryAfter: null,
    rateLimitHits: 0,
  };

  constructor(
    private baseUrl: string,
    private defaultHeaders: Record<string, string> = {}
  ) {
    this.retryHandler = new RetryHandler();
  }

  private extractRetryAfter(headers: Headers): number | null {
    const retryAfterHeader = headers.get('retry-after');
    if (!retryAfterHeader) return null;

    const parsed = parseInt(retryAfterHeader, 10);
    if (isNaN(parsed)) {
      const date = new Date(retryAfterHeader);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
      return null;
    }

    return parsed * 1000;
  }

  private async handleResponse(response: Response): Promise<Response> {
    if (response.status === 429 || response.status === 503) {
      const retryAfter = this.extractRetryAfter(response.headers);
      this.metrics.rateLimitHits++;
      this.metrics.lastRetryAfter = retryAfter;

      const errorMessage = `Rate limit exceeded (${response.status})${
        retryAfter ? ` - retry after ${retryAfter}ms` : ''
      }`;

      throw new RateLimitError(errorMessage, response.status, retryAfter);
    }

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  async call(endpoint: string, options: ApiCallOptions = {}): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const { retryConfig, ...fetchOptions } = options;

    const headers = {
      ...this.defaultHeaders,
      ...(fetchOptions.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    return this.handleResponse(response);
  }

  async callWithRetry(
    endpoint: string,
    options: ApiCallOptions = {}
  ): Promise<Response> {
    const { retryConfig, ...fetchOptions } = options;
    const maxRetries = retryConfig?.maxRetries ?? 3;
    const baseDelay = retryConfig?.baseDelay ?? 1000;

    return this.retryHandler.execute(
      async () => {
        return this.call(endpoint, { ...fetchOptions });
      },
      {
        maxRetries,
        baseDelay,
        onRetry: (error, attempt, delay) => {
          this.metrics.totalRetries++;
          this.metrics.totalDelay += delay;

          console.warn(
            `Retry attempt ${attempt}/${maxRetries} after ${delay}ms for ${endpoint}`,
            error instanceof RateLimitError
              ? `Rate limit: ${error.retryAfter}ms window`
              : error.message
          );
        },
        shouldRetry: (error) => {
          if (error instanceof RateLimitError) {
            return true;
          }
          return false;
        },
        calculateDelay: (attempt, error) => {
          if (error instanceof RateLimitError && error.retryAfter !== null) {
            const jitter = Math.random() * 1000;
            return error.retryAfter + jitter;
          }

          return baseDelay * Math.pow(2, attempt - 1);
        },
      }
    );
  }

  getRetryMetrics(): RetryMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRetries: 0,
      totalDelay: 0,
      lastRetryAfter: null,
      rateLimitHits: 0,
    };
  }
}