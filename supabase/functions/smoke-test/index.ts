Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  // Structured logging helper
  const log = (level: string, message: string, data?: any) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data && { data }),
    };
    console.log(JSON.stringify(logEntry));
  };

  try {
    log('info', 'Starting comprehensive smoke test');

    // Validate environment variables
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const optionalEnvVars = ['ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    
    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    const missingOptionalVars = optionalEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingEnvVars.length > 0) {
      log('error', 'Missing required environment variables', { missing: missingEnvVars });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status: "unhealthy", 
          error: "Missing required environment variables",
          missing: missingEnvVars,
          ts: new Date().toISOString() 
        }),
        { 
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          }
        }
      );
    }

    log('info', 'Environment variables validated', { 
      required: 'all_present',
      missingOptional: missingOptionalVars 
    });

    // Timeout protection - set max execution time
    const timeoutMs = 25000; // 25 seconds for comprehensive checks
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timeout')), timeoutMs);
    });

    // Main health check logic with comprehensive diagnostics
    const healthCheckPromise = (async () => {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        executionTime: 0,
        environment: {
          supabaseUrl: !!Deno.env.get('SUPABASE_URL'),
          supabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
          supabaseServiceRoleKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
          anthropicApiKey: !!Deno.env.get('ANTHROPIC_API_KEY'),
          resendApiKey: !!Deno.env.get('RESEND_API_KEY'),
          supabaseUrlValue: Deno.env.get('SUPABASE_URL') || 'NOT_SET',
          missingOptional: missingOptionalVars,
        },
        runtime: {
          denoVersion: Deno.version.deno,
          v8Version: Deno.version.v8,
          typescript: Deno.version.typescript,
        },
        memory: {
          available: true,
        },
        database: {
          available: false,
          error: null,
          connectionTest: 'not_attempted',
          responseTime: 0,
          tablesChecked: [],
        },
        authentication: {
          headerPresent: false,
          headerValue: null,
          serviceAvailable: false,
          serviceError: null,
        },
        storage: {
          available: false,
          error: null,
          bucketsChecked: [],
        },
        edgeFunction: {
          healthy: true,
          canServeRequests: true,
        },
        externalServices: {
          anthropic: {
            configured: !!Deno.env.get('ANTHROPIC_API_KEY'),
            available: false,
            error: null,
          },
          email: {
            configured: !!Deno.env.get('RESEND_API_KEY'),
            available: false,
            error: null,
          },
        },
        criticalTables: {
          profiles: { exists: false, error: null },
          nexus_memory: { exists: false, error: null },
          conversations: { exists: false, error: null },
        },
      };

      // Check authentication header
      const authHeader = req.headers.get('authorization');
      diagnostics.authentication.headerPresent = !!authHeader;
      if (authHeader) {
        diagnostics.authentication.headerValue = authHeader.substring(0, 20) + '...';
      }

      log('info', 'Starting database connectivity check');

      // Test database connectivity
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

        if (supabaseUrl && supabaseKey) {
          diagnostics.database.connectionTest = 'attempting';
          
          // Import Supabase client
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
          
          const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          });

          const dbStartTime = Date.now();

          // Test profiles table
          log('info', 'Checking profiles table');
          try {
            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id')
              .limit(1);

            if (profilesError) {
              diagnostics.criticalTables.profiles.error = profilesError.message;
              log('warn', 'Profiles table check failed', { error: profilesError.message });
            } else {
              diagnostics.criticalTables.profiles.exists = true;
              diagnostics.database.tablesChecked.push('profiles');
              log('info', 'Profiles table accessible');
            }
          } catch (profilesErr) {
            diagnostics.criticalTables.profiles.error = profilesErr.message;
            log('error', 'Profiles table error', { error: profilesErr.message });
          }

          // Test nexus_memory table
          log('info', 'Checking nexus_memory table');
          try {
            const { data: memoryData, error: memoryError } = await supabase
              .from('nexus_memory')
              .select('id')
              .limit(1);

            if (memoryError) {
              diagnostics.criticalTables.nexus_memory.error = memoryError.message;
              log('warn', 'Nexus memory table check failed', { error: memoryError.message });
            } else {
              diagnostics.criticalTables.nexus_memory.exists = true;
              diagnostics.database.tablesChecked.push('nexus_memory');
              log('info', 'Nexus memory table accessible');
            }
          } catch (memoryErr) {
            diagnostics.criticalTables.nexus_memory.error = memoryErr.message;
            log('error', 'Nexus memory table error', { error: memoryErr.message });
          }

          // Test conversations table
          log('info', 'Checking conversations table');
          try {
            const { data: convData, error: convError } = await supabase
              .from('conversations')
              .select('id')
              .limit(1);

            if (convError) {
              diagnostics.criticalTables.conversations.error = convError.message;
              log('warn', 'Conversations table check failed', { error: convError.message });
            } else {
              diagnostics.criticalTables.conversations.exists = true;
              diagnostics.database.tablesChecked.push('conversations');
              log('info', 'Conversations table accessible');
            }
          } catch (convErr) {
            diagnostics.criticalTables.conversations.error = convErr.message;
            log('error', 'Conversations table error', { error: convErr.message });
          }

          diagnostics.database.responseTime = Date.now() - dbStartTime;

          // If at least one table is accessible, consider database available
          if (diagnostics.database.tablesChecked.length > 0) {
            diagnostics.database.available = true;
            diagnostics.database.connectionTest = 'success';
            log('info', 'Database connectivity verified', { 
              tablesChecked: diagnostics.database.tablesChecked.length,
              responseTime: diagnostics.database.responseTime 
            });
          } else {
            diagnostics.database.available = false;
            diagnostics.database.error = 'No tables accessible';
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
      diagnostics.executionTime = Date.