export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

export interface RepairResult {
  success: boolean;
  data?: any;
  error?: string;
  originalInput?: string;
}

export function isValidJsonStructure(str: string): ValidationResult {
  if (!str || typeof str !== 'string') {
    return { valid: false, error: 'Input is not a string' };
  }

  const trimmed = str.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Empty string' };
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if ((firstChar === '{' && lastChar !== '}') || (firstChar === '[' && lastChar !== ']')) {
    return { valid: false, error: 'Mismatched brackets' };
  }

  if (firstChar !== '{' && firstChar !== '[') {
    return { valid: false, error: 'JSON must start with { or [' };
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

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;

      if (braceCount < 0 || bracketCount < 0) {
        return { valid: false, error: 'Extra closing bracket' };
      }
    }
  }

  if (braceCount !== 0) {
    return { valid: false, error: `Unclosed braces: ${braceCount}` };
  }

  if (bracketCount !== 0) {
    return { valid: false, error: `Unclosed brackets: ${bracketCount}` };
  }

  if (inString) {
    return { valid: false, error: 'Unclosed string' };
  }

  return { valid: true };
}

export function sanitizeJsonString(str: string): string {
  if (!str || typeof str !== 'string') {
    return '{}';
  }

  let sanitized = str.trim();

  sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  sanitized = sanitized.replace(/,(\s*[}\]])/g, '$1');

  sanitized = sanitized.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  sanitized = sanitized.replace(/:\s*'([^']*)'/g, ':"$1"');

  sanitized = sanitized.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');

  return sanitized;
}

export function repairCommonJsonErrors(str: string): RepairResult {
  if (!str || typeof str !== 'string') {
    return { success: false, error: 'Invalid input', originalInput: str };
  }

  try {
    const parsed = JSON.parse(str);
    return { success: true, data: parsed };
  } catch (e) {
    // Continue to repair attempts
  }

  let repaired = sanitizeJsonString(str);

  const validation = isValidJsonStructure(repaired);
  if (!validation.valid) {
    repaired = attemptBracketRepair(repaired);
  }

  repaired = attemptTrailingCommaFix(repaired);

  try {
    const parsed = JSON.parse(repaired);
    return { success: true, data: parsed };
  } catch (e) {
    const partial = extractPartialValidData(str);
    if (partial) {
      return { success: true, data: partial };
    }

    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown parsing error',
      originalInput: str,
    };
  }
}

function attemptBracketRepair(str: string): string {
  let repaired = str.trim();

  const firstChar = repaired[0];
  const lastChar = repaired[repaired.length - 1];

  if (firstChar === '{' && lastChar !== '}') {
    repaired += '}';
  } else if (firstChar === '[' && lastChar !== ']') {
    repaired += ']';
  }

  let braceCount = 0;
  let bracketCount = 0;

  for (const char of repaired) {
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;
  }

  while (braceCount > 0) {
    repaired += '}';
    braceCount--;
  }

  while (bracketCount > 0) {
    repaired += ']';
    bracketCount--;
  }

  return repaired;
}

function attemptTrailingCommaFix(str: string): string {
  return str.replace(/,(\s*[}\]])/g, '$1');
}

function extractPartialValidData(str: string): any | null {
  const trimmed = str.trim();

  for (let i = trimmed.length; i > 0; i--) {
    const substr = trimmed.substring(0, i);
    try {
      const parsed = JSON.parse(substr);
      return parsed;
    } catch (e) {
      continue;
    }
  }

  const objectMatch = trimmed.match(/\{[^}]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (e) {
      // Continue
    }
  }

  const arrayMatch = trimmed.match(/\[[^\]]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch (e) {
      // Continue
    }
  }

  return null;
}

export function safeJsonParse<T = any>(str: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(str) as T;
  } catch (e) {
    console.error('JSON parse failed:', {
      error: e instanceof Error ? e.message : 'Unknown error',
      input: str.substring(0, 200),
    });

    const repairResult = repairCommonJsonErrors(str);
    if (repairResult.success && repairResult.data) {
      console.log('Successfully repaired JSON');
      return repairResult.data as T;
    }

    return fallback;
  }
}

export function validateSchema<T>(data: any, schema: Record<string, string>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Data must be an object');
    return { valid: false, errors };
  }

  for (const [key, type] of Object.entries(schema)) {
    if (!(key in data)) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }

    const value = data[key];
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (