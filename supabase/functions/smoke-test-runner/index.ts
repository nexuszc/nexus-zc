import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  const tests: any[] = [];
  const structuralIssues: any[] = [];
  let currentStep = 0;
  const totalSteps = 8;

  try {
    console.log('=== Nexus Smoke Test Suite ===\n');

    // Helper function to categorize errors
    function categorizeError(statusCode: number | null, message: string): string {
      if (!statusCode && message) {
        if (message.includes('not initialized') || message.includes('client')) return 'configuration';
        if (message.includes('network') || message.includes('fetch')) return 'network';
        if (message.includes('timeout')) return 'timeout';
        if (message.includes('permission') || message.includes('denied')) return 'permission';
        return 'unknown';
      }
      
      if (statusCode === null) return 'unknown';
      if (statusCode >= 500) return 'server_error';
      if (statusCode === 404) return 'not_found';
      if (statusCode === 403 || statusCode === 401) return 'authentication';
      if (statusCode >= 400) return 'client_error';
      return 'unknown';
    }

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY',
      'CLAUDE_API_KEY'
    ];

    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required variables present'
      });
      console.log('✓ All environment variables present');
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error('✗ Missing variables:', missingVars.join(', '));
    }

    // Test 2: OpenAI API Connectivity
    currentStep++;
    const openaiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing OpenAI API connectivity...`);
    
    try {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        tests.push({
          name: 'OpenAI API',
          status: 'passed',
          duration_ms: performance.now() - openaiTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✓ OpenAI API accessible');
      } else {
        tests.push({
          name: 'OpenAI API',
          status: 'failed',
          duration_ms: performance.now() - openaiTestStart,
          error: `HTTP ${response.status}: ${response.statusText}`,
          errorCategory: categorizeError(response.status, response.statusText)
        });
        console.error(`✗ OpenAI API error: ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'OpenAI API',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ OpenAI API error:', error.message);
    }

    // Test 3: Claude API Connectivity
    currentStep++;
    const claudeTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Claude API connectivity...`);
    
    try {
      const claudeKey = Deno.env.get('CLAUDE_API_KEY');
      if (!claudeKey) {
        throw new Error('Claude API key not configured');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok || response.status === 400) {
        tests.push({
          name: 'Claude API',
          status: 'passed',
          duration_ms: performance.now() - claudeTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✓ Claude API accessible');
      } else {
        tests.push({
          name: 'Claude API',
          status: 'failed',
          duration_ms: performance.now() - claudeTestStart,
          error: `HTTP ${response.status}: ${response.statusText}`,
          errorCategory: categorizeError(response.status, response.statusText)
        });
        console.error(`✗ Claude API error: ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'Claude API',
        status: 'failed',
        duration_ms: performance.now() - claudeTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Claude API error:', error.message);
    }

    // Test 4: Network Latency
    currentStep++;
    const latencyTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing network latency...`);
    
    try {
      const pingStart = performance.now();
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      });
      const latency = performance.now() - pingStart;
      
      tests.push({
        name: 'Network Latency',
        status: 'passed',
        duration_ms: performance.now() - latencyTestStart,
        details: `Latency: ${latency.toFixed(2)}ms`
      });
      console.log(`✓ Network latency: ${latency.toFixed(2)}ms`);
    } catch (error) {
      tests.push({
        name: 'Network Latency',
        status: 'failed',
        duration_ms: performance.now() - latencyTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Network latency test error:', error.message);
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
        const { data, error } = await supabase
          .from('conversations')
          .select('count')
          .limit(1)
          .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: 'database'
          });
          console.error('✗ Database error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Successfully connected to Supabase'
          });
          console.log('✓ Database connection verified');
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
        details: `Found ${structuralIssues.length} issues`
      });
      
      if (structuralIssues.length === 0) {
        console.log('✓ Structural analysis complete: no issues found');
      } else {
        console.log(`⚠️ Structural analysis found ${structuralIssues.length} issues`);
        structuralIssues.forEach(issue => {
          console.log(`  ${issue.severity === 'critical' ? '✗' : '⚠️'} ${issue.path}: ${issue.issue}`);
        });
      }
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
    const totalDuration = performance.now();
    const passedTests = tests.filter(t => t.status === 'passed').length;
    const failedTests = tests.filter(t => t.status === 'failed').length;
    const totalTests = tests.length;

    const summary = {
      total_tests: totalTests,
      passed: passedTests,
      failed: failedTests,
      success_rate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) + '%' : '0%',
      total_duration_ms: totalDuration,
      timestamp: new Date().toISOString()
    };

    console.log('\n=== Test Summary ===');
    console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
    console.log