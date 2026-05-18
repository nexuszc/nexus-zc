import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: string;
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(statusCode: number | null, errorMessage: string): string {
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 403) return 'PERMISSION_DENIED';
  if (statusCode === 500) return 'SERVER_ERROR';
  if (statusCode === 502 || statusCode === 503) return 'SERVICE_UNAVAILABLE';
  if (errorMessage.includes('timeout')) return 'TIMEOUT';
  if (errorMessage.includes('network')) return 'NETWORK_ERROR';
  if (errorMessage.includes('connection')) return 'CONNECTION_ERROR';
  if (errorMessage.includes('not found')) return 'NOT_FOUND';
  if (errorMessage.includes('permission')) return 'PERMISSION_DENIED';
  return 'UNKNOWN';
}

Deno.serve(async (req) => {
  try {
    const tests: TestResult[] = [];
    const structuralIssues: StructuralIssue[] = [];
    const totalSteps = 8;
    let currentStep = 0;

    console.log('=== NEXUS SMOKE TEST SUITE ===');
    console.log('Starting comprehensive system tests...');
    console.log('');

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY'
    ];
    
    const missingVars: string[] = [];
    for (const varName of requiredEnvVars) {
      if (!Deno.env.get(varName)) {
        missingVars.push(varName);
      }
    }
    
    if (missingVars.length > 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingVars.join(', ')}`,
        errorCategory: 'CONFIGURATION_ERROR'
      });
      console.error('✗ Missing environment variables:', missingVars.join(', '));
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✓ All required environment variables present');
    }

    // Test 2: Edge Function Health
    currentStep++;
    const healthTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing edge function health...`);
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !anonKey) {
        tests.push({
          name: 'Edge Function Health',
          status: 'skipped',
          duration_ms: performance.now() - healthTestStart,
          details: 'Credentials not available'
        });
        console.log('⊘ Edge function health test skipped (credentials not available)');
      } else {
        const healthResponse = await fetch(`${supabaseUrl}/functions/v1/health`, {
          headers: { 'Authorization': `Bearer ${anonKey}` }
        });
        
        if (healthResponse.ok) {
          tests.push({
            name: 'Edge Function Health',
            status: 'passed',
            duration_ms: performance.now() - healthTestStart,
            details: `Status: ${healthResponse.status}`
          });
          console.log('✓ Edge function health check passed');
        } else {
          tests.push({
            name: 'Edge Function Health',
            status: 'failed',
            duration_ms: performance.now() - healthTestStart,
            error: `HTTP ${healthResponse.status}`,
            errorCategory: categorizeError(healthResponse.status, '')
          });
          console.error('✗ Edge function health check failed:', healthResponse.status);
        }
      }
    } catch (error) {
      tests.push({
        name: 'Edge Function Health',
        status: 'failed',
        duration_ms: performance.now() - healthTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Edge function health error:', error.message);
    }

    // Test 3: External API Connectivity (OpenAI)
    currentStep++;
    const openaiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing OpenAI connectivity...`);
    
    try {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      
      if (!openaiKey) {
        tests.push({
          name: 'OpenAI Connectivity',
          status: 'skipped',
          duration_ms: performance.now() - openaiTestStart,
          details: 'API key not configured'
        });
        console.log('⊘ OpenAI connectivity test skipped (API key not configured)');
      } else {
        const openaiResponse = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (openaiResponse.ok) {
          tests.push({
            name: 'OpenAI Connectivity',
            status: 'passed',
            duration_ms: performance.now() - openaiTestStart,
            details: 'API connection successful'
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

    // Test 4: External API Connectivity (Anthropic)
    currentStep++;
    const anthropicTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Anthropic connectivity...`);
    
    try {
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      
      if (!anthropicKey) {
        tests.push({
          name: 'Anthropic Connectivity',
          status: 'skipped',
          duration_ms: performance.now() - anthropicTestStart,
          details: 'API key not configured'
        });
        console.log('⊘ Anthropic connectivity test skipped (API key not configured)');
      } else {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          })
        });
        
        if (anthropicResponse.ok || anthropicResponse.status === 400) {
          tests.push({
            name: 'Anthropic Connectivity',
            status: 'passed',
            duration_ms: performance.now() - anthropicTestStart,
            details: 'API connection successful'
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
        details: