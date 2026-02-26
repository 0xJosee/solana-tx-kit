/**
 * Test 03 — Priority Fee Estimation + ComputeBudget Instructions
 *
 * Uses real devnet RPC to fetch recent prioritization fees.
 */
import { PublicKey } from "@solana/web3.js";
import { estimatePriorityFee, createComputeBudgetInstructions } from "solana-tx-kit";
import { runTest, step, pass, c, timer, getConnection } from "./utils.js";

async function test() {
  const conn = getConnection();

  // ── 1. Default fee estimation ─────────────────────────────────
  step("Estimate priority fee (p75, default config)");
  {
    const t = timer();
    const result = await estimatePriorityFee(conn);
    const elapsed = t();

    pass(
      `Fee: ${c.info(String(result.microLamports))} µLamports/CU | ` +
        `p50=${result.percentiles.p50} p75=${result.percentiles.p75} p90=${result.percentiles.p90} | ` +
        `samples=${result.sampleCount} (${c.dim(`${elapsed}ms`)})`,
    );
  }

  // ── 2. Custom percentile (p90) ────────────────────────────────
  step("Estimate with p90 percentile");
  {
    const result = await estimatePriorityFee(conn, { targetPercentile: 90 });
    pass(`Fee (p90): ${c.info(String(result.microLamports))} µLamports/CU`);
  }

  // ── 3. With writable accounts filter ──────────────────────────
  step("Estimate with writable accounts filter");
  {
    // Token Program as example writable account
    const writableAccounts = [new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")];
    const result = await estimatePriorityFee(conn, {
      targetPercentile: 75,
      writableAccounts,
    });
    pass(`Fee (filtered): ${c.info(String(result.microLamports))} µLamports/CU, samples=${result.sampleCount}`);
  }

  // ── 4. Min/max clamping ───────────────────────────────────────
  step("Fee clamped to min/max bounds");
  {
    const result = await estimatePriorityFee(conn, {
      minMicroLamports: 5_000,
      maxMicroLamports: 10_000,
    });
    if (result.microLamports < 5_000) {
      throw new Error(`Fee ${result.microLamports} below min 5000`);
    }
    if (result.microLamports > 10_000) {
      throw new Error(`Fee ${result.microLamports} above max 10000`);
    }
    pass(`Clamped: ${c.info(String(result.microLamports))} µLamports/CU (min=5000, max=10000)`);
  }

  // ── 5. ComputeBudget instructions ─────────────────────────────
  step("createComputeBudgetInstructions()");
  {
    const instructions = createComputeBudgetInstructions({
      computeUnits: 200_000,
      microLamports: 50_000,
    });

    if (instructions.length !== 2) {
      throw new Error(`Expected 2 instructions, got ${instructions.length}`);
    }

    // First = SetComputeUnitLimit, Second = SetComputeUnitPrice
    const [limitIx, priceIx] = instructions;
    if (!limitIx || !priceIx) throw new Error("Missing instructions");

    if (!limitIx.programId.toBase58().startsWith("ComputeBudget")) {
      throw new Error(`Expected ComputeBudget program, got ${limitIx.programId.toBase58()}`);
    }
    if (!priceIx.programId.toBase58().startsWith("ComputeBudget")) {
      throw new Error(`Expected ComputeBudget program, got ${priceIx.programId.toBase58()}`);
    }

    pass(`Created: SetComputeUnitLimit(200000) + SetComputeUnitPrice(50000)`);
  }
}

export const run = () => runTest("03 — Priority Fee Estimation", test);

const isMain = process.argv[1]?.includes("03-priority-fee");
if (isMain) run();
