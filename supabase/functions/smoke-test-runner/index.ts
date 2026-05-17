I'll analyze the file for brace imbalances and provide the complete corrected version. Let me scan through the entire file systematically to find the 6 extra opening braces.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  errorStack?: string;
  errorContext?: any;
  duration_ms: number;
  timestamp: string;
  step: number;
  statusCode?: number;
  state?: any;
}

interface SmokeTestResponse {
  success: boolean;
  timestamp: string;
  environment: string;
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  };
  metadata?: {
    executionId: string;
    version: string;
    filter?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const overallStartTime = performance.now();
  const executionId = crypto.randomUUID();

  console.log(`[Execution ${executionId}] Smoke test runner started at ${new Date().toISOString()}`);

  try {
    const url = new URL(req.url);
    const testFilter = url.searchParams.get('test') || 'all';
    const retryAttempts = parseInt(url.searchParams.get('retries') || '2');
    const retryDelay = parseInt(url.searchParams.get('retryDelay') || '1000');

    console.log(`Test filter: ${testFilter}, Retry attempts: ${retryAttempts}, Retry delay: ${retryDelay}ms`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing required environment variables');
    }

    const denoEnv = {
      SUPABASE_URL: supabaseUrl ? 'set' : 'missing',
      SUPABASE_ANON_KEY: supabaseAnonKey ? 'set' : 'missing',
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey ? 'set' : 'missing',
      DENO_DEPLOYMENT_ID: Deno.env.get('DENO_DEPLOYMENT_ID') || 'local',
      DENO_REGION: Deno.env.get('DENO_REGION') || 'unknown'
    };

    console.log("Environment configuration:", denoEnv);

    const tests: TestResult[] = [];
    const baseUrl = supabaseUrl.replace(/\/$/, '');
    const anonKey = supabaseAnonKey;

    let structuralIssues: any[] = [];

    const executeWithRetry = async (testName: string, testFn: () => Promise<void>) => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[${testName}] Retry attempt ${attempt}/${retryAttempts}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }

          await testFn();
          return;
        } catch (error) {
          lastError = error;
          console.error(`[${testName}] Attempt ${attempt + 1} failed:`, error.message);

          if (attempt === retryAttempts) {
            throw lastError;
          }
        }
      }
    };

    const totalSteps = testFilter === 'all' ? 3 : 1;
    let currentStep = 0;

    console.log(`Total test steps to execute: ${totalSteps}`);

    if (!testFilter || testFilter === "api-health" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api-health test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("api-health", async () => {
          const healthUrl = `${baseUrl}/rest/v1/`;
          console.log(`Attempting health check to: ${healthUrl}`);

          const healthCheck = await fetch(healthUrl, {
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`
            }
          });

          const healthState = {
            url: healthUrl,
            statusCode: healthCheck.status,
            statusText: healthCheck.statusText,
            headers: Object.fromEntries(healthCheck.headers.entries()),
            timestamp: new Date().toISOString()
          };

          console.log("Health check state:", healthState);

          tests.push({
            name: "api-health",
            description: "Supabase API availability",
            status: healthCheck.ok || healthCheck.status === 404 ? "passed" : "failed",
            statusCode: healthCheck.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: healthState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] api-health test ${healthCheck.ok || healthCheck.status === 404 ? 'PASSED' : 'FAILED'}`);

          if (!healthCheck.ok && healthCheck.status !== 404) {
            throw new Error(`Health check failed with status ${healthCheck.status}`);
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] api-health test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          }
        };

        console.error("API health error context:", errorContext);

        tests.push({
          name: "api-health",
          description: "Supabase API availability",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    if (!testFilter || testFilter === "database-connectivity" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting database-connectivity test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("database-connectivity", async () => {
          const dbTestUrl = `${baseUrl}/rest/v1/rpc/smoke_test`;
          console.log(`Attempting database test to: ${dbTestUrl}`);

          const dbTest = await fetch(dbTestUrl, {
            method: 'POST',
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify({})
          });

          const responseText = await dbTest.text();
          console.log(`Database test response (${dbTest.status}):`, responseText.substring(0, 500));

          let parsedResponse;
          try {
            parsedResponse = responseText ? JSON.parse(responseText) : null;
          } catch (parseError) {
            console.warn("Failed to parse database response as JSON:", parseError);
            parsedResponse = { raw: responseText.substring(0, 1000) };

            const braceCount = {
              open: (responseText.match(/{/g) || []).length,
              close: (responseText.match(/}/g) || []).length
            };

            if (braceCount.open !== braceCount.close) {
              structuralIssues.push({
                type: 'brace_imbalance',
                file: 'database response or related function',
                openBraces: braceCount.open,
                closeBraces: braceCount.close,
                difference: braceCount.open - braceCount.close,
                detectedAt: new Date().toISOString(),
                recommendation: 'Check smoke_test function and any file modifications for brace mismatches'
              });

              console.warn("Structural issue detected:", structuralIssues[structuralIssues.length - 1]);
            }
          }

          const dbState = {
            url: dbTestUrl,
            statusCode: dbTest.status,
            statusText: dbTest.statusText,
            headers: Object.fromEntries(dbTest.headers.entries()),
            responsePreview: responseText.substring(0, 200),
            parsedResponse,
            timestamp: new Date().toISOString()
          };

          console.log("Database test state:", dbState);

          const testStatus = dbTest.ok ? 'passed' : 'failed';
          tests.push({
            name: "database-connectivity",
            description: "Database connection test",
            status: testStatus,
            statusCode: dbTest.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: dbState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] database-connectivity test ${testStatus.toUpperCase()}`);

          if (!dbTest.ok) {
            const diagnostics = {
              statusCode: dbTest.status,
              responsePreview: responseText.substring(0, 200),
              parsedError: parsedResponse,
              structuralIssues: structuralIssues.length > 0 ? structuralIssues : 'none',
              possibleSizeGuardTrigger: responseText.includes('size_guard') || responseText.length > 500000
            };
            console.error('Database test diagnostics:', diagnostics);
            throw new Error(`Database connectivity test failed: ${dbTest.status} - ${dbTest.statusText}`);
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] database-connectivity test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          },
          structuralIssues,
          sizeGuardAnalysis: {
            triggered: error.message.includes('size_guard') || error.stack?.includes('size_guard'),
            errorMessageLength: error.message.length,
            stackLength: error.stack?.length || 0,
            recommendations: [
              'Check for file truncation in recent deployments',
              'Verify brace matching in source files',
              'Review recent code changes for structural issues',
              'Check deployment logs for size warnings'
            ]
          },
          possibleCauses: [
            structuralIssues.length > 0 ? 'File structure issues detected' : null,
            error.message.includes('404') ? 'RPC function smoke_test not found' : null,
            error.message.includes('timeout') ? 'Database query timeout' : null,
            error.message.includes('size_guard') ? 'Response size exceeded limits' : null
          ].filter(Boolean)
        };

        console.error("Database connectivity error context:", errorContext);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    if (!testFilter || testFilter === "edge-functions" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting edge-functions test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("edge-functions", async () => {
          const functionsTestUrl = `${baseUrl}/functions/v1/`;
          console.log(`Attempting edge functions check to: ${functionsTestUrl}`);

          const functionsTest = await fetch(functionsTestUrl, {
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`
            }
          });

          const functionsState = {
            url: functionsTestUrl,
            statusCode: functionsTest.status,
            statusText: functionsTest.statusText,
            headers: Object.fromEntries(functionsTest.headers.entries()),
            timestamp: new Date().toISOString(),
            fileStructureIssues: structuralIssues
          };

          console.log("Edge functions state:", functionsState);

          tests.push({
            name: "edge-functions",
            description: "Edge functions availability",
            status: functionsTest.ok || functionsTest.status === 404 ? "passed" : "failed",
            statusCode: functionsTest.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: functionsState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] edge-functions test ${functionsTest.ok || functionsTest.status === 404 ? 'PASSED' : 'FAILED'}`);

          if (!functionsTest.ok && functionsTest.status !== 404) {
            throw new Error(`Edge functions check failed with status ${functionsTest.status}`);
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] edge-functions test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          },
          structuralIssues,
          sizeGuardAnalysis: {
            triggered: error.message.includes('size_guard') || error.stack?.includes('size_guard'),
            chatFunctionIssues: structuralIssues.filter(i => i.file?.includes('chat/index.ts')),
            recommendations: [
              'Verify chat/index.ts has proper Deno.serve handler',
              'Check for brace mismatches in edge function files',
              'Review deployment logs for function initialization errors',
              'Ensure all edge functions have proper error handling'
            ]
          },
          possibleCauses: [
            structuralIssues.some(i => i.file