type RetryableFunction<T> = () => Promise<T>;

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
}

export async function exponentialBackoff<T>(
  fn: RetryableFunction<T>,
  maxAttempts: number = 5,
  baseDelay: number = 100
): Promise<T> {
  return retry(fn, { maxAttempts, baseDelay });
}

export async function retry<T>(
  fn: RetryableFunction<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelay = 100,
    maxDelay = 30000,
    jitterFactor = 0.1,
  } = options;

  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Retry] Attempt ${attempt}/${maxAttempts}`);
      const result = await fn();
      
      if (attempt > 1) {
        console.log(`[Retry] Success on attempt ${attempt}`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Retry] Attempt ${attempt}/${maxAttempts} failed:`, errorMessage);

      if (attempt === maxAttempts) {
        console.error(`[Retry] All ${maxAttempts} attempts exhausted`);
        break;
      }

      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
      const delay = Math.max(0, exponentialDelay + jitter);

      console.log(`[Retry] Waiting ${Math.round(delay)}ms before attempt ${attempt + 1}`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}