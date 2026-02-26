export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in ms before first retry (default: 500) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs: number;
  /** Exponential multiplier (default: 2) */
  backoffMultiplier: number;
  /** Custom predicate: return true to retry, false to fail immediately */
  retryPredicate?: (error: Error, attempt: number) => boolean;
  /** Called before each retry — hook for re-signing, logging, etc. */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void | Promise<void>;
}

export interface RetryContext {
  attempt: number;
  totalAttempts: number;
  elapsed: number;
  lastError?: Error | undefined;
}
