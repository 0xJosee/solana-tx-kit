import type { Connection } from "@solana/web3.js";
import { DEFAULT_BLOCKHASH_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { Logger } from "../types.js";
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

  constructor(
    private readonly connection: Connection,
    config?: Partial<BlockhashManagerConfig>,
    private readonly logger?: Logger,
  ) {
    this.config = { ...DEFAULT_BLOCKHASH_CONFIG, ...config };
  }

  /** Start background refresh loop */
  start(): void {
    if (this.refreshInterval) return;
    this.refreshInterval = setInterval(() => {
      this.refreshBlockhash().catch((err) => {
        this.logger?.warn("Background blockhash refresh failed", { error: String(err) });
      });
    }, this.config.refreshIntervalMs);
  }

  /** Get a valid blockhash. Fetches fresh one if cache is stale or missing */
  async getBlockhash(): Promise<BlockhashInfo> {
    if (this.cache && !this.isStale(this.cache)) {
      return this.cache;
    }
    return this.refreshBlockhash();
  }

  /** Force a fresh fetch (used after blockhash expiry during retry) */
  async refreshBlockhash(): Promise<BlockhashInfo> {
    // Promise coalescing: reuse in-flight fetch
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.fetchBlockhash();
    try {
      const info = await this.fetchPromise;
      this.cache = info;
      return info;
    } finally {
      this.fetchPromise = null;
    }
  }

  /** Check if the current blockhash is still valid by comparing block heights */
  async isBlockhashValid(): Promise<boolean> {
    if (!this.cache) return false;
    try {
      const currentHeight = await this.connection.getBlockHeight(this.config.commitment);
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
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  private isStale(info: BlockhashInfo): boolean {
    return Date.now() - info.fetchedAt > this.config.ttlMs;
  }

  private async fetchBlockhash(): Promise<BlockhashInfo> {
    try {
      const result = await this.connection.getLatestBlockhash(this.config.commitment);
      const info: BlockhashInfo = {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
        fetchedAt: Date.now(),
      };
      this.logger?.debug("Fetched new blockhash", { blockhash: `${info.blockhash.slice(0, 12)}...` });
      return info;
    } catch (err) {
      throw new SolTxError(
        SolTxErrorCode.BLOCKHASH_FETCH_FAILED,
        "Failed to fetch blockhash. Verify your RPC endpoint is reachable and responding.",
        { cause: err instanceof Error ? err : new Error(String(err)) },
      );
    }
  }
}
