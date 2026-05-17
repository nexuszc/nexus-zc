import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const { functionName, errorLogs } = await req.json();

    const diagnostics = {
      functionName,
      issues: [],
      recommendations: [],
      severity: "info",
    };

    // Check for missing Deno.serve wrapper
    if (errorLogs?.includes("not found") || errorLogs?.includes("default export")) {
      diagnostics.issues.push("Missing or incorrect Deno.serve() handler");
      diagnostics.recommendations.push(
        "Wrap your function logic in: Deno.serve(async (req) => { ... })"
      );
      diagnostics.severity = "critical";
    }

    // Check for import errors
    if (errorLogs?.includes("import") || errorLogs?.includes("Cannot find module")) {
      diagnostics.issues.push("Import resolution error detected");
      diagnostics.recommendations.push(
        "Use Deno-compatible imports: https://deno.land/std or npm: specifiers"
      );
      diagnostics.severity = "critical";
    }

    // Check for syntax errors
    if (errorLogs?.includes("SyntaxError") || errorLogs?.includes("Unexpected token")) {
      diagnostics.issues.push("Syntax error in function code");
      diagnostics.recommendations.push(
        "Review code for TypeScript/JavaScript syntax errors"
      );
      diagnostics.severity = "critical";
    }

    // Check for missing Response return
    if (errorLogs?.includes("Response") || errorLogs?.includes("return")) {
      diagnostics.issues.push("Handler may not return a valid Response object");
      diagnostics.recommendations.push(
        "Ensure handler returns: new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })"
      );
      diagnostics.severity = "error";
    }

    // Check for CORS issues
    if (errorLogs?.includes("CORS") || errorLogs?.includes("Access-Control")) {
      diagnostics.issues.push("CORS configuration issue");
      diagnostics.recommendations.push(
        "Add CORS headers to Response or handle OPTIONS requests"
      );
      diagnostics.severity = "warning";
    }

    // Check for environment variable issues
    if (errorLogs?.includes("undefined") && errorLogs?.includes("env")) {
      diagnostics.issues.push("Missing environment variables");
      diagnostics.recommendations.push(
        "Verify required environment variables are set in Supabase dashboard"
      );
      diagnostics.severity = "error";
    }

    // If no specific issues found but there are error logs
    if (diagnostics.issues.length === 0 && errorLogs) {
      diagnostics.issues.push("Build failure detected");
      diagnostics.recommendations.push(
        "Check function logs for detailed error messages",
        "Ensure function follows Deno edge function patterns"
      );
      diagnostics.severity = "error";
    }

    return new Response(JSON.stringify(diagnostics), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Diagnostic analysis failed",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});