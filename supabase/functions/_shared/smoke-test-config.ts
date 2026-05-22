export const SMOKE_TEST_CONFIG = {
  timeouts: {
    short: 5000,
    medium: 10000,
    long: 30000,
    extended: 60000,
  },
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: true,
  },
  rateLimiting: {
    requestsPerSecond: 2,
    burstSize: 5,
    cooldownPeriod: 5000,
    backoffOnError: true,
    exponentialBackoff: true,
  },
  endpoints: {
    priorities: {
      critical: ['health', 'auth', 'database'],
      high: ['agent-chat', 'search'],
      medium: ['analytics', 'notifications'],
      low: ['audit-logs', 'metrics'],
    },
    order: [
      'health',
      'auth',
      'database',
      'agent-chat',
      'search',
      'analytics',
      'notifications',
      'audit-logs',
      'metrics',
    ],
  },
  errorHandling: {
    ignoreStatusCodes: [429, 503],
    retryStatusCodes: [408, 429, 500, 502, 503, 504],
    failFastStatusCodes: [401, 403, 404],
    captureErrors: true,
    logErrors: true,
  },
  concurrency: {
    maxParallel: 2,
    batchSize: 3,
    delayBetweenBatches: 2000,
  },
};

export function getRetryDelay(attempt: number): number {
  const { initialDelay, maxDelay, backoffMultiplier, jitter } = SMOKE_TEST_CONFIG.retry;
  
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
  delay = Math.min(delay, maxDelay);
  
  if (jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }
  
  return Math.floor(delay);
}

export function shouldRetry(statusCode: number, attempt: number): boolean {
  const { maxAttempts } = SMOKE_TEST_CONFIG.retry;
  const { retryStatusCodes, failFastStatusCodes } = SMOKE_TEST_CONFIG.errorHandling;
  
  if (attempt >= maxAttempts) {
    return false;
  }
  
  if (failFastStatusCodes.includes(statusCode)) {
    return false;
  }
  
  return retryStatusCodes.includes(statusCode);
}

export function getRateLimitDelay(attempt: number): number {
  const { cooldownPeriod, exponentialBackoff } = SMOKE_TEST_CONFIG.rateLimiting;
  
  if (!exponentialBackoff) {
    return cooldownPeriod;
  }
  
  return getRetryDelay(attempt);
}

export function getTimeoutForEndpoint(endpoint: string): number {
  const { priorities } = SMOKE_TEST_CONFIG.endpoints;
  const { timeouts } = SMOKE_TEST_CONFIG;
  
  if (priorities.critical.includes(endpoint)) {
    return timeouts.short;
  }
  
  if (priorities.high.includes(endpoint)) {
    return timeouts.medium;
  }
  
  if (priorities.medium.includes(endpoint)) {
    return timeouts.long;
  }
  
  return timeouts.extended;
}

export function shouldIgnoreError(statusCode: number): boolean {
  return SMOKE_TEST_CONFIG.errorHandling.ignoreStatusCodes.includes(statusCode);
}

export function getEndpointPriority(endpoint: string): number {
  const { order } = SMOKE_TEST_CONFIG.endpoints;
  const index = order.indexOf(endpoint);
  return index === -1 ? 999 : index;
}