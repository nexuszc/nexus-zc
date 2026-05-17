import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

interface DiagnosticResult {
  timestamp: string;
  status: string;
  failedFunctions: string[];
  errorPatterns: {
    pattern: string;
    count: number;
    affectedFunctions: string[];
  }[];
  deploymentStatus: {
    function: string;
    status: string;
    lastDeployed: string;
    error?: string;
  }[];
  smokeTestResults: {
    function: string;
    passed: boolean;
    error?: string;
    responseTime?: number;
  }[];
  systemHealth: {
    databaseConnections: number;
    storageStatus: string;
    edgeFunctionStatus: string;
  };
  suggestedFixes: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const diagnosticResult: DiagnosticResult = {
      timestamp: new Date().toISOString(),
      status: "running",
      failedFunctions: [],
      errorPatterns: [],
      deploymentStatus: [],
      smokeTestResults: [],
      systemHealth: {
        databaseConnections: 0,
        storageStatus: "unknown",
        edgeFunctionStatus: "unknown",
      },
      suggestedFixes: [],
    };

    const functions = [
      "execute-python",
      "infer-next-node",
      "nexus-agent",
      "nexus-health",
      "smoke-test",
      "update-graph-state",
      "build-failure-diagnostics",
    ];

    for (const funcName of functions) {
      try {
        const testUrl = `${supabaseUrl}/functions/v1/${funcName}`;
        const startTime = Date.now();
        
        const response = await fetch(testUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ test: true }),
        });

        const responseTime = Date.now() - startTime;
        const passed = response.status < 500;

        diagnosticResult.smokeTestResults.push({
          function: funcName,
          passed,
          responseTime,
          error: passed ? undefined : `HTTP ${response.status}`,
        });

        if (!passed) {
          diagnosticResult.failedFunctions.push(funcName);
        }

        diagnosticResult.deploymentStatus.push({
          function: funcName,
          status: passed ? "healthy" : "failed",
          lastDeployed: new Date().toISOString(),
          error: passed ? undefined : `HTTP ${response.status}`,
        });
      } catch (error) {
        diagnosticResult.failedFunctions.push(funcName);
        diagnosticResult.smokeTestResults.push({
          function: funcName,
          passed: false,
          error: error.message,
        });
        diagnosticResult.deploymentStatus.push({
          function: funcName,
          status: "error",
          lastDeployed: "unknown",
          error: error.message,
        });
      }
    }

    const errorCounts = new Map<string, { count: number; functions: Set<string> }>();
    diagnosticResult.smokeTestResults.forEach((result) => {
      if (!result.passed && result.error) {
        const pattern = result.error.includes("HTTP") ? "HTTP_ERROR" : 
                       result.error.includes("timeout") ? "TIMEOUT" :
                       result.error.includes("network") ? "NETWORK_ERROR" : "UNKNOWN_ERROR";
        
        if (!errorCounts.has(pattern)) {
          errorCounts.set(pattern, { count: 0, functions: new Set() });
        }
        const entry = errorCounts.get(pattern)!;
        entry.count++;
        entry.functions.add(result.function);
      }
    });

    diagnosticResult.errorPatterns = Array.from(errorCounts.entries()).map(([pattern, data]) => ({
      pattern,
      count: data.count,
      affectedFunctions: Array.from(data.functions),
    }));

    try {
      const { count } = await supabase.from("nexus_graph_states").select("*", { count: "exact", head: true });
      diagnosticResult.systemHealth.databaseConnections = count || 0;
      diagnosticResult.systemHealth.storageStatus = "healthy";
    } catch {
      diagnosticResult.systemHealth.storageStatus = "degraded";
    }

    diagnosticResult.systemHealth.edgeFunctionStatus = 
      diagnosticResult.failedFunctions.length === 0 ? "healthy" :
      diagnosticResult.failedFunctions.length < functions.length / 2 ? "degraded" : "critical";

    if (diagnosticResult.failedFunctions.length > 0) {
      diagnosticResult.suggestedFixes.push("Redeploy failed functions using: supabase functions deploy <function-name>");
      
      if (diagnosticResult.errorPatterns.some(p => p.pattern === "HTTP_ERROR")) {
        diagnosticResult.suggestedFixes.push("Check function code for unhandled exceptions and missing Deno.serve() handlers");
      }
      
      if (diagnosticResult.errorPatterns.some(p => p.pattern === "TIMEOUT")) {
        diagnosticResult.suggestedFixes.push("Optimize function execution time or increase timeout limits");
      }
      
      diagnosticResult.suggestedFixes.push("Review function logs: supabase functions logs <function-name>");
      diagnosticResult.suggestedFixes.push("Verify environment variables are properly set");
    }

    diagnosticResult.status = diagnosticResult.failedFunctions.length === 0 ? "healthy" : "issues_detected";

    return new Response(JSON.stringify(diagnosticResult, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});