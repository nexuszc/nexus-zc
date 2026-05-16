export const SMOKE_TEST_CONFIG = {
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
  
  endpoints: [
    {
      name: 'Health Check',
      path: '/health',
      method: 'GET' as const,
      expectedStatus: 200,
      optional: false,
      timeout: 5000,
    },
    {
      name: 'Auth Status',
      path: '/auth/v1/health',
      method: 'GET' as const,
      expectedStatus: 200,
      optional: false,
      timeout: 5000,
    },
    {
      name: 'Database Connection',
      path: '/rest/v1/',
      method: 'GET' as const,
      expectedStatus: [200, 401],
      optional: false,
      timeout: 10000,
    },
    {
      name: 'Storage API',
      path: '/storage/v1/healthcheck',
      method: 'GET' as const,
      expectedStatus: 200,
      optional: true,
      timeout: 5000,
    },
  ],

  healthCheckCriteria: {
    minSuccessRate: 0.75,
    requiredEndpoints: ['Health Check', 'Database Connection'],
    allowOptionalFailures: true,
  },

  responseValidation: {
    maxResponseTime: 15000,
    requireJsonResponse: false,
    checkContentType: false,
  },

  skipTests: {
    onColdStart: false,
    onMaintenanceMode: true,
    onRateLimitExceeded: true,
  },

  errorHandling: {
    logLevel: 'warn' as const,
    failFast: false,
    collectMetrics: true,
  },
};

export type EndpointConfig = typeof SMOKE_TEST_CONFIG.endpoints[number];
export type SmokeTestConfig = typeof SMOKE_TEST_CONFIG;