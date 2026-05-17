import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiagnosticResult {
  errors: string[];
  warnings: string[];
  recommendations: string[];
  checks: {
    missingImports: boolean;
    malformedHandlers: boolean;
    deploymentConflicts: boolean;
    configurationIssues: boolean;
  };
}

async function runDiagnostics(): Promise<DiagnosticResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const checks = {
    missingImports: false,
    malformedHandlers: false,
    deploymentConflicts: false,
    configurationIssues: false,
  };

  try {
    const functionPath = Deno.cwd();
    
    const commonImportIssues = [
      "supabase-js not found",
      "missing @supabase/supabase-js",
      "cannot find module",
    ];
    
    const files = [];
    for await (const entry of Deno.readDir(functionPath)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        files.push(entry.name);
      }
    }

    for (const file of files) {
      try {
        const content = await Deno.readTextFile(`${functionPath}/${file}`);
        
        if (!content.includes("Deno.serve") && !content.includes("serve(")) {
          checks.malformedHandlers = true;
          errors.push(`${file}: Missing Deno.serve() handler`);
          recommendations.push(`Wrap ${file} logic in Deno.serve() call`);
        }

        if (content.includes("import") && !content.includes("https://")) {
          checks.missingImports = true;
          warnings.push(`${file}: May contain non-Deno compatible imports`);
          recommendations.push(`Use Deno-compatible imports (https://deno.land/...)`);
        }

        if (!content.includes("corsHeaders") && !content.includes("Access-Control-Allow-Origin")) {
          warnings.push(`${file}: Missing CORS headers`);
          recommendations.push(`Add CORS headers to ${file} responses`);
        }

        if (!content.includes("try") && !content.includes("catch")) {
          warnings.push(`${file}: Missing error handling`);
          recommendations.push(`Add try/catch blocks to ${file}`);
        }
      } catch (err) {
        errors.push(`Failed to read ${file}: ${err.message}`);
      }
    }

    try {
      const envVars = [
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ];
      
      for (const envVar of envVars) {
        if (!Deno.env.get(envVar)) {
          checks.configurationIssues = true;
          warnings.push(`Environment variable ${envVar} not set`);
          recommendations.push(`Set ${envVar} in Supabase dashboard`);
        }
      }
    } catch (err) {
      warnings.push(`Could not check environment variables: ${err.message}`);
    }

    try {
      const configPath = `${functionPath}/../../config.toml`;
      await Deno.stat(configPath);
    } catch {
      checks.deploymentConflicts = true;
      warnings.push("config.toml not found");
      recommendations.push("Create config.toml with function configuration");
    }

  } catch (err) {
    errors.push(`Diagnostic scan failed: ${err.message}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    recommendations.push("All checks passed. Build failures may be due to runtime errors.");
  }

  return {
    errors,
    warnings,
    recommendations,
    checks,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const diagnostics = await runDiagnostics();

    return new Response(
      JSON.stringify(diagnostics, null, 2),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        errors: [error.message],
        warnings: [],
        recommendations: ["Check function logs for detailed error information"],
        checks: {
          missingImports: false,
          malformedHandlers: false,
          deploymentConflicts: false,
          configurationIssues: false,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 500,
      }
    );
  }
});