import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

interface DiagnosticResult {
  passed: boolean;
  message: string;
  suggestion?: string;
}

interface DiagnosticReport {
  timestamp: string;
  functionName: string;
  checks: {
    hasDenoServe: DiagnosticResult;
    hasProperStructure: DiagnosticResult;
    hasErrorHandling: DiagnosticResult;
    hasSupabaseClient: DiagnosticResult;
  };
  overallStatus: "pass" | "fail";
  recommendations: string[];
}

async function analyzeFunctionCode(functionName: string): Promise<string | null> {
  try {
    const functionPath = `../../../supabase/functions/${functionName}/index.ts`;
    const content = await Deno.readTextFile(functionPath);
    return content;
  } catch (error) {
    return null;
  }
}

function checkDenoServe(code: string): DiagnosticResult {
  const hasServe = code.includes("Deno.serve") || code.includes("serve(");
  return {
    passed: hasServe,
    message: hasServe
      ? "Function uses Deno.serve()"
      : "Function missing Deno.serve() wrapper",
    suggestion: hasServe
      ? undefined
      : "Wrap your handler logic in Deno.serve((req) => { ... })",
  };
}

function checkProperStructure(code: string): DiagnosticResult {
  const hasResponse = code.includes("new Response") || code.includes("Response(");
  const hasReturn = code.includes("return");
  const isValid = hasResponse && hasReturn;

  return {
    passed: isValid,
    message: isValid
      ? "Function returns proper Response object"
      : "Function may not return proper Response",
    suggestion: isValid
      ? undefined
      : "Ensure handler returns new Response() with proper status and headers",
  };
}

function checkErrorHandling(code: string): DiagnosticResult {
  const hasTryCatch = code.includes("try") && code.includes("catch");
  return {
    passed: hasTryCatch,
    message: hasTryCatch
      ? "Function has error handling"
      : "Function missing error handling",
    suggestion: hasTryCatch
      ? undefined
      : "Add try-catch blocks to handle errors gracefully",
  };
}

function checkSupabaseClient(code: string): DiagnosticResult {
  const hasClient = code.includes("createClient") || code.includes("supabase");
  return {
    passed: hasClient,
    message: hasClient
      ? "Function initializes Supabase client"
      : "Function may not initialize Supabase client",
    suggestion: hasClient
      ? undefined
      : "Initialize Supabase client with createClient() if database access is needed",
  };
}

function generateRecommendations(
  checks: DiagnosticReport["checks"]
): string[] {
  const recommendations: string[] = [];

  if (!checks.hasDenoServe.passed) {
    recommendations.push(
      "Critical: Add Deno.serve() wrapper to make function deployable"
    );
  }

  if (!checks.hasProperStructure.passed) {
    recommendations.push(
      "Important: Ensure function returns new Response() with JSON body"
    );
  }

  if (!checks.hasErrorHandling.passed) {
    recommendations.push("Add try-catch blocks for better error handling");
  }

  if (!checks.hasSupabaseClient.passed) {
    recommendations.push(
      "Consider adding Supabase client if database access is needed"
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("All checks passed - function structure looks good");
  }

  return recommendations;
}

async function runDiagnostics(functionName: string): Promise<DiagnosticReport> {
  const code = await analyzeFunctionCode(functionName);

  if (!code) {
    return {
      timestamp: new Date().toISOString(),
      functionName,
      checks: {
        hasDenoServe: {
          passed: false,
          message: "Could not read function file",
          suggestion: "Ensure function file exists at correct path",
        },
        hasProperStructure: { passed: false, message: "File not found" },
        hasErrorHandling: { passed: false, message: "File not found" },
        hasSupabaseClient: { passed: false, message: "File not found" },
      },
      overallStatus: "fail",
      recommendations: ["Function file not found or not readable"],
    };
  }

  const checks = {
    hasDenoServe: checkDenoServe(code),
    hasProperStructure: checkProperStructure(code),
    hasErrorHandling: checkErrorHandling(code),
    hasSupabaseClient: checkSupabaseClient(code),
  };

  const allPassed = Object.values(checks).every((check) => check.passed);

  return {
    timestamp: new Date().toISOString(),
    functionName,
    checks,
    overallStatus: allPassed ? "pass" : "fail",
    recommendations: generateRecommendations(checks),
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { functionName } = await req.json();

    if (!functionName || typeof functionName !== "string") {
      return new Response(
        JSON.stringify({
          error: "functionName is required and must be a string",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const diagnosticReport = await runDiagnostics(functionName);

    return new Response(JSON.stringify(diagnosticReport), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
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