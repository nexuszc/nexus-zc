${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('Authentication endpoint returned error', {
          status: response.status,
        });
        return {
          name: 'authentication',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: `Authentication endpoint returned status ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Authentication check passed');
      return {
        name: 'authentication',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Authentication system is operational',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Authentication check timed out');
        return {
          name: 'authentication',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Authentication check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Authentication check failed', error);
    return {
      name: 'authentication',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Authentication check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check external service dependencies
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting external services check');
  
  try {
    // Check internet connectivity with a reliable endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('External service connectivity degraded', {
          status: response.status,
        });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service connectivity may be degraded',
          details: {
            status: response.status,
          },
        };
      }

      logger.info('External services check passed');
      return {
        name: 'external_services',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'External services are accessible',
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.warn('External services check timed out');
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service check timed out',
          error: 'Request timeout after 3 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.warn('External services check encountered error', error);
    return {
      name: 'external_services',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'External service check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check environment configuration
 */
async function checkEnvironment(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting environment check');
  
  try {
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

    const missingVars: string[] = [];
    const presentVars: string[] = [];

    for (const varName of requiredEnvVars) {
      const value = Deno.env.get(varName);
      if (!value) {
        missingVars.push(varName);
      } else {
        presentVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      logger.warn('Missing environment variables', { missing: missingVars });
      return {
        name: 'environment',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Some environment variables are missing',
        details: {
          missing: missingVars,
          present: presentVars,
        },
      };
    }

    logger.info('Environment check passed');
    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'All required environment variables configured',
      details: {
        configured_vars: presentVars.length,
      },
    };
  } catch (error) {
    logger.error('Environment check failed', error);
    return {
      name: 'environment',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Environment check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check edge function availability
 */
async function checkEdgeFunctions(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting edge function availability check');
  
  try {
    // Check if we're running in Deno edge runtime
    const isDenoRuntime = typeof Deno !== 'undefined';
    const hasDenoServe = typeof Deno !== 'undefined' && typeof Deno.serve === 'function';
    
    if (!isDenoRuntime) {
      logger.warn('Not running in Deno runtime');
      return {
        name: 'edge_functions',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Not running in Deno runtime environment',
        error: 'Deno runtime not detected',
      };
    }

    if (!hasDenoServe) {
      logger.warn('Deno.serve not available');
      return {
        name: 'edge_functions',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Deno.serve function not available',
        details: {
          runtime: 'deno',
          serve_available: false,
        },
      };
    }

    logger.info('Edge function availability check passed');
    return {
      name: 'edge_functions',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Edge function runtime is operational',
      details: {
        runtime: 'deno',
        serve_available: true,
      },
    };
  } catch (error) {
    logger.error('Edge function availability check failed', error);
    return {
      name: 'edge_functions',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Edge function availability check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check Supabase client connectivity
 */
async function checkSupabaseClient(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting Supabase client connectivity check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      logger.error('Supabase configuration missing');
      return {
        name: 'supabase_client',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Supabase configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      // Test the REST API endpoint
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('Supabase client returned error', {
          status: response.status,
        });
        return {
          name: 'supabase_client',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: `Supabase client returned status ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Supabase client connectivity check passed');
      return {
        name: 'supabase_client',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Supabase client is connected and operational',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Supabase client check timed out');
        return {
          name: 'supabase_client',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Supabase client check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Supabase client connectivity check failed', error);
    return {
      name: 'supabase_client',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Supabase client connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check database connectivity with detailed error handling
 */
async function checkDatabaseConnectivity(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting database connectivity check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      logger.error('Database configuration missing');
      return {
        name: 'database_connectivity',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      // Execute a simple query to test database connectivity
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/version`, {
        method: 'POST',
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Even if the RPC doesn't exist, a proper connection should return a structured error
      if (response.status === 404) {
        // 404 means the endpoint was reached but RPC doesn't exist - connection is good
        logger.info('Database connectivity check passed (endpoint reached)');
        return {
          name: 'database_connectivity',
          status: 'pass',
          duration_ms: performance.now() - startTime,
          message: 'Database connection is operational',
          details: {
            status: response.status,
            note: 'Connection verified via REST API',
          },
        };
      }

      if (!response.ok && response.status >= 500) {
        logger.error('Database returned server error', {
          status: response.status,
        });
        return {
          name: 'database_connectivity',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: `Database returned server error ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Database connectivity check passed');
      return {
        name: 'database_connectivity',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Database connection is operational',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Database connectivity check timed out');
        return {
          name: 'database_connectivity',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Database connectivity check timed out',
          error: 'Request timeout after 10 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Database connectivity check failed', error);
    return {
      name: 'database_connectivity',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Database connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Aggregates all health checks and determines overall system health
 */
async function performHealthChecks(): Promise<SmokeTestResult> {
  const startTime = performance.now();
  logger.info('Starting comprehensive smoke test');

  try {
    // Run all health checks in parallel for efficiency
    const checks = await Promise.all([
      checkEnvironment(),
      checkEdgeFunctions(),
      checkDatabase(),
      checkAuthentication(),
      checkSupabaseClient(),
      checkDatabaseConnectivity(),
      checkExternalServices(),
    ]);

    const totalDuration = performance.now() - startTime;

    // Determine overall status
    const hasFailures = checks.some(check => check.status === 'fail');
    const hasWarnings = checks.some(check => check.status === 'warn');
    
    let overallStatus: 'pass' | 'warn' | 'fail';
    if (hasFailures) {
      overallStatus = 'fail';
    } else if (hasWarnings) {
      overallStatus = 'warn';
    } else {
      overallStatus = 'pass';
    }

    const result: SmokeTestResult = {
      status: overallStatus,
      timestamp