Deno.serve(async (req) => {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      deployment_status: "checking",
      edge_function_name: "build-failure-diagnostics",
      checks: {
        deno_runtime: typeof Deno !== "undefined",
        request_object: req !== null,
        url_accessible: req.url !== undefined,
      },
      environment: {
        deno_version: Deno.version?.deno || "unknown",
        typescript_version: Deno.version?.typescript || "unknown",
      },
      build_info: {
        message: "If you see this response, the edge function deployed successfully",
        common_build_failures: [
          "Missing Deno.serve() wrapper",
          "Invalid TypeScript syntax",
          "Incorrect import statements",
          "Missing dependencies",
        ],
      },
    };

    diagnostics.deployment_status = "success";

    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const errorDiagnostics = {
      timestamp: new Date().toISOString(),
      deployment_status: "error",
      edge_function_name: "build-failure-diagnostics",
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    };

    return new Response(JSON.stringify(errorDiagnostics, null, 2), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
});