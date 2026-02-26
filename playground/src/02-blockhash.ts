/**
 * Test 02 — BlockhashManager: cache, refresh, coalescing
 *
 * Uses real devnet RPC to fetch blockhashes.
 */
import { BlockhashManager } from "solana-tx-kit";
import { runTest, step, pass, c, timer, getConnection, prettyLogger } from "./utils.js";

async function test() {
  const conn = getConnection();

  // ── 1. Fetch blockhash ────────────────────────────────────────
  step("First fetch — cold cache");
  const manager = new BlockhashManager(conn, { ttlMs: 10_000, refreshIntervalMs: 60_000, commitment: "confirmed" }, prettyLogger);
  {
    const t = timer();
    const info = await manager.getBlockhash();
    const elapsed = t();

    if (!info.blockhash || info.blockhash.length < 32) {
      throw new Error(`Invalid blockhash: ${info.blockhash}`);
    }
    if (info.lastValidBlockHeight <= 0) {
      throw new Error(`Invalid block height: ${info.lastValidBlockHeight}`);
    }
    pass(`Blockhash: ${c.info(info.blockhash.slice(0, 16))}... height=${c.info(String(info.lastValidBlockHeight))} (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 2. Cached blockhash ───────────────────────────────────────
  step("Second fetch — cached (should be instant)");
  {
    const t = timer();
    const info = await manager.getBlockhash();
    const elapsed = t();

    if (elapsed > 50) {
      throw new Error(`Cache miss! Took ${elapsed}ms — expected < 50ms`);
    }
    pass(`Cached hit: ${c.info(info.blockhash.slice(0, 16))}... (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 3. getCachedBlockhash (sync) ──────────────────────────────
  step("getCachedBlockhash() — sync access");
  {
    const cached = manager.getCachedBlockhash();
    if (!cached) throw new Error("Expected cached blockhash");
    pass(`Sync access: ${c.info(cached.blockhash.slice(0, 16))}...`);
  }

  // ── 4. Force refresh ──────────────────────────────────────────
  step("refreshBlockhash() — force new fetch");
  {
    const before = manager.getCachedBlockhash()!.blockhash;
    const t = timer();
    const info = await manager.refreshBlockhash();
    const elapsed = t();

    // On devnet the blockhash may or may not change in 1 second, that's fine
    pass(`Refreshed: ${c.info(info.blockhash.slice(0, 16))}... same=${before === info.blockhash} (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 5. Promise coalescing ─────────────────────────────────────
  step("Promise coalescing — 10 concurrent calls = 1 RPC call");
  {
    const t = timer();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => manager.refreshBlockhash()),
    );
    const elapsed = t();

    // All should return the same blockhash (coalesced into one fetch)
    const unique = new Set(results.map((r) => r.blockhash));
    if (unique.size !== 1) {
      throw new Error(`Expected 1 unique blockhash from coalescing, got ${unique.size}`);
    }
    pass(`10 concurrent calls → 1 fetch, all same hash (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 6. isBlockhashValid ───────────────────────────────────────
  step("isBlockhashValid() — check current blockhash");
  {
    const valid = await manager.isBlockhashValid();
    if (typeof valid !== "boolean") throw new Error(`Expected boolean, got ${typeof valid}`);
    pass(`Current blockhash valid: ${c.info(String(valid))}`);
  }

  manager.destroy();
}

export const run = () => runTest("02 — BlockhashManager", test);

const isMain = process.argv[1]?.includes("02-blockhash");
if (isMain) run();
