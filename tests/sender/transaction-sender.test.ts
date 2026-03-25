import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { TxEvent } from "../../src/events.js";

const TEST_SIGNATURE = "5UfDuX7WXYzPMV3bNQHRKuN8n1MFi47kL9HteQNGPDaBbuEzivjJoSBFQMFg9M6RnN3t5C2X";
const TEST_BLOCKHASH = {
  blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
  lastValidBlockHeight: 200,
};

const mockGetLatestBlockhash = vi.fn().mockResolvedValue(TEST_BLOCKHASH);
const mockGetBlockHeight = vi.fn().mockResolvedValue(100);
const mockSendRawTransaction = vi.fn().mockResolvedValue(TEST_SIGNATURE);
const mockSimulateTransaction = vi.fn().mockResolvedValue({
  value: { err: null, logs: ["log1"], unitsConsumed: 50_000 },
});
const mockOnSignature = vi.fn().mockReturnValue(1);
const mockRemoveSignatureListener = vi.fn().mockResolvedValue(undefined);
const mockGetSignatureStatuses = vi.fn().mockResolvedValue({
  value: [{ slot: 150, confirmationStatus: "confirmed", err: null }],
});
const mockGetRecentPrioritizationFees = vi.fn().mockResolvedValue([
  { slot: 100, prioritizationFee: 1000 },
  { slot: 101, prioritizationFee: 2000 },
  { slot: 102, prioritizationFee: 3000 },
]);
const mockGetSlot = vi.fn().mockResolvedValue(100);

// Mock the Connection class at the module level
vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
      getBlockHeight: mockGetBlockHeight,
      sendRawTransaction: mockSendRawTransaction,
      simulateTransaction: mockSimulateTransaction,
      onSignature: mockOnSignature,
      removeSignatureListener: mockRemoveSignatureListener,
      getSignatureStatuses: mockGetSignatureStatuses,
      getRecentPrioritizationFees: mockGetRecentPrioritizationFees,
      getSlot: mockGetSlot,
    })),
  };
});

function createTestTransaction(signer: Keypair): Transaction {
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: PublicKey.unique(),
      lamports: 1000,
    }),
  );
  return tx;
}

const FAST_CONFIRMATION = { timeoutMs: 5_000, pollIntervalMs: 50 };

