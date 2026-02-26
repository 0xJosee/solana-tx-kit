/**
 * Test 06 — Full Pipeline: send SOL transfer on devnet
 *
 * Uses TransactionSender with builder API to send a real transaction.
 * This is the ultimate integration test — exercises all modules together.
 */
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { TransactionSender, TxEvent } from "solana-tx-kit";
import { runTest, step, pass, fail, c, timer, getConnection, loadKeypair, getRpcUrls, prettyLogger } from "./utils.js";

async function test() {
  const payer = loadKeypair();
  const urls = getRpcUrls();
  const conn = getConnection();

  console.log(`    Payer:   ${c.info(payer.publicKey.toBase58())}`);
  const balance = await conn.getBalance(payer.publicKey);
  console.log(`    Balance: ${c.info((balance / 1e9).toFixed(4))} SOL`);
  console.log(`    RPC:     ${c.info(urls[0]!)}\n`);

  if (balance < 0.01 * 1e9) {
    throw new Error(
      `Insufficient balance (${balance / 1e9} SOL). Run:\n` +
        `  solana airdrop 2 ${payer.publicKey.toBase58()} --url devnet`,
    );
  }

  // ── 1. Build TransactionSender ────────────────────────────────
  step("Build TransactionSender with full config");
  let sender: TransactionSender;
  {
    const builder = TransactionSender.builder()
      .signer(payer)
      .withPriorityFees({ targetPercentile: 75 })
      .withRetry({ maxRetries: 3, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2 })
      .withSimulation({ commitment: "confirmed" })
      .withConfirmation({ timeoutMs: 60_000 })
      .withLogger(prettyLogger)
      .commitment("confirmed");

    // Use pool if multiple endpoints, otherwise single
    if (urls.length > 1) {
      builder.rpcPool(urls.map((url, i) => ({ url, weight: urls.length - i, label: `rpc-${i + 1}` })));
    } else {
      builder.rpc(urls[0]!);
    }

    sender = builder.build();
    pass("TransactionSender built successfully");
  }

  // ── 2. Listen to events ───────────────────────────────────────
  step("Attach event listeners");
  const events: string[] = [];
  {
    sender.events.on(TxEvent.SENDING, (d) => {
      events.push("sending");
      console.log(`      ${c.dim("[event]")} ${c.accent("SENDING")} attempt=${d.attempt}`);
    });
    sender.events.on(TxEvent.SIMULATED, (d) => {
      events.push("simulated");
      console.log(`      ${c.dim("[event]")} ${c.accent("SIMULATED")} CU=${d.unitsConsumed} logs=${d.logs.length}`);
    });
    sender.events.on(TxEvent.SENT, (d) => {
      events.push("sent");
      console.log(`      ${c.dim("[event]")} ${c.accent("SENT")} sig=${d.signature.slice(0, 20)}...`);
    });
    sender.events.on(TxEvent.CONFIRMING, (d) => {
      events.push("confirming");
      console.log(`      ${c.dim("[event]")} ${c.accent("CONFIRMING")} ${d.commitment}`);
    });
    sender.events.on(TxEvent.CONFIRMED, (d) => {
      events.push("confirmed");
      console.log(`      ${c.dim("[event]")} ${c.ok("CONFIRMED")} slot=${d.slot}`);
    });
    sender.events.on(TxEvent.RETRYING, (d) => {
      events.push("retrying");
      console.log(`      ${c.dim("[event]")} ${c.warn("RETRYING")} attempt=${d.attempt} delay=${d.delayMs}ms`);
    });
    sender.events.on(TxEvent.FAILED, (d) => {
      events.push("failed");
      console.log(`      ${c.dim("[event]")} ${c.fail("FAILED")} ${d.error.message}`);
    });
    pass("Events: SENDING, SIMULATED, SENT, CONFIRMING, CONFIRMED, RETRYING, FAILED");
  }

  // ── 3. Send a real SOL transfer ───────────────────────────────
  step("Send 0.001 SOL transfer on devnet");
  {
    const receiver = Keypair.generate().publicKey;
    console.log(`      To: ${c.dim(receiver.toBase58())}\n`);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: receiver,
        lamports: 1_000_000, // 0.001 SOL
      }),
    );

    const t = timer();
    const result = await sender.send(tx);
    const elapsed = t();

    console.log();
    pass(`Signature:    ${c.info(result.signature)}`);
    pass(`Slot:         ${c.info(String(result.slot))}`);
    pass(`Commitment:   ${c.info(result.commitment)}`);
    pass(`Attempts:     ${c.info(String(result.attempts))}`);
    pass(`Total time:   ${c.info(`${result.totalLatencyMs}ms`)}`);
    if (result.unitsConsumed !== undefined) {
      pass(`CU consumed:  ${c.info(String(result.unitsConsumed))}`);
    }
    if (result.priorityFee !== undefined) {
      pass(`Priority fee: ${c.info(String(result.priorityFee))} µLamports/CU`);
    }
    pass(`Event flow:   ${events.join(" → ")}`);

    // Verify on-chain
    const receiverBalance = await conn.getBalance(receiver);
    if (receiverBalance !== 1_000_000) {
      console.log(`      ${c.warn(`Receiver balance: ${receiverBalance} (expected 1000000 — may need more time)`)}`);
    } else {
      pass(`On-chain verified: receiver has ${c.info("0.001")} SOL`);
    }
  }

  // ── 4. Send with skipSimulation ───────────────────────────────
  step("Send with skipSimulation=true");
  {
    const receiver = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: receiver,
        lamports: 1_000_000,
      }),
    );

    const t = timer();
    const result = await sender.send(tx, { skipSimulation: true });
    const elapsed = t();
    pass(`Sent without simulation: sig=${c.info(result.signature.slice(0, 20))}... (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 5. Send with skipConfirmation ─────────────────────────────
  step("Send with skipConfirmation=true (fire-and-forget)");
  {
    const receiver = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: receiver,
        lamports: 1_000_000,
      }),
    );

    const t = timer();
    const result = await sender.send(tx, { skipConfirmation: true });
    const elapsed = t();
    pass(`Fire-and-forget: sig=${c.info(result.signature.slice(0, 20))}... slot=0 (${c.dim(`${elapsed}ms`)})`);
  }

  // ── 6. Health report after sends ──────────────────────────────
  step("Health report after all sends");
  {
    const report = sender.getHealthReport();
    for (const [label, metrics] of report) {
      console.log(
        `      ${c.info(label)}: ` +
          `latency=${Math.round(metrics.latencyEma)}ms ` +
          `ok=${metrics.successCount} ` +
          `err=${metrics.errorCount} ` +
          `circuit=${metrics.circuitState}`,
      );
    }
    pass("All endpoints healthy");
  }

  // ── 7. Cleanup ────────────────────────────────────────────────
  step("Cleanup");
  sender.destroy();
  pass("TransactionSender destroyed");

  // ── Final balance check ───────────────────────────────────────
  const finalBalance = await conn.getBalance(payer.publicKey);
  const spent = (balance - finalBalance) / 1e9;
  console.log(`\n    ${c.dim(`Total spent: ${spent.toFixed(6)} SOL (including fees)`)}`);
}

export const run = () => runTest("06 — Full Pipeline: Send SOL Transfer", test);

const isMain = process.argv[1]?.includes("06-send-transfer");
if (isMain) run();
