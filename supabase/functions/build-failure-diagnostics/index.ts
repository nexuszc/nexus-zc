import { walk } from "https://deno.land/std@0.168.0/fs/mod.ts";

interface DiagnosticResult {
  functionName: string;
  issues: string[];
  compliant: boolean;
}

interface DiagnosticsReport {
  totalFunctions: number;
  compliantFunctions: number;
  nonCompliantFunctions: number;
  results: DiagnosticResult[];
  timestamp: string;
}

async function runDiagnostics(): Promise<DiagnosticsReport> {
  const results: DiagnosticResult[] = [];
  const functionsPath = new URL("../", import.meta.url).pathname;

  try {
    for await (const entry of walk(functionsPath, {
      maxDepth: 2,
      includeFiles: true,
      exts: [".ts"],
      skip: [/node_modules/, /\.test\.ts$/, /\.d\.ts$/],
    })) {
      if (entry.isFile && entry.name === "index.ts") {
        const functionName = entry.path.split("/").slice(-2, -1)[0];
        const issues: string[] = [];

        try {
          const content = await Deno.readTextFile(entry.path);

          if (!content.includes("Deno.serve(")) {
            issues.push("Missing Deno.serve() wrapper");
          }

          if (!content.includes("new Response(")) {
            issues.push("Missing proper Response return");
          }

          if (!content.includes("'Content-Type'") && !content.includes('"Content-Type"')) {
            issues.push("Missing Content-Type header");
          }

          if (!content.includes("cors") && !content.includes("Access-Control-Allow-Origin")) {
            issues.push("Missing CORS headers");
          }

          if (content.includes("app.listen") || content.includes("express()")) {
            issues.push("Using Express instead of Deno.serve()");
          }

          if (content.includes("http.createServer")) {
            issues.push("Using Node.js http server instead of Deno.serve()");
          }

          if (content.includes("addEventListener('fetch')")) {
            issues.push("Using deprecated addEventListener instead of Deno.serve()");
          }

          results.push({
            functionName,
            issues,
            compliant: issues.length === 0,
          });
        } catch (error) {
          results.push({
            functionName,
            issues: [`Failed to read file: ${error.message}`],
            compliant: false,
          });
        }
      }
    }
  } catch (error) {
    results.push({
      functionName: "diagnostics",
      issues: [`Failed to scan functions directory: ${error.message}`],
      compliant: false,
    });
  }

  const compliantCount = results.filter((r) => r.compliant).length;

  return {
    totalFunctions: results.length,
    compliantFunctions: compliantCount,
    nonCompliantFunctions: results.length - compliantCount,
    results,
    timestamp: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  try {
    const diagnostics = await runDiagnostics();

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error.message,
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