describe("TransactionSender.send()", () => {
  let signer: Keypair;

  // Dynamically import after vi.mock is set up
  let TransactionSender: typeof import("../../src/sender/transaction-sender.js").TransactionSender;

  beforeEach(async () => {
    signer = Keypair.generate();

    // Reset all mocks to defaults
    mockGetLatestBlockhash.mockResolvedValue(TEST_BLOCKHASH);
    mockGetBlockHeight.mockResolvedValue(100);
    mockSendRawTransaction.mockResolvedValue(TEST_SIGNATURE);
    mockSimulateTransaction.mockResolvedValue({
      value: { err: null, logs: ["log1"], unitsConsumed: 50_000 },
    });
    mockGetSignatureStatuses.mockResolvedValue({
      value: [{ slot: 150, confirmationStatus: "confirmed", err: null }],
    });
    mockGetRecentPrioritizationFees.mockResolvedValue([
      { slot: 100, prioritizationFee: 1000 },
      { slot: 101, prioritizationFee: 2000 },
      { slot: 102, prioritizationFee: 3000 },
    ]);

    const mod = await import("../../src/sender/transaction-sender.js");
    TransactionSender = mod.TransactionSender;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function buildSender(
    opts: {
      priorityFee?: false;
      simulation?: false;
      retryConfig?: Record<string, unknown>;
    } = {},
  ) {
    const builder = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION);

    if (opts.priorityFee === false) builder.disablePriorityFees();
    if (opts.simulation === false) builder.disableSimulation();
    if (opts.retryConfig) builder.withRetry(opts.retryConfig);

    const sender = builder.build();
    return sender;
  }

  it("sends and confirms a legacy transaction on first try", async () => {
    const sender = buildSender({ priorityFee: false, simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, { skipSimulation: true });

      expect(result.signature).toBe(TEST_SIGNATURE);
      expect(result.slot).toBe(150);
      expect(result.attempts).toBe(1);
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      sender.destroy();
    }
  });

  it("does not mutate the original transaction instructions", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const originalInstructionCount = tx.instructions.length;

      await sender.send(tx, { skipSimulation: true });

      expect(tx.instructions.length).toBe(originalInstructionCount);
    } finally {
      sender.destroy();
    }
  });

  it("replaces pre-existing ComputeBudget instructions instead of duplicating them", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      // Simulate what Jupiter / external SDKs do: add ComputeBudget IXs upfront
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 999_999 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 42 }));

      await sender.send(tx, { skipSimulation: true });

      // The original transaction should still be unmutated
      const cbIxCount = tx.instructions.filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId)).length;
      expect(cbIxCount).toBe(2); // original still has its own 2

      // The sent transaction should carry exactly 2 ComputeBudget IXs (no duplicates)
      // and must reuse the original SetComputeUnitLimit value (999_999), not the library default.
      const serializedTx = mockSendRawTransaction.mock.calls[0]?.[0] as Buffer;
      const sentTx = Transaction.from(serializedTx);
      const sentCbIxs = sentTx.instructions.filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId));
      expect(sentCbIxs.length).toBe(2);
      const cuLimitIx = sentCbIxs.find((ix) => ix.data[0] === 0x02);
      expect(cuLimitIx?.data.readUInt32LE(1)).toBe(999_999);

      expect(mockSendRawTransaction).toHaveBeenCalledOnce();
    } finally {
      sender.destroy();
    }
  });

  it("emits lifecycle events in correct order", async () => {
    const sender = buildSender({ priorityFee: false, simulation: false });
    try {
      const events: string[] = [];
      sender.events.on(TxEvent.SENDING, () => events.push("SENDING"));
      sender.events.on(TxEvent.SENT, () => events.push("SENT"));
      sender.events.on(TxEvent.CONFIRMED, () => events.push("CONFIRMED"));

      const tx = createTestTransaction(signer);
      await sender.send(tx, { skipSimulation: true });

      expect(events).toEqual(["SENDING", "SENT", "CONFIRMED"]);
    } finally {
      sender.destroy();
    }
  });

  it("emits SIMULATED event when simulation is enabled", async () => {
    const sender = buildSender({ priorityFee: false });
    try {
      let simulatedEvent: { unitsConsumed: number } | undefined;
      sender.events.on(TxEvent.SIMULATED, (data) => {
        simulatedEvent = data;
      });

      const tx = createTestTransaction(signer);
      await sender.send(tx);

      expect(simulatedEvent).toBeDefined();
      expect(simulatedEvent?.unitsConsumed).toBe(50_000);
    } finally {
      sender.destroy();
    }
  });

  it("skips confirmation when skipConfirmation is set", async () => {
    const sender = buildSender({ priorityFee: false, simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, { skipConfirmation: true, skipSimulation: true });

      expect(result.signature).toBe(TEST_SIGNATURE);
      expect(result.slot).toBe(0);
      expect(mockGetSignatureStatuses).not.toHaveBeenCalled();
    } finally {
      sender.destroy();
    }
  });

  it("throws when simulation fails", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: {
        err: { InstructionError: [0, "Custom"] },
        logs: ["Program failed"],
        unitsConsumed: 0,
      },
    });

    const sender = buildSender({ priorityFee: false, retryConfig: { maxRetries: 0 } });
    try {
      const tx = createTestTransaction(signer);
      // withRetry wraps the simulation error as RETRIES_EXHAUSTED when maxRetries=0
      await expect(sender.send(tx)).rejects.toThrow(/Simulation failed|All 1 attempts failed/);
    } finally {
      sender.destroy();
    }
  });

  it("includes priority fee in SendResult when enabled", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, { skipSimulation: true });

      expect(result.priorityFee).toBeDefined();
      expect(result.priorityFee).toBeGreaterThan(0);
    } finally {
      sender.destroy();
    }
  });

  it("uses static fee override from SendOptions", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, {
        priorityFee: { microLamports: 42_000 },
        skipSimulation: true,
      });

      expect(result.priorityFee).toBe(42_000);
      expect(mockGetRecentPrioritizationFees).not.toHaveBeenCalled();
    } finally {
      sender.destroy();
    }
  });

  it("retries on transient send failure with custom predicate", async () => {
    mockSendRawTransaction
      .mockRejectedValueOnce(new Error("HTTP 429 Too Many Requests"))
      .mockResolvedValueOnce("retried-sig-123");

    // withFallback wraps endpoint errors as "All RPC endpoints failed",
    // so we use a retryPredicate that checks the cause chain for 429
    const sender = buildSender({
      priorityFee: false,
      simulation: false,
      retryConfig: {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        retryPredicate: (error: Error) => error.message.includes("429") || error.cause?.toString().includes("429"),
      },
    });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, { skipSimulation: true });

      expect(result.signature).toBe("retried-sig-123");
      expect(result.attempts).toBe(2);
    } finally {
      sender.destroy();
    }
  });

  it("throws immediately for non-retryable errors", async () => {
    mockSendRawTransaction.mockReset();
    mockSendRawTransaction.mockRejectedValue(
      new Error("Transaction simulation failed: Error processing Instruction 0: insufficient funds"),
    );

    const sender = buildSender({
      priorityFee: false,
      simulation: false,
      retryConfig: { maxRetries: 3 },
    });
    try {
      const tx = createTestTransaction(signer);
      await expect(sender.send(tx, { skipSimulation: true })).rejects.toThrow("Non-retryable");
      expect(mockSendRawTransaction).toHaveBeenCalledTimes(1);
    } finally {
      sender.destroy();
    }
  });

  it("send() throws when sender has been destroyed", async () => {
    const sender = buildSender({ priorityFee: false, simulation: false });
    sender.destroy();

    const tx = createTestTransaction(signer);
    try {
      await sender.send(tx, { skipSimulation: true });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SolTxError);
      expect((e as SolTxError).code).toBe(SolTxErrorCode.NON_RETRYABLE);
      expect((e as SolTxError).message).toContain("destroyed");
    }
  });

  it("throws INVALID_ARGUMENT for negative static priority fee", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      await expect(
        sender.send(tx, {
          priorityFee: { microLamports: -100 },
          skipSimulation: true,
        }),
      ).rejects.toThrow(SolTxError);

      try {
        await sender.send(tx, {
          priorityFee: { microLamports: -100 },
          skipSimulation: true,
        });
      } catch (e) {
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("non-negative");
      }
    } finally {
      sender.destroy();
    }
  });

  it("throws INVALID_ARGUMENT for NaN static priority fee", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      try {
        await sender.send(tx, {
          priorityFee: { microLamports: Number.NaN },
          skipSimulation: true,
        });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("non-negative finite");
      }
    } finally {
      sender.destroy();
    }
  });

  it("throws INVALID_ARGUMENT for Infinity static priority fee", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      try {
        await sender.send(tx, {
          priorityFee: { microLamports: Number.POSITIVE_INFINITY },
          skipSimulation: true,
        });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
      }
    } finally {
      sender.destroy();
    }
  });

  it("emits FAILED event when send exhausts retries", async () => {
    mockSendRawTransaction.mockReset();
    mockSendRawTransaction.mockRejectedValue(new Error("HTTP 503 Service Unavailable"));

    const sender = buildSender({
      priorityFee: false,
      simulation: false,
      retryConfig: {
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 1,
        retryPredicate: () => true,
      },
    });
    try {
      let failedEvent: { error: Error; attempt: number } | undefined;
      sender.events.on(TxEvent.FAILED, (data) => {
        failedEvent = data;
      });

      const tx = createTestTransaction(signer);
      await expect(sender.send(tx, { skipSimulation: true })).rejects.toThrow();

      expect(failedEvent).toBeDefined();
      expect(failedEvent?.error).toBeInstanceOf(Error);
    } finally {
      sender.destroy();
    }
  });

  it("throws TRANSACTION_FAILED when confirmation returns failed status", async () => {
    // Make the confirmer poll return a failed status
    mockGetSignatureStatuses.mockResolvedValue({
      value: [{ slot: 150, confirmationStatus: "confirmed", err: "InstructionError" }],
    });

    const sender = buildSender({
      priorityFee: false,
      simulation: false,
      retryConfig: { maxRetries: 0 },
    });
    try {
      const tx = createTestTransaction(signer);
      await expect(sender.send(tx, { skipSimulation: true })).rejects.toThrow();
    } finally {
      sender.destroy();
    }
  });

  it("throws BLOCKHASH_EXPIRED when confirmation returns expired status", async () => {
    // Make getBlockHeight return a value greater than lastValidBlockHeight
    mockGetBlockHeight.mockResolvedValue(999_999);
    mockGetSignatureStatuses.mockResolvedValue({
      value: [null],
    });

    const sender = buildSender({
      priorityFee: false,
      simulation: false,
      retryConfig: { maxRetries: 0 },
    });
    try {
      const tx = createTestTransaction(signer);
      await expect(sender.send(tx, { skipSimulation: true })).rejects.toThrow(/expired|Blockhash|All 1 attempts/);
    } finally {
      sender.destroy();
    }
  });

  it("uses config-level priority fee config for estimation", async () => {
    // Build a sender with priority fee config (not static, not false)
    const builder = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .withPriorityFees({ targetPercentile: 90 })
      .disableSimulation();

    const sender = builder.build();
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, { skipSimulation: true });

      expect(result.priorityFee).toBeDefined();
      expect(result.priorityFee).toBeGreaterThan(0);
      expect(mockGetRecentPrioritizationFees).toHaveBeenCalled();
    } finally {
      sender.destroy();
    }
  });

  it("uses per-send dynamic fee config override", async () => {
    const sender = buildSender({ simulation: false });
    try {
      const tx = createTestTransaction(signer);
      const result = await sender.send(tx, {
        priorityFee: { targetPercentile: 50 },
        skipSimulation: true,
      });

      expect(result.priorityFee).toBeDefined();
      expect(mockGetRecentPrioritizationFees).toHaveBeenCalled();
    } finally {
      sender.destroy();
    }
  });
});

