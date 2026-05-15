export interface JsonParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function safeJsonParse<T = unknown>(
  input: string | null | undefined,
  context?: string
): JsonParseResult<T> {
  if (input === null || input === undefined) {
    const error = `JSON parse failed: Input is ${input}`;
    console.error(error, { context });
    return { success: false, error };
  }

  if (typeof input !== 'string') {
    const error = `JSON parse failed: Input is not a string (type: ${typeof input})`;
    console.error(error, { context, input });
    return { success: false, error };
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    const error = 'JSON parse failed: Input is empty string';
    console.error(error, { context });
    return { success: false, error };
  }

  try {
    const data = JSON.parse(trimmed) as T;
    return { success: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown JSON parse error';
    console.error('JSON parse failed:', {
      error,
      context,
      inputLength: trimmed.length,
      inputPreview: trimmed.substring(0, 200),
      inputSuffix: trimmed.length > 200 ? trimmed.substring(trimmed.length - 50) : undefined
    });
    return { success: false, error };
  }
}

export function parseJsonOrThrow<T = unknown>(
  input: string | null | undefined,
  context?: string
): T {
  const result = safeJsonParse<T>(input, context);
  if (!result.success) {
    throw new Error(result.error || 'JSON parsing failed');
  }
  return result.data!;
}

export function isValidJson(input: string | null | undefined): boolean {
  return safeJsonParse(input).success;
}