import { sleep } from "./time.js";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = options.shouldRetry?.(error) ?? true;
      if (!retryable || attempt === attempts) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
};
