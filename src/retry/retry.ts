import { DEFAULT_RETRY_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { classifyError } from "./error-classifier.js";
import type { RetryConfig, RetryContext } from "./types.js";

/**
 * Full-jitter exponential backoff delay calculation.
 * jitter = random(0, min(maxDelay, baseDelay * 2^attempt))
 */
function computeDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * config.backoffMultiplier ** attempt;
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.random() * capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with retries. Returns the result or throws after exhausting retries.
 * Generic so it can wrap any async operation, not just transaction sending.
 */
export async function withRetry<T>(
  fn: (context: RetryContext) => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const resolved: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
    const context: RetryContext = {
      attempt,
      totalAttempts: resolved.maxRetries + 1,
      elapsed: Date.now() - startTime,
      lastError,
    };

    try {
      return await fn(context);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Last attempt — don't retry
      if (attempt >= resolved.maxRetries) {
        break;
      }

      // Check custom predicate first
      if (resolved.retryPredicate) {
        if (!resolved.retryPredicate(error, attempt)) {
          throw new SolTxError(SolTxErrorCode.NON_RETRYABLE, `Non-retryable (custom predicate): ${error.message}`, {
            cause: error,
            context: { attempt },
          });
        }
      } else {
        // Default classification
        const classification = classifyError(error);
        if (!classification.retryable) {
          throw new SolTxError(SolTxErrorCode.NON_RETRYABLE, `Non-retryable: ${error.message}`, {
            cause: error,
            context: { attempt, errorType: classification.errorType },
          });
        }
      }

      const delayMs = computeDelay(attempt, resolved);

      // Call onRetry hook before waiting
      if (resolved.onRetry) {
        await resolved.onRetry(error, attempt, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw new SolTxError(SolTxErrorCode.RETRIES_EXHAUSTED, `All ${resolved.maxRetries + 1} attempts failed`, {
    cause: lastError ?? new Error("Unknown error"),
    context: { maxRetries: resolved.maxRetries, elapsed: Date.now() - startTime },
  });
}
