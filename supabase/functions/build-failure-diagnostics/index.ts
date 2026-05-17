import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

interface DiagnosticResult {
  timestamp: string;
  status: 'success' | 'failure';
  diagnostics: {
    environment: {
      status: string;
      supabaseUrl: boolean;
      supabaseAnonKey: boolean;
      supabaseServiceKey: boolean;
      denoVersion: string;
    };
    fileSystem: {
      status: string;
      canReadCwd: boolean;
      currentDir: string;
    };
    supabaseClient: {
      status: string;
      canCreateClient: boolean;
      error?: string;
    };
    imports: {
      status: string;
      supabaseJs: boolean;
      error?: string;
    };
  };
}

async function runDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    status: 'success',
    diagnostics: {
      environment: {
        status: 'pending',
        supabaseUrl: false,
        supabaseAnonKey: false,
        supabaseServiceKey: false,
        denoVersion: '',
      },
      fileSystem: {
        status: 'pending',
        canReadCwd: false,
        currentDir: '',
      },
      supabaseClient: {
        status: 'pending',
        canCreateClient: false,
      },
      imports: {
        status: 'pending',
        supabaseJs: false,
      },
    },
  };

  try {
    result.diagnostics.environment.supabaseUrl = !!Deno.env.get('SUPABASE_URL');
    result.diagnostics.environment.supabaseAnonKey = !!Deno.env.get('SUPABASE_ANON_KEY');
    result.diagnostics.environment.supabaseServiceKey = !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    result.diagnostics.environment.denoVersion = Deno.version.deno;
    result.diagnostics.environment.status = 'success';
  } catch (error) {
    result.diagnostics.environment.status = `failed: ${error.message}`;
    result.status = 'failure';
  }

  try {
    result.diagnostics.fileSystem.currentDir = Deno.cwd();
    result.diagnostics.fileSystem.canReadCwd = true;
    result.diagnostics.fileSystem.status = 'success';
  } catch (error) {
    result.diagnostics.fileSystem.status = `failed: ${error.message}`;
    result.status = 'failure';
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'dummy-key';
    
    const client = createClient(supabaseUrl, supabaseKey);
    result.diagnostics.supabaseClient.canCreateClient = !!client;
    result.diagnostics.supabaseClient.status = 'success';
  } catch (error) {
    result.diagnostics.supabaseClient.status = 'failed';
    result.diagnostics.supabaseClient.error = error.message;
    result.status = 'failure';
  }

  try {
    result.diagnostics.imports.supabaseJs = typeof createClient === 'function';
    result.diagnostics.imports.status = 'success';
  } catch (error) {
    result.diagnostics.imports.status = 'failed';
    result.diagnostics.imports.error = error.message;
    result.status = 'failure';
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const diagnosticResults = await runDiagnostics();

    return new Response(JSON.stringify(diagnosticResults, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        status: 'failure',
        error: error.message,
        stack: error.stack,
      }, null, 2),
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