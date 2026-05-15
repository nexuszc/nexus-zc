import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface ErrorLogContext {
  functionName: string;
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  userId?: string;
  requestId?: string;
}

interface JsonParseErrorDetails {
  rawInput: string;
  inputSnippet: string;
  errorMessage: string;
  errorPosition?: number;
  stackTrace: string;
  context: ErrorLogContext;
  attemptedOperation: string;
  inputLength: number;
  inputType: string;
}

const MAX_SNIPPET_LENGTH = 500;
const MAX_RAW_INPUT_LENGTH = 10000;

function sanitizeInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function extractErrorPosition(error: Error): number | undefined {
  const match = error.message.match(/position (\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function createInputSnippet(input: string, errorPosition?: number): string {
  if (errorPosition !== undefined && errorPosition > 0) {
    const start = Math.max(0, errorPosition - 100);
    const end = Math.min(input.length, errorPosition + 100);
    const snippet = input.substring(start, end);
    return `...${snippet}... [Error near position ${errorPosition}]`;
  }
  
  if (input.length <= MAX_SNIPPET_LENGTH) {
    return input;
  }
  
  return input.substring(0, MAX_SNIPPET_LENGTH) + '... [truncated]';
}

function categorizeError(error: Error, input: string): string {
  const message = error.message.toLowerCase();
  
  if (message.includes('unexpected token')) {
    return 'unexpected_token';
  }
  if (message.includes('unexpected end')) {
    return 'unexpected_end';
  }
  if (message.includes('unterminated string')) {
    return 'unterminated_string';
  }
  if (input.trim() === '') {
    return 'empty_input';
  }
  if (!input.trim().startsWith('{') && !input.trim().startsWith('[')) {
    return 'invalid_json_start';
  }
  
  return 'unknown_parse_error';
}

export async function logJsonParseError(
  error: Error,
  rawInput: unknown,
  context: ErrorLogContext,
  attemptedOperation: string
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not configured for error logging');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const inputString = sanitizeInput(rawInput);
    const errorPosition = extractErrorPosition(error);
    const inputSnippet = createInputSnippet(inputString, errorPosition);
    const errorCategory = categorizeError(error, inputString);
    
    const truncatedInput = inputString.length > MAX_RAW_INPUT_LENGTH
      ? inputString.substring(0, MAX_RAW_INPUT_LENGTH) + '... [truncated]'
      : inputString;

    const errorDetails: JsonParseErrorDetails = {
      rawInput: truncatedInput,
      inputSnippet,
      errorMessage: error.message,
      errorPosition,
      stackTrace: error.stack || 'No stack trace available',
      context,
      attemptedOperation,
      inputLength: inputString.length,
      inputType: typeof rawInput,
    };

    const { error: insertError } = await supabase
      .from('json_parse_errors')
      .insert({
        error_category: errorCategory,
        error_message: error.message,
        error_position: errorPosition,
        input_snippet: inputSnippet,
        raw_input: truncatedInput,
        input_length: inputString.length,
        input_type: typeof rawInput,
        stack_trace: error.stack,
        function_name: context.functionName,
        endpoint: context.endpoint,
        method: context.method,
        headers: context.headers,
        user_id: context.userId,
        request_id: context.requestId,
        attempted_operation: attemptedOperation,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('Failed to insert error log:', insertError);
    }

    console.error('JSON Parse Error Details:', {
      category: errorCategory,
      message: error.message,
      snippet: inputSnippet,
      operation: attemptedOperation,
      context,
    });
  } catch (loggingError) {
    console.error('Error in error logging:', loggingError);
    console.error('Original error:', error);
  }
}

export function safeJsonParse<T = unknown>(
  input: string,
  context: ErrorLogContext,
  operation: string,
  fallback?: T
): T | null {
  try {
    if (!input || typeof input !== 'string') {
      throw new Error(`Invalid input type: expected string, got ${typeof input}`);
    }
    
    const trimmed = input.trim();
    if (trimmed === '') {
      throw new Error('Empty input string');
    }
    
    return JSON.parse(trimmed) as T;
  } catch (error) {
    logJsonParseError(error as Error, input, context, operation);
    return fallback !== undefined ? fallback : null;
  }
}

export async function safeJsonParseAsync<T = unknown>(
  input: string,
  context: ErrorLogContext,
  operation: string,
  fallback?: T
): Promise<T | null> {
  try {
    if (!input || typeof input !== 'string') {
      throw new Error(`Invalid input type: expected string, got ${typeof input}`);
    }
    
    const trimmed = input.trim();
    if (trimmed === '') {
      throw new Error('Empty input string');
    }
    
    return JSON.parse(trimmed) as T;
  } catch (error) {
    await logJsonParseError(error as Error, input, context, operation);
    return fallback !== undefined ? fallback : null;
  }
}