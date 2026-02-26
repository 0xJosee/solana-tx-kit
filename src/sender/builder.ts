import type { Commitment, Keypair } from "@solana/web3.js";
import type { BlockhashManagerConfig } from "../blockhash/types.js";
import type { ConfirmationConfig } from "../confirmation/types.js";
import type { JitoConfig } from "../jito/types.js";
import type { FeeEstimateConfig } from "../priority-fee/types.js";
import type { RetryConfig } from "../retry/types.js";
import type { RpcEndpointConfig } from "../rpc/types.js";
import type { SimulationConfig } from "../simulation/types.js";
import type { Logger } from "../types.js";
import { TransactionSender } from "./transaction-sender.js";
import type { SenderConfig } from "./types.js";

/**
 * Fluent builder for constructing a TransactionSender.
 *
 * Usage:
 *   const sender = TransactionSender.builder()
 *     .rpc("https://api.mainnet-beta.solana.com")
 *     .signer(keypair)
 *     .withPriorityFees({ targetPercentile: 90 })
 *     .withJito({ tipLamports: 10_000, tipPayer: keypair })
 *     .withRetry({ maxRetries: 5 })
 *     .build();
 */
export class TransactionSenderBuilder {
  private config: Partial<SenderConfig> = {};

  /** Set a single RPC endpoint */
  rpc(url: string): this {
    this.config.rpc = { url };
    return this;
  }

  /** Set multiple RPC endpoints with failover */
  rpcPool(
    endpoints: RpcEndpointConfig[],
    options?: { strategy?: "weighted-round-robin" | "latency-based"; healthCheckIntervalMs?: number },
  ): this {
    const poolConfig: import("../rpc/types.js").ConnectionPoolConfig = { endpoints };
    if (options?.strategy) poolConfig.strategy = options.strategy;
    if (options?.healthCheckIntervalMs) poolConfig.healthCheckIntervalMs = options.healthCheckIntervalMs;
    this.config.rpc = poolConfig;
    return this;
  }

  /** Set the transaction signer */
  signer(keypair: Keypair): this {
    this.config.signer = keypair;
    return this;
  }

  /** Set default extra signers applied to every send */
  withExtraSigners(signers: Keypair[]): this {
    this.config.extraSigners = signers;
    return this;
  }

  /** Configure priority fee estimation */
  withPriorityFees(config?: Partial<FeeEstimateConfig>): this {
    this.config.priorityFee = config ?? {};
    return this;
  }

  /** Disable automatic priority fee estimation */
  disablePriorityFees(): this {
    this.config.priorityFee = false;
    return this;
  }

  /** Configure Jito bundle submission */
  withJito(config: JitoConfig): this {
    this.config.jito = config;
    return this;
  }

  /** Configure retry behavior */
  withRetry(config: Partial<RetryConfig>): this {
    this.config.retry = config;
    return this;
  }

  /** Configure transaction simulation */
  withSimulation(config?: Partial<SimulationConfig>): this {
    this.config.simulation = config ?? {};
    return this;
  }

  /** Disable pre-flight simulation */
  disableSimulation(): this {
    this.config.simulation = false;
    return this;
  }

  /** Configure confirmation tracking */
  withConfirmation(config: Partial<ConfirmationConfig>): this {
    this.config.confirmation = config;
    return this;
  }

  /** Configure blockhash management */
  withBlockhash(config: Partial<BlockhashManagerConfig>): this {
    this.config.blockhash = config;
    return this;
  }

  /** Set the logger */
  withLogger(logger: Logger): this {
    this.config.logger = logger;
    return this;
  }

  /** Set the default commitment */
  commitment(level: Commitment): this {
    this.config.commitment = level;
    return this;
  }

  /** Build and return the TransactionSender */
  build(): TransactionSender {
    if (!this.config.rpc) {
      throw new Error("TransactionSenderBuilder: at least one RPC endpoint is required. Call .rpc() or .rpcPool()");
    }
    if (!this.config.signer) {
      throw new Error("TransactionSenderBuilder: signer is required. Call .signer()");
    }

    return new TransactionSender(this.config as SenderConfig);
  }
}
