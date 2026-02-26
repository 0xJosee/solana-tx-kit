import type { PublicKey } from "@solana/web3.js";

export interface FeeEstimateConfig {
  /** Percentile to target: 50, 75, or 90 (default: 75) */
  targetPercentile: 50 | 75 | 90;
  /** Maximum micro-lamports per CU (default: 1_000_000) */
  maxMicroLamports: number;
  /** Minimum micro-lamports per CU (default: 1_000) */
  minMicroLamports: number;
  /** Writable accounts for account-specific estimation */
  writableAccounts?: PublicKey[];
}

export interface FeeEstimateResult {
  /** Recommended micro-lamports per CU */
  microLamports: number;
  /** The percentile values observed */
  percentiles: { p50: number; p75: number; p90: number };
  /** Number of fee samples used */
  sampleCount: number;
}

export interface ComputeBudgetConfig {
  /** Compute unit limit to request (default: 200_000) */
  computeUnits: number;
  /** Micro-lamports per compute unit */
  microLamports: number;
}
