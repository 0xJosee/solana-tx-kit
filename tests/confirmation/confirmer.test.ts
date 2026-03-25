import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionConfirmer } from "../../src/confirmation/confirmer.js";
import { SolTxError } from "../../src/errors.js";
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
      pollIntervalMs: 500,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    // Advance timers to trigger poll (min poll interval is 500ms)
    await vi.advanceTimersByTimeAsync(600);

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
      pollIntervalMs: 500,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    await vi.advanceTimersByTimeAsync(600);

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
      pollIntervalMs: 500,
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    await vi.advanceTimersByTimeAsync(600);

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

  it("confirm() throws after destroy()", async () => {
    const conn = createMockConnection();
    const confirmer = new TransactionConfirmer();
    confirmer.destroy();

    await expect(
      confirmer.confirm(conn, "MockSig", 200_000_000, {
        useWebSocket: false,
        pollIntervalMs: 500,
        timeoutMs: 5_000,
        commitment: "confirmed",
      }),
    ).rejects.toThrow(SolTxError);

    await expect(
      confirmer.confirm(conn, "MockSig", 200_000_000, {
        useWebSocket: false,
        pollIntervalMs: 500,
        timeoutMs: 5_000,
        commitment: "confirmed",
      }),
    ).rejects.toThrow("destroyed");
  });

  it("pollIntervalMs is clamped to minimum 500ms", async () => {
    const getSignatureStatuses = vi.fn().mockResolvedValue({
      context: { slot: 100 },
      value: [{ slot: 100, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
    });
    const conn = createMockConnection({ getSignatureStatuses });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 100, // below the 500ms minimum
      timeoutMs: 5_000,
      commitment: "confirmed",
    });

    // At 200ms, the poll should NOT have fired yet (clamped to 500ms)
    await vi.advanceTimersByTimeAsync(200);
    expect(getSignatureStatuses).not.toHaveBeenCalled();

    // At 600ms the clamped interval should have fired
    await vi.advanceTimersByTimeAsync(400);
    const result = await confirmPromise;
    expect(result.status).toBe("confirmed");
    expect(getSignatureStatuses).toHaveBeenCalled();
  });

  it("processed status is NOT accepted when commitment is confirmed", async () => {
    const getSignatureStatuses = vi.fn().mockResolvedValue({
      context: { slot: 100 },
      value: [{ slot: 100, confirmations: 0, err: null, confirmationStatus: "processed" }],
    });
    const conn = createMockConnection({
      getSignatureStatuses,
      getBlockHeight: vi.fn().mockResolvedValue(199_999_900),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 500,
      timeoutMs: 2_000,
      commitment: "confirmed",
    });

    // Advance past first poll — should not resolve because "processed" is not enough for "confirmed" commitment
    await vi.advanceTimersByTimeAsync(600);

    // The promise should still be pending; advance to timeout
    await vi.advanceTimersByTimeAsync(1_500);

    const result = await confirmPromise;
    // Should have timed out rather than accepting "processed" for "confirmed" commitment
    expect(result.status).toBe("expired");
  });

  it("processed status IS accepted when commitment is processed", async () => {
    const conn = createMockConnection({
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [{ slot: 100, confirmations: 0, err: null, confirmationStatus: "processed" }],
      }),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 500,
      timeoutMs: 5_000,
      commitment: "processed",
    });

    await vi.advanceTimersByTimeAsync(600);

    const result = await confirmPromise;
    // "processed" status should be accepted when commitment is "processed"
    expect(result.status).toBe("confirmed");
    expect(result.slot).toBe(100);
  });

  it("resolves as expired after 20 consecutive polling failures", async () => {
    const failingConn = createMockConnection({
      getBlockHeight: vi.fn().mockRejectedValue(new Error("RPC down")),
      getSignatureStatuses: vi.fn().mockRejectedValue(new Error("RPC down")),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(failingConn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 500,
      timeoutMs: 120_000,
      commitment: "confirmed",
    });

    // Advance through 20 consecutive polling cycles (each 500ms)
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(600);
    }

    const result = await confirmPromise;
    expect(result.status).toBe("expired");
  });

  it("finalized commitment accepts finalized status from polling", async () => {
    const conn = createMockConnection({
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [{ slot: 100, confirmations: null, err: null, confirmationStatus: "finalized" }],
      }),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 500,
      timeoutMs: 5_000,
      commitment: "finalized",
    });

    await vi.advanceTimersByTimeAsync(600);

    const result = await confirmPromise;
    expect(result.status).toBe("finalized");
    expect(result.slot).toBe(100);
  });

  it("finalized commitment does NOT accept confirmed status", async () => {
    const conn = createMockConnection({
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: [{ slot: 100, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
      }),
      getBlockHeight: vi.fn().mockResolvedValue(199_999_900),
    });
    const confirmer = new TransactionConfirmer();

    const confirmPromise = confirmer.confirm(conn, "MockSig", 200_000_000, {
      useWebSocket: false,
      pollIntervalMs: 500,
      timeoutMs: 2_000,
      commitment: "finalized",
    });

    // First poll: confirmed status should not be accepted for finalized commitment
    await vi.advanceTimersByTimeAsync(600);

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(1_500);

    const result = await confirmPromise;
    // "confirmed" is accepted when commitment is not "finalized" — but here commitment IS finalized,
    // so confirmed status IS accepted (confirmed satisfies finalized commitment per the code logic)
    // Actually checking the code: "confirmed" is accepted when commitment !== "finalized" — so it won't be accepted here
    // The code says: if status === "confirmed" && config.commitment !== "finalized" => resolve
    // So for finalized commitment, confirmed status is NOT enough — should timeout
    expect(result.status).toBe("expired");
  });
});
