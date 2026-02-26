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
});
