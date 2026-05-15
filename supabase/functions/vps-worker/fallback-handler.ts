import { logger } from './logger.ts';

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  partial?: boolean;
}

export function safeJSONParse<T>(
  input: string,
  fallbackValue?: T,
  context?: string
): ParseResult<T> {
  const logContext = context || 'unknown';

  if (!input || typeof input !== 'string') {
    logger.error(`Invalid input for JSON parsing in ${logContext}`, { 
      inputType: typeof input,
      inputLength: input?.length 
    });
    return {
      success: false,
      error: 'Invalid input: not a string',
      data: fallbackValue,
    };
  }

  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) {
    logger.warn(`Empty input for JSON parsing in ${logContext}`);
    return {
      success: false,
      error: 'Empty input string',
      data: fallbackValue,
    };
  }

  try {
    const parsed = JSON.parse(trimmedInput);
    return {
      success: true,
      data: parsed as T,
    };
  } catch (error) {
    logger.error(`JSON parse error in ${logContext}`, {
      error: error instanceof Error ? error.message : String(error),
      inputPreview: trimmedInput.substring(0, 200),
      inputLength: trimmedInput.length,
    });

    const partialResult = attemptPartialRecovery<T>(trimmedInput, logContext);
    if (partialResult.success) {
      return { ...partialResult, partial: true };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parse error',
      data: fallbackValue,
    };
  }
}

function attemptPartialRecovery<T>(
  input: string,
  context: string
): ParseResult<T> {
  const strategies = [
    () => fixTrailingCommas(input),
    () => fixMissingQuotes(input),
    () => extractObjectFromText(input),
    () => fixTruncatedJSON(input),
    () => removeControlCharacters(input),
  ];

  for (const strategy of strategies) {
    try {
      const fixed = strategy();
      if (fixed && fixed !== input) {
        const parsed = JSON.parse(fixed);
        logger.info(`Partial recovery successful in ${context}`, {
          strategy: strategy.name,
        });
        return {
          success: true,
          data: parsed as T,
        };
      }
    } catch (_error) {
      continue;
    }
  }

  return { success: false, error: 'All recovery strategies failed' };
}

function fixTrailingCommas(input: string): string {
  return input
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
}

function fixMissingQuotes(input: string): string {
  return input.replace(/(\w+):/g, '"$1":');
}

function extractObjectFromText(input: string): string {
  const match = input.match(/\{[\s\S]*\}/);
  return match ? match[0] : input;
}

function fixTruncatedJSON(input: string): string {
  let fixed = input.trim();
  
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces);
  }

  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    fixed += ']'.repeat(openBrackets - closeBrackets);
  }

  return fixed;
}

function removeControlCharacters(input: string): string {
  return input.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

export function extractValidFields<T extends Record<string, unknown>>(
  data: unknown,
  schema: Record<keyof T, unknown>,
  defaults: T
): T {
  if (!data || typeof data !== 'object') {
    logger.warn('Invalid data for field extraction, using defaults');
    return defaults;
  }

  const result = { ...defaults };
  const dataObj = data as Record<string, unknown>;

  for (const key in schema) {
    if (key in dataObj && dataObj[key] !== undefined && dataObj[key] !== null) {
      try {
        result[key] = dataObj[key] as T[Extract<keyof T, string>];
      } catch (error) {
        logger.warn(`Failed to extract field ${String(key)}`, { error });
      }
    }
  }

  return result;
}

export function createDegradedResponse<T>(
  partialData: Partial<T>,
  defaults: T,
  reason: string
): T & { _degraded: boolean; _reason: string } {
  logger.warn('Creating degraded response', { reason });
  
  return {
    ...defaults,
    ...partialData,
    _degraded: true,
    _reason: reason,
  };
}

export function validateAndParseJSON<T>(
  input: unknown,
  validator: (data: unknown) => data is T,
  fallback: T,
  context?: string
): ParseResult<T> {
  if (typeof input === 'object' && input !== null) {
    if (validator(input)) {
      return { success: true, data: input };
    }
    logger.warn(`Object validation failed in ${context || 'unknown'}`);
    return { success: false, error: 'Validation failed', data: fallback };
  }

  if (typeof input !== 'string') {
    logger.error(`Invalid input type in ${context || 'unknown'}`, { 
      type: typeof input 
    });
    return { success: false, error: 'Invalid input type', data: fallback };
  }

  const parseResult = safeJSONParse<T>(input, fallback, context);
  
  if (parseResult.success && parseResult.data) {
    if (validator(parseResult.data)) {
      return parseResult;
    }
    logger.warn(`Parsed data validation failed in ${context || 'unknown'}`);
    return { 
      success: false, 
      error: 'Validation failed after parsing', 
      data: fallback 
    };
  }

  return parseResult;
}

export function mergePartialData<T extends Record<string, unknown>>(
  primary: Partial<T>,
  secondary: Partial<T>,
  defaults: T
): T {
  const result = { ...defaults };

  for (const key in defaults) {
    if (primary[key] !== undefined && primary[key] !== null) {
      result[key] = primary[key] as T[Extract<keyof T, string>];
    } else if (secondary[key] !== undefined && secondary[key] !== null) {
      result[key] = secondary[key] as T[Extract<keyof T, string>];
    }
  }

  return result;
}