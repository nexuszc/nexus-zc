import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface DiagnosticResult {
  status: "success" | "error";
  errors: string[];
  recommendations: string[];
  details: {
    functionValidation?: any;
    importChecks?: any;
    syntaxAnalysis?: any;
    dependencyChecks?: any;
  };
}

async function validateFunctionFiles(functionPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const indexPath = `${functionPath}/index.ts`;
    try {
      await Deno.stat(indexPath);
    } catch {
      errors.push(`Missing index.ts file at ${indexPath}`);
    }
  } catch (error) {
    errors.push(`Function validation error: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

async function checkImports(functionPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const indexPath = `${functionPath}/index.ts`;
    try {
      const content = await Deno.readTextFile(indexPath);
      const importRegex = /import\s+.*\s+from\s+['"](.+)['"]/g;
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (!importPath.startsWith('http://') && !importPath.startsWith('https://') && !importPath.startsWith('npm:')) {
          if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
            errors.push(`Invalid import path: ${importPath}. Use Deno-compatible URLs or npm: prefix`);
          }
        }
      }
    } catch {
      // File doesn't exist, already caught in validation
    }
  } catch (error) {
    errors.push(`Import check error: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

async function analyzeSyntax(functionPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const indexPath = `${functionPath}/index.ts`;
    try {
      const content = await Deno.readTextFile(indexPath);
      
      if (!content.includes('Deno.serve') && !content.includes('serve(')) {
        errors.push('Missing Deno.serve() wrapper. Edge functions must use Deno.serve()');
      }
      
      const braceCount = (content.match(/{/g) || []).length - (content.match(/}/g) || []).length;
      if (braceCount !== 0) {
        errors.push(`Unbalanced braces detected (difference: ${braceCount})`);
      }
      
      const parenCount = (content.match(/\(/g) || []).length - (content.match(/\)/g) || []).length;
      if (parenCount !== 0) {
        errors.push(`Unbalanced parentheses detected (difference: ${parenCount})`);
      }
    } catch {
      // File doesn't exist, already caught in validation
    }
  } catch (error) {
    errors.push(`Syntax analysis error: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

async function checkDependencies(functionPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const indexPath = `${functionPath}/index.ts`;
    try {
      const content = await Deno.readTextFile(indexPath);
      
      if (content.includes('require(')) {
        errors.push('Node.js require() detected. Use Deno import statements instead');
      }
      
      if (content.includes('process.env') && !content.includes('Deno.env')) {
        errors.push('Node.js process.env detected. Use Deno.env.get() instead');
      }
      
      if (content.includes('__dirname') || content.includes('__filename')) {
        errors.push('Node.js __dirname or __filename detected. Use Deno alternatives');
      }
    } catch {
      // File doesn't exist, already caught in validation
    }
  } catch (error) {
    errors.push(`Dependency check error: ${error.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

async function runDiagnostics(functionName: string): Promise<DiagnosticResult> {
  const functionPath = `/home/deno/functions/${functionName}`;
  const allErrors: string[] = [];
  const recommendations: string[] = [];
  
  const functionValidation = await validateFunctionFiles(functionPath);
  allErrors.push(...functionValidation.errors);
  
  const importChecks = await checkImports(functionPath);
  allErrors.push(...importChecks.errors);
  
  const syntaxAnalysis = await analyzeSyntax(functionPath);
  allErrors.push(...syntaxAnalysis.errors);
  
  const dependencyChecks = await checkDependencies(functionPath);
  allErrors.push(...dependencyChecks.errors);
  
  if (allErrors.length > 0) {
    recommendations.push('Ensure all imports use Deno-compatible URLs (https://deno.land/...)');
    recommendations.push('Wrap your handler logic in Deno.serve((req) => { ... })');
    recommendations.push('Return a Response object from your handler');
    recommendations.push('Check for syntax errors and unbalanced brackets');
    recommendations.push('Replace Node.js-specific APIs with Deno equivalents');
  }
  
  return {
    status: allErrors.length === 0 ? "success" : "error",
    errors: allErrors,
    recommendations,
    details: {
      functionValidation,
      importChecks,
      syntaxAnalysis,
      dependencyChecks
    }
  };
}

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const { functionName } = await req.json();
    
    if (!functionName) {
      return new Response(
        JSON.stringify({ error: 'functionName is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const diagnostics = await runDiagnostics(functionName);
    
    return new Response(
      JSON.stringify(diagnostics),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        errors: [error.message],
        recommendations: ['Check request format and try again'],
        details: {}
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});