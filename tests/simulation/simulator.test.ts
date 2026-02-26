import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { simulateTransaction } from "../../src/simulation/simulator.js";
import { createMockConnection } from "../helpers/mock-connection.js";

function createTestTransaction() {
  const kp = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1_000_000,
    }),
  );
  tx.recentBlockhash = "MockBlockhash111111111111111111111111111111";
  tx.feePayer = kp.publicKey;
  return tx;
}

describe("simulateTransaction", () => {
  it("returns success result when simulation passes", async () => {
    const conn = createMockConnection();
    const tx = createTestTransaction();
    const result = await simulateTransaction(conn, tx);
    expect(result.success).toBe(true);
    expect(result.unitsConsumed).toBe(50_000);
    expect(result.logs).toContain("Program log: success");
  });

  it("returns failure result when simulation has error", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          err: { InstructionError: [0, "Custom"] },
          logs: ["Program log: error"],
          unitsConsumed: 10_000,
        },
      }),
    });
    const tx = createTestTransaction();
    const result = await simulateTransaction(conn, tx);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.instructionError?.index).toBe(0);
  });

  it("throws SolTxError when connection fails", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const tx = createTestTransaction();
    await expect(simulateTransaction(conn, tx)).rejects.toThrow("Transaction simulation failed");
  });
});
