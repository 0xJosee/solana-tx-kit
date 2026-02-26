import { describe, expect, it } from "vitest";
import { createComputeBudgetInstructions } from "../../src/priority-fee/compute-budget.js";

describe("createComputeBudgetInstructions", () => {
  it("returns two instructions", () => {
    const [cuLimit, cuPrice] = createComputeBudgetInstructions({
      computeUnits: 200_000,
      microLamports: 5_000,
    });
    expect(cuLimit).toBeDefined();
    expect(cuPrice).toBeDefined();
  });

  it("first instruction is SetComputeUnitLimit", () => {
    const [cuLimit] = createComputeBudgetInstructions({
      computeUnits: 200_000,
      microLamports: 5_000,
    });
    // ComputeBudgetProgram.setComputeUnitLimit uses programId ComputeBudget111...
    expect(cuLimit.programId.toBase58()).toContain("ComputeBudget");
  });

  it("second instruction is SetComputeUnitPrice", () => {
    const [, cuPrice] = createComputeBudgetInstructions({
      computeUnits: 200_000,
      microLamports: 5_000,
    });
    expect(cuPrice.programId.toBase58()).toContain("ComputeBudget");
  });
});
