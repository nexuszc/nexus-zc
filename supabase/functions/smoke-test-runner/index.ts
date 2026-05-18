import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

function categorizeError(statusCode: number | null, message: string): string {
  if (message.includes('ECONNREFUSED') || message.includes('network')) return 'network_error';
  if (message.includes('timeout')) return 'timeout_error';
  if (message.includes('permission') || message.includes('unauthorized')) return 'permission_error';
  if (message.includes('not found') || statusCode === 404) return 'not_found_error';
  if (statusCode && statusCode >= 500) return 'server_error';
  if (statusCode && statusCode >= 400) return 'client_error';
  if (message.includes('configuration') || message.includes('not configured')) return 'configuration_error';
  return 'unknown_error';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const tests: any[] = [];
    const structuralIssues: any[] = [];
    let currentStep = 0;
    const totalSteps = 8;

    console.log('🚀 Starting smoke test suite...');

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);

    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

    if (missingEnvVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables are set'
      });
      console.log('✓ All environment variables configured');
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingEnvVars.join(', ')}`,
        errorCategory: 'configuration_error'
      });
      console.error('✗ Missing environment variables:', missingEnvVars.join(', '));
    }

    // Test 2: Network Connectivity
    currentStep++;
    const netTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing network connectivity...`);

    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        tests.push({
          name: 'Network Connectivity',
          status: 'passed',
          duration_ms: performance.now() - netTestStart,
          details: 'External network access verified'
        });
        console.log('✓ Network connectivity verified');
      } else {
        tests.push({
          name: 'Network Connectivity',
          status: 'failed',
          duration_ms: performance.now() - netTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: categorizeError(response.status, '')
        });
        console.error('✗ Network connectivity failed:', response.status);
      }
    } catch (error) {
      tests.push({
        name: 'Network Connectivity',
        status: 'failed',
        duration_ms: performance.now() - netTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Network connectivity error:', error.message);
    }

    // Test 3: OpenAI Connectivity
    currentStep++;
    const openaiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing OpenAI connectivity...`);

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (openaiApiKey) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`
          },
          signal: AbortSignal.timeout(10000)
        });

        if (openaiResponse.ok) {
          tests.push({
            name: 'OpenAI Connectivity',
            status: 'passed',
            duration_ms: performance.now() - openaiTestStart,
            details: 'OpenAI API access verified'
          });
          console.log('✓ OpenAI connectivity verified');
        } else {
          tests.push({
            name: 'OpenAI Connectivity',
            status: 'failed',
            duration_ms: performance.now() - openaiTestStart,
            error: `HTTP ${openaiResponse.status}`,
            errorCategory: categorizeError(openaiResponse.status, '')
          });
          console.error('✗ OpenAI connectivity failed:', openaiResponse.status);
        }
      } catch (error) {
        tests.push({
          name: 'OpenAI Connectivity',
          status: 'failed',
          duration_ms: performance.now() - openaiTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('✗ OpenAI connectivity error:', error.message);
      }
    } else {
      tests.push({
        name: 'OpenAI Connectivity',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: 'OPENAI_API_KEY not configured',
        errorCategory: 'configuration_error'
      });
    }

    // Test 4: Anthropic Connectivity
    currentStep++;
    const anthropicTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Anthropic connectivity...`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (anthropicApiKey) {
      try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (anthropicResponse.ok || anthropicResponse.status === 400) {
          tests.push({
            name: 'Anthropic Connectivity',
            status: 'passed',
            duration_ms: performance.now() - anthropicTestStart,
            details: 'Anthropic API access verified'
          });
          console.log('✓ Anthropic connectivity verified');
        } else {
          tests.push({
            name: 'Anthropic Connectivity',
            status: 'failed',
            duration_ms: performance.now() - anthropicTestStart,
            error: `HTTP ${anthropicResponse.status}`,
            errorCategory: categorizeError(anthropicResponse.status, '')
          });
          console.error('✗ Anthropic connectivity failed:', anthropicResponse.status);
        }
      } catch (error) {
        tests.push({
          name: 'Anthropic Connectivity',
          status: 'failed',
          duration_ms: performance.now() - anthropicTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('✗ Anthropic connectivity error:', error.message);
      }
    } else {
      tests.push({
        name: 'Anthropic Connectivity',
        status: 'failed',
        duration_ms: performance.now() - anthropicTestStart,
        error: 'ANTHROPIC_API_KEY not configured',
        errorCategory: 'configuration_error'
      });
    }

    // Test 5: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (supabaseUrl && supabaseKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data, error } = await supabase.from('conversations').select('count').limit(1);

        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: categorizeError(null, error.message)
          });
          console.error('✗ Database query error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Database query successful'
          });
          console.log('✓ Database connectivity verified');
        }
      } catch (error) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('✗ Database connection error:', error.message);
      }
    } else {
      tests.push({
        name: 'Database Connectivity',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: 'Supabase client not initialized',
        errorCategory: categorizeError(null, 'client not initialized')
      });
    }

    // Test 6: Memory Usage
    currentStep++;
    const memTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing memory usage...`);

    try {
      const memoryUsage = Deno.memoryUsage();
      const heapUsedMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);

      tests.push({
        name: 'Memory Usage',
        status: 'passed',
        duration_ms: performance.now() - memTestStart,
        details: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`
      });
      console.log(`✓ Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
    } catch (error) {
      tests.push({
        name: 'Memory Usage',
        status: 'failed',
        duration_ms: performance.now() - memTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Memory check error:', error.message);
    }

    // Test 7: File System Access
    currentStep++;
    const fsTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing file system access...`);

    try {
      const tempFile = await Deno.makeTempFile();
      await Deno.writeTextFile(tempFile, 'test');
      const content = await Deno.readTextFile(tempFile);
      await Deno.remove(tempFile);

      tests.push({
        name: 'File System Access',
        status: 'passed',
        duration_ms: performance.now() - fsTestStart,
        details: 'Read/write operations successful'
      });
      console.log('✓ File system access verified');
    } catch (error) {
      tests.push({
        name: 'File System Access',
        status: 'failed',
        duration_ms: performance.now() - fsTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ File system access error:', error.message);
    }

    // Test 8: Structural Analysis
    currentStep++;
    const structuralTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Running structural analysis...`);

    try {
      const criticalPaths = [
        './supabase/functions',
        './src',
        './package.json'
      ];

      for (const path of criticalPaths) {
        try {
          const stat = await Deno.stat(path);
          if (!stat.isDirectory && !stat.isFile) {
            structuralIssues.push({
              severity: 'warning',
              path,
              issue: 'Path exists but is neither file nor directory'
            });
          }
        } catch (error) {
          if (error.name === 'NotFound') {
            structuralIssues.push({
              severity: 'critical',
              path,
              issue: 'Required path not found'
            });
          } else if (error.name === 'PermissionDenied') {
            structuralIssues.push({
              severity: 'warning',
              path,
              issue: 'Permission denied (expected in sandboxed environment)'
            });
          }
        }
      }

      const duration = performance.now() - structuralTestStart;
      tests.push({
        name: 'Structural Analysis',
        status: structuralIssues.filter(i => i.severity === 'critical').length > 0 ? 'failed' : 'passed',
        duration_ms: duration,
        details: structuralIssues.length === 0
          ? 'No structural issues found'
          : `Found ${structuralIssues.length} issue(s)`
      });
      console.log(`✓ Structural analysis completed (${structuralIssues.length} issues found)`);
    } catch (error) {
      tests.push({
        name: 'Structural Analysis',
        status: 'failed',
        duration_ms: performance.now() - structuralTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Structural analysis error:', error.message);
    }

    // Calculate summary
    const passedTests = tests.filter(t => t.status === 'passed').length;
    const failedTests = tests.filter(t => t.status === 'failed').length;
    const totalDuration = tests.reduce((sum, t) => sum + t.duration_ms, 0);

    const summary = {
      total_