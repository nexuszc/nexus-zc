import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface DiagnosticResult {
  status: "success" | "error";
  timestamp: string;
  checks: {
    functionCount: {
      passed: boolean;
      count: number;
      message: string;
    };
    syntaxValidation: {
      passed: boolean;
      errors: string[];
      message: string;
    };
    dependencyChecks: {
      passed: boolean;
      issues: string[];
      message: string;
    };
    memoryUsage: {
      passed: boolean;
      usage: number;
      message: string;
    };
    commonPatterns: {
      passed: boolean;
      issues: string[];
      message: string;
    };
  };
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
  };
}

async function runDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    status: "success",
    timestamp: new Date().toISOString(),
    checks: {
      functionCount: {
        passed: true,
        count: 0,
        message: "",
      },
      syntaxValidation: {
        passed: true,
        errors: [],
        message: "",
      },
      dependencyChecks: {
        passed: true,
        issues: [],
        message: "",
      },
      memoryUsage: {
        passed: true,
        usage: 0,
        message: "",
      },
      commonPatterns: {
        passed: true,
        issues: [],
        message: "",
      },
    },
    summary: {
      totalChecks: 5,
      passedChecks: 0,
      failedChecks: 0,
    },
  };

  try {
    const functionsPath = "/home/deno/functions";
    let functionCount = 0;

    try {
      for await (const entry of Deno.readDir(functionsPath)) {
        if (entry.isDirectory) {
          functionCount++;
        }
      }
      result.checks.functionCount.count = functionCount;
      result.checks.functionCount.passed = functionCount > 0;
      result.checks.functionCount.message = functionCount > 0
        ? `Found ${functionCount} functions`
        : "No functions found";
    } catch (error) {
      result.checks.functionCount.passed = false;
      result.checks.functionCount.message = `Error reading functions directory: ${error.message}`;
    }

    try {
      for await (const entry of Deno.readDir(functionsPath)) {
        if (entry.isDirectory) {
          const indexPath = `${functionsPath}/${entry.name}/index.ts`;
          try {
            const content = await Deno.readTextFile(indexPath);
            
            if (!content.includes("serve") && !content.includes("Deno.serve")) {
              result.checks.syntaxValidation.errors.push(
                `${entry.name}: Missing serve function`
              );
            }

            if (content.includes("await") && !content.includes("async")) {
              result.checks.syntaxValidation.errors.push(
                `${entry.name}: Possible await without async`
              );
            }
          } catch {
            result.checks.syntaxValidation.errors.push(
              `${entry.name}: Could not read index.ts`
            );
          }
        }
      }

      result.checks.syntaxValidation.passed = result.checks.syntaxValidation.errors.length === 0;
      result.checks.syntaxValidation.message = result.checks.syntaxValidation.passed
        ? "All functions have valid syntax"
        : `Found ${result.checks.syntaxValidation.errors.length} syntax issues`;
    } catch (error) {
      result.checks.syntaxValidation.passed = false;
      result.checks.syntaxValidation.message = `Error validating syntax: ${error.message}`;
    }

    try {
      const commonDeps = [
        "https://deno.land/std@0.168.0/http/server.ts",
        "https://esm.sh/@supabase/supabase-js@2",
      ];

      for await (const entry of Deno.readDir(functionsPath)) {
        if (entry.isDirectory) {
          const indexPath = `${functionsPath}/${entry.name}/index.ts`;
          try {
            const content = await Deno.readTextFile(indexPath);
            
            if (content.includes("@supabase/supabase-js") && !content.includes("https://esm.sh")) {
              result.checks.dependencyChecks.issues.push(
                `${entry.name}: Using non-ESM Supabase import`
              );
            }

            if (content.includes("npm:")) {
              result.checks.dependencyChecks.issues.push(
                `${entry.name}: Using npm: specifier (may cause issues)`
              );
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }

      result.checks.dependencyChecks.passed = result.checks.dependencyChecks.issues.length === 0;
      result.checks.dependencyChecks.message = result.checks.dependencyChecks.passed
        ? "All dependencies are properly configured"
        : `Found ${result.checks.dependencyChecks.issues.length} dependency issues`;
    } catch (error) {
      result.checks.dependencyChecks.passed = false;
      result.checks.dependencyChecks.message = `Error checking dependencies: ${error.message}`;
    }

    try {
      const memInfo = Deno.memoryUsage();
      const totalMB = memInfo.heapTotal / 1024 / 1024;
      result.checks.memoryUsage.usage = Math.round(totalMB * 100) / 100;
      result.checks.memoryUsage.passed = totalMB < 512;
      result.checks.memoryUsage.message = result.checks.memoryUsage.passed
        ? `Memory usage is normal (${result.checks.memoryUsage.usage}MB)`
        : `High memory usage detected (${result.checks.memoryUsage.usage}MB)`;
    } catch (error) {
      result.checks.memoryUsage.passed = false;
      result.checks.memoryUsage.message = `Error checking memory: ${error.message}`;
    }

    try {
      for await (const entry of Deno.readDir(functionsPath)) {
        if (entry.isDirectory) {
          const indexPath = `${functionsPath}/${entry.name}/index.ts`;
          try {
            const content = await Deno.readTextFile(indexPath);

            if (!content.includes("cors")) {
              result.checks.commonPatterns.issues.push(
                `${entry.name}: Missing CORS handling`
              );
            }

            if (!content.includes("try") && !content.includes("catch")) {
              result.checks.commonPatterns.issues.push(
                `${entry.name}: Missing error handling`
              );
            }

            if (content.includes("console.log") && !content.includes("console.error")) {
              result.checks.commonPatterns.issues.push(
                `${entry.name}: Has console.log but no console.error`
              );
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }

      result.checks.commonPatterns.passed = result.checks.commonPatterns.issues.length === 0;
      result.checks.commonPatterns.message = result.checks.commonPatterns.passed
        ? "All common patterns are properly implemented"
        : `Found ${result.checks.commonPatterns.issues.length} pattern issues`;
    } catch (error