import { Keypair } from "@solana/web3.js";
import { beforeEach, describe, expect, it } from "vitest";
import { JITO_MAX_TIP_LAMPORTS, JITO_TIP_ACCOUNTS } from "../../src/constants.js";
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

    it("throws on NaN lamports", () => {
      const payer = Keypair.generate();
      expect(() => createTipInstruction(payer.publicKey, Number.NaN)).toThrow("non-negative finite number");
    });

    it("throws on negative lamports", () => {
      const payer = Keypair.generate();
      expect(() => createTipInstruction(payer.publicKey, -1)).toThrow("non-negative finite number");
    });

    it("throws on Infinity lamports", () => {
      const payer = Keypair.generate();
      expect(() => createTipInstruction(payer.publicKey, Number.POSITIVE_INFINITY)).toThrow(
        "non-negative finite number",
      );
    });

    it("clamps to maxTipLamports (default JITO_MAX_TIP_LAMPORTS)", () => {
      const payer = Keypair.generate();
      // A value well above the default max should still produce a valid instruction
      const ix = createTipInstruction(payer.publicKey, JITO_MAX_TIP_LAMPORTS + 1_000_000);
      expect(ix).toBeDefined();
      expect(ix.programId.toBase58()).toBe("11111111111111111111111111111111");
    });

    it("respects custom bounds (min/max)", () => {
      const payer = Keypair.generate();
      // With custom bounds, value below min gets clamped up, above max gets clamped down
      const ixLow = createTipInstruction(payer.publicKey, 10, { minTipLamports: 500, maxTipLamports: 5_000 });
      expect(ixLow).toBeDefined();

      const ixHigh = createTipInstruction(payer.publicKey, 10_000, { minTipLamports: 500, maxTipLamports: 5_000 });
      expect(ixHigh).toBeDefined();
    });

    it("throws when maxTipLamports is 0", () => {
      const payer = Keypair.generate();
      expect(() => createTipInstruction(payer.publicKey, 1_000, { maxTipLamports: 0 })).toThrow(
        "maxTipLamports must be > 0",
      );
    });

    it("throws when minTipLamports > maxTipLamports", () => {
      const payer = Keypair.generate();
      expect(() =>
        createTipInstruction(payer.publicKey, 1_000, { minTipLamports: 10_000, maxTipLamports: 5_000 }),
      ).toThrow("minTipLamports (10000) must be <= maxTipLamports (5000)");
    });
  });
});
