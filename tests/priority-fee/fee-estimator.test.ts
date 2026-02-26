import { describe, expect, it } from "vitest";
import { estimatePriorityFee } from "../../src/priority-fee/fee-estimator.js";
import { createMockConnection } from "../helpers/mock-connection.js";

describe("estimatePriorityFee", () => {
  it("computes percentile-based fee from mock data", async () => {
    const conn = createMockConnection();
    const result = await estimatePriorityFee(conn);

    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.microLamports).toBeGreaterThanOrEqual(1_000); // min clamp
    expect(result.microLamports).toBeLessThanOrEqual(1_000_000); // max clamp
    expect(result.percentiles.p50).toBeDefined();
    expect(result.percentiles.p75).toBeDefined();
    expect(result.percentiles.p90).toBeDefined();
    // p50 <= p75 <= p90
    expect(result.percentiles.p50).toBeLessThanOrEqual(result.percentiles.p75);
    expect(result.percentiles.p75).toBeLessThanOrEqual(result.percentiles.p90);
  });

  it("respects min/max clamps", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 1 }],
    });
    const result = await estimatePriorityFee(conn, { minMicroLamports: 500 });
    expect(result.microLamports).toBeGreaterThanOrEqual(500);
  });

  it("respects max clamp", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 999_999_999 }],
    });
    const result = await estimatePriorityFee(conn, { maxMicroLamports: 100_000 });
    expect(result.microLamports).toBeLessThanOrEqual(100_000);
  });

  it("handles empty fee data gracefully", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [],
    });
    const result = await estimatePriorityFee(conn);
    expect(result.sampleCount).toBe(0);
    // Should return min since no data
    expect(result.microLamports).toBe(1_000);
  });

  it("targets p90 when configured", async () => {
    const conn = createMockConnection();
    const p75result = await estimatePriorityFee(conn, { targetPercentile: 75 });
    const p90result = await estimatePriorityFee(conn, { targetPercentile: 90 });
    expect(p90result.microLamports).toBeGreaterThanOrEqual(p75result.microLamports);
  });
});
