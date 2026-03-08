import { type PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { JITO_MIN_TIP_LAMPORTS, JITO_TIP_ACCOUNTS } from "../constants.js";

/** Get a random tip account */
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

/** Create a SOL transfer instruction to a Jito tip account */
export function createTipInstruction(payer: PublicKey, lamports: number): TransactionInstruction {
  const tipAccount = getNextTipAccount();
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: Math.max(lamports, JITO_MIN_TIP_LAMPORTS),
  });
}
