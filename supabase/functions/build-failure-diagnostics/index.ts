import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface DiagnosticResult {
  success: boolean;
  errors: Array<{
    type: string;
    message: string;
    line?: number;
    file?: string;
    suggestion?: string;
  }>;
  warnings: Array<{
    type: string;
    message: string;
    suggestion?: string;
  }>;
  summary: string;
}

serve(async (req) => {
  try {
    const { functionName, errorLog, sourceCode } = await req.json();

    const result: DiagnosticResult = {
      success: true,
      errors: [],
      warnings: [],
      summary: "",
    };

    if (!functionName || !errorLog) {
      result.success = false;
      result.errors.push({
        type: "INVALID_REQUEST",
        message: "Missing required parameters: functionName and errorLog",
      });
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check for missing Deno.serve wrapper
    if (errorLog.includes("Handler isn't a function") || 
        errorLog.includes("serve is not defined") ||
        errorLog.includes("default export")) {
      result.errors.push({
        type: "MISSING_SERVE_WRAPPER",
        message: "Function is missing the required Deno.serve() wrapper",
        suggestion: "Wrap your code with: Deno.serve(async (req) => { /* your code */ return new Response(...) })",
      });
    }

    // Check for import errors
    if (errorLog.includes("Cannot resolve") || 
        errorLog.includes("Module not found") ||
        errorLog.includes("import")) {
      const importMatch = errorLog.match(/Cannot resolve ["'](.+?)["']/);
      result.errors.push({
        type: "IMPORT_ERROR",
        message: importMatch ? `Cannot resolve import: ${importMatch[1]}` : "Import resolution failed",
        suggestion: "Use Deno-compatible imports (https://deno.land/x/ or https://esm.sh/)",
      });
    }

    // Check for syntax errors
    if (errorLog.includes("SyntaxError") || errorLog.includes("Unexpected")) {
      const lineMatch = errorLog.match(/at line (\d+)/i) || errorLog.match(/:(\d+):/);
      result.errors.push({
        type: "SYNTAX_ERROR",
        message: "JavaScript/TypeScript syntax error detected",
        line: lineMatch ? parseInt(lineMatch[1]) : undefined,
        suggestion: "Check for missing brackets, semicolons, or invalid syntax",
      });
    }

    // Check for permission errors
    if (errorLog.includes("PermissionDenied") || errorLog.includes("permission")) {
      result.errors.push({
        type: "PERMISSION_ERROR",
        message: "Deno permission error",
        suggestion: "Check function permissions configuration in supabase/functions",
      });
    }

    // Check for CORS issues
    if (errorLog.includes("CORS") || errorLog.includes("Access-Control")) {
      result.warnings.push({
        type: "CORS_WARNING",
        message: "Potential CORS configuration issue",
        suggestion: "Ensure response includes proper CORS headers",
      });
    }

    // Check for Response object errors
    if (errorLog.includes("Response") && errorLog.includes("is not")) {
      result.errors.push({
        type: "INVALID_RESPONSE",
        message: "Function must return a Response object",
        suggestion: "Return: new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })",
      });
    }

    // Check for async/await issues
    if (errorLog.includes("await") && !errorLog.includes("async")) {
      result.errors.push({
        type: "ASYNC_ERROR",
        message: "await used outside async function",
        suggestion: "Ensure the request handler is an async function: Deno.serve(async (req) => { ... })",
      });
    }

    // Check for environment variable issues
    if (errorLog.includes("Deno.env") || errorLog.includes("environment")) {
      result.warnings.push({
        type: "ENV_WARNING",
        message: "Environment variable access detected",
        suggestion: "Use Deno.env.get('VAR_NAME') and ensure secrets are configured",
      });
    }

    // Analyze source code if provided
    if (sourceCode) {
      if (!sourceCode.includes("Deno.serve")) {
        result.errors.push({
          type: "MISSING_SERVE_WRAPPER",
          message: "Source code does not contain Deno.serve()",
          suggestion: "Wrap entire function in Deno.serve(async (req) => { ... })",
        });
      }

      if (!sourceCode.includes("return new Response")) {
        result.warnings.push({
          type: "RESPONSE_WARNING",
          message: "No Response object found in source",
          suggestion: "Ensure function returns a Response object",
        });
      }

      const importCount = (sourceCode.match(/import .+ from/g) || []).length;
      if (importCount > 0) {
        const httpImports = sourceCode.match(/from ['"]http:\/\//g);
        if (!httpImports) {
          result.warnings.push({
            type: "IMPORT_WARNING",
            message: "Imports detected - ensure they use Deno-compatible URLs",
            suggestion: "Use https://deno.land/std or https://esm.sh for imports",
          });
        }
      }
    }

    // Generate summary
    if (result.errors.length === 0 && result.warnings.length === 0) {
      result.summary = "No specific issues detected. Check Supabase logs for runtime errors.";
    } else {
      result.summary = `Found ${result.errors.length} error(s) and ${result.warnings.length} warning(s). Primary issue: ${result.errors[0]?.type || result.warnings[0]?.type || "Unknown"}`;
    }

    result.success = result.errors.length === 0;

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  } catch (error) {
    const errorResult: DiagnosticResult = {
      success: false,
      errors: [
        {
          type: "DIAGNOSTIC_ERROR",
          message: error.message || "Unknown diagnostic error",
        },
      ],
      warnings: [],
      summary: "Diagnostic function encountered an error",
    };

    return new Response(JSON.stringify(errorResult), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
});