import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionConfirmer } from "../../src/confirmation/confirmer.js";
import { createMockConnection } from "../helpers/mock-connection.js";

describe("TransactionConfirmer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms via polling fallback", async () => {
    const conn = createMockConnection();
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 100,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    // Advance timers to trigger poll
    await vi.advanceTimersByTimeAsync(200);

    const result = await confirmPromise;
    expect(result.status).toBe("confirmed");
    expect(result.slot).toBe(100);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns expired when block height exceeds limit", async () => {
    const conn = createMockConnection({
      getBlockHeight: vi.fn().mockResolvedValue(200_000_001),
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [null],
      }),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 100,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await confirmPromise;
    expect(result.status).toBe("expired");
  });

  it("returns failed when transaction has error", async () => {
    const conn = createMockConnection({
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [{ slot: 100, confirmations: 1, err: "InstructionError", confirmationStatus: "confirmed" }],
      }),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 100,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await confirmPromise;
    expect(result.status).toBe("failed");
  });

  it("times out after configured timeout", async () => {
    const conn = createMockConnection({
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [null],
      }),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 1_000,
      timeoutMs: 2_000,
      commitment: "confirmed",
    });

    await vi.advanceTimersByTimeAsync(2_100);

    const result = await confirmPromise;
    expect(result.status).toBe("expired");
  });
});
