import type { Transaction, VersionedTransaction } from "@solana/web3.js";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export type SolanaTransaction = Transaction | VersionedTransaction;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
