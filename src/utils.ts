import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { SolanaTransaction } from "./types.js";

/** Type guard: returns true if the transaction is a VersionedTransaction */
export function isVersionedTransaction(tx: SolanaTransaction): tx is VersionedTransaction {
  return "version" in tx;
}

/** Type guard: returns true if the transaction is a legacy Transaction */
export function isLegacyTransaction(tx: SolanaTransaction): tx is Transaction {
  return !isVersionedTransaction(tx);
}
