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
  private probeInFlight = false;
  private probeStartedAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    if (this.config.failureThreshold <= 0) throw new Error("failureThreshold must be > 0");
    if (this.config.resetTimeoutMs <= 0) throw new Error("resetTimeoutMs must be > 0");
    if (this.config.windowMs <= 0) throw new Error("windowMs must be > 0");
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
    this.probeInFlight = false;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failures = [];
    }
  }

  recordFailure(): void {
    this.probeInFlight = false;
    const now = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.lastOpenedAt = now;
      return;
    }

    // Prune failures outside the window
    this.failures = this.failures.filter((t) => now - t < this.config.windowMs);
    this.failures.push(now);

    // Cap array size to prevent unbounded growth
    if (this.failures.length > this.config.failureThreshold * 2) {
      this.failures = this.failures.slice(-this.config.failureThreshold * 2);
    }

    if (this.failures.length >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.lastOpenedAt = now;
    }
  }

  canExecute(): boolean {
    const current = this.currentState;
    if (current === CircuitState.HALF_OPEN) {
      // Auto-reset probe flag if the probe has been in-flight for longer than the reset timeout
      // (e.g., caller got a connection but never recorded success/failure)
      if (this.probeInFlight && Date.now() - this.probeStartedAt < this.config.resetTimeoutMs) {
        return false;
      }
      this.probeInFlight = true;
      this.probeStartedAt = Date.now();
      return true;
    }
    return current === CircuitState.CLOSED;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.lastOpenedAt = 0;
  }
}
