import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ErrorLogEntry {
  timestamp: string;
  raw_input: string;
  input_length: number;
  first_100_chars: string;
  last_100_chars: string;
  error_message: string;
  stack_trace: string | null;
  cycle_id: string | null;
  recovery_action: string;
}

export async function logJSONParseError(
  rawInput: string | unknown,
  error: Error,
  cycleId: string | null = null,
  recoveryAction: string = 'skipped'
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const inputStr = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
    const inputLength = inputStr.length;
    const truncatedInput = inputStr.substring(0, 10240);
    
    const first100 = inputStr.substring(0, 100);
    const last100 = inputLength > 100 ? inputStr.substring(inputLength - 100) : inputStr;
    
    const logEntry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      raw_input: truncatedInput,
      input_length: inputLength,
      first_100_chars: first100,
      last_100_chars: last100,
      error_message: error.message,
      stack_trace: error.stack || null,
      cycle_id: cycleId,
      recovery_action: recoveryAction,
    };

    const { error: insertError } = await supabase
      .from('vps_cycle_errors')
      .insert(logEntry);

    if (insertError) {
      console.error('Failed to log error to database:', insertError);
      console.error('Original error:', logEntry);
    }
  } catch (loggingError) {
    console.error('Critical: Error logger failed:', loggingError);
    console.error('Original error details:', {
      message: error.message,
      inputLength: typeof rawInput === 'string' ? rawInput.length : 'unknown',
      cycleId,
    });
  }
}

export function safeJSONParse<T = unknown>(
  input: string,
  cycleId: string | null = null,
  fallbackValue: T | null = null
): T | null {
  if (!input || typeof input !== 'string') {
    console.warn('Invalid input for JSON parse: not a string');
    return fallbackValue;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    console.warn('Empty string provided to JSON parse');
    return fallbackValue;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    logJSONParseError(input, err, cycleId, 'returned_fallback').catch(console.error);
    
    console.error('JSON parse failed:', {
      errorMessage: err.message,
      inputLength: input.length,
      firstChars: input.substring(0, 50),
      lastChars: input.length > 50 ? input.substring(input.length - 50) : '',
    });
    
    return fallbackValue;
  }
}

export async function validateJSONInput(
  input: string,
  cycleId: string | null = null
): Promise<{ valid: boolean; data: unknown | null; error: string | null }> {
  if (!input || typeof input !== 'string') {
    return {
      valid: false,
      data: null,
      error: 'Input is not a string',
    };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      data: null,
      error: 'Input is empty',
    };
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      valid: false,
      data: null,
      error: 'Input does not start with valid JSON character',
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      valid: true,
      data: parsed,
      error: null,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await logJSONParseError(input, err, cycleId, 'validation_failed');
    
    return {
      valid: false,
      data: null,
      error: err.message,
    };
  }
}