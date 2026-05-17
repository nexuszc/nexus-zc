import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface BuildContext {
  error?: string;
  buildLog?: string;
  projectId?: string;
  componentPath?: string;
  stackTrace?: string;
}

interface DiagnosticReport {
  analysis: string;
  commonIssues: string[];
  suggestions: string[];
  severity: 'high' | 'medium' | 'low';
  detectedPatterns: string[];
}

function analyzeFailurePatterns(context: BuildContext): DiagnosticReport {
  const commonIssues: string[] = [];
  const suggestions: string[] = [];
  const detectedPatterns: string[] = [];
  let severity: 'high' | 'medium' | 'low' = 'medium';

  const errorText = (context.error || '') + (context.buildLog || '') + (context.stackTrace || '');
  const lowerError = errorText.toLowerCase();

  if (lowerError.includes('cannot find module') || lowerError.includes('module not found')) {
    commonIssues.push('Missing module import');
    suggestions.push('Check that all dependencies are installed and import paths are correct');
    suggestions.push('Verify package.json includes the missing module');
    detectedPatterns.push('MISSING_IMPORT');
    severity = 'high';
  }

  if (lowerError.includes('type error') || lowerError.includes('ts(')) {
    commonIssues.push('TypeScript type error');
    suggestions.push('Review type definitions and ensure type compatibility');
    suggestions.push('Check for missing type declarations');
    detectedPatterns.push('TYPE_ERROR');
  }

  if (lowerError.includes('syntax error') || lowerError.includes('unexpected token')) {
    commonIssues.push('Syntax error detected');
    suggestions.push('Check for missing brackets, parentheses, or semicolons');
    suggestions.push('Verify proper JSX/TSX syntax');
    detectedPatterns.push('SYNTAX_ERROR');
    severity = 'high';
  }

  if (lowerError.includes('enoent') || lowerError.includes('no such file')) {
    commonIssues.push('File not found');
    suggestions.push('Verify file paths are correct and files exist');
    suggestions.push('Check for case sensitivity in file names');
    detectedPatterns.push('FILE_NOT_FOUND');
    severity = 'high';
  }

  if (lowerError.includes('configuration') || lowerError.includes('config')) {
    commonIssues.push('Configuration issue');
    suggestions.push('Review configuration files (tsconfig.json, vite.config, etc.)');
    suggestions.push('Ensure all required configuration options are set');
    detectedPatterns.push('CONFIG_ERROR');
  }

  if (lowerError.includes('memory') || lowerError.includes('heap out of memory')) {
    commonIssues.push('Memory issue');
    suggestions.push('Increase Node memory limit');
    suggestions.push('Check for memory leaks or large file processing');
    detectedPatterns.push('MEMORY_ERROR');
    severity = 'high';
  }

  if (lowerError.includes('permission denied') || lowerError.includes('eacces')) {
    commonIssues.push('Permission error');
    suggestions.push('Check file and directory permissions');
    suggestions.push('Verify write access to build directories');
    detectedPatterns.push('PERMISSION_ERROR');
  }

  if (lowerError.includes('port') || lowerError.includes('eaddrinuse')) {
    commonIssues.push('Port already in use');
    suggestions.push('Check if another process is using the port');
    suggestions.push('Try a different port or stop conflicting processes');
    detectedPatterns.push('PORT_CONFLICT');
  }

  if (commonIssues.length === 0) {
    commonIssues.push('Unknown build failure');
    suggestions.push('Review complete error logs for details');
    suggestions.push('Check recent code changes for potential issues');
    detectedPatterns.push('UNKNOWN');
  }

  const analysis = `Build failure detected with ${detectedPatterns.length} pattern(s). ${commonIssues.join(', ')}.`;

  return {
    analysis,
    commonIssues,
    suggestions,
    severity,
    detectedPatterns,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const buildContext: BuildContext = await req.json();

    const diagnosticReport = analyzeFailurePatterns(buildContext);

    if (buildContext.projectId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase.from('build_diagnostics').insert({
          project_id: buildContext.projectId,
          component_path: buildContext.componentPath,
          error_message: buildContext.error,
          severity: diagnosticReport.severity,
          detected_patterns: diagnosticReport.detectedPatterns,
          suggestions: diagnosticReport.suggestions,
          created_at: new Date().toISOString(),
        });
      }
    }

    return new Response(JSON.stringify(diagnosticReport), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to process build diagnostics',
        message: error.message,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});