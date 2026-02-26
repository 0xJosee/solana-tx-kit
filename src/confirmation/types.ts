import type { Commitment } from "@solana/web3.js";

export interface ConfirmationConfig {
  /** Target commitment level (default: "confirmed") */
  commitment: Commitment;
  /** Total timeout in ms (default: 60_000) */
  timeoutMs: number;
  /** Polling interval for fallback polling in ms (default: 2_000) */
  pollIntervalMs: number;
  /** Whether to use WebSocket subscription (default: true) */
  useWebSocket: boolean;
}

export interface ConfirmationResult {
  status: "confirmed" | "finalized" | "expired" | "failed";
  slot?: number;
  error?: { code: number; message: string };
  /** Time from submission to confirmation in ms */
  latencyMs: number;
}
