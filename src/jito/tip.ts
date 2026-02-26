import { type PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { JITO_MIN_TIP_LAMPORTS, JITO_TIP_ACCOUNTS } from "../constants.js";

let tipIndex = 0;

/** Get the next tip account using round-robin rotation */
export function getNextTipAccount(): PublicKey {
  const idx = tipIndex % JITO_TIP_ACCOUNTS.length;
  tipIndex++;
  const account = JITO_TIP_ACCOUNTS[idx];
  if (!account) throw new Error(`Invalid tip account index: ${idx}`);
  return account;
}

/** Reset the tip rotation index (useful for testing) */
export function resetTipRotation(): void {
  tipIndex = 0;
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
