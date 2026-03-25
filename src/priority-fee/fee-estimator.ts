import type { Connection } from "@solana/web3.js";
import { DEFAULT_PRIORITY_FEE_CONFIG } from "../constants.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import { validateNonNegativeNumber } from "../validation.js";
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

  validateNonNegativeNumber(resolved.minMicroLamports, "minMicroLamports");
  validateNonNegativeNumber(resolved.maxMicroLamports, "maxMicroLamports");
  if (resolved.minMicroLamports > resolved.maxMicroLamports) {
    throw new SolTxError(
      SolTxErrorCode.INVALID_ARGUMENT,
      `minMicroLamports (${resolved.minMicroLamports}) must be <= maxMicroLamports (${resolved.maxMicroLamports})`,
    );
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const accounts = resolved.writableAccounts?.map((a) => a.toBase58());
    const fees = await Promise.race([
      connection.getRecentPrioritizationFees(
        accounts ? { lockedWritableAccounts: accounts.map((a) => ({ toBase58: () => a }) as never) } : undefined,
      ),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error("Fee estimation timed out")), 10_000);
      }),
    ]);
    if (timerId !== undefined) clearTimeout(timerId);

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
    if (timerId !== undefined) clearTimeout(timerId);
    throw new SolTxError(
      SolTxErrorCode.FEE_ESTIMATION_FAILED,
      "Failed to estimate priority fees. Use disablePriorityFees() or pass { priorityFee: { microLamports: N } } as a static override.",
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }
}
