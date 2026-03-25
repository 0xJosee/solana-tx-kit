import { type PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { JITO_MAX_TIP_LAMPORTS, JITO_MIN_TIP_LAMPORTS, JITO_TIP_ACCOUNTS } from "../constants.js";

/** Get a random tip account. Uses Math.random() — not crypto-secure, acceptable for equivalent tip accounts. */
export function getNextTipAccount(): PublicKey {
  const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  const account = JITO_TIP_ACCOUNTS[idx];
  if (!account) throw new Error(`Invalid tip account index: ${idx}`);
  return account;
}

/** @deprecated No longer uses global state; kept for backward compatibility */
export function resetTipRotation(): void {
  // No-op: tip selection is now stateless (random)
}

/** Create a SOL transfer instruction to a Jito tip account.
 *  Enforces min/max bounds to prevent accidental fund loss. */
export function createTipInstruction(
  payer: PublicKey,
  lamports: number,
  bounds?: { minTipLamports?: number | undefined; maxTipLamports?: number | undefined },
): TransactionInstruction {
  if (!Number.isFinite(lamports) || lamports < 0) {
    throw new Error(`Tip lamports must be a non-negative finite number, got ${lamports}`);
  }
  const min = bounds?.minTipLamports ?? JITO_MIN_TIP_LAMPORTS;
  const max = bounds?.maxTipLamports ?? JITO_MAX_TIP_LAMPORTS;
  if (max <= 0) {
    throw new Error(`maxTipLamports must be > 0, got ${max}`);
  }
  if (min > max) {
    throw new Error(`minTipLamports (${min}) must be <= maxTipLamports (${max})`);
  }
  const clamped = Math.min(Math.max(lamports, min), max);
  const tipAccount = getNextTipAccount();
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: clamped,
  });
}
