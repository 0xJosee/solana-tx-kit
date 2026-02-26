/**
 * Test 05 — RPC ConnectionPool + Circuit Breaker + Health Tracking
 *
 * Tests connection pool with real devnet endpoints.
 */
import { ConnectionPool, CircuitBreaker, CircuitState } from "solana-tx-kit";
import { runTest, step, pass, fail, c, timer, getRpcUrls, prettyLogger } from "./utils.js";

async function test() {
  const urls = getRpcUrls();

  // ── 1. Circuit breaker state machine ──────────────────────────
  step("CircuitBreaker — state transitions");
  {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 500, windowMs: 60_000 });

    if (cb.currentState !== CircuitState.CLOSED) throw new Error("Expected CLOSED");
    if (!cb.canExecute()) throw new Error("Expected canExecute=true");

    cb.recordFailure();
    cb.recordFailure();
    if (cb.currentState !== CircuitState.CLOSED) throw new Error("Expected still CLOSED after 2 failures");

    cb.recordFailure();
    if (cb.currentState !== CircuitState.OPEN) throw new Error("Expected OPEN after 3 failures");
    if (cb.canExecute()) throw new Error("Expected canExecute=false");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 600));
    if (cb.currentState !== CircuitState.HALF_OPEN) throw new Error("Expected HALF_OPEN after timeout");

    cb.recordSuccess();
    if (cb.currentState !== CircuitState.CLOSED) throw new Error("Expected CLOSED after success in HALF_OPEN");

    pass(`CLOSED → OPEN (3 failures) → HALF_OPEN (timeout) → CLOSED (success)`);
  }

  // ── 2. Connection pool basic usage ────────────────────────────
  step(`ConnectionPool — ${urls.length} endpoint(s)`);
  const pool = new ConnectionPool(
    {
      endpoints: urls.map((url, i) => ({ url, weight: urls.length - i, label: `rpc-${i + 1}` })),
      strategy: "weighted-round-robin",
      healthCheckIntervalMs: 60_000, // disable auto health check for manual testing
    },
    prettyLogger,
  );
  {
    const conn = pool.getConnection();
    if (!conn) throw new Error("No connection returned");
    pass(`Got connection: ${c.info(conn.rpcEndpoint)}`);
  }

  // ── 3. withFallback — successful call ─────────────────────────
  step("withFallback() — get slot from healthy endpoint");
  {
    const t = timer();
    const slot = await pool.withFallback(async (conn) => {
      return conn.getSlot();
    });
    const elapsed = t();

    if (typeof slot !== "number" || slot <= 0) throw new Error(`Invalid slot: ${slot}`);
    pass(`Slot: ${c.info(String(slot))} (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 4. withFallback — multiple calls to verify round-robin ────
  step("withFallback() — 5 sequential calls");
  {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const slot = await pool.withFallback((conn) => conn.getSlot());
      results.push(slot);
    }
    pass(`Slots: [${results.join(", ")}] — all successful`);
  }

  // ── 5. Health report ──────────────────────────────────────────
  step("getHealthReport()");
  {
    const report = pool.getHealthReport();
    for (const [label, metrics] of report) {
      console.log(
        `    ${c.info(label)}: ` +
          `latency=${c.info(`${Math.round(metrics.latencyEma)}ms`)} ` +
          `errors=${metrics.errorCount} ` +
          `success=${metrics.successCount} ` +
          `circuit=${c.info(metrics.circuitState)}`,
      );
    }
    pass(`Health report for ${report.size} endpoint(s)`);
  }

  // ── 6. Fallback on error ──────────────────────────────────────
  if (urls.length > 1) {
    step("withFallback() — error on first, fallback to second");
    {
      let callCount = 0;
      const result = await pool.withFallback(async (conn) => {
        callCount++;
        if (callCount === 1) throw new Error("Simulated RPC failure");
        return conn.getSlot();
      });
      pass(`Fell back after error, got slot: ${c.info(String(result))} (${callCount} attempts)`);
    }
  } else {
    step(c.warn("Skipping fallback test — only 1 endpoint configured"));
    pass("Add RPC_URL_2 in .env for fallback testing");
  }

  pool.destroy();
}

export const run = () => runTest("05 — RPC ConnectionPool + Circuit Breaker", test);

const isMain = process.argv[1]?.includes("05-rpc-pool");
if (isMain) run();
