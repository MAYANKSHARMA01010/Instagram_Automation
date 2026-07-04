import logger from './logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
  abortSignal?: AbortSignal;
  label?: string;
}

/**
 * Default retry predicate — retries on network and server errors.
 */
function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Retry on network errors and 5xx responses
    if (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Executes an async function with exponential backoff retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the async function
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs = 60_000,
    shouldRetry = defaultShouldRetry,
    onRetry,
    abortSignal,
    label = 'operation',
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abortSignal?.aborted) {
      throw new Error('The operation was aborted');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (abortSignal?.aborted) {
        throw new Error('The operation was aborted');
      }

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.random() * 1000;
      const totalDelay = Math.round(delay + jitter);

      logger.warn('Retry attempt', {
        label,
        attempt,
        maxAttempts,
        delayMs: totalDelay,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });

      if (onRetry) {
        onRetry(attempt, error);
      }

      await sleep(totalDelay, abortSignal);
    }
  }

  throw lastError;
}

/**
 * Sleeps for the specified number of milliseconds.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('The operation was aborted'));
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('The operation was aborted'));
      });
    }
  });
}

/**
 * Polls a condition function until it returns true or times out.
 *
 * @param condition - Async function that returns true when done
 * @param intervalMs - How often to poll (milliseconds)
 * @param timeoutMs - Maximum time to wait (milliseconds)
 * @param label - Descriptive label for logging
 */
export async function pollUntil(
  condition: () => Promise<boolean>,
  intervalMs: number,
  timeoutMs: number,
  label = 'condition',
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }

    const elapsed = Date.now() - startTime;
    logger.debug(`Polling ${label}`, { elapsedMs: elapsed, timeoutMs });
    await sleep(intervalMs);
  }

  throw new Error(`Polling timeout after ${timeoutMs}ms for: ${label}`);
}
