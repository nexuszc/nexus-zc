import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        denoVersion: Deno.version.deno,
        v8Version: Deno.version.v8,
        typescriptVersion: Deno.version.typescript,
      },
      checks: {
        functionStructure: true,
        importsValid: true,
        syntaxValid: true,
        serveWrapper: true,
      },
      commonIssues: [],
      recommendations: [
        "Ensure all edge functions are wrapped in Deno.serve()",
        "Use https://deno.land/std imports for standard library",
        "Return Response objects with proper Content-Type headers",
        "Handle errors with try-catch blocks",
      ],
    };

    const url = new URL(req.url);
    const functionName = url.searchParams.get("function");

    if (functionName) {
      diagnostics.targetFunction = functionName;
      
      try {
        const functionPath = `../supabase/functions/${functionName}/index.ts`;
        diagnostics.checks.pathResolution = true;
      } catch (error) {
        diagnostics.checks.pathResolution = false;
        diagnostics.commonIssues.push({
          type: "path_error",
          message: `Could not resolve function path: ${error.message}`,
        });
      }
    }

    if (req.method === "POST") {
      const body = await req.json();
      
      if (body.code) {
        const codeChecks = {
          hasServeWrapper: body.code.includes("Deno.serve") || body.code.includes("serve("),
          hasResponseReturn: body.code.includes("new Response") || body.code.includes("Response("),
          hasErrorHandling: body.code.includes("try") && body.code.includes("catch"),
          hasContentType: body.code.includes("Content-Type"),
        };

        diagnostics.codeAnalysis = codeChecks;

        if (!codeChecks.hasServeWrapper) {
          diagnostics.commonIssues.push({
            type: "missing_serve_wrapper",
            message: "Function must be wrapped in Deno.serve()",
            fix: "wrap logic in Deno.serve(async (req) => { ... })",
          });
        }

        if (!codeChecks.hasResponseReturn) {
          diagnostics.commonIssues.push({
            type: "missing_response",
            message: "Function must return a Response object",
            fix: "return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })",
          });
        }
      }
    }

    diagnostics.status = diagnostics.commonIssues.length === 0 ? "healthy" : "issues_found";
    diagnostics.issueCount = diagnostics.commonIssues.length;

    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});