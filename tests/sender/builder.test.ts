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
});
