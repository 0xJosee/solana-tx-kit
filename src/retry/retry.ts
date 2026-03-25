import { DEFAULT_RETRY_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { validateNonNegativeInt, validatePositiveNumber } from "../validation.js";
import { classifyError } from "./error-classifier.js";
import type { RetryConfig, RetryContext } from "./types.js";

function truncate(str: string, max = 200): string {
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

/**
 * Full-jitter exponential backoff delay calculation.
 * jitter = random(0, min(maxDelay, baseDelay * 2^attempt))
 */
function computeDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * config.backoffMultiplier ** attempt;
  const capped = Math.min(exponential, config.maxDelayMs, 300_000);
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

  validateNonNegativeInt(resolved.maxRetries, "maxRetries", 50);
  validatePositiveNumber(resolved.baseDelayMs, "baseDelayMs");
  validatePositiveNumber(resolved.maxDelayMs, "maxDelayMs");
  validatePositiveNumber(resolved.backoffMultiplier, "backoffMultiplier");
  if (resolved.maxDelayMs < resolved.baseDelayMs) {
    throw new SolTxError(
      SolTxErrorCode.INVALID_ARGUMENT,
      `maxDelayMs (${resolved.maxDelayMs}) must be >= baseDelayMs (${resolved.baseDelayMs})`,
    );
  }
  if (resolved.totalTimeoutMs !== undefined) {
    validatePositiveNumber(resolved.totalTimeoutMs, "totalTimeoutMs");
  }

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
          throw new SolTxError(
            SolTxErrorCode.NON_RETRYABLE,
            `Non-retryable (custom predicate): ${truncate(error.message)}`,
            {
              cause: error,
              context: { attempt },
            },
          );
        }
      } else {
        // Default classification
        const classification = classifyError(error);
        if (!classification.retryable) {
          throw new SolTxError(SolTxErrorCode.NON_RETRYABLE, `Non-retryable: ${truncate(error.message)}`, {
            cause: error,
            context: { attempt, errorType: classification.errorType },
          });
        }
      }

      // M-9: Check total timeout before retrying
      if (resolved.totalTimeoutMs !== undefined && Date.now() - startTime > resolved.totalTimeoutMs) {
        break;
      }

      const delayMs = computeDelay(attempt, resolved);

      // Call onRetry hook before waiting (wrapped in try-catch to prevent hook errors from breaking the loop)
      if (resolved.onRetry) {
        try {
          await Promise.race([
            resolved.onRetry(error, attempt, delayMs),
            new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
          ]);
        } catch {
          // onRetry errors should not break the retry loop
        }
      }

      await sleep(delayMs);
    }
  }

  throw new SolTxError(SolTxErrorCode.RETRIES_EXHAUSTED, `All ${resolved.maxRetries + 1} attempts failed`, {
    cause: lastError ?? new Error("Unknown error"),
    context: { maxRetries: resolved.maxRetries, elapsed: Date.now() - startTime },
  });
}
