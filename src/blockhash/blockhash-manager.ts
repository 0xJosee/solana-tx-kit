import type { Connection } from "@solana/web3.js";
import { DEFAULT_BLOCKHASH_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { Logger } from "../types.js";
import { validatePositiveNumber } from "../validation.js";
import type { BlockhashInfo, BlockhashManagerConfig } from "./types.js";

/**
 * Manages blockhash caching, TTL-based staleness, and background refresh.
 * Uses promise coalescing to avoid redundant RPC calls.
 */
export class BlockhashManager {
  private cache: BlockhashInfo | null = null;
  private refreshInterval?: ReturnType<typeof setInterval> | undefined;
  private fetchPromise: Promise<BlockhashInfo> | null = null;
  private readonly config: BlockhashManagerConfig;
  private consecutiveFailures = 0;
  private destroyed = false;
  private lastFailedAt = 0;

  constructor(
    private readonly connection: Connection,
    config?: Partial<BlockhashManagerConfig>,
    private readonly logger?: Logger,
  ) {
    this.config = { ...DEFAULT_BLOCKHASH_CONFIG, ...config };

    // M-17: Validate config
    validatePositiveNumber(this.config.ttlMs, "ttlMs");
    if (this.config.refreshIntervalMs < 1_000) {
      throw new SolTxError(
        SolTxErrorCode.INVALID_ARGUMENT,
        `refreshIntervalMs must be >= 1000, got ${this.config.refreshIntervalMs}`,
      );
    }
    if (this.config.fetchTimeoutMs !== undefined && this.config.fetchTimeoutMs < 1_000) {
      throw new SolTxError(
        SolTxErrorCode.INVALID_ARGUMENT,
        `fetchTimeoutMs must be >= 1000, got ${this.config.fetchTimeoutMs}`,
      );
    }
  }

  /** Start background refresh loop */
  start(): void {
    // M-18: Guard against start after destroy
    if (this.destroyed || this.refreshInterval) return;
    this.refreshInterval = setInterval(() => {
      this.refreshBlockhash().catch((err) => {
        this.consecutiveFailures++;
        this.lastFailedAt = Date.now();
        const logLevel = this.consecutiveFailures >= 3 ? "error" : "warn";
        this.logger?.[logLevel]("Background blockhash refresh failed", {
          error: String(err),
          consecutiveFailures: this.consecutiveFailures,
        });
      });
    }, this.config.refreshIntervalMs);
  }

  /** Get a valid blockhash. Fetches fresh one if cache is stale or missing */
  async getBlockhash(): Promise<BlockhashInfo> {
    if (this.destroyed)
      throw new SolTxError(SolTxErrorCode.BLOCKHASH_FETCH_FAILED, "BlockhashManager has been destroyed");
    // Force refresh if background refresh has failed repeatedly — cached data may be on-chain expired
    if (this.cache && !this.isStale(this.cache) && this.consecutiveFailures < 2) {
      return this.cache;
    }
    return this.refreshBlockhash();
  }

  /** Force a fresh fetch (used after blockhash expiry during retry) */
  async refreshBlockhash(): Promise<BlockhashInfo> {
    // M-18: Guard against refresh after destroy
    if (this.destroyed)
      throw new SolTxError(SolTxErrorCode.BLOCKHASH_FETCH_FAILED, "BlockhashManager has been destroyed");

    // L-11: Brief negative cache to prevent thundering herd after failure
    if (this.lastFailedAt > 0 && Date.now() - this.lastFailedAt < 2_000 && !this.fetchPromise) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 2_000 - (Date.now() - this.lastFailedAt))));
    }

    // Promise coalescing: reuse in-flight fetch
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.fetchBlockhash();
    try {
      const info = await this.fetchPromise;
      this.cache = info;
      this.consecutiveFailures = 0;
      this.lastFailedAt = 0;
      return info;
    } finally {
      this.fetchPromise = null;
    }
  }

  /** Check if the current blockhash is still valid by comparing block heights */
  async isBlockhashValid(): Promise<boolean> {
    // M-18: Guard against use after destroy
    if (this.destroyed) return false;
    if (!this.cache) return false;
    const timeoutMs = this.config.fetchTimeoutMs ?? 10_000;
    try {
      // M-19: Timeout on getBlockHeight
      const currentHeight = await Promise.race([
        this.connection.getBlockHeight(this.config.commitment),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("getBlockHeight timed out")), timeoutMs)),
      ]);
      return currentHeight < this.cache.lastValidBlockHeight;
    } catch {
      return false;
    }
  }

  /** Get cached info without fetching */
  getCachedBlockhash(): BlockhashInfo | null {
    if (this.cache && !this.isStale(this.cache)) {
      return this.cache;
    }
    return null;
  }

  /** Stop background refresh */
  destroy(): void {
    this.destroyed = true;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  private isStale(info: BlockhashInfo): boolean {
    return Date.now() - info.fetchedAt > this.config.ttlMs;
  }

  private async fetchBlockhash(): Promise<BlockhashInfo> {
    const timeoutMs = this.config.fetchTimeoutMs ?? 10_000;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.connection.getLatestBlockhash(this.config.commitment),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new SolTxError(SolTxErrorCode.BLOCKHASH_FETCH_FAILED, "getLatestBlockhash timed out")),
            timeoutMs,
          );
        }),
      ]);
      // L-12: Clear dangling timeout on success
      if (timerId !== undefined) clearTimeout(timerId);

      // M-20: Basic validation on RPC response
      if (!result.blockhash || typeof result.blockhash !== "string" || result.blockhash.length === 0) {
        throw new SolTxError(SolTxErrorCode.BLOCKHASH_FETCH_FAILED, "RPC returned empty or invalid blockhash");
      }
      if (!Number.isFinite(result.lastValidBlockHeight) || result.lastValidBlockHeight <= 0) {
        throw new SolTxError(
          SolTxErrorCode.BLOCKHASH_FETCH_FAILED,
          `RPC returned invalid lastValidBlockHeight: ${result.lastValidBlockHeight}`,
        );
      }

      const info: BlockhashInfo = {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
        fetchedAt: Date.now(),
      };
      this.logger?.debug("Fetched new blockhash", { blockhash: `${info.blockhash.slice(0, 12)}...` });
      return info;
    } catch (err) {
      if (timerId !== undefined) clearTimeout(timerId);
      if (err instanceof SolTxError) throw err;
      throw new SolTxError(
        SolTxErrorCode.BLOCKHASH_FETCH_FAILED,
        "Failed to fetch blockhash. Verify your RPC endpoint is reachable and responding.",
        { cause: err instanceof Error ? err : new Error(String(err)) },
      );
    }
  }
}
