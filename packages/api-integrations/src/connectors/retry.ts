export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

export function createRetryHandler(config: RetryConfig = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitterFactor = 0.5,
  } = config;

  function calculateDelay(attempt: number): number {
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponentialDelay, maxDelayMs);
    const jitter = capped * jitterFactor * Math.random();
    return capped + jitter;
  }

  async function execute<T>(
    fn: () => Promise<T>,
    label = "operation",
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delay = calculateDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error(`${label} failed after ${maxRetries + 1} attempts`);
  }

  return { execute, calculateDelay };
}
