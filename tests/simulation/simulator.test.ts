import { Keypair, SystemProgram, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { SolTxError } from "../../src/errors.js";
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

  it("returns success result for a VersionedTransaction", async () => {
    const conn = createMockConnection();
    // Create a mock that passes isVersionedTransaction: needs `version` and `serialize`
    const mockVersionedTx = {
      version: 0,
      serialize: () => Buffer.from([1, 2, 3]),
    } as unknown as VersionedTransaction;

    const result = await simulateTransaction(conn, mockVersionedTx);
    expect(result.success).toBe(true);
    expect(result.unitsConsumed).toBe(50_000);
    expect(result.logs).toContain("Program log: success");
  });

  it("passes config options to VersionedTransaction simulate call", async () => {
    const mockSimulate = vi.fn().mockResolvedValue({
      context: { slot: 100 },
      value: { err: null, logs: ["Program log: versioned"], unitsConsumed: 30_000 },
    });
    const conn = createMockConnection({ simulateTransaction: mockSimulate });
    const mockVersionedTx = {
      version: 0,
      serialize: () => Buffer.from([1, 2, 3]),
    } as unknown as VersionedTransaction;

    const result = await simulateTransaction(conn, mockVersionedTx, {
      commitment: "finalized",
      replaceRecentBlockhash: false,
      sigVerify: true,
    });

    expect(result.success).toBe(true);
    expect(result.unitsConsumed).toBe(30_000);
    expect(mockSimulate).toHaveBeenCalledWith(mockVersionedTx, {
      commitment: "finalized",
      replaceRecentBlockhash: false,
      sigVerify: true,
    });
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

  it("returns failure result with string error", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          err: "AccountNotFound",
          logs: null,
          unitsConsumed: undefined,
        },
      }),
    });
    const tx = createTestTransaction();
    const result = await simulateTransaction(conn, tx);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("AccountNotFound");
    expect(result.error?.code).toBe(-1);
    expect(result.unitsConsumed).toBe(0);
    expect(result.logs).toEqual([]);
  });

  it("returns failure with error code when err has a code property", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          err: { code: 42, message: "SomeError" },
          logs: [],
          unitsConsumed: 5_000,
        },
      }),
    });
    const tx = createTestTransaction();
    const result = await simulateTransaction(conn, tx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(42);
  });

  it("returns failure with InstructionError containing object second element", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          err: { InstructionError: [2, { Custom: 6001 }] },
          logs: ["Program log: error"],
          unitsConsumed: 10_000,
        },
      }),
    });
    const tx = createTestTransaction();
    const result = await simulateTransaction(conn, tx);
    expect(result.success).toBe(false);
    expect(result.error?.instructionError?.index).toBe(2);
    expect(result.error?.instructionError?.message).toContain("6001");
  });

  it("throws SolTxError when connection fails", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const tx = createTestTransaction();
    await expect(simulateTransaction(conn, tx)).rejects.toThrow("Transaction simulation failed");
  });

  it("throws SolTxError wrapping non-Error thrown values", async () => {
    const conn = createMockConnection({
      simulateTransaction: vi.fn().mockRejectedValue("string-error"),
    });
    const tx = createTestTransaction();
    try {
      await simulateTransaction(conn, tx);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SolTxError);
      expect((e as SolTxError).message).toContain("string-error");
    }
  });
});
