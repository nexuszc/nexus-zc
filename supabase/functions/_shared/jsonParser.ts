import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const MAX_LOG_LENGTH = 5000;

export interface JsonParseResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rawInput?: string;
}

export function safeJsonParse<T = unknown>(
  input: string | null | undefined,
  context?: string
): JsonParseResult<T> {
  const logContext = context ? `[${context}]` : "";

  if (input === null || input === undefined) {
    const error = `${logContext} Input is null or undefined`;
    console.error(error);
    return {
      success: false,
      error,
      rawInput: String(input),
    };
  }

  if (typeof input !== "string") {
    const error = `${logContext} Input is not a string: ${typeof input}`;
    console.error(error);
    return {
      success: false,
      error,
      rawInput: String(input).substring(0, MAX_LOG_LENGTH),
    };
  }

  const trimmedInput = input.trim();

  if (trimmedInput.length === 0) {
    const error = `${logContext} Input is empty string`;
    console.error(error);
    return {
      success: false,
      error,
      rawInput: "",
    };
  }

  if (!isCompleteJson(trimmedInput)) {
    const error = `${logContext} Incomplete JSON detected`;
    console.error(error, {
      length: trimmedInput.length,
      start: trimmedInput.substring(0, 100),
      end: trimmedInput.substring(Math.max(0, trimmedInput.length - 100)),
    });
    return {
      success: false,
      error,
      rawInput: trimmedInput.substring(0, MAX_LOG_LENGTH),
    };
  }

  try {
    const parsed = JSON.parse(trimmedInput) as T;
    return {
      success: true,
      data: parsed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullError = `${logContext} JSON parse error: ${errorMessage}`;

    console.error(fullError, {
      inputLength: trimmedInput.length,
      inputStart: trimmedInput.substring(0, 200),
      inputEnd: trimmedInput.substring(Math.max(0, trimmedInput.length - 200)),
      rawInputTruncated: trimmedInput.substring(0, MAX_LOG_LENGTH),
    });

    return {
      success: false,
      error: fullError,
      rawInput: trimmedInput.substring(0, MAX_LOG_LENGTH),
    };
  }
}

function isCompleteJson(input: string): boolean {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return false;
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  if (firstChar === "{" && lastChar !== "}") {
    return false;
  }

  if (firstChar === "[" && lastChar !== "]") {
    return false;
  }

  if (firstChar === '"' && lastChar !== '"') {
    return false;
  }

  if (firstChar === "{" || firstChar === "[") {
    let depth = 0;
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

      if (!inString) {
        if (char === "{" || char === "[") {
          depth++;
        } else if (char === "}" || char === "]") {
          depth--;
        }
      }
    }

    return depth === 0 && !inString;
  }

  return true;
}

export async function logJsonParseError(
  supabaseUrl: string,
  supabaseKey: string,
  errorDetails: {
    context: string;
    input: string;
    error: string;
    nexusId?: string;
    cycleNumber?: number;
  }
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("json_parse_errors").insert({
      context: errorDetails.context,
      raw_input: errorDetails.input.substring(0, MAX_LOG_LENGTH),
      error_message: errorDetails.error,
      nexus_id: errorDetails.nexusId,
      cycle_number: errorDetails.cycleNumber,
      created_at: new Date().toISOString(),
    });
  } catch (logError) {
    console.error("Failed to log JSON parse error to database:", logError);
  }
}

export function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();

  const jsonMatch = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  return null;
}

export function validateJsonStructure(
  data: unknown,
  requiredFields: string[]
): { valid: boolean; missingFields: string[] } {
  if (!data || typeof data !== "object") {
    return { valid: false, missingFields: requiredFields };
  }

  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!(field in (data as Record<string, unknown>))) {
      missingFields.push(field);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}