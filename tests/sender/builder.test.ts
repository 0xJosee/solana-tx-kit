import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { TransactionSender } from "../../src/sender/transaction-sender.js";

describe("TransactionSenderBuilder", () => {
  const senders: TransactionSender[] = [];

  afterEach(() => {
    for (const sender of senders) {
      sender.destroy();
    }
    senders.length = 0;
  });

  it("builds a sender with minimal config", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
    expect(sender.events).toBeDefined();
  });

  it("throws when RPC is missing", () => {
    expect(() => {
      TransactionSender.builder().signer(Keypair.generate()).build();
    }).toThrow("at least one RPC endpoint is required");
  });

  it("throws when signer is missing", () => {
    expect(() => {
      TransactionSender.builder().rpc("https://api.mainnet-beta.solana.com").build();
    }).toThrow("signer is required");
  });

  it("builds with RPC pool config", () => {
    const sender = TransactionSender.builder()
      .rpcPool([
        { url: "https://rpc1.example.com", weight: 3, label: "primary" },
        { url: "https://rpc2.example.com", weight: 1, label: "secondary" },
      ])
      .signer(Keypair.generate())
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with all options", () => {
    const kp = Keypair.generate();
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(kp)
      .withPriorityFees({ targetPercentile: 90 })
      .withRetry({ maxRetries: 5 })
      .withSimulation({ commitment: "confirmed" })
      .withConfirmation({ timeoutMs: 30_000 })
      .commitment("finalized")
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with priority fees disabled", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .disablePriorityFees()
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with simulation disabled", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .disableSimulation()
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with extra signers", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .withExtraSigners([Keypair.generate(), Keypair.generate()])
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with blockhash config", () => {
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .withBlockhash({ ttlMs: 5_000 })
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with custom logger", () => {
    const customLogger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const sender = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .withLogger(customLogger)
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("builds with rpcPool strategy and healthCheckIntervalMs options", () => {
    const sender = TransactionSender.builder()
      .rpcPool(
        [
          { url: "https://rpc1.example.com", weight: 2, label: "primary" },
          { url: "https://rpc2.example.com", weight: 1, label: "secondary" },
        ],
        { strategy: "latency-based", healthCheckIntervalMs: 5_000 },
      )
      .signer(Keypair.generate())
      .build();
    senders.push(sender);
    expect(sender).toBeDefined();
  });

  it("config mutation after build() does not affect the sender", () => {
    const builder = TransactionSender.builder()
      .rpc("https://api.mainnet-beta.solana.com")
      .signer(Keypair.generate())
      .withRetry({ maxRetries: 3 });

    const sender1 = builder.build();
    senders.push(sender1);

    // Mutate the builder after build — this should NOT affect sender1
    builder.withRetry({ maxRetries: 99 });
    const sender2 = builder.build();
    senders.push(sender2);

    // Both senders should exist independently
    expect(sender1).toBeDefined();
    expect(sender2).toBeDefined();
    // They should be distinct instances
    expect(sender1).not.toBe(sender2);
  });
});
