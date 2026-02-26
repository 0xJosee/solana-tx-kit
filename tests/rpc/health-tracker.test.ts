import { Connection } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("HealthTracker", () => {
  let HealthTracker: typeof import("../../src/rpc/health-tracker.js").HealthTracker;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockGetSlot.mockResolvedValue(100);

    const mod = await import("../../src/rpc/health-tracker.js");
    HealthTracker = mod.HealthTracker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function createTracker(opts?: {
    label?: string;
    circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number; windowMs?: number };
  }) {
    const connection = new Connection("https://rpc-1.example.com");
    return new HealthTracker(
      { url: "https://rpc-1.example.com", label: opts?.label ?? "rpc-1" },
      connection,
      undefined,
      opts?.circuitBreaker,
    );
  }

  describe("recordSuccess()", () => {
    it("sets latencyEma to the first latency value on first call", () => {
      const tracker = createTracker();
      tracker.recordSuccess(50);
      const metrics = tracker.getMetrics();
      expect(metrics.latencyEma).toBe(50);
      expect(metrics.successCount).toBe(1);
    });

    it("applies EMA smoothing on subsequent calls", () => {
      const tracker = createTracker();
      // First call: EMA = 50
      tracker.recordSuccess(50);
      // Second call: EMA = 0.3 * 100 + 0.7 * 50 = 30 + 35 = 65
      tracker.recordSuccess(100);
      const metrics = tracker.getMetrics();
      expect(metrics.latencyEma).toBe(65);
      expect(metrics.successCount).toBe(2);
    });

    it("increments successCount on each call", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10);
      tracker.recordSuccess(20);
      tracker.recordSuccess(30);
      expect(tracker.getMetrics().successCount).toBe(3);
    });

    it("updates lastSlot when slot argument is provided", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10, 42);
      expect(tracker.getMetrics().lastSlot).toBe(42);
    });

    it("does not update lastSlot when slot is omitted", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10, 42);
      tracker.recordSuccess(10);
      expect(tracker.getMetrics().lastSlot).toBe(42);
    });

    it("updates lastSuccessAt timestamp", () => {
      const tracker = createTracker();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      tracker.recordSuccess(10);
      expect(tracker.getMetrics().lastSuccessAt).toBe(Date.now());
    });
  });

  describe("recordFailure()", () => {
    it("increments errorCount", () => {
      const tracker = createTracker();
      tracker.recordFailure(new Error("timeout"));
      expect(tracker.getMetrics().errorCount).toBe(1);
      tracker.recordFailure(new Error("timeout"));
      expect(tracker.getMetrics().errorCount).toBe(2);
    });

    it("updates errorRate based on total calls", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10);
      tracker.recordFailure(new Error("fail"));
      // errorRate = 1 / (1 + 1) = 0.5
      expect(tracker.getMetrics().errorRate).toBe(0.5);
    });

    it("updates circuit state after exceeding failure threshold", () => {
      const tracker = createTracker({
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 5000, windowMs: 60000 },
      });
      tracker.recordFailure(new Error("fail"));
      tracker.recordFailure(new Error("fail"));
      expect(tracker.getMetrics().circuitState).toBe(CircuitState.OPEN);
    });
  });

  describe("isAvailable()", () => {
    it("returns true when circuit breaker is CLOSED", () => {
      const tracker = createTracker();
      expect(tracker.isAvailable()).toBe(true);
    });

    it("returns false when circuit breaker is OPEN", () => {
      const tracker = createTracker({
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30000, windowMs: 60000 },
      });
      tracker.recordFailure(new Error("fail"));
      tracker.recordFailure(new Error("fail"));
      expect(tracker.isAvailable()).toBe(false);
    });

    it("returns true when circuit breaker transitions to HALF_OPEN", () => {
      const tracker = createTracker({
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 5000, windowMs: 60000 },
      });
      tracker.recordFailure(new Error("fail"));
      tracker.recordFailure(new Error("fail"));
      expect(tracker.isAvailable()).toBe(false);

      vi.advanceTimersByTime(5000);
      expect(tracker.isAvailable()).toBe(true);
    });
  });

  describe("updateSlotLag()", () => {
    it("calculates slot lag as highestSlot minus lastSlot", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10, 95);
      tracker.updateSlotLag(100);
      expect(tracker.getMetrics().slotLag).toBe(5);
    });

    it("reports zero lag when tracker has the highest slot", () => {
      const tracker = createTracker();
      tracker.recordSuccess(10, 100);
      tracker.updateSlotLag(100);
      expect(tracker.getMetrics().slotLag).toBe(0);
    });

    it("reports full lag when lastSlot is still at initial zero", () => {
      const tracker = createTracker();
      tracker.updateSlotLag(100);
      expect(tracker.getMetrics().slotLag).toBe(100);
    });
  });

  describe("getMetrics()", () => {
    it("returns a copy, not a reference to internal metrics", () => {
      const tracker = createTracker();
      tracker.recordSuccess(50);
      const metrics1 = tracker.getMetrics();
      const metrics2 = tracker.getMetrics();

      // They should be equal in value
      expect(metrics1).toEqual(metrics2);

      // But they should not be the same object reference
      expect(metrics1).not.toBe(metrics2);
    });

    it("returns current circuit state synchronized with circuit breaker", () => {
      const tracker = createTracker({
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 5000, windowMs: 60000 },
      });
      expect(tracker.getMetrics().circuitState).toBe(CircuitState.CLOSED);

      tracker.recordFailure(new Error("fail"));
      tracker.recordFailure(new Error("fail"));
      expect(tracker.getMetrics().circuitState).toBe(CircuitState.OPEN);

      vi.advanceTimersByTime(5000);
      expect(tracker.getMetrics().circuitState).toBe(CircuitState.HALF_OPEN);
    });

    it("reflects correct initial state", () => {
      const tracker = createTracker();
      const metrics = tracker.getMetrics();
      expect(metrics.latencyEma).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.lastSlot).toBe(0);
      expect(metrics.slotLag).toBe(0);
      expect(metrics.lastSuccessAt).toBe(0);
      expect(metrics.circuitState).toBe(CircuitState.CLOSED);
    });
  });
});
