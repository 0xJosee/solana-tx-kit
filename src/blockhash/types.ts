import type { Commitment } from "@solana/web3.js";

export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAt: number;
}

export interface BlockhashManagerConfig {
  /** Time-to-live for cached blockhash in ms (default: 60_000) */
  ttlMs: number;
  /** Background refresh interval in ms (default: 30_000) */
  refreshIntervalMs: number;
  /** Commitment for fetching (default: "confirmed") */
  commitment: Commitment;
}
