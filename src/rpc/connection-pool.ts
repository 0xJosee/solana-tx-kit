import { Connection } from "@solana/web3.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { Logger } from "../types.js";
import { HealthTracker } from "./health-tracker.js";
import type { ConnectionPoolConfig, HealthMetrics } from "./types.js";

/**
 * Manages multiple RPC connections with health tracking, circuit breakers,
 * and selection strategies (weighted round-robin or latency-based).
 */
export class ConnectionPool {
  private readonly trackers: HealthTracker[] = [];
  private healthCheckInterval?: ReturnType<typeof setInterval> | undefined;
  private roundRobinIndex = 0;
  private readonly strategy: "weighted-round-robin" | "latency-based";

  constructor(
    config: ConnectionPoolConfig,
    private readonly logger?: Logger,
  ) {
    this.strategy = config.strategy ?? "weighted-round-robin";

    for (const endpoint of config.endpoints) {
      const connection = new Connection(endpoint.url, {
        commitment: config.healthCheckCommitment ?? "confirmed",
      });
      const tracker = new HealthTracker(endpoint, connection, logger, config.circuitBreaker);
      this.trackers.push(tracker);
    }

    // Start periodic health checks
    const interval = config.healthCheckIntervalMs ?? 10_000;
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, interval);
  }

  /** Get the best available connection based on strategy */
  getConnection(): Connection {
    const available = this.trackers.filter((t) => t.isAvailable());

    if (available.length === 0) {
      // Fallback: return first tracker even if unhealthy
      this.logger?.warn("All RPC endpoints unhealthy, using first endpoint as fallback");
      const fallback = this.trackers[0];
      if (!fallback) {
        throw new SolTxError(
          SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY,
          "No RPC endpoints configured. Call .rpc() or .rpcPool() in the builder.",
        );
      }
      return fallback.getConnection();
    }

    if (this.strategy === "latency-based") {
      return this.selectByLatency(available);
    }
    return this.selectByWeight(available);
  }

  /** Get a connection, falling back through endpoints if the first fails */
  async withFallback<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    const available = this.trackers.filter((t) => t.isAvailable());
    const ordered = available.length > 0 ? available : this.trackers;

    let lastError: Error | undefined;

    for (const tracker of ordered) {
      const start = Date.now();
      try {
        const result = await fn(tracker.getConnection());
        tracker.recordSuccess(Date.now() - start);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        tracker.recordFailure(error);
        lastError = error;
        this.logger?.warn(`Failover: ${tracker.endpoint.label ?? tracker.endpoint.url} failed`, {
          error: error.message,
        });
      }
    }

    throw new SolTxError(
      SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY,
      "All RPC endpoints failed. Check endpoint health via getHealthReport() or add backup endpoints with .rpcPool().",
      { cause: lastError ?? new Error("No endpoints available") },
    );
  }

  /** Get health metrics for all endpoints */
  getHealthReport(): Map<string, HealthMetrics> {
    const report = new Map<string, HealthMetrics>();
    for (const tracker of this.trackers) {
      const key = tracker.endpoint.label ?? tracker.endpoint.url;
      report.set(key, tracker.getMetrics());
    }
    return report;
  }

  /** Stop background health checks */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  private selectByLatency(available: HealthTracker[]): Connection {
    const sorted = [...available].sort((a, b) => {
      const aMetrics = a.getMetrics();
      const bMetrics = b.getMetrics();
      return aMetrics.latencyEma - bMetrics.latencyEma;
    });
    const best = sorted[0];
    if (!best) throw new SolTxError(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY, "No endpoints available");
    return best.getConnection();
  }

  private selectByWeight(available: HealthTracker[]): Connection {
    let totalWeight = 0;
    for (const tracker of available) {
      totalWeight += tracker.endpoint.weight ?? 1;
    }

    const position = this.roundRobinIndex % totalWeight;
    this.roundRobinIndex++;

    let cumulative = 0;
    for (const tracker of available) {
      cumulative += tracker.endpoint.weight ?? 1;
      if (position < cumulative) {
        return tracker.getConnection();
      }
    }

    // Should never reach here if available is non-empty
    throw new SolTxError(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY, "No weighted endpoint available");
  }

  private runHealthChecks(): void {
    const promises = this.trackers.map((t) => t.healthCheck());
    Promise.all(promises)
      .then(() => {
        // Update slot lag relative to highest slot
        let highestSlot = 0;
        for (const tracker of this.trackers) {
          const metrics = tracker.getMetrics();
          if (metrics.lastSlot > highestSlot) {
            highestSlot = metrics.lastSlot;
          }
        }
        for (const tracker of this.trackers) {
          tracker.updateSlotLag(highestSlot);
        }
      })
      .catch((err) => {
        this.logger?.warn("Health check round failed", { error: String(err) });
      });
  }
}
