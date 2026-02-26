import type { Commitment } from "@solana/web3.js";

export interface RpcEndpointConfig {
  /** RPC URL */
  url: string;
  /** Weight for routing (higher = preferred). Default: 1 */
  weight?: number;
  /** Maximum requests per second for this endpoint. 0 = unlimited */
  rateLimit?: number;
  /** Human-readable label (e.g., "helius-primary") */
  label?: string;
}

export interface HealthMetrics {
  /** Exponential moving average of latency in ms */
  latencyEma: number;
  /** Total errors in the sliding window */
  errorCount: number;
  /** Total successes in the sliding window */
  successCount: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Last known slot from this endpoint */
  lastSlot: number;
  /** Delta from the highest known slot across all endpoints */
  slotLag: number;
  /** Timestamp of last successful response */
  lastSuccessAt: number;
  /** Current circuit breaker state */
  circuitState: CircuitState;
}

export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export interface CircuitBreakerConfig {
  /** Number of errors to trip the breaker (default: 5) */
  failureThreshold: number;
  /** Time in OPEN state before transitioning to HALF_OPEN (default: 30000ms) */
  resetTimeoutMs: number;
  /** Sliding window size in ms for counting failures (default: 60000ms) */
  windowMs: number;
}

export interface ConnectionPoolConfig {
  endpoints: RpcEndpointConfig[];
  /** Strategy for selecting endpoints */
  strategy?: "weighted-round-robin" | "latency-based";
  /** How often to run health checks in ms (default: 10000) */
  healthCheckIntervalMs?: number;
  /** Circuit breaker settings */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Commitment for health check calls (default: "confirmed") */
  healthCheckCommitment?: Commitment;
}
