export interface JSONValidationResult {
  valid: boolean;
  error?: string;
  context?: string;
}

export function validateJSON(jsonString: string): JSONValidationResult {
  if (!jsonString || jsonString.trim() === '') {
    return {
      valid: false,
      error: 'Empty or null JSON string',
      context: 'Input validation'
    };
  }

  const trimmed = jsonString.trim();
  
  const braceCount = (trimmed.match(/{/g) || []).length - (trimmed.match(/}/g) || []).length;
  const bracketCount = (trimmed.match(/\[/g) || []).length - (trimmed.match(/\]/g) || []).length;
  
  if (braceCount !== 0) {
    return {
      valid: false,
      error: `Unmatched braces: ${braceCount > 0 ? 'missing ' + braceCount + ' closing brace(s)' : 'extra ' + Math.abs(braceCount) + ' closing brace(s)'}`,
      context: `String length: ${trimmed.length}, Last 50 chars: ${trimmed.slice(-50)}`
    };
  }
  
  if (bracketCount !== 0) {
    return {
      valid: false,
      error: `Unmatched brackets: ${bracketCount > 0 ? 'missing ' + bracketCount + ' closing bracket(s)' : 'extra ' + Math.abs(bracketCount) + ' closing bracket(s)'}`,
      context: `String length: ${trimmed.length}, Last 50 chars: ${trimmed.slice(-50)}`
    };
  }

  try {
    JSON.parse(trimmed);
    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    let lineNumber: number | undefined;
    let columnNumber: number | undefined;
    let position: number | undefined;
    
    const positionMatch = errorMessage.match(/position (\d+)/i);
    if (positionMatch) {
      position = parseInt(positionMatch[1], 10);
      const lines = trimmed.substring(0, position).split('\n');
      lineNumber = lines.length;
      columnNumber = lines[lines.length - 1].length + 1;
    }
    
    const lineMatch = errorMessage.match(/line (\d+)/i);
    const columnMatch = errorMessage.match(/column (\d+)/i);
    if (lineMatch) lineNumber = parseInt(lineMatch[1], 10);
    if (columnMatch) columnNumber = parseInt(columnMatch[1], 10);
    
    let contextSnippet = '';
    if (position !== undefined) {
      const start = Math.max(0, position - 50);
      const end = Math.min(trimmed.length, position + 50);
      const before = trimmed.substring(start, position);
      const after = trimmed.substring(position, end);
      contextSnippet = `...${before}<<<ERROR>>>${after}...`;
    } else {
      contextSnippet = `Last 100 chars: ${trimmed.slice(-100)}`;
    }
    
    const locationInfo = lineNumber !== undefined 
      ? `Line ${lineNumber}${columnNumber !== undefined ? `, Column ${columnNumber}` : ''}`
      : position !== undefined 
        ? `Position ${position}` 
        : 'Unknown location';
    
    return {
      valid: false,
      error: `JSON parse error: ${errorMessage} at ${locationInfo}`,
      context: contextSnippet
    };
  }
}

export function safeJSONParse<T = any>(jsonString: string): T | null {
  const result = validateJSON(jsonString);
  if (!result.valid) {
    console.error('JSON validation failed:', result.error, result.context);
    return null;
  }
  return JSON.parse(jsonString) as T;
}

export function validateAndLogJSON(jsonString: string, label: string = 'JSON'): JSONValidationResult {
  const result = validateJSON(jsonString);
  if (!result.valid) {
    console.error(`${label} validation failed:`, {
      error: result.error,
      context: result.context,
      stringLength: jsonString.length,
      firstChars: jsonString.substring(0, 100),
      lastChars: jsonString.slice(-100)
    });
  }
  return result;
}