describe("TransactionSender.sendJitoBundle()", () => {
  let signer: Keypair;
  let TransactionSender: typeof import("../../src/sender/transaction-sender.js").TransactionSender;

  beforeEach(async () => {
    signer = Keypair.generate();

    mockGetLatestBlockhash.mockResolvedValue(TEST_BLOCKHASH);
    mockGetBlockHeight.mockResolvedValue(100);

    const mod = await import("../../src/sender/transaction-sender.js");
    TransactionSender = mod.TransactionSender;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws BUNDLE_FAILED when Jito is not configured", async () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .disablePriorityFees()
      .disableSimulation()
      .build();

    try {
      const tx = createTestTransaction(signer);
      try {
        await sender.sendJitoBundle([tx]);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.BUNDLE_FAILED);
        expect((e as SolTxError).message).toContain("Jito is not configured");
      }
    } finally {
      sender.destroy();
    }
  });

  it("sendJitoBundle() throws when sender has been destroyed", async () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .disablePriorityFees()
      .disableSimulation()
      .build();

    sender.destroy();

    const tx = createTestTransaction(signer);
    try {
      await sender.sendJitoBundle([tx]);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SolTxError);
      expect((e as SolTxError).code).toBe(SolTxErrorCode.NON_RETRYABLE);
      expect((e as SolTxError).message).toContain("destroyed");
    }
  });
});

