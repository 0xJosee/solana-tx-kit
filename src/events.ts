import { EventEmitter } from "node:events";
import type { SolanaTransaction } from "./types.js";

/** Transaction lifecycle events emitted during send/confirm/bundle operations */
export enum TxEvent {
  SENDING = "sending",
  SIMULATED = "simulated",
  SENT = "sent",
  CONFIRMING = "confirming",
  CONFIRMED = "confirmed",
  RETRYING = "retrying",
  BLOCKHASH_EXPIRED = "blockhash_expired",
  FAILED = "failed",

  BUNDLE_SENT = "bundle_sent",
  BUNDLE_CONFIRMED = "bundle_confirmed",
  BUNDLE_FAILED = "bundle_failed",
}

export interface TxEventMap {
  [TxEvent.SENDING]: { transaction: SolanaTransaction; attempt: number };
  [TxEvent.SIMULATED]: { signature: string; unitsConsumed: number; logs: string[] };
  [TxEvent.SENT]: { signature: string; attempt: number };
  [TxEvent.CONFIRMING]: { signature: string; commitment: string };
  [TxEvent.CONFIRMED]: { signature: string; slot: number; commitment: string };
  [TxEvent.RETRYING]: { attempt: number; maxRetries: number; error: Error; delayMs: number };
  [TxEvent.BLOCKHASH_EXPIRED]: { oldBlockhash: string; newBlockhash: string };
  [TxEvent.FAILED]: { error: Error; attempt: number };
  [TxEvent.BUNDLE_SENT]: { bundleId: string; txCount: number };
  [TxEvent.BUNDLE_CONFIRMED]: { bundleId: string; slot: number };
  [TxEvent.BUNDLE_FAILED]: { bundleId: string; error: Error };
}

/** Type-safe event emitter for transaction lifecycle events. Subscribe via `.on(TxEvent.*, handler)`. */
export class TypedEventEmitter extends EventEmitter {
  override emit<K extends TxEvent>(event: K, data: TxEventMap[K]): boolean {
    return super.emit(event, data);
  }

  override on<K extends TxEvent>(event: K, listener: (data: TxEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  override once<K extends TxEvent>(event: K, listener: (data: TxEventMap[K]) => void): this {
    return super.once(event, listener);
  }
}
