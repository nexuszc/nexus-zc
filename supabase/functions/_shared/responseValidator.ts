export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  recoveredData?: unknown;
}

export function validateJsonResponse(
  response: string,
  contentLength?: number
): ValidationResult {
  if (!response || response.trim().length === 0) {
    return {
      isValid: false,
      reason: "Empty response received",
    };
  }

  const trimmed = response.trim();

  if (contentLength && trimmed.length < contentLength) {
    return {
      isValid: false,
      reason: `Incomplete response: expected ${contentLength} bytes, got ${trimmed.length}`,
    };
  }

  const brackets: { [key: string]: string } = {
    "{": "}",
    "[": "]",
  };
  const closingBrackets: { [key: string]: string } = {
    "}": "{",
    "]": "[",
  };
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
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

    if (brackets[char]) {
      stack.push(char);
    } else if (closingBrackets[char]) {
      if (stack.length === 0) {
        return {
          isValid: false,
          reason: `Unexpected closing bracket '${char}' at position ${i}`,
        };
      }
      const last = stack.pop();
      if (brackets[last!] !== char) {
        return {
          isValid: false,
          reason: `Mismatched brackets: expected '${brackets[last!]}' but got '${char}' at position ${i}`,
        };
      }
    }
  }

  if (inString) {
    return {
      isValid: false,
      reason: "Truncated string: unclosed quote detected",
    };
  }

  if (stack.length > 0) {
    const unclosed = stack.map((b) => `'${b}'`).join(", ");
    return {
      isValid: false,
      reason: `Unclosed brackets: ${unclosed}`,
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      isValid: true,
      recoveredData: parsed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    const jsonMatch = trimmed.match(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const recovered = JSON.parse(jsonMatch[1]);
        return {
          isValid: true,
          recoveredData: recovered,
        };
      } catch {
        // Recovery failed, continue to error
      }
    }

    return {
      isValid: false,
      reason: `JSON parse error: ${errorMessage}`,
    };
  }
}

export function extractCompleteJson(text: string): string | null {
  if (!text) return null;

  const trimmed = text.trim();
  
  const patterns = [
    /(\{(?:[^{}]|(?:\{[^{}]*\}))*\})/g,
    /(\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\])/g,
  ];

  for (const pattern of patterns) {
    const matches = trimmed.match(pattern);
    if (matches) {
      for (const match of matches) {
        const validation = validateJsonResponse(match);
        if (validation.isValid) {
          return match;
        }
      }
    }
  }

  return null;
}