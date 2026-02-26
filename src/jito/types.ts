import type { Keypair } from "@solana/web3.js";

export interface JitoConfig {
  /** Block engine URL (default: mainnet) */
  blockEngineUrl: string;
  /** Tip amount in lamports. If not set, uses dynamic calculation */
  tipLamports?: number;
  /** Maximum tip in lamports (cap for dynamic tip) */
  maxTipLamports?: number;
  /** Minimum tip in lamports (default: 1000 — Jito minimum) */
  minTipLamports?: number;
  /** Keypair for signing the tip transaction */
  tipPayer: Keypair;
  /** Poll interval for bundle status in ms (default: 2000) */
  statusPollIntervalMs?: number;
  /** Maximum time to wait for bundle confirmation in ms (default: 60000) */
  statusTimeoutMs?: number;
}

export interface BundleResult {
  bundleId: string;
  status: BundleStatus;
  slot?: number;
  /** Time from submission to confirmation in ms */
  latencyMs?: number;
}

export enum BundleStatus {
  SUBMITTED = "submitted",
  PENDING = "pending",
  LANDED = "landed",
  FAILED = "failed",
  DROPPED = "dropped",
  INVALID = "invalid",
}
