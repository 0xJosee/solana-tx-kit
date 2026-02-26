import type { Connection } from "@solana/web3.js";
import { DEFAULT_PRIORITY_FEE_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { FeeEstimateConfig, FeeEstimateResult } from "./types.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Estimates priority fees by calling getRecentPrioritizationFees,
 * sorting the results, and computing the target percentile.
 */
export async function estimatePriorityFee(
  connection: Connection,
  config?: Partial<FeeEstimateConfig>,
): Promise<FeeEstimateResult> {
  const resolved = { ...DEFAULT_PRIORITY_FEE_CONFIG, ...config };

  try {
    const accounts = resolved.writableAccounts?.map((a) => a.toBase58());
    const fees = await connection.getRecentPrioritizationFees(
      accounts ? { lockedWritableAccounts: accounts.map((a) => ({ toBase58: () => a }) as never) } : undefined,
    );

    // Extract non-zero fees and sort
    const feeValues = fees.map((f) => f.prioritizationFee).filter((f) => f > 0);
    feeValues.sort((a, b) => a - b);

    const p50 = percentile(feeValues, 50);
    const p75 = percentile(feeValues, 75);
    const p90 = percentile(feeValues, 90);

    let target: number;
    switch (resolved.targetPercentile) {
      case 50:
        target = p50;
        break;
      case 90:
        target = p90;
        break;
      default:
        target = p75;
    }

    // Clamp to min/max bounds
    const clamped = Math.min(Math.max(target, resolved.minMicroLamports), resolved.maxMicroLamports);

    return {
      microLamports: clamped,
      percentiles: { p50, p75, p90 },
      sampleCount: feeValues.length,
    };
  } catch (err) {
    throw new SolTxError(
      SolTxErrorCode.FEE_ESTIMATION_FAILED,
      "Failed to estimate priority fees. Use disablePriorityFees() or pass { priorityFee: { microLamports: N } } as a static override.",
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }
}
