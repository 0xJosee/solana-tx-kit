import type { Commitment } from "@solana/web3.js";

export interface SimulationConfig {
  /** Commitment level for simulation (default: "confirmed") */
  commitment?: Commitment;
  /** Whether to replace the blockhash for simulation (default: true) */
  replaceRecentBlockhash?: boolean;
  /** Whether to verify signatures during simulation (default: false — faster) */
  sigVerify?: boolean;
}

export interface SimulationResult {
  success: boolean;
  unitsConsumed: number;
  logs: string[];
  error?:
    | { code: number; message: string; instructionError?: { index: number; message: string } | undefined }
    | undefined;
  returnData?: { programId: string; data: string } | undefined;
}
