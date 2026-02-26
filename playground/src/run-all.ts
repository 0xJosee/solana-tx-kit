/**
 * Run all playground tests sequentially.
 *
 * Usage: pnpm run all
 *
 * Tests 01-03, 05 work without a keypair (pure logic + public RPC reads).
 * Tests 04, 06 require a funded devnet keypair (see .env.example).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { c, section } from "./utils.js";

config({ path: resolve(import.meta.dirname, "../.env") });

const keypairPath = process.env.KEYPAIR_PATH
  ? resolve(import.meta.dirname, "..", process.env.KEYPAIR_PATH)
  : null;
const hasKeypair = keypairPath !== null && existsSync(keypairPath);

interface TestEntry {
  name: string;
  needsKeypair: boolean;
  load: () => Promise<{ run: () => Promise<boolean> }>;
}

const allTests: TestEntry[] = [
  { name: "01 — withRetry + Error Classifier", needsKeypair: false, load: () => import("./01-retry.js") },
  { name: "02 — BlockhashManager", needsKeypair: false, load: () => import("./02-blockhash.js") },
  { name: "03 — Priority Fee Estimation", needsKeypair: false, load: () => import("./03-priority-fee.js") },
  { name: "04 — Transaction Simulation", needsKeypair: true, load: () => import("./04-simulation.js") },
  { name: "05 — RPC ConnectionPool + Circuit Breaker", needsKeypair: false, load: () => import("./05-rpc-pool.js") },
  { name: "06 — Full Pipeline: Send SOL Transfer", needsKeypair: true, load: () => import("./06-send-transfer.js") },
];

async function main() {
  console.log("\n" + c.bold("  solana-tx-kit — Real-World Integration Tests"));
  console.log(c.dim("  ════════════════════════════════════════════\n"));

  if (!hasKeypair) {
    console.log(c.warn("  No keypair found — tests 04, 06 will be skipped."));
    console.log(c.dim("  Create and fund a devnet keypair to run all tests."));
    console.log(c.dim("  See .env.example for instructions.\n"));
  }

  const results: Array<{ name: string; status: "pass" | "fail" | "skip"; timeMs: number }> = [];

  for (const test of allTests) {
    if (test.needsKeypair && !hasKeypair) {
      console.log(`\n  ${c.warn("SKIP")}  ${test.name} ${c.dim("(no keypair)")}`);
      results.push({ name: test.name, status: "skip", timeMs: 0 });
      continue;
    }

    const start = performance.now();
    try {
      const mod = await test.load();
      const ok = await mod.run();
      results.push({
        name: test.name,
        status: ok ? "pass" : "fail",
        timeMs: Math.round(performance.now() - start),
      });
    } catch (err) {
      results.push({ name: test.name, status: "fail", timeMs: Math.round(performance.now() - start) });
      console.error(`\n  ${c.fail("FATAL:")} ${test.name}`, err);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  section("Summary");
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);

  for (const r of results) {
    const icon =
      r.status === "pass" ? c.ok("PASS") : r.status === "fail" ? c.fail("FAIL") : c.warn("SKIP");
    console.log(`  ${icon}  ${r.name}  ${c.dim(`(${r.timeMs}ms)`)}`);
  }

  const parts = [`${c.bold(`${passed} passed`)}`];
  if (failed > 0) parts.push(c.fail(`${failed} failed`));
  if (skipped > 0) parts.push(c.warn(`${skipped} skipped`));
  console.log(`\n  ${parts.join(", ")} — ${c.dim(`${totalTime}ms total`)}\n`);

  if (failed > 0) process.exit(1);
}

main();
