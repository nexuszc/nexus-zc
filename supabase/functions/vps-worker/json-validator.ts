export interface ValidationResult {
  valid: boolean;
  error?: string;
  rawInput?: string;
}

export function validateJSON(input: unknown): ValidationResult {
  if (input === null || input === undefined) {
    return {
      valid: false,
      error: 'Input is null or undefined',
      rawInput: String(input)
    };
  }

  if (typeof input !== 'string') {
    return {
      valid: false,
      error: `Input is not a string, got type: ${typeof input}`,
      rawInput: String(input)
    };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      error: 'Input is empty string',
      rawInput: input
    };
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if (firstChar !== '{' && firstChar !== '[') {
    return {
      valid: false,
      error: `Invalid JSON structure: must start with { or [, got '${firstChar}'`,
      rawInput: input.substring(0, 100)
    };
  }

  if (
    (firstChar === '{' && lastChar !== '}') ||
    (firstChar === '[' && lastChar !== ']')
  ) {
    return {
      valid: false,
      error: `Mismatched brackets: starts with '${firstChar}' but ends with '${lastChar}'`,
      rawInput: input.substring(0, 100)
    };
  }

  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;

    if (braceCount < 0 || bracketCount < 0) {
      return {
        valid: false,
        error: `Unbalanced brackets at position ${i}`,
        rawInput: input.substring(0, 100)
      };
    }
  }

  if (braceCount !== 0 || bracketCount !== 0) {
    return {
      valid: false,
      error: `Unbalanced brackets: ${braceCount} unclosed braces, ${bracketCount} unclosed brackets`,
      rawInput: input.substring(0, 100)
    };
  }

  if (inString) {
    return {
      valid: false,
      error: 'Unterminated string',
      rawInput: input.substring(0, 100)
    };
  }

  return { valid: true };
}

export function safeJSONParse<T = unknown>(input: unknown): { success: true; data: T } | { success: false; error: string; rawInput: string } {
  const validation = validateJSON(input);
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Validation failed',
      rawInput: validation.rawInput || String(input).substring(0, 100)
    };
  }

  try {
    const parsed = JSON.parse(input as string);
    return { success: true, data: parsed as T };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
    return {
      success: false,
      error: `JSON.parse failed: ${errorMessage}`,
      rawInput: String(input).substring(0, 100)
    };
  }
}