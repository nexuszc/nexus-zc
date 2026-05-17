import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";

Deno.serve(async (req) => {
  try {
    const diagnostics = {
      fileCount: 0,
      syntaxErrors: [] as string[],
      missingImports: [] as string[],
      configValidation: {
        hasDenoJson: false,
        isValid: false,
        errors: [] as string[],
      },
      timestamp: new Date().toISOString(),
    };

    const functionsPath = "/home/deno/functions";

    for await (const entry of walk(functionsPath, {
      exts: ["ts", "tsx", "js", "jsx"],
      skip: [/node_modules/, /\.git/],
    })) {
      if (entry.isFile) {
        diagnostics.fileCount++;

        try {
          const content = await Deno.readTextFile(entry.path);

          if (content.includes("import") && !content.includes("from")) {
            diagnostics.syntaxErrors.push(
              `${entry.path}: Malformed import statement`
            );
          }

          const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
          let match;
          while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1];
            if (importPath.startsWith("./") || importPath.startsWith("../")) {
              const resolvedPath = new URL(importPath, `file://${entry.path}`)
                .pathname;
              try {
                await Deno.stat(resolvedPath);
              } catch {
                diagnostics.missingImports.push(
                  `${entry.path}: Cannot resolve ${importPath}`
                );
              }
            }
          }

          if (content.includes("export default") && !content.includes("Deno.serve")) {
            diagnostics.syntaxErrors.push(
              `${entry.path}: Missing Deno.serve wrapper`
            );
          }
        } catch (error) {
          diagnostics.syntaxErrors.push(
            `${entry.path}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }
    }

    try {
      const denoJsonPath = `${functionsPath}/deno.json`;
      const denoJsonContent = await Deno.readTextFile(denoJsonPath);
      diagnostics.configValidation.hasDenoJson = true;

      try {
        const denoConfig = JSON.parse(denoJsonContent);
        diagnostics.configValidation.isValid = true;

        if (!denoConfig.compilerOptions) {
          diagnostics.configValidation.errors.push(
            "Missing compilerOptions in deno.json"
          );
        }

        if (!denoConfig.imports && !denoConfig.importMap) {
          diagnostics.configValidation.errors.push(
            "No import map defined in deno.json"
          );
        }
      } catch (parseError) {
        diagnostics.configValidation.isValid = false;
        diagnostics.configValidation.errors.push(
          `Invalid JSON: ${parseError instanceof Error ? parseError.message : "Parse error"}`
        );
      }
    } catch {
      diagnostics.configValidation.hasDenoJson = false;
      diagnostics.configValidation.errors.push("deno.json not found");
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: {
        "Content-Type": "application/json",
      },
      status: 200,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Diagnostic scan failed",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
        status: 500,
      }
    );
  }
});