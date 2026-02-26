import type { Connection } from "@solana/web3.js";
import type { Logger } from "../types.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import type { CircuitBreakerConfig, HealthMetrics, RpcEndpointConfig } from "./types.js";
import { CircuitState } from "./types.js";

const EMA_ALPHA = 0.3; // Smoothing factor for exponential moving average

/** Tracks health metrics (latency EMA, error rate, slot lag) for a single RPC endpoint */
export class HealthTracker {
  private readonly breaker: CircuitBreaker;
  private metrics: HealthMetrics = {
    latencyEma: 0,
    errorCount: 0,
    successCount: 0,
    errorRate: 0,
    lastSlot: 0,
    slotLag: 0,
    lastSuccessAt: 0,
    circuitState: CircuitState.CLOSED,
  };

  constructor(
    readonly endpoint: RpcEndpointConfig,
    private readonly connection: Connection,
    private readonly logger?: Logger,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
  ) {
    this.breaker = new CircuitBreaker(circuitBreakerConfig);
  }

  async healthCheck(): Promise<void> {
    const start = Date.now();
    try {
      const slot = await this.connection.getSlot();
      const latency = Date.now() - start;
      this.recordSuccess(latency, slot);
    } catch (err) {
      this.recordFailure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  recordSuccess(latencyMs: number, slot?: number): void {
    this.metrics.successCount++;
    this.metrics.lastSuccessAt = Date.now();

    // Update latency EMA
    if (this.metrics.latencyEma === 0) {
      this.metrics.latencyEma = latencyMs;
    } else {
      this.metrics.latencyEma = EMA_ALPHA * latencyMs + (1 - EMA_ALPHA) * this.metrics.latencyEma;
    }

    if (slot !== undefined) {
      this.metrics.lastSlot = slot;
    }

    this.breaker.recordSuccess();
    this.updateErrorRate();
    this.metrics.circuitState = this.breaker.currentState;
  }

  recordFailure(error: Error): void {
    this.metrics.errorCount++;
    this.breaker.recordFailure();
    this.updateErrorRate();
    this.metrics.circuitState = this.breaker.currentState;
    this.logger?.warn(`RPC endpoint ${this.endpoint.label ?? this.endpoint.url} error`, {
      error: error.message,
      circuitState: this.metrics.circuitState,
    });
  }

  isAvailable(): boolean {
    return this.breaker.canExecute();
  }

  getMetrics(): Readonly<HealthMetrics> {
    this.metrics.circuitState = this.breaker.currentState;
    return { ...this.metrics };
  }

  updateSlotLag(highestSlot: number): void {
    this.metrics.slotLag = highestSlot - this.metrics.lastSlot;
  }

  getConnection(): Connection {
    return this.connection;
  }

  private updateErrorRate(): void {
    const total = this.metrics.successCount + this.metrics.errorCount;
    this.metrics.errorRate = total > 0 ? this.metrics.errorCount / total : 0;
  }
}
