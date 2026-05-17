import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BuildFailureRequest {
  buildId: string;
  errorMessage?: string;
  errorStack?: string;
  buildLogs?: string;
}

interface DiagnosticResult {
  buildId: string;
  diagnostics: {
    errorType: string;
    possibleCauses: string[];
    suggestedFixes: string[];
    severity: 'high' | 'medium' | 'low';
  };
  timestamp: string;
}

function analyzeError(errorMessage: string, errorStack?: string, buildLogs?: string): DiagnosticResult['diagnostics'] {
  const message = (errorMessage || '').toLowerCase();
  const stack = (errorStack || '').toLowerCase();
  const logs = (buildLogs || '').toLowerCase();
  const combined = `${message} ${stack} ${logs}`;

  if (combined.includes('module not found') || combined.includes('cannot find module')) {
    return {
      errorType: 'Missing Dependency',
      possibleCauses: [
        'Package not installed in package.json',
        'Import path is incorrect',
        'Package not compatible with build environment'
      ],
      suggestedFixes: [
        'Run npm install or yarn install',
        'Check import paths for typos',
        'Verify package exists in package.json dependencies'
      ],
      severity: 'high'
    };
  }

  if (combined.includes('syntax error') || combined.includes('unexpected token')) {
    return {
      errorType: 'Syntax Error',
      possibleCauses: [
        'Invalid JavaScript/TypeScript syntax',
        'Incompatible ES version',
        'Missing babel configuration'
      ],
      suggestedFixes: [
        'Review code for syntax errors',
        'Check babel/typescript configuration',
        'Ensure build tools are properly configured'
      ],
      severity: 'high'
    };
  }

  if (combined.includes('memory') || combined.includes('heap') || combined.includes('out of memory')) {
    return {
      errorType: 'Memory Issue',
      possibleCauses: [
        'Build process exceeding memory limits',
        'Large dependencies or assets',
        'Memory leak in build process'
      ],
      suggestedFixes: [
        'Increase Node memory limit (NODE_OPTIONS=--max-old-space-size=4096)',
        'Optimize dependencies and remove unused packages',
        'Split large bundles'
      ],
      severity: 'high'
    };
  }

  if (combined.includes('timeout') || combined.includes('timed out')) {
    return {
      errorType: 'Timeout',
      possibleCauses: [
        'Build taking too long',
        'Network issues downloading dependencies',
        'Slow or hanging build step'
      ],
      suggestedFixes: [
        'Increase build timeout limit',
        'Check network connectivity',
        'Optimize build process and reduce build time'
      ],
      severity: 'medium'
    };
  }

  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return {
      errorType: 'Permission Error',
      possibleCauses: [
        'Insufficient file system permissions',
        'Protected directory access',
        'npm/yarn global installation issue'
      ],
      suggestedFixes: [
        'Check file and directory permissions',
        'Avoid running builds as root',
        'Clear npm cache and reinstall'
      ],
      severity: 'medium'
    };
  }

  if (combined.includes('network') || combined.includes('enotfound') || combined.includes('econnrefused')) {
    return {
      errorType: 'Network Error',
      possibleCauses: [
        'Cannot reach package registry',
        'DNS resolution failure',
        'Firewall or proxy blocking connection'
      ],
      suggestedFixes: [
        'Check internet connectivity',
        'Verify npm registry URL',
        'Configure proxy settings if behind firewall'
      ],
      severity: 'medium'
    };
  }

  if (combined.includes('type error') || combined.includes('typescript')) {
    return {
      errorType: 'TypeScript Error',
      possibleCauses: [
        'Type mismatch or incompatibility',
        'Missing type definitions',
        'Strict mode violations'
      ],
      suggestedFixes: [
        'Fix type errors in source code',
        'Install @types packages for dependencies',
        'Adjust tsconfig.json settings'
      ],
      severity: 'medium'
    };
  }

  return {
    errorType: 'Unknown Error',
    possibleCauses: [
      'Unrecognized build failure',
      'Complex or multi-faceted issue'
    ],
    suggestedFixes: [
      'Review full build logs',
      'Check recent code changes',
      'Consult documentation for specific error message'
    ],
    severity: 'low'
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { buildId, errorMessage, errorStack, buildLogs }: BuildFailureRequest = await req.json();

    if (!buildId) {
      return new Response(
        JSON.stringify({ error: 'buildId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const diagnostics = analyzeError(
      errorMessage || '',
      errorStack,
      buildLogs
    );

    const result: DiagnosticResult = {
      buildId,
      diagnostics,
      timestamp: new Date().toISOString()
    };

    const { error: dbError } = await supabase
      .from('build_diagnostics')
      .insert({
        build_id: buildId,
        error_type: diagnostics.errorType,
        possible_causes: diagnostics.possibleCauses,
        suggested_fixes: diagnostics.suggestedFixes,
        severity: diagnostics.severity,
        created_at: result.timestamp
      });

    if (dbError) {
      console.error('Error saving diagnostics:', dbError);
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error) {
    console.error('Error in build-failure-diagnostics:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});