import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { JITO_BLOCK_ENGINE_URL } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { TxEvent, type TypedEventEmitter } from "../events.js";
import type { Logger } from "../types.js";
import { isVersionedTransaction } from "../utils.js";
import { type BundleResult, BundleStatus, type JitoConfig } from "./types.js";

function serializeTransaction(tx: Transaction | VersionedTransaction): string {
  if (isVersionedTransaction(tx)) {
    return Buffer.from(tx.serialize()).toString("base64");
  }
  return tx.serialize().toString("base64");
}

/**
 * Sends a bundle of 1-5 transactions to the Jito block engine.
 * Uses raw fetch() — no dependency on jito-ts or jito-js-rpc.
 */
export class JitoBundleSender {
  private readonly blockEngineUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: JitoConfig,
    private readonly logger?: Logger,
    private readonly events?: TypedEventEmitter,
  ) {
    this.blockEngineUrl = JitoBundleSender.validateUrl(config.blockEngineUrl ?? JITO_BLOCK_ENGINE_URL);
    this.pollIntervalMs = config.statusPollIntervalMs ?? 2_000;
    this.timeoutMs = config.statusTimeoutMs ?? 60_000;
  }

  /** Submit a bundle and optionally wait for confirmation */
  async sendBundle(
    transactions: (Transaction | VersionedTransaction)[],
    options?: { waitForConfirmation?: boolean },
  ): Promise<BundleResult> {
    if (transactions.length === 0 || transactions.length > 5) {
      throw new SolTxError(
        SolTxErrorCode.BUNDLE_FAILED,
        `Bundle must contain 1-5 transactions, got ${transactions.length}`,
      );
    }

    const serialized = transactions.map(serializeTransaction);
    const bundleId = await this.rpcCall<string>("sendBundle", [serialized]);

    this.logger?.info("Bundle submitted", { bundleId, txCount: transactions.length });
    this.events?.emit(TxEvent.BUNDLE_SENT, { bundleId, txCount: transactions.length });

    if (options?.waitForConfirmation) {
      return this.waitForBundleStatus(bundleId);
    }

    return { bundleId, status: BundleStatus.SUBMITTED };
  }

  /** Poll getBundleStatuses until landed, failed, or timeout */
  async waitForBundleStatus(bundleId: string): Promise<BundleResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.timeoutMs) {
      const statuses = await this.rpcCall<{
        value: Array<{
          bundle_id: string;
          transactions: string[];
          slot: number;
          confirmation_status: string;
          err: { Ok?: null; Err?: unknown };
        }>;
      }>("getBundleStatuses", [[bundleId]]);

      const bundleInfo = statuses.value[0];
      if (bundleInfo) {
        if (bundleInfo.confirmation_status === "finalized" || bundleInfo.confirmation_status === "confirmed") {
          const result: BundleResult = {
            bundleId,
            status: BundleStatus.LANDED,
            slot: bundleInfo.slot,
            latencyMs: Date.now() - startTime,
          };
          this.events?.emit(TxEvent.BUNDLE_CONFIRMED, { bundleId, slot: bundleInfo.slot });
          return result;
        }

        if (bundleInfo.err?.Err) {
          const result: BundleResult = {
            bundleId,
            status: BundleStatus.FAILED,
            latencyMs: Date.now() - startTime,
          };
          this.events?.emit(TxEvent.BUNDLE_FAILED, {
            bundleId,
            error: new Error(JSON.stringify(bundleInfo.err.Err)),
          });
          return result;
        }
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }

    // Timeout — bundle likely dropped
    const result: BundleResult = {
      bundleId,
      status: BundleStatus.DROPPED,
      latencyMs: Date.now() - startTime,
    };
    this.events?.emit(TxEvent.BUNDLE_FAILED, { bundleId, error: new Error("Bundle status polling timed out") });
    return result;
  }

  private static validateUrl(url: string): string {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      throw new SolTxError(
        SolTxErrorCode.BUNDLE_FAILED,
        `Invalid block engine URL: must start with https:// or http://, got "${url}"`,
      );
    }
    // Strip trailing slash for consistent URL construction
    return url.replace(/\/+$/, "");
  }

  /** Raw JSON-RPC call to the block engine */
  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const url = `${this.blockEngineUrl}/api/v1/bundles`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new SolTxError(SolTxErrorCode.BUNDLE_FAILED, `Jito block engine returned HTTP ${response.status}`, {
        context: { status: response.status, method },
      });
    }

    const json = (await response.json()) as { result?: T; error?: { code: number; message: string } };

    if (json.error) {
      throw new SolTxError(SolTxErrorCode.BUNDLE_FAILED, `Jito RPC error: ${json.error.message}`, {
        context: { code: json.error.code, method },
      });
    }

    return json.result as T;
  }
}
