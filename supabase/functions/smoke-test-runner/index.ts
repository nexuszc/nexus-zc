import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: {
    type: string;
    isCritical: boolean;
    suggestedFix?: string;
  };
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(error: any, message: string) {
  const errorPatterns = {
    network: /fetch|network|connection|timeout|ECONNREFUSED/i,
    auth: /auth|unauthorized|forbidden|token|jwt/i,
    database: /database|postgres|sql|query/i,
    permission: /permission|access denied|EACCES/i,
    notFound: /not found|ENOENT|404/i,
    memory: /memory|heap|allocation/i,
    timeout: /timeout|timed out|deadline/i
  };

  for (const [type, pattern] of Object.entries(errorPatterns)) {
    if (pattern.test(message)) {
      return {
        type,
        isCritical: ['database', 'auth', 'network'].includes(type),
        suggestedFix: getSuggestedFix(type)
      };
    }
  }

  return {
    type: 'unknown',
    isCritical: false,
    suggestedFix: 'Review error details and check system logs'
  };
}

function getSuggestedFix(errorType: string): string {
  const fixes: Record<string, string> = {
    network: 'Check network connectivity and DNS resolution',
    auth: 'Verify authentication credentials and tokens',
    database: 'Check database connection string and permissions',
    permission: 'Review file/resource permissions',
    notFound: 'Verify file/resource path exists',
    memory: 'Check memory limits and usage patterns',
    timeout: 'Increase timeout values or optimize operations'
  };
  return fixes[errorType] || 'No specific fix available';
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = performance.now();
    const tests: TestResult[] = [];
    const structuralIssues: StructuralIssue[] = [];
    
    const totalSteps = 8;
    let currentStep = 0;

    console.log('='.repeat(60));
    console.log('NEXUS SYSTEM SMOKE TEST');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('');

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✓ Environment variables verified');
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingVars.join(', ')}`,
        errorCategory: {
          type: 'configuration',
          isCritical: true,
          suggestedFix: 'Set missing environment variables in Supabase dashboard'
        }
      });
      console.error('✗ Missing environment variables:', missingVars.join(', '));
    }

    // Test 2: Deno Runtime
    currentStep++;
    const denoTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking Deno runtime...`);
    
    try {
      const version = Deno.version;
      tests.push({
        name: 'Deno Runtime',
        status: 'passed',
        duration_ms: performance.now() - denoTestStart,
        details: `Deno ${version.deno}, V8 ${version.v8}, TypeScript ${version.typescript}`
      });
      console.log(`✓ Deno runtime verified: ${version.deno}`);
    } catch (error) {
      tests.push({
        name: 'Deno Runtime',
        status: 'failed',
        duration_ms: performance.now() - denoTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Deno runtime error:', error.message);
    }

    // Test 3: External API Connectivity
    currentStep++;
    const apiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing external API connectivity...`);
    
    try {
      const response = await fetch('https://api.github.com/zen', {
        method: 'GET',
        headers: { 'User-Agent': 'Nexus-SmokeTest' }
      });
      
      if (response.ok) {
        const data = await response.text();
        tests.push({
          name: 'External API Connectivity',
          status: 'passed',
          duration_ms: performance.now() - apiTestStart,
          details: `GitHub API responded: ${data.substring(0, 50)}...`
        });
        console.log('✓ External API connectivity verified');
      } else {
        tests.push({
          name: 'External API Connectivity',
          status: 'failed',
          duration_ms: performance.now() - apiTestStart,
          error: `HTTP ${response.status}: ${response.statusText}`,
          errorCategory: categorizeError(null, `HTTP ${response.status}`)
        });
        console.error(`✗ External API error: HTTP ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'External API Connectivity',
        status: 'failed',
        duration_ms: performance.now() - apiTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ External API connectivity error:', error.message);
    }

    // Test 4: Supabase Client Initialization
    currentStep++;
    const clientTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Initializing Supabase client...`);
    
    let supabaseClient = null;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (supabaseUrl && supabaseKey) {
        supabaseClient = createClient(supabaseUrl, supabaseKey);
        tests.push({
          name: 'Supabase Client Initialization',
          status: 'passed',
          duration_ms: performance.now() - clientTestStart,
          details: 'Client initialized successfully'
        });
        console.log('✓ Supabase client initialized');
      } else {
        tests.push({
          name: 'Supabase Client Initialization',
          status: 'failed',
          duration_ms: performance.now() - clientTestStart,
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
          errorCategory: categorizeError(null, 'missing credentials')
        });
        console.error('✗ Supabase client initialization failed: missing credentials');
      }
    } catch (error) {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - clientTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Supabase client initialization error:', error.message);
    }

    // Test 5: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
    
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('users')
          .select('count')
          .limit(1);
        
        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: categorizeError(error, error.message)
          });
          console.error('✗ Database connectivity error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Query executed successfully'
          });
          console.log('✓ Database connectivity verified');
        }
      } catch (error) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: categorizeError(error, error.message)
        });
        console.error('✗ Database connectivity error:', error.message);
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
        console.log(`⚠ Structural analysis found ${structuralIssues.length} issues`);
        structuralIssues.forEach(issue => {
          console.log(`  ${issue.severity === 'critical' ? '✗' : '⚠'} ${issue.path}: ${issue.issue}`);
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
    const totalDuration = performance