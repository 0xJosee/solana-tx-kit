import { ComputeBudgetProgram, Transaction as TransactionClass } from "@solana/web3.js";
import { BlockhashManager } from "../blockhash/blockhash-manager.js";
import { TransactionConfirmer } from "../confirmation/confirmer.js";
import { DEFAULT_PRIORITY_FEE_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { TxEvent, TypedEventEmitter } from "../events.js";
import { JitoBundleSender } from "../jito/bundle-sender.js";
import { createTipInstruction } from "../jito/tip.js";
import type { BundleResult } from "../jito/types.js";
import { createDefaultLogger } from "../logger.js";
import { createComputeBudgetInstructions } from "../priority-fee/compute-budget.js";
import { estimatePriorityFee } from "../priority-fee/fee-estimator.js";
import { isBlockhashExpired } from "../retry/error-classifier.js";
import { withRetry } from "../retry/retry.js";
import { ConnectionPool } from "../rpc/connection-pool.js";
import type { HealthMetrics } from "../rpc/types.js";
import { simulateTransaction } from "../simulation/simulator.js";
import type { Logger, SolanaTransaction } from "../types.js";
import { isLegacyTransaction } from "../utils.js";
import { TransactionSenderBuilder } from "./builder.js";
import { type SendOptions, type SendResult, type SenderConfig, isConnectionPoolConfig, isStaticFee } from "./types.js";

/**
 * Main orchestrator class. Composes all modules to send transactions
 * with retry, priority fees, simulation, confirmation, and optional Jito bundling.
 */
export class TransactionSender {
  readonly events: TypedEventEmitter;
  private readonly pool: ConnectionPool;
  private readonly blockhashManager: BlockhashManager;
  private readonly confirmer: TransactionConfirmer;
  private readonly jitoBundleSender?: JitoBundleSender;
  private readonly logger: Logger;
  private readonly config: Readonly<SenderConfig>;

  /** @param config - Full sender configuration. Prefer using {@link TransactionSender.builder} for construction. */
  constructor(config: SenderConfig) {
    this.config = config;
    this.logger = config.logger ?? createDefaultLogger();
    this.events = new TypedEventEmitter();

    // Initialize connection pool
    if (isConnectionPoolConfig(config.rpc)) {
      this.pool = new ConnectionPool(config.rpc, this.logger);
    } else {
      this.pool = new ConnectionPool({ endpoints: [{ url: config.rpc.url }] }, this.logger);
    }

    // Initialize blockhash manager
    const primaryConnection = this.pool.getConnection();
    this.blockhashManager = new BlockhashManager(primaryConnection, config.blockhash, this.logger);
    this.blockhashManager.start();

    // Initialize confirmer
    this.confirmer = new TransactionConfirmer(this.logger, this.events);

    // Initialize Jito if configured
    if (config.jito) {
      this.jitoBundleSender = new JitoBundleSender(config.jito, this.logger, this.events);
    }
  }

  /** Create a fluent builder for configuring and constructing a TransactionSender */
  static builder(): TransactionSenderBuilder {
    return new TransactionSenderBuilder();
  }

  /**
   * Send a single transaction with the full pipeline:
   *   1. Estimate priority fees (if enabled)
   *   2. Fetch fresh blockhash
   *   3. Add compute budget instructions
   *   4. Sign transaction
   *   5. Simulate (if enabled)
   *   6. Send via RPC (with retry + failover)
   *   7. Confirm (WebSocket + polling)
   *
   * @param transaction - A legacy or versioned Solana transaction. Not mutated for legacy transactions.
   * @param options - Per-send overrides for priority fee, simulation, confirmation, and retry.
   * @returns The confirmed transaction result including signature, slot, and timing info.
   * @throws {SolTxError} On simulation failure, non-retryable errors, or exhausted retries.
   */
  async send(transaction: SolanaTransaction, options?: SendOptions): Promise<SendResult> {
    const startTime = Date.now();
    const commitment = options?.commitment ?? this.config.commitment ?? "confirmed";
    const { tx, feeAmount } = await this.prepareTransaction(transaction, options);

    return withRetry(
      async (ctx) => {
        const blockhashInfo = await this.blockhashManager.getBlockhash();
        this.signTransaction(tx, blockhashInfo, options?.extraSigners);

        const unitsConsumed = await this.runSimulation(tx, options);

        this.events.emit(TxEvent.SENDING, { transaction: tx, attempt: ctx.attempt });
        const signature = await this.sendRawTransaction(tx);
        this.events.emit(TxEvent.SENT, { signature, attempt: ctx.attempt });

        if (options?.skipConfirmation) {
          return this.buildResult(signature, 0, commitment, ctx.attempt, startTime, unitsConsumed, feeAmount);
        }

        const slot = await this.awaitConfirmation(signature, blockhashInfo.lastValidBlockHeight, commitment);
        return this.buildResult(signature, slot, commitment, ctx.attempt, startTime, unitsConsumed, feeAmount);
      },
      {
        ...this.config.retry,
        ...options?.retry,
        onRetry: async (error, attempt, delayMs) => {
          this.events.emit(TxEvent.RETRYING, {
            attempt,
            maxRetries: this.config.retry?.maxRetries ?? 3,
            error,
            delayMs,
          });

          if (isBlockhashExpired(error)) {
            const oldBlockhash = this.blockhashManager.getCachedBlockhash()?.blockhash ?? "";
            await this.blockhashManager.refreshBlockhash();
            const newBlockhash = this.blockhashManager.getCachedBlockhash()?.blockhash ?? "";
            this.events.emit(TxEvent.BLOCKHASH_EXPIRED, { oldBlockhash, newBlockhash });
          }
        },
      },
    );
  }

  /**
   * Send a bundle of 1-5 transactions via Jito.
   * Automatically appends tip instruction to the last transaction.
   */
  async sendJitoBundle(
    transactions: SolanaTransaction[],
    options?: {
      tipLamports?: number;
      waitForConfirmation?: boolean;
      extraSigners?: import("@solana/web3.js").Keypair[];
    },
  ): Promise<BundleResult> {
    if (!this.jitoBundleSender) {
      throw new SolTxError(SolTxErrorCode.BUNDLE_FAILED, "Jito is not configured. Use .withJito() in the builder.");
    }

    // this.jitoBundleSender is truthy, so this.config.jito is JitoConfig (not false)
    const jitoConfig = this.config.jito as import("../jito/types.js").JitoConfig;
    const tipLamports = options?.tipLamports ?? jitoConfig.tipLamports ?? 10_000;

    // Append tip instruction to the last transaction
    const lastTx = transactions[transactions.length - 1];
    if (lastTx && isLegacyTransaction(lastTx)) {
      const tipIx = createTipInstruction(jitoConfig.tipPayer.publicKey, tipLamports);
      lastTx.add(tipIx);
    }

    // Sign all transactions
    for (const tx of transactions) {
      const blockhashInfo = await this.blockhashManager.getBlockhash();
      this.signTransaction(tx, blockhashInfo, options?.extraSigners);
    }

    return this.jitoBundleSender.sendBundle(transactions, {
      waitForConfirmation: options?.waitForConfirmation ?? true,
    });
  }

  /** Get current RPC health metrics */
  getHealthReport(): Map<string, HealthMetrics> {
    return this.pool.getHealthReport();
  }

  /** Clean up: stop background tasks, clear intervals */
  destroy(): void {
    this.pool.destroy();
    this.blockhashManager.destroy();
    this.events.removeAllListeners();
  }

  /** Build a working copy of the transaction with compute budget instructions prepended.
   *  Any existing ComputeBudget instructions in the original are stripped and replaced. */
  private async prepareTransaction(
    transaction: SolanaTransaction,
    options?: SendOptions,
  ): Promise<{ tx: SolanaTransaction; feeAmount: number | undefined }> {
    if (this.config.priorityFee !== false && isLegacyTransaction(transaction)) {
      const feeAmount = await this.resolvePriorityFee(options);
      const computeUnits = options?.computeUnits ?? DEFAULT_PRIORITY_FEE_CONFIG.defaultComputeUnits;
      const budgetInstructions = createComputeBudgetInstructions({
        computeUnits,
        microLamports: feeAmount,
      });
      const copy = new TransactionClass();
      for (const ix of budgetInstructions) copy.add(ix);
      for (const ix of transaction.instructions) {
        if (!ix.programId.equals(ComputeBudgetProgram.programId)) copy.add(ix);
      }
      return { tx: copy, feeAmount };
    }
    return { tx: transaction, feeAmount: undefined };
  }

  /** Set blockhash, fee payer, and sign the transaction with all signers */
  private signTransaction(
    tx: SolanaTransaction,
    blockhashInfo: { blockhash: string },
    extraSigners?: import("@solana/web3.js").Keypair[],
  ): void {
    const allSigners = [this.config.signer, ...(this.config.extraSigners ?? []), ...(extraSigners ?? [])];
    if (isLegacyTransaction(tx)) {
      tx.recentBlockhash = blockhashInfo.blockhash;
      tx.feePayer = this.config.signer.publicKey;
      tx.sign(...allSigners);
    } else {
      tx.message.recentBlockhash = blockhashInfo.blockhash;
      tx.sign(allSigners);
    }
  }

  /** Run simulation if enabled; returns compute units consumed */
  private async runSimulation(tx: SolanaTransaction, options?: SendOptions): Promise<number | undefined> {
    const skip = options?.skipSimulation ?? this.config.simulation === false;
    if (skip) return undefined;

    const conn = this.pool.getConnection();
    const simConfig = this.config.simulation !== false ? this.config.simulation : undefined;
    const simResult = await simulateTransaction(conn, tx, simConfig, this.logger);

    this.events.emit(TxEvent.SIMULATED, {
      signature: "",
      unitsConsumed: simResult.unitsConsumed,
      logs: simResult.logs,
    });

    if (!simResult.success) {
      throw new SolTxError(
        SolTxErrorCode.SIMULATION_FAILED,
        `Simulation failed: ${simResult.error?.message ?? "unknown error"}`,
        { context: { logs: simResult.logs } },
      );
    }

    return simResult.unitsConsumed;
  }

  /** Send serialized transaction via the connection pool with fallback */
  private async sendRawTransaction(tx: SolanaTransaction): Promise<string> {
    return this.pool.withFallback(async (conn) => {
      const serialized = tx.serialize();
      return conn.sendRawTransaction(serialized, {
        skipPreflight: true,
        maxRetries: 0,
      });
    });
  }

  /** Confirm a transaction and return its slot, or throw on failure/expiry */
  private async awaitConfirmation(
    signature: string,
    lastValidBlockHeight: number,
    commitment: string,
  ): Promise<number> {
    const conn = this.pool.getConnection();
    const confirmResult = await this.confirmer.confirm(conn, signature, lastValidBlockHeight, this.config.confirmation);

    if (confirmResult.status === "failed") {
      throw new SolTxError(
        SolTxErrorCode.TRANSACTION_FAILED,
        confirmResult.error?.message ?? "Transaction failed on chain",
      );
    }

    if (confirmResult.status === "expired") {
      throw new SolTxError(SolTxErrorCode.BLOCKHASH_EXPIRED, "Blockhash expired during confirmation");
    }

    this.events.emit(TxEvent.CONFIRMED, { signature, slot: confirmResult.slot ?? 0, commitment });
    return confirmResult.slot ?? 0;
  }

  /** Construct a SendResult */
  private buildResult(
    signature: string,
    slot: number,
    commitment: string,
    attempt: number,
    startTime: number,
    unitsConsumed: number | undefined,
    priorityFee: number | undefined,
  ): SendResult {
    return {
      signature,
      slot,
      commitment,
      attempts: attempt + 1,
      totalLatencyMs: Date.now() - startTime,
      unitsConsumed,
      priorityFee,
    };
  }

  private async resolvePriorityFee(options?: SendOptions): Promise<number> {
    if (options?.priorityFee && isStaticFee(options.priorityFee)) {
      return options.priorityFee.microLamports;
    }

    const conn = this.pool.getConnection();
    let feeConfig: Partial<import("../priority-fee/types.js").FeeEstimateConfig> | undefined;
    if (options?.priorityFee && !isStaticFee(options.priorityFee)) {
      feeConfig = options.priorityFee;
    } else if (this.config.priorityFee !== false && this.config.priorityFee !== undefined) {
      feeConfig = this.config.priorityFee;
    }

    const result = await estimatePriorityFee(conn, feeConfig);
    return result.microLamports;
  }
}
