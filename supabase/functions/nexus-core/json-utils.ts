export class CircularReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircularReferenceError';
  }
}

export function getCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet();
  
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  };
}

export function safeStringify(
  obj: unknown,
  space?: string | number
): { success: true; data: string } | { success: false; error: string } {
  try {
    const json = JSON.stringify(obj, getCircularReplacer(), space);
    
    if (!validateJSONComplete(json)) {
      return {
        success: false,
        error: 'Generated JSON is incomplete or malformed'
      };
    }
    
    return { success: true, data: json };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown serialization error';
    console.error('[JSON] Stringify error:', {
      error: errorMessage,
      objectType: typeof obj,
      objectKeys: obj && typeof obj === 'object' ? Object.keys(obj) : null
    });
    
    return {
      success: false,
      error: `JSON stringify failed: ${errorMessage}`
    };
  }
}

export function safeJSONParse<T = unknown>(
  jsonString: string
): { success: true; data: T } | { success: false; error: string } {
  if (!jsonString || typeof jsonString !== 'string') {
    return {
      success: false,
      error: 'Invalid input: expected non-empty string'
    };
  }

  const trimmed = jsonString.trim();
  
  if (!trimmed) {
    return {
      success: false,
      error: 'Cannot parse empty JSON string'
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return { success: true, data: parsed as T };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
    console.error('[JSON] Parse error:', {
      error: errorMessage,
      stringLength: trimmed.length,
      stringPreview: trimmed.substring(0, 100),
      stringSuffix: trimmed.substring(Math.max(0, trimmed.length - 50))
    });
    
    return {
      success: false,
      error: `JSON parse failed: ${errorMessage}`
    };
  }
}

export function validateJSONComplete(jsonString: string): boolean {
  if (!jsonString || typeof jsonString !== 'string') {
    return false;
  }

  const trimmed = jsonString.trim();
  
  if (!trimmed) {
    return false;
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if (firstChar === '{' && lastChar !== '}') {
    return false;
  }

  if (firstChar === '[' && lastChar !== ']') {
    return false;
  }

  if (firstChar === '"' && lastChar !== '"') {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function ensureCompleteJSON(obj: unknown): string {
  const result = safeStringify(obj);
  
  if (!result.success) {
    console.error('[JSON] Failed to create complete JSON:', result.error);
    return JSON.stringify({
      error: 'Serialization failed',
      message: result.error,
      timestamp: new Date().toISOString()
    });
  }
  
  return result.data;
}

export function detectCircularReferences(obj: unknown, path: string[] = []): string[] {
  const seen = new WeakMap<object, string[]>();
  const circularPaths: string[] = [];

  function detect(value: unknown, currentPath: string[]): void {
    if (typeof value !== 'object' || value === null) {
      return;
    }

    if (seen.has(value)) {
      const originalPath = seen.get(value)!;
      circularPaths.push(
        `Circular: ${currentPath.join('.')} -> ${originalPath.join('.')}`
      );
      return;
    }

    seen.set(value, [...currentPath]);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        detect(item, [...currentPath, `[${index}]`]);
      });
    } else {
      Object.entries(value).forEach(([key, val]) => {
        detect(val, [...currentPath, key]);
      });
    }
  }

  detect(obj, path);
  return circularPaths;
}