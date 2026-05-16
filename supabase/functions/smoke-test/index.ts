import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface DiagnosticsResponse {
  status: string;
  timestamp: string;
  environment: {
    runtime: string;
    denoVersion?: string;
    supabaseConfigured: boolean;
  };
  database: {
    available: boolean;
    connectionTest?: string;
    tablesChecked?: string[];
    error?: string;
  };
  authentication: {
    serviceAvailable: boolean;
    serviceError?: string;
  };
  storage: {
    available: boolean;
    bucketsChecked?: string[];
    error?: string;
  };
  externalServices: {
    anthropic: {
      configured: boolean;
      available: boolean;
      error?: string;
    };
    email: {
      configured: boolean;
      available: boolean;
      error?: string;
    };
  };
  executionTime?: number;
  logs: Array<{
    level: string;
    message: string;
    timestamp: string;
    data?: any;
  }>;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  const diagnostics: DiagnosticsResponse = {
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: {
      runtime: 'deno',
      denoVersion: Deno.version.deno,
      supabaseConfigured: false,
    },
    database: {
      available: false,
    },
    authentication: {
      serviceAvailable: false,
    },
    storage: {
      available: false,
    },
    externalServices: {
      anthropic: {
        configured: false,
        available: false,
      },
      email: {
        configured: false,
        available: false,
      },
    },
    logs: [],
  };

  const log = (level: string, message: string, data?: any) => {
    diagnostics.logs.push({
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  };

  try {
    log('info', 'Starting smoke test');

    // Check environment configuration
    log('info', 'Checking environment configuration');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const resendKey = Deno.env.get('RESEND_API_KEY');

    diagnostics.environment.supabaseConfigured = !!(supabaseUrl && (supabaseServiceKey || supabaseAnonKey));
    diagnostics.externalServices.anthropic.configured = !!anthropicKey;
    diagnostics.externalServices.email.configured = !!resendKey;

    log('info', 'Environment configuration checked', {
      supabaseConfigured: diagnostics.environment.supabaseConfigured,
      anthropicConfigured: diagnostics.externalServices.anthropic.configured,
      emailConfigured: diagnostics.externalServices.email.configured,
    });

    // Test database connectivity
    log('info', 'Starting database connectivity check');
    try {
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        // Try to query a basic table to test connectivity
        const { data: tables, error: tableError } = await supabase
          .from('profiles')
          .select('id')
          .limit(1);

        if (tableError) {
          diagnostics.database.available = false;
          diagnostics.database.error = tableError.message;
          diagnostics.database.connectionTest = 'failed';
          log('warn', 'Database query failed', { error: tableError.message });
        } else {
          diagnostics.database.available = true;
          diagnostics.database.tablesChecked = ['profiles'];
          diagnostics.database.connectionTest = 'success';
          log('info', 'Database connectivity successful');
        }

        // Try additional tables if first one succeeded
        if (diagnostics.database.available) {
          const additionalTables = ['workspaces', 'conversation_threads'];
          for (const table of additionalTables) {
            try {
              const { error } = await supabase.from(table).select('id').limit(1);
              if (!error) {
                diagnostics.database.tablesChecked?.push(table);
              }
            } catch (e) {
              // Silently continue if table doesn't exist
            }
          }
          log('info', 'Additional tables checked', { tables: diagnostics.database.tablesChecked });
        }

        // If we couldn't access any tables, mark as failed
        if (!diagnostics.database.tablesChecked || diagnostics.database.tablesChecked.length === 0) {
          diagnostics.database.available = false;
          if (!diagnostics.database.error) {
            diagnostics.database.connectionTest = 'failed';
            log('error', 'Database connectivity failed - no tables accessible');
          }
        } else {
          diagnostics.database.connectionTest = 'skipped_missing_credentials';
          log('warn', 'Database check skipped - missing credentials');
        }
      } catch (dbError) {
        diagnostics.database.available = false;
        diagnostics.database.error = dbError.message || 'Unknown database error';
        diagnostics.database.connectionTest = 'error';
        log('error', 'Database check error', { error: dbError.message, stack: dbError.stack });
      }

      // Test auth service
      log('info', 'Starting auth service check');
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

        if (supabaseUrl && supabaseKey) {
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
          const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          });

          // Try to get session (will return null but tests auth service availability)
          const { data, error } = await supabase.auth.getSession();
          
          if (error && error.message !== 'Auth session missing!') {
            diagnostics.authentication.serviceError = error.message;
            log('warn', 'Auth service check warning', { error: error.message });
          } else {
            diagnostics.authentication.serviceAvailable = true;
            log('info', 'Auth service accessible');
          }
        }
      } catch (authError) {
        diagnostics.authentication.serviceError = authError.message;
        log('error', 'Auth service check error', { error: authError.message });
      }

      // Test storage service
      log('info', 'Starting storage service check');
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

        if (supabaseUrl && supabaseKey) {
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
          const supabase = createClient(supabaseUrl, supabaseKey);

          // List buckets to test storage availability
          const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
          
          if (storageError) {
            diagnostics.storage.error = storageError.message;
            log('warn', 'Storage service check failed', { error: storageError.message });
          } else {
            diagnostics.storage.available = true;
            diagnostics.storage.bucketsChecked = buckets?.map(b => b.name) || [];
            log('info', 'Storage service accessible', { buckets: diagnostics.storage.bucketsChecked });
          }
        }
      } catch (storageError) {
        diagnostics.storage.error = storageError.message;
        log('error', 'Storage service check error', { error: storageError.message });
      }

      // Test Anthropic API if configured
      if (diagnostics.externalServices.anthropic.configured) {
        log('info', 'Starting Anthropic API check');
        try {
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          
          // Make a minimal API call to verify connectivity
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey!,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'test' }],
            }),
          });

          if (response.ok || response.status === 400) {
            // 400 is acceptable as it means API is reachable
            diagnostics.externalServices.anthropic.available = true;
            log('info', 'Anthropic API accessible');
          } else {
            diagnostics.externalServices.anthropic.error = `HTTP ${response.status}`;
            log('warn', 'Anthropic API check failed', { status: response.status });
          }
        } catch (anthropicError) {
          diagnostics.externalServices.anthropic.error = anthropicError.message;
          log('error', 'Anthropic API check error', { error: anthropicError.message });
        }
      } else {
        log('info', 'Anthropic API check skipped - not configured');
      }

      // Test email service if configured
      if (diagnostics.externalServices.email.configured) {
        log('info', 'Starting email service check');
        try {
          const resendKey = Deno.env.get('RESEND_API_KEY');
          
          // Verify API key format and test endpoint
          const response = await fetch('https://api.resend.com/emails', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
            },
          });

          if (response.ok || response.status === 401) {
            // 401 might indicate API key issue but service is reachable
            diagnostics.externalServices.email.available = true;
            log('info', 'Email service accessible');
          } else {
            diagnostics.externalServices.email.error = `HTTP ${response.status}`;
            log('warn', 'Email service check failed', { status: response.status });
          }
        } catch (emailError) {
          diagnostics.externalServices.email.error = emailError.message;
          log('error', 'Email service check error', { error: emailError.message });
        }
      } else {
        log('info', 'Email service check skipped - not configured');
      }

      // Calculate response time
      diagnostics.executionTime = Date.now() - startTime;

      // Determine overall status
      const criticalServicesUp = diagnostics.database.available || diagnostics.authentication.serviceAvailable;
      diagnostics.status = criticalServicesUp ? 'healthy' : 'degraded';

      log('info', 'Smoke test completed', { 
        status: diagnostics.status, 
        executionTime: diagnostics.executionTime 
      });

    } catch (error) {
      log('error', 'Smoke test error', { error: error.message, stack: error.stack });
      diagnostics.status = 'error';
      diagnostics.executionTime = Date.now() - startTime;
      
      return new Response(
        JSON.stringify(diagnostics),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          },
        }
      );
    }

    return new Response(
      JSON.stringify(diagnostics),
      {
        status: diagnostics.status === 'healthy' ? 200 : 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      }
    );

  } catch (error) {
    log('error', 'Unexpected error in smoke test', { error: error.message, stack: error.stack });
    diagnostics.status = 'error';
    diagnostics.executionTime = Date.now() - startTime;

    return new Response(
      JSON.stringify(diagnostics),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      }
    );
  }
});