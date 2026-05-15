export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateInput(input: unknown): ValidationResult {
  // Check for null or undefined
  if (input === null || input === undefined) {
    return {
      valid: false,
      error: "Input is null or undefined"
    };
  }

  // Convert to string for validation
  const inputStr = String(input).trim();

  // Check for empty string
  if (inputStr === "") {
    return {
      valid: false,
      error: "Input is empty string"
    };
  }

  // Check for whitespace-only
  if (String(input).trim() !== String(input) && inputStr === "") {
    return {
      valid: false,
      error: "Input contains only whitespace"
    };
  }

  // Check basic JSON structure
  const firstChar = inputStr.charAt(0);
  const lastChar = inputStr.charAt(inputStr.length - 1);

  if (firstChar !== "{" && firstChar !== "[") {
    return {
      valid: false,
      error: `Input does not start with valid JSON character. Starts with: '${firstChar}' (length: ${inputStr.length})`
    };
  }

  if ((firstChar === "{" && lastChar !== "}") || (firstChar === "[" && lastChar !== "]")) {
    return {
      valid: false,
      error: `JSON structure mismatch. Starts with '${firstChar}' but ends with '${lastChar}'`
    };
  }

  return { valid: true };
}

export function logValidationFailure(input: unknown, error: string, context: string = ""): void {
  const timestamp = new Date().toISOString();
  const inputType = typeof input;
  const inputPreview = input === null ? "null" 
    : input === undefined ? "undefined"
    : String(input).substring(0, 200);
  
  console.error(`[${timestamp}] JSON Validation Failure${context ? ` (${context})` : ""}:`, {
    error,
    inputType,
    inputPreview,
    inputLength: input ? String(input).length : 0
  });
}

export async function safeJsonParse<T = unknown>(
  input: unknown,
  context: string = ""
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const validation = validateInput(input);
  
  if (!validation.valid) {
    logValidationFailure(input, validation.error!, context);
    return {
      success: false,
      error: validation.error!
    };
  }

  try {
    const parsed = JSON.parse(String(input)) as T;
    return {
      success: true,
      data: parsed
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown JSON parse error";
    logValidationFailure(input, errorMessage, context);
    return {
      success: false,
      error: errorMessage
    };
  }
}