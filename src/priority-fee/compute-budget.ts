import { ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import type { ComputeBudgetConfig } from "./types.js";

/**
 * Returns [SetComputeUnitLimit, SetComputeUnitPrice] instructions.
 * Always returns both — the sender prepends them to the transaction.
 */
export function createComputeBudgetInstructions(
  config: ComputeBudgetConfig,
): [TransactionInstruction, TransactionInstruction] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: config.computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: config.microLamports }),
  ];
}
