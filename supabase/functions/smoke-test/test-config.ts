export const SMOKE_TEST_CONFIG = {
  timeouts: {
    default: 5000,
    database: 10000,
    external: 15000,
  },
  
  criticalEndpoints: [
    '/health',
    '/api/status',
  ],
  
  healthCheckThresholds: {
    responseTime: 3000,
    cpuUsage: 90,
    memoryUsage: 90,
    errorRate: 0.1,
  },
  
  expectedBehaviors: {
    healthEndpoint: {
      path: '/health',
      expectedStatus: [200, 503],
      requiredFields: ['status'],
      acceptableStatuses: ['healthy', 'degraded', 'unhealthy'],
    },
    
    databaseConnection: {
      maxRetries: 3,
      retryDelay: 1000,
      acceptableErrors: [
        'PGRST301',
        'connection timeout',
        'too many connections',
      ],
    },
    
    authService: {
      expectedStatus: [200, 401, 503],
      acceptableDowntime: true,
      gracefulDegradation: true,
    },
  },
  
  acceptableResponsePatterns: {
    success: {
      statusCodes: [200, 201, 204],
      hasData: true,
    },
    
    serviceUnavailable: {
      statusCodes: [503],
      hasData: false,
      shouldRetry: true,
    },
    
    notFound: {
      statusCodes: [404],
      hasData: false,
      shouldRetry: false,
    },
    
    unauthorized: {
      statusCodes: [401, 403],
      hasData: false,
      shouldRetry: false,
    },
  },
  
  knownIssues: {
    allowPartialFailures: true,
    skipNonCriticalTests: false,
    ignoreWarnings: true,
  },
  
  retryPolicy: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialDelay: 1000,
  },
  
  passingCriteria: {
    minSuccessRate: 0.7,
    criticalEndpointsMustPass: true,
    allowDegradedState: true,
    requireZeroErrors: false,
  },
};

export const isAcceptableResponse = (
  statusCode: number,
  endpoint: string,
  responseBody?: unknown
): boolean => {
  if (statusCode >= 200 && statusCode < 300) return true;
  
  if (endpoint.includes('/health') && statusCode === 503) {
    return true;
  }
  
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }
  
  return false;
};

export const shouldRetryRequest = (
  statusCode: number,
  attempt: number,
  error?: string
): boolean => {
  if (attempt >= SMOKE_TEST_CONFIG.retryPolicy.maxAttempts) {
    return false;
  }
  
  if (statusCode === 503 || statusCode === 502 || statusCode === 504) {
    return true;
  }
  
  if (error && SMOKE_TEST_CONFIG.expectedBehaviors.databaseConnection.acceptableErrors.some(
    acceptableError => error.includes(acceptableError)
  )) {
    return true;
  }
  
  return false;
};

export const getRetryDelay = (attempt: number): number => {
  return SMOKE_TEST_CONFIG.retryPolicy.initialDelay * 
    Math.pow(SMOKE_TEST_CONFIG.retryPolicy.backoffMultiplier, attempt - 1);
};

export const validateTestResults = (results: {
  passed: number;
  failed: number;
  total: number;
  criticalFailures: number;
}): boolean => {
  if (results.criticalFailures > 0 && SMOKE_TEST_CONFIG.passingCriteria.criticalEndpointsMustPass) {
    return false;
  }
  
  const successRate = results.passed / results.total;
  
  if (successRate < SMOKE_TEST_CONFIG.passingCriteria.minSuccessRate) {
    return false;
  }
  
  if (!SMOKE_TEST_CONFIG.passingCriteria.requireZeroErrors && successRate >= SMOKE_TEST_CONFIG.passingCriteria.minSuccessRate) {
    return true;
  }
  
  return results.failed === 0 || SMOKE_TEST_CONFIG.passingCriteria.allowDegradedState;
};