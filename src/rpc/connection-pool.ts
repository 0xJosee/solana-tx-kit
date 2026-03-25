import { Connection } from "@solana/web3.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { Logger } from "../types.js";
import { sanitizeUrl } from "../validation.js";
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
  private destroyed = false;

  constructor(
    config: ConnectionPoolConfig,
    private readonly logger?: Logger,
  ) {
    // M-10: Validate non-empty endpoints
    if (config.endpoints.length === 0) {
      throw new SolTxError(SolTxErrorCode.INVALID_ARGUMENT, "At least one RPC endpoint is required.");
    }

    this.strategy = config.strategy ?? "weighted-round-robin";

    for (const endpoint of config.endpoints) {
      // M-16: Validate weight > 0
      if (endpoint.weight !== undefined && endpoint.weight <= 0) {
        throw new SolTxError(
          SolTxErrorCode.INVALID_ARGUMENT,
          `Endpoint weight must be > 0, got ${endpoint.weight} for ${endpoint.label ?? sanitizeUrl(endpoint.url)}`,
        );
      }
      const connection = new Connection(endpoint.url, {
        commitment: config.healthCheckCommitment ?? "confirmed",
      });
      const tracker = new HealthTracker(endpoint, connection, logger, config.circuitBreaker);
      this.trackers.push(tracker);
    }

    // Start periodic health checks
    const interval = config.healthCheckIntervalMs ?? 10_000;
    if (interval < 1_000) {
      throw new SolTxError(SolTxErrorCode.INVALID_ARGUMENT, `healthCheckIntervalMs must be >= 1000, got ${interval}`);
    }
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, interval);
  }

  /** Get the best available connection based on strategy */
  getConnection(): Connection {
    if (this.destroyed)
      throw new SolTxError(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY, "ConnectionPool has been destroyed");

    const available = this.trackers.filter((t) => t.isAvailable());

    if (available.length === 0) {
      // M-11: Round-robin across all trackers when all are unhealthy (not just first)
      this.logger?.warn("All RPC endpoints unhealthy, using round-robin fallback");
      const idx = this.roundRobinIndex % this.trackers.length;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER;
      const fallback = this.trackers[idx];
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
    if (this.destroyed)
      throw new SolTxError(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY, "ConnectionPool has been destroyed");

    const available = this.trackers.filter((t) => t.isAvailable());
    // M-12: Limit fallback iteration when all unhealthy
    const ordered = available.length > 0 ? available : this.trackers.slice(0, Math.min(3, this.trackers.length));

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
        this.logger?.warn(`Failover: ${tracker.endpoint.label ?? sanitizeUrl(tracker.endpoint.url)} failed`, {
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
      const key = tracker.endpoint.label ?? sanitizeUrl(tracker.endpoint.url);
      report.set(key, tracker.getMetrics());
    }
    return report;
  }

  /** Stop background health checks */
  destroy(): void {
    this.destroyed = true;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    for (const tracker of this.trackers) {
      tracker.destroy();
    }
  }

  private selectByLatency(available: HealthTracker[]): Connection {
    const sorted = [...available].sort((a, b) => {
      const aLatency = a.getMetrics().latencyEma ?? Number.MAX_SAFE_INTEGER;
      const bLatency = b.getMetrics().latencyEma ?? Number.MAX_SAFE_INTEGER;
      return aLatency - bLatency;
    });
    const best = sorted[0];
    if (!best) throw new SolTxError(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY, "No endpoints available");
    return best.getConnection();
  }

  // M-13: Stable round-robin — increment index independently of totalWeight changes
  private selectByWeight(available: HealthTracker[]): Connection {
    let totalWeight = 0;
    for (const tracker of available) {
      totalWeight += tracker.endpoint.weight ?? 1;
    }

    const position = this.roundRobinIndex % totalWeight;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER;

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
    Promise.allSettled(promises).then(() => {
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
    });
  }
}