describe("TransactionSender.destroy()", () => {
  let signer: Keypair;
  let TransactionSender: typeof import("../../src/sender/transaction-sender.js").TransactionSender;

  beforeEach(async () => {
    signer = Keypair.generate();

    mockGetLatestBlockhash.mockResolvedValue(TEST_BLOCKHASH);
    mockGetBlockHeight.mockResolvedValue(100);

    const mod = await import("../../src/sender/transaction-sender.js");
    TransactionSender = mod.TransactionSender;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("destroy() can be called without error", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .disablePriorityFees()
      .disableSimulation()
      .build();

    expect(() => sender.destroy()).not.toThrow();
  });

  it("destroy() removes all event listeners", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .disablePriorityFees()
      .disableSimulation()
      .build();

    // Add some listeners
    sender.events.on(TxEvent.SENDING, () => {});
    sender.events.on(TxEvent.SENT, () => {});
    sender.events.on(TxEvent.CONFIRMED, () => {});

    expect(sender.events.listenerCount(TxEvent.SENDING)).toBe(1);
    expect(sender.events.listenerCount(TxEvent.SENT)).toBe(1);
    expect(sender.events.listenerCount(TxEvent.CONFIRMED)).toBe(1);

    sender.destroy();

    expect(sender.events.listenerCount(TxEvent.SENDING)).toBe(0);
    expect(sender.events.listenerCount(TxEvent.SENT)).toBe(0);
    expect(sender.events.listenerCount(TxEvent.CONFIRMED)).toBe(0);
  });

  it("destroy() prevents subsequent send() calls", async () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(signer)
      .withConfirmation(FAST_CONFIRMATION)
      .disablePriorityFees()
      .disableSimulation()
      .build();

    sender.destroy();

    const tx = createTestTransaction(signer);
    await expect(sender.send(tx)).rejects.toThrow("destroyed");
  });
});
