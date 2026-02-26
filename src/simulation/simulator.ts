import type { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { SolTxError, SolTxErrorCode } from "../errors.js";
import type { Logger } from "../types.js";
import { isVersionedTransaction } from "../utils.js";
import type { SimulationConfig, SimulationResult } from "./types.js";

/**
 * Wraps Connection.simulateTransaction with:
 * - Structured result parsing
 * - Log extraction
 * - Error decoding
 * - Compute unit extraction
 */
export async function simulateTransaction(
  connection: Connection,
  transaction: VersionedTransaction | Transaction,
  config?: SimulationConfig,
  logger?: Logger,
): Promise<SimulationResult> {
  const commitment = config?.commitment ?? "confirmed";
  const replaceRecentBlockhash = config?.replaceRecentBlockhash ?? true;
  const sigVerify = config?.sigVerify ?? false;

  try {
    let err: unknown;
    let logs: string[] | null = null;
    let unitsConsumed: number | undefined;

    if (isVersionedTransaction(transaction)) {
      const result = await connection.simulateTransaction(transaction, {
        commitment,
        replaceRecentBlockhash,
        sigVerify,
      });
      err = result.value.err;
      logs = result.value.logs;
      unitsConsumed = result.value.unitsConsumed;
    } else {
      const result = await connection.simulateTransaction(transaction);
      err = result.value.err;
      logs = result.value.logs;
      unitsConsumed = result.value.unitsConsumed;
    }

    if (err) {
      const errorMessage = typeof err === "string" ? err : JSON.stringify(err);
      logger?.warn("Simulation failed", { error: errorMessage });

      let instructionError: { index: number; message: string } | undefined;
      if (typeof err === "object" && err !== null && "InstructionError" in err) {
        const ie = (err as { InstructionError: [number, unknown] }).InstructionError;
        instructionError = {
          index: ie[0],
          message: typeof ie[1] === "string" ? ie[1] : JSON.stringify(ie[1]),
        };
      }

      return {
        success: false,
        unitsConsumed: unitsConsumed ?? 0,
        logs: logs ?? [],
        error: {
          code: typeof err === "object" && err !== null && "code" in err ? (err as { code: number }).code : -1,
          message: errorMessage,
          ...(instructionError ? { instructionError } : {}),
        },
      };
    }

    logger?.debug("Simulation succeeded", { unitsConsumed: unitsConsumed ?? 0 });

    return {
      success: true,
      unitsConsumed: unitsConsumed ?? 0,
      logs: logs ?? [],
    };
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new SolTxError(SolTxErrorCode.SIMULATION_FAILED, `Transaction simulation failed: ${cause.message}`, {
      cause,
    });
  }
}
