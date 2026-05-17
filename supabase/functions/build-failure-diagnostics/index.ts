import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface DiagnosticRequest {
  error?: string;
  errorType?: string;
  functionName?: string;
  deploymentId?: string;
  timestamp?: string;
}

interface DiagnosticResponse {
  diagnosis: string;
  errorType: string;
  suggestions: string[];
  documentation: string[];
  severity: "critical" | "high" | "medium" | "low";
}

const commonIssues = [
  {
    pattern: /Deno\.serve/i,
    errorType: "missing_deno_serve",
    diagnosis: "Edge function is missing required Deno.serve() wrapper",
    suggestions: [
      "Wrap your function code with Deno.serve(async (req) => { ... })",
      "Ensure the function exports a handler using Deno.serve()",
      "Example: Deno.serve(async (req) => { return new Response('Hello') })",
    ],
    documentation: [
      "https://supabase.com/docs/guides/functions",
      "https://deno.land/api@v1.35.0?s=Deno.serve",
    ],
    severity: "critical" as const,
  },
  {
    pattern: /import.*from.*npm:/i,
    errorType: "npm_import_issue",
    diagnosis: "NPM package import may not be supported or configured correctly",
    suggestions: [
      "Use Deno-compatible imports from deno.land/x or esm.sh",
      "For NPM packages, use npm: specifier with version",
      "Check if the package has TypeScript types available",
    ],
    documentation: [
      "https://deno.land/manual/node/npm_specifiers",
      "https://supabase.com/docs/guides/functions/import-maps",
    ],
    severity: "high" as const,
  },
  {
    pattern: /CORS|cross-origin/i,
    errorType: "cors_error",
    diagnosis: "CORS configuration issue detected",
    suggestions: [
      "Add CORS headers to your response",
      "Include Access-Control-Allow-Origin header",
      "Handle OPTIONS preflight requests",
    ],
    documentation: [
      "https://supabase.com/docs/guides/functions/cors",
    ],
    severity: "medium" as const,
  },
  {
    pattern: /timeout|deadline/i,
    errorType: "timeout_error",
    diagnosis: "Function execution timeout",
    suggestions: [
      "Optimize database queries",
      "Reduce external API call duration",
      "Consider async processing for long tasks",
      "Check for infinite loops or blocking operations",
    ],
    documentation: [
      "https://supabase.com/docs/guides/functions/limits",
    ],
    severity: "high" as const,
  },
  {
    pattern: /env|environment variable/i,
    errorType: "environment_variable_error",
    diagnosis: "Missing or incorrect environment variable",
    suggestions: [
      "Set required environment variables in Supabase dashboard",
      "Use Deno.env.get() to access environment variables",
      "Verify variable names match exactly",
    ],
    documentation: [
      "https://supabase.com/docs/guides/functions/secrets",
    ],
    severity: "high" as const,
  },
  {
    pattern: /type|typescript/i,
    errorType: "typescript_error",
    diagnosis: "TypeScript type checking error",
    suggestions: [
      "Add proper type definitions",
      "Use @ts-ignore sparingly for quick fixes",
      "Check import paths and module resolution",
    ],
    documentation: [
      "https://deno.land/manual/typescript",
    ],
    severity: "medium" as const,
  },
];

function analyzeBuildFailure(request: DiagnosticRequest): DiagnosticResponse {
  const errorText = request.error || "";
  
  for (const issue of commonIssues) {
    if (issue.pattern.test(errorText)) {
      return {
        diagnosis: issue.diagnosis,
        errorType: issue.errorType,
        suggestions: issue.suggestions,
        documentation: issue.documentation,
        severity: issue.severity,
      };
    }
  }

  return {
    diagnosis: "Unable to determine specific issue from error message",
    errorType: "unknown_error",
    suggestions: [
      "Check Supabase Edge Function logs for detailed error messages",
      "Verify all imports are using correct Deno-compatible URLs",
      "Ensure function has proper Deno.serve() wrapper",
      "Test function locally with Supabase CLI: supabase functions serve",
      "Review function code for syntax errors",
    ],
    documentation: [
      "https://supabase.com/docs/guides/functions",
      "https://supabase.com/docs/guides/functions/troubleshooting",
    ],
    severity: "medium",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const diagnosticRequest: DiagnosticRequest = await req.json();
    const result = analyzeBuildFailure(diagnosticRequest);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to process diagnostic request",
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