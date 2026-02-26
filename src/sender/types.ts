import type { Commitment, Keypair } from "@solana/web3.js";
import type { BlockhashManagerConfig } from "../blockhash/types.js";
import type { ConfirmationConfig } from "../confirmation/types.js";
import type { JitoConfig } from "../jito/types.js";
import type { FeeEstimateConfig } from "../priority-fee/types.js";
import type { RetryConfig } from "../retry/types.js";
import type { ConnectionPoolConfig } from "../rpc/types.js";
import type { SimulationConfig } from "../simulation/types.js";
import type { Logger } from "../types.js";

export interface SenderConfig {
  /** RPC connection(s) configuration */
  rpc: ConnectionPoolConfig | { url: string };
  /** Primary transaction signer (fee payer) */
  signer: Keypair;
  /** Default extra signers applied to every send (e.g. delegate keypairs) */
  extraSigners?: Keypair[] | undefined;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Priority fee configuration. Set to false to disable */
  priorityFee?: Partial<FeeEstimateConfig> | false;
  /** Jito configuration. Set to false to disable (default: disabled) */
  jito?: JitoConfig | false;
  /** Simulation configuration. Set to false to skip simulation */
  simulation?: Partial<SimulationConfig> | false;
  /** Confirmation configuration */
  confirmation?: Partial<ConfirmationConfig>;
  /** Blockhash management configuration */
  blockhash?: Partial<BlockhashManagerConfig>;
  /** Logger instance */
  logger?: Logger;
  /** Default commitment level for all operations */
  commitment?: Commitment;
}

export interface SendResult {
  /** Transaction signature (base58) */
  signature: string;
  /** Slot at which the transaction was confirmed */
  slot: number;
  /** Confirmation commitment achieved */
  commitment: string;
  /** Number of attempts (1 = first try succeeded) */
  attempts: number;
  /** Total time from send to confirmation in ms */
  totalLatencyMs: number;
  /** Compute units consumed (from simulation if run) */
  unitsConsumed?: number | undefined;
  /** Priority fee paid in micro-lamports per CU */
  priorityFee?: number | undefined;
}

export interface SendOptions {
  /** Override priority fee for this send only */
  priorityFee?: Partial<FeeEstimateConfig> | { microLamports: number };
  /** Override compute units for this send only */
  computeUnits?: number;
  /** Override retry config for this send only */
  retry?: Partial<RetryConfig>;
  /** Skip simulation for this send (speed over safety) */
  skipSimulation?: boolean;
  /** Skip confirmation — return after send, do not wait */
  skipConfirmation?: boolean;
  /** Custom commitment for this send only */
  commitment?: Commitment;
  /** Additional signers for this transaction (e.g. positionKeypair). Merged with config.extraSigners. */
  extraSigners?: Keypair[];
}

export function isConnectionPoolConfig(config: SenderConfig["rpc"]): config is ConnectionPoolConfig {
  return "endpoints" in config;
}

export function isStaticFee(
  config: Partial<FeeEstimateConfig> | { microLamports: number },
): config is { microLamports: number } {
  return "microLamports" in config && !("targetPercentile" in config);
}
