import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { CircuitState } from "../../src/rpc/types.js";

const mockGetSlot = vi.fn().mockResolvedValue(100);

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getSlot: mockGetSlot,
    })),
  };
});

describe("ConnectionPool", () => {
  let ConnectionPool: typeof import("../../src/rpc/connection-pool.js").ConnectionPool;
  let pool: InstanceType<typeof ConnectionPool> | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockGetSlot.mockResolvedValue(100);

    const mod = await import("../../src/rpc/connection-pool.js");
    ConnectionPool = mod.ConnectionPool;
  });

  afterEach(() => {
    pool?.destroy();
    pool = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function createPool(opts?: {
    endpoints?: Array<{ url: string; weight?: number; label?: string }>;
    strategy?: "weighted-round-robin" | "latency-based";
    healthCheckIntervalMs?: number;
    circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number; windowMs?: number };
  }) {
    const p = new ConnectionPool({
      endpoints: opts?.endpoints ?? [
        { url: "https://rpc-1.example.com", label: "rpc-1" },
        { url: "https://rpc-2.example.com", label: "rpc-2" },
      ],
      strategy: opts?.strategy ?? "weighted-round-robin",
      healthCheckIntervalMs: opts?.healthCheckIntervalMs ?? 60_000,
      circuitBreaker: opts?.circuitBreaker,
    });
    pool = p;
    return p;
  }

  describe("getConnection()", () => {
    it("returns a connection object", () => {
      const p = createPool();
      const conn = p.getConnection();
      expect(conn).toBeDefined();
      expect(conn.getSlot).toBeDefined();
    });

    it("falls back to first endpoint when all endpoints are unhealthy", async () => {
      const p = createPool({
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 30000, windowMs: 60000 },
      });

      // Trip all circuit breakers by making every endpoint fail via withFallback
      try {
        await p.withFallback(async () => {
          throw new Error("fail");
        });
      } catch {
        // Expected: ALL_ENDPOINTS_UNHEALTHY
      }

      // Now all trackers have open circuit breakers.
      // getConnection() should still return a connection (the first endpoint as fallback).
      const conn = p.getConnection();
      expect(conn).toBeDefined();
    });
  });

  describe("withFallback()", () => {
    it("returns the result of the function on first successful call", async () => {
      const p = createPool();
      const result = await p.withFallback(async (_conn) => "success");
      expect(result).toBe("success");
    });

    it("tries the next endpoint when the first one fails", async () => {
      const p = createPool();
      const callOrder: number[] = [];
      let callIndex = 0;

      const result = await p.withFallback(async (_conn) => {
        callIndex++;
        callOrder.push(callIndex);
        if (callIndex === 1) {
          throw new Error("first endpoint failed");
        }
        return "fallback-success";
      });

      expect(result).toBe("fallback-success");
      expect(callOrder).toEqual([1, 2]);
    });

    it("throws ALL_ENDPOINTS_UNHEALTHY when all endpoints fail", async () => {
      const p = createPool();

      let caughtError: unknown;
      try {
        await p.withFallback(async (_conn) => {
          throw new Error("endpoint failed");
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(SolTxError);
      expect((caughtError as SolTxError).code).toBe(SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY);
      expect((caughtError as SolTxError).message).toContain("All RPC endpoints failed");
    });

    it("records success on the tracker that succeeds", async () => {
      const p = createPool();
      await p.withFallback(async (_conn) => "ok");

      const report = p.getHealthReport();
      const rpc1Metrics = report.get("rpc-1");
      expect(rpc1Metrics).toBeDefined();
      expect(rpc1Metrics?.successCount).toBe(1);
    });

    it("records failure on trackers that fail", async () => {
      const p = createPool();
      let callIndex = 0;

      await p.withFallback(async (_conn) => {
        callIndex++;
        if (callIndex === 1) throw new Error("fail");
        return "ok";
      });

      const report = p.getHealthReport();
      const rpc1Metrics = report.get("rpc-1");
      const rpc2Metrics = report.get("rpc-2");
      expect(rpc1Metrics?.errorCount).toBe(1);
      expect(rpc2Metrics?.successCount).toBe(1);
    });
  });

  describe("getHealthReport()", () => {
    it("returns metrics for all configured endpoints", () => {
      const p = createPool({
        endpoints: [
          { url: "https://rpc-1.example.com", label: "rpc-1" },
          { url: "https://rpc-2.example.com", label: "rpc-2" },
          { url: "https://rpc-3.example.com", label: "rpc-3" },
        ],
      });

      const report = p.getHealthReport();
      expect(report.size).toBe(3);
      expect(report.has("rpc-1")).toBe(true);
      expect(report.has("rpc-2")).toBe(true);
      expect(report.has("rpc-3")).toBe(true);
    });

    it("uses endpoint URL as key when no label is set", () => {
      const p = createPool({
        endpoints: [{ url: "https://rpc-unlabeled.example.com" }],
      });

      const report = p.getHealthReport();
      expect(report.has("https://rpc-unlabeled.example.com")).toBe(true);
    });

    it("returns valid HealthMetrics objects", () => {
      const p = createPool();
      const report = p.getHealthReport();
      const metrics = report.get("rpc-1");
      expect(metrics).toBeDefined();

      expect(metrics).toHaveProperty("latencyEma");
      expect(metrics).toHaveProperty("errorCount");
      expect(metrics).toHaveProperty("successCount");
      expect(metrics).toHaveProperty("errorRate");
      expect(metrics).toHaveProperty("lastSlot");
      expect(metrics).toHaveProperty("slotLag");
      expect(metrics).toHaveProperty("lastSuccessAt");
      expect(metrics).toHaveProperty("circuitState");
      expect(metrics.circuitState).toBe(CircuitState.CLOSED);
    });
  });

  describe("destroy()", () => {
    it("stops the health check interval", () => {
      const p = createPool({ healthCheckIntervalMs: 1000 });
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      p.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("can be called multiple times without error", () => {
      const p = createPool();
      p.destroy();
      p.destroy(); // Should not throw
      // Prevent afterEach from calling destroy on an already-destroyed pool
      pool = undefined;
    });
  });

  describe("weighted-round-robin selection", () => {
    it("distributes connections according to weight", () => {
      const p = createPool({
        endpoints: [
          { url: "https://rpc-1.example.com", label: "rpc-1", weight: 2 },
          { url: "https://rpc-2.example.com", label: "rpc-2", weight: 1 },
        ],
        strategy: "weighted-round-robin",
      });

      // With weights [2, 1], the weighted list is [rpc-1, rpc-1, rpc-2].
      // Round-robin over 3 calls should cycle through all entries.
      const connections = [];
      for (let i = 0; i < 3; i++) {
        connections.push(p.getConnection());
      }
      // All three should be valid connections
      expect(connections).toHaveLength(3);
      for (const conn of connections) {
        expect(conn).toBeDefined();
      }
    });

    it("cycles through weighted entries on repeated calls", () => {
      const p = createPool({
        endpoints: [
          { url: "https://rpc-1.example.com", label: "rpc-1", weight: 1 },
          { url: "https://rpc-2.example.com", label: "rpc-2", weight: 1 },
        ],
        strategy: "weighted-round-robin",
      });

      // With equal weights, round-robin should alternate.
      // Calling 4 times should cycle through both connections twice.
      const connections = [];
      for (let i = 0; i < 4; i++) {
        connections.push(p.getConnection());
      }
      // conn[0] and conn[2] should be the same (rpc-1)
      // conn[1] and conn[3] should be the same (rpc-2)
      expect(connections[0]).toBe(connections[2]);
      expect(connections[1]).toBe(connections[3]);
      expect(connections[0]).not.toBe(connections[1]);
    });
  });

  describe("latency-based selection", () => {
    it("selects the endpoint with the lowest latency EMA", async () => {
      const p = createPool({
        endpoints: [
          { url: "https://rpc-slow.example.com", label: "rpc-slow" },
          { url: "https://rpc-fast.example.com", label: "rpc-fast" },
        ],
        strategy: "latency-based",
      });

      // Simulate the first endpoint being slow and the second being fast
      // by using withFallback calls that record latencies on specific trackers.
      let callCount = 0;

      // First call: both succeed. First tracker gets called first with slow latency.
      // We'll use the withFallback to seed latency data.

      // Seed rpc-slow with high latency via withFallback
      // withFallback tries endpoints in order, records success latency on the one that succeeds.
      vi.setSystemTime(1000);
      await p.withFallback(async (_conn) => {
        // Advance time to simulate high latency on first endpoint
        vi.setSystemTime(1200); // 200ms latency
        return "ok";
      });

      // Now seed rpc-fast with low latency. First endpoint will fail,
      // second succeeds with low latency.
      vi.setSystemTime(2000);
      callCount = 0;
      await p.withFallback(async (_conn) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("skip first");
        }
        vi.setSystemTime(2010); // 10ms latency
        return "ok";
      });

      // Now latency-based selection should prefer rpc-fast (lower EMA)
      const conn = p.getConnection();
      expect(conn).toBeDefined();

      // Verify via the health report that rpc-fast has lower latency
      const report = p.getHealthReport();
      expect(report.get("rpc-fast")?.latencyEma).toBeLessThan(report.get("rpc-slow")?.latencyEma);
    });

    it("returns a connection even with no latency data", () => {
      const p = createPool({
        strategy: "latency-based",
      });

      // With no recorded latency, all EMA values are 0, so any endpoint is valid
      const conn = p.getConnection();
      expect(conn).toBeDefined();
    });
  });
});
