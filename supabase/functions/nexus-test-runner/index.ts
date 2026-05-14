import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
}

interface TestRunResult {
  success: boolean;
  suites: TestSuite[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  timestamp: string;
}

async function discoverTests(): Promise<string[]> {
  const testFiles: string[] = [];
  
  try {
    const testDirs = ['./tests', './test'];
    
    for (const dir of testDirs) {
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))) {
            testFiles.push(`${dir}/${entry.name}`);
          }
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error('Error discovering tests:', error);
  }
  
  return testFiles;
}

async function executeTest(testPath: string): Promise<TestSuite> {
  const suiteName = testPath.split('/').pop() || testPath;
  const tests: TestResult[] = [];
  
  try {
    const startTime = performance.now();
    const module = await import(testPath);
    const duration = performance.now() - startTime;
    
    if (typeof module.default === 'function') {
      try {
        await module.default();
        tests.push({
          name: 'default',
          status: 'passed',
          duration
        });
      } catch (error) {
        tests.push({
          name: 'default',
          status: 'failed',
          duration,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    for (const [key, value] of Object.entries(module)) {
      if (typeof value === 'function' && key !== 'default') {
        const testStartTime = performance.now();
        try {
          await value();
          tests.push({
            name: key,
            status: 'passed',
            duration: performance.now() - testStartTime
          });
        } catch (error) {
          tests.push({
            name: key,
            status: 'failed',
            duration: performance.now() - testStartTime,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  } catch (error) {
    tests.push({
      name: suiteName,
      status: 'failed',
      duration: 0,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return {
    name: suiteName,
    tests
  };
}

async function runAllTests(): Promise<TestRunResult> {
  const startTime = performance.now();
  const testFiles = await discoverTests();
  const suites: TestSuite[] = [];
  
  for (const testFile of testFiles) {
    const suite = await executeTest(testFile);
    suites.push(suite);
  }
  
  const allTests = suites.flatMap(suite => suite.tests);
  const summary = {
    total: allTests.length,
    passed: allTests.filter(t => t.status === 'passed').length,
    failed: allTests.filter(t => t.status === 'failed').length,
    skipped: allTests.filter(t => t.status === 'skipped').length,
    duration: performance.now() - startTime
  };
  
  return {
    success: summary.failed === 0,
    suites,
    summary,
    timestamp: new Date().toISOString()
  };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    const result = await runAllTests();
    
    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Test runner error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});