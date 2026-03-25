import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockhashManager } from "../../src/blockhash/blockhash-manager.js";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { createMockConnection } from "../helpers/mock-connection.js";

describe("BlockhashManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches blockhash on first getBlockhash() call", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });

    const info = await manager.getBlockhash();
    expect(info.blockhash).toBe("MockBlockhash111111111111111111111111111111");
    expect(info.lastValidBlockHeight).toBe(200_000_000);
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  it("returns cached blockhash within TTL", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });

    await manager.getBlockhash();
    await manager.getBlockhash();
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  it("fetches fresh blockhash after TTL expires", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 1_000, refreshIntervalMs: 30_000, commitment: "confirmed" });

    await manager.getBlockhash();
    vi.advanceTimersByTime(1_500);
    await manager.getBlockhash();
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(2);

    manager.destroy();
  });

  it("refreshBlockhash() forces a fresh fetch", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });

    await manager.getBlockhash();
    await manager.refreshBlockhash();
    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(2);

    manager.destroy();
  });

  it("coalesces concurrent fetches", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });

    // Call multiple times simultaneously
    const results = await Promise.all([
      manager.refreshBlockhash(),
      manager.refreshBlockhash(),
      manager.refreshBlockhash(),
    ]);

    expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);

    manager.destroy();
  });

  it("getCachedBlockhash returns null if nothing cached", () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });
    expect(manager.getCachedBlockhash()).toBeNull();
    manager.destroy();
  });

  it("isBlockhashValid returns true when block height is below limit", async () => {
    const conn = createMockConnection();
    const manager = new BlockhashManager(conn, { ttlMs: 60_000, refreshIntervalMs: 30_000, commitment: "confirmed" });
    await manager.getBlockhash();
    const valid = await manager.isBlockhashValid();
    expect(valid).toBe(true);
    manager.destroy();
  });

  describe("constructor config validation", () => {
    it("throws when refreshIntervalMs < 1000", () => {
      const conn = createMockConnection();
      expect(() => new BlockhashManager(conn, { refreshIntervalMs: 500 })).toThrow(SolTxError);

      try {
        new BlockhashManager(conn, { refreshIntervalMs: 500 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("refreshIntervalMs");
      }
    });

    it("throws when ttlMs is 0", () => {
      const conn = createMockConnection();
      expect(() => new BlockhashManager(conn, { ttlMs: 0 })).toThrow(SolTxError);

      try {
        new BlockhashManager(conn, { ttlMs: 0 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("ttlMs");
      }
    });

    it("throws when fetchTimeoutMs < 1000", () => {
      const conn = createMockConnection();
      expect(() => new BlockhashManager(conn, { fetchTimeoutMs: 500 })).toThrow(SolTxError);

      try {
        new BlockhashManager(conn, { fetchTimeoutMs: 500 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("fetchTimeoutMs");
      }
    });
  });

  describe("destroyed guard", () => {
    it("getBlockhash() throws after destroy", async () => {
      const conn = createMockConnection();
      const manager = new BlockhashManager(conn, {
        ttlMs: 60_000,
        refreshIntervalMs: 30_000,
        commitment: "confirmed",
      });
      manager.destroy();

      await expect(manager.getBlockhash()).rejects.toThrow(SolTxError);
      try {
        await manager.getBlockhash();
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.BLOCKHASH_FETCH_FAILED);
        expect((err as SolTxError).message).toContain("destroyed");
      }
    });

    it("refreshBlockhash() throws after destroy", async () => {
      const conn = createMockConnection();
      const manager = new BlockhashManager(conn, {
        ttlMs: 60_000,
        refreshIntervalMs: 30_000,
        commitment: "confirmed",
      });
      manager.destroy();

      await expect(manager.refreshBlockhash()).rejects.toThrow(SolTxError);
      try {
        await manager.refreshBlockhash();
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.BLOCKHASH_FETCH_FAILED);
        expect((err as SolTxError).message).toContain("destroyed");
      }
    });

    it("isBlockhashValid() returns false after destroy", async () => {
      const conn = createMockConnection();
      const manager = new BlockhashManager(conn, {
        ttlMs: 60_000,
        refreshIntervalMs: 30_000,
        commitment: "confirmed",
      });
      // Populate cache first, then destroy
      await manager.getBlockhash();
      manager.destroy();

      const valid = await manager.isBlockhashValid();
      expect(valid).toBe(false);
    });

    it("start() does nothing after destroy", () => {
      const conn = createMockConnection();
      const manager = new BlockhashManager(conn, {
        ttlMs: 60_000,
        refreshIntervalMs: 30_000,
        commitment: "confirmed",
      });
      manager.destroy();

      // Should not throw, just silently return
      expect(() => manager.start()).not.toThrow();

      // Advance time to verify no background refresh was started
      vi.advanceTimersByTime(60_000);
      // getLatestBlockhash should never have been called by the background refresh
      expect(conn.getLatestBlockhash).not.toHaveBeenCalled();
    });
  });

  describe("consecutive failure force-refresh", () => {
    it("getBlockhash() force-refreshes when consecutiveFailures >= 2", async () => {
      vi.useRealTimers();
      const conn = createMockConnection();
      const manager = new BlockhashManager(conn, {
        ttlMs: 60_000,
        refreshIntervalMs: 30_000,
        commitment: "confirmed",
      });

      // Populate the cache initially
      const _firstResult = await manager.getBlockhash();
      expect(conn.getLatestBlockhash).toHaveBeenCalledTimes(1);

      // Simulate consecutive failures by calling start() and having the background refresh fail.
      // Instead, we directly manipulate by triggering refreshBlockhash failures.
      // The consecutiveFailures counter increments in the background refresh error handler,
      // but we can test the behavior by triggering the getBlockhash logic with a stale cache.
      // We need to simulate the internal state: set consecutiveFailures >= 2.
      // Since consecutiveFailures is private, we test the observable behavior:
      // after 2+ background refresh failures, getBlockhash should force-refresh even with a valid cache.

      // Make getLatestBlockhash fail twice to simulate background failures
      const _originalFn = conn.getLatestBlockhash;
      let failCount = 0;
      (conn.getLatestBlockhash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        failCount++;
        if (failCount <= 2) {
          throw new Error("RPC unavailable");
        }
        return {
          blockhash: "NewBlockhash111111111111111111111111111111111",
          lastValidBlockHeight: 200_000_100,
        };
      });

      // Start background refresh, which will fail and increment consecutiveFailures
      manager.start();

      // Wait for 2 background refresh cycles to fail (refreshIntervalMs = 30_000 but we use real timers)
      // Instead, let's directly call refreshBlockhash to simulate the failures and test the guard.
      // Stop the background refresh to control the test precisely.
      manager.destroy();

      // Since destroy sets the destroyed flag, let's use a different approach.
      // Create a fresh manager and simulate the condition properly.
      const conn2 = createMockConnection();
      let callCount = 0;
      (conn2.getLatestBlockhash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return {
          blockhash: `Blockhash${callCount}11111111111111111111111111111`,
          lastValidBlockHeight: 200_000_000 + callCount,
        };
      });

      const manager2 = new BlockhashManager(conn2, {
        ttlMs: 60_000,
        refreshIntervalMs: 5_000,
        commitment: "confirmed",
      });

      // First call: populates cache
      const result1 = await manager2.getBlockhash();
      expect(callCount).toBe(1);

      // Second call within TTL: should return cache (consecutiveFailures = 0)
      const result2 = await manager2.getBlockhash();
      expect(callCount).toBe(1); // No new fetch, still cached
      expect(result2.blockhash).toBe(result1.blockhash);

      // Now simulate background refresh failures by making the mock fail
      (conn2.getLatestBlockhash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        throw new Error("RPC down");
      });

      manager2.start();
      // Wait for 2 refresh intervals to accumulate failures
      await new Promise((resolve) => setTimeout(resolve, 11_000));

      // Restore the mock to succeed
      let refreshCallCount = 0;
      (conn2.getLatestBlockhash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        refreshCallCount++;
        return {
          blockhash: "FreshBlockhash11111111111111111111111111111111",
          lastValidBlockHeight: 200_001_000,
        };
      });

      // getBlockhash should force-refresh because consecutiveFailures >= 2
      const result3 = await manager2.getBlockhash();
      expect(refreshCallCount).toBeGreaterThanOrEqual(1);
      expect(result3.blockhash).toBe("FreshBlockhash11111111111111111111111111111111");

      manager2.destroy();
    }, 20_000);
  });
});
