import type { Connection } from "@solana/web3.js";
import { DEFAULT_CONFIRMATION_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { TxEvent, type TypedEventEmitter } from "../events.js";
import type { Logger } from "../types.js";
import type { ConfirmationConfig, ConfirmationResult } from "./types.js";

const MIN_POLL_INTERVAL_MS = 500;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const WS_SUB_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 20;

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
  private destroyed = false;

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
    if (this.destroyed) {
      throw new SolTxError(SolTxErrorCode.NON_RETRYABLE, "TransactionConfirmer has been destroyed");
    }

    const resolved: ConfirmationConfig = { ...DEFAULT_CONFIRMATION_CONFIG, ...config };

    // M-2: Clamp config values to safe ranges
    resolved.pollIntervalMs = Math.max(resolved.pollIntervalMs, MIN_POLL_INTERVAL_MS);
    resolved.timeoutMs = Math.min(Math.max(resolved.timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);

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

  /** Stop accepting new confirmations */
  destroy(): void {
    this.destroyed = true;
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

        // M-4: WS sub-timeout — if no callback fires within 30s, clean up subscription
        // The promise stays pending; polling or global timeout will win the race
        const wsTimeout = setTimeout(() => {
          this.logger?.debug("WebSocket subscription timed out, relying on polling");
          connection.removeSignatureListener(subId).catch(() => {});
        }, WS_SUB_TIMEOUT_MS);
        cleanups.push(() => clearTimeout(wsTimeout));
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      let consecutivePollFailures = 0;

      const scheduleNext = () => {
        if (done) return;
        timer = setTimeout(async () => {
          try {
            const blockHeight = await connection.getBlockHeight(config.commitment);
            if (blockHeight > lastValidBlockHeight) {
              done = true;
              resolve({ status: "expired", latencyMs: latencyMs() });
              return;
            }

            const statuses = await connection.getSignatureStatuses([signature]);
            const status = statuses.value[0];
            if (!status) {
              consecutivePollFailures = 0;
              scheduleNext();
              return;
            }

            consecutivePollFailures = 0;

            if (status.err) {
              const errorMsg = typeof status.err === "string" ? status.err : JSON.stringify(status.err);
              done = true;
              resolve({
                status: "failed",
                slot: status.slot,
                error: { code: -1, message: errorMsg },
                latencyMs: latencyMs(),
              });
              return;
            }

            if (status.confirmationStatus === "finalized") {
              done = true;
              resolve({ status: "finalized", slot: status.slot, latencyMs: latencyMs() });
              return;
            }

            // M-1: Only accept "confirmed" for confirmed commitment, "processed" only for processed commitment
            if (status.confirmationStatus === "confirmed" && config.commitment !== "finalized") {
              done = true;
              resolve({ status: "confirmed", slot: status.slot, latencyMs: latencyMs() });
              return;
            }

            if (status.confirmationStatus === "processed" && config.commitment === "processed") {
              done = true;
              resolve({ status: "confirmed", slot: status.slot, latencyMs: latencyMs() });
              return;
            }
          } catch (err) {
            // M-5: Track consecutive poll failures and escalate
            consecutivePollFailures++;
            const logLevel = consecutivePollFailures >= 10 ? "error" : "warn";
            this.logger?.[logLevel]("Confirmation polling error", {
              error: String(err),
              consecutiveFailures: consecutivePollFailures,
            });

            if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
              done = true;
              resolve({ status: "expired", latencyMs: latencyMs() });
              return;
            }
          }
          scheduleNext();
        }, config.pollIntervalMs);
      };

      cleanups.push(() => {
        done = true;
        if (timer !== undefined) clearTimeout(timer);
      });
      scheduleNext();
    });
  }
}
