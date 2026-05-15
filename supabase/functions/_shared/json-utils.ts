export interface JsonParseResult<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export function safeJsonParse<T = any>(input: string, context?: string): JsonParseResult<T> {
  if (!input || typeof input !== 'string') {
    return {
      success: false,
      data: null,
      error: `Invalid input: expected non-empty string, got ${typeof input}`
    };
  }

  const trimmedInput = input.trim();
  
  if (trimmedInput.length === 0) {
    return {
      success: false,
      data: null,
      error: 'Empty string provided'
    };
  }

  try {
    const parsed = JSON.parse(trimmedInput);
    return {
      success: true,
      data: parsed,
      error: null
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const truncatedInput = trimmedInput.length > 200 
      ? trimmedInput.substring(0, 200) + '...[truncated]'
      : trimmedInput;
    
    const contextMsg = context ? ` [Context: ${context}]` : '';
    
    console.error(`JSON Parse Error${contextMsg}:`, {
      error: errorMessage,
      rawInput: truncatedInput,
      inputLength: trimmedInput.length
    });

    return {
      success: false,
      data: null,
      error: `Failed to parse JSON: ${errorMessage}`
    };
  }
}

export function isValidJsonString(input: string): boolean {
  if (!input || typeof input !== 'string') {
    return false;
  }

  const trimmed = input.trim();
  
  if (trimmed.length === 0) {
    return false;
  }

  if (!['{', '[', '"', 't', 'f', 'n'].includes(trimmed[0]) && !trimmed.match(/^-?\d/)) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeJsonResponse(response: string): string {
  if (!response || typeof response !== 'string') {
    return '{}';
  }

  let sanitized = response.trim();

  sanitized = sanitized.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

  sanitized = sanitized.replace(/,(\s*[}\]])/g, '$1');

  const openBraces = (sanitized.match(/{/g) || []).length;
  const closeBraces = (sanitized.match(/}/g) || []).length;
  const openBrackets = (sanitized.match(/\[/g) || []).length;
  const closeBrackets = (sanitized.match(/]/g) || []).length;

  if (openBraces > closeBraces) {
    sanitized += '}'.repeat(openBraces - closeBraces);
  }
  
  if (openBrackets > closeBrackets) {
    sanitized += ']'.repeat(openBrackets - closeBrackets);
  }

  const quoteCount = (sanitized.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    const lastQuoteIndex = sanitized.lastIndexOf('"');
    if (lastQuoteIndex !== -1 && lastQuoteIndex < sanitized.length - 1) {
      const beforeLastQuote = sanitized.substring(0, lastQuoteIndex + 1);
      const afterLastQuote = sanitized.substring(lastQuoteIndex + 1).replace(/[^}\]]/g, '');
      sanitized = beforeLastQuote + '"' + afterLastQuote;
    }
  }

  if (!isValidJsonString(sanitized)) {
    console.warn('Sanitization produced invalid JSON, returning empty object', {
      original: response.substring(0, 100),
      sanitized: sanitized.substring(0, 100)
    });
    return '{}';
  }

  return sanitized;
}

export function parseJsonSafely<T = any>(input: string, context?: string): T | null {
  const sanitized = sanitizeJsonResponse(input);
  const result = safeJsonParse<T>(sanitized, context);
  return result.success ? result.data : null;
}