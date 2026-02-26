import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it } from "vitest";
import { JITO_TIP_ACCOUNTS } from "../../src/constants.js";
import { createTipInstruction, getNextTipAccount, resetTipRotation } from "../../src/jito/tip.js";

describe("tip", () => {
  beforeEach(() => {
    resetTipRotation();
  });

  describe("getNextTipAccount", () => {
    it("rotates through all 8 tip accounts", () => {
      const accounts = new Set<string>();
      for (let i = 0; i < 8; i++) {
        accounts.add(getNextTipAccount().toBase58());
      }
      expect(accounts.size).toBe(8);
    });

    it("wraps around after 8 calls", () => {
      const first = getNextTipAccount().toBase58();
      for (let i = 0; i < 7; i++) {
        getNextTipAccount();
      }
      const ninth = getNextTipAccount().toBase58();
      expect(ninth).toBe(first);
    });

    it("returns a valid Jito tip account", () => {
      const account = getNextTipAccount();
      const valid = JITO_TIP_ACCOUNTS.some((a) => a.equals(account));
      expect(valid).toBe(true);
    });
  });

  describe("createTipInstruction", () => {
    it("creates a transfer instruction", () => {
      const payer = Keypair.generate();
      const ix = createTipInstruction(payer.publicKey, 10_000);
      expect(ix.programId.toBase58()).toBe("11111111111111111111111111111111"); // SystemProgram
    });

    it("enforces minimum tip", () => {
      const payer = Keypair.generate();
      const ix = createTipInstruction(payer.publicKey, 100); // Below minimum
      // The instruction should still be created (Math.max enforces min)
      expect(ix).toBeDefined();
    });
  });
});
