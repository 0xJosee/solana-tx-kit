import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../../src/rpc/circuit-breaker.js";
import { CircuitState } from "../../src/rpc/types.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe(CircuitState.CLOSED);
    expect(cb.canExecute()).toBe(true);
  });

  it("trips to OPEN after threshold failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe(CircuitState.CLOSED);
    cb.recordFailure();
    expect(cb.currentState).toBe(CircuitState.OPEN);
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions from OPEN to HALF_OPEN after timeout", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(5_000);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);
    expect(cb.canExecute()).toBe(true);
  });

  it("resets to CLOSED on success in HALF_OPEN", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5_000);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

    cb.recordSuccess();
    expect(cb.currentState).toBe(CircuitState.CLOSED);
  });

  it("goes back to OPEN on failure in HALF_OPEN", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5_000);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

    cb.recordFailure();
    expect(cb.currentState).toBe(CircuitState.OPEN);
  });

  it("reset() clears state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe(CircuitState.OPEN);

    cb.reset();
    expect(cb.currentState).toBe(CircuitState.CLOSED);
    expect(cb.canExecute()).toBe(true);
  });

  describe("constructor validation", () => {
    it("throws on failureThreshold <= 0", () => {
      expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow("failureThreshold must be > 0");
      expect(() => new CircuitBreaker({ failureThreshold: -1 })).toThrow("failureThreshold must be > 0");
    });

    it("throws on resetTimeoutMs <= 0", () => {
      expect(() => new CircuitBreaker({ resetTimeoutMs: 0 })).toThrow("resetTimeoutMs must be > 0");
      expect(() => new CircuitBreaker({ resetTimeoutMs: -5 })).toThrow("resetTimeoutMs must be > 0");
    });
  });

  describe("probeInFlight guard in HALF_OPEN", () => {
    it("canExecute() returns false for second caller in HALF_OPEN", () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.currentState).toBe(CircuitState.OPEN);

      vi.advanceTimersByTime(5_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

      // First caller gets the probe slot
      expect(cb.canExecute()).toBe(true);
      // Second caller is blocked while probe is in flight
      expect(cb.canExecute()).toBe(false);
    });

    it("probeInFlight resets on recordSuccess", () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
      cb.recordFailure();
      cb.recordFailure();
      vi.advanceTimersByTime(5_000);

      // First caller takes the probe
      expect(cb.canExecute()).toBe(true);
      // Probe in flight — second caller blocked
      expect(cb.canExecute()).toBe(false);

      // Probe succeeds — resets to CLOSED, probeInFlight cleared
      cb.recordSuccess();
      expect(cb.currentState).toBe(CircuitState.CLOSED);
      // Now canExecute should be true again (CLOSED state)
      expect(cb.canExecute()).toBe(true);
    });

    it("probeInFlight resets on recordFailure", () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000, windowMs: 60_000 });
      cb.recordFailure();
      cb.recordFailure();
      vi.advanceTimersByTime(5_000);

      // First caller takes the probe
      expect(cb.canExecute()).toBe(true);
      // Probe in flight — second caller blocked
      expect(cb.canExecute()).toBe(false);

      // Probe fails — goes back to OPEN, probeInFlight cleared
      cb.recordFailure();
      expect(cb.currentState).toBe(CircuitState.OPEN);

      // After another timeout, transition to HALF_OPEN again
      vi.advanceTimersByTime(5_000);
      expect(cb.currentState).toBe(CircuitState.HALF_OPEN);
      // probeInFlight was reset, so the first caller can take it again
      expect(cb.canExecute()).toBe(true);
    });
  });
});
