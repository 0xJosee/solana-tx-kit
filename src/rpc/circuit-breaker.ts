import { type CircuitBreakerConfig, CircuitState } from "./types.js";

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  windowMs: 60_000,
};

/**
 * Circuit breaker per endpoint.
 *
 * State transitions:
 *   CLOSED --[failureThreshold exceeded]--> OPEN
 *   OPEN   --[resetTimeout elapsed]------> HALF_OPEN
 *   HALF_OPEN --[probe succeeds]----------> CLOSED
 *   HALF_OPEN --[probe fails]-------------> OPEN
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private lastOpenedAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  get currentState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastOpenedAt >= this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      }
    }
    return this.state;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failures = [];
    }
  }

  recordFailure(): void {
    const now = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.lastOpenedAt = now;
      return;
    }

    // Prune failures outside the window
    this.failures = this.failures.filter((t) => now - t < this.config.windowMs);
    this.failures.push(now);

    if (this.failures.length >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.lastOpenedAt = now;
    }
  }

  canExecute(): boolean {
    const current = this.currentState;
    return current === CircuitState.CLOSED || current === CircuitState.HALF_OPEN;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.lastOpenedAt = 0;
  }
}
