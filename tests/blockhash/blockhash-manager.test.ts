import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockhashManager } from "../../src/blockhash/blockhash-manager.js";
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
});
