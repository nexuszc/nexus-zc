export interface ParseResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  recovered?: boolean;
  attemptedFixes?: string[];
}

export function safeJsonParse<T = any>(
  input: string | null | undefined,
  options: { 
    allowPartial?: boolean;
    maxDepth?: number;
    defaultValue?: T;
  } = {}
): ParseResult<T> {
  const attemptedFixes: string[] = [];

  if (input === null || input === undefined || input === '') {
    return {
      success: false,
      error: 'Empty or null input',
      data: options.defaultValue,
      attemptedFixes
    };
  }

  if (typeof input !== 'string') {
    try {
      return {
        success: true,
        data: input as T,
        attemptedFixes
      };
    } catch {
      return {
        success: false,
        error: 'Invalid input type',
        data: options.defaultValue,
        attemptedFixes
      };
    }
  }

  const strategies = [
    { name: 'direct', fn: (s: string) => s },
    { name: 'trim', fn: (s: string) => s.trim() },
    { name: 'removeTrailingComma', fn: removeTrailingCommas },
    { name: 'completeStructure', fn: completeJsonStructure },
    { name: 'extractFragment', fn: extractValidJsonFragment },
    { name: 'fixQuotes', fn: fixQuotes },
    { name: 'removeControlChars', fn: removeControlCharacters },
    { name: 'combined', fn: (s: string) => completeJsonStructure(removeTrailingCommas(s.trim())) }
  ];

  for (const strategy of strategies) {
    try {
      const processed = strategy.fn(input);
      const parsed = JSON.parse(processed);
      
      return {
        success: true,
        data: parsed as T,
        recovered: strategy.name !== 'direct',
        attemptedFixes: strategy.name !== 'direct' ? [strategy.name] : []
      };
    } catch (e) {
      attemptedFixes.push(strategy.name);
      continue;
    }
  }

  if (options.allowPartial) {
    const partial = extractPartialJson(input);
    if (partial) {
      attemptedFixes.push('partial');
      return {
        success: true,
        data: partial as T,
        recovered: true,
        attemptedFixes
      };
    }
  }

  return {
    success: false,
    error: `JSON parse failed after ${attemptedFixes.length} attempts`,
    data: options.defaultValue,
    attemptedFixes
  };
}

function removeTrailingCommas(json: string): string {
  return json
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/,(\s*$)/g, '');
}

function completeJsonStructure(json: string): string {
  let str = json.trim();
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

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

    if (inString) continue;

    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}') {
      if (stack[stack.length - 1] === '{') {
        stack.pop();
      }
    } else if (char === ']') {
      if (stack[stack.length - 1] === '[') {
        stack.pop();
      }
    }
  }

  if (inString) {
    str += '"';
  }

  while (stack.length > 0) {
    const open = stack.pop();
    str += open === '{' ? '}' : ']';
  }

  return str;
}

function extractValidJsonFragment(json: string): string {
  const objectMatch = json.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return completeJsonStructure(objectMatch[0]);
  }

  const arrayMatch = json.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return completeJsonStructure(arrayMatch[0]);
  }

  return json;
}

function fixQuotes(json: string): string {
  return json
    .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function removeControlCharacters(json: string): string {
  return json.replace(/[\x00-\x1F\x7F]/g, '');
}

function extractPartialJson(json: string): any | null {
  const pairs: Array<{ key: string; value: any }> = [];
  const keyValuePattern = /"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]]+)/g;
  
  let match;
  while ((match = keyValuePattern.exec(json)) !== null) {
    try {
      const key = match[1];
      let value = match[2].trim();
      
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (value === 'null') {
        value = null;
      } else if (!isNaN(Number(value))) {
        value = Number(value);
      }
      
      pairs.push({ key, value });
    } catch {
      continue;
    }
  }

  if (pairs.length > 0) {
    const result: Record<string, any> = {};
    pairs.forEach(({ key, value }) => {
      result[key] = value;
    });
    return result;
  }

  return null;
}

export function validateJson(input: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(input);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Unknown JSON error'
    };
  }
}

export function mergePartialJson(existing: any, partial: string): ParseResult {
  const parseResult = safeJsonParse(partial, { allowPartial: true });
  
  if (!parseResult.success) {
    return parseResult;
  }

  try {
    const merged = { ...existing, ...parseResult.data };
    return {
      success: true,
      data: merged,
      recovered: parseResult.recovered,
      attemptedFixes: parseResult.attemptedFixes
    };
  } catch (e) {
    return {
      success: false,
      error: 'Failed to merge partial JSON',
      attemptedFixes: parseResult.attemptedFixes
    };
  }
}