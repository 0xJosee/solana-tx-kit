import {
  type Transaction,
  Transaction as TransactionClass,
  VersionedTransaction,
  type VersionedTransaction as VersionedTransactionType,
} from "@solana/web3.js";
import type { SolanaTransaction } from "./types.js";

/** Type guard: returns true if the transaction is a VersionedTransaction */
export function isVersionedTransaction(tx: SolanaTransaction): tx is VersionedTransactionType {
  return "version" in tx && typeof (tx as unknown as Record<string, unknown>).serialize === "function";
}

/** Type guard: returns true if the transaction is a legacy Transaction */
export function isLegacyTransaction(tx: SolanaTransaction): tx is Transaction {
  return !isVersionedTransaction(tx);
}

/** Deep-clone a transaction to avoid mutating the caller's original. */
export function cloneTransaction<T extends SolanaTransaction>(tx: T): T {
  if (isVersionedTransaction(tx)) {
    return VersionedTransaction.deserialize(tx.serialize()) as T;
  }
  const legacy = tx as Transaction;
  const copy = new TransactionClass();
  for (const ix of legacy.instructions) copy.add(ix);
  return copy as T;
}
