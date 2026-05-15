import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export interface LogContext {
  worker_id?: string;
  attempt?: number;
  cycle_id?: string;
  [key: string]: any;
}

export async function logParseFailure(
  input: string,
  error: Error,
  timestamp: string,
  context: Record<string, any>
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const inputPreview = input.substring(0, 500);
  const fullLength = input.length;
  const errorMessage = error.message;
  const stackTrace = error.stack || '';

  const logEntry = {
    timestamp,
    input_preview: inputPreview,
    full_input_length: fullLength,
    error_message: errorMessage,
    stack_trace: stackTrace,
    worker_id: context.worker_id || 'unknown',
    attempt_number: context.attempt || 0,
    context: context,
    created_at: new Date().toISOString(),
  };

  console.error('[PARSE FAILURE]', {
    timestamp,
    preview: inputPreview,
    length: fullLength,
    error: errorMessage,
    worker_id: context.worker_id,
    attempt: context.attempt,
  });

  try {
    const { error: dbError } = await supabase
      .from('vps_worker_parse_failures')
      .insert(logEntry);

    if (dbError) {
      console.error('[DB LOG ERROR]', dbError);
    }
  } catch (dbError) {
    console.error('[DB LOG EXCEPTION]', dbError);
  }
}

export function logInfo(message: string, data?: Record<string, any>): void {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.log(`[${timestamp}] ${message}`, data || '');
}

export function logError(message: string, error: Error, data?: Record<string, any>): void {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.error(`[${timestamp}] ${message}`, {
    error: error.message,
    stack: error.stack,
    ...data,
  });
}

export function logDebug(message: string, data?: Record<string, any>): void {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.debug(`[${timestamp}] ${message}`, data || '');
}