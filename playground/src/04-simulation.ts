/**
 * Test 04 — Transaction Simulation
 *
 * Creates real SOL transfer transactions and simulates them on devnet.
 */
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { simulateTransaction } from "solana-tx-kit";
import { runTest, step, pass, c, timer, getConnection, loadKeypair, prettyLogger } from "./utils.js";

async function test() {
  const conn = getConnection();
  const payer = loadKeypair();

  console.log(`    Payer: ${c.info(payer.publicKey.toBase58())}`);
  const balance = await conn.getBalance(payer.publicKey);
  console.log(`    Balance: ${c.info((balance / 1e9).toFixed(4))} SOL\n`);

  if (balance < 0.01 * 1e9) {
    throw new Error(
      `Insufficient balance (${balance / 1e9} SOL). Run:\n` +
        `  solana airdrop 2 ${payer.publicKey.toBase58()} --url devnet`,
    );
  }

  // ── 1. Simulate valid SOL transfer ────────────────────────────
  step("Simulate valid SOL transfer (0.001 SOL)");
  {
    const receiver = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: receiver,
        lamports: 1_000_000, // 0.001 SOL
      }),
    );
    tx.feePayer = payer.publicKey;

    const t = timer();
    const result = await simulateTransaction(conn, tx, {
      commitment: "confirmed",
      replaceRecentBlockhash: true,
      sigVerify: false,
    }, prettyLogger);
    const elapsed = t();

    if (!result.success) {
      throw new Error(`Simulation failed: ${result.error?.message}`);
    }
    pass(
      `Success! CU consumed: ${c.info(String(result.unitsConsumed))} | ` +
        `logs: ${result.logs.length} lines (${c.dim(`${elapsed}ms`)})`,
    );
  }

  // ── 2. Simulate with insufficient funds ───────────────────────
  step("Simulate transfer with insufficient funds (999999 SOL)");
  {
    const receiver = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: receiver,
        lamports: 999_999 * 1e9, // way more than we have
      }),
    );
    tx.feePayer = payer.publicKey;

    const result = await simulateTransaction(conn, tx, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    if (result.success) {
      throw new Error("Expected simulation to fail for insufficient funds");
    }
    pass(`Correctly failed: ${c.warn(result.error?.message ?? "unknown error")}`);
  }

  // ── 3. Simulate transfer to invalid program ──────────────────
  step("Simulate call to non-existent program");
  {
    const fakeProgram = Keypair.generate().publicKey;
    const tx = new Transaction().add({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: fakeProgram,
      data: Buffer.from([]),
    });
    tx.feePayer = payer.publicKey;

    const result = await simulateTransaction(conn, tx, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    if (result.success) {
      throw new Error("Expected simulation to fail for non-existent program");
    }
    pass(`Correctly failed: ${c.warn(result.error?.message ?? "unknown error")}`);
  }

  // ── 4. Simulate with sigVerify: false vs true ─────────────────
  step("sigVerify=false is faster than signed simulation");
  {
    const receiver = Keypair.generate().publicKey;
    const makeTx = () =>
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: receiver,
          lamports: 1_000,
        }),
      );

    // Without sigVerify (faster, no signing needed)
    const tx1 = makeTx();
    tx1.feePayer = payer.publicKey;
    const t1 = timer();
    await simulateTransaction(conn, tx1, { replaceRecentBlockhash: true, sigVerify: false });
    const fast = t1();

    // With sigVerify (needs signing)
    const tx2 = makeTx();
    tx2.feePayer = payer.publicKey;
    const bh = await conn.getLatestBlockhash();
    tx2.recentBlockhash = bh.blockhash;
    tx2.sign(payer);
    const t2 = timer();
    await simulateTransaction(conn, tx2, { replaceRecentBlockhash: false, sigVerify: true });
    const slow = t2();

    pass(`sigVerify=false: ${c.info(`${fast}ms`)} vs sigVerify=true: ${c.info(`${slow}ms`)}`);
  }
}

export const run = () => runTest("04 — Transaction Simulation", test);

const isMain = process.argv[1]?.includes("04-simulation");
if (isMain) run();
