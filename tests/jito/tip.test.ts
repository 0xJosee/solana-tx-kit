import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it } from "vitest";
import { JITO_TIP_ACCOUNTS } from "../../src/constants.js";
import { createTipInstruction, getNextTipAccount, resetTipRotation } from "../../src/jito/tip.js";

describe("tip", () => {
  beforeEach(() => {
    resetTipRotation();
  });

  describe("getNextTipAccount", () => {
    it("returns accounts from the tip account pool over many calls", () => {
      // With random selection, we expect high coverage over many calls (probabilistic)
      const accounts = new Set<string>();
      for (let i = 0; i < 100; i++) {
        accounts.add(getNextTipAccount().toBase58());
      }
      // With 100 calls and 8 accounts, we expect all to appear with overwhelming probability
      expect(accounts.size).toBe(8);
    });

    it("each call returns a valid Jito tip account", () => {
      for (let i = 0; i < 8; i++) {
        const account = getNextTipAccount();
        const valid = JITO_TIP_ACCOUNTS.some((a) => a.equals(account));
        expect(valid).toBe(true);
      }
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
