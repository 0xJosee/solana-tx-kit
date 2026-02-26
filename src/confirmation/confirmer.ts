import type { Connection } from "@solana/web3.js";
import { DEFAULT_CONFIRMATION_CONFIG } from "../constants.js";
import { TxEvent, type TypedEventEmitter } from "../events.js";
import type { Logger } from "../types.js";
import type { ConfirmationConfig, ConfirmationResult } from "./types.js";

/**
 * Confirms a transaction by signature.
 *
 * Strategy:
 * 1. Subscribe via WebSocket (onSignature) — fastest notification
 * 2. Simultaneously poll getSignatureStatuses as fallback
 * 3. Also poll getBlockHeight to detect blockhash expiry
 * 4. First signal wins via Promise.race; losers cleaned up in finally
 */
export class TransactionConfirmer {
  constructor(
    private readonly logger?: Logger,
    private readonly events?: TypedEventEmitter,
  ) {}

  async confirm(
    connection: Connection,
    signature: string,
    lastValidBlockHeight: number,
    config?: Partial<ConfirmationConfig>,
  ): Promise<ConfirmationResult> {
    const resolved: ConfirmationConfig = { ...DEFAULT_CONFIRMATION_CONFIG, ...config };
    const startTime = Date.now();
    const latencyMs = () => Date.now() - startTime;

    this.events?.emit(TxEvent.CONFIRMING, { signature, commitment: resolved.commitment });

    const cleanups: (() => void)[] = [];

    try {
      const races: Promise<ConfirmationResult>[] = [];

      // 1. Timeout
      races.push(
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ status: "expired", latencyMs: latencyMs() }), resolved.timeoutMs);
          cleanups.push(() => clearTimeout(timer));
        }),
      );

      // 2. WebSocket subscription (fastest path)
      if (resolved.useWebSocket) {
        races.push(this.subscribeWebSocket(connection, signature, resolved, latencyMs, cleanups));
      }

      // 3. Polling fallback
      races.push(this.pollForConfirmation(connection, signature, lastValidBlockHeight, resolved, latencyMs, cleanups));

      return await Promise.race(races);
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  }

  private subscribeWebSocket(
    connection: Connection,
    signature: string,
    config: ConfirmationConfig,
    latencyMs: () => number,
    cleanups: (() => void)[],
  ): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      try {
        const subId = connection.onSignature(
          signature,
          (result, context) => {
            if (result.err) {
              const errorMsg = typeof result.err === "string" ? result.err : JSON.stringify(result.err);
              resolve({
                status: "failed",
                slot: context.slot,
                error: { code: -1, message: errorMsg },
                latencyMs: latencyMs(),
              });
            } else {
              resolve({
                status: config.commitment === "finalized" ? "finalized" : "confirmed",
                slot: context.slot,
                latencyMs: latencyMs(),
              });
            }
          },
          config.commitment,
        );
        cleanups.push(() => {
          connection.removeSignatureListener(subId).catch(() => {});
        });
      } catch (err) {
        this.logger?.warn("WebSocket subscription failed, relying on polling", { error: String(err) });
        // Never resolve — let polling or timeout win
      }
    });
  }

  private pollForConfirmation(
    connection: Connection,
    signature: string,
    lastValidBlockHeight: number,
    config: ConfirmationConfig,
    latencyMs: () => number,
    cleanups: (() => void)[],
  ): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const blockHeight = await connection.getBlockHeight(config.commitment);
          if (blockHeight > lastValidBlockHeight) {
            resolve({ status: "expired", latencyMs: latencyMs() });
            return;
          }

          const statuses = await connection.getSignatureStatuses([signature]);
          const status = statuses.value[0];
          if (!status) return;

          if (status.err) {
            const errorMsg = typeof status.err === "string" ? status.err : JSON.stringify(status.err);
            resolve({
              status: "failed",
              slot: status.slot,
              error: { code: -1, message: errorMsg },
              latencyMs: latencyMs(),
            });
            return;
          }

          if (status.confirmationStatus === "finalized") {
            resolve({ status: "finalized", slot: status.slot, latencyMs: latencyMs() });
            return;
          }

          if (
            (status.confirmationStatus === "confirmed" || status.confirmationStatus === "processed") &&
            config.commitment !== "finalized"
          ) {
            resolve({ status: "confirmed", slot: status.slot, latencyMs: latencyMs() });
          }
        } catch (err) {
          this.logger?.warn("Confirmation polling error", { error: String(err) });
        }
      }, config.pollIntervalMs);
      cleanups.push(() => clearInterval(timer));
    });
  }
}
