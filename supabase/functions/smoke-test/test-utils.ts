import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  status: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface TestResult {
  passed: boolean;
  actual: unknown;
  expected: unknown;
  message: string;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts) {
        const delay = backoff ? delayMs * attempt : delayMs;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Retry failed with unknown error");
}

export function normalizeResponse(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    return { value: response };
  }
  
  const normalized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(response as Record<string, unknown>)) {
    if (key.toLowerCase().includes("timestamp") || key.toLowerCase().includes("time")) {
      continue;
    }
    
    if (key.toLowerCase().includes("id") && typeof value === "string") {
      normalized[key] = value.length > 0 ? "ID_PRESENT" : value;
      continue;
    }
    
    normalized[key] = value;
  }
  
  return normalized;
}

export function validateHealthState(result: HealthCheckResult): boolean {
  if (result.status >= 200 && result.status < 300) {
    return true;
  }
  
  if (result.status === 503 && result.details?.recovering === true) {
    return true;
  }
  
  if (result.status === 429) {
    return true;
  }
  
  return false;
}

export function compareWithTolerance(
  actual: number,
  expected: number,
  tolerancePercent: number = 10
): boolean {
  if (expected === 0) {
    return Math.abs(actual) <= tolerancePercent / 100;
  }
  
  const diff = Math.abs(actual - expected);
  const tolerance = Math.abs(expected * (tolerancePercent / 100));
  
  return diff <= tolerance;
}

export function assertWithTolerance(
  actual: number,
  expected: number,
  tolerancePercent: number = 10,
  message?: string
): void {
  if (!compareWithTolerance(actual, expected, tolerancePercent)) {
    const msg = message || 
      `Expected ${actual} to be within ${tolerancePercent}% of ${expected}`;
    throw new Error(msg);
  }
}

export function validateTestResult(
  actual: unknown,
  expected: unknown,
  options: {
    strict?: boolean;
    tolerance?: number;
    ignoreKeys?: string[];
  } = {}
): TestResult {
  const { strict = false, tolerance, ignoreKeys = [] } = options;
  
  if (typeof actual === "number" && typeof expected === "number" && tolerance !== undefined) {
    const passed = compareWithTolerance(actual, expected, tolerance);
    return {
      passed,
      actual,
      expected,
      message: passed 
        ? "Values match within tolerance" 
        : `${actual} not within ${tolerance}% of ${expected}`
    };
  }
  
  if (strict) {
    const passed = actual === expected;
    return {
      passed,
      actual,
      expected,
      message: passed ? "Values match exactly" : "Values do not match"
    };
  }
  
  if (typeof actual === "object" && typeof expected === "object" && actual !== null && expected !== null) {
    const normalizedActual = normalizeResponse(actual);
    const normalizedExpected = normalizeResponse(expected);
    
    for (const key of ignoreKeys) {
      delete normalizedActual[key];
      delete normalizedExpected[key];
    }
    
    const passed = JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected);
    return {
      passed,
      actual: normalizedActual,
      expected: normalizedExpected,
      message: passed ? "Objects match" : "Objects differ"
    };
  }
  
  const passed = actual == expected;
  return {
    passed,
    actual,
    expected,
    message: passed ? "Values match" : "Values do not match"
  };
}

export async function waitForCondition(
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number = 10000,
  checkIntervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await Promise.resolve(condition());
      if (result) {
        return true;
      }
    } catch {
      // Condition check failed, continue waiting
    }
    
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }
  
  return false;
}

export function createHealthValidator(acceptableStatuses: number[] = [200, 201, 204]) {
  return (result: HealthCheckResult): boolean => {
    if (acceptableStatuses.includes(result.status)) {
      return true;
    }
    
    return validateHealthState(result);
  };
}

export function sanitizeErrorMessage(error: Error | unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "TIMESTAMP")
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "UUID")
      .replace(/\d{13,}/g, "TIMESTAMP_MS");
  }
  
  return String(error);
}

export function createTestLogger(verbose: boolean = false) {
  return {
    log: (...args: unknown[]) => {
      if (verbose) {
        console.log(...args);
      }
    },
    error: (...args: unknown[]) => {
      console.error(...args);
    },
    info: (...args: unknown[]) => {
      if (verbose) {
        console.info(...args);
      }
    }
  };
}